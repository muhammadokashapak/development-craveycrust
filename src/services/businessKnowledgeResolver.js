/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║   Business Knowledge Resolver                                ║
 * ║   src/services/businessKnowledgeResolver.js                  ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Centralized Authority Hierarchy:
 *   1. Restaurant / Bot Settings (live DB record)
 *   2. Structured live business database/services (Menu, Deals, Delivery, Orders)
 *   3. FAQ / Knowledge Base (policy, tone, general non-structured guidance)
 *   4. Safe fallback
 *
 * Never hardcodes changing business data.
 * Dynamic settings updates reflect immediately without restart or redeploy.
 */

import { getDbClient } from '../db/client.js';
import { getDefaultRestaurantId } from './restaurantService.js';
import { searchKnowledge } from './knowledgeService.js';
import { getCategoryWithItems, resolveMenuItemOrDeal, getActiveDeals } from './menuService.js';
import { isPaymentQuery } from './intentParser.js';
import { logger } from '../utils/logger.js';

/**
 * Format standard 24h or arbitrary time strings into customer-friendly 12h format
 * Examples:
 *   "18:00" -> "6:00 PM"
 *   "02:00" -> "2:00 AM"
 *   "6:00 PM" -> "6:00 PM"
 *
 * @param {string} str
 * @returns {string}
 */
export function formatTimeString(str) {
    if (!str) return '';
    const s = String(str).trim();
    if (!s) return '';

    // Match "HH:mm" or "H:mm"
    const match24 = s.match(/^(\d{1,2}):(\d{2})$/);
    if (match24) {
        let h = parseInt(match24[1], 10);
        const m = match24[2];
        const ampm = h >= 12 ? 'PM' : 'AM';
        h = h % 12 || 12;
        return m === '00' ? `${h}:00 ${ampm}` : `${h}:${m} ${ampm}`;
    }

    return s;
}

/**
 * Check if customer query is asking about restaurant opening/closing times
 *
 * @param {string} text
 * @returns {boolean}
 */
export function isTimingQuery(text) {
    const raw = (text || '').trim().toLowerCase();
    if (!raw) return false;

    // Exact standalone matches
    if (/^(?:timing|timings|time|hours|open|opening)$/i.test(raw)) {
        return true;
    }

    // Direct phrases
    if (/\b(?:restaurant\s*timing|opening\s*time|closing\s*time|aaj\s*timing|open\s*timing|timing\s*kya|timings\s*kya|kya\s*timing|time\s*kya\s*hai|kab\s*open|kab\s*khultay|kab\s*khulta|kitne\s*baje\s*khultay|kitnay\s*baje\s*khultay|open\s*kab|close\s*kab|kis\s*waqt\s*open|kis\s*waqt\s*band|hours\s*of\s*operation|working\s*hours|operating\s*hours)\b/i.test(raw)) {
        return true;
    }

    // Combinations of time/open/close keywords with questions
    const hasTimingWord = /\b(?:timing|timings|open|close|khultay|khulta|band)\b/i.test(raw);
    const hasQuestionWord = /\b(?:kya|kab|kitne|kitnay|kis|waqt|hai|hain|hotay|hoti)\b/i.test(raw) || raw.includes('?');

    if (hasTimingWord && hasQuestionWord && !/\b(?:cart|deal|pizza|burger)\b/i.test(raw)) {
        return true;
    }

    return false;
}

/**
 * Check if customer query is asking about restaurant address or branch location
 *
 * @param {string} text
 * @returns {boolean}
 */
export function isAddressQuery(text) {
    const raw = (text || '').trim().toLowerCase();
    if (!raw) return false;

    // Direct standalone words
    if (/^(?:address|location|pata)$/i.test(raw)) {
        return true;
    }

    // Direct phrases asking about restaurant's address
    if (/\b(?:address\s*kya\s*hai|restaurant\s*kahan\s*hai|restaurant\s*ka\s*pata|location\s*kya\s*hai|kahan\s*per\s*hai\s*restaurant|kahan\s*hai\s*restaurant|branch\s*kahan\s*hai|shop\s*kahan\s*hai|outlet\s*address|address\s*batao|location\s*batao|apna\s*address|restaurant\s*address)\b/i.test(raw)) {
        return true;
    }

    // Check if contains address/location and interrogative (not checkout location)
    if (/\b(?:address|location|pata|branch)\b/i.test(raw) && /\b(?:kya|kahan|kidhar|batao|hai)\b/i.test(raw)) {
        // Exclude customer delivery location questions like "meri location"
        if (!/\b(?:meri|mera|my|deliver\s*karo)\b/i.test(raw)) {
            return true;
        }
    }

    return false;
}

