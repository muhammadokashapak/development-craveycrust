/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║   Deal Flavour Service — src/services/dealFlavourService.js  ║
 * ║   Enables customer flavour customization for Deals in RMS   ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

export const CLASSIC_PIZZA_FLAVOURS = [
    {
        name: 'Chicken Tikka',
        slug: 'chicken-tikka',
        regex: /\b(?:chicken\s*)?tikk?a+h?s?\b/i,
    },
    {
        name: 'Chicken Fajita',
        slug: 'chicken-fajita',
        regex: /\b(?:chicken\s*)?faj[ie]ta+h?s?\b/i,
    },
    {
        name: 'Chicken Supreme',
        slug: 'chicken-supreme',
        regex: /\b(?:chicken\s*)?supr[ie]me?s?\b/i,
    },
    {
        name: 'Cheese Lover',
        slug: 'cheese-lover',
        regex: /\b(?:cheese\s*lovers?|cheesy\s*lovers?|chees\s*lovers?|plain\s*cheese|extra\s*cheese|cheese)\b/i,
    },
    {
        name: 'Chicken Tandori',
        slug: 'chicken-tandori',
        regex: /\b(?:chicken\s*)?tando?ori?s?\b/i,
    },
];

export const PREMIUM_PIZZA_FLAVOURS = [
    {
        name: 'Chicken Extreme',
        slug: 'chicken-extreme',
        regex: /\b(?:chicken\s*)?extr[e|m]me?s?\b/i,
    },
    {
        name: 'Peri Peri Pizza',
        slug: 'peri-peri',
        regex: /\bperi(?:\s*[-]?\s*peri)?(?:\s*pizzas?)?\b/i,
    },
    {
        name: 'Behari Kebab Pizza',
        slug: 'behari-kebab',
        regex: /\b(?:behari|bihari)(?:\s*kebabs?)?(?:\s*pizzas?)?\b/i,
    },
    {
        name: 'Crown Crust',
        slug: 'crown-crust',
        regex: /\bcrown(?:\s*crusts?)?\b/i,
    },
    {
        name: 'Stuffed Crust',
        slug: 'stuffed-crust',
        regex: /\bstuff(?:ed)?(?:\s*crusts?)?\b/i,
    },
];

export const AVAILABLE_PIZZA_FLAVOURS = [
    ...CLASSIC_PIZZA_FLAVOURS,
    ...PREMIUM_PIZZA_FLAVOURS,
];

/**
 * Checks if a deal is a Pizza Deal or contains pizza items that require flavour choice.
 *
 * @param {Object|string} dealOrName
 * @returns {boolean}
 */
