/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║   Deal Flavour Service — src/services/dealFlavourService.js  ║
 * ║   Enables customer flavour customization for Deals in RMS   ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

export const AVAILABLE_PIZZA_FLAVOURS = [
    {
        name: 'Chicken Tikka',
        slug: 'chicken-tikka',
        regex: /\b(?:chicken\s*)?tikk?a+h?\b/i,
    },
    {
        name: 'Chicken Fajita',
        slug: 'chicken-fajita',
        regex: /\b(?:chicken\s*)?faj[ie]ta+h?\b/i,
    },
    {
        name: 'Chicken Supreme',
        slug: 'chicken-supreme',
        regex: /\b(?:chicken\s*)?supr[ie]me\b/i,
    },
    {
        name: 'Cheese Lover',
        slug: 'cheese-lover',
        regex: /\b(?:cheese\s*lover|cheesy\s*lover|chees\s*lover|plain\s*cheese|extra\s*cheese|cheese)\b/i,
    },
    {
        name: 'Chicken Tandori',
        slug: 'chicken-tandori',
        regex: /\b(?:chicken\s*)?tando?ori\b/i,
    },
    {
        name: 'Behari Kebab Pizza',
        slug: 'behari-kebab',
        regex: /\b(?:behari|bihari)(?:\s*kebab)?(?:\s*pizza)?\b/i,
    },
    {
        name: 'Chicken Extreme',
        slug: 'chicken-extreme',
        regex: /\b(?:chicken\s*)?extr[e|m]me\b/i,
    },
    {
        name: 'Crown Crust',
        slug: 'crown-crust',
        regex: /\bcrown(?:\s*crust)?\b/i,
    },
    {
        name: 'Peri Peri Pizza',
        slug: 'peri-peri',
        regex: /\bperi(?:\s*[-]?\s*peri)?(?:\s*pizza)?\b/i,
    },
    {
        name: 'Stuffed Crust',
        slug: 'stuffed-crust',
        regex: /\bstuff(?:ed)?(?:\s*crust)?\b/i,
    },
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

    // Check deal items if provided
    if (typeof dealOrName === 'object' && Array.isArray(dealOrName.deal_items)) {
        return dealOrName.deal_items.some(di => {
            const itemName = (di.menu_item?.name || di.custom_name || '').toLowerCase();
            const catName = (di.menu_item?.category?.name || '').toLowerCase();
            return itemName.includes('pizza') || catName.includes('pizza');
        });
    }

    return false;
}

/**
 * Extracts pizza details from a deal (count of pizzas and size).
 *
 * @param {Object|string} dealOrName
 * @returns {{ isPizzaDeal: boolean, pizzaCount: number, sizeName: string, dealName: string }}
 */
export function getDealPizzaInfo(dealOrName) {
    if (!isPizzaDeal(dealOrName)) {
        return { isPizzaDeal: false, pizzaCount: 0, sizeName: '', dealName: '' };
    }

    const name = typeof dealOrName === 'string' ? dealOrName : (dealOrName.name || '');
    const lower = name.toLowerCase();

    let pizzaCount = 1;
    let sizeName = 'Pizza';

    // 1. Check known Cravey Crust catalog specs
    if (/\bdeal\s*#?1\b/i.test(lower)) {
        pizzaCount = 2;
        sizeName = 'Small';
    } else if (/\bdeal\s*#?2\b/i.test(lower)) {
        pizzaCount = 2;
        sizeName = 'Medium';
    } else if (/\bdeal\s*#?3\b/i.test(lower)) {
        pizzaCount = 2;
        sizeName = 'Large';
    } else if (/\bpi[z]+a\s*(?:meal|deal)\s*(?:for\s*)?1\b/i.test(lower)) {
        pizzaCount = 1;
        sizeName = 'Small';
    } else if (/\bpi[z]+a\s*(?:meal|deal)\s*(?:for\s*)?2\b/i.test(lower)) {
        pizzaCount = 1;
        sizeName = 'Medium';
    } else if (/\bpi[z]+a\s*(?:meal|deal)\s*(?:for\s*)?3\b/i.test(lower)) {
        pizzaCount = 1;
        sizeName = 'Large';
    } else if (/\bpi[z]+a\s*(?:meal|deal)\s*(?:for\s*)?4\b/i.test(lower)) {
        pizzaCount = 1;
        sizeName = 'Party Size';
    } else if (typeof dealOrName === 'object' && Array.isArray(dealOrName.deal_items)) {
        // Dynamic inspection of deal_items
        let count = 0;
        let detectedSize = '';
        for (const di of dealOrName.deal_items) {
            const iName = (di.menu_item?.name || '').toLowerCase();
            const catName = (di.menu_item?.category?.name || '').toLowerCase();
            if (iName.includes('pizza') || catName.includes('pizza')) {
                const qty = di.quantity || 1;
                count += qty;
                if (!detectedSize && di.menu_variant?.name) {
                    detectedSize = di.menu_variant.name;
                }
            }
        }
        if (count > 0) {
            pizzaCount = count;
            if (detectedSize) sizeName = detectedSize;
        }
    }

    return {
        isPizzaDeal: true,
        pizzaCount,
        sizeName,
        dealName: name,
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
    const isBothSame = /\b(?:dono|both|same|2\s*x|do\s*hi|dono\s*hi)\b/i.test(lower);

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
        return [matchedNames[0], matchedNames[0]];
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

    let header = '';
    if (pizzaCount === 1) {
        header = `Zabardast choice! *${dealName}* mein 1x${sizeStr} Pizza shamil hai. 🍕\n\n*Aap pizza ka kaunsa flavour lena chahenge?*`;
    } else {
        header = `Zabardast choice! *${dealName}* mein ${pizzaCount}x${sizeStr} Pizzas shamil hain. 🍕\n\n*Aap in ${pizzaCount} pizzas ke liye kaunse flavours lena chahenge?*`;
    }

    const flvList =
`• Chicken Tikka
• Chicken Fajita
• Chicken Supreme
• Cheese Lover
• Chicken Tandori
• Behari Kebab Pizza
• Chicken Extreme`;

    let footer = '';
    if (pizzaCount > 1) {
        footer = `_(Aap ${pizzaCount} alag alag flavours bhi chun sakte hain jaise *'Tikka aur Fajita'* ya dono ek hi flavour jaise *'Dono Tikka'*!)_ 😊`;
    } else {
        footer = `_(Bas apna pasandeeda flavour reply karein, jaise *'Chicken Tikka'* ya *'Fajita'*)_ 😊`;
    }

    return `${header}\n\n${flvList}\n\n${footer}`;
}

// ─── Session State for Pending Deal Flavour ───────────────────────────────
const _pendingDealFlavourBySession = new Map();
const FLAVOUR_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export function setPendingDealFlavour(sessionKey, { deal, quantity = 1, pizzaInfo }) {
    if (!sessionKey) return;
    _pendingDealFlavourBySession.set(sessionKey, {
        deal,
        quantity,
        pizzaInfo,
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
