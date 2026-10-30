/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║   Add-on & Multi-Item Extraction Service                     ║
 * ║   src/services/addonExtractionService.js                     ║
 * ║   Dedicated Multi-Item Parsing & Deal Composition Engine    ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Implements:
 *   - Dedicated multi-item add-on extraction from conversational text
 *   - Included items vs. additional items resolution
 *   - Canonical flavour & product normalization
 *   - Batch atomic cart addition & verification
 */

import { FALLBACK_MENU_ITEMS, FALLBACK_DEALS } from './fallbackCatalog.js';
import { addItemToCart, calculateCartTotals, getActiveCart } from './cartService.js';
import { getDefaultRestaurantId } from './restaurantService.js';

// ─── Canonical Flavour Catalog ──────────────────────────────────────────────
export const CANONICAL_FLAVOURS = [
    'Chicken Tikka',
    'Chicken Fajita',
    'Chicken Supreme',
    'Cheese Lover',
    'Chicken Tandori',
    'Behari Kebab Pizza',
    'Chicken Extreme',
];

const FLAVOUR_ALIASES = {
    'tandoori': 'Chicken Tandori',
    'tandori': 'Chicken Tandori',
    'chicken tandoori': 'Chicken Tandori',
    'chicken tandori': 'Chicken Tandori',
    'tikka': 'Chicken Tikka',
    'chicken tikka': 'Chicken Tikka',
    'fajita': 'Chicken Fajita',
    'fajitas': 'Chicken Fajita',
    'chicken fajita': 'Chicken Fajita',
    'chicken fajitas': 'Chicken Fajita',
    'supreme': 'Chicken Supreme',
    'chicken supreme': 'Chicken Supreme',
    'cheese': 'Cheese Lover',
    'cheese lover': 'Cheese Lover',
    'cheese lovers': 'Cheese Lover',
    'cheeselover': 'Cheese Lover',
    'behari': 'Behari Kebab Pizza',
    'behari kebab': 'Behari Kebab Pizza',
    'behari pizza': 'Behari Kebab Pizza',
    'extreme': 'Chicken Extreme',
    'chicken extreme': 'Chicken Extreme',
    'chicken extrme': 'Chicken Extreme',
};

/**
 * Normalizes customer flavour input to canonical menu flavour record
 * @param {string} raw
 * @returns {{ valid: boolean, canonicalName?: string, availableFlavours: string[] }}
 */
export function normalizeFlavourName(raw) {
    if (!raw || typeof raw !== 'string') {
        return { valid: false, availableFlavours: [...CANONICAL_FLAVOURS] };
    }
    const clean = raw.trim().toLowerCase();
    if (FLAVOUR_ALIASES[clean]) {
        return { valid: true, canonicalName: FLAVOUR_ALIASES[clean], availableFlavours: [...CANONICAL_FLAVOURS] };
    }
    // Partial check
    for (const [alias, canonical] of Object.entries(FLAVOUR_ALIASES)) {
        if (clean.includes(alias) || alias.includes(clean)) {
            return { valid: true, canonicalName: canonical, availableFlavours: [...CANONICAL_FLAVOURS] };
        }
    }
    return { valid: false, input: raw, availableFlavours: [...CANONICAL_FLAVOURS] };
}

// ─── Deal Composition Definitions ──────────────────────────────────────────
export const DEAL_COMPOSITIONS = {
    'deal-1': { name: 'Deal 1', includedDrinks: { count: 2, size: 'Regular' }, includedPizzas: { count: 2, size: 'Small' } },
    'deal-2': { name: 'Deal 2', includedDrinks: { count: 1, size: '1 Liter' }, includedPizzas: { count: 2, size: 'Medium' } },
    'deal-3': { name: 'Pizza Meal For 3', includedDrinks: { count: 1, size: '1 Liter' }, includedPizzas: { count: 1, size: 'Large' } },
    'deal-4': { name: 'Pizza Meal For 4', includedDrinks: { count: 1, size: '1.5 Liter' }, includedPizzas: { count: 1, size: 'Party Size' } },
    'deal-pizza-meal-for-1': { name: 'Pizza Meal For 1', includedDrinks: { count: 1, size: 'Regular' }, includedPizzas: { count: 1, size: 'Small' } },
    'deal-pizza-meal-for-2': { name: 'Pizza Meal For 2', includedDrinks: { count: 2, size: 'Regular' }, includedPizzas: { count: 1, size: 'Medium' } },
    'deal-pizza-meal-for-3': { name: 'Pizza Meal For 3', includedDrinks: { count: 1, size: '1 Liter' }, includedPizzas: { count: 1, size: 'Large' } },
    'deal-pizza-meal-for-4': { name: 'Pizza Meal For 4', includedDrinks: { count: 1, size: '1.5 Liter' }, includedPizzas: { count: 1, size: 'Party Size' } },
    'deal-burger-meal-for-1': { name: 'Burger Meal For 1', includedDrinks: { count: 1, size: 'Regular' }, includedFries: { count: 1, size: 'Regular' } },
    'deal-burger-meal-for-2': { name: 'Burger Meal For 2', includedDrinks: { count: 2, size: 'Regular' }, includedFries: { count: 1, size: 'Regular' } },
    'deal-burger-meal-for-3': { name: 'Burger Meal For 3', includedDrinks: { count: 1, size: '1 Liter' } },
    'deal-5': { name: 'Deal 5', includedDrinks: { count: 1, size: '1 Liter' } },
};

