import express from 'express';
import { getDbClient } from '../../src/db/client.js';
import { createCategorySchema, updateCategorySchema } from '../../src/validators/categorySchema.js';
import { slugify } from '../../src/utils/slugify.js';
import { notifyN8nSync } from '../../src/services/syncService.js';
import { getDefaultRestaurantId } from '../../src/services/restaurantService.js';
import { bumpSyncEpoch, refreshCatalogCache } from '../../src/services/catalogCacheService.js';

const router = express.Router();

/**
 * GET /api/admin/categories
 * List all categories with item count
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

        let restaurantId = req.user?.restaurantId || req.user?.restaurant_id;
        const defaultRestId = await getDefaultRestaurantId();
        const targetRestIds = Array.from(new Set([restaurantId, defaultRestId].filter(Boolean)));

        const buildWhere = (rids) => (rids && rids.length > 0 ? { restaurant_id: { in: rids } } : {});

        let categories = [];
        try {
            // Attempt 1: with targetRestIds and _count
            categories = await prisma.category.findMany({
                where: buildWhere(targetRestIds),
                orderBy: { sort_order: 'asc' },
                include: {
                    _count: {
                        select: { menu_items: true },
                    },
                },
            });
            // If scoped restaurant has no categories, fallback to all categories
            if ((!categories || categories.length === 0) && restaurantId) {
                categories = await prisma.category.findMany({
                    where: {},
                    orderBy: { sort_order: 'asc' },
                    include: {
                        _count: {
                            select: { menu_items: true },
                        },
                    },
                });
            }
        } catch (queryErr) {
            console.warn('[ADMIN] Categories query with _count failed, trying fallback without _count:', queryErr.message);
            try {
                categories = await prisma.category.findMany({
                    where: buildWhere(restaurantId),
                    orderBy: { sort_order: 'asc' },
                });
                if ((!categories || categories.length === 0) && restaurantId) {
                    categories = await prisma.category.findMany({
                        where: {},
                        orderBy: { sort_order: 'asc' },
                    });
                }
            } catch (err2) {
                console.warn('[ADMIN] Final category query fallback without order:', err2.message);
                categories = await prisma.category.findMany();
            }
        }

        // Exclude deal categories from standard food categories
        const validCategories = (categories || []).filter(c => !/deals?/i.test(c.name || '') && !/deals?/i.test(c.slug || ''));

        const formatted = validCategories.map(c => ({
            id: c.id,
            name: c.name || '',
            slug: c.slug || '',
            description: c.description || '',
            image_url: c.image_url || '',
            sort_order: c.sort_order ?? 0,
            is_active: Boolean(c.is_active ?? true),
            items_count: c._count?.menu_items ?? 0,
            created_at: c.created_at || new Date(),
            updated_at: c.updated_at || new Date(),
        }));

        return res.json({ success: true, data: formatted });
    } catch (err) {
        console.error('[ADMIN] Error listing categories:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message || 'Failed to retrieve categories' },
        });
    }
});

/**
 * GET /api/admin/categories/:id
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

        let restaurantId = req.user?.restaurantId || req.user?.restaurant_id;
        if (!restaurantId) {
            try {
                restaurantId = await getDefaultRestaurantId();
            } catch (_) {}
        }

        let category = null;
        try {
            category = await prisma.category.findFirst({
                where: {
                    id: req.params.id,
                    ...(restaurantId ? { restaurant_id: restaurantId } : {}),
                },
                include: {
                    _count: { select: { menu_items: true } },
                },
            });
            if (!category && restaurantId) {
                category = await prisma.category.findFirst({
                    where: { id: req.params.id },
                    include: {
                        _count: { select: { menu_items: true } },
                    },
                });
            }
        } catch (_) {
            category = await prisma.category.findFirst({
                where: { id: req.params.id },
            });
        }

        if (!category) {
            return res.status(404).json({
                success: false,
                error: { code: 'CATEGORY_NOT_FOUND', message: 'Category not found' },
            });
        }

        return res.json({
            success: true,
            data: {
                ...category,
                items_count: category._count?.menu_items ?? 0,
            },
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message || 'Failed to retrieve category' },
        });
    }
});

/**
 * POST /api/admin/categories
 * Create new category
 */
router.post('/', async (req, res) => {
    try {
        const parseResult = createCategorySchema.safeParse(req.body);
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
        let restaurantId = req.user?.restaurantId;
        if (!restaurantId) {
            try {
                restaurantId = await getDefaultRestaurantId();
            } catch (_) {}
        }
        const { name, description, image_url, sort_order, is_active } = parseResult.data;

        const baseSlug = slugify(name);
        if (!baseSlug) {
            return res.status(400).json({
                success: false,
                error: { code: 'INVALID_NAME', message: 'Category name must contain valid characters' },
            });
        }

        // Check duplicate name or slug within restaurant
        const existing = await prisma.category.findFirst({
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
                    code: 'CATEGORY_ALREADY_EXISTS',
                    message: `A category named '${name}' or with slug '${baseSlug}' already exists`,
                },
            });
        }

        const category = await prisma.category.create({
            data: {
                restaurant_id: restaurantId || null,
                name,
                slug: baseSlug,
                description: description || null,
                image_url: image_url || null,
                sort_order,
                is_active,
            },
        });

        notifyN8nSync('category_created');
        bumpSyncEpoch();
        refreshCatalogCache().catch(() => {});

        return res.status(201).json({
            success: true,
            data: category,
        });
    } catch (err) {
        console.error('[ADMIN] Create category error:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message },
        });
    }
});

