/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║   WhatsApp Order Orchestrator                                ║
 * ║   src/services/whatsappOrderOrchestrator.js                  ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Responsibilities:
 *   - Receive normalized incoming WhatsApp message
 *   - Resolve current conversation session
 *   - Inspect session stage
 *   - Detect deterministic intent via parseIntent
 *   - Call existing backend services (Menu, Cart, Pricing, Delivery, Orders, Knowledge, Settings)
 *   - Update session stage
 *   - Return structured response
 *   - NEVER calculate pricing directly (uses pricingService/cartService)
 *   - NEVER directly query data where a service already exists
 *   - NEVER create orders outside orderService
 */

import { getDbClient } from '../db/client.js';
import { getDefaultRestaurantId } from './restaurantService.js';
import { getOrCreateSession, updateSessionStage, touchSession } from './sessionService.js';
import { parseIntent, isPaymentQuery } from './intentParser.js';
import { getActiveMenu, getActiveCategories, getCategoryWithItems, getActiveDeals, resolveMenuItemOrDeal } from './menuService.js';
import { getActiveCart, addItemToCart, updateCartItem, removeCartItem, clearCart, calculateCartTotals } from './cartService.js';
import { calculateDiscount, getGlobalDiscountSettings } from './discountService.js';
import { checkDeliveryAvailability, getOutOfDeliveryMessage } from './deliveryService.js';
import { createOrder, getOrderByNumber, requestOrderCancellation, confirmOrderCancellation } from './orderService.js';
import { searchKnowledge } from './knowledgeService.js';
import {
    resolveBusinessAnswer,
    formatRestaurantTimings,
    formatRestaurantAddress,
    formatRestaurantPhone,
    isTimingQuery,
    isAddressQuery,
    isPhoneQuery,
    isDeliveryInfoQuery,
} from './businessKnowledgeResolver.js';
import { normalizePhone, deleteCustomerByPhone } from './customerService.js';
import { muteChatForHandover } from './handoverService.js';
import { extractGoogleMapsUrl } from '../../utils/location.js';
import { logger } from '../utils/logger.js';

// In-memory checkout draft map for transient ordering details (customerName, phone, delivery, payment)
// Keyed by session.id
const sessionDrafts = new Map();

// In-memory set for message deduplication
const processedMessageIds = new Set();

/**
 * Get or initialize draft checkout state for a session
 */
function getDraft(sessionId) {
    if (!sessionDrafts.has(sessionId)) {
        sessionDrafts.set(sessionId, {
            customerName: null,
            phone: null,
            contactNumberMode: 'provided',
            delivery: null,
            paymentMethod: null,
            pendingVariantItem: null,
            lastUpdated: Date.now(),
        });
    }
    return sessionDrafts.get(sessionId);
}

/**
 * Clear draft checkout state
 */
function clearDraft(sessionId) {
    sessionDrafts.delete(sessionId);
}

/**
 * Extract leading/trailing quantity and item/deal query from customer input
 * Examples:
 *   "2 Chicken Extreme" -> quantity: 2, query: "Chicken Extreme"
 *   "Chicken Extreme 2" -> quantity: 2, query: "Chicken Extreme"
 *   "Chicken Extreme x2" -> quantity: 2, query: "Chicken Extreme"
 *   "Deal 1" -> quantity: 1, query: "Deal 1"
 *   "2 Deal 1" -> quantity: 2, query: "Deal 1"
 *   "Chicken Extreme" -> quantity: 1, query: "Chicken Extreme"
 */
