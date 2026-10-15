import express from 'express';
import { getDbClient } from '../../src/db/client.js';
import { createPromotionSchema, updatePromotionSchema } from '../../src/validators/promotionSchema.js';

const router = express.Router();

/**
 * GET /api/admin/promotions
 * List all promotions with target details
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

        const restaurantId = req.user?.restaurantId;
        const promotions = await prisma.promotion.findMany({
            where: restaurantId ? { restaurant_id: restaurantId } : {},
            orderBy: [{ created_at: 'desc' }],
            include: {
                targets: true,
            },
        });

        const formatted = promotions.map(p => ({
            id: p.id,
            name: p.name,
            code: p.code,
            description: p.description,
            discount_type: p.discount_type,
            discount_value: Number(p.discount_value),
            minimum_order: p.minimum_order != null ? Number(p.minimum_order) : null,
            maximum_discount: p.maximum_discount != null ? Number(p.maximum_discount) : null,
            start_at: p.start_at,
            end_at: p.end_at,
            is_active: p.is_active,
            targets: p.targets.map(t => ({
                id: t.id,
                target_type: t.target_type,
                target_id: t.target_id,
            })),
            created_at: p.created_at,
            updated_at: p.updated_at,
        }));

        return res.json({ success: true, data: formatted });
    } catch (err) {
        console.error('[ADMIN] Error listing promotions:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve promotions' },
        });
    }
});

/**
 * POST /api/admin/promotions
 * Create a new promotion
 */
router.post('/', async (req, res) => {
    try {
        const prisma = getDbClient();
        if (!prisma) {
            return res.status(503).json({
                success: false,
                error: { code: 'DB_UNAVAILABLE', message: 'Database not available' },
            });
        }

        const restaurantId = req.user?.restaurantId;
        const parsed = createPromotionSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: parsed.error.errors[0]?.message || 'Invalid promotion input',
                    details: parsed.error.errors,
                },
            });
        }

        const {
            name,
            code,
            description,
            discount_type,
            discount_value,
            minimum_order,
            maximum_discount,
            start_at,
            end_at,
            is_active,
            targets,
        } = parsed.data;

        const cleanCode = code?.trim() ? code.trim().toUpperCase() : null;

        // Check for duplicate promo code if code provided
        if (cleanCode) {
            const existingCode = await prisma.promotion.findFirst({
                where: {
                    restaurant_id: restaurantId,
                    code: cleanCode,
                },
            });
            if (existingCode) {
                return res.status(400).json({
                    success: false,
                    error: { code: 'DUPLICATE_PROMO_CODE', message: `Promo code '${cleanCode}' already exists` },
                });
            }
        }

        const newPromo = await prisma.promotion.create({
            data: {
                restaurant_id: restaurantId,
                name: name.trim(),
                code: cleanCode,
                description: description?.trim() || null,
                discount_type: discount_type || 'PERCENTAGE',
                discount_value,
                minimum_order: minimum_order != null ? minimum_order : null,
                maximum_discount: maximum_discount != null ? maximum_discount : null,
                start_at: start_at ? new Date(start_at) : null,
                end_at: end_at ? new Date(end_at) : null,
                is_active: is_active ?? true,
                ...(targets && targets.length > 0 ? {
                    targets: {
                        create: targets.map(t => ({
                            target_type: t.target_type || 'ALL',
                            target_id: t.target_id || null,
                        })),
                    },
                } : {}),
            },
            include: {
                targets: true,
            },
        });

        return res.status(201).json({
            success: true,
            data: {
                ...newPromo,
                discount_value: Number(newPromo.discount_value),
                minimum_order: newPromo.minimum_order != null ? Number(newPromo.minimum_order) : null,
                maximum_discount: newPromo.maximum_discount != null ? Number(newPromo.maximum_discount) : null,
            },
        });
    } catch (err) {
        console.error('[ADMIN] Error creating promotion:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Failed to create promotion' },
        });
    }
});

/**
 * GET /api/admin/promotions/:id
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

        const restaurantId = req.user?.restaurantId;
        const promo = await prisma.promotion.findFirst({
            where: {
                id: req.params.id,
                ...(restaurantId ? { restaurant_id: restaurantId } : {}),
            },
            include: { targets: true },
        });

        if (!promo) {
            return res.status(404).json({
                success: false,
                error: { code: 'PROMOTION_NOT_FOUND', message: 'Promotion not found' },
            });
        }

        return res.json({
            success: true,
            data: {
                ...promo,
                discount_value: Number(promo.discount_value),
                minimum_order: promo.minimum_order != null ? Number(promo.minimum_order) : null,
                maximum_discount: promo.maximum_discount != null ? Number(promo.maximum_discount) : null,
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
 * PUT /api/admin/promotions/:id
 */
