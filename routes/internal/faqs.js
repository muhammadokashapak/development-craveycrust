import express from 'express';
import { getDbClient } from '../../src/db/client.js';
import { getDefaultRestaurantId } from '../../src/services/restaurantService.js';
import { searchKnowledge } from '../../src/services/knowledgeService.js';

const router = express.Router();

/**
 * GET /api/internal/faqs/search?q=&limit=
 * Search FAQ knowledge base using fuzzy similarity and keywords.
 */
router.get('/search', async (req, res) => {
    try {
        const query = req.query.q || req.query.query || '';
        const limit = Math.min(2, parseInt(req.query.limit, 10) || 2);

        const restaurantId = await getDefaultRestaurantId();

        const searchResult = await searchKnowledge({
            restaurantId,
            query,
            limit,
        });

        const slimMatches = (searchResult.data?.results || []).map(r => ({
            question: r.question,
            answer: r.answer,
        }));

        return res.json({
            success: true,
            data: slimMatches,
        });
    } catch (err) {
        console.error('[INTERNAL] Error searching FAQs:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'SEARCH_ERROR', message: err.message },
        });
    }
});

/**
 * GET /api/internal/faqs
 * Returns all active FAQs for active categories.
 */
router.get('/', async (req, res) => {
    try {
        const prisma = getDbClient();
        if (!prisma) {
            return res.status(503).json({
                success: false,
                error: { code: 'DB_UNAVAILABLE', message: 'Database not available' },
            });
        }

        const restaurantId = await getDefaultRestaurantId();

        const faqs = await prisma.fAQ.findMany({
            where: {
                restaurant_id: restaurantId,
                is_active: true,
                OR: [
                    { category_id: null },
                    { category: { is_active: true } },
                ],
            },
            orderBy: [{ sort_order: 'asc' }, { question: 'asc' }],
            include: {
                category: {
                    select: { id: true, name: true, slug: true },
                },
            },
        });

        const formatted = faqs.map((f) => ({
            id: f.id,
            category: f.category ? f.category.name : 'General',
            question: f.question,
            answer: f.answer,
            keywords: f.keywords,
            alternative_questions: f.alternative_questions,
            language: f.language,
        }));

        return res.json({
            success: true,
            data: formatted,
        });
    } catch (err) {
        console.error('[INTERNAL] Error listing internal FAQs:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message },
        });
    }
});

/**
 * GET /api/internal/faqs/:id
 * Retrieve specific active FAQ by ID.
 */
router.get('/:id', async (req, res) => {
    try {
        const prisma = getDbClient();
        if (!prisma) {
            return res.status(503).json({
                success: false,
                error: { code: 'DB_UNAVAILABLE', message: 'Database not available' },
            });
        }

        const restaurantId = await getDefaultRestaurantId();

        const faq = await prisma.fAQ.findFirst({
            where: {
                id: req.params.id,
                restaurant_id: restaurantId,
                is_active: true,
                OR: [
                    { category_id: null },
                    { category: { is_active: true } },
                ],
            },
            include: {
                category: {
                    select: { id: true, name: true, slug: true },
                },
            },
        });

        if (!faq) {
            return res.status(404).json({
                success: false,
                error: { code: 'FAQ_NOT_FOUND', message: 'Active FAQ not found' },
            });
        }

        return res.json({
            success: true,
            data: {
                id: faq.id,
                category: faq.category ? faq.category.name : 'General',
                question: faq.question,
                answer: faq.answer,
                keywords: faq.keywords,
                alternative_questions: faq.alternative_questions,
                language: faq.language,
            },
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message },
        });
    }
});

/**
 * GET /api/internal/faq-categories
 * List active FAQ categories.
 */
router.get('/categories/all', async (req, res) => {
    try {
        const prisma = getDbClient();
        if (!prisma) {
            return res.status(503).json({
                success: false,
                error: { code: 'DB_UNAVAILABLE', message: 'Database not available' },
            });
        }

        const restaurantId = await getDefaultRestaurantId();

        const categories = await prisma.fAQCategory.findMany({
            where: {
                restaurant_id: restaurantId,
                is_active: true,
            },
            orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
        });

        return res.json({
            success: true,
            data: categories.map((c) => ({
                id: c.id,
                name: c.name,
                slug: c.slug,
                description: c.description,
            })),
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message },
        });
    }
});

export default router;
