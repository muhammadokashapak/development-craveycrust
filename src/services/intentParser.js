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

import fs from 'fs';
import path from 'path';
import { extractGoogleMapsUrl } from '../../utils/location.js';
import {
    isPizzaDeal,
    getDealPizzaInfo,
    extractFlavoursFromText,
    formatFlavourNotes,
    formatDealFlavourPrompt,
    setPendingDealFlavour,
    getPendingDealFlavour,
    clearPendingDealFlavour,
    isFlavourResponse,
} from './dealFlavourService.js';

export { setPendingDealFlavour, getPendingDealFlavour, clearPendingDealFlavour };

// Session memory for zero-token deal follow-ups
const _lastDiscussedDealBySession = new Map();

export function clearLastDiscussedDeal(sessionKey) {
    if (sessionKey) {
        _lastDiscussedDealBySession.delete(sessionKey);
        clearPendingDealFlavour(sessionKey);
    }
}

// Session memory for pizza/item size follow-ups (e.g. customer saying "medium", "party krdo")
const _lastDiscussedItemBySession = new Map();

export function clearAllFastRouteCaches() {
    _lastDiscussedDealBySession.clear();
    _lastDiscussedItemBySession.clear();
    console.log('[FAST_ROUTE] All fast route memory caches cleared.');
}

export function setLastDiscussedItem(sessionKey, item, variant = null) {
    if (!sessionKey || !item) return;
    _lastDiscussedItemBySession.set(sessionKey, {
        item,
        variant,
        timestamp: Date.now(),
    });
}

export function getLastDiscussedItem(sessionKey) {
    if (!sessionKey || !_lastDiscussedItemBySession.has(sessionKey)) return null;
    const entry = _lastDiscussedItemBySession.get(sessionKey);
    // Expire after 5 minutes
    if (Date.now() - entry.timestamp > 5 * 60 * 1000) {
        _lastDiscussedItemBySession.delete(sessionKey);
        return null;
    }
    return entry;
}

export function clearLastDiscussedItem(sessionKey) {
    if (sessionKey) {
        _lastDiscussedItemBySession.delete(sessionKey);
    }
}

export function isDeliveryAreaInquiry(text) {
    if (!text || typeof text !== 'string') return false;
    const lower = text.toLowerCase().trim();
    return /\b(?:delivery|deliver)\b.*?\b(?:range|area|areas|zone|zones|radius|charges|fee)\b/i.test(lower) ||
           /\b(?:range|area|areas|zone|zones|radius)\b.*?\b(?:delivery|deliver)\b/i.test(lower) ||
           /\b(?:delivery|deliver)\s*(?:areas?|ranges?|zones?)?\s*(?:mein|me|mai|pe|par)?\s*(?:kese|kaise|kaisy|kyun|kya|kia|kons[ey]|list)?\s*(?:aati|aata|ata|ati|hoti|hota|krte|karte|krty|karty|chali|possible|available|allowed|allow|hai|he|hy|h|hain|hen|\?)\b/i.test(lower) ||
           /\b(?:delivery|deliver)\s+(?:hoti|krte|karte|krty|karty|available|possible|allowed|allow)\s*(?:hai|he|hy|h|hain|hen|\?)?/i.test(lower) ||
           /\b(?:kya|kia|ye|yeh|is)\s+.*?\b(?:delivery|deliver)\s*(?:area|areas|range|zone|allowed|karein|karte|krte|krty|hoti)\b/i.test(lower) ||
           /\b(?:delivery|deliver)\s*(?:area|areas|range|zone)\s*(?:me|mein|mai)?\s*(?:hai|he|hy|h|hain|hen|\?)/i.test(lower) ||
           /\b(?:yahan|idhar|is\s*jagah)\s+(?:bhi\s+)?delivery\b/i.test(lower) ||
           /\b(?:area|areas|range)\s*(?:mein|me|mai|pe|par)\s*(?:kese|kaise|kyun)?\s*(?:aati|aata|ata|ati|hoti|hota)\b/i.test(lower) ||
           /\b(?:area\s*of\s*radius|delivery\s*radius|radius)\b/i.test(lower) ||
           (/\b(?:deliver|delivery)\b/i.test(lower) && /\b(?:allowed|allow|ho\s*sakti|kar\s*sakte|kar\s*skte|karoge|karogy|karty|karte|krte|krty|available|possible|charges|fee)\b/i.test(lower)) ||
           (/\b(?:kahan\s*kahan|kidhar\s*kidhar|kahan|kidhar|kon\s*kon\s*se\s*areas?|which\s*areas?|kis\s*kis\s*area)\b.*?\b(?:deliver|delivery)\b/i.test(lower)) ||
           /\b(?:delivery\s*areas?|coverage\s*areas?|approved\s*areas?)\b/i.test(lower) ||
           /\b(?:kahan|kidhar)\s*(?:kahan|kidhar)?\s*(?:pe\s*)?(?:delivery|deliver)\s*(?:krte|karte|karty|krty|hoti|hogi|hoga)\b/i.test(lower) ||
           /\b(?:delivery|deliver)\s+(?:kahan|kidhar|kis\s*taraf|kdr)\s*(?:hoti|krte|karte|krty|karty|hogi|hoga|hai|he|hy|h)?\b/i.test(lower);
}

export function formatAddressTitle(addr) {
    if (!addr || typeof addr !== 'string') return addr;
    if (/https?:\/\//i.test(addr) || /\[.*\]\(.*\)/.test(addr)) return addr;
    return addr.split(/\s+/).map(word => {
        const lower = word.toLowerCase();
        if (/^(?:vip|dha|pwd|i-8|i-9|i-10|g-8|g-9|g-10|g-11|f-8|f-9|f-10|f-11|cod)$/i.test(lower)) {
            return lower.toUpperCase();
        }
        if (/^(?:phase|block|sector|street|road|chowk|chok|pull|pul|town|colony|scheme|market|plaza|near|nearby)$/i.test(lower)) {
            return lower.charAt(0).toUpperCase() + lower.slice(1);
        }
        if (word.length <= 2 && !/^(?:no|st)$/i.test(lower)) {
            return word;
        }
        return word.charAt(0).toUpperCase() + word.slice(1);
    }).join(' ');
}

/**
 * Detect customer's cancellation reason and sentiment from their message text
 * Extracts reasons like delivery delay, changed mind, expensive, wrong order, ate elsewhere, etc.
 *
 * @param {string} text - Customer's message text
 * @returns {string} - Human-readable explanation of why the customer cancelled
 */
export function extractCancellationReason(text) {
    if (!text || typeof text !== 'string') return 'Customer requested cancellation (No reason specified)';
    const clean = text.trim();
    const lower = clean.toLowerCase();

    // 1. Delivery delay / Order late / Taking too long
    if (/\b(?:late|der|bohot\s*der|bht\s*der|itni\s*der|time\s*lag|bohot\s*time|bht\s*time|itna\s*time|kab\s*aayega|kab\s*tk|kitna\s*time|wait\s*nahi|jaldi|ghanta|ghante|takheer|delay|slow)\b/i.test(lower)) {
        return `Order Late / Delivery Delay (Customer stated: "${clean}")`;
    }

    // 2. Bought from somewhere else / Already ate
    if (/\b(?:kahin\s*aur|kisi\s*aur|kahin\s*or|kisi\s*or|doosri\s*jagah|dusri\s*jagah|khana\s*kha\s*lia|kha\s*liya|already\s*ate|bahir\s*se|hotel\s*se|ghar\s*pe\s*bana|kuch\s*aur\s*kha)\b/i.test(lower)) {
        return `Ordered Elsewhere / Already Ate (Customer stated: "${clean}")`;
    }

    // 3. Changed mind / No longer hungry / Plan change
    if (/\b(?:mood|plan|irada|tabiyat|change|nahi\s*khana|nahi\s*chahiye|nahi\s*lena|rehne\s*do|rehn\s*do|chhor\s*do|zarurat\s*nahi|bhook\s*khatam|bhook\s*nahi)\b/i.test(lower)) {
        return `Changed Mind / Plan Changed (Customer stated: "${clean}")`;
    }

    // 4. Pricing / Cost / Budget issue
    if (/\b(?:mehnga|expensive|zyada\s*paise|paison|budget|price\s*zyada|discount\s*nahi|discount\s*kam)\b/i.test(lower)) {
        return `Pricing / Budget Concern (Customer stated: "${clean}")`;
    }

    // 5. Ordered by mistake / Wrong order / Accidental
    if (/\b(?:galti\s*se|by\s*mistake|mistake|galat|wrong\s*item|test\s*kar\s*raha|testing)\b/i.test(lower)) {
        return `Accidental Order / Ordered by Mistake (Customer stated: "${clean}")`;
    }

    // 6. Going out / Emergency / Unavailable
    if (/\b(?:bahir\s*ja\s*raha|nikal\s*gaya|ghar\s*par\s*nahi|emergency|urgent\s*kaam|kaam\s*aa\s*gaya|sone\s*laga|so\s*raha)\b/i.test(lower)) {
        return `Customer Unavailable / Going Out / Emergency (Customer stated: "${clean}")`;
    }

    // 7. If the customer wrote a substantial sentence, preserve their exact reason
    if (clean.length > 5 && !/^(cancel|cancle|order cancel|cancel kr do|cancel kardo|haan|han|yes|ji|theek|ok|okay)$/i.test(clean)) {
        return `Customer Stated Reason: "${clean}"`;
    }

    return 'Customer cancelled directly without specifying a detailed reason';
}

export function cleanExtractedAddress(text) {
    if (!text || typeof text !== 'string') return null;
    let cleaned = text.trim();

    // 0. Do not treat delivery inquiries/questions/arguments as delivery address
    if (isDeliveryAreaInquiry(cleaned) || isDeliveryAreaInquiry(text)) {
        return null;
    }

    // 0b. Reject questions, complaints, radius discussions, or conversational disputes
    if (text.includes('?') || /\b(?:kese|kaise|kaisy|kyun|kyu|why|how|kia|kya|kab|kis|kisko|kahn|kahan|door|radius|km|bakwas|galat|wrong|theek\s*nahi|mujh\s*se|galti|ghalti|batao|btao)\b/i.test(text)) {
        if (/\b(?:kese|kaise|kaisy|kyun|kyu|why|radius|aati|aata|hoti|hota|door|bakwas|galat|wrong)\b/i.test(text) || text.includes('?')) {
            return null;
        }
    }

    // 1. Strip leading greetings and honorifics (e.g. "bhai", "aoa", "salam", "ustaad")
    cleaned = cleaned.replace(/^(?:aoa|assalam\s*o?\s*alaikum|salam|helo|hello|hi|hey|suno|oye)?\s*(?:bhai\s*jan|bhaiya|bhai|yaar|yar|bro|janab|paji|ustaad|sir|boss)?\s*/i, '');

    // 2. Strip leading labels like "address:", "mera pata:", "delivery address:", "location:", "pichly order ka address", etc.
    cleaned = cleaned.replace(/^(?:pichl[ae]y?|puran[ae]y?|last|previous|confirmed?)(?:\s+wal[ae]y?)?\s*(?:order|oder)?\s*(?:ka|mein|me|mai|pe|par|per)?\s*(?:delivery\s*ad(?:d)?re(?:e)?s(?:s)?|ad(?:d)?re(?:e)?s(?:s)?|pata|location)?\s*(?:badal\s*k[e]?|change\s*k[e]?|update\s*k[e]?|rakh\s*k[e]?|kar\s*k[e]?|kr\s*k[e]?)?\s*[:=-]?\s*/i, ' ');
    cleaned = cleaned.replace(/^(?:order|oder)\s*(?:ka|mein|me|mai|pe|par|per)?\s*(?:delivery\s*ad(?:d)?re(?:e)?s(?:s)?|ad(?:d)?re(?:e)?s(?:s)?|pata|location)?\s*(?:badal\s*k[e]?|change\s*k[e]?|update\s*k[e]?|rakh\s*k[e]?|kar\s*k[e]?|kr\s*k[e]?)?\s*[:=-]?\s*/i, ' ');
    cleaned = cleaned.replace(/^(?:mera|meri|apna|apni|hamara|humari)?\s*(?:delivery\s*ad(?:d)?re(?:e)?s(?:s)?|ad(?:d)?re(?:e)?s(?:s)?|meri\s*location|apna\s*pata|pata|location|jagah)\s*(?:hai|h|he|hy)?\s*[:=-]?\s*/i, ' ');

    // 2b. Strip leading intent phrases like "yahan delivery karni hai", "delivery krni hai", etc.
    cleaned = cleaned.replace(/^(?:yahan|idhar|idr|idher|yhn)?\s*(?:pe|par)?\s*(?:bhi)?\s*(?:delivery|deliver|order|parcel)?\s*(?:karni|krni|karna|krna|karwana|krwana|bhejna|bhej|send)?\s*(?:hai|ha|h|he|hy|chahiye)?\s*(?:pe|par|mein|me|ko)?\s*/i, '');
    cleaned = cleaned.replace(/^(?:delivery|deliver|parcel)\s*(?:karni|krni|karna|krna|karwana|krwana|bhejna)?\s*(?:hai|ha|h|he|hy)?\s*(?:pe|par|mein|me|ko)?\s*/i, '');

    // 3. Canonical mapping for common typos and delivery areas
    cleaned = cleaned.replace(/\b(?:khann?a)\s+(?:pull?l?|pool|pol)\b/gi, 'Khana Pull');
    cleaned = cleaned.replace(/\b(?:khana|khanna)\s*pull?l?\b/gi, 'Khana Pull');
    cleaned = cleaned.replace(/\b(?:ghori|gauri|ghawri)\s+town\b/gi, 'Ghauri Town');
    cleaned = cleaned.replace(/\b(?:tarlay|terlai)\b/gi, 'Tarlai');
    cleaned = cleaned.replace(/\b(?:tarmari|taramary)\b/gi, 'Taramari');
    cleaned = cleaned.replace(/\b(?:sanam\s+chow?k)\b/gi, 'Sanam Chok');

    // 4. Remove conversational filler phrases only when combined with action verbs
    cleaned = cleaned.replace(/\b(?:es|is|yeh|ye|yahi|yehi|wahi|meri|mera|apni)\s+(?:location|pata|address|jagah)\s*(?:par|pe|idhar|bhi)?\b/gi, ' ');
    cleaned = cleaned.replace(/\b(?:par|pe|idhar|idr|yahan|wahan)\s+(?:send|bhej|bhejo|deliver|parcel)\s*(?:kro|karo|krdo|kardo|kar\s*do|kr\s*do)?\b/gi, ' ');
    cleaned = cleaned.replace(/\b(?:ye|yeh|is|mera|apna|sab)?\s*(?:deals?|order|items?)\s*(?:bhi)?\s*(?:parcel|deliver|delivery|bhej|bhejo|send|pack)\s*(?:krdo|kardo|kar\s*do|kr\s*do|kr\s*du|kar\s*du|karo|kro|krna|karna|karein|chahiye)?\s*(?:ha|hai|h|ho)?\b/gi, ' ');
    cleaned = cleaned.replace(/\b(?:khana)\s+(?:bhi\s+)?(?:deliver|parcel|bhej|bhejo|send|pack)\s*(?:krdo|kardo|kar\s*do|kr\s*do|karo|kro|karein|chahiye)?\b/gi, ' ');
    cleaned = cleaned.replace(/\b(?:mein|me|mai|mei|mn|par|pe|ko)\s+(?:delivery\s+)?(?:krni|karni|krna|karna|krwani|karwani|krwana|karwana|h|hai|karein)\b/gi, ' ');
    cleaned = cleaned.replace(/\b(?:deliver|delivery|parcel|bhej|bhejo|send|pack)\s*(?:krdo|kardo|kar\s*do|kr\s*do|kr\s*du|kar\s*du|kro|karo|krna|karna|krwana|karwana)?\s*(?:ha|hai|h)?\b/gi, ' ');
    cleaned = cleaned.replace(/\b(?:bhej\s*do|kar\s*do|kr\s*do|kar\s*du|kr\s*du|bhejo|kardo|krdo|dein)\b/gi, ' ');
    cleaned = cleaned.replace(/\b(?:idhar|idr|yahan|wahan)\s+(?:deliver|bhej|kardo|krdo)\b/gi, ' ');
    cleaned = cleaned.replace(/\b(?:krni|karni|krna|karna|krwani|karwani|krwana|karwana)\s+(?:ha|hai|h|he|hy|chahiye)\b/gi, ' ');
    cleaned = cleaned.replace(/\b(?:deliver|delivery|parcel|bhejna|bhej)\b/gi, ' ');
    cleaned = cleaned.replace(/\b(?:same\s*(?:number|numbr|no|whatsapp)?|num(?:br|ber)?\s*sam(?:e)?(?:\s*(?:ryga|rhega|rahega))?|easypaisa|easy\s*paisa|ep|cod|cash\s*on\s*delivery|cash|payment\s*(?:method)?)\b/gi, ' ');

    // 5. Strip trailing conversational endings cleanly (e.g. "par karni ha", "mein delivery krni ha", "karni hai", "par", "ha", etc.)
    let prev;
    do {
        prev = cleaned;
        cleaned = cleaned.replace(/\s+(?:mein|me|mai|pe|par|per|ko)?\s*(?:delivery|deliver|parcel|order)?\s*(?:krni|karni|krna|karna|karwana|krwana|karwani|krwani|krdo|kardo|kar\s*do|kr\s*do|karo|kro|bhej\s*do|bhejo|bhejna|bhej|mangwana|mangwa\s*do|send\s*kar\s*do|send\s*kr\s*do|send|pack|available|hoti|hoga|hogi|hosi|ho\s*sakti|ho\s*skty|ho\s*sakta|mil\s*jayegi|karty|krty)?\s*(?:ha|hai|h|he|hy|ho|chahiye|dein|do|please|plz)?\s*\??$/i, '');
        cleaned = cleaned.replace(/\s+(?:par|pe|mein|me|mai|ko|karni|krni|karna|krna|karwana|krwana|karein|kar|kr|bhejo|bhej|bhejna|send|deliver|delivery|parcel|pack|do|dein|karo|kro|krdo|kardo|ha|hai|h|he|hy|ho|chahiye|hoga|hogi|plz|please)$/i, '');
    } while (cleaned !== prev);

    cleaned = cleaned.replace(/^[,\s.-]+|[,\s.-]+$/g, '').replace(/\s+/g, ' ').trim();
    const INVALID_ADDR_STRICT = /^(?:par|pe|idhar|idr|yahan|wahan|send|bhej|bhejo|kro|karo|krdo|kardo|ha|hai|hy|h|he|chahiye|ho|badalna|change|update|location|ad(?:d)?re(?:e)?s(?:s)?|es\s*location|is\s*location|ye\s*location|ye\s*mere\s*location|ye\s*meri\s*location|meri\s*location|area\s*me\s*aati\s*hai\??|delivery\s*area\??)$/i;
    if (!cleaned || cleaned.length < 4 || INVALID_ADDR_STRICT.test(cleaned)) {
        return null;
    }
    if (!cleaned.includes(' ') && !ADDRESS_INDICATORS.test(cleaned)) {
        return null;
    }
    return cleaned;
}

// Comprehensive delivery location indicator regex covering all official delivery areas
export const ADDRESS_INDICATORS = /\b(town|phase|sector|street|gali|house|guest\s*house|makan|flat|block|road|chowk|chok|pul|pull|pulll|pool|colony|scheme|market|plaza|nearby|near|islamabad|rawalpindi|pindi|tarlai|khanna|khana|ghauri|ghori|sohan|korang|i-8|i-9|i-10|g-8|g-9|g-10|g-11|f-8|f-9|f-10|f-11|pwd|bahria|dha|burma|shakral|shakrial|zia|bilal|madina|sarfraz|sharifabad|malik|marwa|basit|albadar|karachi\s*house|juma\s*bazar|school\s*stop|dakhana|tali\s*mor|rehman\s*enclave|zamna|p-v|sudran|mehrban|chistiyan|gulberg|gulzar)\b/i;

// Words strictly excluded from customer name extraction (location indicators, greetings, action words, affirmations, food items, pizza flavors)
export const NOT_NAME_REGEX = /\b(hlo|hlw|hy|helo|hellow|hi|hello|hey|salam|slam|assalam|aoa|assalamualaikum|suno|oye|yo|confirm|comfirm|konfirm|condrim|confrim|confrm|cnfrm|cfrm|smile|smileee|aik|do|teen|char|panch|chay|chey|saat|aath|nau|dus|checkout|proceed|continue|krdo|kardo|kar\s*do|kr\s*do|karo|kro|kar|kr|karna|krna|karein|chahiye|mangwao|mangwana|pack|parcel|send|bhej|bhejo|theek|thk|thek|done|ok|okk|okay|sure|yes|yup|yep|haan|han|hn|ha|g|ji|jee|no|nahi|nahii|nhi|nh|nai|na|mat|cancel|cancle|kansil|discount|discounts|riayat|payment|cod|cash|easypaisa|easy|paisa|delivery|address|location|pata|order|deal|deals|pizza|burger|menu|manu|manue|meny|menue|mainu|mainue|mny|dikhao|dijhao|dikaho|dekhao|dikhayein|dikhana|dikha|btao|batao|bhejna|kase|kaise|kese|scene|hal|haal|rate|list|kya|kia|hy|hain|hen|dein|bhai|bhaiya|bhae|bhi|sain|sir|bro|madam|khan|food|water|drink|bill|kam|ja|hai|mera|meara|apna|apni|name|naam|nam|is|am|are|my|sahi|shai|koi|kuch|kuchh|method|party|small|medium|large|reg|regular|can|liter|litre|1\.5l|1l|flavor|flavour|crust|cheese|extreme|extrme|chicken|peri|behari|bihari|tikka|fajita|supreme|tandoori|malai|boti|ranch|cream|creamy|pepperoni|peperoni|veggie|vegetable|onion|olive|mushroom|jalapeno|bbq|zinger|zegy|nuggets|nugget|fries|wings|wing|roll|paratha|sauce|dip|coke|pepsi|sprite|fanta|dew|stuff|stuffed|crown|calzone|combo|box|platter|card|cards|flyer|flyers|brochure|pamphlet|pas|oas|aur|dedo|likh|rakh|daal|same|yahi|yehi|yehe|yhe|wahi|isi|rahyga|rahega|rhega|ryga|rahy|rahe|rehn|rehna|rehne|rakho|rakhein|hoga|hogi|hoge|number|numbr|num|hoo|ho|hu|hun|hoon|jigri|town|phase|sector|street|gali|house|makan|flat|block|road|chowk|chok|pul|pull|pulll|colony|scheme|market|plaza|islamabad|rawalpindi|pindi|tarlai|khanna|khana|ghauri|ghori|sohan|korang|burma|shakral|shakrial|zia|bilal|madina|sarfraz|sharifabad|malik|marwa|basit|albadar|dakhana|rehman|gulberg|gulzar)\b/i;

/**
 * Check if candidate string contains any food item, flavor, topping or size.
 * Prevents pizza flavors (e.g. "Chicken extrme", "Fajita") from ever becoming customer name!
 */
export function isFoodOrFlavorWord(text) {
    if (!text || typeof text !== 'string') return false;
    const clean = text.toLowerCase().trim();
    return /\b(chicken|extrme|extreme|tikka|fajita|behari|bihari|peri|supreme|cheese|lover|crown|crust|zinger|zegy|burger|pizza|deal|deals|fries|nugget|nuggets|wing|wings|roll|pepsi|coke|sprite|fanta|dew|drink|drinks|sauce|dip|platter|box|shawarma|paratha|flavor|flavour|small|medium|large|party|regular)\b/i.test(clean);
}

/**
 * Extracts customer checkout details (name, delivery address, payment method, phone) from conversational text.
 */
export function extractCustomerDetails(raw, knownDetails = {}) {
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

    // 2. Phone (including phone updates and validation)
    let invalidPhone = null;
    const phoneUpdateMatch = raw.match(/(?:number|numbr|numebr|no|phone|rabta|contact)\s*(?:mera\s+|apna\s+)?(?:badal\s*(?:k\s*|ke\s*)?|change\s*(?:kr\s*k\s*|kar\s*k\s*|karke\s*)?|update\s*(?:kr\s*k\s*|kar\s*k\s*|karke\s*)?|kar\s*(?:do|dein|karo|du)|kr\s*(?:do|dein|kro|du)|rakh\s*(?:do|dein|lo|du)|likh\s*(?:do|dein|lo|du)|(?:\b(?:hai|he|hy|h)\b)|:|=|-|\s+)\s*([+\d\s-]{7,18})/i);
    const isExplicitSamePhone = /\b(?:(?:same|yahi|yehi|yehe|yhe|wahi|isi)\s*(?:hi\s*)?(?:number|numbr|no|whatsapp|contact)?\s*(?:hoga|hogi|rahyga|rahega|rhega|ryga|rahy\s*ga|rahe\s*ga|rakho|rakhein|rehne\s*do|dedo|de\s*do|likh\s*do|likh\s*lo|daal\s*do|kar\s*do|kr\s*do|karo|kro|hi|bhi|theek|hai|he|hy|h|yar|bhai)?|num(?:br|ber)?\s*sam(?:e)?(?:\s*(?:ryga|rhega|rahega|rahy\s*ga|rahe\s*ga))?)\b/i.test(lower) ||
        /\b(?:same|yahi|yehi|yehe|yhe|wahi|isi)\s+(?:rahyga|rahega|rhega|ryga|rahy\s*ga|rahe\s*ga|hoga|rakho|dedo|de\s*do|likh\s*do|likh\s*lo|daal\s*do)\b/i.test(lower) ||
        /\b(?:yehe|yehi|yahi|same|isi)\s*(?:hi\s*)?(?:number|numbr|no|whatsapp)\b/i.test(lower) ||
        /\b(?:btaya|bola|kaha)\s+to\s+h(?:ai|y)?.*(?:yehe|yehi|same|isi)\s+number\b/i.test(lower);
    const isAwaitingPhone = knownDetails.name && !knownDetails.phoneConfirmed;
    const isNegativeSamePhone = isAwaitingPhone && /^(?:ni|nahi|nahin|nhi|nh|na|no|nope|koi\s*(?:bhi\s*)?n(?:ahi|i|hin|h)?(?:\s*krna)?|koi\s*doosra\s*n(?:ahi|i|hin|h)?|koi\s*aur\s*n(?:ahi|i|hin|h)?)[\s.!?]*$/i.test(lower.trim());
    const isContextualSamePhone = isAwaitingPhone && (
        isNegativeSamePhone ||
        /^(?:(?:haan?|g|ji|jee|yes|ok|theek\s*(?:hai|hy)?)\s*)?(?:same|yahi|yehi|yehe|yhe|wahi|isi\s*pe|yahi\s*hai|yehi\s*hai|isi\s*number|yehi\s*number|yahi\s*number|yehe\s*number|same\s*number|same\s*whatsapp|haan|han|hn|ji|jee|g|yes|theek\s*hai|theek\s*hy|ok|done)\s*(?:hi\s*)?(?:number|no|whatsapp|contact)?\s*(?:pe|par|per)?\s*(?:hoga|hogi|rahyga|rahega|rhega|ryga|rahy\s*ga|rahe\s*ga|rakh\s*lo|rakh\s*do|rakho|rakhein|rehn\s*do|rehne\s*do|dedo|de\s*do|likh\s*do|likh\s*lo|daal\s*do|kar\s*do|kr\s*do|karo|kro|bhej\s*do|bhejo|rabta\s*karein|rabta|rider\s*ko\s*de\s*do|rider\s*ko\s*dedo|theek\s*(?:hai|hy)?|hai|he|hy|yar|bhai)?[\s.!?]*$/i.test(lower.trim()) ||
        /\b(?:same|yahi|yehi|yehe|wahi|isi)\s*(?:hi\s*)?(?:number|no|whatsapp)?\s*(?:pe|par|per)?\s*(?:rahyga|rahega|rhega|ryga|rahy\s*ga|rahe\s*ga|hoga|rakh\s*lo|rakh\s*do|rakho|dedo|de\s*do|likh\s*do|likh\s*lo|bhej\s*do)\b/i.test(lower.trim()) ||
        /\b(?:btaya|bola|kaha)\s+to\s+h(?:ai|y)?.*(?:yehe|yehi|same|isi)\s+number\b/i.test(lower.trim())
    );

    if (phoneUpdateMatch) {
        const rawDigits = phoneUpdateMatch[1].replace(/\D/g, '');
        if (/^03\d{9}$/.test(rawDigits)) {
            phone = rawDigits;
        } else if (/^3\d{9}$/.test(rawDigits)) {
            phone = '0' + rawDigits;
        } else if (/^923\d{9}$/.test(rawDigits)) {
            phone = '0' + rawDigits.slice(2);
        } else if (rawDigits.length >= 7) {
            invalidPhone = rawDigits;
        }
    } else if (isExplicitSamePhone || isContextualSamePhone) {
        phone = 'SAME_WHATSAPP';
    } else {
        const phMatch = raw.match(/(?:03\d{9}|\+?923\d{9})/);
        if (phMatch) {
            phone = phMatch[0].replace(/\D/g, '');
            if (phone.startsWith('92')) phone = '0' + phone.slice(2);
        } else if (isAwaitingPhone) {
            // Bare digits provided when specifically waiting for phone
            const bareDigitsMatch = raw.trim().match(/^([+\d\s-]{7,18})$/);
            if (bareDigitsMatch) {
                const rawDigits = bareDigitsMatch[1].replace(/\D/g, '');
                if (/^03\d{9}$/.test(rawDigits)) {
                    phone = rawDigits;
                } else if (/^3\d{9}$/.test(rawDigits)) {
                    phone = '0' + rawDigits;
                } else if (/^923\d{9}$/.test(rawDigits)) {
                    phone = '0' + rawDigits.slice(2);
                } else {
                    invalidPhone = rawDigits;
                }
            }
        } else {
            // Strip URLs and decimal numbers to prevent coordinates (e.g. 33.6010934) from being treated as phone numbers
            const textWithoutUrlsAndDecimals = raw.replace(/https?:\/\/\S+/gi, '').replace(/\b\d+\.\d+\b/g, '');
            const phMatchInText = textWithoutUrlsAndDecimals.match(/(?:03\d{9}|\+?923\d{9})/);
            if (phMatchInText) {
                phone = phMatchInText[0].replace(/\D/g, '');
                if (phone.startsWith('92')) phone = '0' + phone.slice(2);
            } else {
                const hasExplicitPhoneKeyword = /(?:number|numbr|numebr|no|phone|rabta|contact)/i.test(raw);
                if (hasExplicitPhoneKeyword || isAwaitingPhone) {
                    const anyDigitsMatch = textWithoutUrlsAndDecimals.match(/\b([+\d]{7,16})\b/);
                    if (anyDigitsMatch && !phone) {
                        const rawDigits = anyDigitsMatch[1].replace(/\D/g, '');
                        if (/^03\d{9}$/.test(rawDigits)) {
                            phone = rawDigits;
                        } else if (/^3\d{9}$/.test(rawDigits)) {
                            phone = '0' + rawDigits;
                        } else if (/^923\d{9}$/.test(rawDigits)) {
                            phone = '0' + rawDigits.slice(2);
                        } else if (rawDigits.length >= 7 && rawDigits.length <= 15) {
                            invalidPhone = rawDigits;
                        }
                    }
                }
            }
        }
    }

    // 3. Name (Strictly excluded if matches location indicators, greetings, or known action words)

    // Explicit name change or assignment patterns (supports "naam hatim", "mera naam hatim", "my name is okasha", etc.)
    const nameUpdateMatch = raw.match(/\b(?:naam|name|nam)\s*(?:bhi\s*)?(?:badal\s*(?:k\s*|ke\s*)?(?:do|dein|karo|kr\s*do|kar\s*do|kr\s*du|kar\s*du)?|change\s*(?:kr\s*k\s*|kar\s*k\s*|karke\s*)?(?:do|dein|karo|krna|karna|kr\s*du|kar\s*du)?|update\s*(?:kr\s*k\s*|kar\s*k\s*|karke\s*)?(?:do|dein|karo|krna|karna|kr\s*du|kar\s*du)?|rakh\s*(?:do|dein|lo|karo|du)?|likh\s*(?:do|dein|lo|karo|du)?|kar\s*(?:do|dein|karo|du)?|kr\s*(?:do|dein|kro|du)?|ab\s+|(?:\b(?:is|hai|he|hy|h)\b)|:|=|-|\s+)\s*([A-Za-z]{2,20}(?:\s+[A-Za-z]{2,20})*)/i) ||
                           raw.match(/\b(?:meara|mera|apna)\s*(?:naam|name|nam)\s*(?:ab\s*)?([A-Za-z]{2,20}(?:\s+[A-Za-z]{2,20})*)/i) ||
                           raw.match(/\b(?:my\s+name\s+is|name\s+is)\s*([A-Za-z]{2,20}(?:\s+[A-Za-z]{2,20})*)/i) ||
                           raw.match(/\b(?:pehle\s+.*?\s+tha\s+ab\s+|nahi\s+)([A-Za-z]{2,20}(?:\s+[A-Za-z]{2,20})*)/i);

    const nameBefore = raw.match(/\b([A-Za-z]{2,20}(?:\s+[A-Za-z]{2,20}){0,2})\s+(?:meara|mera)\s+(?:name|naam)\b/i);
    const nameAfter = raw.match(/\b(?:meara|mera|apna)\s+(?:naam|name|nam)\s*(?:\b(?:is|hai|he|hy|h)\b|:|=|-)?\s*([A-Za-z]{2,20}(?:\s+[A-Za-z]{2,20}){0,2})\b/i) ||
                      raw.match(/\b(?:naam|name|nam)\s*[:=-]\s*([A-Za-z]{2,20}(?:\s+[A-Za-z]{2,20}){0,2})\b/i);

    let nameCandidate = (nameUpdateMatch ? nameUpdateMatch[1] : (nameBefore ? nameBefore[1] : (nameAfter ? nameAfter[1] : null)))?.trim();
    if (nameCandidate) {
        // Repeatedly strip leading common prefixes e.g. "same ", "wahi ", "yehi ", "yahi ", "naam ", "kr du ", "kar du ", "my name is", "is "
        while (/^(?:is|am|my|name|naam|nam|apna|apni|mera|meara|kr\s*du|kar\s*du|likh\s*du|rakh\s*du|same|wahi|yahi|yehi|isi)\s+/i.test(nameCandidate)) {
            nameCandidate = nameCandidate.replace(/^(?:is|am|my|name|naam|nam|apna|apni|mera|meara|kr\s*du|kar\s*du|likh\s*du|rakh\s*du|same|wahi|yahi|yehi|isi)\s+/i, '').trim();
        }
        // Strip trailing sentence filler e.g. "bki sari details same ha", "baki sab same hai"
        nameCandidate = nameCandidate.replace(/\s+(?:bki|baqi|baki|sari|details|sab|same|ha|hai|h|he|hy).*$/i, '').trim();
        // Strip trailing action verbs/honorifics
        nameCandidate = nameCandidate.replace(/\s+(?:kar\s*do|kr\s*do|kardo|krdo|rakh\s*do|rakhdo|likh\s*do|likhdo|rakh\s*lo|rakho|likho|kar\s*dein|kr\s*dein|kar\s*du|kr\s*du|karo|kro|hai|ha|h|he|hy|ja|tha|bhai|sir|jee|ji)$/i, '').trim();
        if (NOT_NAME_REGEX.test(nameCandidate) || isFoodOrFlavorWord(nameCandidate)) {
            nameCandidate = null;
        }
    }
    // Bare-string direct name check (e.g. user replies "Ali", "Ali Khan", "same hatim", "asim bki sari details...")
    // SAKHT RULE: ONLY run bare string name check if customer name is NOT yet known!
    // Never extract name if message contains question marks or inquiry words!
    const isQuestionOrInquiry = raw.includes('?') || /\b(?:kya|kia|kab|kese|kaise|kahan|kidhar|kahin|konsa|konse|kyun|kyu|hai\?|he\?|h\?|btao|batao|dikhao|dekhao)\b/i.test(raw);
    const isMenuOrQueryWord = /\b(?:menu|manu|manue|menue|meny|mainu|mainue|mny|catalog|catlog|rate|list|dikhao|dekhao|dikhayein|batao|bhejo|kase|kaise|kese|haal?|scene)\b/i.test(lower);
    const nameExplicit = Boolean(nameUpdateMatch || nameBefore || nameAfter);
    if (!nameCandidate && !knownDetails.name && !paymentMethod && !phone && !invalidPhone && !ADDRESS_INDICATORS.test(lower) && !isMenuOrQueryWord && !isQuestionOrInquiry) {
        const isGreetingOrFiller = /^(?:hlo|hlw|hy|helo|hellow|hi|hello|hey|salam|slam|assalam|aoa|assalamualaikum|suno|oye|yo|bhai|sir|bro)[\s.!?]*$/i.test(raw.trim());
        if (!isGreetingOrFiller) {
            let direct = raw.trim().replace(/^(?:same|wahi|yahi|yehi|isi)\s+/i, '').trim();
            direct = direct.replace(/\s+(?:bki|baqi|baki|sari|details|sab|same|ha|hai|h|he|hy).*$/i, '').trim();
            direct = direct.replace(/\s+(?:bhai|bhaiya|bhae|bro|sir|madam|khan|jee|ji)$/i, '').trim();
            const directMatch = direct.match(/^([A-Za-z]{2,20}(?:\s+[A-Za-z]{2,20})?)$/);
            if (directMatch && !NOT_NAME_REGEX.test(directMatch[1]) && !isFoodOrFlavorWord(directMatch[1])) {
                nameCandidate = directMatch[1].trim();
            }
        }
    }
    if (nameCandidate && !NOT_NAME_REGEX.test(nameCandidate) && !isFoodOrFlavorWord(nameCandidate)) {
        const parsedName = nameCandidate.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
        if (!knownDetails.name) {
            name = parsedName;
        } else if (nameExplicit) {
            const isExplicitRename = /\b(?:badal|change|update|ab\s+(?:mera\s+)?naam|mera\s+naam|my\s+name\s+is|name\s+is)\b/i.test(raw);
            if (isExplicitRename) {
                name = parsedName;
            }
        }
    }

    // 4. Address (including address updates)
    let textForAddr = raw;
    if (name) {
        textForAddr = textForAddr.replace(new RegExp('(?:^|\\s)' + name + '\\s+(?:meara|mera)\\s+(?:name|naam)\\s*(?:ha|hai|h)?', 'gi'), '')
                                 .replace(new RegExp('^' + name + '\\s+(?:name|naam|nam)(?:\\s+(?:is|hai|h|ja))?', 'gi'), '')
                                 .replace(new RegExp('(?:^|\\s)(?:meara|mera|apna)?\\s*(?:naam|name|nam)\\s*(?:is|hai|h|ja)?\\s*[:=-]?\\s*' + name + '\\s*(?:ha|hai|h)?', 'gi'), '');
    }

    const addrUpdateMatch = textForAddr.match(/(?:delivery\s*ad(?:d)?re(?:e)?s(?:s)?|ad(?:d)?re(?:e)?s(?:s)?|pata|location)\s*(?:badal\s*(?:k\s*|ke\s*)?|change\s*(?:kr\s*k\s*|kar\s*k\s*|karke\s*)?|update\s*(?:kr\s*k\s*|kar\s*k\s*|karke\s*)?|kar\s*(?:do|dein|karo)|kr\s*(?:do|dein|kro)|(?:\b(?:hai|he|hy|h)\b)|:|=|-)\s*([^,\n]+(?:,\s*[^,\n]+)*)/i);
    const addrExplicit = textForAddr.match(/(?:delivery\s*ad(?:d)?re(?:e)?s(?:s)?|ad(?:d)?re(?:e)?s(?:s)?|pata)\s*[:=-]?\s*([^,\n]+(?:,\s*[^,\n]+)*)/i);
    const locBefore = textForAddr.match(/([^,\n]+?)\s+(?:meari|meri)\s+location\b/i);
    const locExplicit = textForAddr.match(/(?:(?:meari|mera|apni)\s+)?location\s*(?:ha|hai|h)?\s*[:=-]?\s*([^,\n]+(?:,\s*[^,\n]+)*)/i);

    if (!isDeliveryAreaInquiry(textForAddr)) {
        if (addrUpdateMatch) {
            const rawAddrCandidate = addrUpdateMatch[1].trim();
            const isOnlyActionVerb = /^(?:krna|karna|krni|karni|badalna|change|update|chahiye|kar\s*do|kr\s*do|kardo|krdo|dein|karein|kar\s*dein|kr\s*dein|plz|please|bhai)\s*(?:ha|hai|hy|h|he)?$/i.test(rawAddrCandidate);
            if (!isOnlyActionVerb) {
                address = cleanExtractedAddress(rawAddrCandidate);
            }
        } else if (addrExplicit) {
            address = cleanExtractedAddress(addrExplicit[1]);
        } else if (locBefore) {
            address = cleanExtractedAddress(locBefore[1]);
        } else if (locExplicit) {
            address = cleanExtractedAddress(locExplicit[1]);
        } else if (!paymentMethod && (!name || knownDetails.name) && ADDRESS_INDICATORS.test(lower)) {
            if (!isDeliveryAreaInquiry(raw) && !raw.includes('?') && !/\b(?:kese|kaise|kaisy|kyun|kyu|why|radius|door|bakwas|galat)\b/i.test(raw)) {
                const potentialAddr = cleanExtractedAddress(textForAddr);
                if (potentialAddr && (ADDRESS_INDICATORS.test(potentialAddr) || potentialAddr.length >= 4) && potentialAddr.length <= 120) {
                    address = potentialAddr;
                }
            }
        } else if (knownDetails.name && (knownDetails.phoneConfirmed || knownDetails.phone) && !knownDetails.address && !paymentMethod && !phone) {
            // Customer is actively at Step 3 (awaiting delivery address).
            const candidateAddr = cleanExtractedAddress(textForAddr);
            const isNotAddress = /^(?:menu|deals?|cancel|khatam|band|nahi|nahin|nhi|na|no|nope|theek|ok|done|hi|hello|hey|suno|bhai)\b/i.test(lower.trim());
            if (candidateAddr && candidateAddr.length >= 3 && candidateAddr.length <= 120 && !isNotAddress) {
                address = candidateAddr;
            }
        }
    }

    if (address) {
        address = cleanExtractedAddress(address);
        if (address && address.length < 3) {
            address = null;
        }
    }

    return { name, nameExplicit, paymentMethod, phone, address, invalidPhone };
}

export function formatPakistaniPhone(phone) {
    if (!phone) return '';
    const digits = String(phone).replace(/\D/g, '');
    if (digits.startsWith('923') && digits.length >= 12) {
        return '0' + digits.slice(2, 12);
    }
    if (digits.startsWith('03') && digits.length >= 11) {
        return digits.slice(0, 11);
    }
    if (digits.startsWith('3') && digits.length === 10) {
        return '0' + digits;
    }
    return phone;
}

/**
 * Step-by-Step Checkout Protocol Helper.
 * Evaluates session order details and returns a deterministic, single-step prompt.
 */
export function formatLocationDisplay(details) {
    if (details?.location?.latitude != null && details?.location?.longitude != null) {
        return `[Google Maps par dekhein](https://www.google.com/maps?q=${details.location.latitude},${details.location.longitude})`;
    }
    let addr = details?.address || details?.location?.address || 'Google Maps Location Pin';
    addr = addr.replace(/^customer\s*ne\s*location\s*(?:share\s*ki|pin)?\s*[:=-]?\s*/i, '').trim();
    if (/https?:\/\/(?:www\.)?(?:google\.com\/maps|maps\.google\.com|goo\.gl|maps\.app\.goo\.gl)[^\s)\]]*/i.test(addr)) {
        const urlMatch = addr.match(/https?:\/\/(?:www\.)?(?:google\.com\/maps|maps\.google\.com|goo\.gl|maps\.app\.goo\.gl)[^\s)\]]*/i);
        if (urlMatch) {
            return `[Google Maps par dekhein](${urlMatch[0]})`;
        }
    }
    if (/lat=\s*-?\d+/i.test(addr) && /lng=\s*-?\d+/i.test(addr)) {
        const latM = addr.match(/lat=\s*(-?\d+(?:\.\d+)?)/i);
        const lngM = addr.match(/lng=\s*(-?\d+(?:\.\d+)?)/i);
        if (latM && lngM) {
            return `[Google Maps par dekhein](https://www.google.com/maps?q=${latM[1]},${lngM[1]})`;
        }
    }
    const cleaned = cleanExtractedAddress(addr);
    return formatAddressTitle(cleaned || addr);
}

