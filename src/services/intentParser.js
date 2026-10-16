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

// Session memory for pizza/item size follow-ups (e.g. customer saying "medium", "party krdo")
const _lastDiscussedItemBySession = new Map();

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
    // Expire after 3 minutes
    if (Date.now() - entry.timestamp > 3 * 60 * 1000) {
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

export function cleanExtractedAddress(text) {
    if (!text || typeof text !== 'string') return null;
    let cleaned = text.trim();

    // 1. Strip leading labels like "address:", "mera pata:", "delivery address:", "location:"
    cleaned = cleaned.replace(/^(?:delivery\s*ad(?:d)?re(?:e)?s(?:s)?|mera\s*ad(?:d)?re(?:e)?s(?:s)?|meri\s*location|apna\s*pata|ad(?:d)?re(?:e)?s(?:s)?|pata|location)\s*[:=-]?\s*/i, ' ');

    // 2. Canonical mapping for common typos and delivery areas
    cleaned = cleaned.replace(/\b(?:khann?a)\s+(?:pull?l?|pool|pol)\b/gi, 'Khana Pull');
    cleaned = cleaned.replace(/\b(?:khana|khanna)\s*pull?l?\b/gi, 'Khana Pull');
    cleaned = cleaned.replace(/\b(?:ghori|gauri|ghawri)\s+town\b/gi, 'Ghauri Town');
    cleaned = cleaned.replace(/\b(?:tarlay|terlai)\b/gi, 'Tarlai');
    cleaned = cleaned.replace(/\b(?:tarmari|taramary)\b/gi, 'Taramari');
    cleaned = cleaned.replace(/\b(?:sanam\s+chow?k)\b/gi, 'Sanam Chok');

    // 3. Remove conversational filler phrases only when combined with action verbs
    cleaned = cleaned.replace(/\b(?:ye|yeh|is|mera|apna|sab)?\s*(?:deals?|order|items?)\s*(?:bhi)?\s*(?:parcel|deliver|delivery|bhej|bhejo|send|pack)\s*(?:krdo|kardo|kar\s*do|kr\s*do|kr\s*du|kar\s*du|karo|kro|krna|karna|karein|chahiye)?\s*(?:ha|hai|h|ho)?\b/gi, ' ');
    cleaned = cleaned.replace(/\b(?:khana)\s+(?:bhi\s+)?(?:deliver|parcel|bhej|bhejo|send|pack)\s*(?:krdo|kardo|kar\s*do|kr\s*do|karo|kro|karein|chahiye)?\b/gi, ' ');
    cleaned = cleaned.replace(/\b(?:mein|me|mai|mei|mn|par|pe|ko)\s+(?:delivery\s+)?(?:krni|karni|h|hai|karein)\b/gi, ' ');
    cleaned = cleaned.replace(/\b(?:deliver|delivery|parcel|bhej|bhejo|send|pack)\s*(?:krdo|kardo|kar\s*do|kr\s*do|kr\s*du|kar\s*du|kro|karo|krna|karna)?\s*(?:ha|hai|h)?\b/gi, ' ');
    cleaned = cleaned.replace(/\b(?:bhej\s*do|kar\s*do|kr\s*do|kar\s*du|kr\s*du|bhejo|kardo|krdo|dein)\b/gi, ' ');
    cleaned = cleaned.replace(/\b(?:idhar|idr|yahan|wahan)\s+(?:deliver|bhej|kardo|krdo)\b/gi, ' ');
    cleaned = cleaned.replace(/\b(?:krni|karni|krna|karna)\s+(?:ha|hai|h|he|hy|chahiye)\b/gi, ' ');
    cleaned = cleaned.replace(/\b(?:deliver|delivery|parcel|bhejna|bhej)\b/gi, ' ');
    cleaned = cleaned.replace(/\b(?:same\s*(?:number|numbr|no|whatsapp)?|num(?:br|ber)?\s*sam(?:e)?(?:\s*(?:ryga|rhega|rahega))?|easypaisa|easy\s*paisa|ep|cod|cash\s*on\s*delivery|cash|payment\s*(?:method)?)\b/gi, ' ');

    cleaned = cleaned.replace(/^[,\s.-]+|[,\s.-]+$/g, '').replace(/\s+/g, ' ').trim();
    if (!cleaned || cleaned.length < 3 || /^(?:krna|karna|krni|karni|kar\s*do|kr\s*do|kardo|krdo|ha|hai|hy|h|he|chahiye|ho|badalna|change|update)$/i.test(cleaned)) {
        return null;
    }
    return cleaned;
}

// Comprehensive delivery location indicator regex covering all official delivery areas
export const ADDRESS_INDICATORS = /\b(town|phase|sector|street|gali|house|guest\s*house|makan|flat|block|road|chowk|chok|pul|pull|pulll|pool|colony|scheme|market|plaza|nearby|near|islamabad|rawalpindi|pindi|tarlai|khanna|khana|ghauri|ghori|sohan|korang|i-8|i-9|i-10|g-8|g-9|g-10|g-11|f-8|f-9|f-10|f-11|pwd|bahria|dha|burma|shakral|shakrial|zia|bilal|madina|sarfraz|sharifabad|malik|marwa|basit|albadar|karachi\s*house|juma\s*bazar|school\s*stop|dakhana|tali\s*mor|rehman\s*enclave|zamna|p-v|sudran|mehrban|chistiyan|gulberg|gulzar)\b/i;

// Words strictly excluded from customer name extraction (location indicators, greetings, action words)
export const NOT_NAME_REGEX = /\b(hlo|hlw|hy|helo|hellow|hi|hello|hey|salam|slam|assalam|aoa|assalamualaikum|suno|oye|yo|krdo|kardo|kar\s*do|kr\s*do|karo|kro|kar|kr|karna|krna|karein|chahiye|mangwao|mangwana|pack|parcel|send|bhej|bhejo|theek|thk|thek|done|ok|okk|okay|sure|yes|yup|yep|haan|han|hn|ha|g|ji|jee|no|nahi|nhi|nh|nai|na|mat|cancel|cancle|kansil|payment|cod|cash|easypaisa|easy|paisa|delivery|address|location|pata|order|deal|deals|pizza|burger|menu|meny|menue|mainu|mainue|dikhao|dijhao|dikaho|dekhao|dikhayein|dikhana|dikha|btao|batao|bhejna|kase|kaise|kese|scene|hal|haal|rate|list|kya|kia|hy|hain|hen|dein|bhai|bhaiya|bhae|bhi|sain|sir|bro|madam|khan|food|water|drink|bill|kam|ja|hai|mera|meara|method|party|small|medium|large|reg|regular|can|liter|litre|1\.5l|1l|flavor|flavour|crust|cheese|extreme|peri|behari|tikka|fajita|supreme|tandoori|same|yahi|yehi|wahi|isi|number|numbr|num|hoo|ho|hu|hun|hoon|jigri|town|phase|sector|street|gali|house|makan|flat|block|road|chowk|chok|pul|pull|pulll|colony|scheme|market|plaza|islamabad|rawalpindi|pindi|tarlai|khanna|khana|ghauri|ghori|sohan|korang|burma|shakral|shakrial|zia|bilal|madina|sarfraz|sharifabad|malik|marwa|basit|albadar|dakhana|rehman|gulberg|gulzar)\b/i;

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
    const isExplicitSamePhone = /\b(?:same\s*(?:number|numbr|no|whatsapp)|yahi\s*(?:number|numbr|no)|yehi\s*(?:number|numbr|no)|isi\s*number|wahi\s*(?:number|numbr|no)|num(?:br|ber)?\s*sam(?:e)?(?:\s*(?:ryga|rhega|rahega))?)\b/i.test(lower);
    const isAwaitingPhone = knownDetails.name && !knownDetails.phoneConfirmed && !knownDetails.phone;
    const isContextualSamePhone = isAwaitingPhone && /^(?:same|same\s*whatsapp|yahi|yehi|wahi|isi\s*pe|yahi\s*hai|yehi\s*hai|yahi\s*number|yehi\s*number|isi\s*number)[\s.!?]*$/i.test(lower.trim());

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
            // Any sequence of 7+ digits provided in context of checkout
            const anyDigitsMatch = raw.match(/\b([+\d]{7,16})\b/);
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

    // 3. Name (Strictly excluded if matches location indicators, greetings, or known action words)

    // Explicit name change or assignment patterns (supports "kr du", "kar du", "naam hatim", "mera naam hatim", etc.)
    const nameUpdateMatch = raw.match(/\b(?:naam|name|nam)\s*(?:bhi\s*)?(?:badal\s*(?:k\s*|ke\s*)?(?:do|dein|karo|kr\s*do|kar\s*do|kr\s*du|kar\s*du)?|change\s*(?:kr\s*k\s*|kar\s*k\s*|karke\s*)?(?:do|dein|karo|krna|karna|kr\s*du|kar\s*du)?|update\s*(?:kr\s*k\s*|kar\s*k\s*|karke\s*)?(?:do|dein|karo|krna|karna|kr\s*du|kar\s*du)?|rakh\s*(?:do|dein|lo|karo|du)?|likh\s*(?:do|dein|lo|karo|du)?|kar\s*(?:do|dein|karo|du)?|kr\s*(?:do|dein|kro|du)?|ab\s+|(?:\b(?:hai|he|hy|h)\b)|:|=|-|\s+)\s*([A-Za-z]{2,20}(?:\s+[A-Za-z]{2,20})*)/i) ||
                           raw.match(/\b(?:meara|mera|apna)\s*(?:naam|name|nam)\s*(?:ab\s*)?([A-Za-z]{2,20}(?:\s+[A-Za-z]{2,20})*)/i) ||
                           raw.match(/\b(?:pehle\s+.*?\s+tha\s+ab\s+|nahi\s+)([A-Za-z]{2,20}(?:\s+[A-Za-z]{2,20})*)/i) ||
                           raw.match(/^(?:ab\s+)?([A-Za-z]{2,20})\s*(?:kar\s*do|kr\s*do|kardo|krdo|rakh\s*do|rakhdo|likh\s*do|likhdo|rakh\s*lo|rakho|likho|kar\s*dein|kr\s*dein|kar\s*du|kr\s*du)/i);

    const nameBefore = raw.match(/\b([A-Za-z]{2,20}(?:\s+[A-Za-z]{2,20}){0,2})\s+(?:meara|mera)\s+(?:name|naam)\b/i);
    const nameAfter = raw.match(/\b(?:meara|mera|apna)\s+(?:naam|name|nam)\s*(?:\b(?:is|hai|he|hy|h)\b|:|=|-)?\s*([A-Za-z]{2,20}(?:\s+[A-Za-z]{2,20}){0,2})\b/i) ||
                      raw.match(/\b(?:naam|name|nam)\s*[:=-]\s*([A-Za-z]{2,20}(?:\s+[A-Za-z]{2,20}){0,2})\b/i);

    let nameCandidate = (nameUpdateMatch ? nameUpdateMatch[1] : (nameBefore ? nameBefore[1] : (nameAfter ? nameAfter[1] : null)))?.trim();
    if (nameCandidate) {
        // Strip leading common prefixes e.g. "same ", "wahi ", "yehi ", "yahi ", "naam ", "kr du ", "kar du "
        nameCandidate = nameCandidate.replace(/^(?:same|wahi|yahi|yehi|isi|naam|nam|mera|apna|kr\s*du|kar\s*du|likh\s*du|rakh\s*du)\s+/i, '').trim();
        // Strip trailing sentence filler e.g. "bki sari details same ha", "baki sab same hai"
        nameCandidate = nameCandidate.replace(/\s+(?:bki|baqi|baki|sari|details|sab|same|ha|hai|h|he|hy).*$/i, '').trim();
        // Strip trailing action verbs/honorifics
        nameCandidate = nameCandidate.replace(/\s+(?:kar\s*do|kr\s*do|kardo|krdo|rakh\s*do|rakhdo|likh\s*do|likhdo|rakh\s*lo|rakho|likho|kar\s*dein|kr\s*dein|kar\s*du|kr\s*du|karo|kro|hai|ha|h|he|hy|ja|tha|bhai|sir|jee|ji)$/i, '').trim();
    }
    // Bare-string direct name check (e.g. user replies "Ali", "Ali Khan", "same hatim", "asim bki sari details...")
    const isMenuOrQueryWord = /\b(?:menu|menue|meny|mainu|mainue|catalog|catlog|rate|list|dikhao|dekhao|dikhayein|batao|bhejo|kase|kaise|kese|haal?|scene)\b/i.test(lower);
    if (!nameCandidate && !paymentMethod && !phone && !invalidPhone && !ADDRESS_INDICATORS.test(lower) && !isMenuOrQueryWord) {
        const isGreetingOrFiller = /^(?:hlo|hlw|hy|helo|hellow|hi|hello|hey|salam|slam|assalam|aoa|assalamualaikum|suno|oye|yo|bhai|sir|bro)[\s.!?]*$/i.test(raw.trim());
        if (!isGreetingOrFiller) {
            let direct = raw.trim().replace(/^(?:same|wahi|yahi|yehi|isi)\s+/i, '').trim();
            direct = direct.replace(/\s+(?:bki|baqi|baki|sari|details|sab|same|ha|hai|h|he|hy).*$/i, '').trim();
            const directMatch = direct.match(/^([A-Za-z]{2,20}(?:\s+[A-Za-z]{2,20})?)$/);
            if (directMatch && !NOT_NAME_REGEX.test(directMatch[1])) {
                nameCandidate = directMatch[1].trim();
            }
        }
    }
    if (nameCandidate && !NOT_NAME_REGEX.test(nameCandidate)) {
        name = nameCandidate.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
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
        const potentialAddr = cleanExtractedAddress(textForAddr);
        if (potentialAddr && (ADDRESS_INDICATORS.test(potentialAddr) || potentialAddr.length >= 4) && potentialAddr.length <= 120) {
            address = potentialAddr;
        }
    } else if (knownDetails.name && (knownDetails.phoneConfirmed || knownDetails.phone) && !knownDetails.address && !paymentMethod && !phone) {
        // Customer is actively at Step 3 (awaiting delivery address).
        const candidateAddr = cleanExtractedAddress(textForAddr);
        const isNotAddress = /^(?:menu|deals?|cancel|khatam|band|nahi|nahin|nhi|na|no|nope|theek|ok|done|hi|hello|hey|suno|bhai)\b/i.test(lower.trim());
        if (candidateAddr && candidateAddr.length >= 3 && candidateAddr.length <= 120 && !isNotAddress) {
            address = candidateAddr;
        }
    }

    if (address) {
        address = cleanExtractedAddress(address);
        if (address && address.length < 3) {
            address = null;
        }
    }

    return { name, paymentMethod, phone, address, invalidPhone };
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
    return addr;
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

    // STEP 2: Phone Confirmation
    if (!details.phoneConfirmed && !details.phone) {
        return {
            handled: true,
            routeName: 'step_phone_needed',
            step: 'PHONE',
            reply: (introMessage ? `${introMessage}\n\n` : '') +
                `Shukriya ${customerName}! Rabtay ke liye rider ko yahi WhatsApp number (*${displayPhone}*) dein ya koi doosra contact number likhna hai?`,
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

    // STEP 3b: Location Confirmation (If GPS location shared but not yet confirmed by customer)
    if (details.location?.latitude != null && details.location?.longitude != null && !details.locationConfirmed) {
        details.locationAwaitingConfirmation = true;
        const lat = details.location.latitude;
        const lng = details.location.longitude;
        const mapUrl = `https://www.google.com/maps?q=${lat},${lng}`;
        return {
            handled: true,
            routeName: 'step_location_confirm_needed',
            step: 'LOCATION_CONFIRM',
            reply: (introMessage ? `${introMessage}\n\n` : '') +
                `${customerName ? customerName + ' bhai, ' : ''}aap ki delivery location receive ho gayi hai.\n` +
                `📍 Location: [Google Maps par apni location dekhein](${mapUrl})\n\n` +
                `Kya delivery isi location par karwani hai? Baraye meherbani “Haan” ya “Nahi” mein confirm kar dein.`,
        };
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

    const orderItems = (cart?.items || []).map(i => {
        const n = i.deal ? i.deal.name : (i.menu_item?.name || 'Item');
        const v = i.menu_variant ? ` (${i.menu_variant.name})` : '';
        return `${i.quantity}x ${n}${v}`;
    }).join('\n');
    const orderBlock = (cart?.items || []).length === 1 ? `Order: ${orderItems}` : `Order:\n${orderItems}`;

    const subtotal = (cart?.items || []).reduce((s, i) => s + Number(i.deal?.deal_price ?? i.menu_variant?.price ?? i.menu_item?.base_price ?? i.unit_price ?? 0) * i.quantity, 0);

    let deliveryFee = 0;
    let deliveryFeeKnown = false;
    if (cache?.restId && (details.address || details.location)) {
        try {
            const { checkDeliveryAvailability } = await import('./deliveryService.js');
            const dCheck = await checkDeliveryAvailability({
                restaurantId: cache.restId,
                address: details.address || details.location?.address,
                latitude: details.location?.latitude,
                longitude: details.location?.longitude,
                subtotal,
            });
            if (dCheck?.available && typeof dCheck.deliveryFee === 'number') {
                deliveryFee = dCheck.deliveryFee;
                deliveryFeeKnown = true;
            }
        } catch (_) {}
    }
    const total = subtotal + deliveryFee;
    const cleanLocation = formatLocationDisplay(details);

    return {
        handled: true,
        routeName: 'final_order_summary',
        step: 'CONFIRMATION',
        reply: (introMessage ? `${introMessage}\n\n` : '') +
`${customerName ? customerName + ' bhai, ' : ''}aap ke order ki final details ye hain:
${orderBlock || 'Order: 1x Item'}
Total: Rs. ${total.toLocaleString('en-PK')}
Delivery Charges: ${deliveryFee === 0 ? 'Free' : 'Rs. ' + deliveryFee.toLocaleString('en-PK')}
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

const FAST_GREETING_REGEX = /^(salam|assalam|assalamualaikum|assalam\s*o\s*alaikum|aoa|slam|hi+|hello+|hey+|hlo+|hlw+|hy+|helo+|hellow+|bhai|suno|oye|yo)[\s!?.]*$/i;
const FAST_CHITCHAT_REGEX = /\b(?:k[ae]se\s*(?:h[oi]|ho|hain|hen|h|hy)|kaise\s*(?:h[oi]|ho|hain|hen|h|hy)|k[yi]a\s*ha?al\s*(?:hai|h|hy|hain)?|how\s*are\s*you|sab\s*(?:theek|thk|kheriat|khairiat)|theek\s*ho|k[yi]a\s*scene\s*(?:hai|h|hy))\b/i;
const FAST_THANKS_REGEX = /^(thanks|thank you|shukriya|shukria|jazakallah|jazak allah)[\s!?.]*$/i;
const FAST_OFF_TOPIC_REGEX = /\b(cricket|psl|imran|nawaz|politics|siyasat|mausam|weather|joke|lateefa|shayari|movie|film|coding|python|javascript)\b/i;

const FAST_MENU_REGEX = /^(?:(?:show\s+)?(?:menu|menue|meny|mainu|mainue|catalog|catlog)(?:\s*(?:dikhao|dijhao|dikaho|dekhao|dikhayein|bhejo|bhej\s*do|send|btao|batao|list|card|do|plz|please))?|rate\s*list|food\s*list|items?\s*list|list\s*(?:dikhao|bhejo|dekhao)|(?:kya\s*kya|kya|kia)\s*(?:milta|hai|h|hy|items?\s*hain?|available\s*hai)|apke\s*pas\s*(?:kya\s*kya|kya)\s*(?:hai|h|hy))[\s.!?]*$/i;
const FAST_MENU_CONTAINS = /\b(menu|menue|meny|mainu|mainue|catalog|catlog|rate\s*list|food\s*list|items?\s*list)\b/i;

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

    // Food order action: customer wants to ADD or ORDER specific food items (should not be intercepted by menu/info views)
    const hasCartOrOrderAction = /\b(add\s+to\s+cart|cart\s*(?:m|me|mai|mein)|checkout|check\s*out|daal\s*do|cancel\s+order|bar\s*(?:kr|kar)\s*do|sari\s+deals?|har\s+deal)\b/i.test(lower) ||
        /^(?:add|order)\s+\d+/i.test(lower) ||
        /^\d+\s*(?:x\s+)?(?:pizza|burger|deal|zinger|roll)/i.test(lower);

    // ── Check Fast Follow-up: Affirmative confirmation of pending Order Summary ──
    const userSessionId = sessionKey || chatId || whatsappPhone;

    // ── Check Fast Route: Order Cancellation / Cart Clear (Zero Tokens) ──
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
            const cache = await getCatalogCache();
            const cleanPhone = (whatsappPhone || '').replace(/\D/g, '');
            const cart = await getActiveCart({ sessionKey: userSessionId, restaurantId: cache.restId, chatId });

            // 1. If active cart has items, clear cart & session
            if (cart?.items && cart.items.length > 0) {
                await clearCart({ sessionKey: userSessionId });
                clearSessionOrderDetails(userSessionId, cleanPhone);
                _lastDiscussedDealBySession.delete(userSessionId);
                _lastDiscussedItemBySession.delete(userSessionId);
                return {
                    handled: true,
                    routeName: 'fast_cancel_cart',
                    reply: `Theek hai Ji! Aap ka cart khali kar diya gaya hai aur order cancel ho gaya hai. 👍\n\nJab bhi dobara bhook lagay ya kuch lazeez khana ho, bas 'menu' ya 'deals' likh kar bhej dein! 😊`,
                };
            }

            // 2. Active cart is empty: resolve placed order to cancel
            const { cancelOrder } = await import('./orderService.js');
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

            if (!targetOrder) {
                return {
                    handled: true,
                    routeName: 'fast_cancel_not_found',
                    reply: `Aap ka koi active order ya cart mein koi item nahi mila jise cancel kiya ja sake. Agar aap ne kisi aur number se order kiya tha to baraye meherbani apna Order Number (jaise #CC-123456) likh kar bhej dein. 😊`,
                };
            }

            const custName = targetOrder.customer_name ? `${targetOrder.customer_name} bhai` : 'Ji';

            // Case A: Already Cancelled (Idempotent response)
            if (targetOrder.order_status === 'CANCELLED') {
                return {
                    handled: true,
                    routeName: 'fast_cancel_already_cancelled',
                    reply: `Ji ${custName}, aap ka order *#${targetOrder.order_number}* pehle hi cancel ho chuka hai! 👍\n\nAgar aap dobara kuch naya mangwana chahein ya koi aur madad chahiye ho, toh zaroor bataiyega. Main hamesha aap ki khidmat ke liye hazir hoon! 😊`,
                };
            }

            // Case B: Delivered / Completed
            if (targetOrder.order_status === 'DELIVERED' || targetOrder.order_status === 'COMPLETED') {
                return {
                    handled: true,
                    routeName: 'fast_cancel_already_delivered',
                    reply: `Aap ka order *#${targetOrder.order_number}* pehle hi deliver ho chuka hai, is liye ab cancel nahi kiya ja sakta. Agar koi masla ya shikayat ho to baraye meherbani hamare support agent se rabta karein.`,
                };
            }

            // Case C: Out for Delivery (Rider has departed)
            if (targetOrder.order_status === 'OUT_FOR_DELIVERY') {
                try {
                    await muteChatForHandover({
                        chatId,
                        sessionKey: userSessionId,
                        reason: `Customer requested cancellation for Order #${targetOrder.order_number} which is already Out for Delivery`,
                        customerPhone: cleanPhone,
                        customerName: targetOrder.customer_name,
                        sock,
                    });
                } catch (_) {}
                return {
                    handled: true,
                    routeName: 'fast_cancel_out_for_delivery',
                    reply: `Aap ka order *#${targetOrder.order_number}* rider ke sath deliver karne ke liye nikal chuka hai (Out for Delivery), is liye direct cancel nahi kiya ja sakta. Hum ne aap ki request foran support team ko bhej di hai, woh jald aapse rabta karenge.`,
                };
            }

            // Case D: Cancellable (PENDING, CONFIRMED, PREPARING, READY)
            const cancelRes = await cancelOrder({
                restaurantId: cache.restId,
                orderNumber: targetOrder.order_number,
                reason: 'Customer requested cancellation via WhatsApp',
            });

            if (cancelRes?.success) {
                clearSessionOrderDetails(userSessionId, cleanPhone);
                return {
                    handled: true,
                    routeName: 'fast_cancel_placed_order_success',
                    reply: `Ji ${custName}, aap ka order *#${targetOrder.order_number}* kamiyabi ke sath cancel kar diya gaya hai! ❌\n\nAgar aap dobara kuch mangwana chahein ya koi aur madad chahiye ho, toh zaroor bataiyega. Main hamesha aap ki khidmat ke liye hazir hoon! 😊`,
                };
            } else {
                return {
                    handled: true,
                    routeName: 'fast_cancel_placed_order_failed',
                    reply: `Order *#${targetOrder.order_number}* cancel nahi ho saka: ${cancelRes?.message || 'Kitchen mein packing complete ho chuki hai.'} Baraye meherbani support agent se rabta karein.`,
                };
            }
        } catch (err) {
            console.error('[FAST_ROUTE] Error processing cancellation:', err.message);
        }
    }

    // ── Check Fast Route: Placed Order Update & Status Inquiry (Zero Tokens) ──
    try {
        const { getPendingOrderUpdate, setPendingOrderUpdate, clearPendingOrderUpdate } = await import('./sessionService.js');
        const cleanPhone = (whatsappPhone || '').replace(/\D/g, '');
        const activeOrderUpdate = getPendingOrderUpdate(userSessionId, cleanPhone);

        // Helper: Find customer's recent active order
        async function findCustomerRecentActiveOrder() {
            const { getDbClient } = await import('../db/client.js');
            const prisma = getDbClient();
            if (!prisma) return null;

            const orderNumMatch = lower.match(/#?CC-\d{5,6}/i);
            if (orderNumMatch) {
                const num = orderNumMatch[0].replace('#', '').toUpperCase();
                const byNum = await prisma.order.findFirst({
                    where: { order_number: num },
                    include: { order_items: true, customer: true },
                });
                if (byNum) return byNum;
            }

            const orConditions = [];
            if (userSessionId) {
                orConditions.push({ source_session_id: userSessionId });
                orConditions.push({ source_chat_id: userSessionId });
            }
            if (chatId && chatId !== userSessionId) orConditions.push({ source_chat_id: chatId });
            if (cleanPhone) {
                orConditions.push({ phone: cleanPhone });
                orConditions.push({ whatsapp_phone: cleanPhone });
            }

            if (orConditions.length === 0) return null;

            return await prisma.order.findFirst({
                where: {
                    order_status: { in: ['CONFIRMED', 'PREPARING', 'PENDING', 'OUT_FOR_DELIVERY'] },
                    OR: orConditions,
                },
                orderBy: { created_at: 'desc' },
                include: { order_items: true, customer: true },
            });
        }

        // Sub-case 1: Customer confirms pending order update (e.g. "Nahi bss yehi confirm kr do", "Haan confirm kr do", "Confirm")
        const isUpdateConfirmKeyword = /^(?:(?:nahi\s+)?(?:bss?\s+)?(?:yehi|yahi|isi\s*ko)?\s*)?(?:confirm|co?n?f[iy]?r[mn]+|haan|han|hn|yes|theek\s*hai?|thk\s*hai?|ok|okay|done|bilkul|kar\s*do|kr\s*do|kardo|krdo|kr\s*du|kar\s*du|update\s*(?:kr\s*do|kar\s*do|kr\s*du|kar\s*du)?)(?:\s+(?:kr\s*do|kar\s*do|kardo|krdo|kr\s*du|kar\s*du|bhai|please|plz))*$/i.test(lower.trim());
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
                const nameLine = activeOrderUpdate.pendingChanges.name ? `• Customer Name: *${activeOrderUpdate.pendingChanges.name}*\n` : '';
                const addrLine = activeOrderUpdate.pendingChanges.address ? `• Delivery Address: *${activeOrderUpdate.pendingChanges.address}*\n` : '';
                const phoneLine = activeOrderUpdate.pendingChanges.phone ? `• Contact Phone: *${activeOrderUpdate.pendingChanges.phone}*\n` : '';
                const payLine = activeOrderUpdate.pendingChanges.paymentMethod ? `• Payment Method: *${activeOrderUpdate.pendingChanges.paymentMethod === 'COD' ? 'Cash on Delivery (COD)' : 'EasyPaisa'}*\n` : '';

                return {
                    handled: true,
                    routeName: 'fast_order_update_confirmed',
                    reply: `Zabardast! Aap ke order (*#${activeOrderUpdate.orderNumber}*) ki details kamyabi se update ho gayi hain! 🎉\n\n${nameLine}${addrLine}${phoneLine}${payLine}• Items: ${activeOrderUpdate.itemsSummary}\n• Total Bill: Rs. ${Number(finalOrder.total).toLocaleString('en-PK')} (${finalOrder.payment_method === 'COD' ? 'Cash on Delivery' : 'EasyPaisa'})\n\nCravey Crust kitchen team aur rider ko update bhej di gayi hai. Mazay se khana enjoy karein! 🍕🛵`,
                };
            } else {
                return {
                    handled: true,
                    routeName: 'fast_order_update_failed',
                    reply: `Order update nahi ho saka: ${res.message || 'Kuch takneeki masla aa gaya.'} Baraye meherbani support agent se rabta karein.`,
                };
            }
        }

        // Sub-case 2: Active order update is in progress and customer sends changes (e.g. "Khanna pul", "Name bhi change kr k smilekashii kr do")
        if (activeOrderUpdate) {
            // Check if user is asking to change address or name (prompt request)
            if (/\b(?:address\s*(?:change|badal|update|theek|sahi|galat)|change\s*ad(?:d)?re(?:e)?s(?:s)?|ad(?:d)?re(?:e)?s(?:s)?\s*(?:change|badal|badalna|karna|krna)|pichl[ae]y?\s*order\s*ka\s*ad(?:d)?re(?:e)?s(?:s)?)\b/i.test(lower)) {
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
                newChanges.address = explicitAddrMatch;
                newChanges.location = null;
                hasNewChange = true;
                activeOrderUpdate.awaitingField = null;
            } else if ((activeOrderUpdate.awaitingField === 'address' || (!extracted.name && hasAddressSignal)) && cleanedAddr && cleanedAddr.length >= 3 && !/^(?:order|change|update|address|naam|name|pichla|purana|confirm|haan|nahi)[\s.!?]*$/i.test(cleanedAddr)) {
                newChanges.address = cleanedAddr;
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

                const nameLine = newChanges.name ? `• Naya Customer Name: *${newChanges.name}*\n` : '';
                const addrLine = newChanges.address ? `• Naya Delivery Address: *${newChanges.address}*\n` : '';
                const phoneLine = newChanges.phone ? `• Naya Contact Phone: *${newChanges.phone}*\n` : '';
                const payLine = newChanges.paymentMethod ? `• Naya Payment Method: *${newChanges.paymentMethod === 'COD' ? 'Cash on Delivery (COD)' : 'EasyPaisa'}*\n` : '';

                return {
                    handled: true,
                    routeName: 'fast_order_update_staged',
                    reply: `Theek hai Ji! Aap ke order (*#${activeOrderUpdate.orderNumber}*) mein ye changes note kar li hain:\n\n${nameLine}${addrLine}${phoneLine}${payLine}• Items: ${activeOrderUpdate.itemsSummary}\n• Total Bill: Rs. ${Number(activeOrderUpdate.total).toLocaleString('en-PK')} (${newChanges.paymentMethod || activeOrderUpdate.originalPaymentMethod || 'COD'})\n\nKya aap is order update ko confirm karte hain?\n(Confirm karne ke liye *"Haan"*, *"Confirm"* ya *"Yehi confirm kr do"* likhein)`,
                };
            }
        }

        // Sub-case 3: Customer inquires about current/previous order details (e.g. "Purany order ka adress kia ha ab?", "Order status kya hai?")
        const isOrderInquiry = /\b(?:puran[ae]y?|pichl[ae]y?|mera|previous|last)\s*(?:order|oder)?\s*(?:ka\s*)?(?:ad(?:d)?re(?:e)?s(?:s)?|pata|location|status|name|naam|details|detail|bill|total)\b/i.test(lower) ||
            /\b(?:order|oder)\s*(?:ka\s*)?(?:ad(?:d)?re(?:e)?s(?:s)?|pata|location|status|name|naam)\s*(?:kia|kya|kahan|kidhar)\b/i.test(lower) ||
            /\b(?:mera\s+order\s*(?:kahan|kidhar|status))\b/i.test(lower);

        if (isOrderInquiry && !hasCartOrOrderAction) {
            const targetOrder = await findCustomerRecentActiveOrder();
            if (targetOrder) {
                const statusDesc = targetOrder.order_status === 'CONFIRMED' ? 'Bhatti mein taiyar ho raha hai' :
                                   targetOrder.order_status === 'PREPARING' ? 'Kitchen mein taiyar ho raha hai' :
                                   targetOrder.order_status === 'OUT_FOR_DELIVERY' ? 'Rider delivery ke liye nikal chuka hai' :
                                   targetOrder.order_status === 'DELIVERED' ? 'Deliver ho chuka hai' :
                                   targetOrder.order_status === 'CANCELLED' ? 'Cancel ho chuka hai' : targetOrder.order_status;

                const itemsStr = (targetOrder.order_items || []).map(i => `${i.quantity}x ${i.item_name_snapshot || i.deal_name_snapshot || 'Item'}${i.variant_name_snapshot ? ' (' + i.variant_name_snapshot + ')' : ''}`).join(', ') || 'Food items';

                return {
                    handled: true,
                    routeName: 'fast_order_status_inquiry',
                    reply: `Ji ${targetOrder.customer_name ? targetOrder.customer_name + ' bhai!' : 'Ji!'} Aap ke order (*#${targetOrder.order_number}*) ki current details ye hain:\n\n• Status: *${targetOrder.order_status}* (${statusDesc})\n• Delivery Address: *${targetOrder.delivery_address || 'Registered Address'}*\n• Customer Name: *${targetOrder.customer_name}*\n• Contact Phone: *${targetOrder.phone}*\n• Items: ${itemsStr}\n• Total Bill: *Rs. ${Number(targetOrder.total).toLocaleString('en-PK')}* (${targetOrder.payment_method === 'COD' ? 'Cash on Delivery' : 'EasyPaisa'})\n\nAgar is mein kuch change karwana ho to batayein! 😊`,
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
        const isExplicitPreviousOrder = /\b(?:pichl[ae]y?|puran[ae]y?|last|previous|confirmed?)\s*(?:order|oder)\b/i.test(lower);
        const isGenericChangeIntent = /\b(?:address\s*(?:change|badal|update|theek|sahi|galat|ghalat)|change\s*ad(?:d)?re(?:e)?s(?:s)?|ad(?:d)?re(?:e)?s(?:s)?\s*(?:change|theek|sahi|galat|ghalat)|ad(?:d)?re(?:e)?s(?:s)?\s*(?:nahi|ni)\s*hai|wrong\s*ad(?:d)?re(?:e)?s(?:s)?|galat\s*ad(?:d)?re(?:e)?s(?:s)?|ghalat\s*ad(?:d)?re(?:e)?s(?:s)?|naya\s*ad(?:d)?re(?:e)?s(?:s)?)\b/i.test(lower) ||
            /\b(?:naam|name)\s*(?:bhi\s*)?(?:change|badal|update)\b/i.test(lower) ||
            /\b(?:number|phone)\s*(?:bhi\s*)?(?:change|badal|update)\b/i.test(lower) ||
            /\b(?:order|oder)\s*(?:update|change|badal)\b/i.test(lower);

        if ((isExplicitPreviousOrder || (!hasActiveCartItems && isGenericChangeIntent)) && userSessionId) {
            const targetOrder = await findCustomerRecentActiveOrder();
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
                    newUpdate.pendingChanges.address = explicitAddrMatch;
                } else if (!extracted.name && hasAddressSignal && cleanedAddr && cleanedAddr.length >= 3 && !/^(?:order|change|update|address|naam|name|pichla|purana)[\s.!?]*$/i.test(cleanedAddr)) {
                    newUpdate.pendingChanges.address = cleanedAddr;
                }
                if (extracted.phone && extracted.phone !== 'SAME_WHATSAPP') {
                    newUpdate.pendingChanges.phone = extracted.phone;
                }

                setPendingOrderUpdate(userSessionId, newUpdate, cleanPhone);

                if (Object.keys(newUpdate.pendingChanges).length > 0) {
                    const nameLine = newUpdate.pendingChanges.name ? `• Naya Customer Name: *${newUpdate.pendingChanges.name}*\n` : '';
                    const addrLine = newUpdate.pendingChanges.address ? `• Naya Delivery Address: *${newUpdate.pendingChanges.address}*\n` : '';
                    const phoneLine = newUpdate.pendingChanges.phone ? `• Naya Contact Phone: *${newUpdate.pendingChanges.phone}*\n` : '';

                    return {
                        handled: true,
                        routeName: 'fast_order_update_staged',
                        reply: `Theek hai Ji! Aap ke order (*#${newUpdate.orderNumber}*) mein ye changes note kar li hain:\n\n${nameLine}${addrLine}${phoneLine}• Items: ${newUpdate.itemsSummary}\n• Total Bill: Rs. ${Number(newUpdate.total).toLocaleString('en-PK')} (${newUpdate.originalPaymentMethod === 'COD' ? 'Cash on Delivery' : 'EasyPaisa'})\n\nKya aap is order update ko confirm karte hain?\n(Confirm karne ke liye *"Haan"*, *"Confirm"* ya *"Yehi confirm kr do"* likhein)`,
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
                    reply: `Ji! Aap ke order (*#${newUpdate.orderNumber}*) mein kya change karwana chahenge? (Address, Name, Contact Number ya Payment Method?)`,
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
                const isAffirmativeLocation = /^(?:haan|han|hn|jee|ji|yes|yep|theek\s*hai?|ok|done|confirm|yahi|yehi|isi\s*(?:location|jagah|par|pe)?|isi\s*pe)[\s.!?]*$/i.test(lower.trim());
                const isNegativeLocation = /^(?:nahi|nahin|na|no|nope|wrong|galat|ghalat|ye\s*nahi|yahan\s*nahi)[\s.!?]*$/i.test(lower.trim());

                if (isAffirmativeLocation) {
                    currDetails.locationConfirmed = true;
                    currDetails.locationAwaitingConfirmation = false;
                    updateSessionOrderDetails(userSessionId, { locationConfirmed: true, locationAwaitingConfirmation: false }, cleanPhone);

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
            if (currDetails?.paymentMethod) {
                currDetails.extraItemsAnswered = true;
                currDetails.extraItemsInquired = true;
                updateSessionOrderDetails(userSessionId, { extraItemsAnswered: true, extraItemsInquired: true }, cleanPhone);

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
            const { getActiveCart } = await import('./cartService.js');
            const cache = await getCatalogCache();
            const cart = await getActiveCart({ sessionKey: userSessionId, restaurantId: cache.restId, chatId });
            const readyToConfirm = details.name && (details.address || details.location) && (details.paymentMethod || 'COD');
            if (cart?.items && cart.items.length > 0 && (details.awaitingFinalConfirmation || readyToConfirm) && !details.locationAwaitingConfirmation) {
                const finalPayment = details.paymentMethod || 'COD';
                const { createOrder } = await import('./orderService.js');
                const res = await createOrder({
                    restaurantId: cache.restId,
                    sessionKey: userSessionId,
                    customerName: details.name || 'Customer',
                    phone: details.phone || cleanPhone,
                    delivery: {
                        address: details.address || details.location?.address || 'Google Maps Location Pin',
                        latitude: details.location?.latitude ?? null,
                        longitude: details.location?.longitude ?? null,
                    },
                    paymentMethod: finalPayment,
                    sock,
                });
                const orderNum = res.order?.orderNumber || res.order?.order_number;
                const total = Number(res.order?.pricing?.total ?? res.order?.total ?? 0);
                if (orderNum) {
                    clearSessionOrderDetails(userSessionId, cleanPhone);
                    _lastDiscussedDealBySession.delete(userSessionId);
                    const customerName = details.name ? details.name.trim() : 'Customer';
                    return {
                        handled: true,
                        routeName: 'fast_order_confirm',
                        reply: `${customerName} bhai, aap ka order successfully confirm ho gaya hai!\nOrder Number: ${orderNum}\nOrder Total: Rs. ${total.toLocaleString('en-PK')}\nPayment: ${finalPayment === 'COD' ? 'Cash on Delivery (COD)' : 'EasyPaisa'}\n\nAap ka order Cravey Crust ki team ko bhej diya gaya hai. Shukriya, aur mazay se khana enjoy karein!`,
                    };
                }
            }
        } catch (err) {
            console.error('[FAST_ROUTE] Error booking confirmed order:', err.message);
            return {
                handled: true,
                routeName: 'fast_order_confirm_failed',
                reply: `Maazrat! Aap ka order is waqt process nahi ho saka (${err.message || 'System error'}). Baraye meherbani thori der baad dobara koshish karein ya human support se rabta karein.`,
            };
        }
    }

    // ── Check Fast Route: Checkout Request (Zero Tokens) ──
    const isCheckoutRequest = /^(?:checkout|check\s*out|order\s*(?:karna\s*hai|karwana\s*hai|krna\s*hai|krwana\s*hai|book\s*karna\s*hai|book\s*krna\s*hai|please|karein|kar\s*dein|karo)|place\s*order|done\s*ordering|proceed)$/i.test(lower.trim());
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

                    const { getSessionOrderDetails } = await import('./sessionService.js');
                    const cleanPhone = (whatsappPhone || '').replace(/\D/g, '');
                    const details = getSessionOrderDetails(userSessionId, cleanPhone);
                    const cartNow = await getActiveCart({ sessionKey: userSessionId, restaurantId: cache.restId, chatId });

                    return await getNextCheckoutStepResponse({
                        details,
                        whatsappPhone,
                        cart: cartNow,
                        cache,
                        introMessage: `Zabardast Jigri! *${dealName}* cart mein add ho gayi hai! 🎉\n• 1x ${dealName}${dealDesc} — Rs. ${dealPrice}`,
                    });
                }
            } catch (err) {
                console.error('[FAST_ROUTE] Error adding confirmed deal:', err.message);
            }
        }
    }

    // ── Check Fast Follow-up: Size specification for last discussed pizza / item (Zero Tokens) ──
    const isSizeFollowup = /^(?:small|medium|med|large|lrg|party(?:\s*size)?|regular|reg|chota|chhota|bara|bada)(?:\s*(?:kr\s*do|kardo|kar\s*do|kr\s*du|kar\s*du|kar\s*dein|karden|chahiye|mangwana|rakh\s*do|bhai|wala|wali|size))?$/i.test(lower.trim());
    if (isSizeFollowup && userSessionId && _lastDiscussedItemBySession.has(userSessionId)) {
        const lastItemEntry = _lastDiscussedItemBySession.get(userSessionId);
        if (lastItemEntry && (Date.now() - lastItemEntry.timestamp < 180 * 1000)) {
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

                    const { getSessionOrderDetails } = await import('./sessionService.js');
                    const cleanPhone = (whatsappPhone || '').replace(/\D/g, '');
                    const details = getSessionOrderDetails(userSessionId, cleanPhone);
                    const cartNow = await getActiveCart({ sessionKey: userSessionId, restaurantId: cache.restId, chatId });

                    return await getNextCheckoutStepResponse({
                        details,
                        whatsappPhone,
                        cart: cartNow,
                        cache,
                        introMessage: `Zabardast! *${itemName} (${variantName})* cart mein add kar diya gaya hai! 🎉 (Rs. ${price})`,
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
                const itemsList = cart.items.map(i => {
                    const n = i.deal ? i.deal.name : (i.menu_item?.name || 'Item');
                    const v = i.menu_variant ? ` (${i.menu_variant.name})` : '';
                    const p = Number(i.deal?.deal_price ?? i.menu_variant?.price ?? i.menu_item?.base_price ?? i.unit_price ?? 0) * i.quantity;
                    return `• ${i.quantity}x ${n}${v} — Rs. ${p}`;
                }).join('\n');
                const subtotal = cart.items.reduce((s, i) => s + Number(i.deal?.deal_price ?? i.menu_variant?.price ?? i.menu_item?.base_price ?? i.unit_price ?? 0) * i.quantity, 0);

                return await getNextCheckoutStepResponse({
                    details,
                    whatsappPhone,
                    cart,
                    cache,
                    introMessage: `Jigri, aap ke cart ka subtotal *Rs. ${subtotal}* bana hai.\n\n📋 *Items:*\n${itemsList}`,
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
                const isPhoneConfirmation = (currDetails.name && !currDetails.phoneConfirmed && !currDetails.phone) &&
                    /^(?:same|same\s*number|same\s*whatsapp|yahi|yehi|wahi|isi\s*pe|yahi\s*hai|yehi\s*hai|yahi\s*number|yehi\s*number|isi\s*number|haan|han|ji|jee|yes|theek\s*hai|theek\s*hy|ok|done)[\s.!?]*$/i.test(lower.trim());

                const extracted = extractCustomerDetails(raw, currDetails);
                const updatePayload = {};
                let isNameUpdated = false;
                let isAddressUpdated = false;
                let isPaymentUpdated = false;
                let isPhoneUpdated = false;

                if (extracted.name && (!currDetails.name || extracted.name.toLowerCase() !== currDetails.name.toLowerCase())) {
                    updatePayload.name = extracted.name;
                    isNameUpdated = Boolean(currDetails.name);
                }

                if (extracted.address && (!currDetails.address || extracted.address.toLowerCase() !== currDetails.address.toLowerCase())) {
                    const { extractLocationFromText } = await import('../../utils/location.js');
                    const loc = extractLocationFromText(raw);
                    if (loc?.latitude != null && loc?.longitude != null) {
                        updatePayload.location = loc;
                        updatePayload.address = loc.mapUrl || `https://www.google.com/maps?q=${loc.latitude},${loc.longitude}`;
                        updatePayload.locationConfirmed = false;
                        updatePayload.locationAwaitingConfirmation = true;
                    } else {
                        updatePayload.address = extracted.address;
                        updatePayload.location = null;
                        updatePayload.locationConfirmed = true;
                        updatePayload.locationAwaitingConfirmation = false;
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
                        introMessage = `Theek hai ${details.name ? details.name + ' bhai! ' : ''}Delivery address update kar diya hai (*${updatePayload.address}*). 📍`;
                    } else if (isPaymentUpdated) {
                        introMessage = `Theek hai ${details.name ? details.name + ' bhai! ' : ''}Payment method update kar diya hai (*${updatePayload.paymentMethod === 'COD' ? 'Cash on Delivery (COD)' : 'EasyPaisa'}*). 💵`;
                    } else if (isPhoneUpdated) {
                        introMessage = `Theek hai ${details.name ? details.name + ' bhai! ' : ''}Contact number update kar diya hai (*${formatPakistaniPhone(updatePayload.phone)}*). 📞`;
                    } else if (updatePayload.locationAwaitingConfirmation) {
                        introMessage = '';
                    } else if (updatePayload.address) {
                        introMessage = `Delivery address (*${updatePayload.address}*) note kar liya hai. 📍`;
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
    const isGreetingName = FAST_GREETING_REGEX.test(raw.trim()) || /^(?:hlo|hlw|hy|helo|hellow|hi|hello|hey|salam|slam|assalam|aoa|assalamualaikum|suno|oye|yo)[\s.!?]*$/i.test(raw.trim());
    let nameCandidate = raw.replace(/^(?:mera\s+naam\s+|naam\s+|name\s*(?:is|hai|h|ja)?\s*:?\s*)/i, '')
                           .replace(/(?:\s+(?:naam|name|hai|h|ja|mera))+$/i, '')
                           .trim();
    nameCandidate = nameCandidate.replace(/^(?:same|wahi|yahi|yehi|isi|naam|nam|mera|apna|kr\s*du|kar\s*du)\s+/i, '').trim();
    nameCandidate = nameCandidate.replace(/\s+(?:bki|baqi|baki|sari|details|sab|same|ha|hai|h|he|hy).*$/i, '').trim();
    const nameMatch = nameCandidate.match(/^([A-Za-z]{2,20}(?:\s+[A-Za-z]{2,20})?)$/i);
    const isNotNameCandidate = isGreetingName || /\b(hlo|hlw|hy|helo|hellow|hi|hello|hey|salam|slam|assalam|aoa|assalamualaikum|suno|oye|yo|krdo|kardo|kar\s*do|kr\s*do|karo|kro|kar|kr|karna|krna|karein|chahiye|mangwao|mangwana|pack|parcel|send|bhej|bhejo|theek|thk|thek|done|ok|okk|okay|sure|yes|yup|yep|haan|han|hn|ha|g|ji|jee|no|nahi|nhi|nh|nai|na|mat|cancel|cancle|kansil|payment|cod|cash|easypaisa|easy|paisa|delivery|address|location|pata|order|deal|deals|pizza|burger|menu|meny|menue|mainu|mainue|dikhao|dijhao|dikaho|dekhao|dikhayein|dikhana|dikha|btao|batao|bhejna|kase|kaise|kese|scene|hal|haal|rate|list|kya|kia|hy|hain|hen|dein|bhai|bhaiya|bhae|bhi|sain|sir|khan|bro|madam|food|water|drink|bill|kam|party|small|medium|large|reg|regular|can|liter|litre|1\.5l|1l|flavor|flavour|crust|cheese|extreme|peri|behari|tikka|fajita|supreme|tandoori|same|yahi|yehi|wahi|isi|number|numbr|num|hoo|ho|hu|hun|hoon|jigri)\b/i.test(nameCandidate);
    if (nameMatch && !isNotNameCandidate && userSessionId && wordCount <= 4 && !hasCartOrOrderAction) {
        try {
            const { getActiveCart } = await import('./cartService.js');
            const cache = await getCatalogCache();
            const cart = await getActiveCart({ sessionKey: userSessionId, restaurantId: cache.restId, chatId });
            if (cart?.items && cart.items.length > 0) {
                const { getSessionOrderDetails, updateSessionOrderDetails } = await import('./sessionService.js');
                const cleanPhone = (whatsappPhone || '').replace(/\D/g, '');
                const details = getSessionOrderDetails(userSessionId, cleanPhone);
                const customerName = nameMatch[1].trim().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
                const isDifferent = !details.name || details.name.toLowerCase() !== customerName.toLowerCase();
                if (isDifferent) {
                    const isUpdate = Boolean(details.name);
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

                    const introMessage = isUpdate
                        ? `Theek hai ${customerName} bhai! Aap ka naam update kar diya hai (*${customerName}*). 😊`
                        : `Theek hai ${customerName} bhai! Aap ka naam note kar liya hai. 😊`;

                    return await getNextCheckoutStepResponse({
                        details: updated,
                        whatsappPhone,
                        cart,
                        cache,
                        introMessage,
                    });
                }
            }
        } catch (_) {}
    }

    // ── Check Customer Phone Input / "Same Number" (Zero Tokens) ──
    const { getSessionOrderDetails: getDetailsForPhone } = await import('./sessionService.js');
    const existingDetailsForPhone = getDetailsForPhone(userSessionId, (whatsappPhone || '').replace(/\D/g, ''));
    const isPhoneAffirmativeWhenAwaiting = (existingDetailsForPhone?.name && !existingDetailsForPhone?.phoneConfirmed) &&
        /^(?:same\s*number|same|isi\s*number|yehi\s*number|yahi\s*number|same\s*whatsapp|yahi|yehi|wahi|isi\s*pe|yahi\s*hai|yehi\s*hai|haan|han|ji|jee|yes|theek\s*hai|theek\s*hy|ok|done)[\s.!?]*$/i.test(lower.trim());
    const rawPhoneMatch = raw.replace(/[\s-]/g, '').match(/(?:03\d{9}|\+?923\d{9})/);
    const isSameNumber = isPhoneAffirmativeWhenAwaiting || /^(?:same\s*number|same|isi\s*number|yehi\s*number|yahi\s*number|same\s*whatsapp)$/i.test(lower.trim()) || !!rawPhoneMatch;

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
            if (currDetails?.name && (currDetails?.phoneConfirmed || currDetails?.phone) && !currDetails?.address && !currDetails?.location) {
                const isNotAddr = /^(?:menu|deals?|cancel|khatam|band|chahiye|kitne|price|rate|status|hi|hello|hey|suno|bhai)[\s.!?]*$/i.test(lower.trim());
                if (!isNotAddr && wordCount <= 25) {
                    const { extractLocationFromText } = await import('../../utils/location.js');
                    const loc = extractLocationFromText(raw);
                    const isPin = loc?.latitude != null && loc?.longitude != null;
                    const cleanedAddr = isPin ? (loc.mapUrl || `https://www.google.com/maps?q=${loc.latitude},${loc.longitude}`) : cleanExtractedAddress(raw);
                    if (cleanedAddr && cleanedAddr.length >= 3) {
                        const { getActiveCart } = await import('./cartService.js');
                        const cache = await getCatalogCache();
                        const cart = await getActiveCart({ sessionKey: userSessionId, restaurantId: cache.restId, chatId });
                        if (cart?.items && cart.items.length > 0) {
                            const details = updateSessionOrderDetails(userSessionId, {
                                address: cleanedAddr,
                                location: loc,
                                locationConfirmed: !isPin,
                                locationAwaitingConfirmation: isPin,
                            }, cleanPhone);
                            return await getNextCheckoutStepResponse({
                                details,
                                whatsappPhone,
                                cart,
                                cache,
                                introMessage: isPin ? '' : `Delivery address (*${cleanedAddr}*) note kar liya hai. 📍`,
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

            if (currDetails?.name && (currDetails?.phoneConfirmed || currDetails?.phone) && (currDetails?.address || currDetails?.location) && !currDetails?.paymentMethod) {
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
                reply: `Koi masla nahi Ji! Naya address kya rakhna chahenge? Baraye meherbani apna naya mukammal delivery address (ya WhatsApp Location Pin) yahan likh kar bhej dein taake hum update kar dein! 📍`,
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

            const isPin = loc?.latitude != null && loc?.longitude != null;
            // Always save location to session regardless of cart state
            const details = updateSessionOrderDetails(userSessionId, {
                address: addressStr,
                location: loc,
                locationConfirmed: !isPin,
                locationAwaitingConfirmation: isPin,
            }, cleanPhone);

            // Try to get cart
            let cart = null;
            try {
                cart = await getActiveCart({ sessionKey: userSessionId, restaurantId: cache.restId, chatId });
            } catch (_) {}

            if (cart?.items && cart.items.length > 0) {
                return await getNextCheckoutStepResponse({
                    details,
                    whatsappPhone,
                    cart,
                    cache,
                    introMessage: isPin ? '' : `Zabardast ${details.name ? details.name + ' bhai! ' : ''}Aap ka delivery address note kar liya hai: 📍 *${addressStr.slice(0, 80)}*`,
                });
            } else {
                // Cart is empty — location saved, ask customer to order something
                return {
                    handled: true,
                    routeName: 'location_saved_no_cart',
                    reply: `Zabardast! Aap ka delivery address note kar liya hai: 📍 *${addressStr.slice(0, 80)}*\n\nAb koi item ya deal select karein taake order place ho sake! Menu dekhne ke liye 'menu' ya 'deals' likhein.`,
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
                reply: `${salutation} *${store}* mein khush aamdeed. Main hoon *Burger Raja*! Kahiye, aaj kya mangwana chahenge? Hamara menu dekhne ke liye 'menu' ya deals dekhne ke liye 'deals' likhein!`,
            };
        } catch (_) {
            return {
                handled: true,
                routeName: 'quick_reply',
                reply: 'Hello! Cravey Crust mein khush aamdeed. Main hoon Burger Raja! Kahiye, aaj kya mangwana chahenge? Hamara menu dekhne ke liye \'menu\' ya deals dekhne ke liye \'deals\' likhein!',
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
                reply: `Alhamdulillah main bilkul theek hoon! Main *${store}* ka AI assistant *Burger Raja* hoon. Aaj koi lazeez khana mangwana hai? Hamara menu dekhne ke liye 'menu' ya 'deals' likhein!`,
            };
        } catch (_) {
            return {
                handled: true,
                routeName: 'quick_reply',
                reply: 'Alhamdulillah main bilkul theek hoon! Main *Cravey Crust* ka AI assistant *Burger Raja* hoon. Aaj koi lazeez khana mangwana hai? Hamara menu dekhne ke liye \'menu\' ya \'deals\' likhein!',
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


