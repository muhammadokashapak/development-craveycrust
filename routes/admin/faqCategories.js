import express from 'express';
import { getDbClient } from '../../src/db/client.js';
import { getDefaultRestaurantId } from '../../src/services/restaurantService.js';
import { createFaqCategorySchema, updateFaqCategorySchema } from '../../src/validators/faqCategorySchema.js';
import { slugify } from '../../src/utils/slugify.js';

const router = express.Router();

/**
 * GET /api/admin/faq-categories
 * List all FAQ categories for the restaurant with FAQ counts.
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
        const categories = await prisma.fAQCategory.findMany({
            where: { restaurant_id: restaurantId },
            orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
            include: {
                _count: {
                    select: { faqs: true },
                },
            },
        });

        const formatted = categories.map((c) => ({
            id: c.id,
            restaurant_id: c.restaurant_id,
            name: c.name,
            slug: c.slug,
            description: c.description,
            sort_order: c.sort_order,
            is_active: c.is_active,
            faqs_count: c._count.faqs,
            created_at: c.created_at,
            updated_at: c.updated_at,
        }));

        return res.json({ success: true, data: formatted });
    } catch (err) {
        console.error('[ADMIN] Error listing FAQ categories:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve FAQ categories' },
        });
    }
});

/**
 * GET /api/admin/faq-categories/:id
 * Retrieve a specific FAQ category by ID.
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
        const category = await prisma.fAQCategory.findFirst({
            where: {
                id: req.params.id,
                restaurant_id: restaurantId,
            },
            include: {
                _count: { select: { faqs: true } },
            },
        });

        if (!category) {
            return res.status(404).json({
                success: false,
                error: { code: 'CATEGORY_NOT_FOUND', message: 'FAQ category not found' },
            });
        }

        return res.json({
            success: true,
            data: {
                ...category,
                faqs_count: category._count.faqs,
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
 * POST /api/admin/faq-categories
 * Create new FAQ category.
 */
router.post('/', async (req, res) => {
    try {
        const parseResult = createFaqCategorySchema.safeParse(req.body);
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
        const { name, description, sort_order, is_active } = parseResult.data;

        const baseSlug = slugify(name);
        if (!baseSlug) {
            return res.status(400).json({
                success: false,
                error: { code: 'INVALID_NAME', message: 'Category name must contain valid characters' },
            });
        }

        // Check duplicate name or slug within restaurant
        const existing = await prisma.fAQCategory.findFirst({
            where: {
                restaurant_id: restaurantId,
                OR: [
                    { slug: baseSlug },
                    { name: { equals: name, mode: 'insensitive' } },
                ],
            },
        });

        if (existing) {
            return res.status(409).json({
                success: false,
                error: {
                    code: 'CATEGORY_ALREADY_EXISTS',
                    message: `An FAQ category named '${name}' or with slug '${baseSlug}' already exists`,
                },
            });
        }

        const category = await prisma.fAQCategory.create({
            data: {
                restaurant_id: restaurantId,
                name,
                slug: baseSlug,
                description: description || null,
                sort_order,
                is_active,
            },
        });

        return res.status(201).json({
            success: true,
            data: category,
        });
    } catch (err) {
        console.error('[ADMIN] Create FAQ category error:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message },
        });
    }
});

/**
 * PUT /api/admin/faq-categories/:id
 * Update FAQ category.
 */
router.put('/:id', async (req, res) => {
    try {
        const parseResult = updateFaqCategorySchema.safeParse(req.body);
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

        const existing = await prisma.fAQCategory.findFirst({
            where: { id, restaurant_id: restaurantId },
        });

        if (!existing) {
            return res.status(404).json({
                success: false,
                error: { code: 'CATEGORY_NOT_FOUND', message: 'FAQ category not found' },
            });
        }

        const { name, description, sort_order, is_active } = parseResult.data;
        const updateData = {};

        if (name !== undefined) {
            const newSlug = slugify(name);
            const duplicate = await prisma.fAQCategory.findFirst({
                where: {
                    restaurant_id: restaurantId,
                    id: { not: id },
                    OR: [
                        { slug: newSlug },
                        { name: { equals: name, mode: 'insensitive' } },
                    ],
                },
            });
            if (duplicate) {
                return res.status(409).json({
                    success: false,
                    error: {
                        code: 'CATEGORY_ALREADY_EXISTS',
                        message: `Another FAQ category with name '${name}' already exists`,
                    },
                });
            }
            updateData.name = name;
            updateData.slug = newSlug;
        }

        if (description !== undefined) updateData.description = description || null;
        if (sort_order !== undefined) updateData.sort_order = sort_order;
        if (is_active !== undefined) updateData.is_active = is_active;

        const updated = await prisma.fAQCategory.update({
            where: { id },
            data: updateData,
        });

        return res.json({ success: true, data: updated });
    } catch (err) {
        console.error('[ADMIN] Update FAQ category error:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message },
        });
    }
});

/**
 * PATCH /api/admin/faq-categories/:id/status
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

        const existing = await prisma.fAQCategory.findFirst({
            where: { id, restaurant_id: restaurantId },
        });

        if (!existing) {
            return res.status(404).json({
                success: false,
                error: { code: 'CATEGORY_NOT_FOUND', message: 'FAQ category not found' },
            });
        }

        const newStatus = typeof req.body.is_active === 'boolean' ? req.body.is_active : !existing.is_active;

        const updated = await prisma.fAQCategory.update({
            where: { id },
            data: { is_active: newStatus },
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
 * DELETE /api/admin/faq-categories/:id
 * Safe deletion: block if FAQs exist unless force=true or reassign=null.
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

        const category = await prisma.fAQCategory.findFirst({
            where: { id, restaurant_id: restaurantId },
            include: { _count: { select: { faqs: true } } },
        });

        if (!category) {
            return res.status(404).json({
                success: false,
                error: { code: 'CATEGORY_NOT_FOUND', message: 'FAQ category not found' },
            });
        }

        const count = category._count.faqs;
        const force = req.query.force === 'true' || req.query.reassign === 'null';

        if (count > 0 && !force) {
            return res.status(409).json({
                success: false,
                error: {
                    code: 'CATEGORY_IN_USE',
                    message: `Cannot delete category because ${count} FAQ(s) depend on it. Reassign or remove them first, or pass force=true.`,
                    faqs_count: count,
                },
            });
        }

        // If force is requested and faqs exist, unassign them safely first
        if (count > 0 && force) {
            await prisma.fAQ.updateMany({
                where: { category_id: id },
                data: { category_id: null },
            });
        }

        await prisma.fAQCategory.delete({
            where: { id },
        });

        return res.json({
            success: true,
            message: 'FAQ category deleted successfully',
            data: { id, unassigned_faqs: count },
        });
    } catch (err) {
        console.error('[ADMIN] Delete FAQ category error:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message },
        });
    }
});

export default router;
