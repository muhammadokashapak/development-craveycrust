import express from 'express';
import { getDbClient } from '../../src/db/client.js';
import { createMenuItemSchema, updateMenuItemSchema } from '../../src/validators/menuSchema.js';
import { slugify } from '../../src/utils/slugify.js';
import { notifyN8nSync } from '../../src/services/syncService.js';
import { bumpSyncEpoch } from '../../src/services/catalogCacheService.js';
import { calculateDiscount, getGlobalDiscountSettings, bulkApplyDiscountToAllItems } from '../../src/services/discountService.js';

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

        // If scoped restaurant has no items, fallback to global items (matching categories.js behavior)
        if ((!items || items.length === 0) && where.restaurant_id) {
            const fallbackWhere = { ...where };
            delete fallbackWhere.restaurant_id;
            try {
                items = await prisma.menuItem.findMany({
                    where: fallbackWhere,
                    include: {
                        category: { select: { id: true, name: true, slug: true } },
                        variants: {
                            orderBy: { sort_order: 'asc' },
                            select: { id: true, name: true, price: true, is_available: true, sort_order: true },
                        },
                    },
                    orderBy: [{ category: { sort_order: 'asc' } }, { name: 'asc' }],
                });
            } catch (fallbackErr) {
                items = await prisma.menuItem.findMany({
                    where: fallbackWhere,
                    include: {
                        category: { select: { id: true, name: true, slug: true } },
                        variants: {
                            select: { id: true, name: true, price: true, is_available: true, sort_order: true },
                        },
                    },
                    orderBy: [{ name: 'asc' }],
                });
            }
        }

        // Exclude deal items from menu items (deals have dedicated management tab)
        items = (items || []).filter(item => !/deals?/i.test(item.category?.name || '') && !/deals?/i.test(item.category?.slug || ''));

        const globalDiscount = await getGlobalDiscountSettings(restaurantId);

        const formatted = items.map(item => {
            const itemDiscount = calculateDiscount(
                item.base_price,
                item.discount_percent,
                item.discount_fixed,
                globalDiscount
            );

            return {
                id: item.id,
                name: item.name,
                slug: item.slug,
                description: item.description,
                base_price: Number(item.base_price),
                image_url: item.image_url,
                spicy_level: item.spicy_level,
                is_available: item.is_available,
                is_active: item.is_active,
                discount_percent: item.discount_percent !== null ? Number(item.discount_percent) : null,
                discount_fixed: item.discount_fixed !== null ? Number(item.discount_fixed) : null,
                discount_info: itemDiscount,
                category: item.category || { id: item.category_id, name: 'Uncategorized', slug: 'uncategorized' },
                category_id: item.category_id,
                variants_count: Array.isArray(item.variants) ? item.variants.length : 0,
                variants: (item.variants || []).map(v => {
                    const variantDiscount = calculateDiscount(
                        v.price,
                        v.discount_percent || item.discount_percent,
                        v.discount_fixed || item.discount_fixed,
                        globalDiscount
                    );
                    return {
                        id: v.id,
                        name: v.name,
                        price: Number(v.price),
                        discount_percent: v.discount_percent !== null ? Number(v.discount_percent) : null,
                        discount_fixed: v.discount_fixed !== null ? Number(v.discount_fixed) : null,
                        discount_info: variantDiscount,
                        is_available: v.is_available,
                        sort_order: v.sort_order,
                    };
                }),
                created_at: item.created_at,
                updated_at: item.updated_at,
            };
        });

        return res.json({
            success: true,
            data: formatted,
            meta: {
                global_discount: globalDiscount,
            },
        });
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

        const globalDiscount = await getGlobalDiscountSettings(restaurantId);
        const itemDiscount = calculateDiscount(
            item.base_price,
            item.discount_percent,
            item.discount_fixed,
            globalDiscount
        );

        return res.json({
            success: true,
            data: {
                ...item,
                base_price: Number(item.base_price),
                discount_percent: item.discount_percent !== null ? Number(item.discount_percent) : null,
                discount_fixed: item.discount_fixed !== null ? Number(item.discount_fixed) : null,
                discount_info: itemDiscount,
                variants: item.variants.map(v => ({
                    ...v,
                    price: Number(v.price),
                    discount_percent: v.discount_percent !== null ? Number(v.discount_percent) : null,
                    discount_fixed: v.discount_fixed !== null ? Number(v.discount_fixed) : null,
                    discount_info: calculateDiscount(
                        v.price,
                        v.discount_percent || item.discount_percent,
                        v.discount_fixed || item.discount_fixed,
                        globalDiscount
                    ),
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
            discount_percent,
            discount_fixed,
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
                discount_percent: discount_percent !== undefined ? discount_percent : null,
                discount_fixed: discount_fixed !== undefined ? discount_fixed : null,
            },
            include: {
                category: { select: { id: true, name: true, slug: true } },
                variants: true,
            },
        });

        bumpSyncEpoch();
        notifyN8nSync('menu_item_created');

        const globalDiscount = await getGlobalDiscountSettings(restaurantId);
        const itemDiscount = calculateDiscount(
            created.base_price,
            created.discount_percent,
            created.discount_fixed,
            globalDiscount
        );

        return res.status(201).json({
            success: true,
            data: {
                ...created,
                base_price: Number(created.base_price),
                discount_percent: created.discount_percent !== null ? Number(created.discount_percent) : null,
                discount_fixed: created.discount_fixed !== null ? Number(created.discount_fixed) : null,
                discount_info: itemDiscount,
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
            discount_percent,
            discount_fixed,
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
        if (image_url !== undefined) updateData.image_url = (image_url && typeof image_url === 'string' && image_url.trim()) ? image_url.trim() : null;
        if (spicy_level !== undefined) updateData.spicy_level = spicy_level;
        if (is_available !== undefined) updateData.is_available = is_available;
        if (is_active !== undefined) updateData.is_active = is_active;
        if (discount_percent !== undefined) updateData.discount_percent = discount_percent;
        if (discount_fixed !== undefined) updateData.discount_fixed = discount_fixed;

        const updated = await prisma.menuItem.update({
            where: { id: itemId },
            data: updateData,
            include: {
                category: { select: { id: true, name: true, slug: true } },
                variants: true,
            },
        });

        bumpSyncEpoch();
        notifyN8nSync('menu_item_updated');

        const globalDiscount = await getGlobalDiscountSettings(restaurantId);
        const itemDiscount = calculateDiscount(
            updated.base_price,
            updated.discount_percent,
            updated.discount_fixed,
            globalDiscount
        );

        return res.json({
            success: true,
            data: {
                ...updated,
                base_price: Number(updated.base_price),
                discount_percent: updated.discount_percent !== null ? Number(updated.discount_percent) : null,
                discount_fixed: updated.discount_fixed !== null ? Number(updated.discount_fixed) : null,
                discount_info: itemDiscount,
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

        bumpSyncEpoch();
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
 * POST /api/admin/menu/delete-all
 * DELETE /api/admin/menu/delete-all
 * Delete all menu items, variants, cart items, and deal item links
 */
const handleDeleteAllMenuItems = async (req, res) => {
    try {
        const prisma = getDbClient();
        if (!prisma) {
            return res.status(503).json({ success: false, error: { code: 'DB_UNAVAILABLE', message: 'Database not available' } });
        }
        const { getDefaultRestaurantId } = await import('../../src/services/restaurantService.js');
        const restaurantId = req.user?.restaurantId || await getDefaultRestaurantId();

        await prisma.cartItem.deleteMany({
            where: { cart: { restaurant_id: restaurantId } },
        });
        await prisma.dealItem.deleteMany({
            where: { deal: { restaurant_id: restaurantId } },
        });
        await prisma.menuVariant.deleteMany({
            where: { menu_item: { restaurant_id: restaurantId } },
        });
        const result = await prisma.menuItem.deleteMany({
            where: { restaurant_id: restaurantId },
        });

        bumpSyncEpoch();
        const { refreshCatalogCache } = await import('../../src/services/catalogCacheService.js');
        await refreshCatalogCache();

        return res.json({
            success: true,
            count: result.count,
            message: `Successfully deleted all ${result.count} menu items`,
        });
    } catch (err) {
        console.error('[ADMIN] Failed to delete all menu items:', err);
        return res.status(500).json({ success: false, error: { code: 'DELETE_ALL_ERROR', message: err.message } });
    }
};

router.post('/delete-all', handleDeleteAllMenuItems);
router.delete('/delete-all', handleDeleteAllMenuItems);


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

        bumpSyncEpoch();
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

/**
 * POST /api/admin/menu/bulk-discount
 * Apply or clear discount across all menu items
 */
router.post('/bulk-discount', async (req, res) => {
    try {
        const prisma = getDbClient();
        if (!prisma) {
            return res.status(503).json({
                success: false,
                error: { code: 'DB_UNAVAILABLE', message: 'Database not available' },
            });
        }

        const restaurantId = req.user?.restaurantId;
        const discount_percent = req.body.discount_percent !== undefined ? req.body.discount_percent : req.body.discountPercent;
        const discount_fixed = req.body.discount_fixed !== undefined ? req.body.discount_fixed : req.body.discountFixed;
        const category_id = req.body.category_id !== undefined ? req.body.category_id : req.body.categoryId;

        const count = await bulkApplyDiscountToAllItems(restaurantId, {
            discountPercent: (discount_percent !== undefined && discount_percent !== '' && discount_percent !== null)
                ? Number(discount_percent)
                : null,
            discountFixed: (discount_fixed !== undefined && discount_fixed !== '' && discount_fixed !== null)
                ? Number(discount_fixed)
                : null,
            categoryId: category_id || null,
        });

        bumpSyncEpoch();
        notifyN8nSync('menu_items_bulk_discount');

        return res.json({
            success: true,
            data: {
                message: `Discount successfully applied to ${count} menu items`,
                updatedCount: count,
            },
        });
    } catch (err) {
        console.error('[ADMIN] Bulk discount error:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message },
        });
    }
});

export default router;