/**
 * Check if customer query is asking for restaurant telephone or contact number
 *
 * @param {string} text
 * @returns {boolean}
 */
export function isPhoneQuery(text) {
    const raw = (text || '').trim().toLowerCase();
    if (!raw) return false;

    // Exclude customer providing their own number or asking about their own phone
    if (/\b(?:mera|meri|my|this\s*is\s*my|own)\s+(?:number|phone|contact)\b/i.test(raw)) {
        return false;
    }

    // Direct phone / contact phrases
    if (/\b(?:restaurant\s*(?:ka\s*)?(?:phone|number|contact)|apka\s*(?:phone\s*)?number|aapka\s*(?:phone\s*)?number|contact\s*number|rabta\s*number|call\s*number|helpline|restaurant\s*contact|phone\s*number)\b/i.test(raw)) {
        return true;
    }

    // Has number/phone/contact/rabta/call/helpline AND restaurant/apka/aapka/kaunsa/kya/batao
    const hasPhoneWord = /\b(?:number|no\.?|phone|contact|rabta|call|helpline)\b/i.test(raw);
    const hasRestaurantOrQuestion = /\b(?:restaurant|hotel|shop|outlet|store|apka|aapka|tumhara|apna|batao|kya|kia|kay|hai|h|hega|kaunsa)\b/i.test(raw);

    if (hasPhoneWord && hasRestaurantOrQuestion && !/\b(?:order|cart|deal|pizza|burger|address|location|timing|pata)\b/i.test(raw)) {
        return true;
    }

    return false;
}

/**
 * Check if customer query is asking about delivery coverage areas, locations, or delivery fees
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

    // Specific known areas: e.g. "ghori vvip me delivery hai", "dhoke kala khan delivery"
    if (/\b(?:ghori\s*vvip|ghauri\s*vip|dhoke\s*kala\s*khan|is\s*ilaqe\s*me)\b/i.test(raw)) {
        return true;
    }

    return false;
}

/**
 * Format live restaurant timings response
 *
 * @param {Object} restaurant
 * @returns {string}
 */
export function formatRestaurantTimings(restaurant) {
    const openStr = formatTimeString(restaurant?.opening_time);
    const closeStr = formatTimeString(restaurant?.closing_time);

    if (openStr && closeStr) {
        return `Hum rozana ${openStr} se ${closeStr} tak open hote hain.`;
    }
    if (openStr) {
        return `Hum rozana ${openStr} open hote hain.`;
    }
    if (closeStr) {
        return `Hum rozana ${closeStr} tak open hote hain.`;
    }

    return '';
}

/**
 * Format live payment options response
 *
 * @param {Object} restaurant
 * @returns {string}
 */
export function formatPaymentMethodsResponse(restaurant) {
    const codEnabled = restaurant?.cod_enabled !== false;
    const epEnabled = restaurant?.easypaisa_enabled === true;
    const epNumber = restaurant?.easypaisa_number || restaurant?.easypaisa_account_number || '';
    const epTitle = restaurant?.account_name || restaurant?.easypaisa_account_title || '';

    if (!codEnabled && !epEnabled) {
        return 'Filhal koi payment method active nahi hai. Barah-e-karam restaurant team se rabta karein.';
    }

    let msg = 'Payment options:\n\n';
    if (codEnabled) {
        msg += 'Cash on Delivery\n';
    }
    if (epEnabled) {
        msg += 'EasyPaisa\n';
        if (epNumber) {
            msg += `\nEasyPaisa Number: ${epNumber}`;
        }
        if (epTitle) {
            msg += `\nAccount Title: ${epTitle}`;
        }
    }

    return msg.trim();
}

/**
 * Format live restaurant address response
 *
 * @param {Object} restaurant
 * @returns {string}
 */
