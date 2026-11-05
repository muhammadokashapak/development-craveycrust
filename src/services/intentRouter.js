/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║   Intent Router & Contextual Query Resolver                  ║
 * ║   src/services/intentRouter.js                               ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Responsibilities:
 *   1. Context-aware intent classification into 11 strict categories.
 *   2. Strict separation of READ (information requests) vs WRITE (cart/order modifications).
 *   3. Contextual reference resolution ("is mein", "deal mein", "wohi deal", "already included?").
 *   4. Authoritative backend deal & cart component answers (zero hallucination, zero extra tokens).
 *   5. Safeguards against false add-item prompts when customer asks a question.
 */

import { getActiveCart } from './cartService.js';
import { getActiveDeals } from './menuService.js';
import { DEAL_COMPOSITIONS } from './addonExtractionService.js';
import { calculateCartTotals } from './cartService.js';
import { getCatalogCache } from './catalogCacheService.js';
import { getLastDiscussedDeal, getLastDiscussedItem } from './intentParser.js';

export const INTENTS = {
    MENU_QUERY: 'MENU_QUERY',
    DEAL_QUERY: 'DEAL_QUERY',
    CART_QUERY: 'CART_QUERY',
    ADD_ITEM: 'ADD_ITEM',
    REMOVE_ITEM: 'REMOVE_ITEM',
    UPDATE_ITEM: 'UPDATE_ITEM',
    CUSTOMER_DETAILS: 'CUSTOMER_DETAILS',
    DELIVERY_QUERY: 'DELIVERY_QUERY',
    PAYMENT_QUERY: 'PAYMENT_QUERY',
    ORDER_CONFIRMATION: 'ORDER_CONFIRMATION',
    ORDER_STATUS_QUERY: 'ORDER_STATUS_QUERY',
    CANCEL_ORDER: 'CANCEL_ORDER',
    PROVIDE_PHONE: 'PROVIDE_PHONE',
    PROVIDE_ADDRESS: 'PROVIDE_ADDRESS',
    PROVIDE_NAME: 'PROVIDE_NAME',
    GENERAL_CONVERSATION: 'GENERAL_CONVERSATION',
};

// Words indicating inquiry / question / read intent
const INQUIRY_WORDS_REGEX = /\b(?:kya|kia|konsi|konsa|konse|which|what|included|shamil|already|pehle\s*se|mojood|hai\s*\?|hain\s*\?|bhi\s*hai|hota\s*hai|hoti\s*hai|milti\s*hai|milta\s*hai|milte\s*hain|aati\s*hai|aata\s*hai|kya\s*hai|kia\s*hai|batao|bataen|batayein|details?|size|kitne|kitni|kitna|total|bill|rate|rates|price|prices|charges)\b/i;

// Contextual pronouns pointing to active deal / cart item
const CONTEXTUAL_PRONOUNS_REGEX = /\b(?:is\s*me|is\s*mein|iss\s*me|iss\s*mein|isme|ismein|us\s*me|us\s*mein|usme|usmein|is\s*deal|iss\s*deal|ye\s*deal|yeh\s*deal|deal\s*me|deal\s*mein|wo\s*deal|wohi\s*deal|wahi\s*deal|is\s*meal|iss\s*meal|ye\s*meal|yeh\s*meal|combo\s*mein|package\s*mein)\b/i;

// Words indicating explicit cart / order addition
const ADD_COMMAND_REGEX = /\b(?:add|order|mangwao|mangwana|daal\s*do|daal\s*dein|kr\s*d[ao]|kar\s*d[ao]|kardo|krdo|krdu|kardu|karein|kar\s*dein|kr\s*dein|kar\s*dain|kr\s*dain|dedo|de\s*do|chahiye|chaiye|chahye|chahey|bhejo|bhej\s*do)\b/i;

// Words indicating negative statements / rejection of additions
const NEGATIVE_ADD_REGEX = /\b(?:nahi|nahin|na|nhi|mat|cancel|bina|baghair|no|nope|kuch\s*nahi|aur\s*kuch\s*nahi|nahi\s*chahiye|nahi\s*karni|add\s*nahi)\b/i;

// Words indicating item removal
const REMOVE_COMMAND_REGEX = /\b(?:remove|hata\s*do|hatao|hata\s*dein|nikal\s*do|nikalo|nikal\s*dein|delete|cancel\s*kar\s*do)\b/i;

// Words indicating item replacement or update
const UPDATE_COMMAND_REGEX = /\b(?:(?:is\s*ki|iski|us\s*ki|uski|in\s*ki|un\s*ki|ki|k)\s*jagah|ke\s*badle|badal\s*do|badlo|change\s*kar\s*do|change|replace|update)\b/i;

/**
 * Format deal components into a clean, human-readable Roman Urdu bulleted list.
 * @param {object} deal
 * @returns {string}
 */
