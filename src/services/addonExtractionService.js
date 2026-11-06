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
    'ak': 1, 'ek': 1, 'aik': 1, 'ik': 1, 'one': 1, '1': 1,
    'do': 2, 'doo': 2, 'two': 2, '2': 2,
    'teen': 3, 'tin': 3, 'three': 3, '3': 3,
    'char': 4, 'chaar': 4, 'four': 4, '4': 4,
    'panch': 5, 'paanch': 5, 'five': 5, '5': 5,
    'che': 6, 'chey': 6, 'six': 6, '6': 6,
    'saat': 7, 'seven': 7, '7': 7,
    'aath': 8, 'eight': 8, '8': 8,
    'nau': 9, 'nine': 9, '9': 9,
    'das': 10, 'dus': 10, 'ten': 10, '10': 10,
    'pandrah': 15, 'fifteen': 15, '15': 15,
    'bees': 20, 'twenty': 20, '20': 20,
    'tees': 30, 'thirty': 30, '30': 30,
    'chalees': 40, 'chalis': 40, 'forty': 40, '40': 40,
    'pachaas': 50, 'pachas': 50, 'fifty': 50, '50': 50,
    'saath': 60, 'sixty': 60, '60': 60,
    'sattar': 70, 'seventy': 70, '70': 70,
    'assi': 80, 'eighty': 80, '80': 80,
    'navey': 90, 'ninety': 90, '90': 90,
    'sau': 100, 'so': 100, 'hundred': 100, '100': 100,
};

function parseQuantity(str, defaultVal = 1) {
    if (!str) return defaultVal;
    const clean = String(str).toLowerCase().trim();
    if (QTY_WORD_MAP[clean]) return QTY_WORD_MAP[clean];
    const n = parseInt(clean, 10);
    return isNaN(n) || n < 1 ? defaultVal : n;
}

/**
 * Deterministic multi-item extractor for food requests & add-ons.
 * Correctly identifies combinations like:
 *   "Fries krdo regular aik drink litre wali"
 *   "Regular fries aur aik litre drink add karo"
 *   "20x zinger burger aur 30x cold drinks 1.5 liter wali kr do"
 *   "15x chicken tandoori Party Size 20x Zeggy Burgers 50x Cold drinks kr do 1.5 liter wali"
 *
 * @param {string} text
 * @param {object} [activeCart]
 * @returns {{ items: Array<object>, hasMultiple: boolean, hasUnresolvedVariations: boolean, unresolvedItems: Array<object>, dealClarificationNeeded: boolean, clarificationPrompt?: string }}
 */