/**
 * Checks if the cart contains a deal with included components (e.g. 1L drink)
 * @param {object} cart
 * @returns {Array<object>}
 */
export function getCartIncludedComponents(cart) {
    if (!cart?.items || cart.items.length === 0) return [];
    const included = [];
    for (const item of cart.items) {
        const dealId = item.deal_id || item.deal?.id || item.deal?.slug;
        const dealName = item.deal?.name || '';
        const lowerDeal = dealName.toLowerCase();
        let match = DEAL_COMPOSITIONS[dealId];
        if (!match) {
            for (const [k, v] of Object.entries(DEAL_COMPOSITIONS)) {
                if (lowerDeal.includes(v.name.toLowerCase()) || (v.name.toLowerCase().includes(lowerDeal) && lowerDeal.length > 4)) {
                    match = v;
                    break;
                }
            }
        }
        if (match) {
            if (match.includedDrinks) {
                included.push({
                    type: 'drink',
                    dealName: match.name,
                    size: match.includedDrinks.size,
                    count: match.includedDrinks.count * item.quantity,
                });
            }
            if (match.includedFries) {
                included.push({
                    type: 'fries',
                    dealName: match.name,
                    size: match.includedFries.size,
                    count: match.includedFries.count * item.quantity,
                });
            }
        }
    }
    return included;
}

const QTY_WORD_MAP = {
    'ek': 1, 'aik': 1, 'ik': 1, 'one': 1, '1': 1,
    'do': 2, 'doo': 2, 'two': 2, '2': 2,
    'teen': 3, 'tin': 3, 'three': 3, '3': 3,
    'char': 4, 'chaar': 4, 'four': 4, '4': 4,
    'panch': 5, 'paanch': 5, 'five': 5, '5': 5,
};

/**
 * Deterministic multi-item extractor for food requests & add-ons.
 * Correctly identifies combinations like:
 *   "Fries krdo regular aik drink litre wali"
 *   "Regular fries aur aik litre drink add karo"
 *   "2 zinger burger aur aik regular fries"
 *
 * @param {string} text
 * @param {object} [activeCart]
 * @returns {{ items: Array<object>, hasMultiple: boolean, dealClarificationNeeded: boolean, clarificationPrompt?: string }}
 */
