import express from 'express';
import { getDbClient } from '../../src/db/client.js';
import { getDefaultRestaurantId } from '../../src/services/restaurantService.js';
import { createFaqSchema, updateFaqSchema } from '../../src/validators/faqSchema.js';

const router = express.Router();

/**
 * GET /api/admin/faqs
 * List FAQs with optional category filter, active filter, and search.
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

        const restaurantId = req.user?.restaurantId || req.user?.restaurant_id || (await getDefaultRestaurantId());
        const { category_id, is_active, search } = req.query;

        const where = { restaurant_id: restaurantId };

        if (category_id) {
            where.category_id = category_id === 'null' ? null : category_id;
        }

        if (is_active !== undefined) {
            where.is_active = is_active === 'true' || is_active === true;
        }

        if (search && search.trim()) {
            const q = search.trim();
            where.OR = [
                { question: { contains: q, mode: 'insensitive' } },
                { answer: { contains: q, mode: 'insensitive' } },
                { keywords: { has: q } },
            ];
        }

        const faqs = await prisma.fAQ.findMany({
            where,
            orderBy: [{ sort_order: 'asc' }, { created_at: 'desc' }],
            include: {
                category: {
                    select: { id: true, name: true, slug: true, is_active: true },
                },
            },
        });

        const formatted = faqs.map((f) => ({
            id: f.id,
            restaurant_id: f.restaurant_id,
            category_id: f.category_id,
            category_name: f.category ? f.category.name : 'Uncategorized',
            category: f.category,
            question: f.question,
            answer: f.answer,
            keywords: f.keywords || [],
            alternative_questions: f.alternative_questions || [],
            is_active: f.is_active,
            sort_order: f.sort_order,
            language: f.language,
            created_by: f.created_by,
            updated_by: f.updated_by,
            created_at: f.created_at,
            updated_at: f.updated_at,
        }));

        return res.json({ success: true, data: formatted });
    } catch (err) {
        console.error('[ADMIN] Error listing FAQs:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve FAQs' },
        });
    }
});

/**
 * GET /api/admin/faqs/:id
 * Retrieve specific FAQ by ID.
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

        const restaurantId = req.user?.restaurantId || req.user?.restaurant_id || (await getDefaultRestaurantId());
        const faq = await prisma.fAQ.findFirst({
            where: {
                id: req.params.id,
                restaurant_id: restaurantId,
            },
            include: {
                category: {
                    select: { id: true, name: true, slug: true, is_active: true },
                },
            },
        });

        if (!faq) {
            return res.status(404).json({
                success: false,
                error: { code: 'FAQ_NOT_FOUND', message: 'FAQ not found' },
            });
        }

        return res.json({
            success: true,
            data: {
                ...faq,
                category_name: faq.category ? faq.category.name : 'Uncategorized',
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
 * POST /api/admin/faqs
 * Create new FAQ.
 */
router.post('/', async (req, res) => {
    try {
        const parseResult = createFaqSchema.safeParse(req.body);
        if (!parseResult.success) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: parseResult.error.errors[0]?.message || 'Invalid input data',
                    details: parseResult.error.flatten(),
                },
            });
        }

        const prisma = getDbClient();
        if (!prisma) {
            return res.status(503).json({
                success: false,
                error: { code: 'DB_UNAVAILABLE', message: 'Database not available' },
            });
        }

        const restaurantId = req.user?.restaurantId || req.user?.restaurant_id || (await getDefaultRestaurantId());
        const {
            category_id,
            question,
            answer,
            keywords,
            alternative_questions,
            is_active,
            sort_order,
            language,
        } = parseResult.data;

        // If category_id provided, verify it belongs to current restaurant
        if (category_id) {
            const cat = await prisma.fAQCategory.findFirst({
                where: { id: category_id, restaurant_id: restaurantId },
            });
            if (!cat) {
                return res.status(400).json({
                    success: false,
                    error: { code: 'INVALID_CATEGORY', message: 'Selected category does not exist for this restaurant' },
                });
            }
        }

        const username = req.user?.username || req.user?.sub || 'admin';

        const faq = await prisma.fAQ.create({
            data: {
                restaurant_id: restaurantId,
                category_id: category_id || null,
                question,
                answer,
                keywords: keywords || [],
                alternative_questions: alternative_questions || [],
                is_active: is_active ?? true,
                sort_order: sort_order ?? 0,
                language: language || 'en',
                created_by: username,
                updated_by: username,
            },
            include: {
                category: {
                    select: { id: true, name: true, slug: true, is_active: true },
                },
            },
        });

        return res.status(201).json({
            success: true,
            data: {
                ...faq,
                category_name: faq.category ? faq.category.name : 'Uncategorized',
            },
        });
    } catch (err) {
        console.error('[ADMIN] Create FAQ error:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message },
        });
    }
});

