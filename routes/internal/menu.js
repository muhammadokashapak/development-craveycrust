import express from 'express';
import { getDbClient } from '../../src/db/client.js';
import { getDefaultRestaurantId } from '../../src/services/restaurantService.js';

const router = express.Router();

/**
 * GET /api/internal/menu
 * Returns active categories with active items and available variants.
 * Clean, bot-friendly response.
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

        let restaurantId;
        try {
            restaurantId = await getDefaultRestaurantId();
        } catch (_) {}

        // Query active categories containing active, available items
        const categories = await prisma.category.findMany({
            where: {
                ...(restaurantId ? { restaurant_id: restaurantId } : {}),
                is_active: true,
            },
            orderBy: { sort_order: 'asc' },
            include: {
                menu_items: {
                    where: {
                        is_active: true,
                        is_available: true,
                    },
                    orderBy: { name: 'asc' },
                    include: {
                        variants: {
                            where: { is_available: true },
                            orderBy: { sort_order: 'asc' },
                        },
                    },
                },
            },
        });

        const formattedCategories = categories.map(cat => ({
            id: cat.id,
            name: cat.name,
            slug: cat.slug,
            description: cat.description || '',
            items: cat.menu_items.map(item => ({
                id: item.id,
                name: item.name,
                slug: item.slug,
                description: item.description || '',
                basePrice: Number(item.base_price),
                available: item.is_available,
                spicyLevel: item.spicy_level,
                imageUrl: item.image_url || '',
                variants: item.variants.map(v => ({
                    id: v.id,
                    name: v.name,
                    price: Number(v.price),
                    available: v.is_available,
                })),
            })),
        }));

        return res.json({
            success: true,
            data: {
                restaurant_id: restaurantId,
                categories: formattedCategories,
            },
        });
    } catch (err) {
        console.error('[INTERNAL] Error retrieving menu:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve menu' },
        });
    }
});

/**
 * GET /api/internal/menu/categories
 * Returns active categories only
 */
router.get('/categories', async (req, res) => {
    try {
        const prisma = getDbClient();
        if (!prisma) {
            return res.status(503).json({
                success: false,
                error: { code: 'DB_UNAVAILABLE', message: 'Database not available' },
            });
        }

        let restaurantId;
        try {
            restaurantId = await getDefaultRestaurantId();
        } catch (_) {}
        const categories = await prisma.category.findMany({
            where: {
                ...(restaurantId ? { restaurant_id: restaurantId } : {}),
                is_active: true,
            },
            orderBy: { sort_order: 'asc' },
            select: {
                id: true,
                name: true,
                slug: true,
                description: true,
                sort_order: true,
            },
        });

        return res.json({
            success: true,
            data: categories,
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message },
        });
    }
});

/**
 * GET /api/internal/menu/search?q=
 * Search active & available menu items
 */