router.put('/:id', async (req, res) => {
    try {
        const prisma = getDbClient();
        if (!prisma) {
            return res.status(503).json({
                success: false,
                error: { code: 'DB_UNAVAILABLE', message: 'Database not available' },
            });
        }

        const restaurantId = req.user?.restaurantId;
        const parsed = updatePromotionSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: parsed.error.errors[0]?.message || 'Invalid input data',
                },
            });
        }

        const existing = await prisma.promotion.findFirst({
            where: { id: req.params.id, ...(restaurantId ? { restaurant_id: restaurantId } : {}) },
        });
        if (!existing) {
            return res.status(404).json({
                success: false,
                error: { code: 'PROMOTION_NOT_FOUND', message: 'Promotion not found' },
            });
        }

        const updateData = {};
        if (parsed.data.name !== undefined) updateData.name = parsed.data.name.trim();
        if (parsed.data.code !== undefined) {
            const cleanCode = parsed.data.code?.trim() ? parsed.data.code.trim().toUpperCase() : null;
            if (cleanCode && cleanCode !== existing.code) {
                const dup = await prisma.promotion.findFirst({
                    where: { restaurant_id: restaurantId, code: cleanCode, id: { not: existing.id } },
                });
                if (dup) {
                    return res.status(400).json({
                        success: false,
                        error: { code: 'DUPLICATE_PROMO_CODE', message: `Promo code '${cleanCode}' already exists` },
                    });
                }
            }
            updateData.code = cleanCode;
        }
        if (parsed.data.description !== undefined) updateData.description = parsed.data.description?.trim() || null;
        if (parsed.data.discount_type !== undefined) updateData.discount_type = parsed.data.discount_type;
        if (parsed.data.discount_value !== undefined) updateData.discount_value = parsed.data.discount_value;
        if (parsed.data.minimum_order !== undefined) updateData.minimum_order = parsed.data.minimum_order;
        if (parsed.data.maximum_discount !== undefined) updateData.maximum_discount = parsed.data.maximum_discount;
        if (parsed.data.start_at !== undefined) updateData.start_at = parsed.data.start_at ? new Date(parsed.data.start_at) : null;
        if (parsed.data.end_at !== undefined) updateData.end_at = parsed.data.end_at ? new Date(parsed.data.end_at) : null;
        if (parsed.data.is_active !== undefined) updateData.is_active = parsed.data.is_active;

        // If targets are provided, replace them
        if (parsed.data.targets) {
            await prisma.promotionTarget.deleteMany({ where: { promotion_id: existing.id } });
            await prisma.promotionTarget.createMany({
                data: parsed.data.targets.map(t => ({
                    promotion_id: existing.id,
                    target_type: t.target_type || 'ALL',
                    target_id: t.target_id || null,
                })),
            });
        }

        const updated = await prisma.promotion.update({
            where: { id: req.params.id },
            data: updateData,
            include: { targets: true },
        });

        return res.json({
            success: true,
            data: {
                ...updated,
                discount_value: Number(updated.discount_value),
                minimum_order: updated.minimum_order != null ? Number(updated.minimum_order) : null,
                maximum_discount: updated.maximum_discount != null ? Number(updated.maximum_discount) : null,
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
 * PATCH /api/admin/promotions/:id/status
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

        const restaurantId = req.user?.restaurantId;
        const promo = await prisma.promotion.findFirst({
            where: { id: req.params.id, ...(restaurantId ? { restaurant_id: restaurantId } : {}) },
        });

        if (!promo) {
            return res.status(404).json({
                success: false,
                error: { code: 'PROMOTION_NOT_FOUND', message: 'Promotion not found' },
            });
        }

        const newStatus = typeof req.body.is_active === 'boolean' ? req.body.is_active : !promo.is_active;
        const updated = await prisma.promotion.update({
            where: { id: req.params.id },
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
 * DELETE /api/admin/promotions/:id
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

        const restaurantId = req.user?.restaurantId;
        const promo = await prisma.promotion.findFirst({
            where: { id: req.params.id, ...(restaurantId ? { restaurant_id: restaurantId } : {}) },
        });

        if (!promo) {
            return res.status(404).json({
                success: false,
                error: { code: 'PROMOTION_NOT_FOUND', message: 'Promotion not found' },
            });
        }

        await prisma.promotion.delete({ where: { id: req.params.id } });

        return res.json({
            success: true,
            data: { id: req.params.id, message: 'Promotion deleted successfully' },
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message },
        });
    }
});

export default router;
