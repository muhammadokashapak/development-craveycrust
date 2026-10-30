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
 *   - Resilient against database outages with instant in-memory fallback catalog.
 */

import { getDbClient } from '../db/client.js';
import { getDefaultRestaurantId } from './restaurantService.js';
import { matchVariant } from './cartService.js';
import { isPizzaDeal, getDealPizzaInfo, extractFlavoursFromText, formatFlavourNotes } from './dealFlavourService.js';
import { FALLBACK_CATEGORIES, FALLBACK_MENU_ITEMS, FALLBACK_DEALS } from './fallbackCatalog.js';

/**
 * Get all active categories with their active & available items
 * @param {string} [restaurantId]
 * @returns {Promise<Array>}
 */
export async function getActiveMenu(restaurantId) {
    const prisma = getDbClient();
    if (!prisma) {
        return FALLBACK_CATEGORIES.map(c => ({
            ...c,
            menu_items: FALLBACK_MENU_ITEMS.filter(it => it.category_id === c.id),
        })).filter(c => !/deals?/i.test(c.name));
    }

    try {
        const restId = restaurantId || await getDefaultRestaurantId().catch(() => 'default-restaurant');

        const categories = await prisma.category.findMany({
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

        const filtered = categories.filter(c => !/deals?/i.test(c.name));
        return filtered.length > 0 ? filtered : FALLBACK_CATEGORIES.map(c => ({
            ...c,
            menu_items: FALLBACK_MENU_ITEMS.filter(it => it.category_id === c.id),
        })).filter(c => !/deals?/i.test(c.name));
    } catch (_) {
        return FALLBACK_CATEGORIES.map(c => ({
            ...c,
            menu_items: FALLBACK_MENU_ITEMS.filter(it => it.category_id === c.id),
        })).filter(c => !/deals?/i.test(c.name));
    }
}

/**
 * Get active categories summary (for category-first browsing)
 * @param {string} [restaurantId]
 * @returns {Promise<Array>}
 */
export async function getActiveCategories(restaurantId) {
    const prisma = getDbClient();
    if (!prisma) {
        return FALLBACK_CATEGORIES.filter(c => !/deals?/i.test(c.name)).map((cat, idx) => ({
            index: idx + 1,
            id: cat.id,
            name: cat.name,
            slug: cat.slug,
            description: cat.description || '',
            image_url: cat.image_url || null,
            itemCount: FALLBACK_MENU_ITEMS.filter(it => it.category_id === cat.id).length,
        }));
    }

    try {
        const restId = restaurantId || await getDefaultRestaurantId().catch(() => 'default-restaurant');

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

        const activeFoodCategories = categories.filter(c => !/deals?/i.test(c.name));

        return activeFoodCategories.map((cat, idx) => ({
            index: idx + 1,
            id: cat.id,
            name: cat.name,
            slug: cat.slug,
            description: cat.description || '',
            image_url: cat.image_url || null,
            itemCount: cat._count.menu_items,
        }));
    } catch (_) {
        return FALLBACK_CATEGORIES.filter(c => !/deals?/i.test(c.name)).map((cat, idx) => ({
            index: idx + 1,
            id: cat.id,
            name: cat.name,
            slug: cat.slug,
            description: cat.description || '',
            image_url: cat.image_url || null,
            itemCount: FALLBACK_MENU_ITEMS.filter(it => it.category_id === cat.id).length,
        }));
    }
}

/**
 * Get single category by index, ID, slug, or name with its available items
 * @param {string|number} identifier
 * @param {string} [restaurantId]
 * @returns {Promise<Object|null>}
 */
export async function getCategoryWithItems(identifier, restaurantId) {
    const restId = restaurantId || await getDefaultRestaurantId().catch(() => 'default-restaurant');
    const categories = await getActiveMenu(restId);

    if (!categories || categories.length === 0) return null;

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

    // SAKHT GUARD: If the query contains food item names or ordering quantities, NEVER treat it as a generic category!
    const hasFoodItemKeywords = /\b(zinger|ziggy|zegy|zeggy|wing|wings|fries|tikka|fajita|extreme|supreme|kebab|roll|rolls|crispy|oven|baked|junior|chunks|alfredo|pasta|shawarma|wrap|nugget|nuggets|box|platter)\b/i.test(cleanStr);
    const hasQuantitySignals = /^(?:(?:\d+)|(?:aik|ek|ik|do|doo|teen|tin|char|chaar|panch|paanch|chay|chey|saat|aath|ath|nau|dus|das|one|two|three|four|five))\b/i.test(cleanStr);
    if (hasFoodItemKeywords || hasQuantitySignals) {
        // Only allow exact match on category name or slug if explicitly requested as a category
        const exactMatch = categories.find(c => c.id === identifier || c.slug.toLowerCase() === cleanStr || c.name.toLowerCase() === cleanStr);
        return exactMatch || null;
    }

    const found = categories.find(c => {
        const cName = c.name.toLowerCase();
        const cSlug = c.slug.toLowerCase();
        const cSingular = cName.replace(/s$/, '');
        return c.id === identifier ||
               cSlug === cleanStr ||
               cName === cleanStr ||
               cSingular === cleanSingular ||
               cSingular === cleanStr ||
               cName.includes(cleanStr);
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
    if (!prisma) return FALLBACK_DEALS;

    try {
        const restId = restaurantId || await getDefaultRestaurantId().catch(() => 'default-restaurant');
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
        const validDeals = deals.filter(deal => {
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

        return validDeals.length > 0 ? validDeals : FALLBACK_DEALS;
    } catch (_) {
        return FALLBACK_DEALS;
    }
}

/**
 * Extract pizza / drink size and cleaned product name from user query
 */
export function extractSizeFromQuery(query) {
    if (!query || typeof query !== 'string') return { size: null, cleanQuery: '' };
    const q = query.trim().toLowerCase();

    // Check size regex with word boundaries
    const isParty = /\b(?:party\s*size|partysize|party|family)\b/i.test(q);
    const isLarge = !isParty && /\b(?:large|lrg|bada|bara)\b/i.test(q);
    const isMedium = !isParty && /\b(?:medium|med|darmiyan|darmiyana)\b/i.test(q);
    const isSmall = /\b(?:small|chota|chhota)\b/i.test(q);
    const isRegular = /\b(?:regular|reg)\b/i.test(q);

    let size = null;
    if (isParty) size = 'Party Size';
    else if (isLarge) size = 'Large';
    else if (isMedium) size = 'Medium';
    else if (isSmall) size = 'Small';
    else if (isRegular) size = 'Regular';

    // Strip size keywords and common ordering verbs to extract item name
    let clean = q
        .replace(/\b(?:party\s*size|partysize|party|family|large|lrg|bada|bara|medium|med|darmiyan|darmiyana|small|chota|chhota|regular|reg)\b/gi, ' ')
        .replace(/\b(?:kr\s*d[ao]|kar\s*d[ao]|kardo|krdo|krdu|kardu|kar\s*dein|kr\s*dein|karden|kar\s*dain|kr\s*dain|chahiye|mangwana|order|bhai|wala|wali|size)\b/gi, ' ')
        .replace(/^(?:sahi|shai|ek|aik|yar|yaar|\d+)\s+/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    return { size, cleanQuery: clean };
}

/**
 * Find menu item or deal matching user query
 * Avoids silent guessing: returns multiple candidates if ambiguous.
 * Resilient to DB offline via instant fallbackCatalog.
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
    const restId = restaurantId || await getDefaultRestaurantId().catch(() => 'default-restaurant');

    // Strip leading quantity (e.g. "2 zinger burger" -> "zinger burger", "do ziggy burger" -> "ziggy burger")
    let rawItemQ = query.trim().toLowerCase();
    rawItemQ = rawItemQ.replace(/^(?:(?:\d+)|(?:aik|ek|ik|do|doo|teen|tin|char|chaar|panch|paanch|chay|chey|saat|aath|ath|nau|dus|das|one|two|three|four|five|six|seven|eight|nine|ten))\s*(?:x\s+)?/i, '').trim();
    // Also strip trailing ordering verbs
    rawItemQ = rawItemQ.replace(/\s+(?:(?:order\s*)?(?:kr\s*d[aou]+n?|kar\s*d[aou]+n?|kardo|krdo|krdu|kardu|karein|kar\s*dein|kr\s*dein|kar\s*dain|kr\s*dain|karden|order\s*(?:karo|kro|krna|karna|dein|dain|do))|chahiye|mangwao|bhejo|bhej\s*do|daal\s*do|add\s*(?:karo|kar\s*do|kr\s*do))[\s.!?]*$/i, '').trim();
    const cleanQ = rawItemQ;
    const { size: extractedSize, cleanQuery: strippedQ } = extractSizeFromQuery(cleanQ);

    // 1. If query is purely a size specification (e.g. "medium", "party krdo", "large", "small")
    if (extractedSize && !strippedQ) {
        return {
            status: 'SIZE_SPECIFIED',
            size: extractedSize,
            rawQuery: query,
        };
    }

    // 2. Check if user typed "deal 1", "deal #1", "burger meal 2", "family feast", etc.
    const activeDeals = await getActiveDeals(restId);
    
    function buildDealResult(deal) {
        const pizzaInfo = getDealPizzaInfo(deal);
        const extractedFlavours = pizzaInfo.isPizzaDeal ? extractFlavoursFromText(cleanQ, pizzaInfo.pizzaCount) : [];
        const flavourNotes = extractedFlavours.length > 0 ? formatFlavourNotes(extractedFlavours) : null;
        return {
            status: 'EXACT_MATCH',
            type: 'DEAL',
            deal,
            pizzaInfo,
            flavours: extractedFlavours,
            flavourNotes,
        };
    }

    // Normalized queries (stripping "for", spaces, and punctuation for alias comparison)
    const normCleanQ = cleanQ.replace(/\bfor\b/gi, '').replace(/#|\s+/g, '');
    const normStrippedQ = strippedQ ? strippedQ.replace(/\bfor\b/gi, '').replace(/#|\s+/g, '') : '';

    // Exact deal name or slug match first (e.g. "Deal 1", "Burger Meal For 1", "Burger Meal 2")
    const exactDeal = activeDeals.find(d => {
        const dNorm = (d.name || '').toLowerCase().replace(/\bfor\b/gi, '').replace(/#|\s+/g, '');
        const dSlug = (d.slug || '').toLowerCase();
        const dName = (d.name || '').toLowerCase();
        return dSlug === cleanQ ||
            dName === cleanQ ||
            dNorm === normCleanQ ||
            (strippedQ && (dSlug === strippedQ || dName === strippedQ || dNorm === normStrippedQ));
    });
    if (exactDeal) {
        return buildDealResult(exactDeal);
    }

    // Specific Burger Meal / Pizza Meal alias check (e.g. "burger deal 3", "zinger deal 4", "pizza deal 2")
    const burgerDealMatch = cleanQ.match(/\b(?:burger|zinger|zegy)\s*(?:deal|meal)\s*(?:#|no\.?)?\s*([1-5])\b/i) ||
        (strippedQ && strippedQ.match(/\b(?:burger|zinger|zegy)\s*(?:deal|meal)\s*(?:#|no\.?)?\s*([1-5])\b/i));
    if (burgerDealMatch) {
        const bNum = burgerDealMatch[1];
        const bDeal = activeDeals.find(d => 
            new RegExp(`\\bburger\\s*meal\\s*(?:for\\s*)?${bNum}\\b`, 'i').test(d.name) ||
            (new RegExp(`\\bdeal\\s*#?${bNum}\\b`, 'i').test(d.name) && !/cravey\s*2\.?0/i.test(d.name))
        );
        if (bDeal) {
            return buildDealResult(bDeal);
        }
    }

    const pizzaDealMatch = cleanQ.match(/\bpi[z]+a\s*(?:deal|meal)\s*(?:#|no\.?)?\s*([1-4])\b/i) ||
        (strippedQ && strippedQ.match(/\bpi[z]+a\s*(?:deal|meal)\s*(?:#|no\.?)?\s*([1-4])\b/i));
    if (pizzaDealMatch) {
        const pNum = pizzaDealMatch[1];
        const pDeal = activeDeals.find(d => 
            new RegExp(`\\bpi[z]+a\\s*meal\\s*(?:for\\s*)?${pNum}\\b`, 'i').test(d.name) ||
            new RegExp(`\\bpi[z]+a\\s*deal\\s*#?${pNum}\\b`, 'i').test(d.name)
        );
        if (pDeal) {
            return buildDealResult(pDeal);
        }
    }

    // Check numbered deal (e.g. "deal 5", "deal #1", or "deal 2 chicken tikka aur fajita")
    const dealNumMatch = cleanQ.match(/\bdeal\s*(?:#|no\.?)?\s*(\d+)\b/i) ||
        (strippedQ && strippedQ.match(/\bdeal\s*(?:#|no\.?)?\s*(\d+)\b/i));
    if (dealNumMatch) {
        const dNum = dealNumMatch[1];
        const wantsBurgerOrZinger = /\b(?:burger|zinger|zegy)\b/i.test(cleanQ) || (strippedQ && /\b(?:burger|zinger|zegy)\b/i.test(strippedQ));
        const wantsPizza = /\b(?:pi[z]+a|piza|crust)\b/i.test(cleanQ) || (strippedQ && /\b(?:pi[z]+a|piza|crust)\b/i.test(strippedQ));

        let candidateDeals = activeDeals.filter(d => new RegExp(`\\bdeal\\s*#?${dNum}\\b`, 'i').test(d.name));
        if (wantsBurgerOrZinger && !wantsPizza) {
            const burgerOnly = candidateDeals.filter(d => {
                const combined = `${d.name} ${(d.deal_items || []).map(di => di.menu_item?.name || '').join(' ')} ${d.description || ''}`.toLowerCase();
                return /\b(?:burger|zinger|zegy|chicken)\b/i.test(combined) && !/\b(?:pizza|piza)\b/i.test(combined);
            });
            if (burgerOnly.length > 0) candidateDeals = burgerOnly;
        } else if (wantsPizza && !wantsBurgerOrZinger) {
            const pizzaOnly = candidateDeals.filter(d => {
                const combined = `${d.name} ${(d.deal_items || []).map(di => di.menu_item?.name || '').join(' ')} ${d.description || ''}`.toLowerCase();
                return /\b(?:pizza|piza|crust)\b/i.test(combined);
            });
            if (pizzaOnly.length > 0) candidateDeals = pizzaOnly;
        }

        const numMatchedDeal = candidateDeals[0] || activeDeals.find(d => new RegExp(`\\bdeal\\s*#?${dNum}\\b`, 'i').test(d.name));
        if (numMatchedDeal) {
            return buildDealResult(numMatchedDeal);
        }
    }

    // 3. Fetch all active & available items (with in-memory fallback if DB offline)
    let allItems = [];
    if (prisma) {
        try {
            allItems = await prisma.menuItem.findMany({
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
        } catch (_) {}
    }

    if (!allItems || allItems.length === 0) {
        allItems = FALLBACK_MENU_ITEMS.map(it => ({
            ...it,
            variants: it.variants || [],
        }));
    }

    // 3b. Explicit item aliases (e.g. "ziggy burger" / "ziggy" -> Zegy Burger, "zinger" -> Zinger Burger, etc.)
    const isZiggy = /\b(?:ziggy|zeggy|zigy|zigi|zegy)\b/i.test(cleanQ) || (strippedQ && /\b(?:ziggy|zeggy|zigy|zigi|zegy)\b/i.test(strippedQ));
    const isZinger = /\b(?:zinger|zingr|zingrr|zingar)\b/i.test(cleanQ) || (strippedQ && /\b(?:zinger|zingr|zingrr|zingar)\b/i.test(strippedQ));
    const isChickenBurger = /\b(?:chicken\s*burger|chkn\s*burger)\b/i.test(cleanQ) || (strippedQ && /\b(?:chicken\s*burger|chkn\s*burger)\b/i.test(strippedQ));
    const isLoadedFries = /\b(?:loaded\s*fries|frenzy\s*fries\s*loaded|load\s*fries)\b/i.test(cleanQ) || (strippedQ && /\b(?:loaded\s*fries|frenzy\s*fries\s*loaded|load\s*fries)\b/i.test(strippedQ));
    const isHotWings = /\b(?:hot\s*wings?|crispy\s*wings?|spicy\s*wings?)\b/i.test(cleanQ) || (strippedQ && /\b(?:hot\s*wings?|crispy\s*wings?|spicy\s*wings?)\b/i.test(strippedQ));
    const isOvenBakedWings = /\b(?:oven\s*baked\s*wings?|baked\s*wings?)\b/i.test(cleanQ) || (strippedQ && /\b(?:oven\s*baked\s*wings?|baked\s*wings?)\b/i.test(strippedQ));
    const isBehariRoll = /\b(?:behari|bihari|behri)\s*roll\b/i.test(cleanQ) || (strippedQ && /\b(?:behari|bihari|behri)\s*roll\b/i.test(strippedQ));

    let aliasTargetItem = null;
    if (isZiggy && !cleanQ.includes('deal') && !cleanQ.includes('meal')) {
        aliasTargetItem = allItems.find(i => i.slug === 'zegy-burger' || /zegy\s*burger/i.test(i.name));
    } else if (isZinger && !cleanQ.includes('deal') && !cleanQ.includes('meal')) {
        aliasTargetItem = allItems.find(i => i.slug === 'zinger-burger' || /zinger\s*burger/i.test(i.name));
    } else if (isChickenBurger && !cleanQ.includes('deal') && !cleanQ.includes('meal')) {
        aliasTargetItem = allItems.find(i => i.slug === 'chicken-burger' || /chicken\s*burger/i.test(i.name));
    } else if (isLoadedFries) {
        aliasTargetItem = allItems.find(i => i.slug === 'loaded-fries' || /loaded\s*fries/i.test(i.name));
    } else if (isHotWings) {
        aliasTargetItem = allItems.find(i => i.slug === 'hot-wings' || /hot\s*wings/i.test(i.name));
    } else if (isOvenBakedWings) {
        aliasTargetItem = allItems.find(i => i.slug === 'oven-baked-wings' || /oven\s*baked/i.test(i.name));
    } else if (isBehariRoll) {
        aliasTargetItem = allItems.find(i => i.slug === 'behari-roll' || /behari\s*roll/i.test(i.name));
    }

    if (aliasTargetItem) {
        const matchedVariant = (extractedSize && aliasTargetItem.variants?.length > 0)
            ? matchVariant(aliasTargetItem.variants, extractedSize)
            : null;
        return {
            status: 'EXACT_MATCH',
            type: 'ITEM',
            item: aliasTargetItem,
            hasVariants: (aliasTargetItem.variants || []).length > 0,
            variants: aliasTargetItem.variants || [],
            matchedVariant,
            extractedSize,
        };
    }

    // Handle "Chicken Lover" specifically -> suggests Cheese Lover (nearest item) + available chicken pizzas
    if (cleanQ.includes('chicken lover') || (strippedQ && strippedQ.includes('chicken lover'))) {
        const cheeseLover = allItems.find(i => i.name.toLowerCase().includes('cheese lover'));
        const chickenPizzas = allItems.filter(i => i.name.toLowerCase().includes('chicken') && i.id !== cheeseLover?.id);
        const candidates = [
            ...(cheeseLover ? [{ type: 'ITEM', name: cheeseLover.name, basePrice: Number(cheeseLover.base_price) }] : []),
            ...chickenPizzas.map(i => ({ type: 'ITEM', name: i.name, basePrice: Number(i.base_price) }))
        ];
        return {
            status: 'AMBIGUOUS',
            candidates,
            extractedSize,
            message: "Cravey Crust ke menu mein 'Chicken Lover' ke naam se koi direct item nahi hai, lekin hamare paas Cheese Lover aur Chicken Pizzas (Chicken Extreme, Chicken Tikka, Chicken Fajita, Chicken Supreme) mojood hain!",
        };
    }

    // 4. Exact item name or slug match (checking both cleanQ and strippedQ without size)
    const exactItem = allItems.find(i => 
        i.slug.toLowerCase() === cleanQ || 
        i.name.toLowerCase() === cleanQ ||
        (strippedQ && strippedQ.length >= 3 && (i.slug.toLowerCase() === strippedQ || i.name.toLowerCase() === strippedQ))
    );
    if (exactItem) {
        const matchedVariant = (extractedSize && exactItem.variants.length > 0)
            ? matchVariant(exactItem.variants, extractedSize)
            : null;
        return {
            status: 'EXACT_MATCH',
            type: 'ITEM',
            item: exactItem,
            hasVariants: exactItem.variants.length > 0,
            variants: exactItem.variants,
            matchedVariant,
            extractedSize,
        };
    }

    // 5. Substring match across items and deals (checking cleanQ and strippedQ)
    const matchedItems = allItems.filter(i => {
        const name = i.name.toLowerCase();
        return name.includes(cleanQ) || cleanQ.includes(name) ||
            (strippedQ && strippedQ.length >= 3 && (name.includes(strippedQ) || strippedQ.includes(name)));
    });

    const matchedDeals = activeDeals.filter(d => {
        const name = d.name.toLowerCase();
        return name.includes(cleanQ) || cleanQ.includes(name) ||
            (strippedQ && strippedQ.length >= 3 && (name.includes(strippedQ) || strippedQ.includes(name)));
    });

    const totalMatches = matchedItems.length + matchedDeals.length;

    if (totalMatches === 1) {
        if (matchedItems.length === 1) {
            const item = matchedItems[0];
            const matchedVariant = (extractedSize && item.variants.length > 0)
                ? matchVariant(item.variants, extractedSize)
                : null;
            return {
                status: 'EXACT_MATCH',
                type: 'ITEM',
                item,
                hasVariants: item.variants.length > 0,
                variants: item.variants,
                matchedVariant,
                extractedSize,
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
            extractedSize,
        };
    }

    // 6. Partial word token overlap (e.g. "zinger" matches "Zinger Burger", "behari" matches "Behari Kebab Pizza")
    const searchTarget = (strippedQ && strippedQ.length >= 3) ? strippedQ : cleanQ;
    const words = searchTarget.split(/\s+/).filter(w => w.length > 2);
    if (words.length > 0) {
        const tokenItems = allItems.filter(i => {
            const name = i.name.toLowerCase();
            return words.some(w => name.includes(w));
        });

        if (tokenItems.length === 1) {
            const item = tokenItems[0];
            const matchedVariant = (extractedSize && item.variants.length > 0)
                ? matchVariant(item.variants, extractedSize)
                : null;
            return {
                status: 'EXACT_MATCH',
                type: 'ITEM',
                item,
                hasVariants: item.variants.length > 0,
                variants: item.variants,
                matchedVariant,
                extractedSize,
            };
        } else if (tokenItems.length > 1) {
            return {
                status: 'AMBIGUOUS',
                candidates: tokenItems.map(i => ({ type: 'ITEM', name: i.name, basePrice: Number(i.base_price) })),
                extractedSize,
            };
        }
    }

    return { status: 'NOT_FOUND', match: null, extractedSize };
}