/**
 * PUT /api/admin/faqs/:id
 * Update existing FAQ.
 */
router.put('/:id', async (req, res) => {
    try {
        const parseResult = updateFaqSchema.safeParse(req.body);
        if (!parseResult.success) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: parseResult.error.errors[0]?.message || 'Invalid input data',
                    details: parseResult.error.flatten(),
                },
            });
        }

        const prisma = getDbClient();
        if (!prisma) {
            return res.status(503).json({
                success: false,
                error: { code: 'DB_UNAVAILABLE', message: 'Database not available' },
            });
        }

        const restaurantId = req.user?.restaurantId || req.user?.restaurant_id || (await getDefaultRestaurantId());
        const { id } = req.params;

        const existing = await prisma.fAQ.findFirst({
            where: { id, restaurant_id: restaurantId },
        });

        if (!existing) {
            return res.status(404).json({
                success: false,
                error: { code: 'FAQ_NOT_FOUND', message: 'FAQ not found' },
            });
        }

        const {
            category_id,
            question,
            answer,
            keywords,
            alternative_questions,
            is_active,
            sort_order,
            language,
        } = parseResult.data;

        const updateData = {};

        if (category_id !== undefined) {
            if (category_id) {
                const cat = await prisma.fAQCategory.findFirst({
                    where: { id: category_id, restaurant_id: restaurantId },
                });
                if (!cat) {
                    return res.status(400).json({
                        success: false,
                        error: { code: 'INVALID_CATEGORY', message: 'Selected category does not exist for this restaurant' },
                    });
                }
                updateData.category_id = category_id;
            } else {
                updateData.category_id = null;
            }
        }

        if (question !== undefined) updateData.question = question;
        if (answer !== undefined) updateData.answer = answer;
        if (keywords !== undefined) updateData.keywords = keywords;
        if (alternative_questions !== undefined) updateData.alternative_questions = alternative_questions;
        if (is_active !== undefined) updateData.is_active = is_active;
        if (sort_order !== undefined) updateData.sort_order = sort_order;
        if (language !== undefined) updateData.language = language;

        updateData.updated_by = req.user?.username || req.user?.sub || 'admin';

        const updated = await prisma.fAQ.update({
            where: { id },
            data: updateData,
            include: {
                category: {
                    select: { id: true, name: true, slug: true, is_active: true },
                },
            },
        });

        return res.json({
            success: true,
            data: {
                ...updated,
                category_name: updated.category ? updated.category.name : 'Uncategorized',
            },
        });
    } catch (err) {
        console.error('[ADMIN] Update FAQ error:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message },
        });
    }
});

/**
 * PATCH /api/admin/faqs/:id/status
 * Toggle or set active/inactive status.
 */
router.patch('/:id/status', async (req, res) => {
    try {
        const prisma = getDbClient();
        if (!prisma) {
            return res.status(503).json({
                success: false,
                error: { code: 'DB_UNAVAILABLE', message: 'Database not available' },
            });
        }

        const restaurantId = req.user?.restaurantId || req.user?.restaurant_id || (await getDefaultRestaurantId());
        const { id } = req.params;

        const existing = await prisma.fAQ.findFirst({
            where: { id, restaurant_id: restaurantId },
        });

        if (!existing) {
            return res.status(404).json({
                success: false,
                error: { code: 'FAQ_NOT_FOUND', message: 'FAQ not found' },
            });
        }

        const newStatus = typeof req.body.is_active === 'boolean' ? req.body.is_active : !existing.is_active;

        const updated = await prisma.fAQ.update({
            where: { id },
            data: {
                is_active: newStatus,
                updated_by: req.user?.username || req.user?.sub || 'admin',
            },
        });

        return res.json({
            success: true,
            data: { id: updated.id, is_active: updated.is_active },
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message },
        });
    }
});

/**
 * DELETE /api/admin/faqs/:id
 * Delete FAQ.
 */
router.delete('/:id', async (req, res) => {
    try {
        const prisma = getDbClient();
        if (!prisma) {
            return res.status(503).json({
                success: false,
                error: { code: 'DB_UNAVAILABLE', message: 'Database not available' },
            });
        }

        const restaurantId = req.user?.restaurantId || req.user?.restaurant_id || (await getDefaultRestaurantId());
        const { id } = req.params;

        const existing = await prisma.fAQ.findFirst({
            where: { id, restaurant_id: restaurantId },
        });

        if (!existing) {
            return res.status(404).json({
                success: false,
                error: { code: 'FAQ_NOT_FOUND', message: 'FAQ not found' },
            });
        }

        await prisma.fAQ.delete({
            where: { id },
        });

        return res.json({
            success: true,
            message: 'FAQ deleted successfully',
            data: { id },
        });
    } catch (err) {
        console.error('[ADMIN] Delete FAQ error:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message },
        });
    }
});

export default router;