/**
 * Step-by-Step Checkout Protocol Helper.
 * Evaluates session order details and returns a deterministic, single-step prompt.
 */
export async function getNextCheckoutStepResponse({
    details,
    whatsappPhone = '',
    cart = null,
    cache = null,
    introMessage = '',
}) {
    const rawCleanPhone = (whatsappPhone || '').replace(/\D/g, '');
    const displayPhone = formatPakistaniPhone(details.phone || rawCleanPhone);
    const customerName = details.name ? details.name.trim() : '';

    // STEP 1: Customer Name
    if (!details.name) {
        return {
            handled: true,
            routeName: 'step_name_needed',
            step: 'NAME',
            reply: (introMessage ? `${introMessage}\n\n` : '') +
                `Order book karne ke liye baraye meherbani pehle apna *Naam* bata dein? 😊`,
        };
    }

    // STEP 2: Phone Confirmation (Must be explicitly confirmed by customer)
    if (!details.phoneConfirmed) {
        return {
            handled: true,
            routeName: 'step_phone_needed',
            step: 'PHONE',
            reply: (introMessage ? `${introMessage}\n\n` : '') +
                `Shukriya ${customerName}! Rabtay ke liye rider ko yahi WhatsApp number (*${displayPhone}*) dein ya koi doosra contact number likhna hai? 📞`,
        };
    }

    // STEP 3: Delivery Address or Location Pin
    if (!details.address && !details.location) {
        return {
            handled: true,
            routeName: 'step_address_needed',
            step: 'ADDRESS',
            reply: (introMessage ? `${introMessage}\n\n` : '') +
                `Delivery kahan karni hai ${customerName}? Baraye meherbani apna mukammal *delivery address* (ya WhatsApp location pin) bhej dein 📍`,
        };
    }

    // Validate delivery radius whenever address or location pin is provided
    if (details.address || details.location) {
        try {
            const { checkDeliveryAvailability } = await import('./deliveryService.js');
            const dCheck = await checkDeliveryAvailability({
                restaurantId: cache?.restId,
                address: details.address || details.location?.address,
                latitude: details.location?.latitude,
                longitude: details.location?.longitude,
            });
            if (dCheck && !dCheck.available) {
                // Out of delivery radius! Reset session address so customer must provide a valid one
                details.address = null;
                details.location = null;
                details.locationConfirmed = false;
                details.locationAwaitingConfirmation = false;
                return {
                    handled: true,
                    routeName: 'step_location_out_of_range',
                    step: 'ADDRESS',
                    reply: `${dCheck.message}\n\nBaraye meherbani koi doosra delivery address ya WhatsApp location pin bhej dein jo hamari delivery range mein ho. 📍`,
                };
            }
        } catch (_) {}
    }

    // STEP 3b: Location Confirmation (Auto-confirmed for verified GPS pins within delivery radius)
    if (details.location?.latitude != null && details.location?.longitude != null) {
        details.locationConfirmed = true;
        details.locationAwaitingConfirmation = false;
    }

    // STEP 4: Payment Method (Guard: Never re-ask if paymentMethod is already set in session)
    if (!details.paymentMethod) {
        return {
            handled: true,
            routeName: 'step_payment_needed',
            step: 'PAYMENT',
            reply: (introMessage ? `${introMessage}\n\n` : '') +
                `Payment method kaunsa pasand karenge ${customerName} bhai — *Cash on Delivery (COD)* ya *EasyPaisa*? 💵`,
        };
    }

    // STEP 5: Extra Items Inquiry (Upsell before final confirmation)
    if (!details.extraItemsAnswered) {
        details.extraItemsInquired = true;
        return {
            handled: true,
            routeName: 'step_extra_items_needed',
            step: 'EXTRA_ITEMS',
            reply: (introMessage ? `${introMessage}\n\n` : '') +
                `Ji ${customerName} bhai, kya iske sath kuch aur add karna chahenge (jaise Extra Drink ya Fries)?`,
        };
    }

    // STEP 6: Final Order Confirmation Summary (All details verified, waiting for explicit "Confirm" or "Haan")
    details.awaitingFinalConfirmation = true;
    details.readyForConfirmation = true;

    // Calculate dynamic pricing & discounts using central pricingService
    const { calculatePricing } = await import('./pricingService.js');
    const itemsForPricing = (cart?.items || []).filter(i => i.menu_item_id).map(i => ({
        menuItemId: i.menu_item_id,
        variantId: i.menu_variant_id || undefined,
        quantity: i.quantity,
    }));
    const dealsForPricing = (cart?.items || []).filter(i => i.deal_id).map(i => ({
        dealId: i.deal_id,
        quantity: i.quantity,
    }));

    let deliveryFee = 0;
    let deliveryFeeKnown = false;
    let isOutOfRange = false;
    let outOfRangeMessage = '';

    if (cache?.restId && (details.address || details.location)) {
        try {
            const { checkDeliveryAvailability } = await import('./deliveryService.js');
            const dCheck = await checkDeliveryAvailability({
                restaurantId: cache.restId,
                address: details.address || details.location?.address,
                latitude: details.location?.latitude,
                longitude: details.location?.longitude,
            });
            if (dCheck && !dCheck.available) {
                isOutOfRange = true;
                outOfRangeMessage = dCheck.message;
            } else if (dCheck?.available && typeof dCheck.deliveryFee === 'number') {
                deliveryFee = dCheck.deliveryFee;
                deliveryFeeKnown = true;
            }
        } catch (_) {}
    }

    if (isOutOfRange) {
        return {
            handled: true,
            routeName: 'final_order_out_of_range',
            reply: `${outOfRangeMessage}\n\nBaraye meherbani koi doosra delivery address ya WhatsApp location pin bhej dein jo hamari delivery range mein ho. 📍`,
        };
    }

    const pricing = await calculatePricing({
        restaurantId: cache?.restId,
        items: itemsForPricing,
        deals: dealsForPricing,
        deliveryFee,
    }).catch(() => null);

    const subtotal = pricing ? pricing.subtotal : (cart?.items || []).reduce((s, i) => s + Number(i.deal?.deal_price ?? i.menu_variant?.price ?? i.menu_item?.base_price ?? i.unit_price ?? 0) * i.quantity, 0);
    const discountTotal = pricing ? Number(pricing.discountTotal || 0) : 0;
    const total = pricing ? pricing.total : (subtotal + deliveryFee);

    // Build order items block with discount display
    const orderLines = [];
    if (pricing?.breakdown?.items?.length > 0 || pricing?.breakdown?.deals?.length > 0) {
        for (const it of (pricing.breakdown.items || [])) {
            const v = it.variantName ? ` (${it.variantName})` : '';
            if (it.hasDiscount) {
                orderLines.push(`• ${it.quantity}x ${it.name}${v} — ~Rs. ${it.originalLineTotal.toLocaleString('en-PK')}~ *Rs. ${it.lineTotal.toLocaleString('en-PK')}* (${it.discountLabel || (it.discountPercent + '% OFF')})`);
            } else {
                orderLines.push(`• ${it.quantity}x ${it.name}${v} — Rs. ${it.lineTotal.toLocaleString('en-PK')}`);
            }
        }
        for (const d of (pricing.breakdown.deals || [])) {
            const raw = cart?.items?.find(ci => ci.deal_id === d.dealId);
            const notes = d.notes || raw?.notes;
            const fText = notes ? ` (${notes})` : '';
            orderLines.push(`• ${d.quantity}x ${d.name}${fText} — Rs. ${d.lineTotal.toLocaleString('en-PK')}`);
        }
    } else {
        for (const i of (cart?.items || [])) {
            const n = i.deal ? i.deal.name : (i.menu_item?.name || 'Item');
            const v = i.menu_variant ? ` (${i.menu_variant.name})` : '';
            const fText = i.notes ? ` (${i.notes})` : '';
            orderLines.push(`• ${i.quantity}x ${n}${v}${fText}`);
        }
    }
    const orderBlock = orderLines.length > 0 ? (orderLines.length === 1 ? `Order: ${orderLines[0]}` : `Order:\n${orderLines.join('\n')}`) : 'Order: 1x Item';

    const cleanLocation = formatLocationDisplay(details);

    let billLines = '';
    if (discountTotal > 0) {
        billLines += `Subtotal: Rs. ${subtotal.toLocaleString('en-PK')}\n`;
        billLines += `Discount: -Rs. ${discountTotal.toLocaleString('en-PK')}\n`;
    }
    billLines += `Delivery Charges: ${deliveryFee === 0 ? 'Free' : 'Rs. ' + deliveryFee.toLocaleString('en-PK')}\n`;
    billLines += `Total: Rs. ${total.toLocaleString('en-PK')}`;

    return {
        handled: true,
        routeName: 'final_order_summary',
        step: 'CONFIRMATION',
        reply: (introMessage ? `${introMessage}\n\n` : '') +
`${customerName ? customerName + ' bhai, ' : ''}aap ke order ki final details ye hain:
${orderBlock}
${billLines}
Payment: ${details.paymentMethod === 'COD' ? 'Cash on Delivery (COD)' : 'EasyPaisa'}
Contact: ${displayPhone}
Delivery Location: ${cleanLocation}

Kya aap tamam details check karke is order ko confirm karte hain?
Order book karne ke liye “Confirm” ya “Haan” likhein. Agar koi detail change karni hai to bata dein.`,
    };
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

        // Add item Pattern E: "burger deal 3 kr da", "burger deal 3 kardo", "deal 2 kr do", "burger deal 3"
        const orderSuffixMatch = lower.match(/^(.+?)\s+(?:kr\s*d[ao]|kar\s*d[ao]|kardo|krdo|krdu|kardu|kar\s*dein|kr\s*dein|karden|kar\s*dain|kr\s*dain|chahiye|mangwana|pack\s*karo|pack\s*krdo)$/i);
        if (orderSuffixMatch && !/^(?:deals?|all\s+deals|menu)$/i.test(orderSuffixMatch[1].trim())) {
            const inner = orderSuffixMatch[1].trim();
            const qtyMatch = inner.match(/^(\d+)\s+(?:x\s+)?(.+)$/);
            return {
                intent: 'ADD_ITEM',
                entities: {
                    quantity: qtyMatch ? parseInt(qtyMatch[1], 10) : 1,
                    itemQuery: qtyMatch ? qtyMatch[2].trim() : inner,
                },
                confidence: 0.94,
            };
        }

        // Add item Pattern F: "burger deal 1", "burger meal 2", "pizza deal 3", "pizza meal 1"
        const mealDealMatch = lower.match(/^(?:burger|zinger|pi[z]+a)\s*(?:deal|meal)\s*(?:#|no\.?)?\s*(?:for\s*)?[1-5]$/i);
        if (mealDealMatch) {
            return {
                intent: 'ADD_ITEM',
                entities: {
                    quantity: 1,
                    itemQuery: lower.trim(),
                },
                confidence: 0.95,
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
import { calculateDiscount } from './discountService.js';

const FAST_HANDOVER_REGEX = /\b(bot\s*(?:se|sai|sy)?\s*(?:baat\s*)?(?:nahi|nh|nai|nhi|mat)|ai\s*(?:se|sai|sy)?\s*(?:baat\s*)?(?:nahi|nh|nai|nhi|mat)|(?:ap|aap|tum)\s*(?:se|sai|sy)?\s*(?:baat\s*)?(?:nahi|nh|nai|nhi|mat)|baat\s*(?:nahi|nh|nai|nhi)\s*k(?:a)?rni|bat\s*(?:nahi|nh|nai|nhi)\s*k(?:a)?rni|agent|live\s*agent|representative|operator|manager|owner|malik|maalik|complaint|shikayat|shikayet|service\s*achi\s*nahi|service\s*achhi\s*nahi|call\s*me|call\s*karo|call\s*karein|phone\s*karo|(?:bande|insan|human)\s*(?:se|sai|sy)\s*baat|kisi\s*(?:bande|insan)\s*(?:se|sai|sy)|asli\s*(?:bande|insan)|real\s*person|live\s*person|actual\s*person|human\s*support|human\s*agent|real\s*human|talk\s*to\s*(?:a\s*)?(?:human|agent|person|someone))\b/i;
const FAST_BOT_START_REGEX = /^((\.)?bot\s*(start|on|activate|active|resume|shuru|chalao)|start\s*bot|resume\s*bot|unmute|bot|\.bot)$/i;

const FAST_GREETING_REGEX = /^(salam|assalam|assalamualaikum|assalam\s*o\s*alaikum|aoa|slam|hi+|hello+|hey+|hlo+|hlw+|hy+|helo+|hellow+|bhai|suno|oye|yo)[\s!?.]*$/i;
const FAST_CHITCHAT_REGEX = /\b(?:k[ae]se\s*(?:h[oi]|ho|hain|hen|h|hy)|kaise\s*(?:h[oi]|ho|hain|hen|h|hy)|k[yi]a\s*ha?al\s*(?:hai|h|hy|hain)?|how\s*are\s*you|sab\s*(?:theek|thk|kheriat|khairiat)|theek\s*ho|k[yi]a\s*scene\s*(?:hai|h|hy))\b/i;
const FAST_THANKS_REGEX = /^(thanks|thank you|shukriya|shukria|jazakallah|jazak allah)[\s!?.]*$/i;
const FAST_OFF_TOPIC_REGEX = /\b(cricket|psl|imran|nawaz|politics|siyasat|mausam|weather|joke|lateefa|shayari|movie|film|coding|python|javascript)\b/i;

const FAST_MENU_REGEX = /^(?:(?:acha|achha|theek|thk|sahi|ok|okay|aur|to|phir|ab|mjhy|mjhe|mujhe|mujy|humain|humein|bhai|yaar|yar|plz|please|show|send|bhejo|bhajo|dikhao|dekhao|apna|apka|aapka)\s+)*(?:menu|manu|manue|menue|meny|mainu|mainue|catalog|catlog|card|cards|flyer|flyers|pamphlet)(?:\s*(?:dikhao|dijhao|dikaho|dekhao|dikhayein|bhejo|bhajo|bhej\s*do|send|btao|batao|share|list|card|do|plz|please|na))*(?:\s*(?:na|plz|please))?|rate\s*list|food\s*list|items?\s*list|list\s*(?:dikhao|bhejo|dekhao)|(?:kya\s*kya|kya|kia)\s*(?:milta|hai|h|hy|items?\s*hain?|available\s*hai)|apke\s*pas\s*(?:kya\s*kya|kya)\s*(?:hai|h|hy)|(?:menu\s*)?(?:card|cards|flyer|flyers|pamphlet)\s*(?:bhajo|bhejo|dikhao|dekhao|send|do)*(?:\s*(?:na|plz|please))?[\s.!?]*$/i;
const FAST_MENU_CONTAINS = /\b(menu|manu|manue|menue|meny|mainu|mainue|catalog|catlog|rate\s*list|food\s*list|items?\s*list|menu\s*card|rate\s*card|card\s*bhajo|card\s*bhejo|menu\s*dikhao|menu\s*dekhao|menu\s*bhejo|menu\s*send)\b/i;

const FAST_DEALS_REGEX = /^(?:(?:acha|achha|theek|thk|sahi|ok|okay|aur|to|phir|ab|mjhy|mjhe|mujhe|mujy|humain|humein|bhai|yaar|yar|show|send|bhejo|bhajo|dikhao|dekhao|btao|batao|share|karo|kro|dein|plz|please)\s+)*(?:all\s+|sari\s+|saari\s+|tamam\s+|latest\s+|new\s+|best\s+)?(?:deals?|burger\s*deals?|pi[z]+a\s*deals?|deal\s*offers?|offers?|packages?|combos?|deal\s*list|deals?\s*list)(?:\s*(?:dikhao|dekhao|dikhayein|bhejo|bhajo|bhej\s*do|send|btao|batao|share|list|card|cards|flyer|flyers|images?|pics?|pictures?|photos?|dein|do|karo|kro|chahiye|hain|hen|h|hy|milenge|available\s*hain?|bhi\s*hain?|options|plz|please|yar|bhai|na))*[\s.!?]*$/i;
const FAST_DEALS_CONTAINS = /\b(?:deals?|burger\s*deals?|pi[z]+a\s*deals?|deal\s*offers?|deal\s*list|deals?\s*list|deal\s*card|deals?\s*card|deal\s*flyer|deals?\s*flyer|deals?\s*dikhao|deals?\s*bhejo|deal\s*bhejo|deal\s*chahiye|deals?\s*chahiye)\b/i;


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

    // Food order action: customer wants to ADD or ORDER specific food items (should not be intercepted by menu/info views)
    const hasCartOrOrderAction = /\b(add\s+to\s+cart|cart\s*(?:m|me|mai|mein)|checkout|check\s*out|daal\s*do|cancel\s+order|bar\s*(?:kr|kar)\s*do|sari\s+deals?|har\s+deal)\b/i.test(lower) ||
        /\b(?:kr\s*d[ao]|kar\s*d[ao]|kardo|krdo|krdu|kardu|karein|kar\s*dein|kr\s*dein|kar\s*dain|kr\s*dain)\b/i.test(lower) ||
        /^(?:add|order)\s+\d+/i.test(lower) ||
        /^\d+\s*(?:x\s+)?(?:pizza|burger|deal|zinger|roll)/i.test(lower);

    // ── 1. Handover / Complaint / Real Person Request ──
    const isFoodOrDealContext = /\b(?:deals?|meals?|offers?|packages?|combos?|pizza|burger|fries|food|khana|menu|catalog|items?|order|serving|servings|person\s*deal|person\s*meal|bando\s*ki\s*deal|bando\s*k\s*liye|bandon\s*k\s*liye)\b/i.test(lower) ||
        /\b(?:one|1|two|2|three|3|four|4|five|5|single|double)\s*(?:person|persons|people|banda|bande|bando|bndon|insan)\b/i.test(lower);
    const hasExplicitHandoverKeyword = /\b(?:agent|manager|owner|malik|maalik|complaint|shikayat|shikayet|call\s*me|call\s*karo|call\s*karein|phone\s*karo|talk\s*to\s*(?:human|agent|person|someone)|(?:bande|insan|human)\s*(?:se|sai|sy)\s*baat|kisi\s*(?:bande|insan))\b/i.test(lower);

    if (FAST_HANDOVER_REGEX.test(lower) && (!isFoodOrDealContext || hasExplicitHandoverKeyword)) {
        let customerReply = 'Aapki request humare support agent ko forward kar di gayi hai, humara representative jald aapse rabta karega.';
        let recentOrderSnippet = '';
        try {
            const { getDbClient } = await import('../db/client.js');
            const { getDefaultRestaurantId } = await import('./restaurantService.js');
            const prisma = getDbClient();
            const restId = await getDefaultRestaurantId();
            const cleanPhone = (whatsappPhone || '').replace(/\D/g, '');

            if (prisma && restId) {
                const setting = await prisma.restaurantSetting.findUnique({
                    where: { restaurant_id_key: { restaurant_id: restId, key: 'human_handoff_message' } }
                });
                if (setting?.value?.trim()) {
                    customerReply = setting.value.trim();
                }

                // Look up recent order to give context to customer and agent
                const orConds = [];
                if (sessionKey) {
                    orConds.push({ source_session_id: sessionKey });
                    orConds.push({ source_chat_id: sessionKey });
                }
                if (chatId && chatId !== sessionKey) orConds.push({ source_chat_id: chatId });
                if (cleanPhone) {
                    orConds.push({ phone: cleanPhone });
                    orConds.push({ whatsapp_phone: cleanPhone });
                }
                const recentOrder = orConds.length > 0 ? await prisma.order.findFirst({
                    where: {
                        restaurant_id: restId,
                        OR: orConds,
                    },
                    orderBy: { created_at: 'desc' },
                    select: { order_number: true, order_status: true, customer_name: true },
                }).catch(() => null) : null;

                if (recentOrder) {
                    recentOrderSnippet = ` aur order details (*#${recentOrder.order_number}*)`;
                }
            }
        } catch (_) {}

        if (recentOrderSnippet && customerReply.includes('support agent ko forward')) {
            customerReply = `Aap ki request${recentOrderSnippet} hamare support agent ko forward kar di gayi hai, hamara representative jald aapse rabta karega. Shukriya! 😊`;
        }

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
            const { clearMenuSentTracking } = await import('./sessionService.js');
            clearMenuSentTracking(sessionKey || chatId, (whatsappPhone || '').replace(/\D/g, ''));
        } catch (_) {}
        const cache = await getCatalogCache();
        const rawStore = cache.storeName || '';
        const store = (!rawStore || /store\s*admin|admin|default/i.test(rawStore)) ? 'Cravey Crust' : rawStore;
        return {
            handled: true,
            routeName: 'bot_start',
            reply: `Walaikum Assalam! Khushamdeed to *${store}*! Main aapka AI food ordering assistant hoon. Bot ko dobara shuru kar diya gaya hai! Aaj aap kya order karna chahenge? Hamara menu dekhne ke liye 'menu' ya 'deals' likhein!`,
        };
    }

    // ── Check Fast Route: Order Cancellation Request (Direct Bot Cancellation Disabled — Refer to Admin) ──
    const userSessionId = sessionKey || chatId;
    const cleanPhone = (whatsappPhone || '').replace(/\D/g, '');

    const isCancellationIntent =
        /\b(?:cancel|cancle|kansil)\b/i.test(lower) ||
        /\b(?:order\s*(?:ko\s*)?cancel|cancel\s*(?:kr|kar)\s*d[ou]|cancel\s*kar\s*dein|cancel\s*karo|cancel\s*krwana)\b/i.test(lower) ||
        /\b(?:cart\s*(?:clear|khali)|clear\s*cart)\b/i.test(lower) ||
        /^(?:nahi\s*(?:chahiye|lena|mangwana|karna)|rehne\s*do|rehn\s*do|chhor\s*do|khatam\s*karo|khatam\s*kr\s*do|rok\s*do)[\s!.?]*$/i.test(lower.trim());

    const isPolicyQuestion = /\b(?:policy|rule|timing|kya\s*hai|how\s*to)\b/i.test(lower) && !/\b(?:kr\s*du|kar\s*do|kardo|karo|bhai|yaar|plz|please)\b/i.test(lower);

    if (isCancellationIntent && !isPolicyQuestion && userSessionId) {
        try {
            const { getActiveCart, clearCart } = await import('./cartService.js');
            const { clearSessionOrderDetails } = await import('./sessionService.js');
            const { getAdminContact } = await import('./restaurantService.js');
            const cache = await getCatalogCache();
            const adminContact = await getAdminContact(cache.restId);
            const { getDbClient } = await import('../db/client.js');
            const prisma = getDbClient();

            let targetOrder = null;
            const orderMatch = lower.match(/#?CC-\d{6}/i);

            if (orderMatch && prisma) {
                const orderNum = orderMatch[0].replace('#', '').toUpperCase();
                targetOrder = await prisma.order.findFirst({
                    where: { restaurant_id: cache.restId, order_number: orderNum },
                });
            }

            // If no explicit order number, look up the latest order placed by this customer/chat
            if (!targetOrder && prisma) {
                const orConditions = [];
                if (userSessionId) {
                    orConditions.push({ source_session_id: userSessionId });
                    orConditions.push({ source_chat_id: userSessionId });
                }
                if (chatId && chatId !== userSessionId) orConditions.push({ source_chat_id: chatId });
                if (cleanPhone) {
                    orConditions.push({ phone: cleanPhone });
                    orConditions.push({ whatsapp_phone: cleanPhone });
                    if (cleanPhone.length >= 9) {
                        const last9 = cleanPhone.slice(-9);
                        orConditions.push({ phone: { contains: last9 } });
                        orConditions.push({ whatsapp_phone: { contains: last9 } });
                    }
                }
                if (orConditions.length > 0) {
                    targetOrder = await prisma.order.findFirst({
                        where: {
                            restaurant_id: cache.restId,
                            OR: orConditions,
                        },
                        orderBy: { created_at: 'desc' },
                    });
                }
            }

            if (targetOrder) {
                const custName = targetOrder.customer_name ? `Ji ${targetOrder.customer_name}!` : 'Ji!';

                // Case A: Already Cancelled (Idempotent response)
                if (targetOrder.order_status === 'CANCELLED') {
                    return {
                        handled: true,
                        routeName: 'fast_cancel_already_cancelled',
                        reply: `${custName} Aap ka order *#${targetOrder.order_number}* pehle hi cancel ho chuka hai! 👍\n\nAgar aap dobara kuch naya mangwana chahein ya koi aur madad chahiye ho, toh zaroor bataiyega. Main hamesha aap ki khidmat ke liye hazir hoon! 😊`,
                    };
                }

                // Case B: Delivered / Completed
                if (targetOrder.order_status === 'DELIVERED' || targetOrder.order_status === 'COMPLETED') {
                    return {
                        handled: true,
                        routeName: 'fast_cancel_already_delivered',
                        reply: `Aap ka order *#${targetOrder.order_number}* pehle hi deliver ho chuka hai, is liye ab cancel nahi kiya ja sakta. 😊\n\nAgar koi masla ya shikayat ho to baraye meherbani hamare Admin se rabta karein:\n📞 Phone: ${adminContact.displayPhone}`,
                    };
                }

                // Case C: Active Placed Order (PENDING, CONFIRMED, PREPARING, READY, OUT_FOR_DELIVERY) -> Refer directly to Admin
                const ordNum = targetOrder.order_number;
                const waLink = `${adminContact.whatsappLink}?text=${encodeURIComponent(`Assalam-o-Alaikum Admin, mujhe apna order #${ordNum} cancel karwana hai.`)}`;

                return {
                    handled: true,
                    routeName: 'fast_order_cancellation_admin_referral',
                    reply: `Mafi chahta hoon! Order place hone ke baad main direct order cancel nahi kar sakta kyunki kitchen mein preparation shuru ho chuki hoti hai. 🙏\n\nLekin main aap ko hamare *Admin / Branch Manager* ka contact share kar deta hoon jo aap ki cancellation process kar sakte hain:\n\n👤 *Store Admin / Manager:*\n📞 *Phone:* ${adminContact.displayPhone}\n💬 *WhatsApp Chat:* ${waLink}\n\nAap baraye meharbani apna Order Number (*#${ordNum}*) unhe bata dein taake woh foran aap ki madad kar sakein! 😊`,
                };
            }

            // Case D: If no placed order found, check if draft cart has items -> Clear Cart directly
            const cart = await getActiveCart({ sessionKey: userSessionId, restaurantId: cache.restId, chatId });
            if (cart?.items && cart.items.length > 0) {
                await clearCart({ sessionKey: userSessionId });
                clearSessionOrderDetails(userSessionId, cleanPhone);
                return {
                    handled: true,
                    routeName: 'fast_cancel_cart_cleared',
                    reply: `Aap ka abhi koi confirmed order place nahi hua tha, albata aap ke cart ke items clear kar diye gaye hain. 👍\n\nJab bhi dobara bhook lagay ya kuch lazeez khana ho, bas 'menu' ya 'deals' likh kar bhej dein! 😊`,
                };
            }

            // Case E: Neither placed order nor cart items
            return {
                handled: true,
                routeName: 'fast_cancel_not_found',
                reply: `Aap ka koi active order ya cart mein koi item nahi mila jise cancel kiya ja sake. 😊\n\nAgar aap ne kisi aur number se order kiya tha to apna Order Number (jaise #CC-123456) likhein ya hamare Admin se rabta karein:\n📞 Phone: ${adminContact.displayPhone}`,
            };
        } catch (err) {
            console.error('[FAST_ROUTE] Error processing cancellation:', err.message);
        }
    }

    // ── Check Fast Route: Re-order Request (Guide to Menu & Reassure Saved Details) ──
    const isReorderIntent =
        /\b(?:dobara|dubara|phir\s*se|phr\s*se|naye\s*siray\s*se|naya\s*order|naye\s*order)\b/i.test(lower) ||
        /\b(?:dobara|dubara|phir\s*se)\s*(?:se\s*)?(?:order|mangwana|karna|karwana|khana)\b/i.test(lower) ||
        /\b(?:reorder|re-order|order\s*again)\b/i.test(lower) ||
        /^(?:dobara\s*order|naya\s*order|phir\s*se\s*order|ek\s*aur\s*order|aur\s*order)[\s!.?]*$/i.test(lower.trim());

    const hasFoodItemInText = /\b(?:pizza|burger|deal|zinger|roll|fries|sandwich|wings)\b/i.test(lower);

    if (isReorderIntent && !hasFoodItemInText && !hasCartOrOrderAction) {
        try {
            const { getRememberedCustomerDetails } = await import('./sessionService.js');
            const remembered = await getRememberedCustomerDetails(userSessionId, cleanPhone);
            if (remembered?.name) {
                return {
                    handled: true,
                    routeName: 'fast_reorder_guidance',
                    reply: `Ji ${remembered.name}! Hamare menu mein se apna pasandeeda item choose karein. 🍕🍔\n\nHamara menu dekhne ke liye *'menu'* ya deals ke liye *'deals'* likhein. 😊`,
                };
            }
            return {
                handled: true,
                routeName: 'fast_reorder_guidance',
                reply: `Ji zaroor! Hamare menu mein se apna pasandeeda item choose karein. 🍕🍔\n\nHamara menu dekhne ke liye *'menu'* ya deals ke liye *'deals'* likhein! 😊`,
            };
        } catch (err) {
            console.error('[FAST_ROUTE] Error processing reorder guidance:', err.message);
        }
    }

    // ── Check Fast Route: Placed Order Update & Status Inquiry (Zero Tokens) ──
    try {
        const { getPendingOrderUpdate, setPendingOrderUpdate, clearPendingOrderUpdate } = await import('./sessionService.js');
        const cleanPhone = (whatsappPhone || '').replace(/\D/g, '');
        const activeOrderUpdate = getPendingOrderUpdate(userSessionId, cleanPhone);

        function getPhoneVariations(phoneInput) {
            if (!phoneInput) return [];
            const digits = String(phoneInput).replace(/\D/g, '');
            if (!digits) return [];
            const set = new Set();
            set.add(digits);
            let b10 = null;
            if (digits.length === 11 && digits.startsWith('0')) b10 = digits.slice(1);
            else if (digits.length === 12 && digits.startsWith('92')) b10 = digits.slice(2);
            else if (digits.length === 10 && digits.startsWith('3')) b10 = digits;
            if (b10) {
                set.add(b10);
                set.add('0' + b10);
                set.add('92' + b10);
                set.add('+92' + b10);
            }
            return Array.from(set);
        }

        async function buildCustomerOrderOrConditions(prisma) {
            const orConditions = [];
            const phoneVariants = new Set();
            if (cleanPhone) {
                getPhoneVariations(cleanPhone).forEach(p => phoneVariants.add(p));
            }
            if (whatsappPhone) {
                getPhoneVariations(whatsappPhone).forEach(p => phoneVariants.add(p));
            }

            // Look up session in DB to get UUID and chat_id and verified_phone
            let dbSession = null;
            if (userSessionId || chatId) {
                dbSession = await prisma.conversationSession.findFirst({
                    where: {
                        OR: [
                            ...(userSessionId ? [{ session_key: userSessionId }, { id: userSessionId }, { chat_id: userSessionId }] : []),
                            ...(chatId ? [{ chat_id: chatId }, { session_key: chatId }] : []),
                        ],
                    },
                    select: { id: true, chat_id: true, verified_phone: true },
                }).catch(() => null);
            }

            if (dbSession) {
                orConditions.push({ source_session_id: dbSession.id });
                if (dbSession.chat_id) orConditions.push({ source_chat_id: dbSession.chat_id });
                if (dbSession.verified_phone) {
                    getPhoneVariations(dbSession.verified_phone).forEach(p => phoneVariants.add(p));
                }
            }

            if (userSessionId) {
                orConditions.push({ source_session_id: userSessionId });
                orConditions.push({ source_chat_id: userSessionId });
            }
            if (chatId && chatId !== userSessionId) {
                orConditions.push({ source_chat_id: chatId });
            }

            // Customer record lookup by phone
            if (phoneVariants.size > 0) {
                const pList = Array.from(phoneVariants);
                for (const p of pList) {
                    orConditions.push({ phone: p });
                    orConditions.push({ whatsapp_phone: p });
                }
                const customer = await prisma.customer.findFirst({
                    where: {
                        OR: [
                            ...pList.map(p => ({ phone: p })),
                            ...pList.map(p => ({ whatsapp_phone: p })),
                        ],
                    },
                    select: { id: true },
                }).catch(() => null);
                if (customer) {
                    orConditions.push({ customer_id: customer.id });
                }
            }

            return orConditions;
        }

        // Helper: Find all customer's active orders
        async function getCustomerActiveOrders() {
            const { getDbClient } = await import('../db/client.js');
            const prisma = getDbClient();
            if (!prisma) return [];

            const orConditions = await buildCustomerOrderOrConditions(prisma);
            if (orConditions.length === 0) return [];

            return await prisma.order.findMany({
                where: {
                    order_status: { in: ['CONFIRMED', 'PREPARING', 'READY', 'PENDING', 'OUT_FOR_DELIVERY'] },
                    OR: orConditions,
                },
                orderBy: { created_at: 'desc' },
                include: { order_items: true, customer: true },
            });
        }

        // Helper: Find customer's latest order regardless of status (e.g. DELIVERED, CANCELLED)
        async function getCustomerLatestOrderAnyStatus() {
            const { getDbClient } = await import('../db/client.js');
            const prisma = getDbClient();
            if (!prisma) return null;

            const orConditions = await buildCustomerOrderOrConditions(prisma);
            if (orConditions.length === 0) return null;

            return await prisma.order.findFirst({
                where: { OR: orConditions },
                orderBy: { created_at: 'desc' },
                include: { order_items: true, customer: true },
            });
        }

        // Helper: Find specific order or latest order
        async function findCustomerTargetOrder(textInput = lower) {
            const { getDbClient } = await import('../db/client.js');
            const prisma = getDbClient();
            if (!prisma) return null;

            // Check if order number explicitly specified: e.g. CC-000012, #CC-12, Order 12, #12
            const explicitMatch = textInput.match(/(?:#?CC-?(\d{1,6})|\border\s*#?\s*(\d{1,6})\b)/i);
            if (explicitMatch) {
                const digits = explicitMatch[1] || explicitMatch[2];
                if (digits) {
                    const padded = 'CC-' + digits.padStart(6, '0');
                    const byPadded = await prisma.order.findFirst({
                        where: { order_number: padded },
                        include: { order_items: true, customer: true },
                    });
                    if (byPadded) return byPadded;

                    const allActive = await getCustomerActiveOrders();
                    const bySuffix = allActive.find(o => o.order_number.endsWith(digits) || o.order_number.includes(digits));
                    if (bySuffix) return bySuffix;
                }
            }

            const allActive = await getCustomerActiveOrders();
            if (allActive.length === 0) {
                const latestAny = await getCustomerLatestOrderAnyStatus();
                if (latestAny) {
                    return { isRecentInactive: true, order: latestAny };
                }
                return null;
            }
            if (allActive.length === 1) return allActive[0];

            // If customer explicitly says "pichla / purana / last / aakhri / recent / latest", pick the newest
            const isExplicitLatest = /\b(?:pichl[aeiy]+|puran[aeiy]+|last|aakhri|recent|latest)\b/i.test(textInput);
            if (isExplicitLatest) {
                return allActive[0];
            }

            // Multiple active orders exist
            return { isMultiple: true, orders: allActive };
        }

        // Helper: Format single consolidated confirmation summary card
        function buildOrderUpdateConfirmationCard(update) {
            const finalName = update.pendingChanges.name || update.originalName || 'Customer';
            const finalAddress = update.pendingChanges.address || update.originalAddress || 'Registered Address';
            const rawPhone = update.pendingChanges.phone || update.originalPhone || cleanPhone;
            const finalPhone = formatPakistaniPhone(rawPhone);
            const finalPay = update.pendingChanges.paymentMethod || update.originalPaymentMethod || 'COD';
            const payStr = finalPay === 'COD' ? 'Cash on Delivery (COD)' : 'EasyPaisa';
            const totalFormatted = Number(update.total).toLocaleString('en-PK');

            const changedBullets = [];
            if (update.pendingChanges.address) changedBullets.push(`• Naya Delivery Address: *${update.pendingChanges.address}* 📍`);
            if (update.pendingChanges.phone) changedBullets.push(`• Naya Contact Phone: *${formatPakistaniPhone(update.pendingChanges.phone)}* 📞`);
            if (update.pendingChanges.name) changedBullets.push(`• Naya Customer Name: *${update.pendingChanges.name}* 👤`);
            if (update.pendingChanges.paymentMethod) changedBullets.push(`• Naya Payment Method: *${payStr}* 💵`);

            const changesHeader = changedBullets.length > 0
                ? `Aap ke order (*#${update.orderNumber}*) mein ye changes note kar li hain:\n${changedBullets.join('\n')}\n\n`
                : `Aap ke order (*#${update.orderNumber}*) ki details ye hain:\n\n`;

            return `${changesHeader}📋 *UPDATED ORDER SUMMARY*\n• Items: ${update.itemsSummary}\n• Total Bill: Rs. ${totalFormatted} (${payStr})\n• Customer Name: *${finalName}*\n• Contact Phone: *${finalPhone}*\n• Delivery Address: *${finalAddress}*\n• Payment Method: *${payStr}*\n\nKya aap tamam details check karke is order update ko confirm karte hain?\nUpdate karne ke liye *"Confirm"* ya *"Haan"* likhein. (Agar koi aur detail change karni hai to bata dein)`;
        }

        // Sub-case 1: Customer confirms pending order update (e.g. "Nahi bss yehi confirm kr do", "Haan confirm kr do", "Confirm", "Theek hai", "Haan")
        const isAffirmativeSequence = /^(?:(?:nahi\s+)?(?:bss?\s+)?(?:yehi|yahi|isi\s*ko)?\s*)?(?:haan?|han|hn|ji|jee|yes|yep|yup|theek|thk|hai|hy|he|ok|okay|done|bilkul|sure|sahi|bhai|janab|sir|please|plz|\s+)+[\s.!?]*$/i.test(lower.trim());
        const isConfirmOrUpdateWord = /\b(?:confirm|co?n?f[iy]?r[mn]+|update\s*(?:kr\s*do|kar\s*do|kardo|krdo)?|kar\s*do|kr\s*do|kardo|krdo|kar\s*du|kr\s*du)\b/i.test(lower) && !/\b(?:mat|cancel|rok|address|naam|name|phone|number|pata|gali)\b/i.test(lower) && !/^(?:nahi|na|no)\b/i.test(lower.replace(/^(?:nahi\s+)?(?:bss?\s+)?(?:yehi|yahi|isi\s*ko)?/i, ''));
        const isUpdateConfirmKeyword = isAffirmativeSequence || isConfirmOrUpdateWord;
        if (activeOrderUpdate && isUpdateConfirmKeyword && activeOrderUpdate.pendingChanges && Object.keys(activeOrderUpdate.pendingChanges).length > 0) {
            const cache = await getCatalogCache();
            const { updateOrderDetails } = await import('./orderService.js');
            const res = await updateOrderDetails({
                restaurantId: cache.restId,
                orderNumber: activeOrderUpdate.orderNumber,
                customerName: activeOrderUpdate.pendingChanges.name,
                address: activeOrderUpdate.pendingChanges.address,
                location: activeOrderUpdate.pendingChanges.location,
                phone: activeOrderUpdate.pendingChanges.phone,
                paymentMethod: activeOrderUpdate.pendingChanges.paymentMethod,
                changedByType: 'CUSTOMER',
                sock,
            });

            if (res.success) {
                clearPendingOrderUpdate(userSessionId, cleanPhone);
                const finalOrder = res.order;
                const finalName = activeOrderUpdate.pendingChanges.name || activeOrderUpdate.originalName || finalOrder.customer_name;
                const finalAddr = activeOrderUpdate.pendingChanges.address || activeOrderUpdate.originalAddress || finalOrder.delivery_address;
                const finalPhone = formatPakistaniPhone(activeOrderUpdate.pendingChanges.phone || activeOrderUpdate.originalPhone || finalOrder.phone);
                const finalPay = (activeOrderUpdate.pendingChanges.paymentMethod || activeOrderUpdate.originalPaymentMethod || finalOrder.payment_method) === 'COD' ? 'Cash on Delivery (COD)' : 'EasyPaisa';

                return {
                    handled: true,
                    routeName: 'fast_order_update_confirmed',
                    reply: `Zabardast! Aap ke order (*#${activeOrderUpdate.orderNumber}*) ki details kamyabi se update ho gayi hain! 🎉\n\n• Customer Name: *${finalName}*\n• Contact Phone: *${finalPhone}*\n• Delivery Address: *${finalAddr}* 📍\n• Payment Method: *${finalPay}*\n• Items: ${activeOrderUpdate.itemsSummary}\n• Total Bill: Rs. ${Number(finalOrder.total).toLocaleString('en-PK')}\n\nCravey Crust kitchen team aur rider ko updated details bhej di gayi hain. Mazay se khana enjoy karein! 🍕🛵`,
                };
            } else {
                return {
                    handled: true,
                    routeName: 'fast_order_update_failed',
                    reply: `Order update nahi ho saka: ${res.message || 'Kuch takneeki masla aa gaya.'} Baraye meherbani support agent se rabta karein.`,
                };
            }
        }

        // Sub-case 2: Active order update is in progress
        if (activeOrderUpdate) {
            // Check if customer is selecting from multiple active orders (e.g. "12", "CC-000012", "pehla")
            if (activeOrderUpdate.awaitingOrderSelection && activeOrderUpdate.multipleOrders) {
                let selectedOrder = null;
                const digitMatch = lower.match(/\b(\d{1,6})\b/);
                const digits = digitMatch ? digitMatch[1] : null;

                if (digits) {
                    selectedOrder = activeOrderUpdate.multipleOrders.find(o => o.order_number.endsWith(digits) || o.order_number === 'CC-' + digits.padStart(6, '0'));
                }
                if (!selectedOrder && /\b(?:pehla|first|1st|1)\b/i.test(lower)) {
                    selectedOrder = activeOrderUpdate.multipleOrders[0];
                }
                if (!selectedOrder && /\b(?:doosra|dusra|second|2nd|2)\b/i.test(lower) && activeOrderUpdate.multipleOrders[1]) {
                    selectedOrder = activeOrderUpdate.multipleOrders[1];
                }

                if (selectedOrder) {
                    const { getDbClient } = await import('../db/client.js');
                    const prisma = getDbClient();
                    const targetOrder = await prisma.order.findFirst({
                        where: { id: selectedOrder.id },
                        include: { order_items: true, customer: true },
                    });

                    if (targetOrder) {
                        const itemsStr = (targetOrder.order_items || []).map(i => `${i.quantity}x ${i.item_name_snapshot || i.deal_name_snapshot || 'Item'}${i.variant_name_snapshot ? ' (' + i.variant_name_snapshot + ')' : ''}`).join(', ') || 'Food items';

                        const newUpdate = {
                            orderId: targetOrder.id,
                            orderNumber: targetOrder.order_number,
                            originalName: targetOrder.customer_name,
                            originalAddress: targetOrder.delivery_address,
                            originalPhone: targetOrder.phone,
                            originalPaymentMethod: targetOrder.payment_method,
                            total: Number(targetOrder.total),
                            itemsSummary: itemsStr,
                            pendingChanges: {},
                            awaitingField: 'address',
                            timestamp: Date.now(),
                        };
                        setPendingOrderUpdate(userSessionId, newUpdate, cleanPhone);

                        return {
                            handled: true,
                            routeName: 'fast_order_selected',
                            reply: `Theek hai Ji! Aap ka order (*#${targetOrder.order_number}*) select ho gaya hai. 🍕\n\nIs order ka naya delivery address kya rakhna chahenge? Baraye meherbani apna naya address (ya WhatsApp Location Pin) bhej dein taake update note kar sakein. 📍`,
                        };
                    }
                }
            }

            // Check if user is asking to change address or name (prompt request)
            if (/\b(?:address\s*(?:change|badal|update|theek|sahi|galat)|change\s*ad(?:d)?re(?:e)?s(?:s)?|ad(?:d)?re(?:e)?s(?:s)?\s*(?:change|badal|badalna|karna|krna)|pichl[aeiy]+\s*order\s*ka\s*ad(?:d)?re(?:e)?s(?:s)?)\b/i.test(lower)) {
                activeOrderUpdate.awaitingField = 'address';
                activeOrderUpdate.timestamp = Date.now();
                setPendingOrderUpdate(userSessionId, activeOrderUpdate, cleanPhone);
                return {
                    handled: true,
                    routeName: 'fast_order_update_prompt_address',
                    reply: `Koi masla nahi Ji! Aap ke order (*#${activeOrderUpdate.orderNumber}*) ka naya delivery address kya rakhna chahenge? Baraye meherbani apna naya mukammal delivery address (ya WhatsApp Location Pin) yahan likh kar bhej dein taake hum update kar dein! 📍`,
                };
            }

            if (/\b(?:naam|name)\s*(?:change|badal|update|badalna|karna|krna)\b/i.test(lower) && !/\b(?:karke|kr\s*k|rakh|likh|kar\s*do|kr\s*do|kardo|krdo)\b/i.test(lower)) {
                activeOrderUpdate.awaitingField = 'name';
                activeOrderUpdate.timestamp = Date.now();
                setPendingOrderUpdate(userSessionId, activeOrderUpdate, cleanPhone);
                return {
                    handled: true,
                    routeName: 'fast_order_update_prompt_name',
                    reply: `Koi masla nahi Ji! Aap ke order (*#${activeOrderUpdate.orderNumber}*) ke liye naya naam kya rakhna chahenge? Baraye meherbani apna naya naam likh kar bhej dein taake hum update kar dein! 😊`,
                };
            }

            let hasNewChange = false;
            const newChanges = { ...activeOrderUpdate.pendingChanges };

            // Check if name is in message
            const extracted = extractCustomerDetails(raw, { name: activeOrderUpdate.pendingChanges.name || activeOrderUpdate.originalName });
            if (extracted.name && extracted.name.toLowerCase() !== (activeOrderUpdate.originalName || '').toLowerCase()) {
                newChanges.name = extracted.name;
                hasNewChange = true;
                activeOrderUpdate.awaitingField = null;
            } else if (activeOrderUpdate.awaitingField === 'name' && !extracted.name) {
                const rawNameCandidate = raw.trim().replace(/^(?:mera\s+naam|naam|name|apna\s+naam)\s*[:=-]?\s*/i, '').trim();
                if (rawNameCandidate.length >= 2 && rawNameCandidate.length <= 30 && !NOT_NAME_REGEX.test(rawNameCandidate)) {
                    newChanges.name = rawNameCandidate.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
                    hasNewChange = true;
                    activeOrderUpdate.awaitingField = null;
                }
            }

            // Check if address is in message
            const { extractLocationFromText } = await import('../../utils/location.js');
            const loc = extractLocationFromText(raw);
            const explicitAddrMatch = extracted.address;
            const cleanedAddr = cleanExtractedAddress(raw);
            const hasAddressSignal = ADDRESS_INDICATORS.test(lower) || /\b(?:gali|street|house|makan|flat|block|road|chowk|chok|pul|pull|pool|colony|scheme|market|plaza|sector|phase|town|near|nearby|dakhana|stop)\b/i.test(lower);

            if (loc?.latitude != null && loc?.longitude != null) {
                newChanges.location = loc;
                newChanges.address = loc.mapUrl || `https://www.google.com/maps?q=${loc.latitude},${loc.longitude}`;
                hasNewChange = true;
                activeOrderUpdate.awaitingField = null;
            } else if (explicitAddrMatch) {
                newChanges.address = formatAddressTitle(explicitAddrMatch);
                newChanges.location = null;
                hasNewChange = true;
                activeOrderUpdate.awaitingField = null;
            } else if ((activeOrderUpdate.awaitingField === 'address' || (!extracted.name && hasAddressSignal)) && cleanedAddr && cleanedAddr.length >= 3 && !/^(?:order|change|update|address|naam|name|pichla|purana|confirm|haan|nahi)[\s.!?]*$/i.test(cleanedAddr)) {
                newChanges.address = formatAddressTitle(cleanedAddr);
                newChanges.location = null;
                hasNewChange = true;
                activeOrderUpdate.awaitingField = null;
            }

            // Check if phone is in message
            if (extracted.phone && extracted.phone !== 'SAME_WHATSAPP') {
                newChanges.phone = extracted.phone;
                hasNewChange = true;
            }

            // Check if payment is in message
            if (extracted.paymentMethod) {
                newChanges.paymentMethod = extracted.paymentMethod;
                hasNewChange = true;
            }

            if (hasNewChange) {
                activeOrderUpdate.pendingChanges = newChanges;
                activeOrderUpdate.timestamp = Date.now();
                setPendingOrderUpdate(userSessionId, activeOrderUpdate, cleanPhone);

                return {
                    handled: true,
                    routeName: 'fast_order_update_staged',
                    reply: buildOrderUpdateConfirmationCard(activeOrderUpdate),
                };
            }
        }



        // Sub-case 3: Customer inquires about current/previous order details (e.g. "Purany order ka adress kia ha ab?", "Order status kya hai?")
        const isOrderInquiry = /\b(?:puran[aeiy]+|pichl[aeiy]+|mera|previous|last)\s*(?:order|oder)?\s*(?:ka\s*)?(?:ad(?:d)?re(?:e)?s(?:s)?|pata|location|status|name|naam|details|detail|bill|total)\b/i.test(lower) ||
            /\b(?:order|oder)\s*(?:ka\s*)?(?:ad(?:d)?re(?:e)?s(?:s)?|pata|location|status|name|naam)\s*(?:kia|kya|kahan|kidhar)\b/i.test(lower) ||
            /\b(?:mera\s+order\s*(?:kahan|kidhar|status))\b/i.test(lower);

        if (isOrderInquiry && !hasCartOrOrderAction) {
            const allActive = await getCustomerActiveOrders();
            const explicitMatch = lower.match(/(?:#?CC-?(\d{1,6})|\border\s*#?\s*(\d{1,6})\b)/i);

            if (allActive.length > 1 && !explicitMatch && !/\b(?:pichl[aeiy]+|puran[aeiy]+|last|aakhri|recent|latest)\b/i.test(lower)) {
                const listText = allActive.map((ord, idx) => {
                    const itemsStr = (ord.order_items || []).map(i => `${i.quantity}x ${i.item_name_snapshot || i.deal_name_snapshot || 'Item'}${i.variant_name_snapshot ? ' (' + i.variant_name_snapshot + ')' : ''}`).join(', ') || 'Food items';
                    return `*${idx + 1}. Order #${ord.order_number}* (${ord.order_status})\n   • Delivery Address: *${ord.delivery_address || 'Registered Address'}*\n   • Items: ${itemsStr}\n   • Total Bill: Rs. ${Number(ord.total).toLocaleString('en-PK')}`;
                }).join('\n\n');

                return {
                    handled: true,
                    routeName: 'fast_order_status_inquiry_multiple',
                    reply: `Aap ke is waqt ${allActive.length} active orders chal rahe hain:\n\n${listText}\n\nAgar kisi specific order ki details change karni hon to order number ke sath batayein (jaise *"${allActive[0].order_number} ka address badal do"*). 😊`,
                };
            }

            const targetOrder = await findCustomerTargetOrder();
            if (targetOrder?.isRecentInactive) {
                const ord = targetOrder.order;
                const statusDesc = ord.order_status === 'DELIVERED' ? 'Deliver ho chuka hai' :
                                   ord.order_status === 'CANCELLED' ? 'Cancel ho chuka hai' : ord.order_status;
                return {
                    handled: true,
                    routeName: 'fast_order_status_inquiry_inactive',
                    reply: `Ji! Aap ka pichla order (*#${ord.order_number}*) ${statusDesc.toLowerCase()}. Naya order place karne ke liye hamara 'menu' ya 'deals' dekh kar order de sakte hain! 😊`,
                };
            }

            if (targetOrder && !targetOrder.isMultiple) {
                const statusDesc = targetOrder.order_status === 'CONFIRMED' ? 'Bhatti mein taiyar ho raha hai' :
                                   targetOrder.order_status === 'PREPARING' ? 'Kitchen mein taiyar ho raha hai' :
                                   targetOrder.order_status === 'READY' ? 'Taiyar ho chuka hai' :
                                   targetOrder.order_status === 'OUT_FOR_DELIVERY' ? 'Rider delivery ke liye nikal chuka hai' :
                                   targetOrder.order_status === 'DELIVERED' ? 'Deliver ho chuka hai' :
                                   targetOrder.order_status === 'CANCELLED' ? 'Cancel ho chuka hai' : targetOrder.order_status;

                const itemsStr = (targetOrder.order_items || []).map(i => `${i.quantity}x ${i.item_name_snapshot || i.deal_name_snapshot || 'Item'}${i.variant_name_snapshot ? ' (' + i.variant_name_snapshot + ')' : ''}`).join(', ') || 'Food items';

                return {
                    handled: true,
                    routeName: 'fast_order_status_inquiry',
                    reply: `Ji ${targetOrder.customer_name ? targetOrder.customer_name + ' bhai!' : 'Ji!'} Aap ke order (*#${targetOrder.order_number}*) ki current details ye hain:\n\n• Status: *${targetOrder.order_status}* (${statusDesc})\n• Delivery Address: *${targetOrder.delivery_address || 'Registered Address'}*\n• Customer Name: *${targetOrder.customer_name}*\n• Contact Phone: *${formatPakistaniPhone(targetOrder.phone)}*\n• Items: ${itemsStr}\n• Total Bill: *Rs. ${Number(targetOrder.total).toLocaleString('en-PK')}* (${targetOrder.payment_method === 'COD' ? 'Cash on Delivery' : 'EasyPaisa'})\n\nAgar is mein kuch change karwana ho to batayein! 😊`,
                };
            }
        }

        // Sub-case 4: Customer initiates an order update request
        let cartForUpdateCheck = null;
        try {
            const { getActiveCart } = await import('./cartService.js');
            const cache = await getCatalogCache();
            cartForUpdateCheck = await getActiveCart({ sessionKey: userSessionId, restaurantId: cache.restId, chatId });
        } catch (_) {}

        const hasActiveCartItems = Boolean(cartForUpdateCheck?.items && cartForUpdateCheck.items.length > 0);
        const isExplicitPreviousOrder = /\b(?:pichl[aeiy]+|puran[aeiy]+|last|previous|confirmed?)(?:\s+wal[aeiy]+)?\s*(?:order|oder)?\b/i.test(lower);
        const hasOrderUpdatePhrase = /\b(?:order|oder)\s*(?:mein|me|mai|pe|par|per|ko)?(?:\s+(?:kuch|yeh|ye|cheez|bhi|koi))*\s*(?:update|change|badal|sahi|theek)\b/i.test(lower) ||
            /\b(?:update|change|badal)\s*(?:kr\s*do|kar\s*do|kardo|krdo|krna|karna|karein)?\s*(?:pichl[aeiy]+|puran[aeiy]+|last|previous)\s*(?:order|oder)?\b/i.test(lower);
        const hasOrderNumberAndField = /(?:#?CC-?\d{1,6}|\border\s*#?\s*\d{1,6}\b)/i.test(lower) && /\b(?:ad(?:d)?re(?:e)?s(?:s)?|pata|location|naam|name|number|phone)\b/i.test(lower);
        const isGenericChangeIntent = hasOrderNumberAndField || hasOrderUpdatePhrase ||
            /\b(?:address\s*(?:change|badal|update|theek|sahi|galat|ghalat)|change\s*ad(?:d)?re(?:e)?s(?:s)?|ad(?:d)?re(?:e)?s(?:s)?\s*(?:change|theek|sahi|galat|ghalat)|ad(?:d)?re(?:e)?s(?:s)?\s*(?:nahi|ni)\s*hai|wrong\s*ad(?:d)?re(?:e)?s(?:s)?|galat\s*ad(?:d)?re(?:e)?s(?:s)?|ghalat\s*ad(?:d)?re(?:e)?s(?:s)?|naya\s*ad(?:d)?re(?:e)?s(?:s)?)\b/i.test(lower) ||
            /\b(?:naam|name)\s*(?:bhi\s*)?(?:change|badal|update)\b/i.test(lower) ||
            /\b(?:number|phone)\s*(?:bhi\s*)?(?:change|badal|update)\b/i.test(lower) ||
            /\b(?:order|oder)\s*(?:update|change|badal)\b/i.test(lower);

        if ((isExplicitPreviousOrder || hasOrderUpdatePhrase || hasOrderNumberAndField || (!hasActiveCartItems && isGenericChangeIntent)) && userSessionId) {
            const targetOrder = await findCustomerTargetOrder();

            if (targetOrder?.isRecentInactive) {
                const ord = targetOrder.order;
                if (ord.order_status === 'DELIVERED') {
                    return {
                        handled: true,
                        routeName: 'fast_order_update_already_delivered',
                        reply: `Aap ka pichla order (*#${ord.order_number}*) deliver ho chuka hai, is liye is mein tabdeeli nahi ho sakti. 😊\n\nAgar naya order place karna chahte hain to 'menu' ya 'deals' likhein!`,
                    };
                }
                if (ord.order_status === 'CANCELLED') {
                    return {
                        handled: true,
                        routeName: 'fast_order_update_already_cancelled',
                        reply: `Aap ka pichla order (*#${ord.order_number}*) cancel ho chuka hai. Agar naya order place karna chahte hain to 'menu' ya 'deals' likhein! 😊`,
                    };
                }
            }

            if (!targetOrder) {
                return {
                    handled: true,
                    routeName: 'fast_order_update_no_active_order',
                    reply: `Aap ka koi active order nahi mila jise update kiya ja sake. 😊\n\nAgar naya order place karna chahte hain to 'menu' ya 'deals' likhein!`,
                };
            }

            if (targetOrder?.isMultiple) {
                const listText = targetOrder.orders.map((ord, idx) => {
                    const itms = (ord.order_items || []).map(i => `${i.quantity}x ${i.item_name_snapshot || i.deal_name_snapshot || 'Item'}`).join(', ');
                    return `*${idx + 1}. Order #${ord.order_number}* (${ord.order_status})\n   • Items: ${itms}\n   • Total: Rs. ${Number(ord.total).toLocaleString('en-PK')}\n   • Address: *${ord.delivery_address || 'Registered Address'}*`;
                }).join('\n\n');

                const multiDraft = {
                    awaitingOrderSelection: true,
                    multipleOrders: targetOrder.orders.map(o => ({ id: o.id, order_number: o.order_number, total: Number(o.total) })),
                    timestamp: Date.now(),
                };
                setPendingOrderUpdate(userSessionId, multiDraft, cleanPhone);

                return {
                    handled: true,
                    routeName: 'fast_order_update_select_order',
                    reply: `Aap ke is waqt ${targetOrder.orders.length} active orders chal rahe hain:\n\n${listText}\n\nAap kis order ki details update karna chahte hain? Baraye meherbani order number bata dein (jaise *${targetOrder.orders[0].order_number}* ya sirf *${targetOrder.orders[0].order_number.replace(/^CC-0*/, '')}*). 😊`,
                };
            }

            if (targetOrder && !targetOrder.isMultiple && !targetOrder.isRecentInactive) {
                const itemsStr = (targetOrder.order_items || []).map(i => `${i.quantity}x ${i.item_name_snapshot || i.deal_name_snapshot || 'Item'}${i.variant_name_snapshot ? ' (' + i.variant_name_snapshot + ')' : ''}`).join(', ') || 'Food items';

                const newUpdate = {
                    orderId: targetOrder.id,
                    orderNumber: targetOrder.order_number,
                    originalName: targetOrder.customer_name,
                    originalAddress: targetOrder.delivery_address,
                    originalPhone: targetOrder.phone,
                    originalPaymentMethod: targetOrder.payment_method,
                    total: Number(targetOrder.total),
                    itemsSummary: itemsStr,
                    pendingChanges: {},
                    awaitingField: null,
                    timestamp: Date.now(),
                };

                const extracted = extractCustomerDetails(raw, { name: targetOrder.customer_name });
                const { extractLocationFromText } = await import('../../utils/location.js');
                const loc = extractLocationFromText(raw);
                const explicitAddrMatch = extracted.address;
                const cleanedAddr = cleanExtractedAddress(raw);
                const hasAddressSignal = ADDRESS_INDICATORS.test(lower) || /\b(?:gali|street|house|makan|flat|block|road|chowk|chok|pul|pull|pool|colony|scheme|market|plaza|sector|phase|town|near|nearby|dakhana|stop)\b/i.test(lower);

                if (extracted.name && extracted.name.toLowerCase() !== targetOrder.customer_name.toLowerCase()) {
                    newUpdate.pendingChanges.name = extracted.name;
                }
                if (loc?.latitude != null && loc?.longitude != null) {
                    newUpdate.pendingChanges.location = loc;
                    newUpdate.pendingChanges.address = loc.mapUrl || `https://www.google.com/maps?q=${loc.latitude},${loc.longitude}`;
                } else if (explicitAddrMatch) {
                    newUpdate.pendingChanges.address = formatAddressTitle(explicitAddrMatch);
                } else if (!extracted.name && hasAddressSignal && cleanedAddr && cleanedAddr.length >= 3 && !/^(?:order|change|update|address|naam|name|pichla|purana)[\s.!?]*$/i.test(cleanedAddr)) {
                    newUpdate.pendingChanges.address = formatAddressTitle(cleanedAddr);
                }
                if (extracted.phone && extracted.phone !== 'SAME_WHATSAPP') {
                    newUpdate.pendingChanges.phone = extracted.phone;
                }
                if (extracted.paymentMethod) {
                    newUpdate.pendingChanges.paymentMethod = extracted.paymentMethod;
                }

                setPendingOrderUpdate(userSessionId, newUpdate, cleanPhone);

                if (Object.keys(newUpdate.pendingChanges).length > 0) {
                    return {
                        handled: true,
                        routeName: 'fast_order_update_staged',
                        reply: buildOrderUpdateConfirmationCard(newUpdate),
                    };
                }

                if (/address|pata|location/i.test(lower)) {
                    newUpdate.awaitingField = 'address';
                    setPendingOrderUpdate(userSessionId, newUpdate, cleanPhone);
                    return {
                        handled: true,
                        routeName: 'fast_order_update_prompt_address',
                        reply: `Koi masla nahi Ji! Aap ke order (*#${newUpdate.orderNumber}*) ka naya delivery address kya rakhna chahenge? Baraye meherbani apna naya mukammal delivery address (ya WhatsApp Location Pin) yahan likh kar bhej dein taake hum update kar dein! 📍`,
                    };
                }

                if (/naam|name/i.test(lower)) {
                    newUpdate.awaitingField = 'name';
                    setPendingOrderUpdate(userSessionId, newUpdate, cleanPhone);
                    return {
                        handled: true,
                        routeName: 'fast_order_update_prompt_name',
                        reply: `Koi masla nahi Ji! Aap ke order (*#${newUpdate.orderNumber}*) ke liye naya naam kya rakhna chahenge? Baraye meherbani apna naya naam likh kar bhej dein taake hum update kar dein! 😊`,
                    };
                }

                return {
                    handled: true,
                    routeName: 'fast_order_update_prompt_generic',
                    reply: `Ji ${targetOrder.customer_name ? targetOrder.customer_name + ' bhai!' : 'Ji!'} Aap ke active order (*#${newUpdate.orderNumber}*) mein kya change karwana chahte hain?\n\n(Aap Delivery Address, Contact Phone, Customer Name ya Payment Method update karwa sakte hain) 📍`,
                };
            }
        }
    } catch (err) {
        console.error('[FAST_ROUTE] Error processing placed order update:', err.message);
    }

    // ── Check Fast Route: Location Confirmation Response ("Haan" / "Nahi") ──
    if (userSessionId) {
        try {
            const { getSessionOrderDetails, updateSessionOrderDetails } = await import('./sessionService.js');
            const cleanPhone = (whatsappPhone || '').replace(/\D/g, '');
            const currDetails = getSessionOrderDetails(userSessionId, cleanPhone);

            if (currDetails?.locationAwaitingConfirmation) {
                const isAffirmativeLocation = /^(?:(?:g|jee?|ji|haan?|han|hn|yes|yep|ok|okay|sahi|theek|thk)\s+)?(?:g|jee?|ji|haan?|han|hn|yes|yep|theek\s*hai?|theek\s*hy|ok|okay|done|confirm|bilkul|zaroor|yahi|yehi|wahi|isi\s*(?:location|jagah|par|pe)?|isi\s*pe|yahi\s*(?:hai|location|ha|jagah|h)|yehi\s*(?:hai|location|ha|jagah|h))[\s.!?]*$/i.test(lower.trim());
                const isNegativeLocation = /^(?:nahi|nahin|na|no|nope|wrong|galat|ghalat|ye\s*nahi|yahan\s*nahi)[\s.!?]*$/i.test(lower.trim());

                if (isAffirmativeLocation) {
                    currDetails.locationConfirmed = true;
                    currDetails.locationAwaitingConfirmation = false;
                    updateSessionOrderDetails(userSessionId, {
                        locationConfirmed: true,
                        locationAwaitingConfirmation: false,
                    }, cleanPhone);

                    const { getActiveCart } = await import('./cartService.js');
                    const cache = await getCatalogCache();
                    const cart = await getActiveCart({ sessionKey: userSessionId, restaurantId: cache.restId, chatId });
                    if (cart?.items && cart.items.length > 0) {
                        return await getNextCheckoutStepResponse({
                            details: currDetails,
                            whatsappPhone,
                            cart,
                            cache,
                        });
                    }
                } else if (isNegativeLocation) {
                    currDetails.location = null;
                    currDetails.address = null;
                    currDetails.locationConfirmed = false;
                    currDetails.locationAwaitingConfirmation = false;
                    updateSessionOrderDetails(userSessionId, { location: null, address: null, locationConfirmed: false, locationAwaitingConfirmation: false }, cleanPhone);
                    return {
                        handled: true,
                        routeName: 'step_location_rejected',
                        reply: `Koi masla nahi ${currDetails.name ? currDetails.name + ' bhai! ' : ''}Baraye meherbani apna sahi delivery address ya WhatsApp location pin dobara bhej dein taake hum note kar sakein. 📍`,
                    };
                }
            }
        } catch (_) {}
    }

    // ── Check Fast Route: Extra Items Response ("Nhi", "Nahi bss yehi kr do", "kch nhi", etc.) ──
    const isNoExtraItems = /^(?:(?:na?h?i?n?|no|nope)\s+)?(?:(?:aur\s+)?k(?:u)?ch\s*(?:aur\s*)?na?h?i?n?|nothing(?:\s+else)?|no\s+thanks|rehn(?:e)?\s*do|itna\s*hi|(?:bs+|bas|sirf)\s*(?:y[ae]hi|itna\s*hi)?)(?:\s*(?:chahi?ye|kr?\s*do|kar\s*do|kardo|karo|bhai|shukriya|thanks|h|hai))?[\s.!?]*$|^(?:na?h?i?n?|no|nope|k(?:u)?ch\s*na?h?i?n?|bs+|bas|rehn(?:e)?\s*do)[\s.!?]*$/i.test(lower.trim());
    if (isNoExtraItems && userSessionId) {
        try {
            const { getSessionOrderDetails, updateSessionOrderDetails } = await import('./sessionService.js');
            const cleanPhone = (whatsappPhone || '').replace(/\D/g, '');
            const currDetails = getSessionOrderDetails(userSessionId, cleanPhone);

            // If customer has selected payment method (or address/location exists)
            if (currDetails?.paymentMethod || currDetails?.address || currDetails?.location) {
                currDetails.extraItemsAnswered = true;
                currDetails.extraItemsInquired = true;
                currDetails.phoneConfirmed = true; // Lock phone confirmation so it never loops back
                updateSessionOrderDetails(userSessionId, { extraItemsAnswered: true, extraItemsInquired: true, phoneConfirmed: true }, cleanPhone);

                const { getActiveCart } = await import('./cartService.js');
                const cache = await getCatalogCache();
                const cart = await getActiveCart({ sessionKey: userSessionId, restaurantId: cache.restId, chatId });
                if (cart?.items && cart.items.length > 0) {
                    return await getNextCheckoutStepResponse({
                        details: currDetails,
                        whatsappPhone,
                        cart,
                        cache,
                    });
                }
            }
        } catch (err) {
            console.error('[FAST_ROUTE] Error processing no extra items response:', err.message);
        }
    }

    const hasCartModification = /\b(add|extra|change|badal|hatao?|nikal|kam|zyada|\d+\s*x|\d+\s*bar|\d+\s*martaba|fries|drink|pepsi|7up|coke|deal|deals)\b/i.test(lower);
    const hasNegation = /\b(nahi|nahin|na|no|mat|cancel|rok|ruko|galat|wrong|hatao|nhi)\b/i.test(lower);
    // NOTE: 'aur', 'kuch', 'pizza', 'burger' removed from cart-modification list above because they appear in confirmation phrases
    //       like 'nahi aur kch nahi' — hasCartModification must only fire on true add/modify signals.
    const isOrderFinalConfirmation = !hasCartModification && !hasNegation &&
        /^(?:(?:jee?|ji|g)\s+)?(?:haan|han|hn|yes|yep|theek\s*hai?|thk\s*hai?|ok|okay|bilkul|zaroor|zarur|done)?(?:\s*(?:order|book)?\s*(?:co?n?f[iy]?r[mn]+|comfirm|konfirm|book|final|done|bhej\s*do|theek\s*hai|ok|yes|haan|han|jee|ji|bilkul))(?:\s+(?:book|co?n?f[iy]?r[mn]+|kar\s*do|kr\s*do|kardo|krdo|karo|kro|kar\s*du|kr\s*du|karein|kar\s*dein|kr\s*dein|hai|h|please|bhai|do))*$/i.test(lower.trim()) && wordCount <= 6;
    if (isOrderFinalConfirmation && userSessionId) {
        try {
            const { getSessionOrderDetails, clearSessionOrderDetails } = await import('./sessionService.js');
            const cleanPhone = (whatsappPhone || '').replace(/\D/g, '');
            const details = getSessionOrderDetails(userSessionId, cleanPhone);

            // Guard: Do not confirm order if customer has not yet confirmed their phone number
            const isWaitingForPhone = Boolean(details?.name && !details?.phoneConfirmed);
            if (isWaitingForPhone) {
                // Let isPhoneAffirmativeWhenAwaiting below handle this affirmative response!
            } else {
                const { getActiveCart } = await import('./cartService.js');
                const cache = await getCatalogCache();
                const cart = await getActiveCart({ sessionKey: userSessionId, restaurantId: cache.restId, chatId });
                const readyToConfirm = Boolean(details.name && (details.address || details.location) && (details.paymentMethod || 'COD') && details.phoneConfirmed);
                if (cart?.items && cart.items.length > 0 && (details.awaitingFinalConfirmation || readyToConfirm) && !details.locationAwaitingConfirmation && details.phoneConfirmed) {
                    const finalPayment = details.paymentMethod || 'COD';
                    const { createOrder } = await import('./orderService.js');
                    const res = await createOrder({
                        restaurantId: cache.restId,
                        sessionKey: userSessionId,
                        customerName: details.name || 'Customer',
                        phone: details.phone || cleanPhone,
                        delivery: {
                            address: details.address || details.location?.address || (details.location?.latitude ? `Google Maps Location Pin: https://www.google.com/maps?q=${details.location.latitude},${details.location.longitude}` : 'Google Maps Location Pin'),
                            latitude: details.location?.latitude ?? null,
                            longitude: details.location?.longitude ?? null,
                        },
                        paymentMethod: finalPayment,
                        sock,
                    });
                    const orderNum = res.order?.orderNumber || res.order?.order_number;
                    const total = Number(res.order?.pricing?.total ?? res.order?.total ?? 0);
                    const discountTotal = Number(res.order?.pricing?.discountTotal ?? res.order?.discount_total ?? 0);
                    if (orderNum) {
                        clearSessionOrderDetails(userSessionId, cleanPhone);
                        _lastDiscussedDealBySession.delete(userSessionId);
                        const customerName = details.name ? details.name.trim() : 'Customer';
                        const discountMsg = discountTotal > 0 ? `\nDiscount Applied: -Rs. ${discountTotal.toLocaleString('en-PK')}` : '';
                        return {
                            handled: true,
                            routeName: 'fast_order_confirm',
                            reply: `${customerName} bhai, aap ka order successfully confirm ho gaya hai!\nOrder Number: ${orderNum}${discountMsg}\nOrder Total: Rs. ${total.toLocaleString('en-PK')}\nPayment: ${finalPayment === 'COD' ? 'Cash on Delivery (COD)' : 'EasyPaisa'}\n\nAap ka order Cravey Crust ki team ko bhej diya gaya hai. Shukriya, aur mazay se khana enjoy karein!`,
                        };
                    }
                } else if (cart?.items && cart.items.length > 0) {
                    // Customer said "confirm / confirm kr do" but details are not yet complete: start checkout!
                    return await getNextCheckoutStepResponse({
                        details,
                        whatsappPhone,
                        cart,
                        cache,
                    });
                }
            }
        } catch (err) {
            console.error('[FAST_ROUTE] Error booking confirmed order:', err.message);
            const userFriendlyMsg = (err.code === 'DELIVERY_ADDRESS_REQUIRED' || /delivery address|location pin/i.test(err.message))
                ? 'Baraye meherbani delivery ke liye apna mukammal address ya WhatsApp location pin bhej dein taake hum aap ka order book kar sakein! 📍'
                : 'Maazrat! Aap ka order is waqt process nahi ho saka. Baraye meherbani thori der baad dobara koshish karein ya human support se rabta karein.';
            return {
                handled: true,
                routeName: 'fast_order_confirm_failed',
                reply: userFriendlyMsg,
            };
        }
    }

    // ── Check Fast Route: Customer Explicitly Requests to Use Previous/Saved Details (Zero Tokens) ──
    const isExplicitUsePreviousDetails =
        /\b(?:pichli|purani|previous|old)\s*(?:wali\s*)?(?:details?|detail|address|location|pata|number|info)?\s*(?:pe|par|per|hi|theek|sahi|use|rakho|bhej|bhejo|daal|kardo|kar\s*do|kr\s*do|krdo|place|confirm|lagado|laga\s*do)\b/i.test(lower) ||
        /\b(?:use|bhej|send|confirm|kar\s*do|kr\s*do|kardo|krdo|place)\s*(?:my\s+)?(?:old|previous|purani|pichli)\s*(?:details?|detail|address|info)\b/i.test(lower) ||
        /\b(?:same|yehi|yahi|wahi)\s*(?:wali\s*)?(?:details?|detail|address|location|pata|jagah)\s*(?:pe|par|per|rakho|use|bhej|kardo|kar\s*do|kr\s*do|krdo|place|confirm)?\b/i.test(lower);

    if (isExplicitUsePreviousDetails && userSessionId) {
        try {
            const { getActiveCart } = await import('./cartService.js');
            const cache = await getCatalogCache();
            const cart = await getActiveCart({ sessionKey: userSessionId, restaurantId: cache.restId, chatId });
            if (cart?.items && cart.items.length > 0) {
                const { getRememberedCustomerDetails, updateSessionOrderDetails } = await import('./sessionService.js');
                const cleanPhone = (whatsappPhone || '').replace(/\D/g, '');
                const remembered = await getRememberedCustomerDetails(userSessionId, cleanPhone);

                if (remembered?.name && remembered?.address) {
                    const updatePayload = {
                        name: remembered.name,
                        phone: remembered.phone || cleanPhone,
                        phoneConfirmed: true,
                        address: remembered.address,
                        paymentMethod: remembered.paymentMethod || 'COD',
                        previousDetailsConfirmed: true,
                    };
                    const details = updateSessionOrderDetails(userSessionId, updatePayload, cleanPhone);
                    return await getNextCheckoutStepResponse({
                        details,
                        whatsappPhone,
                        cart,
                        cache,
                        introMessage: `Theek hai ${details.name} bhai! Aap ki pichli details note kar li hain.`,
                    });
                }
            }
        } catch (err) {
            console.error('[FAST_ROUTE] Error processing explicit use previous details:', err.message);
        }
    }

    // ── Check Fast Route: Checkout Request (Zero Tokens) ──
    const isCheckoutRequest = /^(?:(?:haan|han|jee|ji|g|ok|okay)?\s*(?:checkout|check\s*out|continue|proceed|next|aage\s*(?:chalo|barho)|done\s*ordering|place\s*order|order\s*(?:karna\s*hai|karwana\s*hai|krna\s*hai|krwana\s*hai|book\s*karna\s*hai|book\s*krna\s*hai|please|karein|kar\s*dein|kr\s*dein|karo|kro|krdo|kardo)|book\s*(?:karna\s*hai|krna\s*hai|karo|kro|krdo|kardo))(?:\s+(?:karo|kro|krdo|kardo|kar\s*do|kr\s*do|karein|kar\s*dein|kr\s*dein|please|bhai))?)$/i.test(lower.trim());
    if (isCheckoutRequest && userSessionId) {
        try {
            const { getActiveCart } = await import('./cartService.js');
            const cache = await getCatalogCache();
            const cart = await getActiveCart({ sessionKey: userSessionId, restaurantId: cache.restId, chatId });
            if (!cart?.items || cart.items.length === 0) {
                return {
                    handled: true,
                    routeName: 'fast_checkout_empty_cart',
                    reply: 'Aap ka cart abhi khali hai. Pehle menu ya deals dekh kar item add karein!',
                };
            }
            const { getSessionOrderDetails } = await import('./sessionService.js');
            const cleanPhone = (whatsappPhone || '').replace(/\D/g, '');
            const details = getSessionOrderDetails(userSessionId, cleanPhone);
            return await getNextCheckoutStepResponse({
                details,
                whatsappPhone,
                cart,
                cache,
            });
        } catch (err) {
            console.error('[FAST_ROUTE] Error processing checkout request:', err.message);
        }
    }

    // ── Check Fast Follow-up: Flavour specification for pending Pizza Deal (Zero Tokens) ──
    const pendingFlavour = userSessionId ? getPendingDealFlavour(userSessionId) : null;
    if (pendingFlavour && (isFlavourResponse(lower) || extractFlavoursFromText(lower).length > 0)) {
        const d = pendingFlavour.deal;
        const pizzaInfo = pendingFlavour.pizzaInfo || getDealPizzaInfo(d);
        const extracted = extractFlavoursFromText(lower, pizzaInfo.pizzaCount);
        if (extracted.length > 0) {
            clearPendingDealFlavour(userSessionId);
            _lastDiscussedDealBySession.delete(userSessionId);

            const flavourNotes = formatFlavourNotes(extracted);
            const { getActiveCart, addToCart } = await import('./cartService.js');
            const cache = await getCatalogCache();
            const qty = pendingFlavour.quantity || 1;

            await addToCart({
                sessionKey: userSessionId,
                restaurantId: cache.restId,
                chatId,
                verifiedPhone: whatsappPhone,
                dealId: d.id,
                quantity: qty,
                notes: flavourNotes,
            });

            const dealName = d.name;
            const dealPrice = Number(d.deal_price) * qty;
            const { getSessionOrderDetails } = await import('./sessionService.js');
            const cleanPhone = (whatsappPhone || '').replace(/\D/g, '');
            const details = getSessionOrderDetails(userSessionId, cleanPhone);
            const cartNow = await getActiveCart({ sessionKey: userSessionId, restaurantId: cache.restId, chatId });

            return await getNextCheckoutStepResponse({
                details,
                whatsappPhone,
                cart: cartNow,
                cache,
                introMessage: `Zabardast! *${dealName}* (*${flavourNotes}*) cart mein add kar di gayi hai! 🎉\n• ${qty}x ${dealName} (${flavourNotes}) — Rs. ${dealPrice}`,
            });
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
                    const pizzaInfo = getDealPizzaInfo(d);
                    const extracted = pizzaInfo.isPizzaDeal ? extractFlavoursFromText(lower, pizzaInfo.pizzaCount) : [];

                    if (pizzaInfo.isPizzaDeal && extracted.length === 0) {
                        setPendingDealFlavour(userSessionId, {
                            deal: d,
                            quantity: 1,
                            pizzaInfo,
                        });
                        return {
                            handled: true,
                            routeName: 'deal_flavour_prompt',
                            reply: formatDealFlavourPrompt(d, pizzaInfo),
                        };
                    }

                    const flavourNotes = extracted.length > 0 ? formatFlavourNotes(extracted) : undefined;
                    await addToCart({
                        sessionKey: userSessionId,
                        restaurantId: cache.restId,
                        chatId,
                        verifiedPhone: whatsappPhone,
                        dealId: d.id,
                        quantity: 1,
                        notes: flavourNotes,
                    });
                    _lastDiscussedDealBySession.delete(userSessionId);
                    clearPendingDealFlavour(userSessionId);

                    const dealName = d.name;
                    const dealDesc = flavourNotes ? ` (${flavourNotes})` : (d.description ? ` (${d.description})` : '');
                    const dealPrice = Number(d.deal_price);

                    const { getSessionOrderDetails } = await import('./sessionService.js');
                    const cleanPhone = (whatsappPhone || '').replace(/\D/g, '');
                    const details = getSessionOrderDetails(userSessionId, cleanPhone);
                    const cartNow = await getActiveCart({ sessionKey: userSessionId, restaurantId: cache.restId, chatId });

                    return await getNextCheckoutStepResponse({
                        details,
                        whatsappPhone,
                        cart: cartNow,
                        cache,
                        introMessage: `Zabardast! *${dealName}* cart mein add ho gayi hai! 🎉\n• 1x ${dealName}${dealDesc} — Rs. ${dealPrice}`,
                    });
                }
            } catch (err) {
                console.error('[FAST_ROUTE] Error adding confirmed deal:', err.message);
            }
        }
    }

        // ── Check Direct Deal Order (Zero Tokens, e.g. "pizza meal for 3 krdo", "zinger deal 4 kr do", "deal 1 kr do") ──
    const ACTION_SUFFIX_REGEX = /\s+(?:kr\s*d[ao]|kar\s*d[ao]|kardo|krdo|krdu|kardu|kar\s*dein|kr\s*dein|karden|kar\s*dain|kr\s*dain|chahiye|mangwana|pack\s*karo|pack\s*krdo|bhejo|bhej\s*do|order|laga\s*do)$/i;
    const PREFIX_STRIP_REGEX = /^(?:order|add|daal\s*do|bhej\s*do|mujhe|mjhy|humein|humey)\s+/i;
    const isDealOrderCandidate = /\b((?:burger|zinger)\s*(?:meal|deal)\s*(?:#|no\.?)?\s*(?:for\s*)?[1-5]|pi[z]+a\s*(?:meal|deal)\s*(?:#|no\.?)?\s*(?:for\s*)?[1-5]|deal\s*#?\s*[1-5])\b/i.test(lower);
    const isDealInquiryCandidate = /\b(?:(?:kya|kia|kay)\s*(?:kya|kia|kay)?\s*(?:h|ha|hai|hay|hy|hega)|detail|details|shamil|includes?|items?|batao|bataiye|dikhao|info)\b/i.test(lower);

    if (isDealOrderCandidate && !isDealInquiryCandidate && userSessionId) {
        let cleanDealText = lower.trim().replace(PREFIX_STRIP_REGEX, '').replace(ACTION_SUFFIX_REGEX, '');
        let dealQty = 1;
        const qtyMatch = cleanDealText.match(/^(\d+)\s*(?:x\s+)?(.+)$/i);
        if (qtyMatch) {
            dealQty = parseInt(qtyMatch[1], 10);
            cleanDealText = qtyMatch[2].trim();
        }

        const dealMatch = cleanDealText.match(/^((?:burger|zinger)\s*(?:meal|deal)\s*(?:#|no\.?)?\s*(?:for\s*)?[1-5]|pi[z]+a\s*(?:meal|deal)\s*(?:#|no\.?)?\s*(?:for\s*)?[1-5]|deal\s*#?\s*[1-5])(?:\s+(.+))?$/i);
        if (dealMatch) {
            try {
                const cache = await getCatalogCache();
                const rawDeals = cache.rawDeals || [];
                let queryNorm = dealMatch[1].replace(/#|\s+/g, '').replace(/piza/gi, 'pizza').toLowerCase();

                const wantsBurgerOrZinger = /\b(?:burger|zinger|zegy)\b/i.test(lower);
                const wantsPizza = /\b(?:pizza|piza)\b/i.test(lower);

                const bMealMatch = queryNorm.match(/(?:burger|zinger)(?:deal|meal)(?:for)?([1-5])/);
                if (bMealMatch) {
                    const num = parseInt(bMealMatch[1], 10);
                    if (num >= 4) {
                        queryNorm = `deal${num}`;
                    } else {
                        queryNorm = `burgermealfor${num}`;
                    }
                }
                const pMealMatch = queryNorm.match(/pizza(?:deal|meal)(?:for)?([1-5])/);
                if (pMealMatch) {
                    queryNorm = `pizzamealfor${pMealMatch[1]}`;
                }

                let candidateDeals = rawDeals;
                if (wantsBurgerOrZinger && !wantsPizza) {
                    candidateDeals = rawDeals.filter(d => {
                        const dName = (d.name || '').toLowerCase();
                        const itemsText = (d.deal_items || []).map(di => di.menu_item?.name || '').join(' ').toLowerCase();
                        const desc = (d.description || '').toLowerCase();
                        const combined = `${dName} ${itemsText} ${desc}`;
                        const hasBurgerItem = /\b(?:burger|zinger|zegy|chicken\s*piece|crispy)\b/i.test(combined);
                        const hasPizzaItem = /\b(?:pizza|piza|crust)\b/i.test(combined);
                        return hasBurgerItem && !hasPizzaItem;
                    });
                } else if (wantsPizza && !wantsBurgerOrZinger) {
                    candidateDeals = rawDeals.filter(d => {
                        const dName = (d.name || '').toLowerCase();
                        const itemsText = (d.deal_items || []).map(di => di.menu_item?.name || '').join(' ').toLowerCase();
                        const desc = (d.description || '').toLowerCase();
                        const combined = `${dName} ${itemsText} ${desc}`;
                        return /\b(?:pizza|piza|crust)\b/i.test(combined);
                    });
                }

                const matchedDeal = candidateDeals.find(d => {
                    const dNorm = (d.name || '').replace(/#|\s+/g, '').toLowerCase();
                    return dNorm.includes(queryNorm) || queryNorm.includes(dNorm);
                }) || rawDeals.find(d => {
                    const dNorm = (d.name || '').replace(/#|\s+/g, '').toLowerCase();
                    return dNorm.includes(queryNorm) || queryNorm.includes(dNorm);
                });

                if (matchedDeal) {
                    const pizzaInfo = getDealPizzaInfo(matchedDeal);
                    const flavourCandidate = (dealMatch[2] || '').trim();
                    const extracted = pizzaInfo.isPizzaDeal ? extractFlavoursFromText(flavourCandidate || lower, pizzaInfo.pizzaCount) : [];

                    if (pizzaInfo.isPizzaDeal && extracted.length === 0) {
                        setPendingDealFlavour(userSessionId, {
                            deal: matchedDeal,
                            quantity: dealQty,
                            pizzaInfo,
                        });
                        return {
                            handled: true,
                            routeName: 'deal_flavour_prompt',
                            reply: formatDealFlavourPrompt(matchedDeal, pizzaInfo),
                        };
                    }

                    const flavourNotes = extracted.length > 0 ? formatFlavourNotes(extracted) : undefined;
                    const { getActiveCart, addToCart } = await import('./cartService.js');
                    await addToCart({
                        sessionKey: userSessionId,
                        restaurantId: cache.restId,
                        chatId,
                        verifiedPhone: whatsappPhone,
                        dealId: matchedDeal.id,
                        quantity: dealQty,
                        notes: flavourNotes,
                    });

                    _lastDiscussedDealBySession.delete(userSessionId);
                    clearPendingDealFlavour(userSessionId);

                    const dealName = matchedDeal.name;
                    const dealDesc = flavourNotes ? ` (${flavourNotes})` : (matchedDeal.description ? ` (${matchedDeal.description})` : '');
                    const dealPrice = Number(matchedDeal.deal_price) * dealQty;

                    const { getSessionOrderDetails } = await import('./sessionService.js');
                    const cleanPhone = (whatsappPhone || '').replace(/\D/g, '');
                    const details = getSessionOrderDetails(userSessionId, cleanPhone);
                    const cartNow = await getActiveCart({ sessionKey: userSessionId, restaurantId: cache.restId, chatId });

                    return await getNextCheckoutStepResponse({
                        details,
                        whatsappPhone,
                        cart: cartNow,
                        cache,
                        introMessage: `Zabardast! *${dealName}* cart mein add kar di gayi hai! 🎉\n• ${dealQty > 1 ? `${dealQty}x ` : ''}${dealName}${dealDesc} — Rs. ${dealPrice}`,
                    });
                }
            } catch (err) {
                console.error('[FAST_ROUTE] Error processing direct deal order:', err.message);
            }
        }
    }

// ── Check Fast Follow-up: Size specification for last discussed pizza / item (Zero Tokens) ──
    const isSizeFollowup = /^(?:small|smal|medium|medum|med|large|larg|lrg|party(?:b?\s*size)?|partyb?size|regular|reg|chota|chhota|bara|bada)(?:\s*(?:kr\s*do|kardo|kar\s*do|kr\s*du|kar\s*du|kar\s*dein|karden|chahiye|mangwana|rakh\s*do|bhai|wala|wali|size))?$/i.test(lower.trim());
    if (isSizeFollowup && userSessionId && _lastDiscussedItemBySession.has(userSessionId)) {
        const lastItemEntry = _lastDiscussedItemBySession.get(userSessionId);
        if (lastItemEntry && (Date.now() - lastItemEntry.timestamp < 300 * 1000)) {
            try {
                const { getActiveCart, addItemToCart, matchVariant } = await import('./cartService.js');
                const cache = await getCatalogCache();
                const item = lastItemEntry.item;
                const matchedVariant = matchVariant(item.variants, lower);

                if (matchedVariant) {
                    await addItemToCart({
                        sessionKey: userSessionId,
                        restaurantId: cache.restId,
                        chatId,
                        verifiedPhone: whatsappPhone,
                        menuItemId: item.id,
                        variantId: matchedVariant.id,
                        quantity: 1,
                    });
                    _lastDiscussedItemBySession.delete(userSessionId);

                    const itemName = item.name;
                    const variantName = matchedVariant.name;
                    const price = Number(matchedVariant.price);

                    const { calculateDiscount, getGlobalDiscountSettings } = await import('./discountService.js');
                    const globalDiscount = await getGlobalDiscountSettings(cache.restId).catch(() => null);
                    const disc = calculateDiscount(matchedVariant.price, matchedVariant.discount_percent ?? item.discount_percent, matchedVariant.discount_fixed ?? item.discount_fixed, globalDiscount);
                    const pDisplay = disc.hasDiscount ? `~Rs. ${price}~ Rs. ${disc.discountedPrice}` : `Rs. ${price}`;

                    const { getSessionOrderDetails } = await import('./sessionService.js');
                    const cleanPhone = (whatsappPhone || '').replace(/\D/g, '');
                    const details = getSessionOrderDetails(userSessionId, cleanPhone);
                    const cartNow = await getActiveCart({ sessionKey: userSessionId, restaurantId: cache.restId, chatId });

                    return await getNextCheckoutStepResponse({
                        details,
                        whatsappPhone,
                        cart: cartNow,
                        cache,
                        introMessage: `Zabardast! *${itemName} (${variantName})* cart mein add kar diya gaya hai! 🎉 (${pDisplay})`,
                    });
                }
            } catch (err) {
                console.error('[FAST_ROUTE] Error adding size-selected item:', err.message);
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
                        CANCELLED: 'Cancel ho chuka hai',
                    }[recentOrder.order_status] || 'Process ho raha hai';

                    let closingLine = 'Cravey Crust ka lazeez khana jald aap tak pahunch jayega! Shukriya!';
                    if (recentOrder.order_status === 'CANCELLED') {
                        closingLine = 'Yeh order cancel ho chuka hai. Agar aap dobara kuch mangwana chahein to \'menu\' ya \'deals\' likh kar bhej dein! 😊';
                    } else if (recentOrder.order_status === 'DELIVERED') {
                        closingLine = 'Umeed hai aap ne khana enjoy kiya hoga! Cravey Crust se shopping karne ka shukriya! 😊';
                    }

                    return {
                        handled: true,
                        routeName: 'order_status_check',
                        reply: `Assalam o Alaikum ${recentOrder.customer_name || 'Ji'}! Aap ka order *#${recentOrder.order_number}* ${statusUrdu}!\n\n💰 Total Bill: *Rs. ${Number(recentOrder.total)}* (${recentOrder.payment_method})\n📍 Delivery Address: ${recentOrder.delivery_address || 'Provided pin'}\n\n${closingLine}`,
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
                const { calculatePricing } = await import('./pricingService.js');
                const itemsForPricing = (cart.items || []).filter(i => i.menu_item_id).map(i => ({
                    menuItemId: i.menu_item_id,
                    variantId: i.menu_variant_id || undefined,
                    quantity: i.quantity,
                }));
                const dealsForPricing = (cart.items || []).filter(i => i.deal_id).map(i => ({
                    dealId: i.deal_id,
                    quantity: i.quantity,
                }));
                const pricing = await calculatePricing({
                    restaurantId: cache.restId,
                    items: itemsForPricing,
                    deals: dealsForPricing,
                }).catch(() => null);

                let itemsList = '';
                let billText = '';
                if (pricing) {
                    const lines = [];
                    for (const it of (pricing.breakdown.items || [])) {
                        const v = it.variantName ? ` (${it.variantName})` : '';
                        if (it.hasDiscount) {
                            lines.push(`• ${it.quantity}x ${it.name}${v} — ~Rs. ${it.originalLineTotal.toLocaleString('en-PK')}~ *Rs. ${it.lineTotal.toLocaleString('en-PK')}* (${it.discountLabel || (it.discountPercent + '% OFF')})`);
                        } else {
                            lines.push(`• ${it.quantity}x ${it.name}${v} — Rs. ${it.lineTotal.toLocaleString('en-PK')}`);
                        }
                    }
                    for (const d of (pricing.breakdown.deals || [])) {
                        const raw = cart?.items?.find(ci => ci.deal_id === d.dealId);
                        const notes = d.notes || raw?.notes;
                        const fText = notes ? ` (${notes})` : '';
                        lines.push(`• ${d.quantity}x ${d.name}${fText} — Rs. ${d.lineTotal.toLocaleString('en-PK')}`);
                    }
                    itemsList = lines.join('\n');
                    if (pricing.discountTotal > 0) {
                        billText = `Ji, aap ke cart ka subtotal *Rs. ${pricing.subtotal.toLocaleString('en-PK')}* hai, aur *Rs. ${pricing.discountTotal.toLocaleString('en-PK')}* discount ke baad total *Rs. ${pricing.total.toLocaleString('en-PK')}* bana hai. 🎉`;
                    } else {
                        billText = `Ji, aap ke cart ka subtotal *Rs. ${pricing.subtotal.toLocaleString('en-PK')}* bana hai.`;
                    }
                } else {
                    itemsList = cart.items.map(i => {
                        const n = i.deal ? i.deal.name : (i.menu_item?.name || 'Item');
                        const v = i.menu_variant ? ` (${i.menu_variant.name})` : '';
                        const fText = i.notes ? ` (${i.notes})` : '';
                        const p = Number(i.deal?.deal_price ?? i.menu_variant?.price ?? i.menu_item?.base_price ?? i.unit_price ?? 0) * i.quantity;
                        return `• ${i.quantity}x ${n}${v}${fText} — Rs. ${p}`;
                    }).join('\n');
                    const rawSubtotal = cart.items.reduce((s, i) => s + Number(i.deal?.deal_price ?? i.menu_variant?.price ?? i.menu_item?.base_price ?? i.unit_price ?? 0) * i.quantity, 0);
                    billText = `Ji, aap ke cart ka subtotal *Rs. ${rawSubtotal.toLocaleString('en-PK')}* bana hai.`;
                }

                return await getNextCheckoutStepResponse({
                    details,
                    whatsappPhone,
                    cart,
                    cache,
                    introMessage: `${billText}\n\n📋 *Items:*\n${itemsList}`,
                });
            }
        } catch (err) {
            console.error('[FAST_ROUTE] Error checking order status:', err.message);
        }
    }

    // ── Check Explicit Detail Change Inquiries without new values (Zero Tokens) ──
    if (userSessionId && !hasCartOrOrderAction) {
        try {
            const { getSessionOrderDetails } = await import('./sessionService.js');
            const cleanPhone = (whatsappPhone || '').replace(/\D/g, '');
            const curr = getSessionOrderDetails(userSessionId, cleanPhone);

            const isNameChangeOnly = /\b(?:naam|name|nam)\s*(?:change|badal|update)\s*(?:krna|karna|kr\s*do|kar\s*do|karo|hai|h)?\b/i.test(lower) && wordCount <= 6;
            const isAddrChangeOnly = /\b(?:ad(?:d)?re(?:e)?s(?:s)?|location|pata|jagah)\s*(?:change|badal|update|galat|theek\s*nahi)\b/i.test(lower) && wordCount <= 6;
            const isPhoneChangeOnly = /\b(?:number|numbr|no|phone|rabta)\s*(?:change|badal|update|galat|theek\s*nahi)\b/i.test(lower) && wordCount <= 6;
            const isPaymentChangeOnly = /\b(?:payment|adaigi|paise)\s*(?:method\s*)?(?:change|badal|update)\b/i.test(lower) && wordCount <= 6;

            const preCheck = extractCustomerDetails(raw, curr);
            if (isNameChangeOnly && !preCheck.name) {
                return {
                    handled: true,
                    routeName: 'request_name_change',
                    reply: `Koi masla nahi Ji! Naya naam kya rakhna chahenge? Baraye meherbani apna naya naam bata dein taake hum update kar dein. 😊`,
                };
            }
            if (isAddrChangeOnly && !preCheck.address) {
                return {
                    handled: true,
                    routeName: 'request_address_change',
                    reply: `Koi masla nahi ${curr.name ? curr.name + ' bhai! ' : ''}Naya delivery address kya rakhna chahenge? Baraye meherbani apna naya mukammal delivery address (ya WhatsApp location pin) bhej dein taake hum update kar dein. 📍`,
                };
            }
            if (isPhoneChangeOnly && !preCheck.phone) {
                return {
                    handled: true,
                    routeName: 'request_phone_change',
                    reply: `Koi masla nahi ${curr.name ? curr.name + ' bhai! ' : ''}Rider ke rabtay ke liye naya phone number likh kar bhej dein taake hum update kar dein. 📞`,
                };
            }
            if (isPaymentChangeOnly && !preCheck.paymentMethod) {
                return {
                    handled: true,
                    routeName: 'request_payment_change',
                    reply: `Koi masla nahi ${curr.name ? curr.name + ' bhai! ' : ''}Payment method kaunsa pasand karenge — *Cash on Delivery (COD)* ya *EasyPaisa*? 💵`,
                };
            }
        } catch (_) {}
    }

    // ── Check Delivery Area / Coverage Inquiries (Zero Tokens) ──
    if (isDeliveryAreaInquiry(raw)) {
        try {
            const { getSessionOrderDetails, updateSessionOrderDetails } = await import('./sessionService.js');
            const cleanPhone = (whatsappPhone || '').replace(/\D/g, '');
            const currDetails = userSessionId ? getSessionOrderDetails(userSessionId, cleanPhone) : {};
            const cache = await getCatalogCache();
            const restId = cache?.restId || (await (await import('./restaurantService.js')).getDefaultRestaurantId());
            const configuredRadius = cache?.maxDeliveryRadiusKm || 10;

            const isGeneralInquiry = /\b(?:kahan\s*kahan|kidhar\s*kidhar|kahan\s*(?:pe\s*)?delivery|delivery\s*(?:kahan|kidhar)|kis\s*kis\s*area|kon\s*kon\s*se\s*areas?|which\s*areas?|delivery\s*areas?|coverage\s*areas?|approved\s*areas?|areas?\s*(?:kia|kya|list)|areas?\s*batao|areas?\s*bhejo)\b/i.test(lower);

            if (isGeneralInquiry) {
                return {
                    handled: true,
                    routeName: 'delivery_areas_list',
                    reply: `Hamari delivery restaurant se *${configuredRadius} KM* circular radius ke andar in tamam approved areas mein dastiyab hai: 🚚\n\n` +
                           `• *Ghauri Town* (All Phases & VIP Block)\n` +
                           `• *Khana Pull* & Sanam Chowk\n` +
                           `• *Tarlai* & Taramari\n` +
                           `• *Burma* & Shakral\n` +
                           `• *Rehman Enclave*\n` +
                           `• *Madina Town* & Bilal Town\n` +
                           `• *Gulberg Green* & Gulzar-e-Quaid\n\n` +
                           `Agar aapka delivery address in areas mein hai to baraye meherbani apna mukammal address ya WhatsApp location pin bhej dein! 📍`,
                };
            }

            let targetAddr = null;
            let targetLat = null;
            let targetLng = null;

            // Check if user provided GPS pin/link in this message
            const { extractLocationFromText } = await import('../../utils/location.js');
            const loc = extractLocationFromText(raw);
            if (loc?.latitude != null && loc?.longitude != null) {
                targetLat = loc.latitude;
                targetLng = loc.longitude;
            } else {
                const withoutQuestions = raw.replace(/[?.,!]/g, ' ');
                const cleanedCandidate = withoutQuestions
                    .replace(/\b(?:delivery|deliver|allowed|allow|area|areas|range|zone|mein|me|mai|pe|par|aati|aata|ata|ati|hoti|hota|hogi|hoga|krte|karte|krty|karty|karoge|karogy|possible|available|hai|he|hy|h|kya|kia|ye|yeh|is|idhar|yahan)\b/gi, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();
                if (cleanedCandidate && cleanedCandidate.length >= 3 && ADDRESS_INDICATORS.test(cleanedCandidate)) {
                    targetAddr = cleanedCandidate;
                }
            }

            // Fallback to session address ONLY if user explicitly asks about their previous address
            if (!targetAddr && targetLat == null && /\b(?:meri|mera|apni|yehi|yahi|wahi|previous|pichla|address)\b/i.test(lower)) {
                targetAddr = currDetails.address || currDetails.location?.address;
                targetLat = currDetails.location?.latitude;
                targetLng = currDetails.location?.longitude;
            }

            if (targetAddr || targetLat != null) {
                const { checkDeliveryAvailability } = await import('./deliveryService.js');
                const dCheck = await checkDeliveryAvailability({
                    restaurantId: restId,
                    address: targetAddr,
                    latitude: targetLat,
                    longitude: targetLng,
                });

                const displayLoc = targetAddr || (targetLat ? `[Google Maps Pin](https://www.google.com/maps?q=${targetLat},${targetLng})` : 'Aap ki location');

                if (dCheck.available) {
                    const distInfo = dCheck.distanceKm != null ? ` (approx. ${dCheck.distanceKm} km door)` : '';
                    let cart = null;
                    if (userSessionId) {
                        try {
                            const { getActiveCart } = await import('./cartService.js');
                            cart = await getActiveCart({ sessionKey: userSessionId, restaurantId: restId, chatId });
                        } catch (_) {}
                    }
                    const hasCartItems = cart?.items && cart.items.length > 0;

                    if (hasCartItems) {
                        let reply = `Ji bilkul ${currDetails.name ? currDetails.name + ' bhai! ' : ''}Aap ki location (*${displayLoc}*) hamari delivery range mein aati hai${distInfo}. 👍\n\n`;
                        if (!currDetails.paymentMethod) {
                            reply += `Payment method kaunsa pasand karenge — *Cash on Delivery (COD)* ya *EasyPaisa*? 💵`;
                        } else {
                            reply += `Order confirm karne ke liye “Confirm” ya “Haan” likhein!`;
                        }
                        return {
                            handled: true,
                            routeName: 'delivery_area_confirmed',
                            reply,
                        };
                    } else {
                        const feeInfo = dCheck.deliveryFee === 0 ? 'delivery bilkul FREE hai' : `delivery fee Rs. ${dCheck.deliveryFee} hai`;
                        const maxR = dCheck.maxRadiusKm || cache?.maxDeliveryRadiusKm || 10;
                        return {
                            handled: true,
                            routeName: 'delivery_area_inquiry_allowed',
                            reply: `Ji bilkul! Cravey Crust *${displayLoc}* mein delivery provide karta hai! 🚚\n(Yeh hamare restaurant se ${dCheck.distanceKm ? `approx. ${dCheck.distanceKm} km door hai aur hamari ${maxR} KM delivery range ke andar hai` : `hamari ${maxR} KM range mein hai`} — ${feeInfo}).\n\nAap aaj kya mangwana chahenge? Menu dekhne ke liye 'menu' ya deals dekhne ke liye 'deals' likhein!`,
                        };
                    }
                } else {
                    if (userSessionId && currDetails.address) {
                        updateSessionOrderDetails(userSessionId, { address: null, location: null }, cleanPhone);
                    }
                    return {
                        handled: true,
                        routeName: 'delivery_area_denied',
                        reply: `${dCheck.message}\n\nAgar pin bhejne mein masla ho ya aap bahar hon, to aap apna Islamabad / Rawalpindi ka delivery address text mein bhi likh kar bhej sakte hain (jaise *Ghauri Town Phase 5, Street 12*). 📍`,
                    };
                }
            } else {
                const configuredRadius = cache?.maxDeliveryRadiusKm || 10;
                return {
                    handled: true,
                    routeName: 'delivery_general_inquiry',
                    reply: `Ji bilkul! Cravey Crust hamare restaurant se ${configuredRadius} KM circular radius ke andar delivery provide karta hai. 🚚\n\nBaraye meherbani apna delivery address ya WhatsApp location pin share karein taake hum aapki delivery confirm kar sakein! 📍`,
                };
            }
        } catch (err) {
            console.error('[FAST_ROUTE] Error processing delivery area inquiry:', err.message);
        }
    }

    // ── Check Customer Multi-Field Checkout Input (Name, Address, Payment, Phone) during active cart (Zero Tokens) ──
    if (userSessionId && !hasCartOrOrderAction) {
        try {
            const { getActiveCart } = await import('./cartService.js');
            const cache = await getCatalogCache();
            const cart = await getActiveCart({ sessionKey: userSessionId, restaurantId: cache.restId, chatId });
            if (cart?.items && cart.items.length > 0) {
                const { updateSessionOrderDetails, getSessionOrderDetails } = await import('./sessionService.js');
                const cleanPhone = (whatsappPhone || '').replace(/\D/g, '');
                const currDetails = getSessionOrderDetails(userSessionId, cleanPhone);

                // Guard: if phone already confirmed or extraItemsAnswered — skip re-triggering those steps
                const isPhoneConfirmation = (currDetails.name && !currDetails.phoneConfirmed) &&
                    /^(?:(?:g|ji|jee|haan?|han|hn|yes|theek\s*(?:hai|hy)?|ok|done)\s*)?(?:same|same\s*number|same\s*whatsapp|yahi|yehi|wahi|isi\s*pe|yahi\s*hai|yehi\s*hai|yahi\s*number|yehi\s*number|isi\s*number|haan|han|hn|ji|jee|g|yes|theek\s*hai|theek\s*hy|ok|done)\s*(?:hi\s*)?(?:number|no|whatsapp|contact)?\s*(?:pe|par|per)?\s*(?:hoga|hogi|rahyga|rahega|rhega|ryga|rahy\s*ga|rahe\s*ga|rakh\s*lo|rakh\s*do|rakho|rakhein|rehn\s*do|rehne\s*do|dedo|de\s*do|likh\s*do|likh\s*lo|daal\s*do|kar\s*do|kr\s*do|karo|kro|bhej\s*do|bhejo|rabta\s*karein|rabta|rider\s*ko\s*de\s*do|rider\s*ko\s*dedo|theek\s*(?:hai|hy)?|hai|he|hy|yar|bhai)?[\s.!?]*$/i.test(lower.trim());

                const extracted = extractCustomerDetails(raw, currDetails);
                const updatePayload = {};
                let isNameUpdated = false;
                let isAddressUpdated = false;
                let isPaymentUpdated = false;
                let isPhoneUpdated = false;

                if (extracted.name) {
                    if (!currDetails.name) {
                        updatePayload.name = extracted.name;
                    } else if (extracted.nameExplicit) {
                        const isExplicitRename = /\b(?:badal|change|update|ab\s+(?:mera\s+)?naam|mera\s+naam|my\s+name\s+is|name\s+is)\b/i.test(raw);
                        if (isExplicitRename && extracted.name.toLowerCase() !== currDetails.name.toLowerCase()) {
                            updatePayload.name = extracted.name;
                            isNameUpdated = true;
                        }
                    }
                }

                if (extracted.address && (!currDetails.address || extracted.address.toLowerCase() !== currDetails.address.toLowerCase())) {
                    const { extractLocationFromText } = await import('../../utils/location.js');
                    const loc = extractLocationFromText(raw);

                    // VALIDATE DELIVERY RADIUS BEFORE SAVING ADDRESS
                    const { checkDeliveryAvailability } = await import('./deliveryService.js');
                    const delCheck = await checkDeliveryAvailability({
                        restaurantId: cache?.restId,
                        address: extracted.address,
                        latitude: loc?.latitude,
                        longitude: loc?.longitude,
                    });

                    if (!delCheck.available) {
                        return {
                            handled: true,
                            routeName: 'address_out_of_range',
                            reply: `${delCheck.message}\n\nBaraye meherbani koi doosra delivery address ya WhatsApp location pin bhej dein jo hamari delivery range mein ho. 📍`,
                        };
                    }

                    if (loc?.latitude != null && loc?.longitude != null) {
                        updatePayload.location = loc;
                        updatePayload.address = loc.mapUrl || `https://www.google.com/maps?q=${loc.latitude},${loc.longitude}`;
                        updatePayload.locationConfirmed = true;
                        updatePayload.locationAwaitingConfirmation = false;
                    } else {
                        updatePayload.address = extracted.address;
                        updatePayload.location = null;
                        updatePayload.locationConfirmed = true;
                        updatePayload.locationAwaitingConfirmation = false;
                    }
                    if (delCheck.distanceKm != null) {
                        updatePayload.distanceKm = delCheck.distanceKm;
                    }
                    isAddressUpdated = Boolean(currDetails.address || currDetails.location);
                }

                if (extracted.paymentMethod && (!currDetails.paymentMethod || extracted.paymentMethod !== currDetails.paymentMethod)) {
                    updatePayload.paymentMethod = extracted.paymentMethod;
                    isPaymentUpdated = Boolean(currDetails.paymentMethod);
                }

                if (extracted.phone && (!currDetails.phone || extracted.phone !== currDetails.phone || !currDetails.phoneConfirmed)) {
                    updatePayload.phone = extracted.phone === 'SAME_WHATSAPP' ? cleanPhone : extracted.phone;
                    updatePayload.phoneConfirmed = true;
                    isPhoneUpdated = Boolean(currDetails.phone && currDetails.phoneConfirmed);
                } else if (isPhoneConfirmation && (!currDetails.phoneConfirmed || !currDetails.phone)) {
                    updatePayload.phone = cleanPhone;
                    updatePayload.phoneConfirmed = true;
                }

                // If customer provided an invalid phone number format, inform them immediately
                if (extracted.invalidPhone) {
                    if (Object.keys(updatePayload).length > 0) {
                        updateSessionOrderDetails(userSessionId, updatePayload, cleanPhone);
                    }
                    return {
                        handled: true,
                        routeName: 'invalid_phone_provided',
                        reply: `Aap ka diya gaya contact number (*${extracted.invalidPhone}*) theek nahi hai. ❌\n\nBaraye meherbani 11-digit ka sahi Pakistani mobile number dein (jaise *03XXXXXXXXX*). 📞`,
                    };
                }

                // Only proceed if at least one detail was actually updated to prevent repeat loops
                if (Object.keys(updatePayload).length > 0) {
                    const details = updateSessionOrderDetails(userSessionId, updatePayload, cleanPhone);

                    if (updatePayload.name) {
                        try {
                            const { updateCustomerNameForChat } = await import('./chatService.js');
                            updateCustomerNameForChat({
                                chatId: userSessionId,
                                phone: cleanPhone,
                                customerName: updatePayload.name,
                            }).catch(() => {});
                        } catch (_) {}
                    }

                    let introMessage = '';
                    if (isNameUpdated) {
                        introMessage = `Theek hai ${updatePayload.name} bhai! Aap ka naam update kar diya hai (*${updatePayload.name}*). 😊`;
                    } else if (isAddressUpdated) {
                        const distSuffix = updatePayload.distanceKm != null ? ` (delivery range mein available hai - approx. ${updatePayload.distanceKm} km)` : '';
                        introMessage = `Theek hai ${details.name ? details.name + ' bhai! ' : ''}Delivery address update kar diya hai (*${updatePayload.address}*)${distSuffix}. 📍`;
                    } else if (isPaymentUpdated) {
                        introMessage = `Theek hai ${details.name ? details.name + ' bhai! ' : ''}Payment method update kar diya hai (*${updatePayload.paymentMethod === 'COD' ? 'Cash on Delivery (COD)' : 'EasyPaisa'}*). 💵`;
                    } else if (isPhoneUpdated) {
                        introMessage = `Theek hai ${details.name ? details.name + ' bhai! ' : ''}Contact number update kar diya hai (*${formatPakistaniPhone(updatePayload.phone)}*). 📞`;
                    } else if (updatePayload.locationAwaitingConfirmation) {
                        introMessage = '';
                    } else if (updatePayload.address) {
                        const distSuffix = updatePayload.distanceKm != null ? ` (delivery range mein available hai - approx. ${updatePayload.distanceKm} km)` : '';
                        introMessage = `Delivery address (*${updatePayload.address}*) note kar liya hai${distSuffix}. 📍`;
                    } else if (updatePayload.paymentMethod) {
                        introMessage = `Payment method (*${updatePayload.paymentMethod === 'COD' ? 'Cash on Delivery (COD)' : 'EasyPaisa'}*) note kar liya hai. 💵`;
                    } else if (updatePayload.phoneConfirmed) {
                        introMessage = `Theek hai ${details.name ? details.name + ' bhai! ' : ''}Contact number confirm ho gaya (${formatPakistaniPhone(details.phone || cleanPhone)}). 👍`;
                    } else if (updatePayload.name) {
                        introMessage = `Theek hai ${details.name} bhai! Aap ka naam note kar liya hai. 😊`;
                    } else {
                        introMessage = `Theek hai ${details.name ? details.name + ' Ji! ' : ''}Aap ki details note kar li hain.`;
                    }

                    return await getNextCheckoutStepResponse({
                        details,
                        whatsappPhone,
                        cart,
                        cache,
                        introMessage,
                    });
                }
            }
        } catch (err) {
            console.error('[FAST_ROUTE] Error processing customer checkout details:', err.message);
        }
    }

    // ── Check Customer Name Input during active cart checkout (Zero Tokens) ──
    const isQuestionName = raw.includes('?') || /\b(?:kya|kia|kab|kese|kaise|kahan|kidhar|kahin|konsa|konse|kyun|kyu|hai\?|he\?|h\?|btao|batao|dikhao|dekhao)\b/i.test(raw);
    const isGreetingName = FAST_GREETING_REGEX.test(raw.trim()) || /^(?:hlo|hlw|hy|helo|hellow|hi|hello|hey|salam|slam|assalam|aoa|assalamualaikum|suno|oye|yo)[\s.!?]*$/i.test(raw.trim());
    let nameCandidate = raw.replace(/^(?:my\s+name\s+is|name\s+is|mera\s+naam\s+(?:hai|h)?|naam\s+|name\s*(?:is|hai|h|ja)?\s*:?\s*)/i, '')
                           .replace(/(?:\s+(?:naam|name|hai|h|ja|mera))+$/i, '')
                           .trim();
    nameCandidate = nameCandidate.replace(/^(?:same|wahi|yahi|yehi|isi|naam|nam|mera|meara|apna|my\s+name\s+is|name\s+is|is|kr\s*du|kar\s*du)\s+/i, '').trim();
    nameCandidate = nameCandidate.replace(/\s+(?:bki|baqi|baki|sari|details|sab|same|ha|hai|h|he|hy).*$/i, '').trim();
    nameCandidate = nameCandidate.replace(/\s+(?:bhai|bhaiya|bhae|bro|sir|madam|khan|jee|ji)$/i, '').trim();
    const nameMatch = nameCandidate.match(/^([A-Za-z]{2,20}(?:\s+[A-Za-z]{2,20})?)$/i);
    const isActionOrStatusWord = /^(?:confirm|comfirm|konfirm|checkout|continue|proceed|next|book|booking|order|final|done|bill|billing|deliver|delivery|address|location|pin|yes|haan|han|jee|ji|theek|thk|ok|okay|no|nahi|nahii|nhi|nh|nai|na|menu|deal|deals|discount|discounts|riayat|sahi|shai|is|am|my|name)$/i.test(nameCandidate);
    const isNotNameCandidate = isQuestionName || isGreetingName || isActionOrStatusWord || NOT_NAME_REGEX.test(nameCandidate) || isFoodOrFlavorWord(nameCandidate) || /\b(hlo|hlw|hy|helo|hellow|hi|hello|hey|salam|slam|assalam|aoa|assalamualaikum|suno|oye|yo|confirm|comfirm|konfirm|checkout|continue|proceed|krdo|kardo|kar\s*do|kr\s*do|karo|kro|kar|kr|karna|krna|karein|chahiye|mangwao|mangwana|pack|parcel|send|bhej|bhejo|theek|thk|thek|done|ok|okk|okay|sure|yes|yup|yep|haan|han|hn|ha|g|ji|jee|no|nahi|nahii|nhi|nh|nai|na|mat|cancel|cancle|kansil|discount|discounts|riayat|payment|cod|cash|easypaisa|easy|paisa|delivery|address|location|pata|order|deal|deals|pizza|burger|menu|meny|menue|mainu|mainue|dikhao|dijhao|dikaho|dekhao|dikhayein|dikhana|dikha|btao|batao|bhejna|kase|kaise|kese|scene|hal|haal|rate|list|kya|kia|hy|hain|hen|dein|bhai|bhaiya|bhae|bhi|sain|sir|khan|bro|madam|food|water|drink|bill|kam|party|small|medium|large|reg|regular|can|liter|litre|1\.5l|1l|flavor|flavour|crust|cheese|extreme|extrme|chicken|peri|behari|tikka|fajita|supreme|tandoori|same|yahi|yehi|yehe|yhe|wahi|isi|number|numbr|num|hoo|ho|hu|hun|hoon|jigri|sahi|shai|is|my)\b/i.test(nameCandidate);
    if (nameMatch && !isNotNameCandidate && !isQuestionName && !isFoodOrFlavorWord(nameCandidate) && userSessionId && wordCount <= 4) {
        try {
            const { getActiveCart } = await import('./cartService.js');
            const cache = await getCatalogCache();
            const cart = await getActiveCart({ sessionKey: userSessionId, restaurantId: cache.restId, chatId });
            if (cart?.items && cart.items.length > 0) {
                const { getSessionOrderDetails, updateSessionOrderDetails } = await import('./sessionService.js');
                const cleanPhone = (whatsappPhone || '').replace(/\D/g, '');
                const details = getSessionOrderDetails(userSessionId, cleanPhone);
                // STRICT IMMUTABILITY: Bare string name extraction is ONLY for initial name entry when details.name is NOT set!
                // An already established name cannot be overwritten by random bare words!
                if (!details.name) {
                    const customerName = nameMatch[1].trim().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
                    updateSessionOrderDetails(userSessionId, { name: customerName }, cleanPhone);
                    const updated = getSessionOrderDetails(userSessionId, cleanPhone);

                    try {
                        const { updateCustomerNameForChat } = await import('./chatService.js');
                        updateCustomerNameForChat({
                            chatId: userSessionId,
                            phone: cleanPhone,
                            customerName: customerName,
                        }).catch(() => {});
                    } catch (_) {}

                    return await getNextCheckoutStepResponse({
                        details: updated,
                        whatsappPhone,
                        cart,
                        cache,
                        introMessage: `Shukriya *${customerName}*! Aap ka naam note kar liya hai. 😊`,
                    });
                }
            }
        } catch (_) {}
    }

    // ── Check Customer Phone Input / "Same Number" (Zero Tokens) ──
    const { getSessionOrderDetails: getDetailsForPhone } = await import('./sessionService.js');
    const existingDetailsForPhone = getDetailsForPhone(userSessionId, (whatsappPhone || '').replace(/\D/g, ''));
    const isPhoneAffirmativeWhenAwaiting = (existingDetailsForPhone?.name && !existingDetailsForPhone?.phoneConfirmed) && (
        /^(?:(?:haan?|g|ji|jee|yes|ok|theek\s*(?:hai|hy)?)\s*)?(?:same|yahi|yehi|yehe|yhe|wahi|isi\s*pe|yahi\s*hai|yehi\s*hai|isi\s*number|yehi\s*number|yahi\s*number|yehe\s*number|same\s*number|same\s*whatsapp|haan|han|hn|ji|jee|g|yes|theek\s*hai|theek\s*hy|ok|done)\s*(?:hi\s*)?(?:number|no|whatsapp|contact)?\s*(?:pe|par|per)?\s*(?:hoga|hogi|rahyga|rahega|rhega|ryga|rahy\s*ga|rahe\s*ga|rakh\s*lo|rakh\s*do|rakho|rakhein|rehn\s*do|rehne\s*do|dedo|de\s*do|likh\s*do|likh\s*lo|daal\s*do|kar\s*do|kr\s*do|karo|kro|bhej\s*do|bhejo|rabta\s*karein|rabta|rider\s*ko\s*de\s*do|rider\s*ko\s*dedo|theek\s*(?:hai|hy)?|hai|he|hy|yar|bhai)?[\s.!?]*$/i.test(lower.trim()) ||
        /\b(?:same|yahi|yehi|yehe|wahi|isi)\s*(?:hi\s*)?(?:number|no|whatsapp)?\s*(?:pe|par|per)?\s*(?:rahyga|rahega|rhega|ryga|rahy\s*ga|rahe\s*ga|hoga|rakh\s*lo|rakh\s*do|rakho|dedo|de\s*do|likh\s*do|likh\s*lo|bhej\s*do)\b/i.test(lower.trim()) ||
        /\b(?:btaya|bola|kaha)\s+to\s+h(?:ai|y)?.*(?:yehe|yehi|same|isi)\s+number\b/i.test(lower.trim())
    );
    const rawPhoneMatch = raw.replace(/[\s-]/g, '').match(/(?:03\d{9}|\+?923\d{9})/);
    const isSameNumber = isPhoneAffirmativeWhenAwaiting || /^(?:same\s*number|same|isi\s*number|yehi\s*number|yahi\s*number|yehe\s*number|same\s*whatsapp)(?:\s*(?:dedo|de\s*do|rakho|rakhein|hoga|hogi|yar|bhai))?$/i.test(lower.trim()) || !!rawPhoneMatch;

    const isPhoneNegativeWhenAwaiting = (existingDetailsForPhone?.name && !existingDetailsForPhone?.phoneConfirmed) &&
        /^(?:nahi|nahin|na|no|nope|change|badal\s*do|badlo|doosra\s*number|dusra\s*number|koi\s*aur\s*number|different\s*number)[\s.!?]*$/i.test(lower.trim()) && !rawPhoneMatch;

    if (isPhoneNegativeWhenAwaiting && userSessionId) {
        const customerName = existingDetailsForPhone.name ? existingDetailsForPhone.name.trim() : 'Customer';
        return {
            handled: true,
            routeName: 'awaiting_alternate_phone',
            step: 'PHONE',
            reply: `Theek hai ${customerName} bhai! Baraye meherbani rider ke rabtay ke liye apna 11-digit mobile number likh kar bhej dein (maslan: 03001234567). 📞`,
        };
    }

    if (isSameNumber && userSessionId) {
        try {
            const { getActiveCart } = await import('./cartService.js');
            const cache = await getCatalogCache();
            const cart = await getActiveCart({ sessionKey: userSessionId, restaurantId: cache.restId, chatId });
            if (cart?.items && cart.items.length > 0) {
                const { updateSessionOrderDetails } = await import('./sessionService.js');
                const cleanPhone = (whatsappPhone || '').replace(/\D/g, '');
                const targetPhone = rawPhoneMatch ? rawPhoneMatch[0].replace(/\D/g, '') : cleanPhone;
                const details = updateSessionOrderDetails(userSessionId, { phone: targetPhone, phoneConfirmed: true }, cleanPhone);

                return await getNextCheckoutStepResponse({
                    details,
                    whatsappPhone,
                    cart,
                    cache,
                    introMessage: `Theek hai ${details.name ? details.name + ' bhai! ' : ''}Contact number confirm ho gaya (${formatPakistaniPhone(targetPhone)}). 👍`,
                });
            }
        } catch (_) {}
    }

    // ── Check Customer Delivery Address when awaiting Step 3 (Zero Tokens) ──
    if (userSessionId && !hasCartOrOrderAction) {
        try {
            const { getSessionOrderDetails, updateSessionOrderDetails } = await import('./sessionService.js');
            const cleanPhone = (whatsappPhone || '').replace(/\D/g, '');
            const currDetails = getSessionOrderDetails(userSessionId, cleanPhone);

            // Active checkout awaiting address: Name & Phone are confirmed, Address is missing
            if (currDetails?.name && currDetails?.phoneConfirmed && !currDetails?.address && !currDetails?.location) {
                const isNotAddr = /^(?:menu|deals?|cancel|khatam|band|chahiye|kitne|price|rate|status|hi|hello|hey|suno|bhai)[\s.!?]*$/i.test(lower.trim());
                if (!isNotAddr && wordCount <= 25) {
                    const { extractLocationFromText } = await import('../../utils/location.js');
                    const loc = extractLocationFromText(raw);
                    const isPin = loc?.latitude != null && loc?.longitude != null;
                    const cleanedAddr = isPin ? (loc.mapUrl || `https://www.google.com/maps?q=${loc.latitude},${loc.longitude}`) : cleanExtractedAddress(raw);
                    if (cleanedAddr && cleanedAddr.length >= 3) {
                        const { checkDeliveryAvailability } = await import('./deliveryService.js');
                        const cache = await getCatalogCache();
                        const delCheck = await checkDeliveryAvailability({
                            restaurantId: cache?.restId,
                            address: isPin ? null : cleanedAddr,
                            latitude: loc?.latitude,
                            longitude: loc?.longitude,
                        });

                        if (!delCheck.available) {
                            return {
                                handled: true,
                                routeName: 'address_out_of_range',
                                reply: `${delCheck.message}\n\nBaraye meherbani koi doosra delivery address ya WhatsApp location pin bhej dein jo hamari delivery range mein ho. 📍`,
                            };
                        }

                        const { getActiveCart } = await import('./cartService.js');
                        const cart = await getActiveCart({ sessionKey: userSessionId, restaurantId: cache.restId, chatId });
                        if (cart?.items && cart.items.length > 0) {
                            const details = updateSessionOrderDetails(userSessionId, {
                                address: cleanedAddr,
                                location: loc,
                                locationConfirmed: true,
                                locationAwaitingConfirmation: false,
                            }, cleanPhone);
                            const distText = delCheck.distanceKm != null ? ` (approx. ${delCheck.distanceKm} km door)` : '';
                            return await getNextCheckoutStepResponse({
                                details,
                                whatsappPhone,
                                cart,
                                cache,
                                introMessage: isPin ? `Delivery location pin note kar li hai${distText}. 📍` : `Delivery address (*${cleanedAddr}*) note kar liya hai${distText}. 📍`,
                            });
                        }
                    } else if (raw.trim().length > 0 && raw.trim().length < 3) {
                        return {
                            handled: true,
                            routeName: 'step_address_clarification',
                            reply: `Baraye meherbani apna mukammal delivery address (area/street ya landmark, maslan: Khana Pull ya Ghauri Town) bhej dein taake rider asani se pohnch sake 📍`,
                        };
                    }
                }
            }
        } catch (err) {
            console.error('[FAST_ROUTE] Error processing step 3 address:', err.message);
        }
    }

    // ── Check Customer Payment Method when awaiting Step 4 (Zero Tokens) ──
    if (userSessionId && !hasCartOrOrderAction) {
        try {
            const { getSessionOrderDetails, updateSessionOrderDetails } = await import('./sessionService.js');
            const cleanPhone = (whatsappPhone || '').replace(/\D/g, '');
            const currDetails = getSessionOrderDetails(userSessionId, cleanPhone);

            if (currDetails?.name && currDetails?.phoneConfirmed && (currDetails?.address || currDetails?.location) && !currDetails?.paymentMethod) {
                let selectedPayment = null;
                if (/^(?:cod|cash|cash\s*on\s*delivery|1)[\s.!?]*$/i.test(lower.trim()) || /\b(?:cod|cash\s*on\s*delivery)\b/i.test(lower)) {
                    selectedPayment = 'COD';
                } else if (/^(?:easypaisa|easy\s*paisa|ep|2)[\s.!?]*$/i.test(lower.trim()) || /\b(?:easypaisa|easy\s*paisa|ep)\b/i.test(lower)) {
                    selectedPayment = 'EASYPAISA';
                }

                if (selectedPayment) {
                    const { getActiveCart } = await import('./cartService.js');
                    const cache = await getCatalogCache();
                    const cart = await getActiveCart({ sessionKey: userSessionId, restaurantId: cache.restId, chatId });
                    if (cart?.items && cart.items.length > 0) {
                        const details = updateSessionOrderDetails(userSessionId, { paymentMethod: selectedPayment }, cleanPhone);
                        return await getNextCheckoutStepResponse({
                            details,
                            whatsappPhone,
                            cart,
                            cache,
                            introMessage: `Payment method (*${selectedPayment === 'COD' ? 'Cash on Delivery (COD)' : 'EasyPaisa'}*) note kar liya hai. 💵`,
                        });
                    }
                }
            }
        } catch (err) {
            console.error('[FAST_ROUTE] Error processing step 4 payment:', err.message);
        }
    }

    // ── Check Specific Deal Inquiry (Zero Tokens, e.g. "deal 5 mai kya kya h?", "deal 5", "zinger deal 4") ──
    const specificDealMatch = lower.match(/\b((?:burger|zinger)\s*(?:meal|deal)\s*(?:#|no\.?)?\s*(?:for\s*)?[1-5]|pi[z]+a\s*(?:meal|deal)\s*(?:#|no\.?)?\s*(?:for\s*)?[1-5]|deal\s*#?\s*[1-5])\b/i);
    if (specificDealMatch && wordCount <= 12 && !hasCartOrOrderAction) {
        try {
            const cache = await getCatalogCache();
            const rawDeals = cache.rawDeals || [];
            let queryNorm = specificDealMatch[1].replace(/#|\s+/g, '').replace(/piza/gi, 'pizza').toLowerCase();

            const wantsBurgerOrZinger = /\b(?:burger|zinger|zegy)\b/i.test(lower);
            const wantsPizza = /\b(?:pizza|piza)\b/i.test(lower);

            // Normalize burger / zinger / pizza deal aliases to match actual deal names
            const bMealMatch = queryNorm.match(/(?:burger|zinger)(?:deal|meal)(?:for)?([1-5])/);
            if (bMealMatch) {
                const num = parseInt(bMealMatch[1], 10);
                if (num >= 4) {
                    queryNorm = `deal${num}`;
                } else {
                    queryNorm = `burgermealfor${num}`;
                }
            }
            const pMealMatch = queryNorm.match(/pizza(?:deal|meal)(?:for)?([1-5])/);
            if (pMealMatch) {
                queryNorm = `pizzamealfor${pMealMatch[1]}`;
            }

            // Category-aware filtering: if customer asks for zinger/burger, exclude pure pizza deals!
            let candidateDeals = rawDeals;
            if (wantsBurgerOrZinger && !wantsPizza) {
                candidateDeals = rawDeals.filter(d => {
                    const dName = (d.name || '').toLowerCase();
                    if (/cravey\s*2\.?0/i.test(dName) && !/\b(?:burger|zinger)\b/i.test(dName)) return false;
                    const itemsText = (d.deal_items || []).map(di => di.menu_item?.name || '').join(' ').toLowerCase();
                    const desc = (d.description || '').toLowerCase();
                    const combined = `${dName} ${itemsText} ${desc}`;
                    const hasBurgerItem = /\b(?:burger|zinger|zegy|chicken\s*piece|crispy)\b/i.test(combined);
                    const hasPizzaItem = /\b(?:pizza|piza|crust)\b/i.test(combined);
                    return hasBurgerItem && !hasPizzaItem;
                });
            } else if (wantsPizza && !wantsBurgerOrZinger) {
                candidateDeals = rawDeals.filter(d => {
                    const dName = (d.name || '').toLowerCase();
                    const itemsText = (d.deal_items || []).map(di => di.menu_item?.name || '').join(' ').toLowerCase();
                    const desc = (d.description || '').toLowerCase();
                    const combined = `${dName} ${itemsText} ${desc}`;
                    return /\b(?:pizza|piza|crust)\b/i.test(combined);
                });
            }

            let matchedDeal = null;
            if (wantsBurgerOrZinger && !wantsPizza) {
                // NEVER fall back to rawDeals (which could be pizza deals)!
                matchedDeal = candidateDeals.find(d => {
                    const dNorm = (d.name || '').replace(/#|\s+/g, '').toLowerCase();
                    return dNorm === queryNorm || dNorm === `deal${bMealMatch ? bMealMatch[1] : ''}` || dNorm === `burgermealfor${bMealMatch ? bMealMatch[1] : ''}`;
                }) || candidateDeals.find(d => {
                    const dNorm = (d.name || '').replace(/#|\s+/g, '').toLowerCase();
                    return dNorm.includes(queryNorm);
                });

                if (!matchedDeal) {
                    const bNum = bMealMatch ? bMealMatch[1] : '';
                    const title = bNum ? `Burger / Zinger Deal ${bNum}` : 'Zinger Deal';
                    const availableList = candidateDeals.map(d => `• *${d.name}* (Rs. ${Number(d.deal_price)})`).join('\n');
                    const reply = `Maazrat! "${title}" filhal hamare active menu mein dastiyab nahi hai.\n\nLekin hamari yeh behtareen burger deals mojood hain:\n${availableList || '• Burger Meal For 1 (Rs. 599)\n• Burger Meal For 2 (Rs. 999)\n• Burger Meal For 3 (Rs. 1,599)'}\n\nBataiye in mein se kaunsi deal cart mein add karoon?`;
                    return {
                        handled: true,
                        routeName: 'deal_inquiry',
                        reply,
                    };
                }
            } else if (wantsPizza && !wantsBurgerOrZinger) {
                // NEVER fall back to rawDeals (which could be burger deals)!
                matchedDeal = candidateDeals.find(d => {
                    const dNorm = (d.name || '').replace(/#|\s+/g, '').toLowerCase();
                    return dNorm === queryNorm || dNorm === `deal${pMealMatch ? pMealMatch[1] : ''}` || dNorm === `pizzamealfor${pMealMatch ? pMealMatch[1] : ''}`;
                }) || candidateDeals.find(d => {
                    const dNorm = (d.name || '').replace(/#|\s+/g, '').toLowerCase();
                    return dNorm.includes(queryNorm);
                });

                if (!matchedDeal) {
                    const pNum = pMealMatch ? pMealMatch[1] : '';
                    const title = pNum ? `Pizza Deal ${pNum}` : 'Pizza Deal';
                    const availableList = candidateDeals.map(d => `• *${d.name}* (Rs. ${Number(d.deal_price)})`).join('\n');
                    const reply = `Maazrat! "${title}" filhal hamare active menu mein dastiyab nahi hai.\n\nLekin hamari yeh behtareen pizza deals mojood hain:\n${availableList || '• Pizza Meal For 1 (Rs. 599)\n• Pizza Meal For 2 (Rs. 1,299)\n• Pizza Meal For 3 (Rs. 1,599)'}\n\nBataiye in mein se kaunsi deal cart mein add karoon?`;
                    return {
                        handled: true,
                        routeName: 'deal_inquiry',
                        reply,
                    };
                }
            } else {
                // General deal inquiry (e.g. "deal 4", "deal 2")
                matchedDeal = rawDeals.find(d => {
                    const dNorm = (d.name || '').replace(/#|\s+/g, '').toLowerCase();
                    return dNorm === queryNorm;
                }) || rawDeals.find(d => {
                    const dNorm = (d.name || '').replace(/#|\s+/g, '').toLowerCase();
                    return new RegExp(`\\bdeal\\s*#?${queryNorm.replace('deal', '')}\\b`, 'i').test(d.name) && !/cravey\s*2\.?0/i.test(d.name);
                }) || rawDeals.find(d => {
                    const dNorm = (d.name || '').replace(/#|\s+/g, '').toLowerCase();
                    return dNorm.includes(queryNorm);
                });
            }

            if (matchedDeal) {
                const itemsList = matchedDeal.deal_items && matchedDeal.deal_items.length > 0
                    ? matchedDeal.deal_items.map(di => `• ${di.quantity > 1 ? `${di.quantity}x ` : ''}${di.menu_item?.name || ''}${di.menu_variant?.name ? ' (' + di.menu_variant.name + ')' : ''}`).join('\n')
                    : `• ${matchedDeal.name}`;

                const reply = `*${matchedDeal.name}* mein aap ko milega:\n\n${itemsList}\n\nQeemat sirf *Rs. ${Number(matchedDeal.deal_price)}* hai! Bohot behtareen deal hai.\nKya yeh order kar doon aap ke liye? (Order karne ke liye *'Haan'* ya *'Order kar do'* likhein)`;

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

    // ── 2g. Headcount / Person-based Deal Recommendations (Zero Tokens, e.g. "One person deal?", "2 person deal", "3 bandon k lie best deal") ──
    const isOnePersonExplicit =
        /\b(?:one|1|single|ek|aik)\s*(?:person|persons|people|banda|bande|bando|insan|afraad)?\s*(?:ki\s*)?(?:deal|deals|meal|meals|offer|offers)\b/i.test(lower) ||
        /\b(?:deal|deals|meal|meals)\s*(?:for\s*)?(?:one|1|single|ek|aik)\s*(?:person|persons|people|banda|bande|bando|insan)?\b/i.test(lower) ||
        /\b(?:one's|ones)\s*(?:mein|mai|me|walo?|wali)?\b/i.test(lower) ||
        /^(?:one|1|single)\s*(?:person|banda|insan)(?:\s*(?:deal|meal))?[\s?.!]*$/i.test(lower.trim());

    const isFamilyExplicit =
        /\b(?:family|party|gathering)\s*(?:ki\s*)?(?:deals?|meals?|combos?|packages?|offers?)\b/i.test(lower) ||
        /\b(?:deals?|meals?)\s*(?:for\s*)?(?:family|party)\b/i.test(lower);

    const personQueryMatch = lower.match(/\b(?:(\d+|ek|aik|do|teen|tin|char|chaar|panch|paanch|one|two|three|four|five)\s*(?:k\s*liye|ke\s*liye|k\s*lie|ke\s*lie|liye|lie)?\s*(?:bandon|bande|bando|banday|bndon|bnde|bndo|bnday|persons?|logon?|logo|log|people|afraad|members?|friends?|heads?|pax)|(?:for\s*)(\d+)\s*(?:persons?|people|pax)?)\b/i);
    const isDealOrRecommendQuery = /\b(deal|deals|offer|offers|best|recommend|mangwa|mangwayen|kya\s*(?:loun|lein|mangwayen|h)|chahiye|batao|bataiye|dikhao|de|den|kro|karo|bhejo)\b/i.test(lower);

    let detectedHeadcount = 0;
    if (isOnePersonExplicit) {
        detectedHeadcount = 1;
    } else if (isFamilyExplicit) {
        detectedHeadcount = 4;
    } else if (personQueryMatch && (isDealOrRecommendQuery || /\b(chahiye|btao|batao|dikhao|bhejo|dein|do)\b/i.test(lower))) {
        const rawNum = (personQueryMatch[1] || personQueryMatch[2] || '').toLowerCase();
        if (/^(?:1|ek|aik|one|single)$/.test(rawNum)) detectedHeadcount = 1;
        else if (/^(?:2|do|two|double)$/.test(rawNum)) detectedHeadcount = 2;
        else if (/^(?:3|teen|tin|three)$/.test(rawNum)) detectedHeadcount = 3;
        else if (/^(?:4|char|chaar|four)$/.test(rawNum)) detectedHeadcount = 4;
        else if (/^(?:5|panch|paanch|five)$/.test(rawNum)) detectedHeadcount = 5;
        else if (!isNaN(parseInt(rawNum, 10))) detectedHeadcount = parseInt(rawNum, 10);
    }

    if (detectedHeadcount >= 1 && !hasCartOrOrderAction) {
        const isPizza = /\b(?:pi[z]+as?|pizas?|crusts?)\b/i.test(lower);
        const isBurger = /\b(?:burgers?|zingers?|zegy|bun\s*kabab)\b/i.test(lower);

        let recReply = '';
        if (detectedHeadcount === 3) {
            if (isBurger) {
                recReply = `🍔 *3 Bandon ke liye Best Burger Deals:*\n\n` +
                    `1️⃣ *Deal 5* — Rs. 1,099 (Super Saver)\n` +
                    `• 3x Crispy Zinger Burgers\n` +
                    `• 1x 1 Liter Chilled Soft Drink\n` +
                    `_(Sirf Rs. 1,099 mein 3 Zingers + 1L cold drink!)\_\n\n` +
                    `2️⃣ *Burger Meal For 3* — Rs. 1,599 (Full Feast)\n` +
                    `• 3x Zinger Burgers\n` +
                    `• 3x Crispy Chicken Pieces\n` +
                    `• 1x 1 Liter Chilled Soft Drink\n\n` +
                    `Aapke liye kaunsi deal add karun? Bas deal ka naam bata dein! 😊`;
            } else if (isPizza) {
                recReply = `🍕 *3 Bandon ke liye Best Pizza Deals:*\n\n` +
                    `1️⃣ *Pizza Meal For 3* — Rs. 1,599 ⭐ (Sab se Best & Recommended)\n` +
                    `• 1x Large Pizza (Apni pasand ke kisi bhi flavour mein!)\n` +
                    `• 1x 1 Liter Chilled Soft Drink\n` +
                    `_(3 bandon ke liye Large pizza aur 1 Liter cold drink sab se perfect aur economical combo hai!)\_\n\n` +
                    `2️⃣ *Deal 2* — Rs. 2,099 (2 Pizzas Combo)\n` +
                    `• 2x Medium Pizzas\n` +
                    `• 1x 1 Liter Chilled Soft Drink\n` +
                    `_(Agar alag alag flavours pasand hon to 2 Medium pizzas best hain!)\_\n\n` +
                    `Aapke liye kaunsi deal add karun? Bas deal ka naam bata dein (jaise *'Pizza Meal For 3'* ya *'Deal 2'*)! 😊`;
            } else {
                recReply = `🎉 *3 Bandon ke liye Cravey Crust ki Best Deals:*\n\n` +
                    `🍕 *PIZZA OPTION:*\n` +
                    `• *Pizza Meal For 3* — Rs. 1,599 (1x Large Pizza + 1x 1 Liter Soft Drink)\n` +
                    `• *Deal 2* — Rs. 2,099 (2x Medium Pizzas + 1x 1 Liter Soft Drink)\n\n` +
                    `🍔 *BURGER OPTION:*\n` +
                    `• *Deal 5* — Rs. 1,099 (3x Zinger Burgers + 1x 1 Liter Soft Drink)\n` +
                    `• *Burger Meal For 3* — Rs. 1,599 (3x Zinger Burgers + 3x Chicken Pieces + 1x 1L Drink)\n\n` +
                    `Aap kya pasand karenge — Pizza ya Burgers? Deal ka naam bata dein, foran add kar denge! 😊`;
            }
        } else if (detectedHeadcount === 2) {
            if (isBurger) {
                recReply = `🍔 *2 Bandon ke liye Best Burger Deal:*\n\n` +
                    `• *Burger Meal For 2* — Rs. 999\n` +
                    `• 2x Crispy Zinger Burgers\n` +
                    `• 1x Regular Fries\n` +
                    `• 2x Regular Soft Drinks\n\n` +
                    `Kya yeh deal aapke liye cart mein add kar doon? 😊`;
            } else if (isPizza) {
                recReply = `🍕 *2 Bandon ke liye Best Pizza Deals:*\n\n` +
                    `1️⃣ *Deal 1* — Rs. 1,099 ⭐ (Best Value)\n` +
                    `• 2x Small Pizzas (Dono ke liye apna personal pizza!)\n` +
                    `• 2x Regular Soft Drinks\n\n` +
                    `2️⃣ *Pizza Meal For 2* — Rs. 1,299\n` +
                    `• 1x Medium / Regular Pizza\n` +
                    `• 2x Regular Soft Drinks\n\n` +
                    `Aapke liye kaunsi deal add karun? 😊`;
            } else {
                recReply = `🎉 *2 Bandon ke liye Best Deals:*\n\n` +
                    `🍕 *1️⃣ Deal 1* — Rs. 1,099 ⭐ (Best Value)\n` +
                    `• 2x Small Pizzas + 2x Regular Drinks\n\n` +
                    `🍕 *2️⃣ Pizza Meal For 2* — Rs. 1,299\n` +
                    `• 1x Medium / Regular Pizza + 2x Regular Drinks\n\n` +
                    `🍔 *3️⃣ Burger Meal For 2* — Rs. 999\n` +
                    `• 2x Crispy Zinger Burgers + 1x Regular Fries + 2x Regular Drinks\n\n` +
                    `Aapko kaunsi pasand hai? Bas naam bata dein! 😊`;
            }
        } else if (detectedHeadcount === 1) {
            if (isBurger) {
                recReply = `🍔 *1 Person ke liye Best Burger Deal:*\n\n` +
                    `• *Burger Meal For 1* — Rs. 599\n` +
                    `• 1x Crispy Zinger Burger\n` +
                    `• 1x Regular Fries\n` +
                    `• 1x Regular Soft Drink\n\n` +
                    `Kya yeh add kar doon? 😊`;
            } else if (isPizza) {
                recReply = `🍕 *1 Person ke liye Best Pizza Meal:*\n\n` +
                    `• *Pizza Meal For 1* — Rs. 599\n` +
                    `• 1x Small Classic Pizza (Apni pasand ke flavour mein!)\n` +
                    `• 1x Regular Soft Drink\n\n` +
                    `Kya yeh add kar doon? 😊`;
            } else {
                recReply = `🎉 *1 Person ke liye Cravey Crust ki Best Deals (Rs. 599 each):*\n\n` +
                    `🍕 *1️⃣ Pizza Meal For 1* — Rs. 599\n` +
                    `• 1x Small Classic Pizza (Apni pasand ke flavour mein!)\n` +
                    `• 1x Regular Soft Drink\n\n` +
                    `🍔 *2️⃣ Burger Meal For 1* — Rs. 599\n` +
                    `• 1x Crispy Zinger Burger\n` +
                    `• 1x Regular Fries\n` +
                    `• 1x Regular Soft Drink\n\n` +
                    `Aapko kaunsi deal pasand hai — Pizza ya Burger? Bas naam bata dein! 😊`;
            }
        } else if (detectedHeadcount === 4) {
            if (isBurger) {
                recReply = `🍔 *4 Bandon ke liye Best Burger Deal:*\n\n` +
                    `• *Deal 4* — Rs. 999 ⭐ (Super Value)\n` +
                    `• 4x Juicy Zegy Burgers\n` +
                    `_(Sirf Rs. 999 mein 4 burgers!)\_\n\n` +
                    `Kya yeh deal add kar doon? 😊`;
            } else if (isPizza) {
                recReply = `🍕 *4 Bandon ke liye Best Pizza Deals:*\n\n` +
                    `1️⃣ *Pizza Meal For 4* — Rs. 2,499 ⭐ (Party Feast)\n` +
                    `• 1x Giant Party Size Pizza (16 Inches!)\n` +
                    `• 1x 1.5 Liter Chilled Soft Drink\n\n` +
                    `2️⃣ *Deal 3* — Rs. 2,999 (2 Large Pizzas)\n` +
                    `• 2x Large Pizzas\n` +
                    `• 1x 1 Liter Soft Drink\n\n` +
                    `Aapke liye kaunsi deal add karun? 😊`;
            } else {
                recReply = `🎉 *4 Bandon / Family ke liye Cravey Crust ki Best Deals:*\n\n` +
                    `🍕 *1️⃣ Pizza Meal For 4* — Rs. 2,499 ⭐ (Party Feast)\n` +
                    `• 1x Giant Party Size Pizza (16 Inches!) + 1x 1.5 Liter Soft Drink\n\n` +
                    `🍕 *2️⃣ Deal 3* — Rs. 2,999 (2 Large Pizzas + 1 Liter Soft Drink)\n\n` +
                    `🍔 *3️⃣ Deal 4* — Rs. 999 (4x Juicy Zegy Burgers)\n\n` +
                    `🍗 *4️⃣ Full Box* — Rs. 2,199 (8 Pcs Fried Chicken + Fries + Sauce + 2 Buns)\n\n` +
                    `Aapke liye kaunsi deal add karun? Bas naam bata dein! 😊`;
            }
        } else {
            // For 5+ persons: dynamically calculate accurate combos & quantities based on exact headcount
            const count = detectedHeadcount;
            const deal3Qty = Math.max(2, Math.ceil(count / 4));
            const deal3Total = deal3Qty * 2999;
            const deal3Pizzas = deal3Qty * 2;
            const deal3Drinks = deal3Qty;

            const pm4Qty = Math.max(2, Math.ceil(count / 4));
            const pm4Total = pm4Qty * 2499;

            const deal5Qty = Math.max(2, Math.ceil(count / 3));
            const deal5Total = deal5Qty * 1099;
            const deal5Burgers = deal5Qty * 3;

            const deal4Qty = Math.max(2, Math.ceil(count / 4));
            const deal4Total = deal4Qty * 999;
            const deal4Burgers = deal4Qty * 4;

            const isDirectOrderAsk = /\b(?:d[eo]|de\s*do|kardo|krdo|daal\s*do|bhej\s*do|bhejo|mangwa\s*do|chahiye)\b/i.test(lower);

            if (isBurger) {
                recReply = `🍔 *${count} Bandon ke liye Best Burger Combos:*\n\n` +
                    `1️⃣ *${deal5Qty}x Deal 5* — Rs. ${deal5Total.toLocaleString()} ⭐ (Most Popular)\n` +
                    `   • ${deal5Burgers}x Crispy Zinger Burgers + ${deal5Qty}x 1L Soft Drinks\n\n` +
                    `2️⃣ *${deal4Qty}x Deal 4* — Rs. ${deal4Total.toLocaleString()} (Budget Value)\n` +
                    `   • ${deal4Burgers}x Juicy Zegy Burgers\n\n` +
                    (isDirectOrderAsk
                        ? `Aap Deal 5 add karwana chahenge ya Deal 4? Bas bata dein, main order ready kar doon! 😊`
                        : `Aap in mein se kaunsa combo order karna chahenge? Bas bata dein! 😊`);
            } else if (isPizza) {
                recReply = `🍕 *${count} Bandon ke liye Best Pizza Combos:*\n\n` +
                    `1️⃣ *${deal3Qty}x Deal 3* — Rs. ${deal3Total.toLocaleString()} ⭐ (Sab se Best Feast)\n` +
                    `   • ${deal3Pizzas}x Large Pizzas (Apni pasand ke flavours) + ${deal3Drinks}x 1L Drinks\n\n` +
                    `2️⃣ *${pm4Qty}x Pizza Meal For 4* — Rs. ${pm4Total.toLocaleString()}\n` +
                    `   • ${pm4Qty}x Giant Party Size (16") Pizzas + ${pm4Qty}x 1.5L Drinks\n\n` +
                    (isDirectOrderAsk
                        ? `Aap Deal 3 add karwana chahenge ya Pizza Meal For 4? Bas bata dein, main order ready kar doon! 😊`
                        : `In mein se kaunsa combo aap ke liye cart mein add karun? 😊`);
            } else {
                recReply = isDirectOrderAsk
                    ? `🎉 *${count} Bandon ke liye Cravey Crust ke 2 Top Combos:*\n\n` +
                      `🍕 *Option A (Pizza Feast):* ${deal3Qty}x Deal 3 (${deal3Pizzas}x Large Pizzas + ${deal3Drinks}x 1L Drinks) — Rs. ${deal3Total.toLocaleString()}\n\n` +
                      `🍔 *Option B (Zinger Feast):* ${deal5Qty}x Deal 5 (${deal5Burgers}x Crispy Zinger Burgers + ${deal5Qty}x 1L Drinks) — Rs. ${deal5Total.toLocaleString()}\n\n` +
                      `Aap **Option A (Pizza)** add karwana chahenge ya **Option B (Burger)**? Bas 'Option A' ya 'Option B' likh kar bata dein taake main foran order process kar doon! 😊`
                    : `🎉 *${count} Bandon / Gathering ke liye Best Recommendations:*\n\n` +
                      `🍕 *Option 1 (Pizza Feast):*\n` +
                      `   • *${deal3Qty}x Deal 3* — Rs. ${deal3Total.toLocaleString()}\n` +
                      `   _(${deal3Pizzas}x Large Pizzas + ${deal3Drinks}x 1L Soft Drinks)_\n\n` +
                      `🍕 *Option 2 (Giant 16" Party Pizzas):*\n` +
                      `   • *${pm4Qty}x Pizza Meal For 4* — Rs. ${pm4Total.toLocaleString()}\n` +
                      `   _(${pm4Qty}x 16-inch Giant Pizzas + ${pm4Qty}x 1.5L Soft Drinks)_\n\n` +
                      `🍔 *Option 3 (Zinger Burger Feast):*\n` +
                      `   • *${deal5Qty}x Deal 5* — Rs. ${deal5Total.toLocaleString()}\n` +
                      `   _(${deal5Burgers}x Crispy Zinger Burgers + ${deal5Qty}x 1L Soft Drinks)_\n\n` +
                      `Aap **Pizza Combo** pasand karenge ya **Burger Combo**? Bas bata dein, main order ready kar deta hoon! 😊`;
            }
        }

        // Only send images if customer explicitly asked for photos / pictures / flyers;
        // Never spam images repeatedly on text advice/recommendation questions!
        const wantsPhotos = /\b(?:pictures?|pics?|photos?|images?|flyers?|pamphlets?|cards?)\b/i.test(lower);
        const defaultDealsImages = [
            'assets/menu/cravey_crust_deals_menu.png',
            'assets/menu/cravey_crust_cravey20_deals.png'
        ];

        return {
            handled: true,
            routeName: 'headcount_deal_recommendation',
            reply: recReply,
            imageUrls: wantsPhotos ? defaultDealsImages : [],
            imageUrl: wantsPhotos ? (defaultDealsImages[0] || null) : null,
        };
    }

    // ── Early Greeting Routing (Zero Tokens, prioritized before deals/menu) ──
    if (FAST_GREETING_REGEX.test(lower)) {
        try {
            const cache = await getCatalogCache();
            const rawStore = cache.storeName || '';
            const store = (!rawStore || /store\s*admin|admin|default/i.test(rawStore)) ? 'Cravey Crust' : rawStore;

            let salutation = 'Assalam o Alaikum!';
            if (/^(?:hi+|hello+|hey+|helo+|hellow+)\b/i.test(lower)) {
                salutation = 'Hello!';
            } else if (/salam|assalam|aoa/i.test(lower)) {
                salutation = 'Walaikum Assalam!';
            }

            return {
                handled: true,
                routeName: 'quick_reply',
                reply: `${salutation} *${store}* mein khush aamdeed! Main *${store}* ka AI assistant hoon. Kahiye, aaj aap ke liye kya order ready karoon? Hamara menu dekhne ke liye *'menu'* ya deals dekhne ke liye *'deals'* likhein! 😊`,
            };
        } catch (_) {}
    }

    // ── Early Standalone Affirmative with Active Cart (Zero Tokens, advances checkout) ──
    const isStandaloneAffirmativeEarly = /^(?:(?:g|jee?|ji|haan?|han|hn|yes|yep|ok|okay|sahi|theek|thk)\s+)?(?:g|jee?|ji|haan?|han|hn|yes|yep|theek\s*hai?|theek\s*hy|thk\s*hai?|thk\s*hy|ok|okay|acha|achha|done|bilkul|zaroor|confirm|yahi|yehi|wahi|isi)[\s.!?]*$/i.test(lower.trim());
    if (isStandaloneAffirmativeEarly && wordCount <= 4 && userSessionId) {
        try {
            const { getActiveCart } = await import('./cartService.js');
            const cache = await getCatalogCache();
            const cart = await getActiveCart({ sessionKey: userSessionId, restaurantId: cache.restId, chatId });
            if (cart?.items && cart.items.length > 0) {
                const { getSessionOrderDetails } = await import('./sessionService.js');
                const cleanPhone = (whatsappPhone || '').replace(/\D/g, '');
                const details = getSessionOrderDetails(userSessionId, cleanPhone);
                return await getNextCheckoutStepResponse({
                    details,
                    whatsappPhone,
                    cart,
                    cache,
                });
            }
        } catch (_) {}
    }

    // ── Direct Picture / Photo / Flyer / Menu Card / PDF Request Route (Zero Tokens) ──
    const isDirectPictureOrPdfRequest =
        /\b(?:pictures?|pics?|photos?|tasweer(?:ein)?|tasveer(?:ein)?|images?|img|flyers?|pamphlets?|brochures?|cards?|pdf|document)\b/i.test(lower) &&
        /\b(?:dikhao|dekhao|dikhayein|dikhana|bhejo|bhajo|bhej\s*do|bhejna|send|share|dein|do|padi|parhi|hai|h|hy|mein|main|karo|kro)\b/i.test(lower);

    if (isDirectPictureOrPdfRequest && wordCount <= 15 && !hasCartOrOrderAction) {
        try {
            const cache = await getCatalogCache();
            const { getSessionOrderDetails, haveDealsBeenSent } = await import('./sessionService.js');
            const cleanPhone = (whatsappPhone || '').replace(/\D/g, '');
            const currDetails = userSessionId ? getSessionOrderDetails(userSessionId, cleanPhone) : null;

            const isExplicitDealsPicture = /\b(?:deals?|meals?|offers?|combos?)\b/i.test(lower);
            const isExplicitMenuOrPdf = /\b(?:menu|menue|meny|mainu|rate|food|pdf|document|catalog|catlog)\b/i.test(lower);

            let menuImages = (Array.isArray(cache.menuImageUrls) && cache.menuImageUrls.length > 0)
                ? cache.menuImageUrls
                : (cache.menuImageUrl ? [cache.menuImageUrl] : ['assets/menu/cravey_crust_main_menu.png']);

            let dealsImages = (Array.isArray(cache.dealsImageUrls) && cache.dealsImageUrls.length > 0)
                ? cache.dealsImageUrls
                : (cache.dealsImageUrl ? [cache.dealsImageUrl] : [
                    'assets/menu/cravey_crust_deals_menu.png',
                    'assets/menu/cravey_crust_cravey20_deals.png'
                ]);

            let targetImages = [];
            let caption = '';

            if (isExplicitDealsPicture) {
                targetImages = dealsImages;
                caption = 'Cravey Crust ki deals ki photos / flyers haazir hain! 🍕🔥';
            } else if (isExplicitMenuOrPdf) {
                targetImages = [...menuImages, ...dealsImages];
                caption = 'Cravey Crust ka high-quality visual menu card aur deals flyers haazir hain! 🍕📄';
            } else {
                const dealsRecentlySent = userSessionId ? haveDealsBeenSent(userSessionId, cleanPhone) : false;
                if (dealsRecentlySent) {
                    targetImages = dealsImages;
                    caption = 'Cravey Crust ki deals flyers haazir hain! 🍕🔥';
                } else {
                    targetImages = [...menuImages, ...dealsImages];
                    caption = 'Cravey Crust ka complete visual menu card aur deals flyers haazir hain! 🍕🍔';
                }
            }

            caption += '\n\nAap in mein se kya order karna chahenge? Bas bata dein! 😊';

            return {
                handled: true,
                routeName: isExplicitDealsPicture ? 'live_deals_picture_direct' : 'live_menu_picture_direct',
                reply: caption,
                imageUrls: targetImages,
                imageUrl: targetImages[0] || null,
            };
        } catch (err) {
            console.error('[FAST_ROUTE] Error processing direct picture request:', err.message);
        }
    }

    // ── 3. Live Deals (Strict 3-Tier Image & Text Rules) ──
    const isDealsKeyword = FAST_DEALS_REGEX.test(lower) || FAST_DEALS_CONTAINS.test(lower);
    const hasSpecificDealNumber = /\b(deal\s*#?\d|meal\s*#?\d)\b/i.test(lower);

    if (isDealsKeyword && wordCount <= 15 && !hasSpecificDealNumber && !hasCartOrOrderAction) {
        // Guard: Do not interrupt active checkout if customer has active cart items and is in middle of details/confirmation steps
        let isActivelyCheckingOut = false;
        if (userSessionId) {
            try {
                const { getSessionOrderDetails } = await import('./sessionService.js');
                const cleanPhone = (whatsappPhone || '').replace(/\D/g, '');
                const currDetails = getSessionOrderDetails(userSessionId, cleanPhone);
                const { getActiveCart } = await import('./cartService.js');
                const cache = await getCatalogCache();
                const cart = await getActiveCart({ sessionKey: userSessionId, restaurantId: cache.restId, chatId });
                if (cart?.items?.length > 0 && (currDetails?.name || currDetails?.address || currDetails?.location || currDetails?.paymentMethod || currDetails?.phone)) {
                    const isExplicitDealsRequest = /^(?:show\s+)?(?:deals?|burger deals?|pi[z]+a deals?)[\s.!?]*$/i.test(raw) || /\b(?:dikhao|dekhao|bhejo|list|options)\b/i.test(lower);
                    if (!isExplicitDealsRequest) {
                        isActivelyCheckingOut = true;
                    }
                }
            } catch (_) {}
        }

        if (!isActivelyCheckingOut) {
            try {
                const cache = await getCatalogCache();

          // ── Check for specific deal qualifiers (e.g. "midnight deals", "lunch deals", "student deals") ──
                const dealQualifierMatch = lower.match(/\b(midnight|lunch|student|family|snack|special|iftar|ramadan)\b/i);
                if (dealQualifierMatch) {
                    const qualifier = dealQualifierMatch[1].toLowerCase();
                    const activeDeals = Array.isArray(cache.rawDeals)
                        ? cache.rawDeals.filter(d => d.is_active !== false)
                        : [];
                    const matchedDeals = activeDeals.filter(d => {
                        const combined = `${d.name} ${d.description || ''} ${(d.deal_items || []).map(di => di.menu_item?.name || '').join(' ')}`.toLowerCase();
                        return combined.includes(qualifier);
                    });

                    if (matchedDeals.length > 0) {
                        const dealLines = matchedDeals.map(d => {
                            const items = (d.deal_items || []).map(di => {
                                const q = di.quantity > 1 ? `${di.quantity}x ` : '';
                                return `${q}${di.menu_item?.name || 'Item'}`;
                            }).join(', ');
                            const desc = items ? `\n   _${items}_` : (d.description ? `\n   _${d.description}_` : '');
                            return `• *${d.name}* — Rs. ${Number(d.deal_price)}${desc}`;
                        });
                        return {
                            handled: true,
                            routeName: 'live_deals_qualified',
                            reply: `🌙 *Cravey Crust ${qualifier.charAt(0).toUpperCase() + qualifier.slice(1)} Deals:*\n\n${dealLines.join('\n\n')}\n\nIn mein se kaunsi deal add karun aap ke liye? 😊`,
                            imageUrls: [],
                            imageUrl: null,
                        };
                    } else {
                        return {
                            handled: true,
                            routeName: 'live_deals_qualifier_none',
                            reply: `Cravey Crust par filhal alag se *${qualifier.charAt(0).toUpperCase() + qualifier.slice(1)} Deals* active nahi hain, lekin hamare paas bohot zabardast aur budget-friendly live deals dastiyab hain! 🍕🍔\n\nHamari live deals dekhne ke liye *'deals'* likhein ya menu dekhne ke liye *'menu'* likhein!`,
                            imageUrls: [],
                            imageUrl: null,
                        };
                    }
                }

                // ── Tier 1: Check Deals Images (All pages must be sent, NO text dump) ──
                let targetDealsImages = (Array.isArray(cache.dealsImageUrls) && cache.dealsImageUrls.length > 0)
                    ? cache.dealsImageUrls
                    : (cache.dealsImageUrl ? [cache.dealsImageUrl] : []);

                if (targetDealsImages.length === 0) {
                    try {
                        const { getDbClient } = await import('../db/client.js');
                        const prisma = getDbClient();
                        if (prisma) {
                            const s = await prisma.restaurantSetting.findFirst({
                                where: { key: { in: ['deals_image_urls', 'deals_image_url'] } },
                                orderBy: { updated_at: 'desc' },
                            });
                            if (s?.value) {
                                try {
                                    const parsed = JSON.parse(s.value);
                                    if (Array.isArray(parsed) && parsed.length > 0) targetDealsImages = parsed.filter(Boolean);
                                } catch (_) {
                                    if (s.value.trim()) targetDealsImages = [s.value.trim()];
                                }
                            }
                        }
                    } catch (_) {}
                }

                if (targetDealsImages.length === 0) {
                    targetDealsImages = [
                        'assets/menu/cravey_crust_deals_menu.png',
                        'assets/menu/cravey_crust_cravey20_deals.png'
                    ];
                }

                const { haveDealsBeenSent, markDealsSent, getSessionOrderDetails } = await import('./sessionService.js');
                const cleanPhone = (whatsappPhone || '').replace(/\D/g, '');
                const hasShowOrSendWord = /\b(dikhao|dekhao|dikhayein|dikhana|bhejo|bhajo|bhej\s*do|send|share|list|card|cards|flyer|flyers|photos?|pics?|images?)\b/i.test(lower);
                const isExplicitDealsAsk = FAST_DEALS_REGEX.test(lower) || /\b(deals?|offer|packages?|combos?)\b/i.test(lower);
                const dealsAlreadySent = userSessionId ? haveDealsBeenSent(userSessionId, cleanPhone) : false;
                const isSpecificRecommendation = !hasShowOrSendWord && (
                    /\b(koi\s+(?:achi|acha|best)|konsi|konse|kaunsi|kaunsa|recommend|recommendation|sugest|suggest|suggestion)\b/i.test(lower) ||
                    /\b(\d+|ek|aik|do|teen|tin|char|chaar|panch|paanch)\s*(?:k\s*lie|ke\s*lie|k\s*liye|ke\s*liye|liye|lie)?\s*(?:bando|bndo|bandon|bndon|bande|bnde|log|logo|logon|person|persons|people)\b/i.test(lower)
                );

                const isBurger = /\b(?:burgers?|zingers?|zegy|bun\s*kabab)\b/i.test(lower);
                const isPizza = /\b(?:pi[z]+as?|pizas?|crusts?)\b/i.test(lower);
                const isSpecificCategoryAsk = (isBurger && !isPizza) || (isPizza && !isBurger);

                // Tier 1: General deals ask without specific category filter -> send deal images
                if (targetDealsImages.length > 0 && !isSpecificCategoryAsk && (isExplicitDealsAsk || !dealsAlreadySent) && !isSpecificRecommendation) {
                    if (userSessionId) markDealsSent(userSessionId, cleanPhone);
                    const currDetails = userSessionId ? getSessionOrderDetails(userSessionId, cleanPhone) : null;
                    const dealsCaption = 'Cravey Crust ki taraf se mazedaar deals haazir hain! 🍕🔥\n\nIn mein se kaunsi deal aap ke liye cart mein add karun? 😊';
                    return {
                        handled: true,
                        routeName: 'live_deals_image',
                        reply: dealsCaption,
                        imageUrls: targetDealsImages,
                        imageUrl: targetDealsImages[0],
                    };
                }

                // Tier 2: Specific category deals (Burger Deals or Pizza Deals) or text fallback
                const activeDeals = Array.isArray(cache.rawDeals)
                    ? cache.rawDeals.filter(d => d.is_active !== false)
                    : [];

                if (activeDeals.length > 0 || isSpecificCategoryAsk) {
                    let textReply = '';

                    if (isBurger && !isPizza) {
                        // Strictly filter active deals containing burgers (and exclude pure pizza deals)
                        const burgerDeals = activeDeals.filter(d => {
                            const dName = (d.name || '').toLowerCase();
                            const dItems = (d.deal_items || []).map(di => di.menu_item?.name || '').join(' ').toLowerCase();
                            const dDesc = (d.description || '').toLowerCase();
                            const combined = `${dName} ${dItems} ${dDesc}`;
                            return /\b(?:burger|zinger|zegy)\b/i.test(combined);
                        });

                        if (burgerDeals.length > 0) {
                            const dealLines = burgerDeals.map(d => {
                                const items = (d.deal_items || []).map(di => {
                                    const q = di.quantity > 1 ? `${di.quantity}x ` : '';
                                    return `${q}${di.menu_item?.name || 'Item'}`;
                                }).join(', ');
                                const desc = items ? `\n   _${items}_` : (d.description ? `\n   _${d.description}_` : '');
                                return `• *${d.name}* — Rs. ${Number(d.deal_price)}${desc}`;
                            });
                            textReply = `🍔 *Cravey Crust Burger Deals:*\n━━━━━━━━━━━━━━━━━━━━━\n${dealLines.join('\n\n')}\n\nIn mein se kaunsi burger deal add karun aap ke liye? 😊`;
                        } else if (cache.customerBurgerDeals && !cache.customerBurgerDeals.includes('available nahi')) {
                            textReply = cache.customerBurgerDeals;
                        } else {
                            // Standard Cravey Crust Burger Deals
                            textReply = `🍔 *Cravey Crust Burger Deals:*\n━━━━━━━━━━━━━━━━━━━━━\n` +
                                `• *Burger Meal For 1* — Rs. 599\n   _1x Zinger Burger + Regular Fries + Regular Soft Drink_\n\n` +
                                `• *Burger Meal For 2* — Rs. 999\n   _2x Zinger Burgers + Regular Fries + 2x Regular Soft Drinks_\n\n` +
                                `• *Deal 4* — Rs. 999\n   _4x Juicy Zegy Burgers_\n\n` +
                                `• *Deal 5* — Rs. 1,099\n   _3x Crispy Zinger Burgers + 1 Liter Soft Drink_\n\n` +
                                `• *Burger Meal For 3* — Rs. 1,599\n   _3x Zinger Burgers + 3x Chicken Pieces + 1 Liter Soft Drink_\n\n` +
                                `In mein se kaunsi burger deal add karun aap ke liye? 😊`;
                        }
                    } else if (isPizza && !isBurger) {
                        // Strictly filter active deals containing pizzas (and exclude pure burger deals)
                        const pizzaDeals = activeDeals.filter(d => {
                            const dName = (d.name || '').toLowerCase();
                            const dItems = (d.deal_items || []).map(di => di.menu_item?.name || '').join(' ').toLowerCase();
                            const dDesc = (d.description || '').toLowerCase();
                            const combined = `${dName} ${dItems} ${dDesc}`;
                            return /\b(?:pizza|piza|crust|dual\s*zone)\b/i.test(combined);
                        });

                        if (pizzaDeals.length > 0) {
                            const dealLines = pizzaDeals.map(d => {
                                const items = (d.deal_items || []).map(di => {
                                    const q = di.quantity > 1 ? `${di.quantity}x ` : '';
                                    return `${q}${di.menu_item?.name || 'Item'}`;
                                }).join(', ');
                                const desc = items ? `\n   _${items}_` : (d.description ? `\n   _${d.description}_` : '');
                                return `• *${d.name}* — Rs. ${Number(d.deal_price)}${desc}`;
                            });
                            textReply = `🍕 *Cravey Crust Pizza Deals:*\n━━━━━━━━━━━━━━━━━━━━━\n${dealLines.join('\n\n')}\n\n💡 _Deals mein apni pasand ka koi bhi pizza flavour chun sakte hain!_\n\nIn mein se kaunsi pizza deal add karun aap ke liye? 😊`;
                        } else if (cache.customerPizzaDeals && !cache.customerPizzaDeals.includes('available nahi')) {
                            textReply = cache.customerPizzaDeals;
                        } else {
                            // Standard Cravey Crust Pizza Deals
                            textReply = `🍕 *Cravey Crust Pizza Deals:*\n━━━━━━━━━━━━━━━━━━━━━\n` +
                                `• *Pizza Meal For 1* — Rs. 599\n   _1x Small Pizza + Regular Soft Drink_\n\n` +
                                `• *Deal 1* — Rs. 1,099\n   _2x Small Pizzas + 2x Regular Soft Drinks_\n\n` +
                                `• *Pizza Meal For 2* — Rs. 1,299\n   _1x Medium Pizza + 2x Regular Soft Drinks_\n\n` +
                                `• *Pizza Meal For 3* — Rs. 1,599\n   _1x Large Pizza + 1 Liter Soft Drink_\n\n` +
                                `• *Deal 2* — Rs. 2,099\n   _2x Medium Pizzas + 1 Liter Soft Drink_\n\n` +
                                `• *Pizza Meal For 4* — Rs. 2,499\n   _1x Giant Party Size (16") Pizza + 1.5L Soft Drink_\n\n` +
                                `• *Deal 3* — Rs. 2,999\n   _2x Large Pizzas + 1 Liter Soft Drink_\n\n` +
                                `💡 _Deals mein apni pasand ka koi bhi pizza flavour chun sakte hain!_\n\nIn mein se kaunsi pizza deal add karun aap ke liye? 😊`;
                        }
                    } else {
                        const dealLines = activeDeals.slice(0, 8).map(d => {
                            const items = (d.deal_items || []).map(di => {
                                const q = di.quantity > 1 ? `${di.quantity}x ` : '';
                                return `${q}${di.menu_item?.name || 'Item'}`;
                            }).join(', ');
                            const desc = items ? `\n   _${items}_` : (d.description ? `\n   _${d.description}_` : '');
                            return `• *${d.name}* — Rs. ${Number(d.deal_price)}${desc}`;
                        });
                        textReply = `🔥 *Cravey Crust Live Deals:*\n\n${dealLines.join('\n\n')}\n\nIn mein se kaunsi deal add karun aap ke liye? 🍕`;
                    }

                    return {
                        handled: true,
                        routeName: isBurger ? 'live_deals_burger_filtered' : (isPizza ? 'live_deals_pizza_filtered' : 'live_deals_text'),
                        reply: textReply,
                        imageUrls: targetDealsImages,
                        imageUrl: targetDealsImages[0] || null,
                    };
                }

                // ── Tier 3: Both images and deals section are empty ──
                return {
                    handled: true,
                    routeName: 'live_deals_none',
                    reply: 'Maazrat! Hamare paas currently koi deal nahi hai.',
                    imageUrls: [],
                    imageUrl: null,
                };
            } catch (err) {
                console.error('[FAST_ROUTE] Deals cache error:', err.message);
                // Fall through to LLM gracefully
            }
        }
    }

    // ── 3b. Live Dynamic Discount Inquiries (Zero Tokens, live from DB) ──
    const isDiscountKeyword = /\b(discount|discounts|discont|riayat|kam\s*karo|kuch\s*kam|discount\s*hai|koi\s*discount|offers?|sale|promo|promotion)\b/i.test(lower);
    if (isDiscountKeyword && wordCount <= 9 && !hasCartOrOrderAction) {
        try {
            const cache = await getCatalogCache();
            const gDisc = cache.globalDiscount;
            let discountReply = '';

            if (gDisc && gDisc.enabled && gDisc.value > 0) {
                const discText = gDisc.type === 'FIXED' ? `Rs. ${gDisc.value} OFF` : `${gDisc.value}% OFF`;
                discountReply = `🎉 *LATEST DISCOUNT OFFER!*\n\n🏷️ *${gDisc.title.toUpperCase()}*\nHamare tamam menu items par *${discText}* active hai! Har single item par yeh discount dynamically apply ho raha hai.\n\n📋 Discounted Menu dekhne ke liye 'menu' likhein ya budget-friendly deals dekhne ke liye 'deals' likhein!`;
            } else {
                // Check if any specific items have individual discounts
                const discountedItems = [];
                (cache.rawCategories || []).forEach(cat => {
                    (cat.menu_items || []).forEach(it => {
                        const itemDisc = calculateDiscount(it.base_price, it.discount_percent, it.discount_fixed, null);
                        if (itemDisc.hasDiscount) {
                            discountedItems.push(`• *${it.name}*: ${itemDisc.formattedFull}`);
                        }
                    });
                });

                if (discountedItems.length > 0) {
                    discountReply = `🎉 *SPECIAL DISCOUNTED ITEMS!*\n\nIn items par special discount chal raha hai:\n${discountedItems.slice(0, 5).join('\n')}\n\n📋 Mukammal menu dekhne ke liye 'menu' ya deals dekhne ke liye 'deals' likhein!`;
                } else {
                    discountReply = `Filhal menu items standard rates par hain, lekin hamare paas bohot zabardast aur discounted *Deals* dastiyab hain! 🎁\n\nDeals dekhne ke liye 'deals' ya menu dekhne ke liye 'menu' likhein!`;
                }
            }

            return {
                handled: true,
                routeName: 'live_discount',
                reply: discountReply,
            };
        } catch (err) {
            console.error('[FAST_ROUTE] Discount error:', err.message);
        }
    }

    // ── 4. Live Menu / Card Images (Strict 3-Tier Image & Text Rules) ──
    const isCardInquiry = /\b(?:card|cards|flyer|flyers|pamphlet|brochure)\b/i.test(lower);
    const isMenuKeyword = FAST_MENU_REGEX.test(lower) || (FAST_MENU_CONTAINS.test(lower) && !lower.includes('deal')) || isCardInquiry;

    if (isMenuKeyword && wordCount <= 15 && !hasCartOrOrderAction) {
        try {
            const cache = await getCatalogCache();

            // ── Tier 1: Check Menu Images (All pages must be sent, NO text dump) ──
            let targetMenuImages = (Array.isArray(cache.menuImageUrls) && cache.menuImageUrls.length > 0)
                ? cache.menuImageUrls
                : (cache.menuImageUrl ? [cache.menuImageUrl] : []);

            if (targetMenuImages.length === 0) {
                try {
                    const { getDbClient } = await import('../db/client.js');
                    const prisma = getDbClient();
                    if (prisma) {
                        const s = await prisma.restaurantSetting.findFirst({
                            where: { key: { in: ['menu_image_urls', 'menu_image_url'] } },
                            orderBy: { updated_at: 'desc' },
                        });
                        if (s?.value) {
                            try {
                                const parsed = JSON.parse(s.value);
                                if (Array.isArray(parsed) && parsed.length > 0) targetMenuImages = parsed.filter(Boolean);
                            } catch (_) {
                                if (s.value.trim()) targetMenuImages = [s.value.trim()];
                            }
                        }
                    }
                } catch (_) {}
            }

            if (targetMenuImages.length === 0 && isCardInquiry) {
                targetMenuImages = (Array.isArray(cache.dealsImageUrls) && cache.dealsImageUrls.length > 0)
                    ? cache.dealsImageUrls
                    : (cache.dealsImageUrl ? [cache.dealsImageUrl] : []);
            }

            if (targetMenuImages.length === 0) {
                targetMenuImages = ['assets/menu/cravey_crust_main_menu.png'];
            }

            const { hasMenuBeenSent, markMenuSent, getSessionOrderDetails } = await import('./sessionService.js');
            const cleanPhone = (whatsappPhone || '').replace(/\D/g, '');
            const isExplicitMenuAsk = FAST_MENU_REGEX.test(lower) || /\b(menu|menue|meny|mainu|card|flyer|list)\b/i.test(lower);
            const menuAlreadySent = userSessionId ? hasMenuBeenSent(userSessionId, cleanPhone) : false;
            const hasShowOrSendMenuWord = /\b(dikhao|dekhao|dikhayein|dikhana|bhejo|bhajo|bhej\s*do|send|share|card|cards|flyer|flyers|photos?|pics?|images?)\b/i.test(lower);
            const isSpecificMenuFilter = !hasShowOrSendMenuWord && /\b(koi|konsa|konse|best|recommend|pizza|burger|fries|drink)\b/i.test(lower);

            if (targetMenuImages.length > 0 && (isExplicitMenuAsk || !menuAlreadySent) && !isSpecificMenuFilter) {
                if (userSessionId) markMenuSent(userSessionId, cleanPhone);
                const currDetails = userSessionId ? getSessionOrderDetails(userSessionId, cleanPhone) : null;
                const menuCaption = 'Cravey Crust ka menu haazir hai! 🍕🍔\n\nBataiye in mein se kya mangwana pasand karenge? 😊';
                return {
                    handled: true,
                    routeName: 'live_menu_images',
                    reply: menuCaption,
                    imageUrls: targetMenuImages,
                    imageUrl: targetMenuImages[0],
                };
            }

            // ── Tier 2: No images, check if active menu categories/items exist in DB ──
            const activeCategories = (cache.rawCategories || []).filter(c => (c.menu_items || []).length > 0);
            if (activeCategories.length > 0) {
                const summaryParts = activeCategories.slice(0, 6).map(c => {
                    const topItems = (c.menu_items || []).slice(0, 3).map(it => `${it.name} (Rs. ${it.base_price})`).join(', ');
                    return `• *${c.name}*: ${topItems}`;
                });
                const conciseMenuText = `🍕 *Cravey Crust Menu Highlights*\n\n${summaryParts.join('\n')}\n\nBataiye in mein se kya cart mein add karun? 😊`;

                return {
                    handled: true,
                    routeName: 'live_menu_text',
                    reply: conciseMenuText,
                    imageUrls: [],
                    imageUrl: null,
                };
            }

            // ── Tier 3: Both images and menu section are empty ──
            return {
                handled: true,
                routeName: 'live_menu_none',
                reply: 'Maazrat! Hamare paas menu mein abhi ke liye kuch nahi hai.',
                imageUrls: [],
                imageUrl: null,
            };
        } catch (_) {}
    }

    // ── 4b. Category-Specific Menu with Picture (On-Demand) ──
    try {
        const { getCategoryWithItems, getActiveCategories } = await import('./menuService.js');
        const { getDefaultRestaurantId } = await import('./restaurantService.js');
        const restId = await getDefaultRestaurantId().catch(() => null);
        const allCats = await getActiveCategories(restId).catch(() => []);

        let targetCat = null;
        if (/^\d{1,2}$/.test(raw) && !hasCartOrOrderAction) {
            const num = parseInt(raw, 10);
            if (num >= 1 && num <= allCats.length) {
                targetCat = await getCategoryWithItems(allCats[num - 1].id, restId);
            }
        } else if (wordCount <= 8 && !hasCartOrOrderAction && !FAST_GREETING_REGEX.test(lower)) {
            // Guard: Do not interrupt active cart checkout with category views unless explicit category request
            let isActivelyCheckingOut = false;
            if (userSessionId) {
                try {
                    const { getActiveCart } = await import('./cartService.js');
                    const cart = await getActiveCart({ sessionKey: userSessionId, restaurantId: restId, chatId });
                    if (cart?.items && cart.items.length > 0) {
                        const isExplicitCatRequest = /\b(?:dikhao|dekhao|bhejo|options|list|menu|category)\b/i.test(lower);
                        if (!isExplicitCatRequest) isActivelyCheckingOut = true;
                    }
                } catch (_) {}
            }

            if (!isActivelyCheckingOut) {
                // Strip filler words: me, mai, mei, mein, men, ka, ke, ki, dikhao, bhejo, options, list, items, kya, kia, kay, kon, konse, konsa, sa, se, hain, hen, ha, hai, hy, dekhna, dein, btao, batao, chahiye, menu, flavor, flavour, available
                const stripped = lower
                    .replace(/\b(?:me|mai|mei|mein|men|ka|ke|ki|dikhao|bhejo|options|list|items?|kya|kia|kay|kon|konse|konsa|sa|se|hain|hen|ha|hai|hy|dekhna|dein|btao|batao|chahiye|menu|flavor|flavors|flavour|flavours|available)\b/gi, '')
                    .replace(/[^\w\s]/g, '')
                    .trim();

                const isAffirmativeOrGreetingShort = /^(?:g|ji|jee|haan?|han|hn|yes|yep|theek|thk|ok|done|sahi|bilkul|hi+|hello+|hey+|salam|aoa)$/i.test(stripped);

                if (stripped && stripped.length >= 3 && !isAffirmativeOrGreetingShort) {
                    const strippedSingular = stripped.replace(/s$/, '');

                    // Handle general "pizza" inquiry: Cravey Crust has Classic Pizzas and Premium Pizzas
                    if (stripped === 'pizza' || strippedSingular === 'pizza') {
                        const classicCat = allCats.find(c => /classic\s*pi[z]+as?/i.test(c.name));
                        const premiumCat = allCats.find(c => /premium\s*pi[z]+as?/i.test(c.name));
                        const [fullClassic, fullPremium] = await Promise.all([
                            classicCat ? getCategoryWithItems(classicCat.id, restId) : null,
                            premiumCat ? getCategoryWithItems(premiumCat.id, restId) : null,
                        ]);

                        if (fullClassic || fullPremium) {
                            const { formatCategoryResponse } = await import('./whatsappOrderOrchestrator.js');
                            const { getGlobalDiscountSettings } = await import('./discountService.js');
                            const cache = await getCatalogCache();
                            const globalDiscount = await getGlobalDiscountSettings(restId).catch(() => null);

                            const parts = [];
                            if (fullClassic) parts.push(formatCategoryResponse(fullClassic, globalDiscount, cache));
                            if (fullPremium) parts.push(formatCategoryResponse(fullPremium, globalDiscount, cache));

                            return {
                                handled: true,
                                routeName: 'category_menu_all_pizzas',
                                reply: `${parts.join('\n\n')}\n\n_Sizes: Small (Rs. 599/699), Medium (Rs. 1199/1399), Large (Rs. 1599/1799), Party Size (Rs. 2499/2799)_\nOrder karne ke liye kisi bhi pizza ka naam aur size bata dein (jaise *Chicken Tikka Medium* ya *Chicken Extreme Large*)!`,
                                imageUrl: (fullPremium?.image_url || fullClassic?.image_url || 'assets/menu/cravey_crust_main_menu.png'),
                            };
                        }
                    }

                    // 1. Exact match against category name or slug
                    for (const c of allCats) {
                        const cName = c.name.toLowerCase();
                        const cSlug = c.slug.toLowerCase();
                        const cSingular = cName.replace(/s$/, '');
                        if (stripped === cName || stripped === cSlug || stripped === cSingular || strippedSingular === cSingular) {
                            targetCat = await getCategoryWithItems(c.id, restId);
                            break;
                        }
                    }

                    // 2. Word boundary match: e.g. "wings" matches "Wings", but "hi" does not match "Chicken Box"
                    if (!targetCat) {
                        const escapeReg = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        const matches = allCats.filter(c => {
                            const cName = c.name.toLowerCase();
                            const cSlug = c.slug.toLowerCase();
                            const wordRegex = new RegExp(`\\b${escapeReg(stripped)}\\b`, 'i');
                            const wordSingularRegex = new RegExp(`\\b${escapeReg(strippedSingular)}\\b`, 'i');
                            return wordRegex.test(cName) || wordSingularRegex.test(cName) || cSlug === stripped || cSlug === strippedSingular;
                        });

                        if (matches.length > 0) {
                            // Prioritize category that has an uploaded image!
                            const withImg = matches.find(c => Boolean(c.image_url));
                            targetCat = await getCategoryWithItems((withImg || matches[0]).id, restId);
                        }
                    }

                    // 3. Reverse word match: e.g. text contains category name as whole word
                    if (!targetCat) {
                        const escapeReg = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        for (const c of allCats) {
                            const cName = c.name.toLowerCase();
                            const cSingular = cName.replace(/s$/, '');
                            if (cName.length >= 4 && (new RegExp(`\\b${escapeReg(cName)}\\b`, 'i').test(lower) || new RegExp(`\\b${escapeReg(cSingular)}\\b`, 'i').test(lower))) {
                                targetCat = await getCategoryWithItems(c.id, restId);
                                break;
                            }
                        }
                    }
                }
            }
        }

        if (targetCat) {
            const { formatCategoryResponse } = await import('./whatsappOrderOrchestrator.js');
            const { getGlobalDiscountSettings } = await import('./discountService.js');
            const cache = await getCatalogCache();
            const globalDiscount = await getGlobalDiscountSettings(restId).catch(() => null);
            const catReply = formatCategoryResponse(targetCat, globalDiscount, cache);

            return {
                handled: true,
                routeName: 'category_menu_display',
                reply: catReply,
                imageUrl: targetCat.image_url || 'assets/menu/cravey_crust_main_menu.png',
            };
        }
    } catch (_) {}

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
                reply: `Koi masla nahi Ji! Naya address kya rakhna chahenge? Baraye meherbani apna naya mukammal delivery address (ya WhatsApp Location Pin) yahan likh kar bhej dein taake hum update kar dein! 📍`,
            };
        } catch (_) {}
    }

    // ── 6. Store Location & Address (Zero Tokens, live from Settings) ──
    const isStandaloneAreaName = ADDRESS_INDICATORS.test(lower) && wordCount <= 12 &&
        !/\b(?:menu|deals?|catalog|rate|price|timing|timings|hours|easypaisa|payment|cod|cancel|status)\b/i.test(lower) &&
        !/\b(?:kahan|kidhar|outlet|shop|restaurant|branch)\s*(?:hai|h|hy|hotay?)\b/i.test(lower);

    const hasCustomerDeliveryLocation = !isAddressChangeRequest && Boolean(
        /maps\.google\.com|goo\.gl|maps\.app\.goo\.gl|lat=\s*-?\d+|lng=\s*-?\d+/i.test(raw) ||
        /^(?:customer\s*ne\s*location|location\s*pin|meri\s*location|mera\s*ad(?:d)?re(?:e)?s(?:s)?|delivery\s*ad(?:d)?re(?:e)?s(?:s)?|ad(?:d)?re(?:e)?s(?:s)?|pata|yahan\s*deliver|yahan\s*order|idr)/i.test(lower) ||
        isStandaloneAreaName
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
            // Strip common prefixes like "location:", "address:", "pata:" etc. and conversational prefixes/suffixes
            let strippedRaw = cleanExtractedAddress(raw) || raw.replace(/^(?:location|address|pata|meri\s*location|delivery\s*address|mera\s*address)\s*[:=-]?\s*/i, '').trim();
            strippedRaw = strippedRaw.replace(/^(?:aoa|salam|assalam\s*o?\s*alaikum|hello|hi|hey)?\s*(?:ustaad|bhai|yaar|yar|bhai\s*jan|janab|paji)?\s*/i, '').trim();
            strippedRaw = strippedRaw.replace(/\s*(?:mein|me|pe|par|per)?\s*(?:delivery\s*(?:hogi|hosi|hai|ha|ho\s*sakti|mil\s*jayegi|karty|krty|available|ho\s*skty|h skti|krni|karni|krna|karna|karwana|krwana)|deliver\s*(?:ho\s*jaye\s*ga|hoga|ho\s*sakta))\s*\??$/i, '').trim();
            const formattedRaw = formatAddressTitle(cleanExtractedAddress(strippedRaw) || strippedRaw);
            // Prefer Google Maps URL (cleaner display), then formattedAddress, then stripped raw
            const addressStr = loc?.mapUrl || (loc?.formattedAddress && !isStandaloneAreaName ? loc.formattedAddress : formattedRaw) || formattedRaw || strippedRaw || raw;

            const isPin = loc?.latitude != null && loc?.longitude != null;

            // Validate delivery radius against settings BEFORE saving
            const { checkDeliveryAvailability } = await import('./deliveryService.js');
            const delCheck = await checkDeliveryAvailability({
                restaurantId: cache?.restId,
                address: (!isPin ? addressStr : null),
                latitude: loc?.latitude,
                longitude: loc?.longitude,
            });

            if (!delCheck.available) {
                return {
                    handled: true,
                    routeName: 'customer_location_out_of_range',
                    reply: `${delCheck.message}\n\nLekin aap hamare Ghauri Town outlet se *Takeaway / Self-Pickup* karwa sakte hain! 🏪\nKya aap takeaway order karna chahenge?`,
                };
            }

            // Always save verified in-range location to session
            const details = updateSessionOrderDetails(userSessionId, {
                address: addressStr,
                location: loc,
                locationConfirmed: true,
                locationAwaitingConfirmation: false,
            }, cleanPhone);

            // Try to get cart
            let cart = null;
            try {
                cart = await getActiveCart({ sessionKey: userSessionId, restaurantId: cache.restId, chatId });
            } catch (_) {}

            const distText = delCheck.distanceKm != null ? ` (approx. ${delCheck.distanceKm} km door)` : '';
            const maxR = delCheck.maxRadiusKm || cache?.maxDeliveryRadiusKm || 10;

            if (cart?.items && cart.items.length > 0) {
                return await getNextCheckoutStepResponse({
                    details,
                    whatsappPhone,
                    cart,
                    cache,
                    introMessage: isPin ? '' : `Zabardast ${details.name ? details.name + ' bhai! ' : ''}Aap ki location (*${addressStr.slice(0, 80)}*) hamari ${maxR} KM delivery range ke andar hai${distText}! 📍`,
                });
            } else {
                // Cart is empty — location verified within radius!
                return {
                    handled: true,
                    routeName: 'location_saved_no_cart',
                    reply: `Zabardast! Aap ki delivery location (*${addressStr.slice(0, 80)}*) hamari delivery range ke andar hai${distText}! 🚚\n📍 Address note kar liya hai ✅\n\nAb bataiye aaj Cravey Crust se kya mangwana chahenge? Menu dekhne ke liye 'menu' ya deals dekhne ke liye 'deals' likhein!`,
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
                return await getNextCheckoutStepResponse({
                    details,
                    whatsappPhone,
                    cart,
                    cache,
                    introMessage: (detailsBeforeUpdate.paymentMethod && detailsBeforeUpdate.paymentMethod !== paymentMethod)
                        ? `Theek hai ${details.name ? details.name + ' bhai! ' : ''}Payment method update kar diya hai (*${paymentMethod === 'COD' ? 'Cash on Delivery (COD)' : 'EasyPaisa'}*). 💵`
                        : `Theek hai ${details.name ? details.name + ' bhai! ' : ''}Payment method *${paymentMethod === 'COD' ? 'Cash on Delivery (COD)' : 'EasyPaisa'}* note kar liya hai.`,
                });
            } else {
                // Cart is empty but we've saved the payment — acknowledge it
                const missing = [];
                if (!details.name) missing.push('• Aap ka Naam (Name)');
                if (!details.address && !details.location) missing.push('• Mukammal Delivery Address (ya WhatsApp Location Pin)');
                if (missing.length > 0) {
                    return {
                        handled: true,
                        routeName: 'payment_selected_no_cart',
                        reply: `Theek hai Ji! Payment method *${paymentMethod === 'COD' ? 'Cash on Delivery (COD)' : 'EasyPaisa'}* note kar liya hai.\n\nOrder karne ke liye pehle koi item ya deal select karein (menu ya deals likhein). Agar aapne pehle koi item select kiya tha to mujhe batayein!`,
                    };
                }
                // All details present but cart empty — just acknowledge
                return {
                    handled: true,
                    routeName: 'payment_selected_no_cart',
                    reply: `Theek hai Ji! Payment method *${paymentMethod === 'COD' ? 'Cash on Delivery (COD)' : 'EasyPaisa'}* note kar liya hai. Ab koi item ya deal select karein taake order place ho sake!`,
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
            const rawStore = cache.storeName || '';
            const store = (!rawStore || /store\s*admin|admin|default/i.test(rawStore)) ? 'Cravey Crust' : rawStore;
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

    // ── 9. Quick Reply: Greeting (Dynamic Store Name & Language-Aware Persona) ──
    if (FAST_GREETING_REGEX.test(lower)) {
        try {
            const cache = await getCatalogCache();
            const rawStore = cache.storeName || '';
            const store = (!rawStore || /store\s*admin|admin|default/i.test(rawStore)) ? 'Cravey Crust' : rawStore;

            let salutation = 'Assalam o Alaikum!';
            if (/^(?:hi+|hello+|hey+|helo+|hellow+)\b/i.test(lower)) {
                salutation = 'Hello!';
            } else if (/salam|assalam|aoa/i.test(lower)) {
                salutation = 'Walaikum Assalam!';
            }

            return {
                handled: true,
                routeName: 'quick_reply',
                reply: `${salutation} *${store}* mein khush aamdeed! Main *${store}* ka AI assistant hoon. Kahiye, aaj aap ke liye kya order ready karoon? Hamara menu dekhne ke liye *'menu'* ya deals dekhne ke liye *'deals'* likhein! 😊_`,
            };
        } catch (_) {
            return {
                handled: true,
                routeName: 'quick_reply',
                reply: 'Hello! *Cravey Crust* mein khush aamdeed! Main *Cravey Crust* ka AI assistant hoon. Kahiye, aaj aap ke liye kya order ready karoon? Hamara menu dekhne ke liye \'menu\' ya deals dekhne ke liye \'deals\' likhein! 😊',
            };
        }
    }

    // ── 10. Quick Reply: Chitchat (Dynamic Store Name) ──
    if (FAST_CHITCHAT_REGEX.test(lower) && wordCount <= 6) {
        try {
            const cache = await getCatalogCache();
            const rawStore = cache.storeName || '';
            const store = (!rawStore || /store\s*admin|admin|default/i.test(rawStore)) ? 'Cravey Crust' : rawStore;
            return {
                handled: true,
                routeName: 'quick_reply',
                reply: `Alhamdulillah main bilkul theek hoon! Main *${store}* ka official AI assistant hoon. Aaj koi lazeez khana mangwana hai? Hamara menu dekhne ke liye *'menu'* ya *'deals'* likhein! 😊`,
            };
        } catch (_) {
            return {
                handled: true,
                routeName: 'quick_reply',
                reply: 'Alhamdulillah main bilkul theek hoon! Main *Cravey Crust* ka official AI assistant hoon. Aaj koi lazeez khana mangwana hai? Hamara menu dekhne ke liye \'menu\' ya \'deals\' likhein! 😊',
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
                reply: `Shukriya! Hum *${store}* par hamesha behtareen aur lazeez khana dene ki koshish karte hain.\n\nAap apna qeemti feedback aur 5-star review is Google link par de sakte hain:\n⭐ ${reviewUrl}\n\nShukriya!`,
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
            reply: 'Nahi Ji! Main sirf Roman Urdu, Urdu aur English samajhta hoon aur inhi mein baat kar sakta hoon. 😊\n\nBataiye, Cravey Crust se aaj kya order lagana hai? Mazedaar pizzas ya juicy burgers? Hamara menu dekhne ke liye \'menu\' ya \'deals\' likhein!',
        };
    }

    // ── 15. Quick Reply: Standalone Affirmative / Filler (e.g. "jee", "haan", "theek hai", "ok") ──
    const isStandaloneAffirmative = /^(?:jee?|ji|g|haan|han|hn|yes|theek\s*hai?|theek\s*hy|thk\s*hai?|thk\s*hy|ok|okay|acha|achha)[\s.!?]*$/i.test(lower.trim());
    if (isStandaloneAffirmative && wordCount <= 2) {
        try {
            const cache = await getCatalogCache();
            const rawStore = cache.storeName || '';
            const store = (!rawStore || /store\s*admin|admin|default/i.test(rawStore)) ? 'Cravey Crust' : rawStore;
            let cart = null;
            if (userSessionId) {
                try {
                    const { getActiveCart } = await import('./cartService.js');
                    cart = await getActiveCart({ sessionKey: userSessionId, restaurantId: cache.restId, chatId });
                } catch (_) {}
            }
            if (cart?.items && cart.items.length > 0) {
                const { getSessionOrderDetails } = await import('./sessionService.js');
                const cleanPhone = (whatsappPhone || '').replace(/\D/g, '');
                const details = getSessionOrderDetails(userSessionId, cleanPhone);
                return await getNextCheckoutStepResponse({
                    details,
                    whatsappPhone,
                    cart,
                    cache,
                });
            } else {
                return {
                    handled: true,
                    routeName: 'quick_reply_affirmative',
                    reply: `Ji farmayein! Aaj *${store}* se kya mangwana chahenge? Mazaydaar pizzas ya crispy burgers? Hamara menu dekhne ke liye 'menu' ya deals dekhne ke liye 'deals' likhein!`,
                };
            }
        } catch (_) {
            return {
                handled: true,
                routeName: 'quick_reply_affirmative',
                reply: `Ji farmayein! Aaj *Cravey Crust* se kya mangwana chahenge? Mazaydaar pizzas ya crispy burgers? Hamara menu dekhne ke liye 'menu' ya deals dekhne ke liye 'deals' likhein!`,
            };
        }
    }

    return { handled: false };
}