export function isPizzaDeal(dealOrName) {
    if (!dealOrName) return false;
    const name = typeof dealOrName === 'string' ? dealOrName : (dealOrName.name || dealOrName.slug || '');
    const lower = name.toLowerCase();

    // Direct name patterns: "Deal 1", "Deal 2", "Deal 3", "Pizza Meal For 1/2/3/4", "Pizza Deal"
    if (/\b(?:pi[z]+a\s*(?:meal|deal)|deal\s*#?[1-3])\b/i.test(lower)) {
        return true;
    }
    if (lower.includes('pizza') && (lower.includes('deal') || lower.includes('meal'))) {
        return true;
    }

    // Check deal items if provided (inspect both deal_items and items)
    if (typeof dealOrName === 'object') {
        const itemsList = dealOrName.deal_items || dealOrName.items || [];
        if (Array.isArray(itemsList)) {
            return itemsList.some(di => {
                const itemName = (di.menu_item?.name || di.item_name || di.custom_name || di.name || '').toLowerCase();
                const catName = (di.menu_item?.category?.name || di.category_name || '').toLowerCase();
                const catId = di.menu_item?.category_id || di.category_id || '';
                const itemId = di.menu_item_id || di.itemId || di.menu_item?.id || '';
                return itemName.includes('pizza') || catName.includes('pizza') || catId === 'cat-9' || catId === 'cat-10' || itemId === 'item-33' || itemId === 'item-36';
            });
        }
    }

    return false;
}

/**
 * Extracts pizza details from a deal (count of pizzas, size, and category type: CLASSIC, PREMIUM, or ALL).
 *
 * @param {Object|string} dealOrName
 * @returns {{ isPizzaDeal: boolean, pizzaCount: number, sizeName: string, dealName: string, pizzaType: 'CLASSIC'|'PREMIUM'|'ALL' }}
 */
export function getDealPizzaInfo(dealOrName) {
    if (!isPizzaDeal(dealOrName)) {
        return { isPizzaDeal: false, pizzaCount: 0, sizeName: '', dealName: '', pizzaType: 'ALL' };
    }

    const name = typeof dealOrName === 'string' ? dealOrName : (dealOrName.name || '');
    const lower = name.toLowerCase();

    let pizzaCount = 1;
    let sizeName = 'Pizza';
    let hasClassic = false;
    let hasPremium = false;

    if (lower.includes('premium')) hasPremium = true;
    if (lower.includes('classic')) hasClassic = true;

    // 1. Check known Cravey Crust catalog specs
    if (/\bdeal\s*#?1\b/i.test(lower)) {
        pizzaCount = 2;
        sizeName = 'Small';
        hasClassic = true;
    } else if (/\bdeal\s*#?2\b/i.test(lower)) {
        pizzaCount = 2;
        sizeName = 'Medium';
        hasClassic = true;
    } else if (/\bdeal\s*#?3\b/i.test(lower)) {
        pizzaCount = 2;
        sizeName = 'Large';
        hasClassic = true;
    } else if (/\bpi[z]+a\s*(?:meal|deal)\s*(?:for\s*)?1\b/i.test(lower)) {
        pizzaCount = 1;
        sizeName = 'Small';
        hasClassic = true;
    } else if (/\bpi[z]+a\s*(?:meal|deal)\s*(?:for\s*)?2\b/i.test(lower)) {
        pizzaCount = 1;
        sizeName = 'Medium';
        hasClassic = true;
    } else if (/\bpi[z]+a\s*(?:meal|deal)\s*(?:for\s*)?3\b/i.test(lower)) {
        pizzaCount = 1;
        sizeName = 'Large';
        hasClassic = true;
    } else if (/\bpi[z]+a\s*(?:meal|deal)\s*(?:for\s*)?4\b/i.test(lower)) {
        pizzaCount = 1;
        sizeName = 'Party Size';
        hasClassic = true;
    }

    // Dynamic inspection of deal_items or items
    if (typeof dealOrName === 'object') {
        const itemsList = dealOrName.deal_items || dealOrName.items || [];
        if (Array.isArray(itemsList) && itemsList.length > 0) {
            let count = 0;
            let detectedSize = '';
            for (const di of itemsList) {
                const iName = (di.menu_item?.name || di.item_name || di.custom_name || di.name || '').toLowerCase();
                const catName = (di.menu_item?.category?.name || di.category_name || '').toLowerCase();
                const catId = di.menu_item?.category_id || di.category_id || '';
                const itemId = di.menu_item_id || di.itemId || di.menu_item?.id || '';

                const isPizza = iName.includes('pizza') || catName.includes('pizza') || catId === 'cat-9' || catId === 'cat-10' || itemId === 'item-33' || itemId === 'item-36';
                if (isPizza) {
                    const qty = di.quantity || di.qty || 1;
                    count += qty;
                    if (!detectedSize && (di.menu_variant?.name || di.variant_name)) {
                        detectedSize = di.menu_variant?.name || di.variant_name;
                    }
                    if (iName.includes('premium') || catName.includes('premium') || catId === 'cat-9' || itemId === 'item-36') {
                        hasPremium = true;
                    }
                    if (iName.includes('classic') || catName.includes('classic') || catId === 'cat-10' || itemId === 'item-33') {
                        hasClassic = true;
                    }
                }
            }
            if (count > 0) {
                pizzaCount = count;
                if (detectedSize) sizeName = detectedSize;
            }
        }
    }

    let pizzaType = 'ALL';
    if (hasPremium && !hasClassic) {
        pizzaType = 'PREMIUM';
    } else if (hasClassic && !hasPremium) {
        pizzaType = 'CLASSIC';
    } else if (hasPremium && hasClassic) {
        pizzaType = 'ALL';
    } else {
        pizzaType = 'CLASSIC';
    }

    return {
        isPizzaDeal: true,
        pizzaCount,
        sizeName,
        dealName: name,
        pizzaType,
    };
}

/**
 * Extracts pizza flavours from user message text.
 *
 * @param {string} text
 * @param {number} [targetPizzaCount=1]
 * @returns {string[]} Array of matched flavour names
 */
export function extractFlavoursFromText(text, targetPizzaCount = 1) {
    if (!text || typeof text !== 'string') return [];
    const lower = text.toLowerCase().trim();

    // Check for "dono [flavour]" or "[flavour] dono" or "same [flavour]"
    const isBothSame = /\b(?:dono|both|same|2\s*x|do\s*hi|dono\s*hi|aik\s*jaise|ek\s*jaise|same\s*hi|dono\s*me|dono\s*mein|2\s*pizzas?|do\s*pizzas?)\b/i.test(lower);

    const matches = [];

    // Find occurrences of all flavours in the text with their positions
    for (const flv of AVAILABLE_PIZZA_FLAVOURS) {
        const regex = new RegExp(flv.regex.source, 'gi');
        let match;
        while ((match = regex.exec(lower)) !== null) {
            matches.push({
                name: flv.name,
                index: match.index,
                length: match[0].length,
            });
        }
    }

    if (matches.length === 0) {
        return [];
    }

    // Sort by appearance index
    matches.sort((a, b) => a.index - b.index);

    // Filter overlapping matches (e.g. "cheese" inside "cheese lover")
    const nonOverlapping = [];
    for (const m of matches) {
        const overlap = nonOverlapping.some(
            existing => (m.index >= existing.index && m.index < existing.index + existing.length) ||
                        (existing.index >= m.index && existing.index < m.index + m.length)
        );
        if (!overlap) {
            nonOverlapping.push(m);
        }
    }

    const matchedNames = nonOverlapping.map(m => m.name);

    if (isBothSame && matchedNames.length >= 1) {
        // Customer specified same flavour for both (e.g. "dono tikka")
        return [matchedNames[0], matchedNames[0]];
    }

    if (matchedNames.length >= targetPizzaCount) {
        return matchedNames.slice(0, targetPizzaCount);
    }

    // If deal needs 2 pizzas and customer only provided 1 flavour (e.g. "chicken tikka"):
    // Treat as both pizzas in that flavour
    if (targetPizzaCount === 2 && matchedNames.length === 1) {
        return [matchedNames[0]];
    }

    return matchedNames;
}

/**
 * Formats extracted flavours into a readable string for notes / cart / kitchen order.
 *
 * @param {string[]} flavours
 * @returns {string} e.g. "Flavour: Chicken Tikka" or "Flavours: Chicken Tikka & Chicken Fajita"
 */
export function formatFlavourNotes(flavours) {
    if (!flavours || flavours.length === 0) return '';
    if (flavours.length === 1) {
        return `Flavour: ${flavours[0]}`;
    }
    if (flavours.length === 2) {
        if (flavours[0].toLowerCase() === flavours[1].toLowerCase()) {
            return `Flavours: 2x ${flavours[0]}`;
        }
        return `Flavours: ${flavours[0]} & ${flavours[1]}`;
    }
    return `Flavours: ${flavours.join(', ')}`;
}

/**
 * Generates an appetizing, polite Roman Urdu prompt asking customer for their flavour choice.
 *
 * @param {Object} deal
 * @param {{ pizzaCount: number, sizeName: string }} pizzaInfo
 * @returns {string}
 */
export function formatDealFlavourPrompt(deal, pizzaInfo) {
    const dealName = deal.name || 'Deal';
    const sizeStr = pizzaInfo.sizeName ? ` ${pizzaInfo.sizeName}` : '';
    const pizzaCount = pizzaInfo.pizzaCount || 1;
    const pizzaType = pizzaInfo.pizzaType || 'CLASSIC';

    let header = '';
    let flvList = '';
    let footer = '';

    if (pizzaType === 'PREMIUM') {
        if (pizzaCount === 1) {
            header = `Zabardast choice! *${dealName}* mein 1x${sizeStr} *Premium Pizza* shamil hai. 🍕\n\n*Aap Premium Pizza ka kaunsa flavour lena chahenge?*`;
        } else {
            header = `Zabardast choice! *${dealName}* mein ${pizzaCount}x${sizeStr} *Premium Pizzas* shamil hain. 🍕\n\n*Aap in ${pizzaCount} Premium Pizzas ke liye kaunse flavours lena chahenge?*`;
        }

        flvList = PREMIUM_PIZZA_FLAVOURS.map(f => `• ${f.name}`).join('\n');

        if (pizzaCount > 1) {
            footer = `_(Aap ${pizzaCount} alag alag flavours bhi chun sakte hain jaise *'Chicken Extreme aur Peri Peri'* ya dono ek jaise jaise *'Dono Extreme'*!)_ 😊`;
        } else {
            footer = `_(Apna pasandeeda Premium flavour reply karein, jaise *'Chicken Extreme'* ya *'Behari Kebab'*)_ 😊`;
        }
    } else if (pizzaType === 'CLASSIC') {
        if (pizzaCount === 1) {
            header = `Zabardast choice! *${dealName}* mein 1x${sizeStr} *Classic Pizza* shamil hai. 🍕\n\n*Aap Classic Pizza ka kaunsa flavour lena chahenge?*`;
        } else {
            header = `Zabardast choice! *${dealName}* mein ${pizzaCount}x${sizeStr} *Classic Pizzas* shamil hain. 🍕\n\n*Aap in ${pizzaCount} Classic Pizzas ke liye kaunse flavours lena chahenge?*`;
        }

        flvList = CLASSIC_PIZZA_FLAVOURS.map(f => `• ${f.name}`).join('\n');

        if (pizzaCount > 1) {
            footer = `_(Aap ${pizzaCount} alag alag flavours bhi chun sakte hain jaise *'Tikka aur Fajita'* ya dono ek jaise jaise *'Dono Tikka'*!)_ 😊`;
        } else {
            footer = `_(Apna pasandeeda Classic flavour reply karein, jaise *'Chicken Tikka'* ya *'Chicken Supreme'*)_ 😊`;
        }
    } else {
        // Mixed or unspecified
        if (pizzaCount === 1) {
            header = `Zabardast choice! *${dealName}* mein 1x${sizeStr} Pizza shamil hai. 🍕\n\n*Aap pizza ka kaunsa flavour lena chahenge?*`;
        } else {
            header = `Zabardast choice! *${dealName}* mein ${pizzaCount}x${sizeStr} Pizzas shamil hain. 🍕\n\n*Aap in ${pizzaCount} pizzas ke liye kaunse flavours lena chahenge?*`;
        }

        flvList = `*Classic Flavours:*\n` +
            CLASSIC_PIZZA_FLAVOURS.map(f => `• ${f.name}`).join('\n') +
            `\n\n*Premium Flavours:*\n` +
            PREMIUM_PIZZA_FLAVOURS.map(f => `• ${f.name}`).join('\n');

        if (pizzaCount > 1) {
            footer = `_(Aap ${pizzaCount} alag alag flavours chun sakte hain jaise *'Tikka aur Extreme'*)_ 😊`;
        } else {
            footer = `_(Apna pasandeeda flavour reply karein, jaise *'Chicken Tikka'* ya *'Chicken Extreme'*)_ 😊`;
        }
    }

    return `${header}\n\n${flvList}\n\n${footer}`;
}

export function formatSingleFlavourConfirmationPrompt(flavourName, pizzaInfo = {}) {
    const isPremium = pizzaInfo.pizzaType === 'PREMIUM';
    const altFlavours = isPremium
        ? 'Chicken Extreme, Peri Peri, Behari Kebab, Crown Crust, ya Stuffed Crust'
        : 'Chicken Tikka, Chicken Supreme, Cheese Lover, ya Chicken Tandori';
    return `Aap ne ${flavourName} select kiya hai. Kya dono pizzas ${flavourName} rakhne hain ya doosre pizza ke liye koi aur flavour chunna chahenge (jaise ${altFlavours})?`;
}

// ─── Session State for Pending Deal Flavour ───────────────────────────────
const _pendingDealFlavourBySession = new Map();
const FLAVOUR_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export function setPendingDealFlavour(sessionKey, { deal, quantity = 1, pizzaInfo, firstFlavour = null }) {
    if (!sessionKey) return;
    _pendingDealFlavourBySession.set(sessionKey, {
        deal,
        quantity,
        pizzaInfo,
        firstFlavour: firstFlavour || null,
        timestamp: Date.now(),
    });
}

export function getPendingDealFlavour(sessionKey) {
    if (!sessionKey || !_pendingDealFlavourBySession.has(sessionKey)) return null;
    const entry = _pendingDealFlavourBySession.get(sessionKey);
    if (Date.now() - entry.timestamp > FLAVOUR_TIMEOUT_MS) {
        _pendingDealFlavourBySession.delete(sessionKey);
        return null;
    }
    return entry;
}

export function clearPendingDealFlavour(sessionKey) {
    if (!sessionKey) return;
    _pendingDealFlavourBySession.delete(sessionKey);
}

/**
 * Checks if a message text is likely a flavour selection response.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function isFlavourResponse(text) {
    if (!text || typeof text !== 'string') return false;
    const lower = text.toLowerCase().trim();
    // Must match at least one flavour keyword
    return AVAILABLE_PIZZA_FLAVOURS.some(f => f.regex.test(lower));
}

export function clearAllDealFlavourCaches() {
    _pendingDealFlavourBySession.clear();
    console.log('[DEAL_FLAVOUR] All deal flavour caches cleared.');
}