export function formatDealComponents(deal) {
    if (!deal) return '';
    const lines = [];

    // 1. From database / fallback deal_items
    const dealItems = deal.deal_items || deal.items || [];
    if (dealItems.length > 0) {
        for (const di of dealItems) {
            const name = di.menu_item?.name || di.item_name || 'Item';
            const vName = di.menu_variant?.name || di.variant_name;
            const vText = vName && !name.toLowerCase().includes(vName.toLowerCase()) && vName.toLowerCase() !== 'standard' ? ` (${vName})` : '';
            const qty = di.quantity || 1;
            lines.push(`• ${qty}x ${name}${vText}`);
        }
        return lines.join('\n');
    }

    // 2. From static DEAL_COMPOSITIONS fallback
    const comp = DEAL_COMPOSITIONS[deal.id] || DEAL_COMPOSITIONS[deal.slug];
    if (comp) {
        if (comp.includedPizzas) {
            lines.push(`• ${comp.includedPizzas.count}x ${comp.includedPizzas.size} Pizza`);
        }
        if (comp.includedDrinks) {
            lines.push(`• ${comp.includedDrinks.count}x Soft Drink (${comp.includedDrinks.size})`);
        }
        if (comp.includedFries) {
            lines.push(`• ${comp.includedFries.count}x Fries (${comp.includedFries.size})`);
        }
        return lines.join('\n');
    }

    return `• ${deal.name}`;
}

/**
 * Find included drink details for a deal.
 * @param {object} deal
 * @returns {{ hasDrink: boolean, count: number, size: string, name: string } | null}
 */
export function getDealIncludedDrink(deal) {
    if (!deal) return null;

    // Check deal_items
    const dealItems = deal.deal_items || deal.items || [];
    for (const di of dealItems) {
        const name = (di.menu_item?.name || di.item_name || '').toLowerCase();
        if (/drink|pepsi|coke|beverage/i.test(name)) {
            const size = di.menu_variant?.name || di.variant_name || 'Regular';
            return {
                hasDrink: true,
                count: di.quantity || 1,
                size,
                name: di.menu_item?.name || di.item_name || 'Soft Drink',
            };
        }
    }

    // Check static DEAL_COMPOSITIONS
    const comp = DEAL_COMPOSITIONS[deal.id] || DEAL_COMPOSITIONS[deal.slug];
    if (comp?.includedDrinks) {
        return {
            hasDrink: true,
            count: comp.includedDrinks.count || 1,
            size: comp.includedDrinks.size || 'Regular',
            name: 'Soft Drink',
        };
    }

    // Check deal name or description for drink mentions (e.g. "1 Liter Soft Drink")
    const combined = `${deal.name || ''} ${deal.description || ''}`.toLowerCase();
    if (/\b(?:1\.5\s*l(?:iter|itre)?|1\.5l)\b/i.test(combined)) {
        return { hasDrink: true, count: 1, size: '1.5 Liter', name: 'Soft Drink' };
    }
    if (/\b(?:1\s*l(?:iter|itre)?|1l|litre\s*wali|liter\s*wali)\b/i.test(combined)) {
        return { hasDrink: true, count: 1, size: '1 Liter', name: 'Soft Drink' };
    }
    if (/\b(?:can|tin)\b/i.test(combined)) {
        return { hasDrink: true, count: 1, size: 'Can', name: 'Soft Drink' };
    }
    if (/\b(?:regular\s*drink|soft\s*drink|cold\s*drink|drink)\b/i.test(combined)) {
        return { hasDrink: true, count: 1, size: 'Regular', name: 'Soft Drink' };
    }

    return { hasDrink: false, count: 0, size: '', name: '' };
}

/**
 * Find included fries details for a deal.
 * @param {object} deal
 * @returns {{ hasFries: boolean, count: number, size: string } | null}
 */
export function getDealIncludedFries(deal) {
    if (!deal) return null;

    const dealItems = deal.deal_items || deal.items || [];
    for (const di of dealItems) {
        const name = (di.menu_item?.name || di.item_name || '').toLowerCase();
        if (/fries|fris/i.test(name)) {
            const size = di.menu_variant?.name || di.variant_name || 'Regular';
            return { hasFries: true, count: di.quantity || 1, size };
        }
    }

    const comp = DEAL_COMPOSITIONS[deal.id] || DEAL_COMPOSITIONS[deal.slug];
    if (comp?.includedFries) {
        return { hasFries: true, count: comp.includedFries.count || 1, size: comp.includedFries.size || 'Regular' };
    }

    const combined = `${deal.name || ''} ${deal.description || ''}`.toLowerCase();
    if (/\bfries\b/i.test(combined)) {
        return { hasFries: true, count: 1, size: 'Regular' };
    }

    return { hasFries: false, count: 0, size: '' };
}

/**
 * Find referenced deal in customer's current cart or session.
 * @param {object} params
 * @param {string} params.text
 * @param {object} params.cart
 * @param {string} params.sessionKey
 * @param {Array} [params.allDeals]
 * @returns {object|null}
 */
