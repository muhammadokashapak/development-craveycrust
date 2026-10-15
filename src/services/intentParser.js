/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║   Intent Parser — src/services/intentParser.js               ║
 * ║   Deterministic Intent Provider for WhatsApp Ordering Flow   ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Architecture:
 *   WhatsApp Orchestrator
 *          ↓
 *   Intent Provider Interface (DeterministicIntentProvider)
 *          ↓
 *   Returns { intent, entities, confidence }
 */

import { extractGoogleMapsUrl } from '../../utils/location.js';

// Session memory for zero-token deal follow-ups
const _lastDiscussedDealBySession = new Map();

export function clearLastDiscussedDeal(sessionKey) {
    if (sessionKey) {
        _lastDiscussedDealBySession.delete(sessionKey);
    }
}

export function cleanExtractedAddress(text) {
    if (!text || typeof text !== 'string') return null;
    let cleaned = text;
    cleaned = cleaned.replace(/\b(?:sari|saari|ye|yeh|is|mera|apna|sab)?\s*(?:deals?|order|items?|khana)?\s*(?:bhi)?\s*(?:parcel|deliver|delivery|bhej|bhejo|send|pack)?\s*(?:krdo|kardo|kar\s*do|kr\s*do|kr\s*du|kar\s*du|karo|kro|krna|karna|karein|chahiye)?\s*(?:ha|hai|h|ho)?\b/gi, ' ');
    cleaned = cleaned.replace(/^(?:delivery\s*ad(?:d)?re(?:e)?s(?:s)?|mera\s*ad(?:d)?re(?:e)?s(?:s)?|ad(?:d)?re(?:e)?s(?:s)?|pata|location)\s*[:=-]?\s*/i, ' ');
    cleaned = cleaned.replace(/\b(?:mein|me|mai|mei|mn|par|pe|ko)\s+(?:delivery\s+)?(?:krni|karni|h|hai|karein)\b/gi, ' ');
    cleaned = cleaned.replace(/\b(?:deliver|delivery|parcel|bhej|bhejo|send|pack)\s*(?:krdo|kardo|kar\s*do|kr\s*do|kr\s*du|kar\s*du|kro|karo|krna|karna)?\s*(?:ha|hai|h)?\b/gi, ' ');
    cleaned = cleaned.replace(/\b(?:bhej\s*do|kar\s*do|kr\s*do|kar\s*du|kr\s*du|bhejo|kardo|krdo|do|du|dein)\b/gi, ' ');
    cleaned = cleaned.replace(/\b(?:mein|me|mai|mei|mn|par|pe|idhar|idr|yahan|wahan|ko)\b/gi, ' ');
    cleaned = cleaned.replace(/\b(?:same\s*(?:number|numbr|no|whatsapp)?|num(?:br|ber)?\s*sam(?:e)?(?:\s*(?:ryga|rhega|rahega))?|easypaisa|easy\s*paisa|ep|cod|cash\s*on\s*delivery|cash|payment\s*(?:method)?)\b/gi, ' ');
    cleaned = cleaned.replace(/\b(?:krni|karni|ha|hai|h)\b/gi, ' ');
    cleaned = cleaned.replace(/^[,\s.-]+|[,\s.-]+$/g, '').replace(/\s+/g, ' ').trim();
    return cleaned;
}

/**
 * Extracts customer checkout details (name, delivery address, payment method, phone) from conversational text.
 */
export function extractCustomerDetails(raw) {
    if (!raw || typeof raw !== 'string') return {};
    const lower = raw.toLowerCase().trim();
    let name = null;
    let paymentMethod = null;
    let phone = null;
    let address = null;

    // 1. Payment Method
    if (/\b(?:easypaisa|easy\s*paisa|ep)\b/i.test(lower)) {
        paymentMethod = 'EASYPAISA';
    } else if (/\b(?:cod|cash\s*on\s*delivery|cash)\b/i.test(lower)) {
        paymentMethod = 'COD';
    }

    // 2. Phone
    if (/\b(?:same\s*(?:number|numbr|no|whatsapp)?|num(?:br|ber)?\s*sam(?:e)?(?:\s*(?:ryga|rhega|rahega))?|isi\s*num(?:br|ber)?|wahi\s*num(?:br|ber)?|yehi\s*num(?:br|ber)?)\b/i.test(lower)) {
        phone = 'SAME_WHATSAPP';
    } else {
        const phMatch = raw.match(/(?:03\d{9}|\+?923\d{9})/);
        if (phMatch) phone = phMatch[0].replace(/\D/g, '');
    }

    // 3. Name
    const nameBefore = raw.match(/\b([A-Za-z]{2,20})\s+(?:meara|mera)\s+(?:name|naam)\b/i) ||
                       raw.match(/^([A-Za-z]{2,20})\s+(?:name|naam|nam)(?:\s+(?:is|hai|h|ja))?\b/i);
    const nameAfter = raw.match(/\b(?:meara|mera|apna)?\s*(?:naam|name|nam)\s*(?:is|hai|h)?\s*[:=-]?\s*([A-Za-z]{2,20})\b/i);

    const NOT_NAME_REGEX = /\b(krdo|kardo|kar\s*do|kr\s*do|karo|kro|kar|kr|karna|krna|karein|chahiye|mangwao|mangwana|pack|parcel|send|bhej|bhejo|theek|thk|done|ok|yes|haan|han|hn|ha|g|ji|jee|no|nahi|na|payment|cod|cash|easypaisa|easy|paisa|delivery|address|location|pata|order|deal|deals|pizza|burger|menu|bhai|sain|sir|khan|bro|food|water|drink|hi|hello|hey|bill|kam|ja|hai|mera|meara|method|party|small|medium|large|reg|regular|can|liter|litre|1\.5l|1l|flavor|flavour|crust|cheese|extreme|peri|behari|tikka|fajita|supreme|tandoori)\b/i;

    const nameCandidate = (nameBefore ? nameBefore[1] : (nameAfter ? nameAfter[1] : null))?.trim();
    if (nameCandidate && !NOT_NAME_REGEX.test(nameCandidate)) {
        name = nameCandidate;
    }

    // 4. Address
    let textForAddr = raw;
    if (name) {
        textForAddr = textForAddr.replace(new RegExp('(?:^|\\s)' + name + '\\s+(?:meara|mera)\\s+(?:name|naam)\\s*(?:ha|hai|h)?', 'gi'), '')
                                 .replace(new RegExp('^' + name + '\\s+(?:name|naam|nam)(?:\\s+(?:is|hai|h|ja))?', 'gi'), '')
                                 .replace(new RegExp('(?:^|\\s)(?:meara|mera|apna)?\\s*(?:naam|name|nam)\\s*(?:is|hai|h|ja)?\\s*[:=-]?\\s*' + name + '\\s*(?:ha|hai|h)?', 'gi'), '');
    }

    const addrExplicit = textForAddr.match(/(?:delivery\s*ad(?:d)?re(?:e)?s(?:s)?|ad(?:d)?re(?:e)?s(?:s)?|pata)\s*[:=-]?\s*([^,\n]+(?:,\s*[^,\n]+)*)/i);
    const locBefore = textForAddr.match(/([^,\n]+?)\s+(?:meari|meri)\s+location\b/i);
    const locExplicit = textForAddr.match(/(?:(?:meari|mera|apni)\s+)?location\s*(?:ha|hai|h)?\s*[:=-]?\s*([^,\n]+(?:,\s*[^,\n]+)*)/i);

    const ADDRESS_INDICATORS = /\b(town|phase|sector|street|gali|house|guest\s*house|makan|flat|block|road|chowk|pul|pull|colony|scheme|market|plaza|nearby|near|islamabad|rawalpindi|pindi|tarlai|khanna|khana|ghauri|sohan|korang|i-8|i-9|i-10|g-8|g-9|g-10|g-11|f-8|f-9|f-10|f-11|pwd|bahria|dha)\b/i;

    if (addrExplicit) {
        address = cleanExtractedAddress(addrExplicit[1]);
    } else if (locBefore) {
        address = cleanExtractedAddress(locBefore[1]);
    } else if (locExplicit) {
        address = cleanExtractedAddress(locExplicit[1]);
    } else if (!paymentMethod && !name && ADDRESS_INDICATORS.test(lower)) {
        const potentialAddr = cleanExtractedAddress(textForAddr);
        if (potentialAddr && ADDRESS_INDICATORS.test(potentialAddr) && potentialAddr.length >= 4 && potentialAddr.length <= 80) {
            address = potentialAddr;
        }
    }

    if (address) {
        address = cleanExtractedAddress(address);
        if (address.length < 4 || !ADDRESS_INDICATORS.test(address)) {
            address = null;
        }
    }

    return { name, paymentMethod, phone, address };
}

// ─── Regular Expressions & Pattern Dictionaries ───────────────────────────