export function extractRequestedItems(text, activeCart = null) {
    if (!text || typeof text !== 'string') return { items: [], hasMultiple: false, hasUnresolvedVariations: false, unresolvedItems: [], dealClarificationNeeded: false };

    const lower = text.toLowerCase().trim();
    const extracted = [];
    const unresolvedItems = [];

    // Helper to check if a burger/pizza match is directly part of a deal mention
    const isItemPartOfDeal = (matchStr, idx) => {
        const before = lower.substring(Math.max(0, idx - 15), idx).trim();
        const after = lower.substring(idx + matchStr.length, Math.min(lower.length, idx + matchStr.length + 15)).trim();
        return /\b(?:deal|deals|meal|meals)(?:\s*#?\s*\d+)?$/i.test(before) ||
               /^(?:deal|deals|meal|meals)\b/i.test(after);
    };

    // 1. Detect Deals (e.g. "1 deal 3", "zinger deal 3", "deal 4", "deal 5")
    const dealRegex = /(?:\b(\d+|ak|aik|ek|ik|do|teen|two|three|four|five|fifteen|twenty|thirty|forty|fifty|\d+)\s*(?:x\s*)?)?(?:^|[^\w])(zinger\s*deal\s*[1-4]|burger\s*deal\s*[1-3]|deal\s*#?\s*[1-5]|burger\s*meal\s*for\s*[1-3]|pizza\s*meal\s*for\s*[1-4])\b/gi;
    let dMatch;
    while ((dMatch = dealRegex.exec(lower)) !== null) {
        const qty = parseQuantity(dMatch[1], 1);
        const rawDeal = dMatch[2].replace(/\s+/g, ' ').trim();
        let matchedDeal = null;
        if (/zinger\s*deal\s*3/i.test(rawDeal)) {
            matchedDeal = FALLBACK_DEALS.find(d => d.id === 'deal-zinger-3' || d.id === 'deal-12');
        } else if (/deal\s*#?\s*4/i.test(rawDeal)) {
            matchedDeal = FALLBACK_DEALS.find(d => d.id === 'deal-11'); // Deal 4 = 4 Zegy Burgers (Rs. 999)
        } else if (/deal\s*#?\s*3/i.test(rawDeal)) {
            matchedDeal = FALLBACK_DEALS.find(d => d.id === 'deal-10' || d.id === 'deal-3');
        } else if (/deal\s*#?\s*5/i.test(rawDeal)) {
            matchedDeal = FALLBACK_DEALS.find(d => d.id === 'deal-12');
        } else if (/deal\s*#?\s*1/i.test(rawDeal)) {
            matchedDeal = FALLBACK_DEALS.find(d => d.id === 'deal-8' || d.id === 'deal-1');
        } else if (/deal\s*#?\s*2/i.test(rawDeal)) {
            matchedDeal = FALLBACK_DEALS.find(d => d.id === 'deal-9' || d.id === 'deal-2');
        } else {
            matchedDeal = FALLBACK_DEALS.find(d => d.name.toLowerCase().includes(rawDeal));
        }

        if (matchedDeal) {
            extracted.push({
                itemType: 'deal',
                itemName: matchedDeal.name,
                canonicalName: matchedDeal.name,
                dealId: matchedDeal.id,
                quantity: qty,
                unitPrice: Number(matchedDeal.deal_price),
                lineTotal: Number(matchedDeal.deal_price) * qty,
            });
        }
    }

    // 2. Detect Burger Mentions (matches ALL burger occurrences: Zinger, Zegy)
    const burgerRegex = /(?:\b(\d+|ak|aik|ek|ik|do|teen|two|three|four|five|fifteen|twenty|thirty|forty|fifty|\d+)\s*(?:x\s*)?)?(?:^|[^\w])(zinger|ziggy|zegy|zeggy)\s*(?:burger|burgers)?\b/gi;
    let bMatch;
    while ((bMatch = burgerRegex.exec(lower)) !== null) {
        if (isItemPartOfDeal(bMatch[2], bMatch.index)) continue;

        const qty = parseQuantity(bMatch[1], 1);
        const isZegy = /ziggy|zegy|zeggy/i.test(bMatch[2]);
        const item = FALLBACK_MENU_ITEMS.find(it => isZegy ? it.id === 'item-20' : it.id === 'item-22');
        const unitPrice = Number(item?.base_price || (isZegy ? 399 : 499));
        extracted.push({
            itemType: 'burger',
            itemName: isZegy ? 'Zegy Burger' : 'Zinger Burger',
            canonicalName: isZegy ? 'Zegy Burger' : 'Zinger Burger',
            size: 'Standard',
            quantity: qty,
            menuItemId: item?.id || (isZegy ? 'item-20' : 'item-22'),
            variantId: item?.variants?.[0]?.id || (isZegy ? 'v-20-1' : 'v-22-1'),
            unitPrice,
            lineTotal: unitPrice * qty,
        });
    }

    // 3. Detect Fries Mentions
    const friesRegex = /(?:\b(\d+|ak|aik|ek|ik|do|teen|two|three|four|five|fifteen|twenty|thirty|forty|fifty|\d+)\s*(?:x\s*)?)?(?:^|[^\w])(?:(regular|reg|large|loaded|choti|bari|standard)\s+)?(?:fries|fris|fryz|fraies|french\s*fries)(?:\s+(regular|reg|large|loaded|standard))?\b/gi;
    let fMatch;
    while ((fMatch = friesRegex.exec(lower)) !== null) {
        const qty = parseQuantity(fMatch[1], 1);
        const candidateSize = (fMatch[2] || fMatch[3] || '').toLowerCase();
        let size = 'Regular';
        if (candidateSize.includes('large') || candidateSize.includes('bari')) {
            size = 'Large';
        } else if (candidateSize.includes('loaded') || lower.includes('loaded fries')) {
            size = 'Standard';
        }
        const isLoaded = size === 'Standard' && (candidateSize.includes('loaded') || lower.includes('loaded fries'));
        const menuItem = FALLBACK_MENU_ITEMS.find(it => isLoaded ? it.id === 'item-3' : it.id === 'item-1');
        const variant = (menuItem?.variants || []).find(v => v.name.toLowerCase() === size.toLowerCase()) || menuItem?.variants?.[0];
        const unitPrice = variant ? Number(variant.price) : (size === 'Large' ? 320 : 220);

        extracted.push({
            itemType: 'fries',
            itemName: isLoaded ? 'Loaded Fries' : 'Fries',
            canonicalName: isLoaded ? 'Loaded Fries' : `Fries (${size})`,
            size,
            quantity: qty,
            menuItemId: menuItem?.id || 'item-1',
            variantId: variant?.id || (size === 'Large' ? 'v-1-2' : 'v-1-1'),
            unitPrice,
            lineTotal: unitPrice * qty,
        });
    }

    // 4. Detect Chicken Box Mentions
    const boxRegex = /(?:\b(\d+|aik|ek|ik|do|teen|two|three|four|five|fifteen|twenty|thirty|forty|fifty|\d+)\s*(?:x\s*)?)?(?:^|[^\w])(half\s*box|happy\s*box|full\s*box|quarter\s*box|junior\s*chicken|chicken\s*piece)\b/gi;
    let bxMatch;
    while ((bxMatch = boxRegex.exec(lower)) !== null) {
        const qty = parseQuantity(bxMatch[1], 1);
        const boxNameLower = bxMatch[2].replace(/\s+/g, '-').toLowerCase();
        const boxMap = {
            'happy-box': { id: 'item-7', name: 'Happy Box', price: 599 },
            'quarter-box': { id: 'item-8', name: 'Quarter Box', price: 699 },
            'half-box': { id: 'item-9', name: 'Half Box', price: 1199 },
            'full-box': { id: 'item-10', name: 'Full Box', price: 2199 },
            'junior-chicken': { id: 'item-11', name: 'Junior Chicken', price: 349 },
            'chicken-piece': { id: 'item-6', name: 'Chicken Piece', price: 180 },
        };
        const boxInfo = boxMap[boxNameLower];
        if (boxInfo) {
            const item = FALLBACK_MENU_ITEMS.find(it => it.id === boxInfo.id);
            extracted.push({
                itemType: 'chicken_box',
                itemName: boxInfo.name,
                canonicalName: boxInfo.name,
                size: 'Standard',
                quantity: qty,
                menuItemId: boxInfo.id,
                variantId: item?.variants?.[0]?.id || null,
                unitPrice: boxInfo.price,
                lineTotal: boxInfo.price * qty,
            });
        }
    }

    // 5. Detect Standalone Pizzas (supports both [flavor] [size] and [size] [flavor])
    const pizzaRegex = /(?:\b(\d+|ak|aik|ek|ik|do|teen|two|three|four|five|fifteen|twenty|thirty|forty|fifty|\d+)\s*(?:x\s*)?)?(?:^|[^\w])(?:(small|medium|large|part[yei]?\s*size|prty\s*size|partysize|party|prty)\s+)?(?:chicken\s+)?(fajita|tikka|supreme|cheese\s*lover|tando?or[ie]?|extreme|peri\s*peri|behari(?:\s*kebab)?|crown\s*crust)(?:\s+pizza)?(?:\s+(small|medium|large|part[yei]?\s*size|prty\s*size|partysize|party|prty))?\b/gi;
    let pMatch;
    while ((pMatch = pizzaRegex.exec(lower)) !== null) {
        if (isItemPartOfDeal(pMatch[3], pMatch.index)) continue;

        const qty = parseQuantity(pMatch[1], 1);
        const sizeCandidate = (pMatch[2] || pMatch[4] || '').trim().toLowerCase();
        let size = sizeCandidate || null;
        if (!size) {
            if (lower.includes('large') || lower.includes('bari')) size = 'large';
            else if (lower.includes('medium') || lower.includes('darmiyani')) size = 'medium';
            else if (lower.includes('party') || lower.includes('prty') || lower.includes('part size')) size = 'party size';
            else if (lower.includes('small') || lower.includes('choti')) size = 'small';
        }
        const normalizedSize = size ? (size.includes('party') || size.includes('prty') || size.includes('part') ? 'Party Size' : size.charAt(0).toUpperCase() + size.slice(1)) : 'Large';

        const rawFlav = pMatch[3].trim().toLowerCase();
        const flavMap = {
            'fajita': { id: 'item-31', name: 'Chicken Fajita' },
            'tikka': { id: 'item-29', name: 'Chicken Tikka' },
            'supreme': { id: 'item-30', name: 'Chicken Supreme' },
            'cheese lover': { id: 'item-28', name: 'Cheese Lover' },
            'tandori': { id: 'item-32', name: 'Chicken Tandori' },
            'tandoori': { id: 'item-32', name: 'Chicken Tandori' },
            'extreme': { id: 'item-38', name: 'Chicken Extreme' },
            'peri peri': { id: 'item-39', name: 'Peri Peri' },
            'behari': { id: 'item-37', name: 'Behari Kebab Pizza' },
            'behari kebab': { id: 'item-37', name: 'Behari Kebab Pizza' },
            'crown crust': { id: 'item-40', name: 'Crown Crust' },
        };
        const pInfo = flavMap[rawFlav];
        if (pInfo) {
            const item = FALLBACK_MENU_ITEMS.find(it => it.id === pInfo.id);
            const variant = (item?.variants || []).find(v => v.name.toLowerCase() === normalizedSize.toLowerCase()) || item?.variants?.[0];
            const unitPrice = Number(variant?.price || item?.base_price || 1499);
            extracted.push({
                itemType: 'pizza',
                itemName: item ? item.name : pInfo.name,
                canonicalName: `${item ? item.name : pInfo.name} (${normalizedSize})`,
                size: normalizedSize,
                quantity: qty,
                menuItemId: pInfo.id,
                variantId: variant?.id || null,
                unitPrice,
                lineTotal: unitPrice * qty,
            });
        }
    }

    // 6. Detect Drink Mentions
    const hasDrinkWord = /\b(?:drinks?|cold\s*drinks?|soft\s*drinks?|pepsi|coke|next\s*cola|7up|mirinda|dew|sprite)\b/i.test(lower);
    if (hasDrinkWord) {
        let size = null;
        if (/\b(?:1\.5\s*liter|1\.5\s*litre|1\.5l|dedh\s*litre|dedh\s*liter|1\.5)\b/i.test(lower)) {
            size = '1.5 Liter';
        } else if (/\b(?:can|tin|cans)\b/i.test(lower)) {
            size = 'Can';
        } else if (/\b(?:regular|reg|choti)\b/i.test(lower)) {
            size = 'Regular';
        } else if (/\b(?:1\s*liter|1\s*litre|1l|liter\s*wali|litre\s*wali|liter|litre)\b/i.test(lower)) {
            size = '1 Liter';
        }

        let qty = 1;
        const drinkQtyMatch = lower.match(/(?:\b(\d+|ak|aik|ek|ik|do|teen|two|three|four|five|fifteen|twenty|thirty|forty|fifty|\d+)\s*(?:x\s*)?)(?:(?:1\s*liter|1\.5\s*liter|regular|can|tin|soft|cold|sift|suft)\s+)*(?:drinks?|pepsi|coke|next\s*cola|7up|dew|sprite|mirinda)\b/i) ||
                             lower.match(/(?:drinks?|cold\s*drinks?|soft\s*drinks?|pepsi|coke)\s*(?:(?:1\.5\s*liter|1\.5\s*litre|1\s*liter|1\s*litre|can|regular|tin|litre|liter)\s*(?:wali|wale)?\s*)?(\d+|ak|aik|ek|ik|1)\b/i) ||
                             lower.match(/(?:^|\n)\s*(\d+)\s*(?:x\s*)?(?:(?:soft|cold|sift|suft)\s+)*(?:drinks?|pepsi|coke)/i);
        if (drinkQtyMatch) {
            qty = parseQuantity(drinkQtyMatch[1], 1);
        }

        const drinkItem = FALLBACK_MENU_ITEMS.find(it => it.id === 'item-34');
        if (size) {
            const variant = (drinkItem?.variants || []).find(v => v.name.toLowerCase() === size.toLowerCase()) ||
                            (size === '1 Liter' ? { id: 'v-34-3', price: 200 } : (size === '1.5 Liter' ? { id: 'v-34-4', price: 240 } : { id: 'v-34-1', price: 110 }));
            const unitPrice = Number(variant?.price || (size === '1 Liter' ? 200 : (size === '1.5 Liter' ? 240 : 110)));
            extracted.push({
                itemType: 'drink',
                itemName: 'Soft Drink',
                canonicalName: `Soft Drink (${size})`,
                size,
                quantity: qty,
                menuItemId: 'item-34',
                variantId: variant?.id || 'v-34-3',
                unitPrice,
                lineTotal: unitPrice * qty,
            });
        } else {
            unresolvedItems.push({
                itemType: 'drink',
                itemName: 'Soft Drink',
                canonicalName: 'Soft Drink',
                size: null,
                requiresSizeSelection: true,
                quantity: qty,
                menuItemId: 'item-34',
                itemObj: drinkItem,
            });
        }
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
        hasMultiple: (extracted.length + unresolvedItems.length) > 1,
        hasUnresolvedVariations: unresolvedItems.length > 0,
        unresolvedItems,
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

    const { resolveMenuItemOrDeal } = await import('./menuService.js');
    const { matchVariant } = await import('./cartService.js');

    for (const it of items) {
        try {
            let mId = it.menuItemId || null;
            let dId = it.dealId || null;
            let vId = it.variantId || null;
            let qty = parseInt(it.quantity || 1, 10);
            if (isNaN(qty) || qty < 1) qty = 1;
            let notes = it.notes || null;

            // Resolve name if IDs missing
            const nameQuery = (it.itemName || it.canonicalName || it.name || '').trim();
            if (!mId && !dId && nameQuery) {
                const resolved = await resolveMenuItemOrDeal(nameQuery, restId);
                if (resolved && resolved.status === 'EXACT_MATCH') {
                    if (resolved.type === 'DEAL') {
                        dId = resolved.deal?.id;
                        if (resolved.flavourNotes) notes = notes ? `${notes}, ${resolved.flavourNotes}` : resolved.flavourNotes;
                    } else if (resolved.type === 'ITEM') {
                        mId = resolved.item?.id;
                        if (resolved.variant) {
                            vId = resolved.variant.id;
                        } else {
                            const vName = it.size || it.variantName || it.variant || null;
                            if (resolved.item?.variants && resolved.item.variants.length > 0) {
                                const matchedVar = matchVariant(resolved.item.variants, vName);
                                if (matchedVar) vId = matchedVar.id;
                                else if (resolved.item.variants.length === 1) vId = resolved.item.variants[0].id;
                            }
                        }
                    }
                } else if (resolved?.item) {
                    mId = resolved.item.id;
                    const vName = it.size || it.variantName || it.variant || null;
                    if (resolved.item.variants && resolved.item.variants.length > 0) {
                        const matchedVar = matchVariant(resolved.item.variants, vName);
                        if (matchedVar) vId = matchedVar.id;
                        else if (resolved.item.variants.length === 1) vId = resolved.item.variants[0].id;
                    }
                }
            }

            if (!mId && !dId) {
                console.warn(`[ADDON_SERVICE] Could not resolve product "${nameQuery}" to valid database ID`);
                failed.push({ item: it, error: `Could not resolve product "${nameQuery}"` });
                continue;
            }

            await addItemToCart({
                sessionKey,
                restaurantId: restId,
                chatId,
                verifiedPhone,
                menuItemId: mId,
                variantId: vId,
                dealId: dId,
                quantity: qty,
                notes,
            });
            added.push({ ...it, menuItemId: mId, dealId: dId, variantId: vId, quantity: qty });
        } catch (err) {
            console.error(`[ADDON_SERVICE] Failed to add item ${it.canonicalName || it.itemName}:`, err.message);
            failed.push({ item: it, error: err.message });
        }
    }

    const updatedCart = await getActiveCart({ sessionKey, restaurantId: restId, chatId });
    const totals = await calculateCartTotals({ sessionKey, restaurantId: restId, chatId });

    // Verify all added items are present in cart
    const allVerified = added.every(it => {
        return updatedCart.items.some(ci => {
            const matchesItem = it.menuItemId && (ci.menu_item_id === it.menuItemId || ci.menu_item?.id === it.menuItemId || ci.menu_item?.slug === it.menuItemId);
            const matchesDeal = it.dealId && (ci.deal_id === it.dealId || ci.deal?.id === it.dealId || ci.deal?.slug === it.dealId);
            if (!matchesItem && !matchesDeal) return false;
            if (it.variantId) {
                return ci.menu_variant_id === it.variantId || ci.menu_variant?.id === it.variantId;
            }
            return true;
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

