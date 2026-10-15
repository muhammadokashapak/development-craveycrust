/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║   Menu Service — src/services/menuService.js                 ║
 * ║   Authoritative Menu & Deals Data Service for WhatsApp Bot   ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Rules:
 *   - Sole authoritative service for menu, category, variant, and deal retrieval.
 *   - Never reads prices or items from FAQ.
 *   - Only returns active categories, active & available items, and active & available variants.
 *   - Handles category-first browsing and fuzzy item resolution without guessing.
 */

import { getDbClient } from '../db/client.js';
import { getDefaultRestaurantId } from './restaurantService.js';

/**
 * Get all active categories with their active & available items
 * @param {string} [restaurantId]
 * @returns {Promise<Array>}
 */
export async function getActiveMenu(restaurantId) {
    const prisma = getDbClient();
    if (!prisma) throw new Error('Database client not available');

    const restId = restaurantId || await getDefaultRestaurantId();

    return prisma.category.findMany({
        where: {
            restaurant_id: restId,
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
}

/**
 * Get active categories summary (for category-first browsing)
 * @param {string} [restaurantId]
 * @returns {Promise<Array>}
 */
export async function getActiveCategories(restaurantId) {
    const prisma = getDbClient();
    if (!prisma) throw new Error('Database client not available');

    const restId = restaurantId || await getDefaultRestaurantId();

    const categories = await prisma.category.findMany({
        where: {
            restaurant_id: restId,
            is_active: true,
        },
        orderBy: { sort_order: 'asc' },
        include: {
            _count: {
                select: {
                    menu_items: {
                        where: { is_active: true, is_available: true },
                    },
                },
            },
        },
    });

    return categories.map((cat, idx) => ({
        index: idx + 1,
        id: cat.id,
        name: cat.name,
        slug: cat.slug,
        description: cat.description || '',
        itemCount: cat._count.menu_items,
    }));
}

/**
 * Get single category by index, ID, slug, or name with its available items
 * @param {string|number} identifier
 * @param {string} [restaurantId]
 * @returns {Promise<Object|null>}
 */
export async function getCategoryWithItems(identifier, restaurantId) {
    const prisma = getDbClient();
    if (!prisma) throw new Error('Database client not available');

    const restId = restaurantId || await getDefaultRestaurantId();
    const categories = await getActiveMenu(restId);

    if (categories.length === 0) return null;

    const isPureNumber = typeof identifier === 'number' || (typeof identifier === 'string' && /^\d+$/.test(identifier.trim()));
    if (isPureNumber) {
        const num = parseInt(identifier, 10);
        if (!isNaN(num) && num >= 1 && num <= categories.length) {
            return categories[num - 1];
        }
    }

    let cleanStr = String(identifier).trim().toLowerCase();
    // Strip common conversational suffixes (e.g. "mein kia kia ha", "dikhao", "options")
    cleanStr = cleanStr.replace(/(?:\s+(?:mai|me|mein)\s+(?:kya|kia|kay)\s*(?:kya|kia|kay)?\s*(?:h|ha|hai|hay)?|\s+(?:dikhao|bhejo|options|list|items?))$/i, '').trim();
    const cleanSingular = cleanStr.replace(/s$/, '');

    const found = categories.find(c => {
        const cName = c.name.toLowerCase();
        const cSlug = c.slug.toLowerCase();
        const cSingular = cName.replace(/s$/, '');
        return c.id === identifier ||
               cSlug === cleanStr ||
               cName === cleanStr ||
               cSingular === cleanSingular ||
               cName.includes(cleanStr) ||
               cleanStr.includes(cName) ||
               cleanStr.includes(cSingular);
    });

    return found || null;
}

/**
 * Get currently active and valid deals with their contained items
 * @param {string} [restaurantId]
 * @returns {Promise<Array>}
 */
export async function getActiveDeals(restaurantId) {
    const prisma = getDbClient();
    if (!prisma) throw new Error('Database client not available');

    const restId = restaurantId || await getDefaultRestaurantId();
    const now = new Date();

    const deals = await prisma.deal.findMany({
        where: {
            restaurant_id: restId,
            is_active: true,
            AND: [
                { OR: [{ start_at: null }, { start_at: { lte: now } }] },
                { OR: [{ end_at: null }, { end_at: { gte: now } }] },
            ],
        },
        orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
        include: {
            deal_items: {
                include: {
                    menu_item: {
                        select: { id: true, name: true, is_active: true, is_available: true },
                    },
                    menu_variant: {
                        select: { id: true, name: true, is_available: true },
                    },
                },
            },
        },
    });

    // Verify all items inside deal are active and available
    return deals.filter(deal => {
        return deal.deal_items.every(di => {
            if (!di.menu_item || !di.menu_item.is_active || !di.menu_item.is_available) {
                return false;
            }
            if (di.menu_variant && !di.menu_variant.is_available) {
                return false;
            }
            return true;
        });
    });
}

/**
 * Find menu item or deal matching user query
 * Avoids silent guessing: returns multiple candidates if ambiguous.
 *
 * @param {string} query
 * @param {string} [restaurantId]
 * @returns {Promise<Object>}
 */
export async function resolveMenuItemOrDeal(query, restaurantId) {
    if (!query || typeof query !== 'string') {
        return { match: null, status: 'NOT_FOUND' };
    }

    const prisma = getDbClient();
    if (!prisma) throw new Error('Database client not available');

    const restId = restaurantId || await getDefaultRestaurantId();
    const cleanQ = query.trim().toLowerCase();

    // 1. Check if user typed "deal 1", "deal #1", "family feast", etc.
    const activeDeals = await getActiveDeals(restId);
    
    // Exact deal name or slug match first (e.g. "Deal 1", "Burger Meal For 1")
    const exactDeal = activeDeals.find(d => 
        d.slug.toLowerCase() === cleanQ || 
        d.name.toLowerCase() === cleanQ
    );
    if (exactDeal) {
        return {
            status: 'EXACT_MATCH',
            type: 'DEAL',
            deal: exactDeal,
        };
    }

    // Check numbered deal (e.g. "deal 5", "deal #1")
    const dealNumMatch = cleanQ.match(/^(?:deal\s*(?:#|no\.?)?\s*)(\d+)$/i);
    if (dealNumMatch) {
        const dNum = dealNumMatch[1];
        const numMatchedDeal = activeDeals.find(d => new RegExp(`\\bdeal\\s*#?${dNum}\\b`, 'i').test(d.name));
        if (numMatchedDeal) {
            return {
                status: 'EXACT_MATCH',
                type: 'DEAL',
                deal: numMatchedDeal,
            };
        }
    }

    // 2. Fetch all active & available items
    const allItems = await prisma.menuItem.findMany({
        where: {
            restaurant_id: restId,
            is_active: true,
            is_available: true,
            category: { is_active: true },
        },
        include: {
            category: true,
            variants: {
                where: { is_available: true },
                orderBy: { sort_order: 'asc' },
            },
        },
    });

    // Exact item name or slug match
    const exactItem = allItems.find(i => 
        i.slug.toLowerCase() === cleanQ || 
        i.name.toLowerCase() === cleanQ
    );
    if (exactItem) {
        return {
            status: 'EXACT_MATCH',
            type: 'ITEM',
            item: exactItem,
            hasVariants: exactItem.variants.length > 0,
            variants: exactItem.variants,
        };
    }

    // Substring or token match across items and deals
    const matchedItems = allItems.filter(i => {
        const name = i.name.toLowerCase();
        return name.includes(cleanQ) || cleanQ.includes(name);
    });

    const matchedDeals = activeDeals.filter(d => {
        const name = d.name.toLowerCase();
        return name.includes(cleanQ) || cleanQ.includes(name);
    });

    const totalMatches = matchedItems.length + matchedDeals.length;

    if (totalMatches === 1) {
        if (matchedItems.length === 1) {
            const item = matchedItems[0];
            return {
                status: 'EXACT_MATCH',
                type: 'ITEM',
                item,
                hasVariants: item.variants.length > 0,
                variants: item.variants,
            };
        } else {
            return {
                status: 'EXACT_MATCH',
                type: 'DEAL',
                deal: matchedDeals[0],
            };
        }
    }

    if (totalMatches > 1) {
        return {
            status: 'AMBIGUOUS',
            candidates: [
                ...matchedItems.map(i => ({ type: 'ITEM', name: i.name, basePrice: Number(i.base_price) })),
                ...matchedDeals.map(d => ({ type: 'DEAL', name: d.name, price: Number(d.deal_price) })),
            ],
        };
    }

    // Partial word token overlap (e.g. "zinger" matches "Zinger Burger")
    const words = cleanQ.split(/\s+/).filter(w => w.length > 2);
    if (words.length > 0) {
        const tokenItems = allItems.filter(i => {
            const name = i.name.toLowerCase();
            return words.some(w => name.includes(w));
        });

        if (tokenItems.length === 1) {
            const item = tokenItems[0];
            return {
                status: 'EXACT_MATCH',
                type: 'ITEM',
                item,
                hasVariants: item.variants.length > 0,
                variants: item.variants,
            };
        } else if (tokenItems.length > 1) {
            return {
                status: 'AMBIGUOUS',
                candidates: tokenItems.map(i => ({ type: 'ITEM', name: i.name, basePrice: Number(i.base_price) })),
            };
        }
    }

    return { status: 'NOT_FOUND', match: null };
}
