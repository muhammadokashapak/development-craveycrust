import express from 'express';
import { getDbClient } from '../../src/db/client.js';
import { createMenuItemSchema, updateMenuItemSchema } from '../../src/validators/menuSchema.js';
import { slugify } from '../../src/utils/slugify.js';
import { notifyN8nSync } from '../../src/services/syncService.js';

const router = express.Router();

/**
 * GET /api/admin/menu
 * List menu items with filters (category, available, search)
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
        const { category_id, available, search } = req.query;

        const where = {
            ...(restaurantId ? { restaurant_id: restaurantId } : {}),
        };

        if (category_id) {
            where.category_id = category_id;
        }

        if (available !== undefined && available !== '') {
            where.is_available = available === 'true' || available === '1';
        }

        if (search && search.trim()) {
            where.OR = [
                { name: { contains: search.trim(), mode: 'insensitive' } },
                { description: { contains: search.trim(), mode: 'insensitive' } },
            ];
        }

        let items;
        try {
            items = await prisma.menuItem.findMany({
                where,
                include: {
                    category: { select: { id: true, name: true, slug: true } },
                    variants: {
                        orderBy: { sort_order: 'asc' },
                        select: { id: true, name: true, price: true, is_available: true, sort_order: true },
                    },
                },
                orderBy: [{ category: { sort_order: 'asc' } }, { name: 'asc' }],
            });
        } catch (orderErr) {
            console.warn('[ADMIN] Falling back to standard name sort for menu items:', orderErr.message);
            items = await prisma.menuItem.findMany({
                where,
                include: {
                    category: { select: { id: true, name: true, slug: true } },
                    variants: {
                        select: { id: true, name: true, price: true, is_available: true, sort_order: true },
                    },
                },
                orderBy: [{ name: 'asc' }],
            });
        }

        const formatted = items.map(item => ({
            id: item.id,
            name: item.name,
            slug: item.slug,
            description: item.description,
            base_price: Number(item.base_price),
            image_url: item.image_url,
            spicy_level: item.spicy_level,
            is_available: item.is_available,
            is_active: item.is_active,
            category: item.category || { id: item.category_id, name: 'Uncategorized', slug: 'uncategorized' },
            category_id: item.category_id,
            variants_count: Array.isArray(item.variants) ? item.variants.length : 0,
            variants: (item.variants || []).map(v => ({
                id: v.id,
                name: v.name,
                price: Number(v.price),
                is_available: v.is_available,
                sort_order: v.sort_order,
            })),
            created_at: item.created_at,
            updated_at: item.updated_at,
        }));

        return res.json({ success: true, data: formatted });
    } catch (err) {
        console.error('[ADMIN] Error listing menu items:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message || 'Failed to retrieve menu items' },
        });
    }
});

/**
 * GET /api/admin/menu/:id
 * Get single menu item with variants
 */
router.get('/:id', async (req, res) => {
    try {
        const prisma = getDbClient();
        const restaurantId = req.user?.restaurantId;

        const item = await prisma.menuItem.findFirst({
            where: {
                id: req.params.id,
                ...(restaurantId ? { restaurant_id: restaurantId } : {}),
            },
            include: {
                category: { select: { id: true, name: true, slug: true } },
                variants: {
                    orderBy: { sort_order: 'asc' },
                },
            },
        });

        if (!item) {
            return res.status(404).json({
                success: false,
                error: { code: 'MENU_ITEM_NOT_FOUND', message: 'Menu item not found' },
            });
        }

        return res.json({
            success: true,
            data: {
                ...item,
                base_price: Number(item.base_price),
                variants: item.variants.map(v => ({
                    ...v,
                    price: Number(v.price),
                })),
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
 * POST /api/admin/menu
 * Create new menu item
 */
router.post('/', async (req, res) => {
    try {
        const parseResult = createMenuItemSchema.safeParse(req.body);
        if (!parseResult.success) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: parseResult.error.errors[0]?.message || 'Invalid menu item data',
                    details: parseResult.error.flatten(),
                },
            });
        }

        const prisma = getDbClient();
        let restaurantId = req.user?.restaurantId;
        if (!restaurantId) {
            try {
                const { getDefaultRestaurantId } = await import('../../src/services/restaurantService.js');
                restaurantId = await getDefaultRestaurantId();
            } catch (_) {}
        }

        const {
            name,
            category_id,
            description,
            base_price,
            image_url,
            spicy_level,
            is_available,
            is_active,
        } = parseResult.data;

        // Verify category exists
        const category = await prisma.category.findFirst({
            where: {
                id: category_id,
                ...(restaurantId ? { restaurant_id: restaurantId } : {}),
            },
        });

        if (!category) {
            return res.status(400).json({
                success: false,
                error: { code: 'CATEGORY_NOT_FOUND', message: 'Specified category does not exist' },
            });
        }

        const baseSlug = slugify(name);
        if (!baseSlug) {
            return res.status(400).json({
                success: false,
                error: { code: 'INVALID_NAME', message: 'Item name must contain valid characters' },
            });
        }

        // Check duplicate name or slug in restaurant
        const existing = await prisma.menuItem.findFirst({
            where: {
                ...(restaurantId ? { restaurant_id: restaurantId } : {}),
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
                    code: 'MENU_ITEM_ALREADY_EXISTS',
                    message: `A menu item named '${name}' or with slug '${baseSlug}' already exists`,
                },
            });
        }

        const created = await prisma.menuItem.create({
            data: {
                restaurant_id: restaurantId,
                category_id,
                name,
                slug: baseSlug,
                description: description || null,
                base_price,
                image_url: image_url || null,
                spicy_level,
                is_available,
                is_active,
            },
            include: {
                category: { select: { id: true, name: true, slug: true } },
                variants: true,
            },
        });

        notifyN8nSync('menu_item_created');

        return res.status(201).json({
            success: true,
            data: {
                ...created,
                base_price: Number(created.base_price),
            },
        });
    } catch (err) {
        console.error('[ADMIN] Create menu item error:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message },
        });
    }
});