const GREETING_REGEX = /^(?:hi+|hello+|hey+|aoa|assalam\s*o?\s*alaikum|salam+|slam|start|shuru)\b/i;
const START_ORDER_REGEX = /^(?:order\s+book\s+(?:krwana|karna|karwana|ah)|order\s+book\s+karna\s+hai|order\s+booking|booking\s+karwani\s+hai)\b/i;
const MENU_REGEX = /^(?:menu|show\s+menu|menu\s+bhejo|menu\s+dikhao|food|khana|items)\b/i;
const DEALS_REGEX = /^(?:deals|deal|special\s+deals|offers|deals\s+bhejo|deals\s+dikhao)(?!\s*#?\d)\b/i;
const CART_VIEW_REGEX = /^(?:cart|mera\s+cart|my\s+cart|show\s+cart|view\s+cart|basket|cart\s+dikhao|cart\s+dekho|cart\s+batao|apna\s+cart)$/i;
const CLEAR_CART_REGEX = /^(?:clear\s+cart|empty\s+cart|cart\s+clear|cart\s+khali(?:\s+kar\s*do)?|delete\s+cart)\b/i;
const CHECKOUT_REGEX = /^(?:checkout|check\s+out|order\s+karna\s+hai|order\s+please|place\s+order|done\s+ordering|proceed)\b/i;
const HELP_REGEX = /^(?:help|madad|options|commands|guide)\b/i;
const HUMAN_HANDOFF_REGEX = /^(?:human|agent|talk\s+to\s+human|representative|bande\s+se\s+baat|admin\s+se\s+baat)\b/i;
const DELETE_DATA_REGEX = /^(?:delete\s+(?:my\s+)?data|remove\s+(?:my\s+)?data|clear\s+(?:my\s+)?data|mera\s+data\s+delete(?:\s+kar\s*do)?|mera\s+data\s+hata(?:\s+do)?|mera\s+record\s+delete(?:\s+kar\s*do)?|delete\s+account|forget\s+me)\b/i;

const POSITIVE_REGEX = /^(?:yes|haan|ha|ji|confirm|order\s+kar\s*do|theek\s+hai|ok|yup|done|1)\b/i;
const NEGATIVE_REGEX = /^(?:no|nahi|na|cancel|mat\s+karo|nope|abort|2)\b/i;

const SAME_NUMBER_REGEX = /^(?:same\s+number|isi\s+number|yehi\s+number|yahi\s+number|same\s+whatsapp|same)\b/i;
const PHONE_NUMBER_REGEX = /^(?:\+?92|0)?3[0-9]{9}$/;

const ORDER_NUMBER_REGEX = /(?:#?\bCC-\d{6}\b)/i;
const STATUS_QUERY_REGEX = /^(?:mera\s+order\s+kahan\s+hai|order\s+status|track\s+order|status|track)\b/i;
const CANCEL_QUERY_REGEX = /^(?:cancel\s+order|order\s+cancel|cancel)\b/i;

const COD_REGEX = /^(?:cod|cash|cash\s+on\s+delivery|1)\b/i;
const EASYPAISA_REGEX = /^(?:easypaisa|easy\s+paisa|ep|2)\b/i;

const FAQ_PATTERNS = [
    /\?/,
    /\b(?:delivery\s+kitni\s+dair|kitni\s+dair|kab\s+tak|kahan\s+hai|kya\s+hai)\b/i,
    /\b(?:timing|timings|open|close|address|location|refund|policy|halal|rider|discount|free delivery)\b/i,
    /\b(?:how|when|where|what|why)\b/i,
    /\b(?:price\s+of|rate\s+of)\b/i,
    /\bkya\b/i,
];

/**
 * Determine if text is asking about payment methods, COD, EasyPaisa, or payment details
 *
 * @param {string} text
 * @returns {boolean}
 */
export function isPaymentQuery(text) {
    const raw = (text || '').trim().toLowerCase();
    if (!raw) return false;

    // Exact standalone matches
    if (/^(?:cod|cash|cash\s+on\s+delivery|easypaisa|easypisa|easypesa|easypaise|easy\s*(?:paisa|pisa|pesa|paise)|ep|payment|payments)$/i.test(raw)) {
        return true;
    }

    // Direct starts with payment commands
    if (/^(?:payment\s+methods?|payment\s+options?|payment\s+details?|payment\s+mode|payment\s+modes|easy\s*(?:paisa|pisa|pesa|paise)\s*(?:number|account)|account\s+number|account\s+title|account\s+name|how\s+to\s+pay|pay\s+kaise)\b/i.test(raw)) {
        return true;
    }

    // Payment words accompanied by interrogatives, options or actions
    const hasPaymentWord = /\b(?:payment|payments|easypaisa|easypisa|easypesa|easypaise|easy\s*(?:paisa|pisa|pesa|paise)|cod|cash\s+on\s+delivery)\b/i.test(raw);
    if (hasPaymentWord) {
        if (/\b(?:method|methods|option|options|detail|details|kaise|karun|karein|karna|hogi|tarika|tareeqa|kya|kahan|available|accept|bhejo|send|number|title|account)\b/i.test(raw) || raw.includes('?')) {
            return true;
        }
    }

    return false;
}

/**
 * Determine if text is asking about delivery areas, coverage, or delivery fee
 *
 * @param {string} text
 * @returns {boolean}
 */
export function isDeliveryInfoQuery(text) {
    const raw = (text || '').trim().toLowerCase();
    if (!raw) return false;

    // Delivery time / duration questions are NOT area questions
    if (/\b(?:kitni\s*dair|kitna\s*time|kab\s*tak|timing|duration|waqt)\b/i.test(raw)) {
        return false;
    }

    if (/\b(?:delivery\s*areas?|delivery\s*locations?|kahan\s*deliver|delivery\s*kahan|deliver\s*kahan|coverage\s*areas?|free\s*delivery\s*areas?|delivery\s*charges?|delivery\s*fee|delivery\s*charges\s*kya)\b/i.test(raw)) {
        return true;
    }

    if (/\b(?:deliver|delivery)\b/i.test(raw) && /\b(?:areas?|locations?|ilaqon?|ilaqe|jagah|kahan|kidhar|charges?|fee|charge|free|covered|coverage|list|possible)\b/i.test(raw)) {
        return true;
    }

    if (/\b(?:kon\s*konsi\s*(?:location|area|ilaq|jagah)|kahan\s*kahan\s*deliver)\b/i.test(raw)) {
        return true;
    }

    if (/\b(?:ghori\s*vvip|ghauri\s*vip|dhoke\s*kala\s*khan|is\s*ilaqe\s*me)\b/i.test(raw)) {
        return true;
    }

    return false;
}

/**
 * Deterministic Intent Provider implementation
 */
export class DeterministicIntentProvider {
    /**
     * Parse intent from normalized context
     *
     * @param {Object} context
     * @param {string} context.text
     * @param {string} [context.stage]
     * @param {string} [context.messageType]
     * @param {Object} [context.location]
     * @returns {{ intent: string, entities: Object, confidence: number }}
     */
    parseIntent(context) {
        const text = (context.text || '').trim();
        const stage = context.stage || 'START';
        const lower = text.toLowerCase();
        const hasLocation = Boolean(
            context.location ||
            context.messageType === 'location' ||
            context.messageType === 'live_location' ||
            context.messageType === 'current_location'
        );
        const mapsUrl = extractGoogleMapsUrl(text);

        // Global Location Detection: If user shared WhatsApp location pin, live location, or Google Maps URL
        if ((hasLocation || mapsUrl) && stage !== 'WAITING_NAME' && stage !== 'WAITING_CONTACT' && stage !== 'WAITING_ORDER_CONFIRMATION') {
            return {
                intent: 'PROVIDE_LOCATION',
                entities: {
                    location: context.location || null,
                    locationText: mapsUrl || (context.location?.name ? `${context.location.name}, ${context.location.address || ''}`.trim() : text),
                },
                confidence: 1.0,
            };
        }

        // ─── 1. Strict Stage Dialog Handlers ─────────────────────────────────

        // WAITING_NAME
        if (stage === 'WAITING_NAME') {
            if (NEGATIVE_REGEX.test(lower) && (lower === 'cancel' || lower === 'no')) {
                return { intent: 'DECLINE_ORDER', entities: {}, confidence: 0.95 };
            }
            if (text.length >= 2 && text.length <= 60 && !text.startsWith('/')) {
                return {
                    intent: 'PROVIDE_NAME',
                    entities: { customerName: text },
                    confidence: 0.95,
                };
            }
        }

        // WAITING_CONTACT
        if (stage === 'WAITING_CONTACT') {
            if (SAME_NUMBER_REGEX.test(lower)) {
                return {
                    intent: 'USE_SAME_WHATSAPP_NUMBER',
                    entities: {},
                    confidence: 0.99,
                };
            }

            const strippedPhone = text.replace(/[\s\-\(\)]/g, '');
            if (PHONE_NUMBER_REGEX.test(strippedPhone) || /^\d{10,12}$/.test(strippedPhone)) {
                return {
                    intent: 'PROVIDE_PHONE',
                    entities: { phone: strippedPhone },
                    confidence: 0.95,
                };
            }
        }

        // WAITING_LOCATION
        if (stage === 'WAITING_LOCATION') {
            if (hasLocation) {
                return {
                    intent: 'PROVIDE_LOCATION',
                    entities: { location: context.location },
                    confidence: 1.0,
                };
            }
            if (isDeliveryInfoQuery(lower) || /\b(?:areas?|locations?|kahan|kidhar|kon\s*konsi|list)\b/i.test(lower)) {
                return {
                    intent: 'DELIVERY_AREAS_QUERY',
                    entities: {},
                    confidence: 0.98,
                };
            }
            if (NEGATIVE_REGEX.test(lower) || lower === 'cancel' || lower === 'cancel order') {
                return {
                    intent: 'CANCEL',
                    entities: {},
                    confidence: 0.95,
                };
            }
            if (HELP_REGEX.test(lower)) {
                return {
                    intent: 'HELP',
                    entities: {},
                    confidence: 0.95,
                };
            }
            if (CART_VIEW_REGEX.test(lower)) {
                return {
                    intent: 'SHOW_CART',
                    entities: {},
                    confidence: 0.95,
                };
            }
            if (text.length >= 3) {
                return {
                    intent: 'PROVIDE_LOCATION',
                    entities: { locationText: text },
                    confidence: 0.9,
                };
            }
        }

        // WAITING_PAYMENT
        if (stage === 'WAITING_PAYMENT') {
            if (isPaymentQuery(lower) && (lower.includes('?') || lower.includes('kya') || lower.includes('kaise') || lower.includes('number') || lower.includes('detail') || lower.includes('title') || lower.includes('tarika') || lower.includes('tareeqa') || lower.includes('how'))) {
                return {
                    intent: 'PAYMENT_METHODS_QUERY',
                    entities: {},
                    confidence: 0.95,
                };
            }
            if (COD_REGEX.test(lower)) {
                return {
                    intent: 'SELECT_PAYMENT',
                    entities: { paymentMethod: 'COD' },
                    confidence: 0.95,
                };
            }
            if (EASYPAISA_REGEX.test(lower)) {
                return {
                    intent: 'SELECT_PAYMENT',
                    entities: { paymentMethod: 'EASYPAISA' },
                    confidence: 0.95,
                };
            }
        }

        // WAITING_ORDER_CONFIRMATION
        if (stage === 'WAITING_ORDER_CONFIRMATION') {
            if (POSITIVE_REGEX.test(lower)) {
                return { intent: 'CONFIRM_ORDER', entities: {}, confidence: 0.99 };
            }
            if (NEGATIVE_REGEX.test(lower)) {
                return { intent: 'DECLINE_ORDER', entities: {}, confidence: 0.99 };
            }
        }

        // WAITING_CANCEL_CONFIRMATION
        if (stage === 'WAITING_CANCEL_CONFIRMATION') {
            if (POSITIVE_REGEX.test(lower)) {
                return { intent: 'CONFIRM_CANCELLATION', entities: {}, confidence: 0.99 };
            }
            if (NEGATIVE_REGEX.test(lower)) {
                return { intent: 'DECLINE_CANCELLATION', entities: {}, confidence: 0.99 };
            }
        }

        // ─── 2. Global Status & Cancellation Commands ────────────────────────

        const cancelMatch = lower.match(/(?:cancel(?:\s+order)?)\s+(#?CC-\d{6})/i);
        if (cancelMatch) {
            return {
                intent: 'REQUEST_ORDER_CANCELLATION',
                entities: { orderNumber: cancelMatch[1].replace('#', '').toUpperCase() },
                confidence: 0.98,
            };
        }

        if (CANCEL_QUERY_REGEX.test(lower) && (lower.includes('order') || lower === 'cancel order')) {
            const rawOrderNo = text.match(ORDER_NUMBER_REGEX);
            return {
                intent: 'REQUEST_ORDER_CANCELLATION',
                entities: { orderNumber: rawOrderNo ? rawOrderNo[0].replace('#', '').toUpperCase() : null },
                confidence: 0.95,
            };
        }

        if (STATUS_QUERY_REGEX.test(lower) || lower.includes('order status') || lower.includes('track')) {
            const rawOrderNo = text.match(ORDER_NUMBER_REGEX);
            return {
                intent: 'ORDER_STATUS_QUERY',
                entities: { orderNumber: rawOrderNo ? rawOrderNo[0].replace('#', '').toUpperCase() : null },
                confidence: 0.95,
            };
        }

        // ─── 3. Core Navigation & Flow Commands ──────────────────────────────

        if (DELETE_DATA_REGEX.test(lower)) {
            return { intent: 'DELETE_MY_DATA', entities: {}, confidence: 0.98 };
        }

        if (START_ORDER_REGEX.test(lower)) {
            return { intent: 'START_ORDER', entities: {}, confidence: 0.95 };
        }

        if (CHECKOUT_REGEX.test(lower)) {
            return { intent: 'CHECKOUT', entities: {}, confidence: 0.95 };
        }

        if (CLEAR_CART_REGEX.test(lower)) {
            return { intent: 'CLEAR_CART', entities: {}, confidence: 0.95 };
        }

        // ─── 4. Cart Modifications & Addition Patterns (Checked BEFORE Show Cart!) ──

        // Cart Add Pattern Urdu 1: "cart mai add kro deal 5", "cart me daal do 2 zinger", "cart mein add kardo burger"
        const cartAddUrdu1 = lower.match(/^(?:cart\s*(?:m|me|mai|mein)\s*(?:add|daal|dalo|rakh|rakho)\s*(?:kro|kar\s*do|karo)?)\s+(.+)$/i);
        if (cartAddUrdu1) {
            const inner = cartAddUrdu1[1].trim();
            const qtyMatch = inner.match(/^(\d+)\s+(?:x\s+)?(.+)$/);
            return {
                intent: 'ADD_ITEM',
                entities: {
                    quantity: qtyMatch ? parseInt(qtyMatch[1], 10) : 1,
                    itemQuery: qtyMatch ? qtyMatch[2].trim() : inner,
                },
                confidence: 0.96,
            };
        }

        // Cart Add Pattern Urdu 2: "add deal 5 to cart", "daal do 2 zinger cart me", "add 1 zinger in cart"
        const cartAddUrdu2 = lower.match(/^(?:add|daal|dalo|rakh|rakho)\s+(.+?)\s+(?:in|to|mein|mai|me)\s+cart$/i);
        if (cartAddUrdu2) {
            const inner = cartAddUrdu2[1].trim();
            const qtyMatch = inner.match(/^(\d+)\s+(?:x\s+)?(.+)$/);
            return {
                intent: 'ADD_ITEM',
                entities: {
                    quantity: qtyMatch ? parseInt(qtyMatch[1], 10) : 1,
                    itemQuery: qtyMatch ? qtyMatch[2].trim() : inner,
                },
                confidence: 0.96,
            };
        }

        // Cart Add Pattern Urdu 3: "deal 5 cart me add kardo", "2 zinger ko cart mai daal do"
        const cartAddUrdu3 = lower.match(/^(.+?)\s+(?:ko\s+)?cart\s*(?:m|me|mai|mein)\s*(?:add|daal|dalo|rakh|rakho)(?:\s*(?:kro|kar\s*do|karo))?$/i);
        if (cartAddUrdu3) {
            const inner = cartAddUrdu3[1].trim();
            const qtyMatch = inner.match(/^(\d+)\s+(?:x\s+)?(.+)$/);
            return {
                intent: 'ADD_ITEM',
                entities: {
                    quantity: qtyMatch ? parseInt(qtyMatch[1], 10) : 1,
                    itemQuery: qtyMatch ? qtyMatch[2].trim() : inner,
                },
                confidence: 0.96,
            };
        }

        // Contextual Cart Add: "add kr du cart mai", "cart mai add kardo", "add kardo cart me"
        if (/^(?:add|daal|dalo)\s+(?:kr\s*du|kar\s*do|kro|karo)?\s*(?:cart\s*(?:m|me|mai|mein)|in\s*cart|to\s*cart)/i.test(lower) ||
            /^(?:cart\s*(?:m|me|mai|mein)\s*(?:add|daal|dalo)\s*(?:kr\s*du|kar\s*do|kro|karo)?)$/i.test(lower)) {
            return {
                intent: 'ADD_ITEM',
                entities: {
                    quantity: 1,
                    contextual: true,
                },
                confidence: 0.93,
            };
        }

        // Remove item: "remove zinger", "zinger hata do", "delete zinger"
        const removeMatch = lower.match(/^(?:remove|delete|hata\s+do)\s+(.+)$/i) ||
                            lower.match(/^(.+?)\s+(?:hata\s+do|remove|delete)$/i);
        if (removeMatch) {
            return {
                intent: 'REMOVE_ITEM',
                entities: { itemQuery: removeMatch[1].trim() },
                confidence: 0.92,
            };
        }

        // Change quantity: "change zinger to 3", "make zinger 3"
        const changeQtyMatch = lower.match(/^(?:change|update|make)\s+(.+?)\s+(?:to\s+)?(\d+)$/i);
        if (changeQtyMatch) {
            return {
                intent: 'CHANGE_QUANTITY',
                entities: {
                    itemQuery: changeQtyMatch[1].trim(),
                    quantity: parseInt(changeQtyMatch[2], 10),
                },
                confidence: 0.92,
            };
        }

        // Add item Pattern A: "2 zinger", "3 chicken pizza", "1 deal 1"
        const prefixQtyMatch = lower.match(/^(\d+)\s+(?:x\s+)?([a-zA-Z0-9\s-]+)$/);
        if (prefixQtyMatch && prefixQtyMatch[2].trim().length > 1) {
            return {
                intent: 'ADD_ITEM',
                entities: {
                    quantity: parseInt(prefixQtyMatch[1], 10),
                    itemQuery: prefixQtyMatch[2].trim(),
                },
                confidence: 0.9,
            };
        }

        // Add item Pattern B: "zinger x2", "deal 1 x2"
        const suffixQtyMatch = lower.match(/^([a-zA-Z0-9\s-]+?)\s*(?:x|\*|\bx\b)\s*(\d+)$/);
        if (suffixQtyMatch && suffixQtyMatch[1].trim().length > 1) {
            return {
                intent: 'ADD_ITEM',
                entities: {
                    quantity: parseInt(suffixQtyMatch[2], 10),
                    itemQuery: suffixQtyMatch[1].trim(),
                },
                confidence: 0.9,
            };
        }

        // Add item Pattern C: "add 2 zinger", "add zinger"
        const addVerbMatch = lower.match(/^(?:add|order|chahiye)\s+(\d+)?\s*([a-zA-Z0-9\s-]+)$/);
        if (addVerbMatch) {
            return {
                intent: 'ADD_ITEM',
                entities: {
                    quantity: addVerbMatch[1] ? parseInt(addVerbMatch[1], 10) : 1,
                    itemQuery: addVerbMatch[2].trim(),
                },
                confidence: 0.9,
            };
        }

        // Add item Pattern D: direct numbered deal (e.g. "deal 1", "deal #2", "deal no 3")
        const directDealMatch = lower.match(/^(?:deal\s*(?:#|no\.?)?\s*\d+)$/i);
        if (directDealMatch) {
            return {
                intent: 'ADD_ITEM',
                entities: {
                    quantity: 1,
                    itemQuery: lower.trim(),
                },
                confidence: 0.92,
            };
        }

        // Pure View Cart (checked ONLY after add/remove patterns have been exhausted)
        if (CART_VIEW_REGEX.test(lower)) {
            return { intent: 'SHOW_CART', entities: {}, confidence: 0.95 };
        }

        if (DEALS_REGEX.test(lower)) {
            return { intent: 'SHOW_DEALS', entities: {}, confidence: 0.95 };
        }

        if (MENU_REGEX.test(lower)) {
            return { intent: 'SHOW_MENU', entities: {}, confidence: 0.95 };
        }

        if (HELP_REGEX.test(lower)) {
            return { intent: 'HELP', entities: {}, confidence: 0.95 };
        }

        if (HUMAN_HANDOFF_REGEX.test(lower)) {
            return { intent: 'HUMAN_HANDOFF', entities: {}, confidence: 0.95 };
        }

        if (DELETE_DATA_REGEX.test(lower)) {
            return { intent: 'DELETE_MY_DATA', entities: {}, confidence: 0.98 };
        }

        if (GREETING_REGEX.test(lower)) {
            return { intent: 'GREETING', entities: {}, confidence: 0.95 };
        }

        // Category queries (e.g. "Classic Pizzas mein kia kia ha", "Classic Pizzas", "drinks mai kya ha", "drinks dikhao")
        const categoryQueryMatch = lower.match(/^(?:category\s+)?(classic\s+pizzas?|premium\s+pizzas?|pizza\s+deals?|burger\s+deals?|(?:special|combo)\s+deals?|drinks?|beverages?|pizzas?|burgers?|sides?|desserts?)(?:\s+(?:mai|me|mein)\s+(?:kya|kia|kay)\s*(?:kya|kia|kay)?\s*(?:h|ha|hai|hay)?|(?:\s+(?:dikhao|bhejo|options|list|items?)))?$/i);
        if (categoryQueryMatch) {
            return {
                intent: 'SHOW_CATEGORY',
                entities: { categoryName: categoryQueryMatch[1].trim() },
                confidence: 0.95,
            };
        }

        // Substring match for category inquiry (e.g. "Classic Pizzas mein kia kia ha")
        const subCatMatch = lower.match(/(classic\s+pizzas?|premium\s+pizzas?|pizza\s+deals?|burger\s+deals?|(?:special|combo)\s+deals?|drinks?|beverages?|pizzas?|burgers?)\s+(?:mai|me|mein)\s+(?:kya|kia|kay)/i);
        if (subCatMatch) {
            return {
                intent: 'SHOW_CATEGORY',
                entities: { categoryName: subCatMatch[1].trim() },
                confidence: 0.95,
            };
        }

        // ─── Delivery Areas Query (Settings & Coverage Priority over FAQ) ─────
        if (isDeliveryInfoQuery(lower)) {
            return {
                intent: 'DELIVERY_AREAS_QUERY',
                entities: {},
                confidence: 0.95,
            };
        }

        // ─── Payment Methods Query (Restaurant Settings Priority over FAQ) ────
        if (isPaymentQuery(lower)) {
            return {
                intent: 'PAYMENT_METHODS_QUERY',
                entities: {},
                confidence: 0.95,
            };
        }

        // ─── 5. FAQ / Knowledge Questions ────────────────────────────────────

        const isFaqQuestion = FAQ_PATTERNS.some(p => p.test(lower));
        if (isFaqQuestion || lower.includes('?')) {
            return {
                intent: 'FAQ_QUERY',
                entities: { question: text },
                confidence: 0.88,
            };
        }

        // ─── 6. Category Selection & Numbers ─────────────────────────────────

        // If in BROWSING_MENU stage and user enters a numeric choice: "1", "2", "3"
        if (stage === 'BROWSING_MENU') {
            if (/^\d{1,2}$/.test(lower.trim())) {
                const num = parseInt(lower.trim(), 10);
                if (!isNaN(num) && num >= 1 && num <= 20) {
                    return {
                        intent: 'SHOW_CATEGORY',
                        entities: { categoryIndex: num },
                        confidence: 0.95,
                    };
                }
            }
        }

        if (/^(?:category\s*)?(\d{1,2})$/i.test(lower)) {
            const num = parseInt(lower.replace(/\D/g, ''), 10);
            return {
                intent: 'SHOW_CATEGORY',
                entities: { categoryIndex: num },
                confidence: 0.85,
            };
        }

        const categoryKeywords = [
            'classic pizzas', 'classic pizza',
            'premium pizzas', 'premium pizza',
            'pizza deals', 'pizza deal',
            'burger deals', 'burger deal',
            'special deals', 'special deal', 'combo deals', 'combo deal',
            'burger', 'burgers', 'pizza', 'pizzas', 'side', 'sides', 'drink', 'drinks', 'beverage', 'dessert'
        ];
        if (categoryKeywords.includes(lower)) {
            return {
                intent: 'SHOW_CATEGORY',
                entities: { categoryName: lower },
                confidence: 0.95,
            };
        }

        // ─── 7. Unknown Fallback ──────────────────────────────────────────────
        return {
            intent: 'UNKNOWN',
            entities: { rawText: text },
            confidence: 0.1,
        };
    }
}

// Global default provider instance
const defaultProvider = new DeterministicIntentProvider();

/**
 * AI-Ready Parse Intent interface
 *
 * @param {Object} context
 * @returns {{ intent: string, entities: Object, confidence: number }}
 */
export function parseIntent(context) {
    return defaultProvider.parseIntent(context);
}

// ─── Zero-Token Fast Routing (Hissa 4) ────────────────────────────────────

import { muteChatForHandover, unmuteChat } from './handoverService.js';
import { getCatalogCache } from './catalogCacheService.js';

const FAST_HANDOVER_REGEX = /\b(bot\s*(se|sai|sy)?\s*(baat\s*)?(nahi|nh|nai|nhi|mat)|ai\s*(se|sai|sy)?\s*(baat\s*)?(nahi|nh|nai|nhi|mat)|(ap|aap|tum)\s*(se|sai|sy)?\s*(baat\s*)?(nahi|nh|nai|nhi|mat)|baat\s*(nahi|nh|nai|nhi)\s*k(a)?rni|bat\s*(nahi|nh|nai|nhi)\s*k(a)?rni|agent|human|person|real\s*person|live\s*agent|representative|operator|manager|owner|malik|maalik|complaint|shikayat|shikayet|service\s*achi\s*nahi|service\s*achhi\s*nahi|call\s*me|call\s*karo|call\s*karein|phone\s*karo|bande\s*(se|sai|sy)\s*baat|banda|insan\s*(se|sai|sy)\s*baat|insan|talk\s*to\s*(human|agent|person|someone))\b/i;
const FAST_BOT_START_REGEX = /^((\.)?bot\s*(start|on|activate|active|resume|shuru|chalao)|start\s*bot|resume\s*bot|unmute|bot|\.bot)$/i;

const FAST_GREETING_REGEX = /^(salam|assalam|assalamualaikum|assalam\s*o\s*alaikum|aoa|hi+|hello+|hey+|bhai|suno)[\s!?.]*$/i;
const FAST_CHITCHAT_REGEX = /\b(kese ho|keise ho|kaise ho|kya haal hai|kia haal hai|how are you|sab theek|sab kheriat)\b/i;
const FAST_THANKS_REGEX = /^(thanks|thank you|shukriya|shukria|jazakallah|jazak allah)[\s!?.]*$/i;
const FAST_OFF_TOPIC_REGEX = /\b(cricket|psl|imran|nawaz|politics|siyasat|mausam|weather|joke|lateefa|shayari|movie|film|coding|python|javascript)\b/i;

const FAST_MENU_REGEX = /^(menu|menue|show\s+menu|menu\s*(?:dikhao|dijhao|dikaho|dekhao|dikhayein|bhejo|send|btao|batao|list|do|plz|please)?|rate\s*list|food\s*list|items?\s*list|kya\s*milta\s*hai|apke\s*pas\s*kya\s*hai|kya\s*kya\s*hai|kya\s*hai)$/i;
const FAST_MENU_CONTAINS = /\b(menu|menue|catalog|catlog|rate\s*list|food\s*list|items?\s*list)\b/i;

// ─── Fast Route Regexes for Store Profile & Settings (Zero AI Tokens) ─────
const FAST_TIMING_REGEX = /^(timing|timings|time|hours|auqat)[\s!?.]*$/i;
const FAST_TIMING_CONTAINS = /\b(timing\s*kya\s*hai|timings\s*kya\s*hain?|kab\s*(?:open|close|khulta|band)|kitne\s*baje\s*(?:open|close|khulta|band)|open\s*kab|close\s*kab|open\s*hai|closed?\s*hai|opening\s*time|closing\s*time|shop\s*timings?|restaurant\s*timings?|outlet\s*timings?|store\s*timings?|kya\s*time\s*hai)\b/i;

const FAST_STORE_LOCATION_REGEX = /^(location|address|pata|outlet|branch|map)[\s!?.]*$/i;
const FAST_STORE_LOCATION_CONTAINS = /\b(apki\s*location|aapki\s*location|apka\s*address|aapka\s*address|store\s*location|outlet\s*location|shop\s*location|restaurant\s*location|restaurant\s*address|outlet\s*address|shop\s*address|store\s*address|branch\s*kahan|shop\s*kahan|outlet\s*kahan|store\s*kahan|restaurant\s*kahan|kahan\s*hai\s*(?:shop|outlet|branch|store|restaurant)|kidhar\s*hai\s*(?:shop|outlet|branch|store|restaurant)|pata\s*batao|address\s*batao|location\s*bhejo|location\s*share|kahan\s*hotay?\s*ho|kidhar\s*hotay?\s*ho|kahan\s*par\s*hai|kahan\s*pe\s*hai|kidhar\s*hai|kahan\s*hai)\b/i;

const FAST_PAYMENT_REGEX = /^(payment|payments|easypaisa|easypisa|easypesa|easypaise|easy\s*(?:paisa|pisa|pesa|paise)|ep|jazzcash|jazz\s*cash|account|account\s*number|account\s*title)[\s!?.]*$/i;
const FAST_PAYMENT_CONTAINS = /\b(payment\s*methods?|payment\s*options?|payment\s*details?|payment\s*mode|payment\s*modes|how\s*to\s*pay|pay\s*kaise|payment\s*kaise|online\s*payment|bank\s*transfer|advance\s*payment|easypaisa|easypisa|easypesa|easypaise|easy\s*(?:paisa|pisa|pesa|paise)|account\s*number|account\s*title|account\s*name|account\s*detail|account\s*details)\b/i;

const FAST_COD_REGEX = /^(cod|cash|cash\s*on\s*delivery)[\s!?.]*$/i;
const FAST_COD_CONTAINS = /\b(cash\s*on\s*delivery|cod\s*(?:hai|available|hoga|hogi|chalta|accept))\b/i;

/**
 * Check if an incoming message matches any of the 5 fast routes.
 * Fast routes execute deterministically with 0 LLM tokens.
 *
 * @param {Object} params
 * @param {string} params.text
 * @param {string} params.whatsappPhone
 * @param {string} params.sessionKey
 * @param {string} params.chatId
 * @param {Object} [params.sock]
 * @returns {Promise<{handled: boolean, routeName?: string, reply?: string}>}
 */
export async function checkFastRoute({ text, whatsappPhone, sessionKey, chatId, sock }) {
    if (!text || typeof text !== 'string') return { handled: false };

    const raw = text.trim();
    const lower = raw.toLowerCase();
    const words = lower.split(/\s+/).filter(Boolean);
    const wordCount = words.length;

    // ── 1. Handover / Complaint / Real Person Request ──
    if (FAST_HANDOVER_REGEX.test(lower)) {
        let customerReply = 'Aapki request humare support agent ko forward kar di gayi hai, humara representative jald aapse rabta karega.';
        try {
            const { getDbClient } = await import('../db/client.js');
            const { getDefaultRestaurantId } = await import('./restaurantService.js');
            const prisma = getDbClient();
            const restId = await getDefaultRestaurantId();
            if (prisma && restId) {
                const setting = await prisma.restaurantSetting.findUnique({
                    where: { restaurant_id_key: { restaurant_id: restId, key: 'human_handoff_message' } }
                });
                if (setting?.value?.trim()) {
                    customerReply = setting.value.trim();
                }
            }
        } catch (_) {}

        try {
            await muteChatForHandover({
                chatId,
                sessionKey,
                reason: raw || 'Customer requested human support / real person',
                customerPhone: whatsappPhone,
                sock,
            });
        } catch (_) {}
        return {
            handled: true,
            routeName: 'handover',
            reply: customerReply,
        };
    }

    // ── 2. Bot Start ──
    if (FAST_BOT_START_REGEX.test(lower)) {
        try {
            if (chatId) unmuteChat(chatId);
            if (sessionKey) unmuteChat(sessionKey);
            if (whatsappPhone) unmuteChat(whatsappPhone);
        } catch (_) {}
        const cache = await getCatalogCache();
        const store = cache.storeName || 'Burger Mehfil';
        return {
            handled: true,
            routeName: 'bot_start',
            reply: `Walaikum Assalam! Khushamdeed to *${store}*! Main aapka AI food ordering assistant hoon. Bot ko dobara shuru kar diya gaya hai! Aaj aap kya order karna chahenge? Hamara menu dekhne ke liye 'menu' ya 'deals' likhein!`,
        };
    }

    // Food order action: customer wants to ADD or ORDER specific food items (should not be intercepted by menu/info views)
    const hasCartOrOrderAction = /\b(add\s+to\s+cart|cart\s*(?:m|me|mai|mein)|checkout|check\s*out|daal\s*do|cancel\s+order|bar\s*(?:kr|kar)\s*do|sari\s+deals?|har\s+deal)\b/i.test(lower) ||
        /^(?:add|order)\s+\d+/i.test(lower) ||
        /^\d+\s*(?:x\s+)?(?:pizza|burger|deal|zinger|roll)/i.test(lower);

    // ── Check Fast Follow-up: Affirmative confirmation of pending Order Summary ──
    const userSessionId = sessionKey || chatId || whatsappPhone;

    // ── Check Fast Route: Order Cancellation / Cart Clear (Zero Tokens) ──
    const isCancelOrClearRequest = /^(?:cancel|cancel\s*(?:kr\s*do|kardo|kar\s*do|kr\s*du|kar\s*dein|karden|order|my\s*order)?|order\s*cancel(?:\s*(?:kr\s*do|kardo|kar\s*do|kr\s*du|kar\s*dein))?|cart\s*(?:clear|khali)(?:\s*(?:kr\s*do|kardo|kar\s*do))?|clear\s*cart|nahi\s*(?:chahiye|lena|mangwana|karna)|rehne\s*do|rehn\s*do|chhor\s*do|khatam\s*karo)[\s!.?]*$/i.test(lower.trim());
    if (isCancelOrClearRequest && userSessionId) {
        try {
            const { getActiveCart, clearCart } = await import('./cartService.js');
            const { clearSessionOrderDetails } = await import('./sessionService.js');
            const cache = await getCatalogCache();
            const cleanPhone = (whatsappPhone || '').replace(/\D/g, '');
            const cart = await getActiveCart({ sessionKey: userSessionId, restaurantId: cache.restId, chatId });

            if (cart?.items && cart.items.length > 0) {
                await clearCart({ sessionKey: userSessionId });
                clearSessionOrderDetails(userSessionId, cleanPhone);
                _lastDiscussedDealBySession.delete(userSessionId);
                return {
                    handled: true,
                    routeName: 'fast_cancel_order',
                    reply: `Theek hai Bhapa! Aap ka cart khali kar diya gaya hai aur order cancel ho gaya hai. 👍\n\nJab bhi dobara bhook lagay ya kuch lazeez khana ho, bas 'menu' ya 'deals' likh kar bhej dein! 😊`,
                };
            }

            // If cart is empty, check if user specified an order number like CC-123456
            const orderMatch = lower.match(/#?CC-\d{6}/i);
            if (orderMatch) {
                const { cancelOrder } = await import('./orderService.js');
                const orderNum = orderMatch[0].replace('#', '').toUpperCase();
                const cancelRes = await cancelOrder({
                    restaurantId: cache.restId,
                    orderNumber: orderNum,
                    reason: 'Customer requested cancellation via WhatsApp',
                });
                if (cancelRes?.success) {
                    return {
                        handled: true,
                        routeName: 'fast_cancel_placed_order',
                        reply: `Bhapa, aap ka order *#${orderNum}* cancel kar diya gaya hai. Koi aur khidmat ho to zaroor bataiye ga!`,
                    };
                } else {
                    return {
                        handled: true,
                        routeName: 'fast_cancel_placed_order_failed',
                        reply: `Bhapa, order *#${orderNum}* cancel nahi ho saka: ${cancelRes?.message || 'Order tayar ho chuka hai ya kitchen mein ja chuka hai.'}`,
                    };
                }
            }

            return {
                handled: true,
                routeName: 'fast_cancel_empty',
                reply: `Bhapa, aap ke cart mein koi item nahi hai aur koi pending order nahi hai. Agar kuch mangwana hai to 'menu' ya 'deals' likhein! 😊`,
            };
        } catch (err) {
            console.error('[FAST_ROUTE] Error processing cancellation:', err.message);
        }
    }

    const hasCartModification = /\b(add|extra|aur|kuch|change|badal|hatao?|nikal|kam|zyada|\d+\s*x|\d+\s*bar|\d+\s*martaba|fries|drink|pepsi|7up|burger|pizza|deal|deals)\b/i.test(lower);
    const isOrderFinalConfirmation = !hasCartModification &&
        /^(?:haan|han|hn|jee|ji|yes|yep|ok|ok\s*done|theek\s*hai?|done|confirm|confirm\s*(?:hai|h|kr\s*do|kar\s*do)?|book\s*(?:kar\s*do|kr\s*do)|order\s*(?:kar\s*do|kr\s*do|book\s*kar\s*do)|final\s*(?:kar\s*do|kr\s*do)|bhej\s*do|haan\s*kar\s*do|haan\s*kr\s*do|order\s*final)$/i.test(lower.trim()) && wordCount <= 5;
    if (isOrderFinalConfirmation && userSessionId) {
        try {
            const { getSessionOrderDetails, updateSessionOrderDetails } = await import('./sessionService.js');
            const cleanPhone = (whatsappPhone || '').replace(/\D/g, '');
            const details = getSessionOrderDetails(userSessionId, cleanPhone);
            const { getActiveCart } = await import('./cartService.js');
            const cache = await getCatalogCache();
            const cart = await getActiveCart({ sessionKey: userSessionId, restaurantId: cache.restId, chatId });
            if (cart?.items && cart.items.length > 0 && details.readyForConfirmation) {
                if (details.name && (details.address || details.location) && details.paymentMethod) {
                    const { createOrder } = await import('./orderService.js');
                    const res = await createOrder({
                        restaurantId: cache.restId,
                        sessionKey: userSessionId,
                        customerName: details.name,
                        phone: details.phone || cleanPhone,
                        delivery: {
                            address: details.address || details.location?.address || 'Google Maps Location Pin',
                            latitude: details.location?.latitude ?? null,
                            longitude: details.location?.longitude ?? null,
                        },
                        paymentMethod: details.paymentMethod,
                    });
                    const orderNum = res.order?.orderNumber || res.order?.order_number;
                    const total = Number(res.order?.pricing?.total ?? res.order?.total ?? 0);
                    if (orderNum) {
                        details.readyForConfirmation = false;
                        _lastDiscussedDealBySession.delete(userSessionId);
                        return {
                            handled: true,
                            routeName: 'fast_order_confirm',
                            reply: `Wah ${details.name} bhai! Maza aa gaya! 🎉\n\nAap ka order successful book ho gaya hai. Aap ka order number *${orderNum}* hai, aur total bill delivery fee mila kar *Rs. ${total}* ban raha hai (${details.paymentMethod === 'COD' ? 'Cash on Delivery' : 'EasyPaisa'}).\n\nBas thori der wait karo, Cravey Crust ki taraf se garma-garam khana foran *${(details.address || '').slice(0, 50)}* aap ke paas puhanch raha hai! Koi aur masla ho ya kuch aur mangwana ho to Burger Raja ko yaad karna!`,
                        };
                    }
                }
            }
        } catch (err) {
            console.error('[FAST_ROUTE] Error booking confirmed order:', err.message);
        }
    }

    // ── Check Fast Follow-up: Affirmative confirmation to order last discussed deal (Zero Tokens) ──
    const hasOrderConfirmWord = /\b(?:confirm|final|done|book|oder|order\s*final|bana\s*ha|bill|bil)\b/i.test(lower);
    const isAffirmative = !hasOrderConfirmWord && /^(?:haan|han|jee|ji|yes|kar do|kardo|kr do|kr du|order|oder|order kar do|order kr do|order kr du|order kr di|oder kr di|oder kr do|oder kardo|haan kr du|haan kardo|haan kr do bhai|han order kr du|yeh kr du)\b/i.test(lower) && wordCount <= 6;
    if (isAffirmative && userSessionId && _lastDiscussedDealBySession.has(userSessionId)) {
        const lastDealEntry = _lastDiscussedDealBySession.get(userSessionId);
        if (lastDealEntry && (Date.now() - lastDealEntry.timestamp < 90 * 1000)) {
            try {
                const { getActiveCart, addToCart } = await import('./cartService.js');
                const cache = await getCatalogCache();
                const d = lastDealEntry.deal;
                const existingCart = await getActiveCart({ sessionKey: userSessionId, restaurantId: cache.restId, chatId });
                const alreadyHasDeal = existingCart?.items?.some(i => i.deal_id === d.id);

                if (!alreadyHasDeal) {
                    await addToCart({
                        sessionKey: userSessionId,
                        restaurantId: cache.restId,
                        chatId,
                        verifiedPhone: whatsappPhone,
                        dealId: d.id,
                        quantity: 1,
                    });
                    _lastDiscussedDealBySession.delete(userSessionId);

                    const dealName = d.name;
                    const dealDesc = d.description ? ` (${d.description})` : '';
                    const dealPrice = Number(d.deal_price);
                    const displayPhone = whatsappPhone || 'WhatsApp number';

                    const confirmReply = `Zabardast Jigri! *${dealName}* cart mein add ho gayi hai! 🎉\n\n📋 *Order Summary:*\n• 1x ${dealName}${dealDesc} — Rs. ${dealPrice}\n*Total Bill:* Rs. ${dealPrice}\n\nAap ka order final karne ke liye meharbani karke yeh details bata dein:\n1. Aap ka Naam (Name)\n2. Mukammal Delivery Address (ya WhatsApp Location Pin)\n3. Contact Phone (kya yahi ${displayPhone} theek hai ya koi doosra number hai?)\n4. Payment Method (Cash on Delivery ya EasyPaisa)`;

                    return {
                        handled: true,
                        routeName: 'deal_confirm_add',
                        reply: confirmReply,
                    };
                }
            } catch (err) {
                console.error('[FAST_ROUTE] Error adding confirmed deal:', err.message);
            }
        }
    }

    // ── Check Order Status / Confirmation Inquiry or Bill / Cart Inquiry (Zero Tokens) ──
    const isStatusQuery = /\b(?:mera\s+order|order\s*(?:status|confirm|confirmation|pakka|hua|howa|kahan|hua\s*k\s*nai|howa\s*k\s*nai))\b/i.test(lower);
    const isBillQuery = /\b(?:total\s*bi?ll?|kitna\s*bi?ll?|bi?ll?\s*kitna|katna\s*bana|kitna\s*banta|kitna\s*bana|cart\s*total|mera\s*bi?ll?|meara\s*total)\b/i.test(lower) && wordCount <= 8;

    if ((isStatusQuery || isBillQuery) && userSessionId) {
        try {
            const { getDbClient } = await import('../db/client.js');
            const { getDefaultRestaurantId } = await import('./restaurantService.js');
            const prisma = getDbClient();
            const restId = await getDefaultRestaurantId();
            const cleanPhone = (whatsappPhone || '').replace(/\D/g, '');

            // Check recent confirmed order (last 2 hours) if explicitly asking about order status
            if (isStatusQuery && prisma && restId) {
                const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
                const recentOrder = await prisma.order.findFirst({
                    where: {
                        restaurant_id: restId,
                        created_at: { gte: twoHoursAgo },
                        OR: [
                            ...(cleanPhone ? [{ phone: cleanPhone }, { whatsapp_phone: cleanPhone }] : []),
                            { customer: { phone: cleanPhone } }
                        ],
                    },
                    orderBy: { created_at: 'desc' },
                });

                if (recentOrder) {
                    const statusUrdu = {
                        PENDING: 'Confirm ho raha hai',
                        CONFIRMED: 'Confirm ho chuka hai aur bhatti mein taiyar ho raha hai',
                        PREPARING: 'Bhatti mein taiyar ho raha hai',
                        READY: 'Taiyar hai aur rider ka intezar hai',
                        OUT_FOR_DELIVERY: 'Rider delivery ke liye nikal chuka hai',
                        DELIVERED: 'Deliver ho chuka hai',
                        CANCELLED: 'Cancel ho gaya hai',
                    }[recentOrder.order_status] || 'Process ho raha hai';

                    return {
                        handled: true,
                        routeName: 'order_status_check',
                        reply: `Hala ${recentOrder.customer_name || 'Bhapa'}! Aap ka order *#${recentOrder.order_number}* ${statusUrdu}! 🎉\n\n💰 Total Bill: *Rs. ${Number(recentOrder.total)}* (${recentOrder.payment_method})\n📍 Delivery Address: ${recentOrder.delivery_address || 'Provided pin'}\n\nCravey Crust ka sawadi khana jald aap tak pahunch jayega! Shukriya!`,
                    };
                }
            }

            // Check active cart
            const { getActiveCart } = await import('./cartService.js');
            const { getSessionOrderDetails } = await import('./sessionService.js');
            const cache = await getCatalogCache();
            const cart = await getActiveCart({ sessionKey: userSessionId, restaurantId: cache.restId, chatId });
            if (cart?.items && cart.items.length > 0) {
                const details = getSessionOrderDetails(userSessionId, cleanPhone);
                const itemsList = cart.items.map(i => {
                    const n = i.deal ? i.deal.name : (i.menu_item?.name || 'Item');
                    const v = i.menu_variant ? ` (${i.menu_variant.name})` : '';
                    const p = Number(i.deal?.deal_price ?? i.menu_variant?.price ?? i.menu_item?.base_price ?? i.unit_price ?? 0) * i.quantity;
                    return `• ${i.quantity}x ${n}${v} — Rs. ${p}`;
                }).join('\n');
                const subtotal = cart.items.reduce((s, i) => s + Number(i.deal?.deal_price ?? i.menu_variant?.price ?? i.menu_item?.base_price ?? i.unit_price ?? 0) * i.quantity, 0);

                const missing = [];
                if (!details.name) missing.push('• Aap ka Naam (Name)');
                if (!details.address && !details.location) missing.push('• Mukammal Delivery Address (ya WhatsApp Location Pin)');
                if (!details.paymentMethod) missing.push('• Payment Method (Cash on Delivery ya EasyPaisa)');

                let deliveryFee = 0;
                let deliveryFeeKnown = false;
                if (details.address || details.location) {
                    try {
                        const { checkDeliveryAvailability } = await import('./deliveryService.js');
                        const dCheck = await checkDeliveryAvailability({
                            restaurantId: cache.restId,
                            address: details.address || details.location?.address,
                            subtotal,
                        });
                        if (dCheck?.available && typeof dCheck.deliveryFee === 'number') {
                            deliveryFee = dCheck.deliveryFee;
                            deliveryFeeKnown = true;
                        }
                    } catch (_) {}
                }
                const total = subtotal + deliveryFee;
                const feeText = deliveryFeeKnown ? (deliveryFee === 0 ? '(Free Delivery!)' : `(Items: Rs. ${subtotal} + Delivery: Rs. ${deliveryFee})`) : '(Delivery fee area ke mutabiq)';

                if (missing.length === 0) {
                    details.readyForConfirmation = true;
                    return {
                        handled: true,
                        routeName: 'order_status_check',
                        reply: `Jigri, aap ke cart ka total bill *Rs. ${total}* bana hai ${feeText}.\n\n📋 *Items:*\n${itemsList}\n\n📍 Delivery Address: *${(details.address || '').slice(0, 50)}*\n📞 Phone: *${details.phone || cleanPhone}*\n💵 Payment: *${details.paymentMethod === 'COD' ? 'Cash on Delivery (COD)' : 'EasyPaisa'}*\n\nOrder confirm karne ke liye bas *'Haan'* ya *'Confirm'* likhein!`,
                    };
                } else {
                    return {
                        handled: true,
                        routeName: 'order_status_check',
                        reply: `Jigri, aap ke cart ka subtotal *Rs. ${subtotal}* bana hai.\n\n📋 *Items:*\n${itemsList}\n\nBas jaldi se yeh details bata do taake order foran book kar dein:\n${missing.join('\n')}`,
                    };
                }
            }
        } catch (err) {
            console.error('[FAST_ROUTE] Error checking order status:', err.message);
        }
    }

    // ── Check Customer Multi-Field Checkout Input (Name, Address, Payment, Phone) during active cart (Zero Tokens) ──
    if (userSessionId && !hasCartOrOrderAction) {
        try {
            const { getActiveCart } = await import('./cartService.js');
            const cache = await getCatalogCache();
            const cart = await getActiveCart({ sessionKey: userSessionId, restaurantId: cache.restId, chatId });
            if (cart?.items && cart.items.length > 0) {
                const extracted = extractCustomerDetails(raw);
                if (extracted.name || extracted.address || extracted.paymentMethod || extracted.phone) {
                    const { updateSessionOrderDetails, getSessionOrderDetails } = await import('./sessionService.js');
                    const cleanPhone = (whatsappPhone || '').replace(/\D/g, '');
                    const updatePayload = {};
                    if (extracted.name) updatePayload.name = extracted.name;
                    if (extracted.address) updatePayload.address = extracted.address;
                    if (extracted.paymentMethod) updatePayload.paymentMethod = extracted.paymentMethod;
                    if (extracted.phone) updatePayload.phone = extracted.phone === 'SAME_WHATSAPP' ? cleanPhone : extracted.phone;

                    const details = updateSessionOrderDetails(userSessionId, updatePayload, cleanPhone);

                    // Check if all 3 required fields are now present:
                    if (details.name && (details.address || details.location) && details.paymentMethod) {
                        const itemsList = cart.items.map(i => {
                            const n = i.deal ? i.deal.name : (i.menu_item?.name || 'Item');
                            const v = i.menu_variant ? ` (${i.menu_variant.name})` : '';
                            const p = Number(i.deal?.deal_price ?? i.menu_variant?.price ?? i.menu_item?.base_price ?? i.unit_price ?? 0) * i.quantity;
                            return `• ${i.quantity}x ${n}${v} — Rs. ${p}`;
                        }).join('\n');
                        const subtotal = cart.items.reduce((s, i) => s + Number(i.deal?.deal_price ?? i.menu_variant?.price ?? i.menu_item?.base_price ?? i.unit_price ?? 0) * i.quantity, 0);
                        let deliveryFee = 0;
                        let deliveryFeeKnown = false;
                        try {
                            const { checkDeliveryAvailability } = await import('./deliveryService.js');
                            const dCheck = await checkDeliveryAvailability({
                                restaurantId: cache.restId,
                                address: details.address || details.location?.address,
                                subtotal,
                            });
                            if (dCheck?.available && typeof dCheck.deliveryFee === 'number') {
                                deliveryFee = dCheck.deliveryFee;
                                deliveryFeeKnown = true;
                            }
                        } catch (_) {}
                        const total = subtotal + deliveryFee;
                        const feeBreakdown = deliveryFeeKnown ? (deliveryFee === 0 ? '(Free Delivery!)' : `(Items: Rs. ${subtotal} + Delivery: Rs. ${deliveryFee})`) : '(Delivery fee area ke mutabiq)';
                        details.readyForConfirmation = true;

                        return {
                            handled: true,
                            routeName: 'order_summary_ready',
                            reply: `Sain ${details.name}, aap ki details mil gayin hain! Yeh raha aap ka mukammal order check kar lein:\n\n📋 *ORDER SUMMARY:*\n${itemsList}\n\n📍 Delivery Address: *${(details.address || '').slice(0, 70)}*\n📞 Contact Phone: *${details.phone || cleanPhone}*\n💵 Payment Method: *${details.paymentMethod === 'COD' ? 'Cash on Delivery (COD)' : 'EasyPaisa (03434919319 - Muhammad Shoaib)'}*\n💰 Total Bill: *Rs. ${total}* ${feeBreakdown}\n\nBhapa, kya iske sath kuch aur add karna chahenge (jaise Extra Drink ya Fries), ya yeh order confirm kar dein? (Order book karne ke liye *'Haan'* ya *'Confirm'* likhein)`,
                        };
                    } else {
                        // Some details still missing
                        const missing = [];
                        if (!details.name) missing.push('• Aap ka Naam (Name)');
                        if (!details.address && !details.location) missing.push('• Mukammal Delivery Address (ya WhatsApp Location Pin)');
                        if (!details.paymentMethod) missing.push('• Payment Method (Cash on Delivery ya EasyPaisa)');

                        const greetingName = details.name ? `${details.name} bhai! ` : 'Bhapa! ';
                        return {
                            handled: true,
                            routeName: 'checkout_partial_details',
                            reply: `Theek hai ${greetingName}Aap ki details note kar li hain.\n\nAb bas yeh bata dein taake order final karein:\n${missing.join('\n')}\n(Contact Phone: kya yahi ${whatsappPhone || cleanPhone} rider ko dein?)`,
                        };
                    }
                }
            }
        } catch (err) {
            console.error('[FAST_ROUTE] Error processing customer checkout details:', err.message);
        }
    }

    // ── Check Customer Name Input during active cart checkout (Zero Tokens) ──
    const nameCandidate = raw.replace(/^(?:mera\s+naam\s+|naam\s+|name\s*(?:is|hai|h|ja)?\s*:?\s*)/i, '')
                             .replace(/(?:\s+(?:naam|name|hai|h|ja|mera))+$/i, '')
                             .trim();
    const nameMatch = nameCandidate.match(/^([A-Za-z]{2,20}(?:\s+[A-Za-z]{2,20})?)$/i);
    const isNotNameCandidate = /\b(krdo|kardo|kar\s*do|kr\s*do|karo|kro|kar|kr|karna|krna|karein|chahiye|mangwao|mangwana|pack|parcel|send|bhej|bhejo|theek|thk|done|ok|yes|haan|han|hn|ha|g|ji|jee|no|nahi|na|payment|cod|cash|easypaisa|easy|paisa|delivery|address|location|pata|order|deal|deals|pizza|burger|menu|bhai|sain|sir|khan|bro|food|water|drink|hi|hello|hey|bill|kam|party|small|medium|large|reg|regular|can|liter|litre|1\.5l|1l|flavor|flavour|crust|cheese|extreme|peri|behari|tikka|fajita|supreme|tandoori)\b/i.test(nameCandidate);
    if (nameMatch && !isNotNameCandidate && userSessionId && wordCount <= 4 && !hasCartOrOrderAction) {
        try {
            const { getActiveCart } = await import('./cartService.js');
            const cache = await getCatalogCache();
            const cart = await getActiveCart({ sessionKey: userSessionId, restaurantId: cache.restId, chatId });
            if (cart?.items && cart.items.length > 0) {
                const { getSessionOrderDetails, updateSessionOrderDetails } = await import('./sessionService.js');
                const cleanPhone = (whatsappPhone || '').replace(/\D/g, '');
                const details = getSessionOrderDetails(userSessionId, cleanPhone);
                if (!details.name) {
                    const customerName = nameMatch[1].trim();
                    updateSessionOrderDetails(userSessionId, { name: customerName }, cleanPhone);

                    // If address and payment are already known, show ORDER SUMMARY and ask confirmation!
                    if ((details.address || details.location) && details.paymentMethod) {
                        const itemsList = cart.items.map(i => {
                            const n = i.deal ? i.deal.name : (i.menu_item?.name || 'Item');
                            const v = i.menu_variant ? ` (${i.menu_variant.name})` : '';
                            const p = Number(i.deal?.deal_price ?? i.menu_variant?.price ?? i.menu_item?.base_price ?? i.unit_price ?? 0) * i.quantity;
                            return `• ${i.quantity}x ${n}${v} — Rs. ${p}`;
                        }).join('\n');
                        const subtotal = cart.items.reduce((s, i) => s + Number(i.deal?.deal_price ?? i.menu_variant?.price ?? i.menu_item?.base_price ?? i.unit_price ?? 0) * i.quantity, 0);
                        let deliveryFee = 0;
                        let deliveryFeeKnown = false;
                        try {
                            const { checkDeliveryAvailability } = await import('./deliveryService.js');
                            const dCheck = await checkDeliveryAvailability({
                                restaurantId: cache.restId,
                                address: details.address || details.location?.address,
                                subtotal,
                            });
                            if (dCheck?.available && typeof dCheck.deliveryFee === 'number') {
                                deliveryFee = dCheck.deliveryFee;
                                deliveryFeeKnown = true;
                            }
                        } catch (_) {}
                        const total = subtotal + deliveryFee;
                        const feeBreakdown = deliveryFeeKnown ? (deliveryFee === 0 ? '(Free Delivery!)' : `(Items: Rs. ${subtotal} + Delivery: Rs. ${deliveryFee})`) : '(Delivery fee area ke mutabiq)';
                        details.readyForConfirmation = true;

                        return {
                            handled: true,
                            routeName: 'order_summary_ready',
                            reply: `Theek hai ${customerName} bhai! Aap ka naam note kar liya hai.\n\n📋 *ORDER SUMMARY:*\n${itemsList}\n\n📍 Delivery Address: *${(details.address || '').slice(0, 60)}*\n📞 Contact Phone: *${details.phone || cleanPhone}*\n💵 Payment Method: *${details.paymentMethod === 'COD' ? 'Cash on Delivery (COD)' : 'EasyPaisa'}*\n💰 Total Bill: *Rs. ${total}* ${feeBreakdown}\n\nBhapa, kya iske sath kuch aur add karna chahenge (jaise Extra Drink ya Fries), ya yeh order confirm kar dein? (Order book karne ke liye *'Haan'* ya *'Confirm'* likhein)`,
                        };
                    }

                    const missing = [];
                    if (!details.address && !details.location) missing.push('• Mukammal Delivery Address (ya WhatsApp Location Pin)');
                    if (!details.paymentMethod) missing.push('• Payment Method (Cash on Delivery ya EasyPaisa)');

                    return {
                        handled: true,
                        routeName: 'name_recorded',
                        reply: `Theek hai ${customerName} bhai! Aap ka naam note kar liya hai.\n\nAb bas yeh bata dein:\n${missing.join('\n')}\n\nTaake hum aap ka order final karein!`,
                    };
                }
            }
        } catch (_) {}
    }

    // ── Check Customer Phone Input / "Same Number" (Zero Tokens) ──
    const isSameNumber = /^(?:same\s*number|same|isi\s*number|yehi\s*number|yahi\s*number|same\s*whatsapp)$/i.test(lower.trim()) ||
        /^(?:\+?92|0)?3\d{9}$/.test(raw.replace(/[\s-]/g, ''));
    if (isSameNumber && userSessionId) {
        try {
            const { getActiveCart } = await import('./cartService.js');
            const cache = await getCatalogCache();
            const cart = await getActiveCart({ sessionKey: userSessionId, restaurantId: cache.restId, chatId });
            if (cart?.items && cart.items.length > 0) {
                const { getSessionOrderDetails, updateSessionOrderDetails } = await import('./sessionService.js');
                const cleanPhone = (whatsappPhone || '').replace(/\D/g, '');
                const details = updateSessionOrderDetails(userSessionId, { phone: cleanPhone }, cleanPhone);

                const missing = [];
                if (!details.name) missing.push('1. Aap ka Naam (Name)');
                if (!details.address && !details.location) missing.push('2. Mukammal Delivery Address (ya WhatsApp Location Pin)');
                if (!details.paymentMethod) missing.push('3. Payment Method (Cash on Delivery ya EasyPaisa)');

                const greetingName = details.name ? `${details.name} bhai, ` : '';
                return {
                    handled: true,
                    routeName: 'phone_recorded',
                    reply: `${greetingName}Number note kar liya hai (${whatsappPhone || cleanPhone}).\n\nAb bas yeh bata dein:\n${missing.join('\n')}\n\nJaise hi batayenge, order final ho jayega!`,
                };
            }
        } catch (_) {}
    }

    // ── Check Specific Deal Inquiry (Zero Tokens, e.g. "deal 5 mai kya kya h?", "deal 5", "deal 1 details") ──
    const specificDealMatch = lower.match(/\b(deal\s*#?\s*[1-5]|pi[z]+a\s*meal\s*(?:for\s*)?[1-4]|burger\s*meal\s*(?:for\s*)?[1-3])\b/i);
    if (specificDealMatch && wordCount <= 12 && !hasCartOrOrderAction) {
        try {
            const cache = await getCatalogCache();
            const rawDeals = cache.rawDeals || [];
            const queryNorm = specificDealMatch[1].replace(/#|\s+/g, '').replace(/piza/gi, 'pizza').toLowerCase();

            const matchedDeal = rawDeals.find(d => {
                const dNorm = (d.name || '').replace(/#|\s+/g, '').toLowerCase();
                return dNorm.includes(queryNorm) || queryNorm.includes(dNorm);
            });

            if (matchedDeal) {
                const itemsList = matchedDeal.deal_items && matchedDeal.deal_items.length > 0
                    ? matchedDeal.deal_items.map(di => `• ${di.menu_item?.name || ''}${di.menu_variant?.name ? ' (' + di.menu_variant.name + ')' : ''}`).join('\n')
                    : (matchedDeal.description ? matchedDeal.description.split(',').map(s => `• ${s.trim()}`).join('\n') : `• ${matchedDeal.name}`);

                const reply = `Bhapa, *${matchedDeal.name}* mein aap ko milega:\n\n${itemsList}\n\nQeemat sirf *Rs. ${Number(matchedDeal.deal_price)}* hai! Bahun chaska deal hai.\nKya yeh order kar doon aap ke liye? (Order karne ke liye *'Haan'* ya *'Order kar do'* likhein)`;

                if (userSessionId) {
                    _lastDiscussedDealBySession.set(userSessionId, {
                        deal: matchedDeal,
                        timestamp: Date.now(),
                    });
                }

                return {
                    handled: true,
                    routeName: 'deal_inquiry',
                    reply,
                };
            }
        } catch (_) {}
    }

    // ── 3. Live Deals (General Deals List) (<= 7 words, no deal number, no order action) ──
    const isDealsKeyword = /\b(deals?|burger deals?|pi[z]+a deals?|offers?)\b/i.test(lower);
    const hasSpecificDealNumber = /\b(deal\s*#?\d|meal\s*#?\d)\b/i.test(lower);
    // Also handle "sirf X deals" prefix ("sirf" = only)
    const isSirfDeals = /\b(sirf|only|just|bas)\b/i.test(lower) && isDealsKeyword;

    if (isDealsKeyword && wordCount <= 8 && !hasSpecificDealNumber && !hasCartOrOrderAction) {
        try {
            const cache = await getCatalogCache();
            let dealsReply = '';
            // Detect category preference — expanded keywords
            const isBurger = /\b(burger|zinger|bun\s*kabab)\b/i.test(lower);
            const isPizza = /\b(pi[z]+a|piza|pizza)\b/i.test(lower);
            if (isBurger && !isPizza) {
                dealsReply = `Active Burger Deals:\n\n${cache.customerBurgerDeals || 'Burger deals abhi available nahi hain.'}\n\nOrder karne ke liye deal ka naam bata dein!`;
            } else if (isPizza && !isBurger) {
                dealsReply = `Active Pizza Deals:\n\n${cache.customerPizzaDeals || 'Pizza deals abhi available nahi hain.'}\n\nOrder karne ke liye deal ka naam bata dein!`;
            } else {
                dealsReply = `Active Deals:\n\n${cache.customerAllDeals || 'Deals abhi available nahi hain.'}\n\nOrder karne ke liye kisi bhi deal ka naam bata dein!`;
            }
            return {
                handled: true,
                routeName: 'live_deals',
                reply: dealsReply,
            };
        } catch (err) {
            console.error('[FAST_ROUTE] Deals cache error:', err.message);
            // Fall through to LLM gracefully
        }
    }

    // ── 4. Live Categories / Menu (<= 8 words) ──
    const isMenuKeyword = FAST_MENU_REGEX.test(lower) || (FAST_MENU_CONTAINS.test(lower) && !lower.includes('deal'));
    if (isMenuKeyword && wordCount <= 8 && !hasCartOrOrderAction) {
        try {
            const cache = await getCatalogCache();
            const catalogText = cache.customerMenuCatalog || cache.cachedMenuCatalog || cache.cachedCategoriesSummary;
            const cleanCatalog = (catalogText || '').replace(/\[\s*(?:menuItemId|variantId|dealId|cartItemId|id)\s*:[^\]]+\]/gi, '').trim();
            const menuReply = `📋 *HAMARA MENU*\n\n${cleanCatalog}\n\nKisi bhi item ya deal ka order karne ke liye uska naam bata dein!`;
            return {
                handled: true,
                routeName: 'live_categories',
                reply: menuReply,
            };
        } catch (_) {}
    }

    // ── 5. Operating Timings (Zero Tokens, live from Settings) ──
    const isTimingQuery = (FAST_TIMING_REGEX.test(lower) || FAST_TIMING_CONTAINS.test(lower)) && wordCount <= 8;
    if (isTimingQuery && !hasCartOrOrderAction) {
        try {
            const cache = await getCatalogCache();
            const store = cache.storeName || 'Cravey Crust';
            const openTime = cache.openingTime || '04:00 PM';
            const closeTime = cache.closingTime || '02:00 AM';
            const timingReply = `⏰ *RESTAURANT TIMINGS*\n\n🏪 *${store}* ke auqat:\n🕒 Khulne ka waqt (Opening): *${openTime}*\n🌙 Band hone ka waqt (Closing): *${closeTime}*\n\nHamare auqat ke doran aap ba-asaani online delivery order place kar saktay hain!\nMenu dekhne ke liye 'menu' ya 'deals' likhein.`;
            return {
                handled: true,
                routeName: 'store_timings',
                reply: timingReply,
            };
        } catch (_) {}
    }

    // ── Check Fast Route: Address Change / Correction Request (Zero Tokens) ──
    const isAddressChangeRequest = /\b(?:address\s*(?:change|badal|update|theek|sahi|galat|ghalat)|change\s*ad(?:d)?re(?:e)?s(?:s)?|ad(?:d)?re(?:e)?s(?:s)?\s*(?:change|theek|sahi|galat|ghalat)|ad(?:d)?re(?:e)?s(?:s)?\s*(?:nahi|ni)\s*hai|wrong\s*ad(?:d)?re(?:e)?s(?:s)?|galat\s*ad(?:d)?re(?:e)?s(?:s)?|ghalat\s*ad(?:d)?re(?:e)?s(?:s)?|naya\s*ad(?:d)?re(?:e)?s(?:s)?)\b/i.test(lower);
    if (isAddressChangeRequest && userSessionId) {
        try {
            const { updateSessionOrderDetails } = await import('./sessionService.js');
            const cleanPhone = (whatsappPhone || '').replace(/\D/g, '');
            updateSessionOrderDetails(userSessionId, { address: null, location: null }, cleanPhone);
            return {
                handled: true,
                routeName: 'address_change_prompt',
                reply: `Koi masla nahi Bhapa! Naya address kya rakhna chahenge? Baraye meherbani apna naya mukammal delivery address (ya WhatsApp Location Pin) yahan likh kar bhej dein taake hum update kar dein! 📍`,
            };
        } catch (_) {}
    }

    // ── 6. Store Location & Address (Zero Tokens, live from Settings) ──
    const hasCustomerDeliveryLocation = !isAddressChangeRequest && Boolean(
        /maps\.google\.com|goo\.gl|maps\.app\.goo\.gl|lat=\s*-?\d+|lng=\s*-?\d+/i.test(raw) ||
        /^(?:customer\s*ne\s*location|location\s*pin|meri\s*location|mera\s*ad(?:d)?re(?:e)?s(?:s)?|delivery\s*ad(?:d)?re(?:e)?s(?:s)?|ad(?:d)?re(?:e)?s(?:s)?|pata|yahan\s*deliver|yahan\s*order|idr)/i.test(lower)
    ) && !/^(?:change|theek\s*nahi|galat|wrong|nahi|mat)/i.test(raw.replace(/^(?:location|address|pata|delivery\s*address)\s*[:=-]?\s*/i, '').trim());

    // If customer shared location pin/link/address during active session, capture it
    if (hasCustomerDeliveryLocation && userSessionId) {
        try {
            const { getActiveCart } = await import('./cartService.js');
            const cache = await getCatalogCache();
            const { extractLocationFromText } = await import('../../utils/location.js');
            const { updateSessionOrderDetails, getSessionOrderDetails } = await import('./sessionService.js');
            const cleanPhone = (whatsappPhone || '').replace(/\D/g, '');
            const loc = extractLocationFromText(raw);
            // Strip common prefixes like "location:", "address:", "pata:" etc.
            const strippedRaw = raw.replace(/^(?:location|address|pata|meri\s*location|delivery\s*address|mera\s*address)\s*[:=-]?\s*/i, '').trim();
            // Prefer Google Maps URL (cleaner display), then formattedAddress, then stripped raw
            const addressStr = loc?.mapUrl || loc?.formattedAddress || strippedRaw || raw;

            // Always save location to session regardless of cart state
            const details = updateSessionOrderDetails(userSessionId, {
                address: addressStr,
                location: loc,
            }, cleanPhone);

            // Try to get cart
            let cart = null;
            try {
                cart = await getActiveCart({ sessionKey: userSessionId, restaurantId: cache.restId, chatId });
            } catch (_) {}

            if (cart?.items && cart.items.length > 0) {
                if (details.name && details.paymentMethod) {
                    const itemsList = cart.items.map(i => {
                        const n = i.deal ? i.deal.name : (i.menu_item?.name || 'Item');
                        const v = i.menu_variant ? ` (${i.menu_variant.name})` : '';
                        const p = Number(i.deal?.deal_price ?? i.menu_variant?.price ?? i.menu_item?.base_price ?? i.unit_price ?? 0) * i.quantity;
                        return `• ${i.quantity}x ${n}${v} — Rs. ${p}`;
                    }).join('\n');
                    const total = cart.items.reduce((s, i) => s + Number(i.deal?.deal_price ?? i.menu_variant?.price ?? i.menu_item?.base_price ?? i.unit_price ?? 0) * i.quantity, 0);
                    details.readyForConfirmation = true;

                    return {
                        handled: true,
                        routeName: 'order_summary_ready',
                        reply: `Wah ${details.name} bhai! Aap ka delivery address note kar liya hai: 📍 *${addressStr.slice(0, 80)}*\n\n📋 *ORDER SUMMARY:*\n${itemsList}\n\n📍 Delivery Address: *${addressStr.slice(0, 80)}*\n📞 Contact Phone: *${details.phone || cleanPhone}**\n💵 Payment Method: *${details.paymentMethod === 'COD' ? 'Cash on Delivery (COD)' : 'EasyPaisa'}*\n💰 Total Bill: *Rs. ${total}*\n\nBhapa, kya iske sath kuch aur add karna chahenge (jaise Extra Drink ya Fries), ya yeh order confirm kar dein? (Order book karne ke liye *'Haan'* ya *'Confirm'* likhein)`,
                    };
                }

                // If payment method or name is still needed:
                const greetingName = details.name ? `${details.name} bhai! ` : 'Bhapa! ';
                const missing = [];
                if (!details.name) missing.push('• Aap ka Naam (Name)');
                if (!details.paymentMethod) missing.push('• Payment Method (Cash on Delivery ya EasyPaisa)');
                return {
                    handled: true,
                    routeName: 'location_received',
                    reply: `Zabardast ${greetingName}Aap ka delivery address note kar liya hai: 📍 *${addressStr.slice(0, 80)}*\n\nAb aakhri cheez:\n${missing.join('\n')}\n(Contact number confirm karein: kya yehi WhatsApp number hai?)`,
                };
            } else {
                // Cart is empty — location saved, ask customer to order something
                return {
                    handled: true,
                    routeName: 'location_saved_no_cart',
                    reply: `Zabardast Bhapa! Aap ka delivery address note kar liya hai: 📍 *${addressStr.slice(0, 80)}*\n\nAb koi item ya deal select karein taake order place ho sake! Menu dekhne ke liye 'menu' ya 'deals' likhein.`,
                };
            }
        } catch (err) {
            console.error('[FAST_ROUTE] Error processing customer location:', err.message);
        }
    }

    const isLocationQuery = !hasCustomerDeliveryLocation && (FAST_STORE_LOCATION_REGEX.test(lower) || FAST_STORE_LOCATION_CONTAINS.test(lower)) && wordCount <= 8 && !lower.includes('deliver') && !hasCartOrOrderAction;
    if (isLocationQuery) {
        try {
            const cache = await getCatalogCache();
            const store = cache.storeName || 'Cravey Crust';
            const addr = cache.storeAddress || 'Street No. 2, nearby AQ Khan School, Phase 4B Ghauri Town, Islamabad';
            const phone = cache.storePhone ? `📞 Rabta Number: *${cache.storePhone}*\n` : '';
            const locationReply = `📍 *OUTLET LOCATION & ADDRESS*\n\n🏪 *${store}*\n📍 Pata: *${addr}*\n${phone}⏰ Timings: ${cache.storeTimings}\n\nAap hamara outlet visit kar saktay hain ya WhatsApp par delivery order mangwa saktay hain!\nOrder ke liye 'menu' ya 'deals' likhein.`;
            return {
                handled: true,
                routeName: 'store_location',
                reply: locationReply,
            };
        } catch (_) {}
    }

    // ── 7. Cash on Delivery (COD) / Payment Selection vs FAQ ──
    const isPaymentMethodSelection = (
        /\b(?:cod|cash\s*on\s*delivery|cash|easypaisa|easy\s*paisa)\b/i.test(lower) &&
        /\b(?:karna|karni|krna|krni|kar\s*do|kr\s*do|kar\s*de|kr\s*de|kardo|krdo|krni\s*h|krna\s*h|ha|hai|h|hogi|hoga|se|pe|par|method)\b/i.test(lower)
    ) || /^(?:cod|cash|cash\s*on\s*delivery|easypaisa|easy\s*paisa|ep)[\s.!?]*$/i.test(lower.trim());

    if (isPaymentMethodSelection && userSessionId) {
        try {
            const paymentMethod = /easypaisa/i.test(lower) ? 'EASYPAISA' : 'COD';
            const { updateSessionOrderDetails, getSessionOrderDetails } = await import('./sessionService.js');
            const cleanPhone = (whatsappPhone || '').replace(/\D/g, '');
            // Always save payment method to session (even if cart is empty, for future use)
            const detailsBeforeUpdate = getSessionOrderDetails(userSessionId, cleanPhone);
            const details = updateSessionOrderDetails(userSessionId, { paymentMethod }, cleanPhone);

            // Now try to fetch cart for a full response
            let cart = null;
            try {
                const { getActiveCart } = await import('./cartService.js');
                const cache = await getCatalogCache();
                cart = await getActiveCart({ sessionKey: userSessionId, restaurantId: cache.restId, chatId });
            } catch (_) {}

            if (cart?.items && cart.items.length > 0) {
                const cache = await getCatalogCache();
                if (details.name && (details.address || details.location)) {
                    const itemsList = cart.items.map(i => {
                        const n = i.deal ? i.deal.name : (i.menu_item?.name || 'Item');
                        const v = i.menu_variant ? ` (${i.menu_variant.name})` : '';
                        const p = Number(i.deal?.deal_price ?? i.menu_variant?.price ?? i.menu_item?.base_price ?? i.unit_price ?? 0) * i.quantity;
                        return `• ${i.quantity}x ${n}${v} — Rs. ${p}`;
                    }).join('\n');
                    const subtotal = cart.items.reduce((s, i) => s + Number(i.deal?.deal_price ?? i.menu_variant?.price ?? i.menu_item?.base_price ?? i.unit_price ?? 0) * i.quantity, 0);
                    let deliveryFee = 0;
                    try {
                        const { checkDeliveryAvailability } = await import('./deliveryService.js');
                        const dCheck = await checkDeliveryAvailability({ restaurantId: cache.restId, address: details.address || details.location?.address, subtotal });
                        if (dCheck?.available && typeof dCheck.deliveryFee === 'number') deliveryFee = dCheck.deliveryFee;
                    } catch (_) {}
                    const total = subtotal + deliveryFee;
                    details.readyForConfirmation = true;

                    return {
                        handled: true,
                        routeName: 'order_summary_ready',
                        reply: `Theek hai ${details.name} bhai! Payment method *${paymentMethod === 'COD' ? 'Cash on Delivery (COD)' : 'EasyPaisa'}* note kar liya hai.\n\n📋 *ORDER SUMMARY:*\n${itemsList}\n\n📍 Delivery Address: *${(details.address || details.location?.address || 'Google Maps Location').slice(0, 80)}*\n📞 Contact Phone: *${details.phone || cleanPhone}*\n💵 Payment Method: *${paymentMethod === 'COD' ? 'Cash on Delivery (COD)' : 'EasyPaisa'}*\n💰 Total Bill: *Rs. ${total}*\n\nBhapa, kya iske sath kuch aur add karna chahenge (jaise Extra Drink ya Fries), ya yeh order confirm kar dein? (Order book karne ke liye *'Haan'* ya *'Confirm'* likhein)`,
                    };
                }

                // If address or name is still missing:
                const missing = [];
                if (!details.name) missing.push('1. Aap ka Naam (Name)');
                if (!details.address && !details.location) missing.push('2. Mukammal Delivery Address (ya WhatsApp Location Pin)');

                return {
                    handled: true,
                    routeName: 'payment_selected',
                    reply: `Theek hai Bhapa! Payment method *${paymentMethod === 'COD' ? 'Cash on Delivery (COD)' : 'EasyPaisa'}* note kar liya hai.\n\nAb bas yeh details bata dein:\n${missing.join('\n')}\n\nJaise hi aap batayenge, order confirm ho jayega!`,
                };
            } else {
                // Cart is empty but we've saved the payment — acknowledge it
                const missing = [];
                if (!details.name) missing.push('• Aap ka Naam (Name)');
                if (!details.address && !details.location) missing.push('• Mukammal Delivery Address (ya WhatsApp Location Pin)');
                if (missing.length > 0) {
                    return {
                        handled: true,
                        routeName: 'payment_selected_no_cart',
                        reply: `Theek hai Bhapa! Payment method *${paymentMethod === 'COD' ? 'Cash on Delivery (COD)' : 'EasyPaisa'}* note kar liya hai.\n\nOrder karne ke liye pehle koi item ya deal select karein (menu ya deals likhein). Agar aapne pehle koi item select kiya tha to mujhe batayein!`,
                    };
                }
                // All details present but cart empty — just acknowledge
                return {
                    handled: true,
                    routeName: 'payment_selected_no_cart',
                    reply: `Theek hai Bhapa! Payment method *${paymentMethod === 'COD' ? 'Cash on Delivery (COD)' : 'EasyPaisa'}* note kar liya hai. Ab koi item ya deal select karein taake order place ho sake!`,
                };
            }
        } catch (err) {
            console.error('[FAST_ROUTE] Error processing payment selection:', err.message);
        }
    }

    const isCodQuestion = !isPaymentMethodSelection && (
        /\b(cod\s*(?:hai|hoga|hogi|available|chalta|accept)|cash\s*on\s*delivery\s*(?:hai|available|hoga|hogi|chalta|accept|karty|karte))\b/i.test(lower) ||
        /^(?:cod\s*hai|cash\s*on\s*delivery\s*hai|is\s*cod\s*available)\??$/i.test(lower)
    );
    const isCodQuery = isCodQuestion && wordCount <= 6 && !hasCartOrOrderAction;
    if (isCodQuery && !hasCartOrOrderAction) {
        try {
            const cache = await getCatalogCache();
            const store = cache.storeName || 'Cravey Crust';
            const codReply = cache.codEnabled
                ? `💵 *CASH ON DELIVERY (COD)*\n\nJee haan! *${store}* par Cash on Delivery (COD) dastiyab hai. Aap rider ko delivery ke waqt ba-asaani cash ada kar saktay hain.\n\nOrder karne ke liye 'menu' ya 'deals' likhein!`
                : `💵 *CASH ON DELIVERY (COD)*\n\nMaazrat! Is waqt Cash on Delivery (COD) dastiyab nahi hai.\n\nOrder karne ke liye 'menu' ya 'deals' likhein!`;
            return {
                handled: true,
                routeName: 'store_cod',
                reply: codReply,
            };
        } catch (_) {}
    }

    // ── 8. EasyPaisa / Payment Methods (Zero Tokens, live from Settings) ──
    const isPaymentQueryMatch = (FAST_PAYMENT_REGEX.test(lower) || FAST_PAYMENT_CONTAINS.test(lower) || isPaymentQuery(lower)) && wordCount <= 8;
    if (isPaymentQueryMatch && !hasCartOrOrderAction) {
        try {
            const cache = await getCatalogCache();
            const store = cache.storeName || 'Cravey Crust';
            let epSection = '';
            if (cache.easypaisaEnabled && cache.easypaisaNumber) {
                epSection = `📱 *EasyPaisa Details:*\n• Number: *${cache.easypaisaNumber}*\n• Account Title: *${cache.accountName || store}*\n• Status: Active (Dastiyab)\n\nEasyPaisa transfer karne ke baad screenshot yahan share kar dein!\n\n`;
            } else {
                epSection = `📱 *EasyPaisa:*\nIs waqt EasyPaisa / online payment band hai.\n\n`;
            }
            const codSection = cache.codEnabled
                ? `💵 *Cash on Delivery (COD):*\n• Dastiyab hai (Aap delivery ke waqt cash ada kar saktay hain).`
                : `💵 *Cash on Delivery (COD):*\n• Is waqt dastiyab nahi hai.`;

            const paymentReply = `💳 *PAYMENT METHODS (${store})*\n\n${epSection}${codSection}\n\nOrder karne ke liye 'menu' ya 'deals' likhein!`;
            return {
                handled: true,
                routeName: 'store_payments',
                reply: paymentReply,
            };
        } catch (_) {}
    }

    // ── 9. Quick Reply: Greeting (Dynamic Store Name & Burger Raja Persona) ──
    if (FAST_GREETING_REGEX.test(lower)) {
        try {
            const cache = await getCatalogCache();
            const store = cache.storeName || 'Cravey Crust';
            return {
                handled: true,
                routeName: 'quick_reply',
                reply: `Walaikum Assalam! *${store}* mein khush aamdeed. Main hoon *Burger Raja*! Batao Bhapa, Pukh lagi ay? Hamara menu dekhne ke liye 'menu' ya deals dekhne ke liye 'deals' likhein!`,
            };
        } catch (_) {
            return {
                handled: true,
                routeName: 'quick_reply',
                reply: 'Walaikum Assalam! Cravey Crust mein khush aamdeed. Main hoon Burger Raja! Batao Bhapa, Pukh lagi ay? Hamara menu dekhne ke liye \'menu\' ya deals dekhne ke liye \'deals\' likhein!',
            };
        }
    }

    // ── 10. Quick Reply: Chitchat (Dynamic Store Name) ──
    if (FAST_CHITCHAT_REGEX.test(lower) && wordCount <= 6) {
        try {
            const cache = await getCatalogCache();
            const store = cache.storeName || 'Cravey Crust';
            return {
                handled: true,
                routeName: 'quick_reply',
                reply: `Alhamdulillah main bilkul theek hoon Bhapa! Main *${store}* ka AI assistant *Burger Raja* hoon. Aaj koi sawadi khana mangwana hai? Hamara menu dekhne ke liye 'menu' ya 'deals' likhein!`,
            };
        } catch (_) {
            return {
                handled: true,
                routeName: 'quick_reply',
                reply: 'Alhamdulillah main bilkul theek hoon! Main Cravey Crust ka AI assistant Burger Raja hoon. Aaj aap kya khana pasand karenge? Hamara menu dekhne ke liye \'menu\' ya \'deals\' likhein!',
            };
        }
    }

    // ── 11. Customer Reviews & Google Maps Link (Zero Tokens, live from Settings) ──
    const FAST_REVIEW_REGEX = /\b(reviews?|feedback|ratings?|google\s*review|google\s*maps?|feedback\s*link|review\s*link)\b/i;
    if (FAST_REVIEW_REGEX.test(lower) && wordCount <= 7) {
        try {
            const cache = await getCatalogCache();
            const store = cache.storeName || 'Cravey Crust';
            const reviewUrl = cache.googleReviewsUrl || 'https://maps.app.goo.gl/rVvANx8pRmtXrEMj9';
            return {
                handled: true,
                routeName: 'store_review',
                reply: `Shukriya! Hum *${store}* par hamesha behtareen aur sawadi khana dene ki koshish karte hain.\n\nAap apna qeemti feedback aur 5-star review is Google link par de sakte hain:\n⭐ ${reviewUrl}\n\nShukriya!`,
            };
        } catch (_) {}
    }

    // ── 12. Quick Reply: Thanks ──
    if (FAST_THANKS_REGEX.test(lower)) {
        return {
            handled: true,
            routeName: 'quick_reply',
            reply: 'Aapka bohat shukriya! Koi aur madad chahiye to bata dein, hum hazir hain.',
        };
    }

    // ── 13. Quick Reply: Explicit Off-Topic ──
    if (FAST_OFF_TOPIC_REGEX.test(lower) && !isDealsKeyword && !isMenuKeyword) {
        return {
            handled: true,
            routeName: 'quick_reply',
            reply: 'Maazrat! Main sirf food orders aur menu mein aapki madad kar sakta hoon. Aaj aap kya order karna chahenge? \'Menu\' ya \'Deals\' likh kar hamari list check karein!',
        };
    }

    // ── 14. Quick Reply: Other Languages Restriction (Zero Tokens) ──
    const isOtherLanguageQuery = /\b(?:persion|persian|farsi|french|arabic|arbi|chinese|german|spanish|russian|pashto|punjabi)\b/i.test(lower) &&
        /\b(?:baat|bat|bol|bolte|seekh|aati|aata|speak|know|talk|language)\b/i.test(lower);
    if (isOtherLanguageQuery && wordCount <= 12) {
        return {
            handled: true,
            routeName: 'language_restriction',
            reply: 'Nahi Bhapa! Main sirf Roman Urdu, Urdu aur English samajhta hoon aur inhi mein baat kar sakta hoon. 😊\n\nBataiye, Cravey Crust se aaj kya order lagana hai? Mazedaar pizzas ya juicy burgers? Hamara menu dekhne ke liye \'menu\' ya \'deals\' likhein!',
        };
    }

    return { handled: false };
}