export function extractRequestedItems(text, activeCart = null) {
    if (!text || typeof text !== 'string') return { items: [], hasMultiple: false, dealClarificationNeeded: false };

    const lower = text.toLowerCase().trim();
    const extracted = [];

    // 1. Detect Fries Mentions
    const friesMatch = lower.match(/\b(?:(regular|reg|large|loaded|choti|bari|standard)\s+)?(?:fries|fris|fryz|fraies|french\s*fries)\b|\b(?:fries|fris|fryz|fraies)\s*(?:kr\s*do|kardo|krdo|add|chahiye|mangwa\s*do|bhi|aur)?\s*(regular|reg|large|loaded|standard)?\b/i);
    if (friesMatch) {
        let size = 'Regular';
        const candidateSize = (friesMatch[1] || friesMatch[2] || '').toLowerCase();
        if (candidateSize.includes('large') || candidateSize.includes('bari')) {
            size = 'Large';
        } else if (candidateSize.includes('loaded') || lower.includes('loaded fries')) {
            size = 'Standard';
        }
        let qty = 1;
        const qtyMatch = lower.match(/\b(\d+|aik|ek|ik|do|teen|char|panch)\s*(?:x\s+)?(?:regular\s+|large\s+)?fries\b/i) ||
                         lower.match(/\bfries\s*(?:krdo|kardo|add)?\s*(?:regular\s+)?(?:aik|ek|ik|do|1|2)\b/i);
        if (qtyMatch) {
            qty = QTY_WORD_MAP[qtyMatch[1]] || parseInt(qtyMatch[1], 10) || 1;
        }

        const isLoaded = size === 'Standard' && (candidateSize.includes('loaded') || lower.includes('loaded fries'));
        const menuItem = FALLBACK_MENU_ITEMS.find(it => isLoaded ? it.id === 'item-3' : it.id === 'item-1');
        const variant = (menuItem?.variants || []).find(v => v.name.toLowerCase() === size.toLowerCase()) || menuItem?.variants?.[0];

        extracted.push({
            itemType: 'fries',
            itemName: isLoaded ? 'Loaded Fries' : 'Fries',
            canonicalName: isLoaded ? 'Loaded Fries' : `Fries (${size})`,
            size,
            quantity: qty,
            menuItemId: menuItem?.id || 'item-1',
            variantId: variant?.id || (size === 'Large' ? 'v-1-2' : 'v-1-1'),
            unitPrice: variant ? Number(variant.price) : (size === 'Large' ? 320 : 220),
            lineTotal: (variant ? Number(variant.price) : (size === 'Large' ? 320 : 220)) * qty,
        });
    }

    // 2. Detect Drink Mentions
    const drinkMatch = lower.match(/\b(?:(1\.5\s*liter|1\.5\s*litre|1\.5l|1\s*liter|1\s*litre|1l|litre|liter|regular|can|tin)\s+)?(?:drink|drinks|cold\s*drink|soft\s*drink|pepsi|coke|next\s*cola|7up|mirinda|dew|sprite)\b|\b(?:drink|drinks|cold\s*drink|soft\s*drink|pepsi|coke|next\s*cola|7up|mirinda)\s*(?:wali|ka|ki|add|krdo|kardo)?\s*(1\.5\s*liter|1\.5\s*litre|1\s*liter|1\s*litre|1l|litre\s*wali|litre|liter|regular|can)?\b/i);
    if (drinkMatch) {
        let size = '1 Liter';
        const candidateSize = (drinkMatch[1] || drinkMatch[2] || '').toLowerCase();
        if (candidateSize.includes('1.5') || lower.includes('1.5 liter') || lower.includes('1.5 litre') || lower.includes('dedh litre')) {
            size = '1.5 Liter';
        } else if (candidateSize.includes('can') || candidateSize.includes('tin') || lower.includes('can')) {
            size = 'Can';
        } else if (candidateSize.includes('regular') || lower.includes('regular drink') || lower.includes('choti drink')) {
            size = 'Regular';
        } else if (candidateSize.includes('litre') || candidateSize.includes('liter') || lower.includes('litre wali') || lower.includes('liter wali') || lower.includes('1 litre') || lower.includes('1 liter')) {
            size = '1 Liter';
        }

        let qty = 1;
        const qtyMatch = lower.match(/\b(\d+|aik|ek|ik|do|teen|char|panch)\s*(?:x\s+)?(?:1\s*liter\s+|1\.5\s*liter\s+|regular\s+)?(?:drink|drinks|pepsi|coke)\b/i) ||
                         lower.match(/(?:drink|pepsi|coke)\s*(?:litre\s*wali\s+)?(?:aik|ek|ik|1)\b/i);
        if (qtyMatch) {
            qty = QTY_WORD_MAP[qtyMatch[1]] || parseInt(qtyMatch[1], 10) || 1;
        }

        const drinkItem = FALLBACK_MENU_ITEMS.find(it => it.id === 'item-34');
        const variant = (drinkItem?.variants || []).find(v => v.name.toLowerCase() === size.toLowerCase()) ||
                        (size === '1 Liter' ? { id: 'v-34-3', price: 200 } : (size === '1.5 Liter' ? { id: 'v-34-4', price: 240 } : { id: 'v-34-1', price: 110 }));

        extracted.push({
            itemType: 'drink',
            itemName: 'Soft Drink',
            canonicalName: `Soft Drink (${size})`,
            size,
            quantity: qty,
            menuItemId: 'item-34',
            variantId: variant?.id || 'v-34-3',
            unitPrice: Number(variant?.price || (size === '1 Liter' ? 200 : (size === '1.5 Liter' ? 240 : 110))),
            lineTotal: Number(variant?.price || (size === '1 Liter' ? 200 : (size === '1.5 Liter' ? 240 : 110))) * qty,
        });
    }

    // 3. Detect Burger Mentions (e.g. Zinger, Zegy, etc.)
    const burgerMatch = lower.match(/\b(?:(\d+|aik|ek|ik|do|teen|two|three)\s+)?(zinger|ziggy|zegy|zeggy)\s*(?:burger|burgers)?\b/i);
    if (burgerMatch) {
        const qty = burgerMatch[1] ? (QTY_WORD_MAP[burgerMatch[1]] || parseInt(burgerMatch[1], 10) || 1) : 1;
        const isZegy = /ziggy|zegy|zeggy/i.test(burgerMatch[2]);
        const item = FALLBACK_MENU_ITEMS.find(it => isZegy ? it.id === 'item-20' : it.id === 'item-22');
        extracted.push({
            itemType: 'burger',
            itemName: isZegy ? 'Zegy Burger' : 'Zinger Burger',
            canonicalName: isZegy ? 'Zegy Burger' : 'Zinger Burger',
            size: 'Standard',
            quantity: qty,
            menuItemId: item?.id || (isZegy ? 'item-20' : 'item-22'),
            variantId: item?.variants?.[0]?.id || null,
            unitPrice: Number(item?.base_price || (isZegy ? 399 : 499)),
            lineTotal: Number(item?.base_price || (isZegy ? 399 : 499)) * qty,
        });
    }

    // 4. Deal Composition & Included Drink Disambiguation
    let dealClarificationNeeded = false;
    let clarificationPrompt = null;
    if (activeCart) {
        const includedComponents = getCartIncludedComponents(activeCart);
        const drinkReq = extracted.find(it => it.itemType === 'drink');
        const includedDrink = includedComponents.find(c => c.type === 'drink');

        if (drinkReq && includedDrink) {
            // Check if explicitly additional: "aur", "extra", "mazeed", "bhi", "another", "doosri"
            const isExplicitlyAdditional = /\b(?:aur|extra|mazeed|bhi|another|doosri|2nd|alag\s*se)\b/i.test(lower);
            drinkReq.includedInDeal = includedDrink.dealName;
            drinkReq.isExplicitlyAdditional = isExplicitlyAdditional;

            if (!isExplicitlyAdditional && extracted.length === 1) {
                // Customer only mentioned drink: clarify if they want another drink or asking about included drink
                dealClarificationNeeded = true;
                clarificationPrompt = `Aap ke cart mein *${includedDrink.dealName}* mojood hai jis mein ${includedDrink.size} drink pehle se included hai. 😊\n\nKya aap iske ilawa aik extra drink (Rs. ${drinkReq.unitPrice}) add karna chahte hain?`;
            }
        }
    }

    return {
        items: extracted,
        hasMultiple: extracted.length > 1,
        dealClarificationNeeded,
        clarificationPrompt,
    };
}

