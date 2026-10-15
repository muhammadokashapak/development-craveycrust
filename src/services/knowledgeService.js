/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  Knowledge Service — src/services/knowledgeService.js       ║
 * ║  Authoritative FAQ / Knowledge Base retrieval for AI & Bot  ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Architecture:
 *   AI / Bot Orchestrator
 *          ↓
 *   knowledgeService.searchKnowledge({ restaurantId, query, limit })
 *          ↓
 *   PostgreSQL FAQ Database (pg_trgm / similarity)
 *          ↓
 *   Structured, ranked matches (confidence score 0.0 - 1.0)
 *
 * Authority rule:
 *   FAQ provides factual restaurant guidance and policies.
 *   Live transactional engines (Menu, Deals, Delivery, Orders)
 *   always override FAQ for dynamic prices, stock, and orders.
 */

import { getDbClient } from '../db/client.js';
import { flags } from '../config/flags.js';
import { dbLogger } from '../utils/logger.js';

/**
 * Trigram-based string similarity calculation in JavaScript (fallback & local scoring).
 */
function calculateTrigramSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    const s1 = str1.toLowerCase().trim();
    const s2 = str2.toLowerCase().trim();
    if (s1 === s2) return 1.0;
    if (s1.length < 2 || s2.length < 2) return s1 === s2 ? 1.0 : 0.0;

    const getTrigrams = (str) => {
        const padded = `  ${str} `;
        const trigrams = new Set();
        for (let i = 0; i < padded.length - 2; i++) {
            trigrams.add(padded.substring(i, i + 3));
        }
        return trigrams;
    };

    const t1 = getTrigrams(s1);
    const t2 = getTrigrams(s2);
    let intersection = 0;
    for (const t of t1) {
        if (t2.has(t)) intersection++;
    }
    const union = t1.size + t2.size - intersection;
    return union === 0 ? 0 : intersection / union;
}

/**
 * Token overlap and containment similarity score.
 */
function calculateWordOverlapSimilarity(query, target) {
    if (!query || !target) return 0;
    const q = query.toLowerCase().trim();
    const t = target.toLowerCase().trim();

    if (t === q) return 1.0;
    if (t.includes(q) || q.includes(t)) return 0.95;

    const qTokens = q.split(/\s+/).filter((w) => w.length > 1);
    const tTokens = t.split(/\s+/).filter((w) => w.length > 1);
    if (qTokens.length === 0 || tTokens.length === 0) return 0;

    let matched = 0;
    for (const qt of qTokens) {
        if (tTokens.some((tt) => tt.includes(qt) || qt.includes(tt) || calculateTrigramSimilarity(qt, tt) > 0.6)) {
            matched++;
        }
    }
    return matched / qTokens.length;
}

/**
 * Search authoritative FAQ knowledge base.
 *
 * @param {Object} params
 * @param {string} params.restaurantId
 * @param {string} params.query Customer question or search text
 * @param {number} [params.limit=3] Maximum matches to return
 * @param {number} [params.threshold=0.32] Minimum confidence score
 * @returns {Promise<{ success: boolean, data: { query: string, results: Array }, matches: Array }>}
 */