export function extractQuantityAndQuery(input) {
    let raw = (input || '').trim();
    if (!raw) return { quantity: 1, query: '' };

    // Strip cart addition wrappers: "cart mai add kro deal 5", "cart me daal do 2 zinger"
    const cartWrapper = raw.match(/^(?:cart\s*(?:m|me|mai|mein)\s*(?:add|daal|dalo|rakh|rakho)\s*(?:kro|kar\s*do|karo)?)\s+(.+)$/i) ||
                        raw.match(/^(?:add|daal|dalo)\s+(.+?)\s+(?:in|to|mein|mai|me)\s+cart$/i) ||
                        raw.match(/^(.+?)\s+(?:ko\s+)?cart\s*(?:m|me|mai|mein)\s*(?:add|daal|dalo)(?:\s*(?:kro|kar\s*do|karo))?$/i);
    if (cartWrapper) {
        raw = cartWrapper[1].trim();
    }

    // Deal with explicit leading quantity: "2 Deal 1", "2x Deal 1"
    const dealLeadingQty = raw.match(/^(\d+)\s+(?:x\s+)?(deal\s*(?:#|no\.?)?\s*\d+)$/i);
    if (dealLeadingQty) {
        return { quantity: parseInt(dealLeadingQty[1], 10), query: dealLeadingQty[2].trim() };
    }
    // Deal with trailing quantity: "Deal 1 x2", "Deal 1 * 2"
    const dealTrailingQty = raw.match(/^(deal\s*(?:#|no\.?)?\s*\d+)\s*(?:x|\*)\s*(\d+)$/i);
    if (dealTrailingQty) {
        return { quantity: parseInt(dealTrailingQty[2], 10), query: dealTrailingQty[1].trim() };
    }
    // Direct deal without quantity: "Deal 1", "deal 2"
    if (/^deal\s*(?:#|no\.?)?\s*\d+$/i.test(raw)) {
        return { quantity: 1, query: raw.trim() };
    }

    // Leading quantity: "2 Chicken Extreme", "1 Pizza", "2 P5 Crispy Zinger"
    const leadingMatch = raw.match(/^(\d+)\s*(?:x\s+)?(.+)$/i);
    if (leadingMatch && leadingMatch[2].trim().length > 1) {
        return { quantity: parseInt(leadingMatch[1], 10), query: leadingMatch[2].trim() };
    }

    // Trailing quantity: "Chicken Extreme 2", "Chicken Extreme x2"
    const trailingMatch = raw.match(/^(.+?)\s*(?:x|\*|\s)\s*(\d+)$/i);
    if (trailingMatch && trailingMatch[1].trim().length > 1) {
        return { quantity: parseInt(trailingMatch[2], 10), query: trailingMatch[1].trim() };
    }

    // Verb prefix: "add 2 Chicken Extreme", "order Chicken Extreme"
    const verbMatch = raw.match(/^(?:add|order|chahiye)\s+(\d+)?\s*(.+)$/i);
    if (verbMatch) {
        const qty = verbMatch[1] ? parseInt(verbMatch[1], 10) : 1;
        return { quantity: qty, query: verbMatch[2].trim() };
    }

    return { quantity: 1, query: raw.trim() };
}

/**
 * Format category items dynamically from PostgreSQL with discount strikethrough
 */
export function formatCategoryResponse(category, globalDiscount = null, dealsContext = null) {
    let banner = '';
    if (globalDiscount && globalDiscount.enabled) {
        const valStr = globalDiscount.type === 'FIXED' ? `Rs. ${globalDiscount.value} OFF` : `${globalDiscount.value}% OFF`;
        banner = `🏷️ *SPECIAL OFFER: ${globalDiscount.title.toUpperCase()} (${valStr} ON ALL ITEMS)* 🏷️\n\n`;
    }

    const lowerName = (category.name || '').toLowerCase();

    // Check if this is a deals category with rich deals context available from catalog cache
    if (dealsContext) {
        if (/pi[z]+a\s*deals?/i.test(lowerName) && dealsContext.customerPizzaDeals) {
            return `${banner}${dealsContext.customerPizzaDeals}\n\nOrder karne ke liye kisi bhi deal ka naam bata dein (jaise *Deal 2* ya *Pizza Meal For 1*)!`;
        }
        if (/burger\s*deals?/i.test(lowerName) && dealsContext.customerBurgerDeals) {
            return `${banner}${dealsContext.customerBurgerDeals}\n\nOrder karne ke liye kisi bhi deal ka naam bata dein (jaise *Burger Meal For 1* ya *Deal 4*)!`;
        }
    }

    let catMsg = `${banner}*${category.name.toUpperCase()}*\n━━━━━━━━━━━━━━━━━━━━━\n\n`;
    if (!category.menu_items || category.menu_items.length === 0) {
        catMsg += 'Is category mein filhal koi items dastiyab nahi hain.\n';
    } else {
        category.menu_items.forEach((item) => {
            const hasVariants = item.variants && item.variants.length > 0;
            const rawPrice = hasVariants ? Number(item.variants[0].price) : Number(item.base_price);
            const vPct = hasVariants ? item.variants[0].discount_percent : null;
            const vFixed = hasVariants ? item.variants[0].discount_fixed : null;
            const disc = calculateDiscount(rawPrice, vPct ?? item.discount_percent, vFixed ?? item.discount_fixed, globalDiscount);

            let priceStr = '';
            if (disc.hasDiscount) {
                priceStr = hasVariants ? `from ${disc.formattedFull}` : disc.formattedFull;
            } else {
                priceStr = hasVariants ? `from Rs. ${rawPrice}` : `Rs. ${rawPrice}`;
            }
            catMsg += `• *${item.name}*: ${priceStr}\n`;
            if (item.description) {
                catMsg += `   _${item.description}_\n`;
            }
        });
    }

    const isDeals = /deals?/i.test(lowerName);
    if (isDeals) {
        catMsg += `\nOrder karne ke liye kisi bhi deal ka naam bata dein!`;
    } else {
        catMsg += `\nOrder karne ke liye likhein: quantity item_name (e.g. 2 ${category.menu_items?.[0]?.name || 'item'}).`;
    }
    return catMsg;
}

/**
 * Format live payment options dynamically from Restaurant Settings in PostgreSQL
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
 * Handle resolved menu item or deal dynamically
 */
export async function handleResolvedItemOrDeal({ resolved, quantity, convSession, restaurantId, draft }) {
    if (resolved.status === 'AMBIGUOUS') {
        let ambMsg = `Aap ki request se mutabiq aik se zyada items miley. Barah-e-karam wazeh naam likhein:\n\n`;
        resolved.candidates.forEach(c => {
            const p = c.basePrice || c.price ? `: Rs.${c.basePrice || c.price}` : '';
            ambMsg += `${c.name}${p}\n`;
        });
        return { text: ambMsg.trimEnd(), intent: 'ADD_ITEM' };
    }

    // Deal match
    if (resolved.type === 'DEAL') {
        await addItemToCart({
            sessionKey: convSession.session_key,
            restaurantId,
            dealId: resolved.deal.id,
            quantity,
        });

        await updateSessionStage({ sessionKey: convSession.session_key, stage: 'BUILDING_CART' });
        const cartTotals = await calculateCartTotals({ sessionKey: convSession.session_key });

        return {
            text: 
`Added to Cart!

${quantity}x ${resolved.deal.name}: Rs.${Number(resolved.deal.deal_price) * quantity}
Subtotal: Rs.${cartTotals.subtotal}

Reply cart to view cart ya checkout to proceed.`,
            intent: 'ADD_ITEM',
            stage: 'BUILDING_CART',
        };
    }

    // Menu item match
    if (resolved.type === 'ITEM') {
        // If variant was matched directly from query (e.g. user said "behari kebab pizza large")
        if (resolved.matchedVariant) {
            await addItemToCart({
                sessionKey: convSession.session_key,
                restaurantId,
                menuItemId: resolved.item.id,
                variantId: resolved.matchedVariant.id,
                quantity,
            });

            await updateSessionStage({ sessionKey: convSession.session_key, stage: 'BUILDING_CART' });
            const cartTotals = await calculateCartTotals({ sessionKey: convSession.session_key });
            const globalDiscount = await getGlobalDiscountSettings(restaurantId);
            const disc = calculateDiscount(
                resolved.matchedVariant.price,
                resolved.matchedVariant.discount_percent ?? resolved.item.discount_percent,
                resolved.matchedVariant.discount_fixed ?? resolved.item.discount_fixed,
                globalDiscount
            );
            const originalPrice = Number(resolved.matchedVariant.price);
            const unitPriceStr = disc.hasDiscount
                ? `~Rs. ${originalPrice * quantity}~ Rs. ${disc.discountedPrice * quantity} (${disc.label})`
                : `Rs. ${originalPrice * quantity}`;

            const discountLine = cartTotals.discountTotal > 0 ? `\nDiscount: -Rs. ${cartTotals.discountTotal}\nTotal: Rs. ${cartTotals.total}` : '';
            return {
                text: 
`Added to Cart!

${quantity}x ${resolved.item.name} (${resolved.matchedVariant.name}): ${unitPriceStr}
Subtotal: Rs. ${cartTotals.subtotal}${discountLine}

Reply cart to view cart ya checkout to proceed.`,
                intent: 'ADD_ITEM',
                stage: 'BUILDING_CART',
            };
        }

        // If item has variants but no size was specified, prompt for size
        if (resolved.hasVariants && resolved.variants && resolved.variants.length > 0) {
            draft.pendingVariantItem = {
                item: resolved.item,
                variants: resolved.variants,
                quantity,
            };

            const globalDiscount = await getGlobalDiscountSettings(restaurantId);

            let varMsg = `*${resolved.item.name}*\n\n`;
            resolved.variants.forEach((v) => {
                const vPrice = Number(v.price);
                const disc = calculateDiscount(
                    vPrice,
                    v.discount_percent ?? resolved.item.discount_percent,
                    v.discount_fixed ?? resolved.item.discount_fixed,
                    globalDiscount
                );

                if (disc.hasDiscount) {
                    varMsg += `• ${v.name}: ~Rs. ${vPrice}~ Rs. ${disc.discountedPrice} (${disc.label})\n`;
                } else {
                    varMsg += `• ${v.name}: Rs. ${vPrice}\n`;
                }
            });

            varMsg += `\nApna size select karein (jaise *Small*, *Medium*, ya *Large*).`;

            return { text: varMsg.trimEnd(), intent: 'ADD_ITEM' };
        }

        // Item without variants
        await addItemToCart({
            sessionKey: convSession.session_key,
            restaurantId,
            menuItemId: resolved.item.id,
            quantity,
        });

        await updateSessionStage({ sessionKey: convSession.session_key, stage: 'BUILDING_CART' });
        const cartTotals = await calculateCartTotals({ sessionKey: convSession.session_key });
        const globalDiscount = await getGlobalDiscountSettings(restaurantId);
        const disc = calculateDiscount(
            resolved.item.base_price,
            resolved.item.discount_percent,
            resolved.item.discount_fixed,
            globalDiscount
        );
        const unitPriceStr = disc.hasDiscount
            ? `~Rs. ${Number(resolved.item.base_price) * quantity}~ Rs. ${disc.discountedPrice * quantity} (${disc.label})`
            : `Rs. ${Number(resolved.item.base_price) * quantity}`;

        const discountLine = cartTotals.discountTotal > 0 ? `\nDiscount: -Rs. ${cartTotals.discountTotal}\nTotal: Rs. ${cartTotals.total}` : '';
        return {
            text: 
`Added to Cart!

${quantity}x ${resolved.item.name}: ${unitPriceStr}
Subtotal: Rs. ${cartTotals.subtotal}${discountLine}

Reply cart to view cart ya checkout to proceed.`,
            intent: 'ADD_ITEM',
            stage: 'BUILDING_CART',
        };
    }

    return null;
}

/**
 * Fetch restaurant profile
 */
async function getRestaurant(restaurantId) {
    const prisma = getDbClient();
    if (!prisma) return null;
    return prisma.restaurant.findUnique({
        where: { id: restaurantId },
    });
}

/**
 * Main Order Orchestrator Entry Point
 *
 * @param {Object} params
 * @param {Object} [params.sock] - Baileys socket
 * @param {Object} [params.session] - Baileys session object
 * @param {Object} params.normalizedMessage
 * @param {string} params.normalizedMessage.sessionId
 * @param {string} params.normalizedMessage.chatId
 * @param {string} params.normalizedMessage.messageId
 * @param {string} params.normalizedMessage.text
 * @param {string} [params.normalizedMessage.messageType]
 * @param {string} [params.normalizedMessage.verifiedPhone]
 * @param {boolean} [params.normalizedMessage.phoneVerified]
 * @param {string} [params.normalizedMessage.phoneSource]
 * @param {string} [params.normalizedMessage.pushName]
 * @param {Object} [params.normalizedMessage.location]
 * @param {boolean} [params.normalizedMessage.isGroup]
 * @returns {Promise<{ text: string, intent?: string, stage?: string }|null>}
 */
export async function handleIncomingOrderMessage({ sock, session: baileysSession, normalizedMessage }) {
    if (!normalizedMessage) return null;

    // Rule: Private chats only
    if (normalizedMessage.isGroup) {
        return null;
    }

    const {
        chatId,
        messageId,
        text = '',
        messageType,
        verifiedPhone,
        phoneVerified,
        location,
    } = normalizedMessage;

    // Rule: Guard against empty message events
    const cleanText = (text || '').trim();
    if (!cleanText && !location && messageType !== 'image') {
        return null;
    }

    // Rule: Deduplicate incoming message IDs
    if (messageId) {
        if (processedMessageIds.has(messageId)) {
            logger.info({ messageId }, '[ORCHESTRATOR] Duplicate message ignored');
            return null;
        }
        processedMessageIds.add(messageId);
        // Cap deduplication cache at 10,000 entries
        if (processedMessageIds.size > 10000) {
            const firstKey = processedMessageIds.values().next().value;
            processedMessageIds.delete(firstKey);
        }
    }

    const restaurantId = await getDefaultRestaurantId();
    const restaurant = await getRestaurant(restaurantId);
    const restName = restaurant?.name && !/cravey/i.test(restaurant.name) ? restaurant.name : 'Store';

    // ── 1. Resolve Conversation Session ───────────────────────────────────
    const convSession = await getOrCreateSession({
        restaurantId,
        chatId,
        sessionKey: chatId,
        verifiedPhone,
    });

    const draft = getDraft(convSession.id);

    // ── 2. Handle Pending Variant Selection ───────────────────────────────
    // If the customer was previously asked to select a variant for an item
    if (draft.pendingVariantItem) {
        const pending = draft.pendingVariantItem;
        const variants = pending.variants || [];
        const cleanT = cleanText.toLowerCase();

        let chosenVariant = null;

        // Check by number: "1", "2", "3" or "size 3"
        const num = parseInt(cleanT.replace(/\D/g, ''), 10);
        if (!isNaN(num) && num >= 1 && num <= variants.length) {
            chosenVariant = variants[num - 1];
        } else {
            // Check by name: "small", "medium", "large", "party size"
            chosenVariant = variants.find(v => 
                v.name.toLowerCase() === cleanT || 
                cleanT.includes(v.name.toLowerCase())
            );
        }

        if (chosenVariant) {
            draft.pendingVariantItem = null;
            await addItemToCart({
                sessionKey: convSession.session_key,
                restaurantId,
                menuItemId: pending.item.id,
                variantId: chosenVariant.id,
                quantity: pending.quantity || 1,
            });

            await updateSessionStage({ sessionKey: convSession.session_key, stage: 'BUILDING_CART' });
            const cartTotals = await calculateCartTotals({ sessionKey: convSession.session_key });

            const qty = pending.quantity || 1;
            const globalDiscount = await getGlobalDiscountSettings(restaurantId);
            const disc = calculateDiscount(
                chosenVariant.price,
                chosenVariant.discount_percent ?? pending.item.discount_percent,
                chosenVariant.discount_fixed ?? pending.item.discount_fixed,
                globalDiscount
            );
            const unitPriceStr = disc.hasDiscount
                ? `~Rs. ${Number(chosenVariant.price) * qty}~ Rs. ${disc.discountedPrice * qty} (${disc.label})`
                : `Rs. ${Number(chosenVariant.price) * qty}`;

            const discountLine = cartTotals.discountTotal > 0 ? `\nDiscount: -Rs. ${cartTotals.discountTotal}\nTotal: Rs. ${cartTotals.total}` : '';
            return {
                text: 
`Added to Cart!

${qty}x ${pending.item.name} (${chosenVariant.name}): ${unitPriceStr}
Subtotal: Rs. ${cartTotals.subtotal}${discountLine}

Reply cart to view cart ya checkout to continue.`,
                intent: 'ADD_ITEM',
                stage: 'BUILDING_CART',
            };
        }
        // If not a valid variant choice, check if they sent a general command like "cancel"
        if (cleanT === 'cancel' || cleanT === 'no') {
            draft.pendingVariantItem = null;
            return {
                text: 'Variant selection cancel kar di gayi. Aap mazeed items add kar sakte hain.',
                intent: 'CANCEL',
            };
        }
        // Customer chose not to select a variant and sent another command/item: clear pendingVariantItem so they don't get stuck!
        draft.pendingVariantItem = null;
    }

    // ── 3. Parse Deterministic Intent ─────────────────────────────────────
    let intentResult = parseIntent({
        text,
        stage: convSession.stage,
        messageType,
        location,
    });

    // ── 3.1 Deal Details / Inquiry Shortcut Guard ─────────────────────────
    // If the customer asks "deal 3 mai kya kya ha", "deal 3 mai kya kay ha", "deal 1 details", don't treat it as ADD_ITEM!
    if (/\bdeal\s*#?\d+\b/i.test(cleanText) && /\b(?:(?:kya|kia|kay)\s*(?:kya|kia|kay)?\s*(?:h|ha|hai|hay|hy|hega)|detail|details|shamil|includes?|items?|batao)\b/i.test(cleanText)) {
        intentResult = { intent: 'DEAL_INQUIRY', entities: {}, confidence: 0.98 };
    } else if (isTimingQuery(cleanText)) {
        intentResult = { intent: 'TIMINGS_QUERY', entities: {}, confidence: 0.99 };
    } else if (isPhoneQuery(cleanText)) {
        intentResult = { intent: 'RESTAURANT_PHONE', entities: {}, confidence: 0.99 };
    }

    let { intent, entities } = intentResult;
    logger.info({ chatId, stage: convSession.stage, intent, entities }, '[ORCHESTRATOR] Parsed intent');

    // ── 4. Dispatch Intent to Handler ──────────────────────────────────────

    // GREETING
    if (intent === 'GREETING') {
        return {
            text: 
`Walaikum Assalam!
${restName} mein khush amdeed. Main aapka AI food ordering assistant hoon. Aaj aap kya order karna pasand karein ge?

Menu: Categories aur khaney dekhne ke liye
Deals: Special discount deals dekhne ke liye
Order Status: Apne order ka status janne ke liye
Cancel Order: Order cancel karne ke liye

Direct order karne ke liye item likhein (e.g. 2 Burger ya 1 Pizza).`,
            intent,
            stage: convSession.stage,
        };
    }

    // Number shortcuts at START stage (1 -> Menu, 2 -> Deals, 3 -> Status, 4 -> Cancel)
    if (convSession.stage === 'START') {
        const cleanT = cleanText.toLowerCase();
        if (cleanT === '1') {
            intentResult.intent = 'SHOW_MENU';
        } else if (cleanT === '2') {
            intentResult.intent = 'SHOW_DEALS';
        } else if (cleanT === '3') {
            intentResult.intent = 'ORDER_STATUS_QUERY';
        } else if (cleanT === '4') {
            intentResult.intent = 'REQUEST_ORDER_CANCELLATION';
        }
    }

    // START_ORDER
    if (intent === 'START_ORDER') {
        await updateSessionStage({ sessionKey: convSession.session_key, stage: 'BROWSING_MENU' });
        return {
            text: `${restName} mein order book karne ke liye khush amdeed! 🎉\n\nAap is tarah order kar saktay hain:\n\n1. *Menu* likh kar categories dekhein\n2. *Deals* likh kar special discount packages dekhein\n3. Ya direct item likhein (e.g. *2 zinger* ya *1 deal 1*)\n\nAap kya order karna pasand karein ge?`,
            intent: 'START_ORDER',
            stage: 'BROWSING_MENU',
        };
    }

    // RESTAURANT_PHONE
    if (intent === 'RESTAURANT_PHONE' || isPhoneQuery(cleanText)) {
        const phoneText = formatRestaurantPhone(restaurant);
        return {
            text: phoneText,
            intent: 'RESTAURANT_PHONE',
            stage: convSession.stage,
        };
    }

    // ── Category Check (Prior to Generic Menu / Deals Fallback) ──
    let matchedCategory = null;
    const catQuery = entities?.categoryName || cleanText.replace(/piza\b/gi, 'pizza');

    if (intent === 'SHOW_CATEGORY' || entities?.categoryName) {
        matchedCategory = await getCategoryWithItems(catQuery, restaurantId);
    } else if (
        !/^(?:deals?|special\s+deals|offers|menu)$/i.test(cleanText.trim()) &&
        !/^(?:g|ji|jee|haan?|han|hn|yes|yep|theek\s*hai?|theek\s*hy|thk|ok|okay|confirm|sahi|bilkul|hi+|hello+|hey+|salam|slam|aoa)[\s.!?]*$/i.test(cleanText.trim()) &&
        cleanText.trim().length >= 3 &&
        convSession.stage !== 'COLLECTING_DETAILS' &&
        convSession.stage !== 'CONFIRMING_ORDER' &&
        convSession.stage !== 'AWAITING_PAYMENT'
    ) {
        // Check if query matches or contains any active category name (e.g. "drinks", "drinks mai kya ha", "premium pizzas")
        const allCategories = await getActiveCategories(restaurantId);
        const lowerQ = cleanText.toLowerCase().replace(/piza\b/g, 'pizza');
        const escapeReg = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        for (const c of allCategories) {
            const cName = c.name.toLowerCase();
            const cSingular = cName.replace(/s$/, '');
            const isExact = lowerQ === cName || lowerQ === cSingular;
            const isWordMatch = cName.length >= 4 && (new RegExp(`\\b${escapeReg(cName)}\\b`, 'i').test(lowerQ) || new RegExp(`\\b${escapeReg(cSingular)}\\b`, 'i').test(lowerQ));
            if (isExact || isWordMatch) {
                matchedCategory = await getCategoryWithItems(c.id, restaurantId);
                break;
            }
        }
    }

    if (matchedCategory) {
        await updateSessionStage({ sessionKey: convSession.session_key, stage: 'BROWSING_MENU' });
        const globalDiscount = await getGlobalDiscountSettings(restaurantId);
        let catText = formatCategoryResponse(matchedCategory, globalDiscount);
        if (/\b(?:discount|discounts|deals?)\b/i.test(cleanText) && !matchedCategory.name.toLowerCase().includes('deal')) {
            catText += `\n\n💡 Special discount packages dekhne ke liye "deals" reply karein.`;
        }
        return {
            text: catText,
            imageUrl: matchedCategory.image_url || 'assets/menu/cravey_crust_main_menu.png',
            intent: 'SHOW_CATEGORY',
            stage: 'BROWSING_MENU',
        };
    }

    // Contextual Deal Add (if customer says "add kr du cart mai", "add kardo", etc.)
    if (intent === 'ADD_ITEM' && (entities?.contextual || !entities?.itemQuery)) {
        if (draft.lastInquiredDeal) {
            const dealToAdd = draft.lastInquiredDeal;
            draft.lastInquiredDeal = null;
            await addItemToCart({
                sessionKey: convSession.session_key,
                restaurantId,
                dealId: dealToAdd.id,
                quantity: 1,
            });
            await updateSessionStage({ sessionKey: convSession.session_key, stage: 'BUILDING_CART' });
            const cartTotals = await calculateCartTotals({ sessionKey: convSession.session_key });
            let respMsg = `Added to Cart!\n\n1x ${dealToAdd.name}: Rs.${Number(dealToAdd.deal_price)}\nSubtotal: Rs.${cartTotals.subtotal}`;
            if (/\b(?:discount|discounts|offer)\b/i.test(cleanText)) {
                respMsg += `\n\n(Note: Deals mein already maximum discount included hota hai!)`;
            }
            respMsg += `\n\nReply cart to view cart ya checkout to proceed.`;
            return {
                text: respMsg,
                intent: 'ADD_ITEM',
                stage: 'BUILDING_CART',
            };
        }
    }

    // SHOW_MENU
    if (intent === 'SHOW_MENU' || intentResult.intent === 'SHOW_MENU') {
        await updateSessionStage({ sessionKey: convSession.session_key, stage: 'BROWSING_MENU' });
        const { getCatalogCache } = await import('./catalogCacheService.js');
        const cache = await getCatalogCache();
        const menuImages = (Array.isArray(cache.menuImageUrls) && cache.menuImageUrls.length > 0)
            ? cache.menuImageUrls
            : (cache.menuImageUrl ? [cache.menuImageUrl] : []);
        if (menuImages.length > 0) {
            return { text: '', imageUrls: menuImages, imageUrl: menuImages[0], intent: 'SHOW_MENU', stage: 'BROWSING_MENU' };
        }
        return { text: cache.customerMenuCatalog || 'Main Menu dastiyab hai.', imageUrls: [], imageUrl: null, intent: 'SHOW_MENU', stage: 'BROWSING_MENU' };
    }

    // SHOW_DEALS
    if (intent === 'SHOW_DEALS' || intentResult.intent === 'SHOW_DEALS') {
        const { getCatalogCache } = await import('./catalogCacheService.js');
        const cache = await getCatalogCache();
        const dealsImages = (Array.isArray(cache.dealsImageUrls) && cache.dealsImageUrls.length > 0)
            ? cache.dealsImageUrls
            : (cache.dealsImageUrl ? [cache.dealsImageUrl] : []);
        if (dealsImages.length > 0) {
            return { text: '', imageUrls: dealsImages, imageUrl: dealsImages[0], intent: 'SHOW_DEALS' };
        }
        return { text: cache.customerAllDeals || 'Deals dastiyab nahi hain.', imageUrls: [], imageUrl: null, intent: 'SHOW_DEALS' };
    }

    // DEAL_INQUIRY
    if (intent === 'DEAL_INQUIRY') {
        const dMatch = cleanText.match(/\bdeal\s*#?(\d+)\b/i);
        if (dMatch) {
            const dNum = dMatch[1];
            const deals = await getActiveDeals(restaurantId);
            const targetDeal = deals.find(d => new RegExp(`\\bdeal\\s*#?${dNum}\\b`, 'i').test(d.name));
            if (targetDeal) {
                draft.lastInquiredDeal = targetDeal;
                let msg = `*${targetDeal.name}* (Rs. ${Number(targetDeal.deal_price)}):\n\n`;
                if (targetDeal.deal_items && targetDeal.deal_items.length > 0) {
                    msg += `Items shamil hain:\n`;
                    targetDeal.deal_items.forEach(di => {
                        const vName = di.menu_variant?.name && !di.menu_item?.name?.toLowerCase().includes(di.menu_variant.name.toLowerCase()) ? ` (${di.menu_variant.name})` : '';
                        msg += `• ${di.quantity}x ${di.menu_item?.name || di.custom_name || 'Item'}${vName}\n`;
                    });
                }
                msg += `\nCart mein add karne ke liye reply karein: "deal ${dNum}" ya "1 deal ${dNum}".`;
                return { text: msg.trim(), intent: 'DEAL_INQUIRY', stage: convSession.stage };
            }
        }
    }

    // TIMINGS_QUERY
    if (intent === 'TIMINGS_QUERY' || intent === 'RESTAURANT_TIMINGS') {
        const timingsRes = await resolveBusinessAnswer({
            restaurantId,
            query: cleanText,
            intent: 'RESTAURANT_TIMINGS',
            context: { stage: convSession.stage, sessionKey: convSession.session_key, chatId, entities, restaurant, draft }
        });
        if (timingsRes) return { text: timingsRes.text, intent: 'RESTAURANT_TIMINGS', stage: convSession.stage };
    }

    // DELIVERY_AREAS_QUERY
    if (intent === 'DELIVERY_AREAS_QUERY') {
        const delRes = await resolveBusinessAnswer({
            restaurantId,
            query: cleanText,
            intent: 'DELIVERY_AREAS',
            context: { stage: convSession.stage, sessionKey: convSession.session_key, chatId, entities, restaurant, draft }
        });
        if (delRes) return { text: delRes.text, intent: 'DELIVERY_AREAS_QUERY', stage: convSession.stage };
    }

    // PAYMENT_METHODS_QUERY
    if (intent === 'PAYMENT_METHODS_QUERY') {
        const payRes = await resolveBusinessAnswer({
            restaurantId,
            query: cleanText,
            intent: 'PAYMENT_METHODS',
            context: { stage: convSession.stage, sessionKey: convSession.session_key, chatId, entities, restaurant, draft }
        });
        if (payRes) return { text: payRes.text, intent: 'PAYMENT_METHODS_QUERY', stage: convSession.stage };
    }


    // SHOW_CART
    if (intent === 'SHOW_CART') {
        const cart = await getActiveCart({ sessionKey: convSession.session_key });

        if (!cart || !cart.items || cart.items.length === 0) {
            return {
                text: 'Aap ka cart abhi khali hai.\nMenu dekhne ke liye menu likhein aur items add karein.',
                intent,
            };
        }

        const cartTotals = await calculateCartTotals({ sessionKey: convSession.session_key });

        let cartMsg = `Your Cart\n\n`;
        cartTotals.items.forEach(it => {
            const varStr = it.variantName ? ` (${it.variantName})` : '';
            if (it.hasDiscount) {
                cartMsg += `${it.quantity}x ${it.name}${varStr}: ~Rs.${it.originalLineTotal}~ Rs.${it.lineTotal} (${it.discountLabel || (it.discountPercent + '% OFF')})\n`;
            } else {
                cartMsg += `${it.quantity}x ${it.name}${varStr}: Rs.${it.lineTotal || it.totalPrice}\n`;
            }
        });
        cartTotals.deals.forEach(d => {
            cartMsg += `${d.quantity}x ${d.name}: Rs.${d.lineTotal || d.totalPrice}\n`;
        });
        const discountAmt = Number(cartTotals.discountTotal ?? cartTotals.discount ?? 0);
        if (discountAmt > 0) {
            cartMsg += `\nSubtotal: Rs.${cartTotals.subtotal}\nDiscount: -Rs.${discountAmt}\nTotal: Rs.${cartTotals.total}\n\n`;
        } else {
            cartMsg += `\nSubtotal: Rs.${cartTotals.subtotal}\n\n`;
        }
        cartMsg += `Reply checkout to order, clear cart to empty, ya mazeed items add karein.`;

        return { text: cartMsg, intent };
    }

    // REMOVE_ITEM
    if (intent === 'REMOVE_ITEM') {
        const query = entities.itemQuery?.toLowerCase();
        const cart = await getActiveCart({ sessionKey: convSession.session_key });

        if (!cart || !cart.items || cart.items.length === 0) {
            return { text: 'Cart already empty hai.', intent };
        }

        const target = cart.items.find(ci => {
            const name = (ci.menu_item?.name || ci.deal?.name || '').toLowerCase();
            return name.includes(query) || query.includes(name);
        });

        if (!target) {
            return {
                text: `Item '${entities.itemQuery}' aap ke cart mein nahi mila.`,
                intent,
            };
        }

        await removeCartItem({ sessionKey: convSession.session_key, cartItemId: target.id });
        const cartTotals = await calculateCartTotals({ sessionKey: convSession.session_key });

        return {
            text: `${target.menu_item?.name || target.deal?.name} cart se remove kar diya gaya.\nSubtotal: Rs.${cartTotals.subtotal}`,
            intent,
        };
    }

    // CHANGE_QUANTITY
    if (intent === 'CHANGE_QUANTITY') {
        const query = entities.itemQuery?.toLowerCase();
        const quantity = entities.quantity;
        const cart = await getActiveCart({ sessionKey: convSession.session_key });

        if (!cart || !cart.items || cart.items.length === 0) {
            return { text: 'Cart abhi khali hai.', intent };
        }

        const target = cart.items.find(ci => {
            const name = (ci.menu_item?.name || ci.deal?.name || '').toLowerCase();
            return name.includes(query) || query.includes(name);
        });

        if (!target) {
            return {
                text: `Item '${entities.itemQuery}' aap ke cart mein nahi mila.`,
                intent,
            };
        }

        if (quantity <= 0) {
            await removeCartItem({ sessionKey: convSession.session_key, cartItemId: target.id });
            return { text: `Item cart se remove kar diya gaya.`, intent };
        }

        await updateCartItem({ sessionKey: convSession.session_key, cartItemId: target.id, quantity });
        const cartTotals = await calculateCartTotals({ sessionKey: convSession.session_key });

        return {
            text: `${target.menu_item?.name || target.deal?.name} quantity update ho kar ${quantity} ho gayi.\nSubtotal: Rs.${cartTotals.subtotal}`,
            intent,
        };
    }

    // CLEAR_CART
    if (intent === 'CLEAR_CART') {
        await clearCart({ sessionKey: convSession.session_key });
        await updateSessionStage({ sessionKey: convSession.session_key, stage: 'START' });
        clearDraft(convSession.id);
        return {
            text: 'Aap ka cart clear kar diya gaya hai. Naya order shuru karne ke liye menu likhein.',
            intent,
            stage: 'START',
        };
    }

    // HUMAN_HANDOFF (Support / Human assistance request)
    if (intent === 'HUMAN_HANDOFF') {
        const phoneText = formatRestaurantPhone(restaurant);
        const contactInfo = phoneText ? `\n\n${phoneText}` : '\n\nAap apna sawal ya paighaam yahan type kar saktay hain, hamari team jald rabta karegi.';

        // Mute chat for human handover & alert the scanned WhatsApp number
        muteChatForHandover({
            chatId,
            sessionKey: convSession.session_key,
            durationMinutes: 120,
            reason: 'Customer requested human support representative',
            customerName: convSession.customer?.name || null,
            customerPhone: verifiedPhone || null,
            sock,
        }).catch((err) => {
            logger.warn({ err: err.message }, '[ORCHESTRATOR] Handover notification error');
        });

        return {
            text: `Aap ko hamari support team se connect kiya ja raha hai.${contactInfo}`,
            intent: 'HUMAN_HANDOFF',
            stage: convSession.stage,
        };
    }

    // DELETE_MY_DATA (Customer privacy & self-data wipe)
    if (intent === 'DELETE_MY_DATA') {
        const phoneToClean = verifiedPhone || (chatId ? chatId.split('@')[0] : null);
        clearDraft(convSession.id);

        try {
            if (phoneToClean) {
                await deleteCustomerByPhone({
                    restaurantId,
                    phone: phoneToClean,
                    deleteOrders: false,
                });
            } else {
                await clearCart({ sessionKey: convSession.session_key });
            }
        } catch (err) {
            logger.error({ err, chatId }, '[ORCHESTRATOR] Error deleting customer data');
        }

        return {
            text: 
`🗑️ *Data Deleted Successfully*

Aapka tamam personal data (naam, phone number, saved cart aur chat session) hamaray system se mukammal tor par delete kar diya gaya hai.

Hamare bot mein aapka koi personal data baqi nahi bacha. Agar aap dobara order karna chahein toh kisi bhi waqt *Hi* ya *Menu* likh kar shuru kar saktay hain.`,
            intent: 'DELETE_MY_DATA',
            stage: 'START',
        };
    }

    // CHECKOUT
    if (intent === 'CHECKOUT') {
        const cart = await getActiveCart({ sessionKey: convSession.session_key });
        if (!cart || !cart.items || cart.items.length === 0) {
            return {
                text: 'Aap ka cart abhi khali hai. Pehle menu se items add karein!',
                intent,
            };
        }

        await updateSessionStage({ sessionKey: convSession.session_key, stage: 'WAITING_NAME' });

        return {
            text: 'Order complete karne ke liye apna Naam (Full Name) likhein please:',
            intent,
            stage: 'WAITING_NAME',
        };
    }

    // PROVIDE_NAME (Stage: WAITING_NAME)
    if (intent === 'PROVIDE_NAME' && convSession.stage === 'WAITING_NAME') {
        const name = entities.customerName?.trim();
        draft.customerName = name;
        await updateSessionStage({ sessionKey: convSession.session_key, stage: 'WAITING_CONTACT' });

        return {
            text: 
`Shukriya ${name}!

Ab apna contact number provide karein.
Aap same number bhi reply kar sakte hain agar yehi WhatsApp number contact ke liye use karna hai.`,
            intent,
            stage: 'WAITING_CONTACT',
        };
    }

    // USE_SAME_WHATSAPP_NUMBER or PROVIDE_PHONE (Stage: WAITING_CONTACT)
    if (convSession.stage === 'WAITING_CONTACT') {
        if (intent === 'USE_SAME_WHATSAPP_NUMBER') {
            if (!phoneVerified || !verifiedPhone) {
                return {
                    text: 'Aap ka WhatsApp number verified detect nahi ho saka. Barah-e-karam apna phone number manually type karein (e.g. 03001234567):',
                    intent,
                    stage: 'WAITING_CONTACT',
                };
            }

            draft.phone = verifiedPhone;
            draft.contactNumberMode = 'same_whatsapp';
        } else if (intent === 'PROVIDE_PHONE' || entities.phone) {
            const raw = entities.phone || text;
            const clean = normalizePhone(raw);
            if (!clean) {
                return {
                    text: 'Invalid phone number. Barah-e-karam durust Pakistani mobile number likhein (e.g. 03001234567):',
                    intent,
                    stage: 'WAITING_CONTACT',
                };
            }
            draft.phone = clean;
            draft.contactNumberMode = 'provided';
        } else {
            return {
                text: 'Barah-e-karam apna contact phone number likhein (e.g. 03001234567) ya same number reply karein:',
                intent,
                stage: 'WAITING_CONTACT',
            };
        }

        await updateSessionStage({ sessionKey: convSession.session_key, stage: 'WAITING_LOCATION' });

        return {
            text: 
`Contact number confirm: ${draft.phone}.

Ab apni delivery location ya address share karein:
Aap WhatsApp location pin bhej sakte hain, Google Maps link bhej sakte hain ya apna area/address type kar sakte hain (e.g. Ghauri Town ya Gulberg 3).`,
            intent,
            stage: 'WAITING_LOCATION',
        };
    }

    // Handling queries and navigation during WAITING_LOCATION stage
    if (convSession.stage === 'WAITING_LOCATION') {
        if (intent === 'DELIVERY_AREAS_QUERY') {
            const areasRes = await resolveBusinessAnswer({
                restaurantId,
                query: 'delivery areas',
                intent: 'DELIVERY_AREAS_QUERY',
                context: { stage: convSession.stage, sessionKey: convSession.session_key },
            });

            let deliveryMsg = areasRes?.text || 'Filhal delivery coverage areas configure nahi hain. Barah-e-karam restaurant team se rabta karein.';
            deliveryMsg += `\n\nAb apni delivery location ya address share karein taakay order process complete ho sakay:`;

            return {
                text: deliveryMsg,
                intent: 'DELIVERY_AREAS_QUERY',
                stage: 'WAITING_LOCATION',
            };
        }

        if (intent === 'CANCEL' || intent === 'DECLINE_ORDER') {
            await updateSessionStage({ sessionKey: convSession.session_key, stage: 'START' });
            return {
                text: 'Checkout process cancel kar diya gaya hai. Jab bhi dobara order karna ho, "Menu" ya item name likhein.',
                intent: 'CANCEL',
                stage: 'START',
            };
        }

        if (intent === 'HELP') {
            return {
                text: 'Order complete karne ke liye apni delivery location ya address share karein (e.g. Ghauri Town ya WhatsApp location pin).\n\nCoverage areas janne ke liye "delivery locations" likhein, ya cancel karne ke liye "cancel" likhein.',
                intent: 'HELP',
                stage: 'WAITING_LOCATION',
            };
        }
    }

    // PROVIDE_LOCATION (Global or Stage: WAITING_LOCATION)
    if (intent === 'PROVIDE_LOCATION' || (location && convSession.stage !== 'WAITING_PAYMENT' && convSession.stage !== 'WAITING_ORDER_CONFIRMATION')) {
        const cartTotals = await calculateCartTotals({ sessionKey: convSession.session_key });
        const subtotal = cartTotals.subtotal || 0;
        const hasCartItems = cartTotals.items && cartTotals.items.length > 0;

        let checkParams = { restaurantId, subtotal };

        if (location) {
            checkParams.latitude = location.latitude;
            checkParams.longitude = location.longitude;
            const locText = [location.name, location.address].filter(Boolean).join(', ');
            if (locText) {
                checkParams.areaName = locText;
            }
        } else {
            const mapsUrl = extractGoogleMapsUrl(cleanText);
            if (mapsUrl) {
                checkParams.areaName = mapsUrl;
            } else {
                checkParams.areaName = cleanText.trim();
            }
        }

        const delResult = await checkDeliveryAvailability(checkParams);

        // Location out of coverage range or unapproved
        if (!delResult.available) {
            const outOfDeliveryMsg = delResult.message || await getOutOfDeliveryMessage(restId);
            return {
                text: outOfDeliveryMsg,
                intent: 'PROVIDE_LOCATION',
                stage: hasCartItems ? 'WAITING_LOCATION' : convSession.stage,
            };
        }

        // Auto-select Delivery Address from shared location pin or detected details
        const finalAddress = delResult.deliveryAddress || delResult.formattedAddress ||
            (location ? ([location.name, location.address].filter(Boolean).join(', ') || `${delResult.area.name} (Location Pin: ${location.mapUrl})`) : (delResult.area.name || cleanText.trim()));

        draft.delivery = {
            areaId: delResult.area.id,
            areaName: delResult.area.name,
            address: finalAddress,
            fee: delResult.area.deliveryFee,
            latitude: checkParams.latitude,
            longitude: checkParams.longitude,
            googleMapsUrl: location ? location.mapUrl : (delResult.googleMapsUrl || null),
        };

        const feeVal = Number(delResult.deliveryFee ?? delResult.area?.deliveryFee ?? 0);
        const feeDisplay = feeVal === 0 ? 'FREE' : `Rs.${feeVal}`;

        // Case 1: Customer has items in cart -> proceed to checkout / payment
        if (hasCartItems) {
            // Check minimum order requirement
            if (delResult.minMet === false) {
                const minReq = delResult.area.minimumOrder;
                const diff = minReq - subtotal;
                return {
                    text: 
`Minimum order requirement poori nahi hui.

Minimum order: Rs.${minReq}
Current subtotal: Rs.${subtotal}
Required additional amount: Rs.${diff}

Barah-e-karam cart mein mazeed items add karein taakay delivery possible ho sakay.`,
                    intent: 'PROVIDE_LOCATION',
                    stage: 'WAITING_LOCATION',
                };
            }

            await updateSessionStage({ sessionKey: convSession.session_key, stage: 'WAITING_PAYMENT' });

            const codOk = restaurant?.cod_enabled !== false;
            const epOk = restaurant?.easypaisa_enabled === true;

            const distText = delResult.distanceKm != null ? ` - approx. ${delResult.distanceKm} km` : '';
            let payMsg = `Aapki location hamare delivery area mein aati hai (${delResult.area.name}${distText})!\n📍 Delivery Address select ho gaya hai: ${finalAddress}\n🚚 Delivery Fee: ${feeDisplay}.\n\nPayment method select karein:\n`;
            if (codOk) payMsg += `1. COD (Cash on Delivery)\n`;
            if (epOk) {
                payMsg += `2. EasyPaisa\n`;
                if (restaurant?.easypaisa_number) {
                    payMsg += `EasyPaisa Number: ${restaurant.easypaisa_number}\n`;
                }
                if (restaurant?.account_name) {
                    payMsg += `Account Title: ${restaurant.account_name}\n`;
                }
            }
            payMsg += `\nReply with COD ya EasyPaisa.`;

            return { text: payMsg, intent: 'PROVIDE_LOCATION', stage: 'WAITING_PAYMENT' };
        }

        // Case 2: Cart is empty -> confirm area & address, prompt to browse menu/deals
        const distText = delResult.distanceKm != null ? ` - approx. ${delResult.distanceKm} km` : '';
        return {
            text: 
`Aapki location hamare delivery area mein aati hai (${delResult.area.name}${distText})!
📍 Delivery Address select ho gaya hai: ${finalAddress}
🚚 Delivery Fee: ${feeDisplay}

Aap aaj kya order karna chahenge? Hamare paas Mazedar Pizzas, Burgers aur Deals dastiyab hain!
(Menu dekhne ke liye "Menu" ya Deals ke liye "Deals" likhein)`,
            intent: 'PROVIDE_LOCATION',
            stage: convSession.stage,
        };
    }

    // SELECT_PAYMENT (Stage: WAITING_PAYMENT)
    if (convSession.stage === 'WAITING_PAYMENT') {
        let method = null;
        if (intent === 'SELECT_PAYMENT') {
            method = entities.paymentMethod;
        } else if (text.toLowerCase().includes('cod') || text.trim() === '1') {
            method = 'COD';
        } else if (text.toLowerCase().includes('easypaisa') || text.trim() === '2') {
            method = 'EASYPAISA';
        }

        if (!method) {
            return {
                text: 'Barah-e-karam payment method select karein: COD ya EasyPaisa.',
                intent,
                stage: 'WAITING_PAYMENT',
            };
        }

        if (method === 'COD' && restaurant?.cod_enabled === false) {
            return { text: 'Maazrat, COD filhal dastiyab nahi hai. EasyPaisa select karein.', intent };
        }
        if (method === 'EASYPAISA' && restaurant?.easypaisa_enabled !== true) {
            return { text: 'Maazrat, EasyPaisa filhal dastiyab nahi hai. COD select karein.', intent };
        }

        draft.paymentMethod = method;
        await updateSessionStage({ sessionKey: convSession.session_key, stage: 'WAITING_ORDER_CONFIRMATION' });

        // Calculate final order pricing
        const cartTotals = await calculateCartTotals({
            sessionKey: convSession.session_key,
            deliveryAreaId: draft.delivery?.areaId,
            deliveryAreaName: draft.delivery?.areaName,
        });

        let summaryMsg = `Order Summary\n\nItems:\n`;
        cartTotals.items.forEach(it => {
            const varStr = it.variantName ? ` (${it.variantName})` : '';
            if (it.hasDiscount) {
                summaryMsg += `${it.quantity}x ${it.name}${varStr}: ~Rs.${it.originalLineTotal}~ Rs.${it.lineTotal} (${it.discountLabel || (it.discountPercent + '% OFF')})\n`;
            } else {
                summaryMsg += `${it.quantity}x ${it.name}${varStr}: Rs.${it.lineTotal || it.totalPrice}\n`;
            }
        });
        cartTotals.deals.forEach(d => {
            summaryMsg += `${d.quantity}x ${d.name}: Rs.${d.lineTotal || d.totalPrice}\n`;
        });
        summaryMsg += `\nSubtotal: Rs.${cartTotals.subtotal}\n`;
        const discountAmt = Number(cartTotals.discountTotal ?? cartTotals.discount ?? 0);
        if (discountAmt > 0) {
            summaryMsg += `Discount: -Rs.${discountAmt}\n`;
        }
        summaryMsg += `Delivery Fee: Rs.${cartTotals.deliveryFee}\n`;
        summaryMsg += `Final Total: Rs.${cartTotals.total}\n\n`;

        summaryMsg += `Customer Details:\n`;
        summaryMsg += `Naam: ${draft.customerName || 'Customer'}\n`;
        summaryMsg += `Contact: ${draft.phone}\n`;
        summaryMsg += `Delivery Area: ${draft.delivery?.areaName}\n`;
        summaryMsg += `Payment Method: ${draft.paymentMethod}\n`;
        if (draft.paymentMethod === 'EASYPAISA') {
            if (restaurant?.easypaisa_number) {
                summaryMsg += `EasyPaisa Number: ${restaurant.easypaisa_number}\n`;
            }
            if (restaurant?.account_name) {
                summaryMsg += `Account Title: ${restaurant.account_name}\n`;
            }
        }
        summaryMsg += `\n`;

        summaryMsg += `Kya aap order confirm karna chahte hain?\nReply karein: Yes ya No`;

        return { text: summaryMsg, intent, stage: 'WAITING_ORDER_CONFIRMATION' };
    }

    // CONFIRM_ORDER / DECLINE_ORDER (Stage: WAITING_ORDER_CONFIRMATION)
    if (convSession.stage === 'WAITING_ORDER_CONFIRMATION') {
        if (intent === 'DECLINE_ORDER') {
            await updateSessionStage({ sessionKey: convSession.session_key, stage: 'START' });
            clearDraft(convSession.id);
            return {
                text: 'Order cancel kar diya gaya. Aap jab chahein naya order shuru kar sakte hain!',
                intent,
                stage: 'START',
            };
        }

        if (intent === 'CONFIRM_ORDER') {
            // EXPLICIT CONFIRMATION GATE: Place Order via orderService
            try {
                const orderResult = await createOrder({
                    restaurantId,
                    sessionKey: convSession.session_key,
                    customerName: draft.customerName || 'Customer',
                    phone: draft.phone,
                    contactNumberMode: draft.contactNumberMode || 'provided',
                    delivery: draft.delivery,
                    paymentMethod: draft.paymentMethod || 'COD',
                    idempotencyKey: messageId,
                    sock,
                });

                const ord = orderResult.order;
                const ordNumber = ord.order_number || ord.orderNumber;
                const ordTotal = ord.pricing?.total != null
                    ? Number(ord.pricing.total)
                    : (ord.final_total != null ? Number(ord.final_total) : Number(ord.total || 0));
                const ordDiscount = Number(ord.pricing?.discountTotal ?? ord.discount_total ?? 0);
                const discountText = ordDiscount > 0 ? `\nDiscount Applied: -Rs.${ordDiscount.toFixed(2)}` : '';
                clearDraft(convSession.id);

                return {
                    text: 
`Order Confirmed

Order #${ordNumber}${discountText}
Total: Rs.${ordTotal.toFixed(2)}
Status: Confirmed

Thank you for choosing ${restName}!
Aap kisi bhi waqt 'order status' likh kar apna status check kar sakte hain.`,
                    intent,
                    stage: 'ORDER_CONFIRMED',
                };
            } catch (err) {
                logger.error({ err: err.message }, '[ORCHESTRATOR] Order creation error');
                return {
                    text: `Order create karte waqt masla pesh aaya: ${err.message}. Barah-e-karam dobara koshish karein.`,
                    intent,
                };
            }
        }
    }

    // ORDER_STATUS_QUERY
    if (intent === 'ORDER_STATUS_QUERY') {
        const orderNum = entities.orderNumber;
        if (orderNum) {
            const order = await getOrderByNumber({ restaurantId, orderNumber: orderNum });
            if (!order) {
                return { text: `Order #${orderNum} nahi mila. Barah-e-karam order number check karein.`, intent };
            }
            const ordNum = order.orderNumber || order.order_number;
            const ordStatus = order.orderStatus || order.status || order.order_status || 'CONFIRMED';
            const ordTotal = order.pricing?.total != null ? Number(order.pricing.total) : (order.final_total != null ? Number(order.final_total) : 0);
            const ordArea = order.delivery?.areaName || order.delivery_area_name || order.delivery?.address || order.delivery_address || 'Standard';
            const payMethod = order.payment?.method || order.payment_method || 'COD';
            const payStatus = order.payment?.status || order.payment_status || 'PENDING';

            return {
                text: 
`Order #${ordNum} Status

Status: ${ordStatus}
Total: Rs.${ordTotal.toFixed(2)}
Area: ${ordArea}
Payment: ${payMethod} (${payStatus})`,
                intent,
            };
        } else {
            return {
                text: 'Apne order ka status janne ke liye order number likhein (e.g. status CC-000123).',
                intent,
            };
        }
    }

    // REQUEST_ORDER_CANCELLATION
    if (intent === 'REQUEST_ORDER_CANCELLATION') {
        const orderNum = entities.orderNumber;
        if (!orderNum) {
            return {
                text: 'Barah-e-karam order number mention karein jo aap cancel karna chahte hain (e.g. cancel CC-000123).',
                intent,
            };
        }

        try {
            const cancelReq = await requestOrderCancellation({
                restaurantId,
                orderNumber: orderNum,
                sessionKey: convSession.session_key,
            });

            return {
                text: `Kya aap waqai order #${cancelReq.orderNumber} cancel karna chahte hain?\n\nReply karein: Yes ya No`,
                intent,
                stage: 'WAITING_CANCEL_CONFIRMATION',
            };
        } catch (err) {
            return {
                text: `Cancellation request fail: ${err.message}`,
                intent,
            };
        }
    }

    // CONFIRM_CANCELLATION / DECLINE_CANCELLATION (Stage: WAITING_CANCEL_CONFIRMATION)
    if (convSession.stage === 'WAITING_CANCEL_CONFIRMATION') {
        const prisma = getDbClient();
        let targetOrderNumber = null;

        if (convSession.pending_cancel_order_id && prisma) {
            const ord = await prisma.order.findUnique({
                where: { id: convSession.pending_cancel_order_id },
                select: { order_number: true },
            });
            targetOrderNumber = ord?.order_number;
        }

        if (!targetOrderNumber) {
            await updateSessionStage({ sessionKey: convSession.session_key, stage: 'START' });
            return { text: 'Koi pending cancellation request nahi mili.', intent };
        }

        if (intent === 'CONFIRM_CANCELLATION') {
            const cancelResult = await confirmOrderCancellation({
                restaurantId,
                orderNumber: targetOrderNumber,
                sessionKey: convSession.session_key,
                confirmed: true,
            });

            return {
                text: `Order #${cancelResult.orderNumber} cancel kar diya gaya hai.`,
                intent,
                stage: 'CANCELLED',
            };
        } else {
            await confirmOrderCancellation({
                restaurantId,
                orderNumber: targetOrderNumber,
                sessionKey: convSession.session_key,
                confirmed: false,
            });

            return {
                text: `Order #${targetOrderNumber} active rakha gaya hai (cancellation abort).`,
                intent,
                stage: 'START',
            };
        }
    }

    // HELP
    if (intent === 'HELP') {
        return {
            text: 
`${restName} WhatsApp Bot Commands

menu: Khana aur categories check karein
deals: Special discount packages dekhein
cart: Apna shopping cart dekhein
clear cart: Cart khali karein
checkout: Order complete karein
status CC-000123: Order track karein
cancel CC-000123: Order cancel karein
Direct order: likhein 2 zinger ya 1 pizza`,
            intent,
        };
    }

    // HUMAN_HANDOFF
    if (intent === 'HUMAN_HANDOFF') {
        // Mute chat for human handover & alert the scanned WhatsApp number
        muteChatForHandover({
            chatId,
            sessionKey: convSession.session_key,
            durationMinutes: 120,
            reason: 'Customer requested human support representative',
            customerName: convSession.customer?.name || null,
            customerPhone: verifiedPhone || null,
            sock,
        }).catch((err) => {
            logger.warn({ err: err.message }, '[ORCHESTRATOR] Handover notification error');
        });

        return {
            text: 'Main aapki request restaurant team ko forward karne ke liye ready hoon. Team representative aapse jald rabta karega.',
            intent,
        };
    }

    // ── 5. Centralized Priority: Settings First Resolution ─────────────────
    // If the customer asks directly for Settings info (Timings, Payment, Address, Phone):
    if (isTimingQuery(cleanText) || isPaymentQuery(cleanText) || isAddressQuery(cleanText) || isPhoneQuery(cleanText) || intent === 'PAYMENT_METHODS_QUERY') {
        const directSettingsResolution = await resolveBusinessAnswer({
            restaurantId,
            query: cleanText,
            intent,
            context: {
                stage: convSession.stage,
                sessionKey: convSession.session_key,
                chatId,
                entities,
                restaurant,
                draft,
            },
        });

        if (directSettingsResolution && directSettingsResolution.source === 'SETTINGS') {
            return {
                text: directSettingsResolution.text,
                intent: directSettingsResolution.type,
                stage: convSession.stage,
            };
        }
    }

    // ── 6. Dynamic Entity Resolution Architecture ─────────────────────────
    // Resolution Hierarchy (Live DB / Services driven):
    //   1. Active Category (by index if browsing, or by name/slug/singular)
    //   2. Active Menu Item or Active Deal
    //   3. Centralized Knowledge Resolver (Delivery Areas DB, Deals DB, FAQ, Safe Fallback)

    const { quantity: parsedQty, query: extractedQuery } = extractQuantityAndQuery(cleanText);
    const resolvedQty = entities?.quantity || parsedQty || 1;
    const candidateQuery = entities?.itemQuery || extractedQuery || entities?.categoryName || cleanText;

    // 1. Check Active Category
    let category = null;
    const isPureNum = /^\d+$/.test(candidateQuery.trim());
    const cleanedCatQ = candidateQuery.trim().toLowerCase()
        .replace(/\b(?:me|mai|mei|mein|men|ka|ke|ki|dikhao|bhejo|options|list|items?|kya|kia|kay|kon|konse|konsa|sa|se|hain|hen|ha|hai|hy|dekhna|dein|btao|batao|chahiye|menu|flavor|flavors|flavour|flavours|available)\b/gi, '')
        .replace(/[^\w\s]/g, '')
        .trim();

    if (cleanedCatQ === 'pizza' || cleanedCatQ === 'pizzas') {
        const allCats = await getActiveCategories(restaurantId).catch(() => []);
        const classicCat = allCats.find(c => /classic\s*pi[z]+as?/i.test(c.name));
        const premiumCat = allCats.find(c => /premium\s*pi[z]+as?/i.test(c.name));
        const [fullClassic, fullPremium] = await Promise.all([
            classicCat ? getCategoryWithItems(classicCat.id, restaurantId) : null,
            premiumCat ? getCategoryWithItems(premiumCat.id, restaurantId) : null,
        ]);

        if (fullClassic || fullPremium) {
            await updateSessionStage({ sessionKey: convSession.session_key, stage: 'BROWSING_MENU' });
            const globalDiscount = await getGlobalDiscountSettings(restaurantId);
            const cache = await getCatalogCache();
            const parts = [];
            if (fullClassic) parts.push(formatCategoryResponse(fullClassic, globalDiscount, cache));
            if (fullPremium) parts.push(formatCategoryResponse(fullPremium, globalDiscount, cache));

            return {
                text: `${parts.join('\n\n')}\n\n_Sizes: Small (Rs. 599/699), Medium (Rs. 1199/1399), Large (Rs. 1599/1799), Party Size (Rs. 2499/2799)_\nOrder karne ke liye kisi bhi pizza ka naam aur size bata dein (jaise *Chicken Tikka Medium* ya *Chicken Extreme Large*)!`,
                imageUrl: (fullPremium?.image_url || fullClassic?.image_url || 'assets/menu/cravey_crust_main_menu.png'),
                intent: 'SHOW_CATEGORY',
                stage: 'BROWSING_MENU',
            };
        }
    }

    if (isPureNum) {
        if (convSession.stage === 'BROWSING_MENU' || entities?.categoryIndex) {
            category = await getCategoryWithItems(parseInt(candidateQuery, 10), restaurantId);
        }
    } else {
        category = await getCategoryWithItems(candidateQuery, restaurantId);
    }

    if (category) {
        await updateSessionStage({ sessionKey: convSession.session_key, stage: 'BROWSING_MENU' });
        const globalDiscount = await getGlobalDiscountSettings(restaurantId);
        return {
            text: formatCategoryResponse(category, globalDiscount),
            imageUrl: category.image_url || 'assets/menu/cravey_crust_main_menu.png',
            intent: 'SHOW_CATEGORY',
            stage: 'BROWSING_MENU',
        };
    }

    // 2. Check Active Menu Item or Active Deal
    const resolvedEntity = await resolveMenuItemOrDeal(candidateQuery, restaurantId);
    if (resolvedEntity && (resolvedEntity.status === 'EXACT_MATCH' || resolvedEntity.status === 'PARTIAL_MATCH' || resolvedEntity.status === 'AMBIGUOUS')) {
        const itemResult = await handleResolvedItemOrDeal({
            resolved: resolvedEntity,
            quantity: resolvedQty,
            convSession,
            restaurantId,
            draft,
        });
        if (itemResult) return itemResult;
    }

    // 3. Centralized Knowledge Resolution (Structured DB -> FAQ -> Fallback)
    const businessResolution = await resolveBusinessAnswer({
        restaurantId,
        query: cleanText,
        intent,
        context: {
            stage: convSession.stage,
            sessionKey: convSession.session_key,
            chatId,
            entities,
            restaurant,
            draft,
        },
    });

    if (businessResolution) {
        if (businessResolution.source === 'SETTINGS') {
            return {
                text: businessResolution.text,
                intent: businessResolution.type,
                stage: convSession.stage,
            };
        }
        if (businessResolution.source === 'DELIVERY' || businessResolution.source === 'DEALS' || businessResolution.source === 'MENU') {
            return {
                text: businessResolution.text,
                intent: businessResolution.type,
                stage: convSession.stage,
            };
        }
        if (businessResolution.source === 'FAQ') {
            return {
                text: businessResolution.text,
                intent: 'FAQ_QUERY',
                stage: convSession.stage,
            };
        }
    }

    // If intent was explicitly FAQ_QUERY (e.g. asked with ? or 'kya') but no FAQ matched:
    if (intent === 'FAQ_QUERY') {
        return {
            text: 
`Sorry, mere paas is sawal ka confirmed answer available nahi hai.

Aap restaurant team se contact kar sakte hain.`,
            intent: 'FAQ_QUERY',
        };
    }

    // 4. Clean UNKNOWN Fallback (ONE response only, no option spam)
    return {
        text: 
`Sorry, mujhe ye request samajh nahi aayi.

Aap ye options use kar sakte hain:
Menu
Deals
Cart
Order Status
Help`,
        intent: 'UNKNOWN',
    };
}
