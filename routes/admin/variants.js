import express from 'express';
import { getDbClient } from '../../src/db/client.js';
import { createVariantSchema, updateVariantSchema } from '../../src/validators/variantSchema.js';

const router = express.Router();

/**
 * GET /api/admin/menu/:id/variants
 * List variants for a specific menu item
 */
router.get('/menu/:id/variants', async (req, res) => {
    try {
        const prisma = getDbClient();
        const restaurantId = req.user?.restaurantId;
        const menuItemId = req.params.id;

        // Verify parent item belongs to restaurant
        const item = await prisma.menuItem.findFirst({
            where: {
                id: menuItemId,
                ...(restaurantId ? { restaurant_id: restaurantId } : {}),
            },
        });

        if (!item) {
            return res.status(404).json({
                success: false,
                error: { code: 'MENU_ITEM_NOT_FOUND', message: 'Parent menu item not found' },
            });
        }

        const variants = await prisma.menuVariant.findMany({
            where: { menu_item_id: menuItemId },
            orderBy: [{ sort_order: 'asc' }, { price: 'asc' }],
        });

        const formatted = variants.map(v => ({
            id: v.id,
            menu_item_id: v.menu_item_id,
            name: v.name,
            price: Number(v.price),
            is_available: v.is_available,
            sort_order: v.sort_order,
            created_at: v.created_at,
            updated_at: v.updated_at,
        }));

        return res.json({ success: true, data: formatted });
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message },
        });
    }
});

/**
 * POST /api/admin/menu/:id/variants
 * Add variant to menu item
 */
router.post('/menu/:id/variants', async (req, res) => {
    try {
        const parseResult = createVariantSchema.safeParse(req.body);
        if (!parseResult.success) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: parseResult.error.errors[0]?.message || 'Invalid variant data',
                },
            });
        }

        const prisma = getDbClient();
        const restaurantId = req.user?.restaurantId;
        const menuItemId = req.params.id;
        const { name, price, sort_order, is_available } = parseResult.data;

        // Verify parent item
        const item = await prisma.menuItem.findFirst({
            where: {
                id: menuItemId,
                ...(restaurantId ? { restaurant_id: restaurantId } : {}),
            },
        });

        if (!item) {
            return res.status(404).json({
                success: false,
                error: { code: 'MENU_ITEM_NOT_FOUND', message: 'Parent menu item not found' },
            });
        }

        // Check duplicate variant name for this item
        const duplicate = await prisma.menuVariant.findFirst({
            where: {
                menu_item_id: menuItemId,
                name: { equals: name, mode: 'insensitive' },
            },
        });

        if (duplicate) {
            return res.status(409).json({
                success: false,
                error: {
                    code: 'VARIANT_ALREADY_EXISTS',
                    message: `Variant '${name}' already exists for this menu item`,
                },
            });
        }

        const variant = await prisma.menuVariant.create({
            data: {
                menu_item_id: menuItemId,
                name,
                price,
                sort_order,
                is_available,
            },
        });

        return res.status(201).json({
            success: true,
            data: {
                ...variant,
                price: Number(variant.price),
            },
        });
    } catch (err) {
        console.error('[ADMIN] Create variant error:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message },
        });
    }
});

/**
 * PUT /api/admin/variants/:id
 * Update variant
 */
router.put('/:id', async (req, res) => {
    try {
        const parseResult = updateVariantSchema.safeParse(req.body);
        if (!parseResult.success) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: parseResult.error.errors[0]?.message || 'Invalid variant data',
                },
            });
        }

        const prisma = getDbClient();
        const restaurantId = req.user?.restaurantId;
        const variantId = req.params.id;

        // Verify variant belongs to restaurant
        const variant = await prisma.menuVariant.findUnique({
            where: { id: variantId },
            include: { menu_item: true },
        });

        if (!variant || (restaurantId && variant.menu_item.restaurant_id !== restaurantId)) {
            return res.status(404).json({
                success: false,
                error: { code: 'VARIANT_NOT_FOUND', message: 'Variant not found' },
            });
        }

        const updateData = {};
        const { name, price, sort_order, is_available } = parseResult.data;

        if (name !== undefined) {
            if (name.toLowerCase() !== variant.name.toLowerCase()) {
                const duplicate = await prisma.menuVariant.findFirst({
                    where: {
                        menu_item_id: variant.menu_item_id,
                        name: { equals: name, mode: 'insensitive' },
                        id: { not: variantId },
                    },
                });
                if (duplicate) {
                    return res.status(409).json({
                        success: false,
                        error: { code: 'VARIANT_ALREADY_EXISTS', message: `Variant '${name}' already exists` },
                    });
                }
            }
            updateData.name = name;
        }

        if (price !== undefined) updateData.price = price;
        if (sort_order !== undefined) updateData.sort_order = sort_order;
        if (is_available !== undefined) updateData.is_available = is_available;

        const updated = await prisma.menuVariant.update({
            where: { id: variantId },
            data: updateData,
        });

        return res.json({
            success: true,
            data: {
                ...updated,
                price: Number(updated.price),
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
 * PATCH /api/admin/variants/:id/availability
 * Toggle variant availability
 */
router.patch('/:id/availability', async (req, res) => {
    try {
        const prisma = getDbClient();
        const restaurantId = req.user?.restaurantId;
        const variantId = req.params.id;

        const variant = await prisma.menuVariant.findUnique({
            where: { id: variantId },
            include: { menu_item: true },
        });

        if (!variant || (restaurantId && variant.menu_item.restaurant_id !== restaurantId)) {
            return res.status(404).json({
                success: false,
                error: { code: 'VARIANT_NOT_FOUND', message: 'Variant not found' },
            });
        }

        const newAvailability = typeof req.body.is_available === 'boolean'
            ? req.body.is_available
            : !variant.is_available;

        const updated = await prisma.menuVariant.update({
            where: { id: variantId },
            data: { is_available: newAvailability },
        });

        return res.json({
            success: true,
            data: {
                id: updated.id,
                name: updated.name,
                is_available: updated.is_available,
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
 * DELETE /api/admin/variants/:id
 * Delete variant
 */
router.delete('/:id', async (req, res) => {
    try {
        const prisma = getDbClient();
        const restaurantId = req.user?.restaurantId;
        const variantId = req.params.id;

        const variant = await prisma.menuVariant.findUnique({
            where: { id: variantId },
            include: { menu_item: true },
        });

        if (!variant || (restaurantId && variant.menu_item.restaurant_id !== restaurantId)) {
            return res.status(404).json({
                success: false,
                error: { code: 'VARIANT_NOT_FOUND', message: 'Variant not found' },
            });
        }

        await prisma.menuVariant.delete({
            where: { id: variantId },
        });

        return res.json({
            success: true,
            data: { message: `Variant '${variant.name}' deleted successfully` },
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message },
        });
    }
});

export default router;