export function formatRestaurantAddress(restaurant) {
    const addr = restaurant?.address?.trim();
    if (!addr) return '';
    const restName = restaurant?.name && !/cravey/i.test(restaurant.name) ? restaurant.name : 'Store';
    return `${restName} ka address hai:\n${addr}`;
}

/**
 * Format live restaurant phone response
 *
 * @param {Object} restaurant
 * @returns {string}
 */
export function formatRestaurantPhone(restaurant) {
    const rawPhone = restaurant?.phone?.trim();
    const adminPhone = restaurant?.admin_notification_phone?.trim();
    const phone = (rawPhone && rawPhone !== '+92-300-0000000')
        ? rawPhone
        : (adminPhone && adminPhone !== '+92-300-0000000' ? adminPhone : '');

    if (!phone) {
        return '';
    }
    const restName = restaurant?.name && !/cravey/i.test(restaurant.name) ? restaurant.name : 'Store';
    return `${restName} ka helpline / rabta number hai: ${phone}\n\nAap call ya WhatsApp par rabta kar sakte hain.`;
}

/**
 * Resolve Business Knowledge Answer adhering to strict priority:
 *   1. Restaurant / Bot Settings
 *   2. Structured Live Business Database / Services
 *   3. FAQ / Knowledge Base
 *   4. Fallback
 *
 * @param {Object} params
 * @param {string} [params.restaurantId]
 * @param {string} params.query
 * @param {string} [params.intent]
 * @param {Object} [params.context]
 * @returns {Promise<{ source: string, type: string, data: any, text: string }>}
 */