export async function searchKnowledge({ restaurantId, query, limit = 3, threshold = 0.32 }) {
    if (!flags.KNOWLEDGE_BASE_ENABLED) {
        dbLogger.warn('Knowledge base search invoked but KNOWLEDGE_BASE_ENABLED is false');
        return {
            success: true,
            data: { query: query || '', results: [] },
            matches: [],
        };
    }

    const cleanQuery = (query || '').trim();
    if (!cleanQuery || cleanQuery.length < 2) {
        return {
            success: true,
            data: { query: cleanQuery, results: [] },
            matches: [],
        };
    }

    const prisma = getDbClient();
    if (!prisma) {
        throw new Error('Database client unavailable');
    }

    const safeLimit = Math.max(1, Math.min(20, parseInt(limit, 10) || 3));

    // Try PostgreSQL native pg_trgm similarity search
    try {
        const rawResults = await prisma.$queryRaw`
            SELECT 
                f.id,
                f.question,
                f.answer,
                f.keywords,
                f.alternative_questions,
                f.sort_order,
                c.name AS category_name,
                ROUND(GREATEST(
                    similarity(LOWER(f.question), LOWER(${cleanQuery})),
                    word_similarity(LOWER(${cleanQuery}), LOWER(f.question)),
                    word_similarity(LOWER(f.question), LOWER(${cleanQuery})),
                    COALESCE((
                        SELECT MAX(GREATEST(
                            similarity(LOWER(kw), LOWER(${cleanQuery})),
                            word_similarity(LOWER(${cleanQuery}), LOWER(kw)),
                            word_similarity(LOWER(kw), LOWER(${cleanQuery}))
                        ))
                        FROM unnest(f.keywords) AS kw
                    ), 0),
                    COALESCE((
                        SELECT MAX(GREATEST(
                            similarity(LOWER(alt), LOWER(${cleanQuery})),
                            word_similarity(LOWER(${cleanQuery}), LOWER(alt)),
                            word_similarity(LOWER(alt), LOWER(${cleanQuery}))
                        ))
                        FROM unnest(f.alternative_questions) AS alt
                    ), 0),
                    similarity(LOWER(COALESCE(c.name, '')), LOWER(${cleanQuery})) * 0.75,
                    similarity(LOWER(f.answer), LOWER(${cleanQuery})) * 0.60
                )::numeric, 2) AS score
            FROM faqs f
            LEFT JOIN faq_categories c ON f.category_id = c.id
            WHERE f.restaurant_id = ${restaurantId}
              AND f.is_active = true
              AND (c.id IS NULL OR c.is_active = true)
            ORDER BY score DESC, f.sort_order ASC
            LIMIT ${safeLimit * 2};
        `;

        const filtered = (rawResults || [])
            .map((row) => ({
                source: 'FAQ',
                id: row.id,
                category: row.category_name || 'General',
                question: row.question,
                answer: row.answer,
                score: parseFloat(row.score) || 0,
            }))
            .filter((item) => item.score >= threshold)
            .slice(0, safeLimit);

        return {
            success: true,
            data: {
                query: cleanQuery,
                results: filtered.map((m) => ({
                    id: m.id,
                    category: m.category,
                    question: m.question,
                    answer: m.answer,
                    score: m.score,
                })),
            },
            matches: filtered,
        };
    } catch (dbErr) {
        dbLogger.warn({ err: dbErr.message }, 'PostgreSQL pg_trgm query failed, falling back to JS similarity matcher');

        // Fallback: Query active FAQs through Prisma relation and compute similarity in JS
        const faqs = await prisma.fAQ.findMany({
            where: {
                restaurant_id: restaurantId,
                is_active: true,
                OR: [
                    { category_id: null },
                    { category: { is_active: true } },
                ],
            },
            include: {
                category: { select: { id: true, name: true, is_active: true } },
            },
        });

        const scored = faqs.map((faq) => {
            const questionScore = Math.max(
                calculateTrigramSimilarity(cleanQuery, faq.question),
                calculateWordOverlapSimilarity(cleanQuery, faq.question)
            );

            let maxKwScore = 0;
            if (Array.isArray(faq.keywords)) {
                for (const kw of faq.keywords) {
                    const kwScore = Math.max(
                        calculateTrigramSimilarity(cleanQuery, kw),
                        calculateWordOverlapSimilarity(cleanQuery, kw)
                    );
                    if (kwScore > maxKwScore) maxKwScore = kwScore;
                }
            }

            let maxAltScore = 0;
            if (Array.isArray(faq.alternative_questions)) {
                for (const alt of faq.alternative_questions) {
                    const altScore = Math.max(
                        calculateTrigramSimilarity(cleanQuery, alt),
                        calculateWordOverlapSimilarity(cleanQuery, alt)
                    );
                    if (altScore > maxAltScore) maxAltScore = altScore;
                }
            }

            const catScore = faq.category ? calculateTrigramSimilarity(cleanQuery, faq.category.name) * 0.75 : 0;
            const answerScore = calculateWordOverlapSimilarity(cleanQuery, faq.answer) * 0.6;

            const finalScore = parseFloat(
                Math.max(questionScore, maxKwScore, maxAltScore, catScore, answerScore).toFixed(2)
            );

            return {
                source: 'FAQ',
                id: faq.id,
                category: faq.category?.name || 'General',
                question: faq.question,
                answer: faq.answer,
                score: finalScore,
                sort_order: faq.sort_order,
            };
        });

        const filtered = scored
            .filter((item) => item.score >= threshold)
            .sort((a, b) => b.score - a.score || a.sort_order - b.sort_order)
            .slice(0, safeLimit);

        return {
            success: true,
            data: {
                query: cleanQuery,
                results: filtered.map((m) => ({
                    id: m.id,
                    category: m.category,
                    question: m.question,
                    answer: m.answer,
                    score: m.score,
                })),
            },
            matches: filtered,
        };
    }
}