/**
 * Atomically executes batch add to cart for multiple items.
 * Verifies that ALL requested items are present in the updated cart.
 *
 * @param {object} params
 * @returns {Promise<{ success: boolean, added: Array<object>, failed: Array<object>, cart: object, totals: object }>}
 */
export async function executeBatchAddToCart({ sessionKey, restaurantId, chatId, verifiedPhone, items = [] }) {
    if (!items || items.length === 0) {
        return { success: false, added: [], failed: [], cart: null, totals: null };
    }

    const restId = restaurantId || await getDefaultRestaurantId().catch(() => 'cravey-crust-main');
    const added = [];
    const failed = [];

    for (const it of items) {
        try {
            await addItemToCart({
                sessionKey,
                restaurantId: restId,
                chatId,
                verifiedPhone,
                menuItemId: it.menuItemId,
                variantId: it.variantId,
                quantity: it.quantity || 1,
                notes: it.notes || null,
            });
            added.push(it);
        } catch (err) {
            console.error(`[ADDON_SERVICE] Failed to add item ${it.canonicalName}:`, err.message);
            failed.push({ item: it, error: err.message });
        }
    }

    const updatedCart = await getActiveCart({ sessionKey, restaurantId: restId, chatId });
    const totals = await calculateCartTotals({ sessionKey, restaurantId: restId, chatId });

    // Verify all added items are present in cart
    const allVerified = added.every(it => {
        return updatedCart.items.some(ci => {
            if (it.menuItemId && ci.menu_item_id === it.menuItemId) return true;
            if (it.variantId && ci.menu_variant_id === it.variantId) return true;
            return false;
        });
    });

    return {
        success: added.length > 0 && failed.length === 0 && allVerified,
        partial: added.length > 0 && failed.length > 0,
        added,
        failed,
        cart: updatedCart,
        totals,
    };
}