export function resolveReferencedDeal({ text, cart, sessionKey, allDeals = [] }) {
    const lower = (text || '').toLowerCase().trim();

    // 1. Check if customer named a specific deal in the text
    // e.g. "deal 3", "deal 1", "burger meal for 3", "pizza meal for 2"
    if (allDeals && allDeals.length > 0) {
        // Try exact name or key phrase match
        for (const d of allDeals) {
            const dName = d.name.toLowerCase();
            if (lower.includes(dName)) {
                return d;
            }
        }
        // Check for "deal 1", "deal 2", "deal 3", "deal 4", "deal 5"
        const dealNumMatch = lower.match(/\bdeal\s*#?\s*([1-5])\b/i);
        if (dealNumMatch) {
            const num = dealNumMatch[1];
            const found = allDeals.find(d => d.name.toLowerCase() === `deal ${num}` || d.slug === `deal-${num}`);
            if (found) return found;
        }
        // Check for "burger meal for 1/2/3"
        const bmMatch = lower.match(/\bburger\s*meal\s*(?:for\s*)?([1-3])\b/i);
        if (bmMatch) {
            const num = bmMatch[1];
            const found = allDeals.find(d => d.name.toLowerCase().includes(`burger meal for ${num}`) || d.slug.includes(`burger-meal-for-${num}`));
            if (found) return found;
        }
        // Check for "pizza meal for 1/2/3/4"
        const pmMatch = lower.match(/\bpizza\s*meal\s*(?:for\s*)?([1-4])\b/i);
        if (pmMatch) {
            const num = pmMatch[1];
            const found = allDeals.find(d => d.name.toLowerCase().includes(`pizza meal for ${num}`) || d.slug.includes(`pizza-meal-for-${num}`));
            if (found) return found;
        }
    }

    // 2. Check current cart items for deals
    if (cart?.items && cart.items.length > 0) {
        const dealItems = cart.items.filter(i => i.deal_id || i.deal);
        if (dealItems.length > 0) {
            // If text has "burger", prefer burger deal in cart
            if (/\b(?:burger|zinger)\b/i.test(lower)) {
                const burgerDeal = dealItems.find(i => (i.deal?.name || '').toLowerCase().includes('burger') || (i.deal?.slug || '').includes('burger') || i.deal?.name?.toLowerCase().includes('deal 5') || i.deal?.name?.toLowerCase().includes('deal 4'));
                if (burgerDeal) return burgerDeal.deal;
            }
            // If text has "pizza", prefer pizza deal in cart
            if (/\b(?:pizza)\b/i.test(lower)) {
                const pizzaDeal = dealItems.find(i => (i.deal?.name || '').toLowerCase().includes('pizza') || (i.deal?.slug || '').includes('pizza') || /deal\s*[1-3]/i.test(i.deal?.name || ''));
                if (pizzaDeal) return pizzaDeal.deal;
            }
            // Return the latest deal added to cart
            return dealItems[dealItems.length - 1].deal;
        }
    }

    // 3. Check session's last discussed deal
    if (sessionKey) {
        const lastDeal = getLastDiscussedDeal(sessionKey);
        if (lastDeal) return lastDeal;
    }

    return null;
}

/**
 * Classify customer intent into one of 11 strict categories.
 *
 * @param {string} text - Customer's message
 * @param {object} context - Session and cart context
 * @returns {{ intent: string, isRead: boolean, isWrite: boolean, referencedDeal?: object, confidence: number }}
 */
export function classifyCustomerIntent(text, context = {}) {
    if (!text || typeof text !== 'string') {
        return { intent: INTENTS.GENERAL_CONVERSATION, isRead: true, isWrite: false, isModification: false, isQuestion: false, confidence: 1.0 };
    }

    const raw = text.trim();
    const lower = raw.toLowerCase();
    const { cart, sessionKey, allDeals = [] } = context;

    const hasQuestionMark = lower.includes('?');
    const hasInquiryWord = INQUIRY_WORDS_REGEX.test(lower);
    const hasContextualPronoun = CONTEXTUAL_PRONOUNS_REGEX.test(lower);
    const hasNegative = NEGATIVE_ADD_REGEX.test(lower);
    const hasRemove = REMOVE_COMMAND_REGEX.test(lower);
    const hasUpdate = UPDATE_COMMAND_REGEX.test(lower);
    const hasAdd = ADD_COMMAND_REGEX.test(lower);

    // Topic detection
    let referencedTopic = null;
    if (/\b(?:drinks?|cold\s*drinks?|soft\s*drinks?|pepsi|7up|coke)\b/i.test(lower)) referencedTopic = 'drink';
    else if (/\bfries\b/i.test(lower)) referencedTopic = 'fries';
    else if (/\b(?:burger|zinger)\b/i.test(lower)) referencedTopic = 'burger';
    else if (/\bpizza\b/i.test(lower)) referencedTopic = 'pizza';
    else if (/\b(?:cart|basket|bill|total)\b/i.test(lower)) referencedTopic = 'cart';
    else if (/\b(?:delivery|charges|rider)\b/i.test(lower)) referencedTopic = 'delivery';
    else if (/\b(?:payment|cod|easypaisa)\b/i.test(lower)) referencedTopic = 'payment';

    // ── 0a. ORDER CANCEL / DELETE INTENT: "mere purany sary orders delete kr do" ──
    const isOrderDelete = /\b(?:delete|cancel|khatam|mita|clear|hata(?:o|yein)?)\b/i.test(lower) && /\b(?:orders?|puran[aeiy]+|tamam|sary|saray|all)\b/i.test(lower);
    if (isOrderDelete) {
        return {
            intent: INTENTS.CANCEL_ORDER,
            isRead: false,
            isWrite: true,
            isModification: true,
            isQuestion: false,
            referencedTopic: 'order',
            confidence: 0.95
        };
    }

    // ── 0b. ORDER STATUS / EXISTING ORDER QUERY: "koi existing order ha?" ──
    const isOrderStatus = (
        /\b(?:koi|mera|mere)\s+(?:bhi\s+)?(?:existing|active|chal\s*raha|pending)\s*orders?\s*(?:ha|hai|h|he)?\b/i.test(lower) ||
        /\b(?:existing|active)\s+orders?\b/i.test(lower) ||
        /^(?:koi\s+existing\s+order\s*(?:ha|hai|h|he)?|koi\s+active\s+order\s*(?:ha|hai|h|he)?|orders?\s*status|status|order\s*kahan\s*hai|order\s*kahan\s*tak\s*pohncha)[\s.!?]*$/i.test(lower.trim())
    ) && !isOrderDelete && !/\b(?:order\s*(?:karna|krna|kardo|kar\s*do|kr\s*do|karein|kar\s*dein|hai|h)|mangwana)\b/i.test(lower);
    if (isOrderStatus) {
        return {
            intent: INTENTS.ORDER_STATUS_QUERY,
            isRead: true,
            isWrite: false,
            isModification: false,
            isQuestion: true,
            referencedTopic: 'order',
            confidence: 0.95
        };
    }

    // ── 0c. PHONE AFFIRMATION: "han yeh number ha", "yahi number hai" ──
    const isAffirmativePhone = /^(?:(?:han|haan|ha|hn|g|ji|jee|yes|ok|theek\s*(?:hai|hy)?)\s+)?(?:same|yahi|yehi|yehe|yhe|yeh|ye|wahi|isi\s*pe|yahi\s*hai|yehi\s*hai|yeh\s*hai|ye\s*hai|isi\s*number|yehi\s*number|yahi\s*number|yehe\s*number|yeh\s*number|ye\s*number|same\s*number|same\s*whatsapp|haan|han|hn|ji|jee|g|yes|theek\s*hai|theek\s*hy|ok|done)\s*(?:hi\s*)?(?:number|no|whatsapp|contact)?\s*(?:pe|par|per)?\s*(?:hoga|hogi|rahyga|rahega|rhega|ryga|rahy\s*ga|rahe\s*ga|rakh\s*lo|rakh\s*do|rakho|rakhein|rehn\s*do|rehne\s*do|dedo|de\s*do|likh\s*do|likh\s*lo|daal\s*do|kar\s*do|kr\s*do|karo|kro|bhej\s*do|bhejo|rabta\s*karein|rabta|rider\s*ko\s*de\s*do|rider\s*ko\s*dedo|theek\s*(?:hai|hy)?|hai|he|hy|ha|yar|bhai)?[\s.!?]*$/i.test(lower.trim()) ||
        /\b(?:same|yahi|yehi|yehe|yeh|ye|wahi|isi)\s*(?:hi\s*)?(?:number|no|whatsapp)?\s*(?:pe|par|per)?\s*(?:rahyga|rahega|rhega|ryga|rahy\s*ga|rahe\s*ga|hoga|rakh\s*lo|rakh\s*do|rakho|dedo|de\s*do|likh\s*do|likh\s*lo|bhej\s*do|ha|hai|he|hy)\b/i.test(lower.trim()) ||
        /\b(?:btaya|bola|kaha)\s+to\s+h(?:ai|y)?.*(?:yehe|yehi|yeh|ye|same|isi)\s+number\b/i.test(lower.trim()) ||
        /^(?:han|haan|g|ji)?\s*(?:yeh|ye|yahi|yehi|same|isi)\s*(?:hi\s*)?(?:number|no|whatsapp|contact)\s*(?:ha|hai|h|he)?[\s.!?]*$/i.test(lower.trim());
    if (isAffirmativePhone) {
        return {
            intent: INTENTS.PROVIDE_PHONE,
            isRead: false,
            isWrite: true,
            isModification: true,
            isQuestion: false,
            referencedTopic: 'phone',
            confidence: 0.95
        };
    }

    // ── 1. NEGATIVE INTENT: "Nahi, drink add nahi karni", "nahi chahiye" ──
    if (hasNegative && /\b(?:drink|fries|burger|pizza|item|deal|kuch|extra)\b/i.test(lower)) {
        return {
            intent: INTENTS.GENERAL_CONVERSATION,
            isRead: true,
            isWrite: false,
            isModification: false,
            isQuestion: false,
            referencedTopic,
            confidence: 0.95
        };
    }

    // ── 2. REMOVE INTENT: "Drink remove kar do", "fries nikal do" ──
    if (hasRemove) {
        return {
            intent: INTENTS.REMOVE_ITEM,
            isRead: false,
            isWrite: true,
            isModification: true,
            isQuestion: false,
            referencedTopic,
            confidence: 0.95
        };
    }

    // ── 3. UPDATE INTENT: "Iski jagah fries kar do", "drink ki jagah fries kar do" ──
    if (hasUpdate) {
        return {
            intent: INTENTS.UPDATE_ITEM,
            isRead: false,
            isWrite: true,
            isModification: true,
            isQuestion: false,
            referencedTopic,
            confidence: 0.95
        };
    }

    // ── 4. CUSTOMER_DETAILS: Customer provides phone, name, or address ──
    const isCustomerDetails = /\b03\d{2}[-\s]?\d{7}\b/.test(lower) ||
        /\b(?:mera\s*naam|my\s*name\s*is|naam\s*(?:hai|ye\s*hai|likhein|note)|address\s*(?:hai|change|update)|pata\s*hai)\b/i.test(lower);
    if (isCustomerDetails && !hasInquiryWord) {
        return {
            intent: INTENTS.CUSTOMER_DETAILS,
            isRead: false,
            isWrite: true,
            isModification: true,
            isQuestion: false,
            referencedTopic: 'customer_details',
            confidence: 0.95
        };
    }

    // ── 5. DELIVERY_QUERY: Questions about delivery charges, timing, area ──
    const isDeliveryQuery = /\b(?:delivery\s*(?:charges|fees?|timing|time|charges\s*kitne|kitna)|kahan\s*deliver|delivery\s*(?:available|hoti|karein|area|range))\b/i.test(lower);
    if (isDeliveryQuery && !hasAdd) {
        return {
            intent: INTENTS.DELIVERY_QUERY,
            isRead: true,
            isWrite: false,
            isModification: false,
            isQuestion: true,
            referencedTopic: 'delivery',
            confidence: 0.95
        };
    }

    // ── 6. PAYMENT_QUERY: Inquiries or selection of payment method ──
    const isPaymentQuery = /\b(?:payment\s*(?:method|options?|kaise)|cash\s*on\s*delivery|cod|easypaisa|jazzcash|online\s*payment|card\s*payment)\b/i.test(lower);
    if (isPaymentQuery && !hasAdd) {
        return {
            intent: INTENTS.PAYMENT_QUERY,
            isRead: true,
            isWrite: false,
            isModification: false,
            isQuestion: true,
            referencedTopic: 'payment',
            confidence: 0.95
        };
    }

    // ── 7. DEAL_QUERY: Inquiries about deal contents, included drinks, fries, components ──
    // Matches: "is mei soft drink konsi ha", "deal mein already drink added ha?", "is mein kya kya hai?"
    const isDealQuery = (hasContextualPronoun && (hasInquiryWord || hasQuestionMark || /\b(?:soft\s*)?drinks?|fries|burgers?|pizzas?|flavour|flavor|items?\b/i.test(lower))) ||
                        (/\b(?:deal|meal)\b/i.test(lower) && (hasInquiryWord || hasQuestionMark || /\b(?:already|pehle|included|shamil|konsi|konsa|kya|kia|size)\b/i.test(lower))) ||
                        (/\b(?:already|pehle\s*se)\b/i.test(lower) && /\b(?:drink|fries|burger|pizza|add|added|shamil|included)\b/i.test(lower)) ||
                        /\bwohi\s*deal\s*(?:dobara\s*)?(?:batao|bataen|dikhao)\b/i.test(lower) ||
                        /\b(?:soft\s*)?drinks?\s*(?:konsi|kia|kya|shamil|included)\b/i.test(lower);

    if (isDealQuery && !hasAdd) {
        const referencedDeal = resolveReferencedDeal({ text: lower, cart, sessionKey, allDeals });
        return {
            intent: INTENTS.DEAL_QUERY,
            isRead: true,
            isWrite: false,
            isModification: false,
            isQuestion: true,
            referencedTopic: referencedTopic || 'deal',
            referencedDeal,
            confidence: 0.95,
        };
    }

    // ── 8. CART_QUERY: Inquiries about existing cart items, total, bill ──
    const isCartQuery = /\b(?:cart|basket)\b.*\b(?:dikhao|kya|kia|total|bill|items?|check|dekho|batao)\b/i.test(lower) ||
                        /\b(?:mere|mera|apna)\s*cart\b/i.test(lower) ||
                        /\b(?:total\s*bill|kitne\s*paise|kitna\s*hua|kitna\s*bana|cart\s*total|mera\s*total)\b/i.test(lower);

    if (isCartQuery && !hasAdd && !hasRemove) {
        return {
            intent: INTENTS.CART_QUERY,
            isRead: true,
            isWrite: false,
            isModification: false,
            isQuestion: true,
            referencedTopic: 'cart',
            confidence: 0.95
        };
    }

    // ── 9. MENU_QUERY: General menu, pricing, category, flavour inquiries ──
    const isMenuQuery = /^(?:menu|show\s*menu|food|khana|items?|catalog)$/i.test(lower) ||
                        (/\b(?:menu|deals?|prices?|rates?|list)\b/i.test(lower) && (hasInquiryWord || hasQuestionMark || /^(?:show|dikhao|bhejo|batao)\b/i.test(lower)));

    if (isMenuQuery && !hasAdd && !hasContextualPronoun) {
        return {
            intent: INTENTS.MENU_QUERY,
            isRead: true,
            isWrite: false,
            isModification: false,
            isQuestion: true,
            referencedTopic: 'menu',
            confidence: 0.90
        };
    }

    // ── 10. ADD_ITEM: Explicit addition commands ──
    // e.g. "aik burger meal for 3 add kar do", "ek extra drink add kar do"
    if (hasAdd && !hasInquiryWord && !hasQuestionMark && !hasNegative) {
        return {
            intent: INTENTS.ADD_ITEM,
            isRead: false,
            isWrite: true,
            isModification: true,
            isQuestion: false,
            referencedTopic,
            confidence: 0.90
        };
    }

    // ── 11. ORDER_CONFIRMATION: Confirm or final action ──
    if (/\b(?:confirm|comfirm|order\s*book|book\s*kar\s*do|final\s*kar\s*do|haan\s*kar\s*do)\b/i.test(lower)) {
        return {
            intent: INTENTS.ORDER_CONFIRMATION,
            isRead: false,
            isWrite: true,
            isModification: true,
            isQuestion: false,
            referencedTopic: 'order',
            confidence: 0.95
        };
    }

    // Default: General conversation
    return {
        intent: INTENTS.GENERAL_CONVERSATION,
        isRead: true,
        isWrite: false,
        isModification: false,
        isQuestion: hasQuestionMark,
        referencedTopic,
        confidence: 0.80
    };
}

/**
 * Handle Contextual Deal and Cart Queries Deterministically (Zero Tokens).
 * Resolves questions like:
 *   - "is mei soft drink konsi ha"
 *   - "deal mein already drink added ha?"
 *   - "is mein kya kya hai?"
 *   - "is mein fries included hain?"
 *   - "nahi, drink add nahi karni"
 *   - "mere cart ka total kya hai?"
 *
 * @param {object} params
 * @param {string} params.text - Customer's message
 * @param {string} params.sessionKey - Session identifier
 * @param {string} [params.whatsappPhone] - Customer WhatsApp phone
 * @param {string} [params.chatId] - WhatsApp chat JID
 * @returns {Promise<{ handled: boolean, reply?: string, routeName?: string, intent?: string }>}
 */
export async function handleIntentRouting(params) {
    const { text, sessionKey, whatsappPhone, chatId } = params || {};
    if (!text || typeof text !== 'string') return { handled: false };

    const raw = text.trim();
    const lower = raw.toLowerCase();

    // Fetch active cart and deals cache
    let cart = null;
    let cache = null;
    let allDeals = [];

    try {
        cache = await getCatalogCache();
        if (sessionKey) {
            cart = await getActiveCart({ sessionKey, restaurantId: cache?.restId, chatId });
        }
        allDeals = await getActiveDeals(cache?.restId);
    } catch (_) {}

    const classification = classifyCustomerIntent(lower, { cart, sessionKey, allDeals });

    // ══════════════════════════════════════════════════════════════════════════
    // INTENT A: DEAL_QUERY (Contextual deal component inquiries)
    // ══════════════════════════════════════════════════════════════════════════
    if (classification.intent === INTENTS.DEAL_QUERY) {
        const deal = classification.referencedDeal || resolveReferencedDeal({ text: lower, cart, sessionKey, allDeals });

        if (deal) {
            const dealName = deal.name;
            const drinkInfo = getDealIncludedDrink(deal);
            const friesInfo = getDealIncludedFries(deal);

            // Sub-case 1: Asking specifically about DRINK in the deal
            // e.g. "is mei soft drink konsi ha", "deal mein already drink added ha?", "drink included hai?"
            const isDrinkInquiry = /\b(?:drinks?|cold\s*drinks?|soft\s*drinks?|pepsi|coke)\b/i.test(lower);
            if (isDrinkInquiry) {
                // If customer asks if already added / included
                const isAlreadyAddedAsk = /\b(?:already|pehle\s*se|included|shamil|add\s*hai|added|mojood)\b/i.test(lower) ||
                                          /\b(?:deal|is|iss)\s*(?:mein|me)?\s*(?:bhi\s*)?(?:drink|soft\s*drink)\s*(?:hai|hoti\s*hai|milti\s*hai)\b/i.test(lower);

                if (drinkInfo && drinkInfo.hasDrink) {
                    if (isAlreadyAddedAsk) {
                        return {
                            handled: true,
                            routeName: 'deal_drink_already_included',
                            intent: INTENTS.DEAL_QUERY,
                            reply: `Ji bilkul! *${dealName}* mein pehle se **${drinkInfo.count > 1 ? `${drinkInfo.count}x ` : ''}${drinkInfo.size} Soft Drink** included hai. Aap ko alag se drink add karne ki zaroorat nahi. 😊`,
                        };
                    } else {
                        // Asking what brand/size is included: "is mei soft drink konsi ha"
                        return {
                            handled: true,
                            routeName: 'deal_drink_flavour_inquiry',
                            intent: INTENTS.DEAL_QUERY,
                            reply: `*${dealName}* mein **${drinkInfo.count > 1 ? `${drinkInfo.count}x ` : ''}${drinkInfo.size} Chilled Soft Drink** included hai! 🥤\n\nFlavours mein *Pepsi*, *7Up*, *Mirinda*, ya *Next Cola* dastiyab hoti hain jo delivery ke waqt provide ki jati hain.`,
                        };
                    }
                } else {
                    return {
                        handled: true,
                        routeName: 'deal_no_drink_included',
                        intent: INTENTS.DEAL_QUERY,
                        reply: `Nahi, *${dealName}* mein drink included nahi hai. Agar aap chahein to Regular (Rs. 110), Can (Rs. 130), 1 Liter (Rs. 200), ya 1.5 Liter (Rs. 240) drink alag se add karwa sakte hain. 🥤`,
                    };
                }
            }

            // Sub-case 2: Asking specifically about FRIES in the deal
            // e.g. "deal mein fries hain?", "is mein fries included hain?"
            const isFriesInquiry = /\bfries\b/i.test(lower);
            if (isFriesInquiry) {
                if (friesInfo && friesInfo.hasFries) {
                    return {
                        handled: true,
                        routeName: 'deal_fries_included',
                        intent: INTENTS.DEAL_QUERY,
                        reply: `Ji bilkul! *${dealName}* mein **${friesInfo.size} Fries** included hain. 🍟`,
                    };
                } else {
                    const compSummary = formatDealComponents(deal);
                    return {
                        handled: true,
                        routeName: 'deal_no_fries_included',
                        intent: INTENTS.DEAL_QUERY,
                        reply: `Nahi, *${dealName}* mein fries included nahi hain. Is deal mein yeh items shamil hain:\n\n${compSummary}`,
                    };
                }
            }

            // Sub-case 3: Asking for all contents / what is included
            // e.g. "is mein kya kya hai?", "deal mein kya items hain?", "wohi deal dobara batao"
            const compSummary = formatDealComponents(deal);
            const priceText = Number(deal.deal_price) > 0 ? ` — Rs. ${Number(deal.deal_price).toLocaleString('en-PK')}` : '';
            return {
                handled: true,
                routeName: 'deal_full_contents_inquiry',
                intent: INTENTS.DEAL_QUERY,
                reply: `*${dealName}*${priceText} mein yeh items shamil hain: 🍽️\n\n${compSummary}\n\nKya yeh deal cart mein add karoon ya order finalize karein?`,
            };
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // INTENT B: CART_QUERY (Checking items or total bill in active cart)
    // ══════════════════════════════════════════════════════════════════════════
    if (classification.intent === INTENTS.CART_QUERY) {
        if (!cart || !cart.items || cart.items.length === 0) {
            return {
                handled: true,
                routeName: 'cart_query_empty',
                intent: INTENTS.CART_QUERY,
                reply: 'Aap ka cart is waqt khali hai. 🛒\n\nKoi item ya deal order karne ke liye menu dekhne ke liye "menu" ya deals dekhne ke liye "deals" likhein!',
            };
        }

        const totals = await calculateCartTotals({ sessionKey, restaurantId: cache?.restId, chatId }).catch(() => null);
        const subtotal = totals?.subtotal ?? (cart.items.reduce((sum, it) => sum + Number(it.deal?.deal_price ?? it.menu_variant?.price ?? it.menu_item?.base_price ?? 0) * (it.quantity || 1), 0));
        const total = totals?.total ?? subtotal;

        // If customer specifically asks for total bill / price
        if (/\b(?:total|bill|paise|kitna|kitne)\b/i.test(lower)) {
            return {
                handled: true,
                routeName: 'cart_total_inquiry',
                intent: INTENTS.CART_QUERY,
                reply: `Aap ke cart ka total bill:\n\n💰 Subtotal: Rs. ${subtotal.toLocaleString('en-PK')}\nTotal: Rs. ${total.toLocaleString('en-PK')}\n\nOrder confirm karne ke liye "confirm" likhein! 👍`,
            };
        }

        // List all items and included deal components
        const cartLines = [];
        for (const item of cart.items) {
            if (item.deal) {
                const notesStr = item.notes ? ` (${item.notes})` : '';
                cartLines.push(`• *${item.quantity}x ${item.deal.name}*${notesStr} — Rs. ${Number(item.deal.deal_price * item.quantity).toLocaleString('en-PK')}`);
                const comps = formatDealComponents(item.deal);
                if (comps) {
                    cartLines.push(`   _Includes:_\n   ${comps.split('\n').join('\n   ')}`);
                }
            } else if (item.menu_item) {
                const vStr = item.menu_variant ? ` (${item.menu_variant.name})` : '';
                const p = Number(item.menu_variant?.price ?? item.menu_item.base_price ?? 0) * item.quantity;
                cartLines.push(`• *${item.quantity}x ${item.menu_item.name}*${vStr} — Rs. ${p.toLocaleString('en-PK')}`);
            }
        }

        return {
            handled: true,
            routeName: 'cart_contents_inquiry',
            intent: INTENTS.CART_QUERY,
            reply: `🛒 *Aap Ke Cart Mein Yeh Items Hain:*\n\n${cartLines.join('\n\n')}\n\n💰 *Total: Rs. ${total.toLocaleString('en-PK')}*\n\nOrder proceed karne ke liye "checkout" ya "confirm" likhein! 😊`,
        };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // INTENT C: NEGATIVE ACKNOWLEDGEMENT ("Nahi, drink add nahi karni")
    // ══════════════════════════════════════════════════════════════════════════
    // ══════════════════════════════════════════════════════════════════════════
    // INTENT D: CONTEXT RETRIEVAL ("bataya to tha", "pehle bataya tha")
    // ══════════════════════════════════════════════════════════════════════════
    const isContextRecall = /\b(?:b(?:a)?taya|bola|kaha)\s+(?:to\s+)?(?:tha|h(?:ai|y)?)\b/i.test(lower) ||
        /\bpehle\s+(?:b(?:a)?taya|likhwaya|diya)\s+(?:tha|h(?:ai|y)?)\b/i.test(lower);
    if (isContextRecall) {
        const { getSessionOrderDetails } = await import('./sessionService.js');
        const cleanPhone = (whatsappPhone || '').replace(/\D/g, '');
        const details = getSessionOrderDetails(sessionKey, cleanPhone);
        const namePart = details.name ? `Naam: *${details.name}*` : null;
        const phonePart = details.phone ? `Contact: *${details.phone}*` : null;
        const addrPart = details.address ? `Address: *${details.address}*` : null;
        const known = [namePart, phonePart, addrPart].filter(Boolean);

        if (known.length > 0) {
            return {
                handled: true,
                routeName: 'context_recalled',
                intent: INTENTS.GENERAL_CONVERSATION,
                reply: `Ji bilkul! Aap ki yeh details hamare paas pehle se mehfooz hain: 😊\n\n• ${known.join('\n• ')}\n\nKya isi address par order proceed karein ya koi cheez change karni hai?`,
            };
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // INTENT E: SELECTION PRESERVATION ("wohi rahy ga", "yehi rahy ga")
    // ══════════════════════════════════════════════════════════════════════════
    const isPreserveSelection = /\b(?:wohi|yehi|wahi|yahi|same|isi)\s*(?:hi)?\s*(?:rahy\s*ga|rahe\s*ga|rahyga|rahega|rhega|ryga|hoga|rakho|rakhein|rehn\s*do|theek\s*hai)\b/i.test(lower) ||
        /\b(?:nahi\s+)?(?:yehi|wohi|same)\s+(?:rahy\s*ga|theek\s*hai|thek\s*h)\b/i.test(lower);
    if (isPreserveSelection && !lower.includes('add') && !lower.includes('aur')) {
        return {
            handled: true,
            routeName: 'selection_preserved',
            intent: INTENTS.GENERAL_CONVERSATION,
            reply: 'Theek hai! Aap ki maujooda selection mehfooz hai aur koi tabdeeli nahi ki gayi. 👍\n\nAgla step proceed karne ke liye tayyar hain?',
        };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // INTENT F: EMPTY CART CONFIRMATION GUARD ("confirm kr do" when cart is empty)
    // ══════════════════════════════════════════════════════════════════════════
    const isConfirmAttempt = /\b(?:confirm|comfirm|final|book)\b/i.test(lower) && /\b(?:kr\s*do|kar\s*do|kardo|krdo|krdu|karein|dein|dain|karo|kro)\b/i.test(lower);
    if (isConfirmAttempt && (!cart || !cart.items || cart.items.length === 0)) {
        return {
            handled: true,
            routeName: 'confirm_attempt_empty_cart',
            intent: INTENTS.ORDER_CONFIRMATION,
            reply: 'Aap ka cart is waqt khali hai. 🛒\n\nOrder confirm karne se pehle menu dekhne ke liye "menu" ya deals dekhne ke liye "deals" likh kar koi item select karein!',
        };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // INTENT G: EXTRA DRINK WITH SIZE REQUEST ("wo kam hogi to aik 1.5 litre ki aur bhi kr do")
    // ══════════════════════════════════════════════════════════════════════════
    const isExtraDrinkWithSize = /\b(?:1\.5|1\.5l|1\.5\s*liter|1\.5\s*litre|1\s*liter|1\s*litre|regular|can)\b/i.test(lower) &&
        /\b(?:aur\s*bhi|extra|aur\s*kr|aur\s*daal|aur\s*add|bhi\s*kr|bhi\s*kar|kam\s*hogi)\b/i.test(lower);
    if (isExtraDrinkWithSize && sessionKey) {
        const { addItemToCart } = await import('./cartService.js');
        const sizeMatch = lower.match(/\b(1\.5\s*(?:liter|litre|l)|1\s*(?:liter|litre|l)|regular|can)\b/i);
        const targetSize = sizeMatch ? sizeMatch[1].replace(/\s+/g, ' ') : '1.5 Liter';
        const normalizedSize = /1\.5/i.test(targetSize) ? '1.5 Liter' : (/1/i.test(targetSize) ? '1 Liter' : (/can/i.test(targetSize) ? 'Can' : 'Regular'));
        
        // Find Soft Drink item and variant
        const { getActiveMenu } = await import('./menuService.js').catch(() => ({}));
        const menu = await getActiveMenu(cache?.restId).catch(() => []);
        let drinkItem = null;
        for (const cat of (menu || [])) {
            const found = (cat.menu_items || []).find(it => /soft\s*drink|pepsi|coke|beverage/i.test(it.name));
            if (found) { drinkItem = found; break; }
        }
        const matchedVariant = drinkItem?.variants?.find(v => v.name.toLowerCase().includes(normalizedSize.toLowerCase()));

        if (drinkItem && matchedVariant) {
            await addItemToCart({
                sessionKey,
                restaurantId: cache?.restId,
                chatId,
                verifiedPhone: whatsappPhone,
                menuItemId: drinkItem.id,
                variantId: matchedVariant.id,
                quantity: 1,
            });
            const priceStr = matchedVariant.price ? ` — Rs. ${matchedVariant.price}` : '';
            return {
                handled: true,
                routeName: 'extra_drink_added_with_size',
                intent: INTENTS.ADD_ITEM,
                reply: `Zabardast! Deal ke sath *1x Soft Drink (${normalizedSize})*${priceStr} cart mein add kar di gayi hai! 🥤\n\nAb bataiye delivery kahan karni hai? (Location pin ya address share karein) 📍`,
            };
        }
    }


    const isQuestionInquiry = /\b(?:hai\s*ya\s*nahi|shamil|included|hogi\s*ya\s*nahi|hoga\s*ya\s*nahi|kya|kia|detail|details|batao|btao)\b/i.test(lower) || lower.includes("?");
    if (!isQuestionInquiry && NEGATIVE_ADD_REGEX.test(lower) && /\b(?:drink|fries|burger|pizza|item|extra|aur)\b/i.test(lower)) {
        return {
            handled: true,
            routeName: 'negative_add_acknowledged',
            intent: INTENTS.GENERAL_CONVERSATION,
            reply: 'Theek hai! Mazeed kuch add nahi kiya gaya, aap ka cart bilkul pehle jaisa mehfooz hai. 😊\n\nKya order finalize karein ya kuch aur dekhna chahenge?',
        };
    }

    return { handled: false, classification };
}