router.get('/search', async (req, res) => {
    try {
        const prisma = getDbClient();
        if (!prisma) {
            return res.status(503).json({
                success: false,
                error: { code: 'DB_UNAVAILABLE', message: 'Database not available' },
            });
        }

        const rawQuery = (req.query.q || req.query.query || '').trim();
        const rawLimit = parseInt(req.query.limit, 10);
        const limitNum = (!isNaN(rawLimit) && rawLimit > 0) ? Math.min(rawLimit, 500) : 200;

        // ── FULL CATALOG MODE ──────────────────────────────────────────────────
        // When q is empty, return ALL active+available menu items so n8n cache
        // can be fully populated in a single call (no item is ever skipped).
        if (!rawQuery) {
            let restaurantId;
            try {
                restaurantId = await getDefaultRestaurantId();
            } catch (_) {}
            const allItems = await prisma.menuItem.findMany({
                where: {
                    ...(restaurantId ? { restaurant_id: restaurantId } : {}),
                    is_active: true,
                    is_available: true,
                    category: { is_active: true },
                },
                include: {
                    category: { select: { id: true, name: true } },
                    variants: {
                        where: { is_available: true },
                        orderBy: { sort_order: 'asc' },
                    },
                },
                orderBy: [{ category: { sort_order: 'asc' } }, { name: 'asc' }],
                take: limitNum,
            });

            const formatted = allItems.map(item => ({
                id: item.id,
                name: item.name,
                description: item.description || '',
                category: item.category?.name || '',
                categoryId: item.category?.id || '',
                basePrice: Number(item.base_price),
                isAvailable: item.is_available,
                variants: (item.variants || []).map(v => ({
                    id: v.id,
                    name: v.name,
                    price: Number(v.price),
                })),
            }));

            return res.json({ success: true, data: { items: formatted } });
        }

        const restaurantId = await getDefaultRestaurantId();

        // 1. Normalize size keywords and plurals so "soft drinks 1.5 liter" -> "soft drink"
        const sizeKeywords = ['small', 'medium', 'large', 'party size', 'party', 'regular', 'can', '1.5 liter', '1.5', '1 liter', '1l'];
        let cleanQuery = rawQuery.toLowerCase();
        for (const s of sizeKeywords) {
            if (cleanQuery.includes(s)) {
                cleanQuery = cleanQuery.replace(s, ' ').trim();
            }
        }
        cleanQuery = cleanQuery
            .replace(/\bdrinks\b/g, 'drink')
            .replace(/\bpizzas\b/g, 'pizza')
            .replace(/\bburgers\b/g, 'burger')
            .replace(/\s+/g, ' ')
            .trim();

        // 2. Pakistani colloquial aliases (cold drink, bottle, botal, pepsi, etc.)
        const ALIASES = {
            'cold drink': 'Soft Drink',
            'colddrink': 'Soft Drink',
            'coldrink': 'Soft Drink',
            'bottle': 'Soft Drink',
            'botal': 'Soft Drink',
            'bottles': 'Soft Drink',
            'pepsi': 'Soft Drink',
            'coke': 'Soft Drink',
            'coca cola': 'Soft Drink',
            '7up': 'Soft Drink',
            'seven up': 'Soft Drink',
            'sprite': 'Soft Drink',
            'mirinda': 'Soft Drink',
            'marinda': 'Soft Drink',
            'dew': 'Soft Drink',
            'mountain dew': 'Soft Drink',
            'pani': 'Mineral Water',
            'paani': 'Mineral Water',
            'water': 'Mineral Water',
            'chips': 'Fries',
            'finger chips': 'Fries',
        };

        const searchTerms = [cleanQuery, rawQuery.toLowerCase()].filter(Boolean);
        for (const [alias, canonical] of Object.entries(ALIASES)) {
            if (cleanQuery.includes(alias) || rawQuery.toLowerCase().includes(alias)) {
                searchTerms.unshift(canonical);
                break;
            }
        }

        const searchWords = cleanQuery.split(' ').filter(w => w.length > 2);

        // Build OR conditions: match by item name, variant name, category name, or description
        const orConditions = [];
        for (const term of searchTerms) {
            orConditions.push({ name: { contains: term, mode: 'insensitive' } });
            orConditions.push({ category: { name: { contains: term, mode: 'insensitive' } } });
            orConditions.push({ variants: { some: { name: { contains: term, mode: 'insensitive' } } } });
        }
        for (const word of searchWords) {
            orConditions.push({ name: { contains: word, mode: 'insensitive' } });
            orConditions.push({ category: { name: { contains: word, mode: 'insensitive' } } });
        }
        if (cleanQuery) {
            orConditions.push({ description: { contains: cleanQuery, mode: 'insensitive' } });
        }

        // Search active items across name, category, and description
        const items = await prisma.menuItem.findMany({
            where: {
                ...(restaurantId ? { restaurant_id: restaurantId } : {}),
                is_active: true,
                is_available: true,
                category: { is_active: true },
                AND: [
                    { OR: orConditions },
                ],
            },
            include: {
                category: { select: { id: true, name: true } },
                variants: {
                    where: { is_available: true },
                    orderBy: { sort_order: 'asc' },
                },
            },
            orderBy: [{ category: { sort_order: 'asc' } }, { name: 'asc' }],
            take: limitNum,
        });

        const formatted = items.map(item => ({
            id: item.id,
            name: item.name,
            description: item.description || '',
            category: item.category?.name || '',
            basePrice: Number(item.base_price),
            variants: (item.variants || []).map(v => ({
                id: v.id,
                name: v.name,
                price: Number(v.price),
            })),
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
 * GET /api/internal/menu/:id
 * Retrieve single active menu item by ID or slug
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
        const idOrSlug = req.params.id;

        const item = await prisma.menuItem.findFirst({
            where: {
                restaurant_id: restaurantId,
                is_active: true,
                is_available: true,
                category: { is_active: true },
                OR: [
                    { id: idOrSlug },
                    { slug: idOrSlug },
                ],
            },
            include: {
                category: { select: { id: true, name: true, slug: true } },
                variants: {
                    where: { is_available: true },
                    orderBy: { sort_order: 'asc' },
                },
            },
        });

        if (!item) {
            return res.status(404).json({
                success: false,
                error: { code: 'ITEM_NOT_FOUND', message: 'Menu item not found or unavailable' },
            });
        }

        return res.json({
            success: true,
            data: {
                id: item.id,
                name: item.name,
                slug: item.slug,
                description: item.description || '',
                category: item.category.name,
                basePrice: Number(item.base_price),
                available: item.is_available,
                imageUrl: item.image_url || '',
                variants: item.variants.map(v => ({
                    id: v.id,
                    name: v.name,
                    price: Number(v.price),
                    available: v.is_available,
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

export default router;