/**
 * PUT /api/admin/menu/:id
 * Update menu item
 */
router.put('/:id', async (req, res) => {
    try {
        const parseResult = updateMenuItemSchema.safeParse(req.body);
        if (!parseResult.success) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: parseResult.error.errors[0]?.message || 'Invalid menu item data',
                },
            });
        }

        const prisma = getDbClient();
        const restaurantId = req.user?.restaurantId;
        const itemId = req.params.id;

        const existing = await prisma.menuItem.findFirst({
            where: {
                id: itemId,
                ...(restaurantId ? { restaurant_id: restaurantId } : {}),
            },
        });

        if (!existing) {
            return res.status(404).json({
                success: false,
                error: { code: 'MENU_ITEM_NOT_FOUND', message: 'Menu item not found' },
            });
        }

        const updateData = {};
        const {
            name,
            category_id,
            description,
            base_price,
            image_url,
            spicy_level,
            is_available,
            is_active,
        } = parseResult.data;

        if (category_id !== undefined && category_id !== existing.category_id) {
            const category = await prisma.category.findFirst({
                where: {
                    id: category_id,
                    ...(restaurantId ? { restaurant_id: restaurantId } : {}),
                },
            });
            if (!category) {
                return res.status(400).json({
                    success: false,
                    error: { code: 'CATEGORY_NOT_FOUND', message: 'Specified category does not exist' },
                });
            }
            updateData.category_id = category_id;
        }

        if (name !== undefined) {
            updateData.name = name;
            const newSlug = slugify(name);
            if (newSlug !== existing.slug) {
                const duplicate = await prisma.menuItem.findFirst({
                    where: {
                        restaurant_id: restaurantId,
                        slug: newSlug,
                        id: { not: itemId },
                    },
                });
                if (duplicate) {
                    return res.status(409).json({
                        success: false,
                        error: { code: 'MENU_ITEM_ALREADY_EXISTS', message: `Menu item '${name}' already exists` },
                    });
                }
                updateData.slug = newSlug;
            }
        }

        if (description !== undefined) updateData.description = description;
        if (base_price !== undefined) updateData.base_price = base_price;
        if (image_url !== undefined) updateData.image_url = image_url;
        if (spicy_level !== undefined) updateData.spicy_level = spicy_level;
        if (is_available !== undefined) updateData.is_available = is_available;
        if (is_active !== undefined) updateData.is_active = is_active;

        const updated = await prisma.menuItem.update({
            where: { id: itemId },
            data: updateData,
            include: {
                category: { select: { id: true, name: true, slug: true } },
                variants: true,
            },
        });

        notifyN8nSync('menu_item_updated');

        return res.json({
            success: true,
            data: {
                ...updated,
                base_price: Number(updated.base_price),
            },
        });
    } catch (err) {
        console.error('[ADMIN] Update menu item error:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message },
        });
    }
});

/**
 * PATCH /api/admin/menu/:id/availability
 * Quick toggle availability
 */
router.patch('/:id/availability', async (req, res) => {
    try {
        const prisma = getDbClient();
        const restaurantId = req.user?.restaurantId;
        const itemId = req.params.id;

        const item = await prisma.menuItem.findFirst({
            where: {
                id: itemId,
                ...(restaurantId ? { restaurant_id: restaurantId } : {}),
            },
        });

        if (!item) {
            return res.status(404).json({
                success: false,
                error: { code: 'MENU_ITEM_NOT_FOUND', message: 'Menu item not found' },
            });
        }

        const newAvailability = typeof req.body.is_available === 'boolean'
            ? req.body.is_available
            : !item.is_available;

        const updated = await prisma.menuItem.update({
            where: { id: itemId },
            data: { is_available: newAvailability },
        });

        notifyN8nSync('menu_item_availability_changed');

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
 * DELETE /api/admin/menu/:id
 * Delete menu item and associated variants
 */
router.delete('/:id', async (req, res) => {
    try {
        const prisma = getDbClient();
        const restaurantId = req.user?.restaurantId;
        const itemId = req.params.id;

        const item = await prisma.menuItem.findFirst({
            where: {
                id: itemId,
                ...(restaurantId ? { restaurant_id: restaurantId } : {}),
            },
        });

        if (!item) {
            return res.status(404).json({
                success: false,
                error: { code: 'MENU_ITEM_NOT_FOUND', message: 'Menu item not found' },
            });
        }

        await prisma.menuItem.delete({
            where: { id: itemId },
        });

        notifyN8nSync('menu_item_deleted');

        return res.json({
            success: true,
            data: { message: `Menu item '${item.name}' deleted successfully` },
        });
    } catch (err) {
        console.error('[ADMIN] Delete menu item error:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message },
        });
    }
});

export default router;