export async function resolveBusinessAnswer({
    restaurantId: providedRestId,
    query,
    intent,
    context = {},
}) {
    const prisma = getDbClient();
    const cleanQuery = (query || '').trim();
    const restaurantId = providedRestId || (await getDefaultRestaurantId());

    // Fetch fresh live restaurant record from database (no stale memory cache)
    const restaurant = prisma
        ? await prisma.restaurant.findUnique({
              where: { id: restaurantId },
              include: { settings: true },
          })
        : null;

    // ─────────────────────────────────────────────────────────────────────────
    // PRIORITY 1: RESTAURANT / BOT SETTINGS
    // ─────────────────────────────────────────────────────────────────────────

    // 1.1 Restaurant Timings
    if (isTimingQuery(cleanQuery) || intent === 'TIMINGS_QUERY' || intent === 'RESTAURANT_TIMINGS') {
        const timingsText = formatRestaurantTimings(restaurant);
        if (timingsText) {
            logger.info(
                { query: cleanQuery, source: 'SETTINGS', type: 'RESTAURANT_TIMINGS' },
                `[KnowledgeResolver] query="${cleanQuery}" source=SETTINGS type=RESTAURANT_TIMINGS`
            );
            return {
                source: 'SETTINGS',
                type: 'RESTAURANT_TIMINGS',
                data: {
                    opening_time: restaurant.opening_time,
                    closing_time: restaurant.closing_time,
                    formatted: timingsText,
                },
                text: timingsText,
            };
        }
        // If settings timings are empty, intentionally fall through to FAQ / Fallback
    }

    // 1.2 Payment Details
    if (isPaymentQuery(cleanQuery) || intent === 'PAYMENT_METHODS_QUERY') {
        const hasPaymentSettings =
            restaurant &&
            (restaurant.cod_enabled !== undefined ||
                restaurant.easypaisa_enabled !== undefined ||
                restaurant.easypaisa_number ||
                restaurant.account_name);

        if (hasPaymentSettings) {
            let paymentText = formatPaymentMethodsResponse(restaurant);
            if (context?.stage === 'WAITING_PAYMENT') {
                paymentText += '\n\nOrder continue karne ke liye reply karein: COD ya EasyPaisa.';
            }

            logger.info(
                { query: cleanQuery, source: 'SETTINGS', type: 'PAYMENT_METHODS' },
                `[KnowledgeResolver] query="${cleanQuery}" source=SETTINGS type=PAYMENT_METHODS`
            );
            return {
                source: 'SETTINGS',
                type: 'PAYMENT_METHODS',
                data: {
                    cod_enabled: restaurant.cod_enabled,
                    easypaisa_enabled: restaurant.easypaisa_enabled,
                    easypaisa_number: restaurant.easypaisa_number,
                    account_name: restaurant.account_name,
                },
                text: paymentText,
            };
        }
    }

    // 1.3 Address / Location
    if (isAddressQuery(cleanQuery)) {
        const addressText = formatRestaurantAddress(restaurant);
        if (addressText) {
            logger.info(
                { query: cleanQuery, source: 'SETTINGS', type: 'RESTAURANT_ADDRESS' },
                `[KnowledgeResolver] query="${cleanQuery}" source=SETTINGS type=RESTAURANT_ADDRESS`
            );
            return {
                source: 'SETTINGS',
                type: 'RESTAURANT_ADDRESS',
                data: { address: restaurant.address },
                text: addressText,
            };
        }
        // If settings address is empty, intentionally fall through to FAQ / Fallback
    }

    // 1.4 Phone / Contact
    if (isPhoneQuery(cleanQuery)) {
        const phoneText = formatRestaurantPhone(restaurant);
        if (phoneText) {
            logger.info(
                { query: cleanQuery, source: 'SETTINGS', type: 'RESTAURANT_PHONE' },
                `[KnowledgeResolver] query="${cleanQuery}" source=SETTINGS type=RESTAURANT_PHONE`
            );
            return {
                source: 'SETTINGS',
                type: 'RESTAURANT_PHONE',
                data: { phone: restaurant.phone },
                text: phoneText,
            };
        }
        // If settings phone is empty, intentionally fall through to FAQ / Fallback
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PRIORITY 2: STRUCTURED LIVE BUSINESS DATABASE / SERVICES
    // ─────────────────────────────────────────────────────────────────────────

    // 2.1 Delivery Areas & Fee Inquiry
    if ((isDeliveryInfoQuery(cleanQuery) || intent === 'DELIVERY_AREAS_QUERY' || intent === 'DELIVERY_AREAS') && prisma) {
        let activeAreas = await prisma.deliveryArea.findMany({
            where: { restaurant_id: restaurantId, is_active: true },
            orderBy: { sort_order: 'asc' },
            select: { name: true, delivery_fee: true },
        });

        if (activeAreas.length === 0) {
            activeAreas = await prisma.deliveryArea.findMany({
                where: { is_active: true },
                orderBy: { sort_order: 'asc' },
                select: { name: true, delivery_fee: true },
            });
            if (activeAreas.length === 0) {
                const { ensureDeliveryAreasSeeded } = await import('./deliveryService.js');
                await ensureDeliveryAreasSeeded(prisma, restaurantId);
                activeAreas = await prisma.deliveryArea.findMany({
                    where: { is_active: true },
                    orderBy: { sort_order: 'asc' },
                    select: { name: true, delivery_fee: true },
                });
            }
        }

        const restName = restaurant?.name && !/cravey/i.test(restaurant.name) ? restaurant.name : 'Store';

        if (activeAreas.length === 0) {
            return {
                source: 'DELIVERY',
                type: 'DELIVERY_AREAS',
                data: { areas: [], count: 0 },
                text: `Filhal delivery coverage areas configure nahi hain. Barah-e-karam ${restName} team se rabta karein.`,
            };
        }

        if (/\b(?:lahore|karachi|peshawar|multan|faisalabad|quetta)\b/i.test(cleanQuery)) {
            const areaSample = activeAreas.slice(0, 6).map(a => a.name).join(', ');
            return {
                source: 'DELIVERY',
                type: 'DELIVERY_AREAS',
                data: { areas: activeAreas, count: activeAreas.length },
                text: `Sorry, doosre shehron mein hamari delivery available nahi hai. ${restName} sirf darj zail areas mein deliver karta hai:\n\n${areaSample}${activeAreas.length > 6 ? ' wagheira' : ''}.`,
            };
        }

        const qLower = cleanQuery.toLowerCase();
        const matchedAreas = [];

        for (const a of activeAreas) {
            const aName = a.name.toLowerCase();
            if (qLower.includes(aName)) {
                matchedAreas.push(a);
                continue;
            }
            // Match aliases
            if ((qLower.includes('ghori vvip') || qLower.includes('ghauri vvip') || qLower.includes('ghori vip')) && aName === 'ghauri vip') {
                matchedAreas.push(a);
                continue;
            }
            if ((qLower.includes('ghori town') || qLower.includes('ghauri town') || qLower.includes('ghori')) && aName.includes('ghauri town')) {
                matchedAreas.push(a);
                continue;
            }
            if (qLower.includes('khanna') && aName.includes('khana')) {
                matchedAreas.push(a);
                continue;
            }
        }

        if (matchedAreas.length > 0) {
            const { checkDeliveryAvailability } = await import('./deliveryService.js');
            const matchedNames = matchedAreas.map(m => m.name).join(', ');

            // Check if this matched area is within current max delivery radius
            const delCheck = await checkDeliveryAvailability({
                restaurantId,
                areaName: matchedNames,
                address: cleanQuery,
            });

            if (!delCheck.available) {
                return {
                    source: 'DELIVERY',
                    type: 'DELIVERY_AREAS',
                    data: { matchedAreas, count: matchedAreas.length },
                    text: delCheck.message || `Maazrat! ${matchedNames} hamari delivery range se bahar hai. Hamari delivery sirf ${delCheck.maxRadiusKm || 10} km radius tak mehdood hai.`,
                };
            }

            const isAllFree = matchedAreas.every(m => Number(m.delivery_fee) === 0);
            const feeInfo = isAllFree ? 'delivery bilkul FREE hai!' : `delivery fee Rs. ${matchedAreas[0].delivery_fee} hai.`;
            let specificText = `Ji bilkul! ${restName} *${matchedNames}* mein deliver karta hai aur yahan ${feeInfo}`;

            if (qLower.includes('dhoke kala khan') || qLower.includes('dhok kala khan')) {
                specificText += '\n\n(Lekin Dhoke Kala Khan hamari standard delivery coverage list mein shamil nahi hai).';
            }

            logger.info(
                { query: cleanQuery, source: 'DELIVERY', type: 'DELIVERY_AREAS', matched: matchedNames },
                `[KnowledgeResolver] query="${cleanQuery}" source=DELIVERY type=DELIVERY_AREAS matched="${matchedNames}"`
            );
            return {
                source: 'DELIVERY',
                type: 'DELIVERY_AREAS',
                data: { matchedAreas, count: matchedAreas.length },
                text: specificText,
            };
        }

        // If user mentioned a specific unlisted area
        if (qLower.includes('dhoke') || qLower.includes('rawalpindi') || qLower.includes('saddar') || qLower.includes('bahria')) {
            const areaList = activeAreas.slice(0, 6).map(a => a.name).join(', ');
            const isAllFree = activeAreas.every(a => Number(a.delivery_fee) === 0);
            const feeNotice = isAllFree ? ' Delivery bilkul FREE hai!' : '';
            return {
                source: 'DELIVERY',
                type: 'DELIVERY_AREAS',
                data: { areas: activeAreas, count: activeAreas.length },
                text: `Sorry, yeh area filhal hamari delivery coverage list mein shamil nahi hai. ${restName} darj zail areas mein deliver karta hai:\n\n${areaList}${activeAreas.length > 6 ? ' wagheira' : ''}.${feeNotice}`,
            };
        }

        // Retrieve maxRadiusKm from cache or settings
        let maxRadiusKm = 10.0;
        try {
            const { getCatalogCache } = await import('./catalogCacheService.js');
            const cache = await getCatalogCache();
            if (cache && typeof cache.maxDeliveryRadiusKm === 'number') {
                maxRadiusKm = cache.maxDeliveryRadiusKm;
            }
        } catch (_) {}

        const { checkDeliveryAvailability } = await import('./deliveryService.js');
        const deliverableAreas = [];
        for (const a of activeAreas) {
            const check = await checkDeliveryAvailability({
                restaurantId,
                areaName: a.name,
            }).catch(() => null);
            if (check && check.available) {
                deliverableAreas.push(a);
            }
        }

        const areasToShow = deliverableAreas.length > 0 ? deliverableAreas : activeAreas;
        const areaNames = areasToShow.map((a) => a.name);
        let deliveryText = `Hum ${restName} ke ${maxRadiusKm} km radius ke andar darj zail ${areasToShow.length} areas mein deliver karte hain:\n\n${areaNames.join(', ')}`;
        const isFree = areasToShow.every((a) => Number(a.delivery_fee) === 0);
        if (isFree) {
            deliveryText += '\n\nIn tamaam areas mein delivery bilkul FREE hai!';
        }

        logger.info(
            { query: cleanQuery, source: 'DELIVERY', type: 'DELIVERY_AREAS', count: areasToShow.length },
            `[KnowledgeResolver] query="${cleanQuery}" source=DELIVERY type=DELIVERY_AREAS`
        );
        return {
            source: 'DELIVERY',
            type: 'DELIVERY_AREAS',
            data: { areas: areasToShow, count: areasToShow.length },
            text: deliveryText,
        };
    }

    // 2.2 Active Deals Inquiry ("deals", "offers", "kya deals hain")
    if (/^(?:deals|deal|offers|special\s+deals)$/i.test(cleanQuery)) {
        const deals = await getActiveDeals(restaurantId);
        if (deals && deals.length > 0) {
            const restName = restaurant?.name && !/cravey/i.test(restaurant.name) ? restaurant.name : 'Store';
            let dealsMsg = `${restName} Special Deals\n\n`;
            deals.forEach((d) => {
                dealsMsg += `${d.name}: Rs.${Number(d.deal_price)}\n`;
                if (d.deal_items && d.deal_items.length > 0) {
                    const itemsStr = d.deal_items.map((di) => `${di.quantity}x ${di.menu_item?.name || 'Item'}`).join(', ');
                    dealsMsg += `Includes: ${itemsStr}\n`;
                }
                dealsMsg += '\n';
            });
            dealsMsg = dealsMsg.trimEnd() + `\n\nCart mein deal add karne ke liye likhein: deal 1 ya 2 deal 1.`;

            logger.info(
                { query: cleanQuery, source: 'DEALS', type: 'ACTIVE_DEALS', count: deals.length },
                `[KnowledgeResolver] query="${cleanQuery}" source=DEALS type=ACTIVE_DEALS`
            );
            return {
                source: 'DEALS',
                type: 'ACTIVE_DEALS',
                data: deals,
                text: dealsMsg,
            };
        }
    }

    // 2.3 Category Search
    const matchedCategory = await getCategoryWithItems(cleanQuery, restaurantId);
    if (matchedCategory) {
        let catMsg = `${matchedCategory.name}\n\n`;
        if (!matchedCategory.menu_items || matchedCategory.menu_items.length === 0) {
            catMsg += 'Is category mein filhal koi items dastiyab nahi hain.\n';
        } else {
            matchedCategory.menu_items.forEach((item) => {
                const priceStr =
                    item.variants && item.variants.length > 0
                        ? `from Rs.${Number(item.variants[0].price)}`
                        : `Rs.${Number(item.base_price)}`;
                catMsg += `${item.name}: ${priceStr}\n`;
            });
        }
        catMsg += `\nOrder karne ke liye likhein: quantity item_name (e.g. 2 ${matchedCategory.menu_items?.[0]?.name || 'item'}).`;

        logger.info(
            { query: cleanQuery, source: 'MENU', type: 'CATEGORY', category: matchedCategory.name },
            `[KnowledgeResolver] query="${cleanQuery}" source=MENU type=CATEGORY`
        );
        return {
            source: 'MENU',
            type: 'CATEGORY',
            data: matchedCategory,
            text: catMsg,
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PRIORITY 3: FAQ / KNOWLEDGE BASE
    // ─────────────────────────────────────────────────────────────────────────

    const faqRes = await searchKnowledge({
        restaurantId,
        query: cleanQuery,
        limit: 1,
        threshold: 0.32,
    });

    const faqMatches = faqRes?.matches || faqRes?.data?.results || [];
    if (faqMatches.length > 0 && faqMatches[0].score >= 0.32) {
        const topFaq = faqMatches[0];

        // Safety Guard against Stale FAQ Overriding Settings:
        // 1. Timings: ONLY if customer query is ACTUALLY timing-related:
        if (isTimingQuery(cleanQuery)) {
            const timingsText = formatRestaurantTimings(restaurant);
            if (timingsText) {
                logger.info(
                    { query: cleanQuery, source: 'SETTINGS', type: 'RESTAURANT_TIMINGS', overriddenFaqId: topFaq.id },
                    `[KnowledgeResolver] query="${cleanQuery}" source=SETTINGS type=RESTAURANT_TIMINGS (overrode FAQ)`
                );
                return {
                    source: 'SETTINGS',
                    type: 'RESTAURANT_TIMINGS',
                    data: { opening_time: restaurant.opening_time, closing_time: restaurant.closing_time },
                    text: timingsText,
                };
            }
        }

        // 2. Phone: ONLY if customer query is ACTUALLY phone/contact-related:
        if (isPhoneQuery(cleanQuery)) {
            const phoneText = formatRestaurantPhone(restaurant);
            if (phoneText) {
                logger.info(
                    { query: cleanQuery, source: 'SETTINGS', type: 'RESTAURANT_PHONE', overriddenFaqId: topFaq.id },
                    `[KnowledgeResolver] query="${cleanQuery}" source=SETTINGS type=RESTAURANT_PHONE (overrode FAQ)`
                );
                return {
                    source: 'SETTINGS',
                    type: 'RESTAURANT_PHONE',
                    data: { phone: restaurant.phone },
                    text: phoneText,
                };
            }
        }

        // 3. Payment: ONLY if customer query is ACTUALLY payment-related:
        if (isPaymentQuery(cleanQuery)) {
            const hasPaymentSettings =
                restaurant &&
                (restaurant.cod_enabled !== undefined ||
                    restaurant.easypaisa_enabled !== undefined ||
                    restaurant.easypaisa_number ||
                    restaurant.account_name);
            if (hasPaymentSettings) {
                const paymentText = formatPaymentMethodsResponse(restaurant);
                logger.info(
                    { query: cleanQuery, source: 'SETTINGS', type: 'PAYMENT_METHODS', overriddenFaqId: topFaq.id },
                    `[KnowledgeResolver] query="${cleanQuery}" source=SETTINGS type=PAYMENT_METHODS (overrode FAQ)`
                );
                return {
                    source: 'SETTINGS',
                    type: 'PAYMENT_METHODS',
                    data: { cod_enabled: restaurant.cod_enabled, easypaisa_enabled: restaurant.easypaisa_enabled },
                    text: paymentText,
                };
            }
        }

        // 4. Address: ONLY if customer query is ACTUALLY address/location-related:
        if (isAddressQuery(cleanQuery)) {
            const addressText = formatRestaurantAddress(restaurant);
            if (addressText) {
                logger.info(
                    { query: cleanQuery, source: 'SETTINGS', type: 'RESTAURANT_ADDRESS', overriddenFaqId: topFaq.id },
                    `[KnowledgeResolver] query="${cleanQuery}" source=SETTINGS type=RESTAURANT_ADDRESS (overrode FAQ)`
                );
                return {
                    source: 'SETTINGS',
                    type: 'RESTAURANT_ADDRESS',
                    data: { address: restaurant.address },
                    text: addressText,
                };
            }
        }

        // Standard FAQ Match (policies, persona, review links, handoff, general guidance)
        logger.info(
            { query: cleanQuery, source: 'FAQ', type: 'FAQ_MATCH', faqId: topFaq.id },
            `[KnowledgeResolver] query="${cleanQuery}" source=FAQ faqId="${topFaq.id}"`
        );
        return {
            source: 'FAQ',
            type: 'FAQ_MATCH',
            data: topFaq,
            text: topFaq.answer,
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PRIORITY 4: SAFE FALLBACK
    // ─────────────────────────────────────────────────────────────────────────

    logger.info(
        { query: cleanQuery, source: 'FALLBACK', type: 'SAFE_FALLBACK' },
        `[KnowledgeResolver] query="${cleanQuery}" source=FALLBACK type=SAFE_FALLBACK`
    );

    if (isPhoneQuery(cleanQuery)) {
        const restName = restaurant?.name && !/cravey/i.test(restaurant.name) ? restaurant.name : 'Store';
        return {
            source: 'FALLBACK',
            type: 'SAFE_FALLBACK',
            data: null,
            text: `Filhal ${restName} ka helpline number available nahi hai. Barah-e-karam isi WhatsApp chat par apna paighaam bhej dein, hamari team jald rabta karegi.`,
        };
    }

    return {
        source: 'FALLBACK',
        type: 'SAFE_FALLBACK',
        data: null,
        text: 'Sorry, mere paas is sawal ka confirmed answer available nahi hai.\n\nAap restaurant team se contact kar sakte hain.',
    };
}