/**
 * PUT /api/admin/categories/:id
 * Update category
 */
router.put('/:id', async (req, res) => {
    try {
        const parseResult = updateCategorySchema.safeParse(req.body);
        if (!parseResult.success) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: parseResult.error.errors[0]?.message || 'Invalid input data',
                },
            });
        }

        const prisma = getDbClient();
        const restaurantId = req.user?.restaurantId;
        const categoryId = req.params.id;

        const existing = await prisma.category.findFirst({
            where: {
                id: categoryId,
                ...(restaurantId ? { restaurant_id: restaurantId } : {}),
            },
        });

        if (!existing) {
            return res.status(404).json({
                success: false,
                error: { code: 'CATEGORY_NOT_FOUND', message: 'Category not found' },
            });
        }

        const updateData = {};
        const { name, description, image_url, sort_order, is_active } = parseResult.data;

        if (name !== undefined) {
            updateData.name = name;
            const newSlug = slugify(name);

            // If name/slug changed, verify uniqueness
            if (newSlug !== existing.slug) {
                const duplicate = await prisma.category.findFirst({
                    where: {
                        restaurant_id: restaurantId,
                        slug: newSlug,
                        id: { not: categoryId },
                    },
                });
                if (duplicate) {
                    return res.status(409).json({
                        success: false,
                        error: { code: 'CATEGORY_ALREADY_EXISTS', message: `Category '${name}' already exists` },
                    });
                }
                updateData.slug = newSlug;
            }
        }

        if (description !== undefined) updateData.description = description;
        if (image_url !== undefined) updateData.image_url = (image_url && typeof image_url === 'string' && image_url.trim()) ? image_url.trim() : null;
        if (sort_order !== undefined) updateData.sort_order = sort_order;
        if (is_active !== undefined) updateData.is_active = is_active;

        const updated = await prisma.category.update({
            where: { id: categoryId },
            data: updateData,
        });

        notifyN8nSync('category_updated');
        bumpSyncEpoch();
        refreshCatalogCache().catch(() => {});

        return res.json({ success: true, data: updated });
    } catch (err) {
        console.error('[ADMIN] Update category error:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message },
        });
    }
});

/**
 * PATCH /api/admin/categories/:id/status
 * Toggle active status
 */
router.patch('/:id/status', async (req, res) => {
    try {
        const prisma = getDbClient();
        const restaurantId = req.user?.restaurantId;
        const categoryId = req.params.id;

        const category = await prisma.category.findFirst({
            where: {
                id: categoryId,
                ...(restaurantId ? { restaurant_id: restaurantId } : {}),
            },
        });

        if (!category) {
            return res.status(404).json({
                success: false,
                error: { code: 'CATEGORY_NOT_FOUND', message: 'Category not found' },
            });
        }

        const newStatus = typeof req.body.is_active === 'boolean'
            ? req.body.is_active
            : !category.is_active;

        const updated = await prisma.category.update({
            where: { id: categoryId },
            data: { is_active: newStatus },
        });

        notifyN8nSync('category_status_changed');
        bumpSyncEpoch();
        refreshCatalogCache().catch(() => {});

        return res.json({ success: true, data: updated });
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message },
        });
    }
});

/**
 * POST /api/admin/categories/delete-all
 * DELETE /api/admin/categories/delete-all
 * Delete all categories and their items, variants, cart items, deal item links
 */
const handleDeleteAllCategories = async (req, res) => {
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
        await prisma.menuItem.deleteMany({
            where: { restaurant_id: restaurantId },
        });
        const result = await prisma.category.deleteMany({
            where: { restaurant_id: restaurantId },
        });

        const { bumpSyncEpoch, refreshCatalogCache } = await import('../../src/services/catalogCacheService.js');
        bumpSyncEpoch();
        await refreshCatalogCache();

        return res.json({
            success: true,
            count: result.count,
            message: `Successfully deleted all ${result.count} categories`,
        });
    } catch (err) {
        console.error('[ADMIN] Failed to delete all categories:', err);
        return res.status(500).json({ success: false, error: { code: 'DELETE_ALL_ERROR', message: err.message } });
    }
};

router.post('/delete-all', handleDeleteAllCategories);
router.delete('/delete-all', handleDeleteAllCategories);

/**
 * DELETE /api/admin/categories/:id
 * Safe delete category (prevents deletion if menu items exist)
 */
router.delete('/:id', async (req, res) => {
    try {
        const prisma = getDbClient();
        const restaurantId = req.user?.restaurantId;
        const categoryId = req.params.id;

        const category = await prisma.category.findFirst({
            where: {
                id: categoryId,
                ...(restaurantId ? { restaurant_id: restaurantId } : {}),
            },
            include: {
                _count: { select: { menu_items: true } },
            },
        });

        if (!category) {
            return res.status(404).json({
                success: false,
                error: { code: 'CATEGORY_NOT_FOUND', message: 'Category not found' },
            });
        }

        if (category._count.menu_items > 0) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'CATEGORY_NOT_EMPTY',
                    message: `Cannot delete category '${category.name}' because it contains ${category._count.menu_items} menu item(s). Reassign or delete items first.`,
                },
            });
        }

        await prisma.category.delete({
            where: { id: categoryId },
        });

        notifyN8nSync('category_deleted');

        return res.json({
            success: true,
            data: { message: `Category '${category.name}' deleted successfully` },
        });
    } catch (err) {
        console.error('[ADMIN] Delete category error:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message },
        });
    }
});

export default router;
