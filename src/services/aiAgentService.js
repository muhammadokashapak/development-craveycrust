/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║   AI Agent Service — src/services/aiAgentService.js          ║
 * ║   Standalone WhatsApp AI Agent (100% n8n-Free)               ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Architecture:
 *   bot.js → aiAgentService.processMessage()
 *             ├─ Deterministic fast routing (intentParser.js) — 0 Tokens
 *             ├─ Standalone AI Agent (Gemini/DeepSeek/OpenAI) + 18 Local Tools
 *             ├─ Exact Token Usage Tracking (logger.js)
 *             └─ Post-Verification & Output Sanitization
 *
 * NEVER throws — always returns a safe string reply.
 */

import { buildSystemPrompt } from '../config/systemPrompt.js';
import { routeLLM } from './llmRouter.js';
import { getCatalogCache, getSyncEpoch } from './catalogCacheService.js';
import { env } from '../config/env.js';
import { logZeroTokenReply, logAiTokenReply } from '../utils/logger.js';
import { checkFastRoute, extractCustomerDetails, cleanExtractedAddress, setLastDiscussedItem, getLastDiscussedItem, clearLastDiscussedItem, clearLastDiscussedDeal } from './intentParser.js';
import { cleanWhatsAppPhone } from '../../utils/senderIdentity.js';
import { extractLocationFromText } from '../../utils/location.js';
import { getSessionHistory, appendSessionHistory, getSessionOrderDetails, updateSessionOrderDetails } from './sessionService.js';
import { updateCustomerNameForChat } from './chatService.js';

// ─── Local Direct Service Imports (No HTTP round-trips) ───────────────────
import { getDefaultRestaurantId } from './restaurantService.js';
import { searchKnowledge } from './knowledgeService.js';
import { getActiveCategories, resolveMenuItemOrDeal, getActiveDeals } from './menuService.js';
import { checkDeliveryAvailability } from './deliveryService.js';
import { getActiveCart, addToCart, updateCartItem, removeCartItem, clearCart as clearCartService, matchVariant, calculateCartTotals } from './cartService.js';
import { calculatePricing } from './pricingService.js';
import { calculateDiscount, getGlobalDiscountSettings } from './discountService.js';
import { muteChatForHandover, isChatMuted } from './handoverService.js';
import { getDbClient } from '../db/client.js';
import { isPizzaDeal, getDealPizzaInfo, extractFlavoursFromText, formatFlavourNotes, setPendingDealFlavour, clearPendingDealFlavour } from './dealFlavourService.js';

// ─── Detect Confirm Intent (Hissa 3) ──────────────────────────────────────
/**
 * Detect confirmation intent: 1 to 8 words, no digits, no negation, contains confirmation words.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function detectConfirmIntent(text) {
    if (!text || typeof text !== 'string') return false;
    const t = text.trim().toLowerCase();
    const words = t.split(/\s+/).filter(Boolean);
    if (words.length < 1 || words.length > 8) return false;

    // Check: koi number na ho
    if (/\d/.test(t)) return false;

    // Check: negation na ho (nahi, no, cancel, mat)
    const NEGATIONS = /\b(nahi|nahin|na|no|mat|cancel|rok|ruko|galat|wrong|hatao|nhi)\b/i;
    if (NEGATIONS.test(t)) return false;

    // Check: confirmation words (including common misspellings like 'comfirm', 'konfirm')
    const CONFIRM = /\b(co?n?f[iy]?r[mn]+|comfirm|konfirm|haan|han|ji|jee|yes|ok|okay|theek|bilkul|done|zaroor|zarur|kardo|kar do|bhej do|book kar do|book kr do|order kar do|order kr do|order kardo|order kr du|kr du|kar du|krdo)\b/i;
    return CONFIRM.test(t);
}


// ─── 18 Direct Local Tools Schema (Prompt Context) ─────────────────────────
const TOOLS_SCHEMA = `
AVAILABLE LOCAL TOOLS (Execute any needed action by responding ONLY with JSON {"tool": "<tool_name>", "args": {<args>}}):

1. get_store_info() — Restaurant timings, outlet address, phone, min order.
2. search_faqs(query: string) — FAQ database search.
3. search_menu_item(query: string) — Search product/deal name, IDs, variants and prices.
4. get_menu_categories() — Active categories list.
5. get_current_deals() — Active deals with IDs and prices.
6. check_delivery_availability(address?: string, areaName?: string, latitude?: number, longitude?: number) — Delivery coverage & fee check.
7. get_order_status(orderNumber: string) — Track order status for CC-XXXXXX.
8. get_cart() — View current session cart items.
9. add_to_cart(itemName?: string, menuItemId?: string, variantId?: string, size?: string, variantName?: string, dealId?: string, quantity?: number, notes?: string, allDeals?: boolean) — Add item or deal to cart. For pizzas/items with sizes, specify size or variantId (e.g. size: "Medium" or "Party Size" or "Large" or "Small"). (Use allDeals: true or itemName: 'all deals' if customer wants all active deals).
10. update_cart_item(cartItemId: string, quantity: number, notes?: string) — Update quantity or notes.
11. remove_cart_item(cartItemId: string) — Remove item from cart.
12. clear_cart() — Clear all items from cart.
13. calculate_cart_totals() — Calculate subtotal, delivery fee, and grand total bill.
14. create_confirmed_order(customerName: string, deliveryAddress: string, phone: string, paymentMethod: string, notes?: string) — Book final order.
15. request_order_cancellation(orderNumber?: string) — Check cancellation for order (Returns Store Admin contact to process cancellation).
16. confirm_order_cancellation(orderNumber?: string) — Returns Store Admin contact to process cancellation (Direct bot cancellation disabled).
17. send_alternate_confirmation(phone: string) — Send notification to alternate phone.
18. request_human_handover(reason?: string) — Mute bot for 120 minutes and notify manager.
19. update_order_details(orderNumber?: string, customerName?: string, deliveryAddress?: string, phone?: string, paymentMethod?: string) — Update details (customer name, delivery address, phone, payment method) for an active placed order (PENDING/CONFIRMED/PREPARING).

TOOL CALL FORMAT:
{"tool": "tool_name", "args": {"param": "value"}}

If no tool is needed, respond directly with customer reply text in Roman Urdu.
`;

async function getOrderLookupOrConditions(prisma, { sessionKey, chatId, whatsappPhone }) {
    const orConditions = [];
    const phoneVariants = new Set();
    const cleanPhone = (whatsappPhone || '').replace(/\D/g, '');
    if (cleanPhone) {
        phoneVariants.add(cleanPhone);
        let b10 = null;
        if (cleanPhone.length === 11 && cleanPhone.startsWith('0')) b10 = cleanPhone.slice(1);
        else if (cleanPhone.length === 12 && cleanPhone.startsWith('92')) b10 = cleanPhone.slice(2);
        else if (cleanPhone.length === 10 && cleanPhone.startsWith('3')) b10 = cleanPhone;
        if (b10) {
            phoneVariants.add(b10);
            phoneVariants.add('0' + b10);
            phoneVariants.add('92' + b10);
            phoneVariants.add('+92' + b10);
        }
    }

    let dbSession = null;
    if (sessionKey || chatId) {
        dbSession = await prisma.conversationSession.findFirst({
            where: {
                OR: [
                    ...(sessionKey ? [{ session_key: sessionKey }, { id: sessionKey }, { chat_id: sessionKey }] : []),
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
            const vClean = dbSession.verified_phone.replace(/\D/g, '');
            if (vClean) {
                phoneVariants.add(vClean);
                let vb10 = null;
                if (vClean.length === 11 && vClean.startsWith('0')) vb10 = vClean.slice(1);
                else if (vClean.length === 12 && vClean.startsWith('92')) vb10 = vClean.slice(2);
                else if (vClean.length === 10 && vClean.startsWith('3')) vb10 = vClean;
                if (vb10) {
                    phoneVariants.add(vb10);
                    phoneVariants.add('0' + vb10);
                    phoneVariants.add('92' + vb10);
                    phoneVariants.add('+92' + vb10);
                }
            }
        }
    }

    if (sessionKey) {
        orConditions.push({ source_session_id: sessionKey });
        orConditions.push({ source_chat_id: sessionKey });
    }
    if (chatId && chatId !== sessionKey) {
        orConditions.push({ source_chat_id: chatId });
    }

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

// ─── Tool Executor (Direct Local Services) ─────────────────────────────────
async function executeTool(toolName, args, context) {
    const { sessionKey, chatId, whatsappPhone, restId, sock, locationData } = context;

    try {
        switch (toolName) {
            // 1. get_store_info
            case 'get_store_info': {
                const prisma = getDbClient();
                if (!prisma) return { error: 'Database unavailable' };
                const r = await prisma.restaurant.findFirst({ where: { id: restId } });
                if (!r) return { error: 'Restaurant info not found' };
                return {
                    name: r.name,
                    address: r.address,
                    phone: r.phone,
                    openingTime: r.opening_time,
                    closingTime: r.closing_time,
                    minOrder: Number(r.min_order || 300),
                    defaultDeliveryFee: Number(r.default_delivery_fee || 60),
                    cod: r.cod_enabled,
                    easypaisa: r.easypaisa_enabled ? r.easypaisa_number : null,
                };
            }

            // 2. search_faqs
            case 'search_faqs': {
                const result = await searchKnowledge({ restaurantId: restId, query: args.query || '', limit: 3 });
                return result.data?.results || [];
            }

            // 3. search_menu_item
            case 'search_menu_item': {
                const result = await resolveMenuItemOrDeal(args.query || '', restId);
                if (result.status === 'EXACT_MATCH' && result.type === 'ITEM' && result.item) {
                    setLastDiscussedItem(sessionKey, result.item, result.matchedVariant);
                }
                return result;
            }

            // 4. get_menu_categories
            case 'get_menu_categories': {
                const cats = await getActiveCategories(restId);
                return cats;
            }

            // 5. get_current_deals
            case 'get_current_deals': {
                const deals = await getActiveDeals(restId);
                return deals.map(d => ({
                    id: d.id,
                    name: d.name,
                    price: Number(d.deal_price),
                    items: (d.deal_items || []).map(di => ({
                        item: di.menu_item?.name,
                        variant: di.menu_variant?.name,
                    })),
                }));
            }

            // 6. check_delivery_availability
            case 'check_delivery_availability': {
                const result = await checkDeliveryAvailability({
                    restaurantId: restId,
                    address: args.address || locationData?.address,
                    areaName: args.areaName,
                    latitude: args.latitude ?? locationData?.latitude,
                    longitude: args.longitude ?? locationData?.longitude,
                });
                return result;
            }

            // 7. get_order_status
            case 'get_order_status': {
                const prisma = getDbClient();
                if (!prisma) return { error: 'Database unavailable' };
                const orderNum = (args.orderNumber || '').toUpperCase().trim();
                const order = await prisma.order.findFirst({
                    where: { restaurant_id: restId, order_number: orderNum },
                    select: {
                        id: true,
                        order_number: true,
                        order_status: true,
                        total: true,
                        created_at: true,
                        delivery_address: true,
                    },
                });
                if (!order) return { error: 'ORDER_NOT_FOUND', orderNumber: orderNum, message: `Order #${orderNum} nahi mila.` };
                return { ...order, total: Number(order.total) };
            }

            // 8. get_cart
            case 'get_cart': {
                const cart = await getActiveCart({ sessionKey, restaurantId: restId, chatId });
                if (!cart || !cart.items || cart.items.length === 0) {
                    return { cartId: null, items: [], itemCount: 0, total: 0, subtotal: 0, discountTotal: 0, message: 'Cart is empty' };
                }
                const totals = await calculateCartTotals({ sessionKey, restaurantId: restId, chatId }).catch(() => null);
                if (totals && totals.items) {
                    return {
                        cartId: cart.id,
                        items: totals.items.map(it => ({
                            id: it.itemId,
                            name: it.name,
                            variant: it.variantName,
                            quantity: it.quantity,
                            originalUnitPrice: it.originalUnitPrice,
                            unitPrice: it.unitPrice,
                            hasDiscount: it.hasDiscount,
                            discountLabel: it.discountLabel,
                            lineTotal: it.lineTotal,
                        })),
                        deals: (totals.deals || []).map(d => ({
                            id: d.dealId,
                            name: d.name,
                            quantity: d.quantity,
                            unitPrice: d.unitPrice,
                            lineTotal: d.lineTotal,
                        })),
                        subtotal: totals.subtotal,
                        discountTotal: totals.discountTotal,
                        total: totals.total,
                        itemCount: cart.items.length,
                    };
                }
                const items = cart.items.map(i => {
                    const price = Number(i.deal?.deal_price ?? i.menu_variant?.price ?? i.menu_item?.base_price ?? 0);
                    return {
                        id: i.id,
                        name: i.deal ? i.deal.name : (i.menu_item?.name || 'Item'),
                        variant: i.menu_variant?.name,
                        quantity: i.quantity,
                        unitPrice: price,
                        subtotal: price * i.quantity,
                        notes: i.special_instructions || i.notes || '',
                    };
                });
                const cartTotal = items.reduce((s, it) => s + it.subtotal, 0);
                return { cartId: cart.id, items, itemCount: items.length, total: cartTotal };
            }

            // 9. add_to_cart
            case 'add_to_cart': {
                let menuItemId = args.menuItemId;
                let rawVariant = args.variantId || args.variantName || args.size || args.variant || null;
                let variantId  = args.variantId;
                let dealId     = args.dealId;
                let quantity   = parseInt(args.quantity || 1, 10);
                let notes      = args.notes || undefined;

                // Quantity Auto-Rescue: If quantity is 1 or missing, but user text had explicit quantity (e.g. "5 hot wings", "2 loaded fries", "6 zinger burger")
                if ((!args.quantity || quantity === 1) && text) {
                    const explicitQtyMatch = text.match(/\b(\d+)\s*(?:x\s+)?(?:pcs?|pieces?|portion|orders?|boxes?)?\s*(?:hot\s*wings|wings|fries|loaded\s*fries|pizza|burger|deal|zinger|roll|chicken|piece)/i) ||
                                             text.match(/^(\d+)\s+/);
                    if (explicitQtyMatch) {
                        const parsedQ = parseInt(explicitQtyMatch[1], 10);
                        if (parsedQ > 1 && parsedQ <= 50) {
                            quantity = parsedQ;
                        }
                    }
                }

                // If dealId directly passed without notes, verify if it's a pizza deal requiring flavour
                if (dealId && !notes) {
                    const activeDeals = await getActiveDeals(restId);
                    const foundDeal = activeDeals.find(d => d.id === dealId);
                    if (foundDeal) {
                        const pizzaInfo = getDealPizzaInfo(foundDeal);
                        if (pizzaInfo.isPizzaDeal) {
                            setPendingDealFlavour(sessionKey, {
                                deal: foundDeal,
                                quantity,
                                pizzaInfo,
                            });
                            return {
                                requiresFlavour: true,
                                dealName: foundDeal.name,
                                pizzaCount: pizzaInfo.pizzaCount,
                                sizeName: pizzaInfo.sizeName,
                                availableFlavours: [
                                    "Chicken Tikka",
                                    "Chicken Fajita",
                                    "Chicken Supreme",
                                    "Cheese Lover",
                                    "Chicken Tandori",
                                    "Behari Kebab Pizza",
                                    "Chicken Extreme"
                                ],
                                message: `"${foundDeal.name}" mein ${pizzaInfo.pizzaCount > 1 ? `${pizzaInfo.pizzaCount}x ${pizzaInfo.sizeName} Pizzas` : `1x ${pizzaInfo.sizeName} Pizza`} shamil hai. Pehle customer se unki pasand ka flavour poochein (Available flavours: Chicken Tikka, Chicken Fajita, Chicken Supreme, Cheese Lover, Chicken Tandori, Behari Kebab, Chicken Extreme). Flavour milne ke baad add_to_cart(..., notes: "Flavours: ...") call karein.`
                            };
                        }
                    }
                }

                // Handle bulk / all deals request
                if (args.allDeals || args.dealId === 'all' || /^(all\s*deals?|sari\s*deals?|12\s*deals?|saari\s*deals?)$/i.test(args.itemName || '')) {
                    let allDeals = await getActiveDeals(restId);
                    const cat = (args.category || args.filter || '').toLowerCase();
                    if (cat.includes('pizza') || cat.includes('piza')) {
                        allDeals = allDeals.filter(d => /pizza/i.test(d.name));
                    } else if (cat.includes('burger')) {
                        allDeals = allDeals.filter(d => /burger/i.test(d.name));
                    }

                    const added = [];
                    for (const d of allDeals) {
                        try {
                            await addToCart({
                                sessionKey,
                                restaurantId: restId,
                                chatId,
                                verifiedPhone: whatsappPhone,
                                dealId: d.id,
                                quantity: 1,
                            });
                            added.push({ name: d.name, price: Number(d.deal_price) });
                        } catch (_) {}
                    }
                    try {
                        clearLastDiscussedDeal(sessionKey);
                        clearLastDiscussedItem(sessionKey);
                    } catch (_) {}
                    const subtotal = added.reduce((s, d) => s + d.price, 0);
                    return {
                        success: true,
                        allDealsAdded: true,
                        count: added.length,
                        subtotal,
                        deals: added.map(d => `${d.name} (Rs. ${d.price})`),
                        message: `${added.length} deals cart mein add kar di gayi hain! Subtotal: Rs. ${subtotal}`,
                    };
                }

                // If no menuItemId or dealId, check itemName or fallback to last discussed item in session
                if (!menuItemId && !dealId) {
                    const lastEntry = getLastDiscussedItem(sessionKey);

                    if (!args.itemName && lastEntry) {
                        // Caller passed only a size or nothing, use last discussed item
                        menuItemId = lastEntry.item.id;
                        const matched = matchVariant(lastEntry.item.variants, rawVariant);
                        if (matched) variantId = matched.id;
                    } else if (args.itemName) {
                        const resolved = await resolveMenuItemOrDeal(args.itemName, restId);

                        if (resolved.status === 'SIZE_SPECIFIED') {
                            if (lastEntry) {
                                menuItemId = lastEntry.item.id;
                                const matched = matchVariant(lastEntry.item.variants, resolved.size || rawVariant);
                                if (matched) variantId = matched.id;
                            } else {
                                return { error: 'ITEM_NOT_FOUND', query: args.itemName, message: `Pehle item ka naam batayein ke aap ko kis item ka ${resolved.size} size chahiye.` };
                            }
                        } else if (resolved.status === 'EXACT_MATCH') {
                            if (resolved.type === 'DEAL') {
                                dealId = resolved.deal.id;
                                const pizzaInfo = resolved.pizzaInfo || getDealPizzaInfo(resolved.deal);
                                const dealNotes = notes || resolved.flavourNotes;

                                if (pizzaInfo.isPizzaDeal && !dealNotes) {
                                    setPendingDealFlavour(sessionKey, {
                                        deal: resolved.deal,
                                        quantity,
                                        pizzaInfo,
                                    });
                                    return {
                                        requiresFlavour: true,
                                        dealName: resolved.deal.name,
                                        pizzaCount: pizzaInfo.pizzaCount,
                                        sizeName: pizzaInfo.sizeName,
                                        availableFlavours: [
                                            "Chicken Tikka",
                                            "Chicken Fajita",
                                            "Chicken Supreme",
                                            "Cheese Lover",
                                            "Chicken Tandori",
                                            "Behari Kebab Pizza",
                                            "Chicken Extreme"
                                        ],
                                        message: `"${resolved.deal.name}" mein ${pizzaInfo.pizzaCount > 1 ? `${pizzaInfo.pizzaCount}x ${pizzaInfo.sizeName} Pizzas` : `1x ${pizzaInfo.sizeName} Pizza`} shamil hai. Pehle customer se unki pasand ka flavour poochein (Available flavours: Chicken Tikka, Chicken Fajita, Chicken Supreme, Cheese Lover, Chicken Tandori, Behari Kebab, Chicken Extreme). Flavour milne ke baad add_to_cart(..., notes: "Flavours: ...") call karein.`
                                    };
                                }
                                if (dealNotes && !notes) {
                                    notes = dealNotes;
                                }
                            } else {
                                menuItemId = resolved.item.id;
                                if (resolved.matchedVariant) {
                                    variantId = resolved.matchedVariant.id;
                                } else if (resolved.hasVariants) {
                                    if (resolved.variants?.length === 1) {
                                        variantId = resolved.variants[0].id;
                                    } else {
                                        const matchedVariant = matchVariant(resolved.variants, rawVariant || args.itemName);
                                        if (matchedVariant) {
                                            variantId = matchedVariant.id;
                                        } else {
                                            setLastDiscussedItem(sessionKey, resolved.item);
                                            const globalDiscount = await getGlobalDiscountSettings(restId).catch(() => null);
                                            const variantOptions = resolved.variants.map(v => {
                                                const disc = calculateDiscount(v.price, v.discount_percent ?? resolved.item.discount_percent, v.discount_fixed ?? resolved.item.discount_fixed, globalDiscount);
                                                const pStr = disc.hasDiscount ? `~Rs. ${Number(v.price)}~ Rs. ${disc.discountedPrice} (${disc.label})` : `Rs. ${Number(v.price)}`;
                                                return `${v.name} (${pStr})`;
                                            }).join(', ');
                                            return {
                                                requiresVariant: true,
                                                itemName: resolved.item.name,
                                                variants: resolved.variants.map(v => {
                                                    const disc = calculateDiscount(v.price, v.discount_percent ?? resolved.item.discount_percent, v.discount_fixed ?? resolved.item.discount_fixed, globalDiscount);
                                                    return {
                                                        name: v.name,
                                                        originalPrice: Number(v.price),
                                                        discountedPrice: disc.discountedPrice,
                                                        hasDiscount: disc.hasDiscount,
                                                        discountLabel: disc.label,
                                                        price: disc.discountedPrice,
                                                    };
                                                }),
                                                message: `"${resolved.item.name}" ke mukhtalif sizes mojood hain (${variantOptions}). Pehle customer se poochein ke kaunsa size add karna hai aur size milne ke baad cart mein add karein.`
                                            };
                                        }
                                    }
                                }
                            }
                        } else if (resolved.status === 'AMBIGUOUS') {
                            return { ambiguous: true, candidates: resolved.candidates, message: resolved.message || 'Multiple items found — please specify variant or exact item.' };
                        } else {
                            // Check if itemName is an alias or variant of last discussed item
                            if (lastEntry) {
                                const matched = matchVariant(lastEntry.item.variants, args.itemName || rawVariant);
                                if (matched) {
                                    menuItemId = lastEntry.item.id;
                                    variantId = matched.id;
                                } else {
                                    return { error: 'ITEM_NOT_FOUND', query: args.itemName, message: `"${args.itemName}" menu mein nahi mila.` };
                                }
                            } else {
                                return { error: 'ITEM_NOT_FOUND', query: args.itemName, message: `"${args.itemName}" menu mein nahi mila.` };
                            }
                        }
                    }
                }

                // If menuItemId was passed directly with rawVariant, ensure variantId is resolved
                if (menuItemId && rawVariant) {
                    try {
                        const prisma = getDbClient();
                        const item = await prisma.menuItem.findUnique({
                            where: { id: menuItemId },
                            include: { variants: true },
                        });
                        if (item?.variants?.length > 0) {
                            const matched = matchVariant(item.variants, rawVariant);
                            if (matched) variantId = matched.id;
                        }
                    } catch (_) {}
                }

                const added = await addToCart({
                    sessionKey,
                    restaurantId: restId,
                    chatId,
                    verifiedPhone: whatsappPhone,
                    menuItemId,
                    variantId,
                    dealId,
                    quantity,
                    notes,
                });
                try {
                    clearLastDiscussedDeal(sessionKey);
                    clearLastDiscussedItem(sessionKey);
                    clearPendingDealFlavour(sessionKey);
                    const { updateSessionOrderDetails } = await import('./sessionService.js');
                    updateSessionOrderDetails(sessionKey, { summaryShown: false }, whatsappPhone);
                } catch (_) {}
                return { success: true, cartItemId: added.id, quantity: added.quantity };
            }

            // 10. update_cart_item
            case 'update_cart_item': {
                const updated = await updateCartItem({
                    sessionKey,
                    restaurantId: restId,
                    cartItemId: args.cartItemId,
                    quantity: parseInt(args.quantity, 10),
                    notes: args.notes,
                });
                try {
                    const { updateSessionOrderDetails } = await import('./sessionService.js');
                    updateSessionOrderDetails(sessionKey, { summaryShown: false }, whatsappPhone);
                } catch (_) {}
                return { success: true, cartItemId: updated.id, newQuantity: updated.quantity };
            }

            // 11. remove_cart_item
            case 'remove_cart_item': {
                await removeCartItem({ sessionKey, restaurantId: restId, cartItemId: args.cartItemId });
                try {
                    const { updateSessionOrderDetails } = await import('./sessionService.js');
                    updateSessionOrderDetails(sessionKey, { summaryShown: false }, whatsappPhone);
                } catch (_) {}
                return { success: true, cartItemId: args.cartItemId };
            }

            // 12. clear_cart
            case 'clear_cart': {
                await clearCartService({ sessionKey, restaurantId: restId });
                try {
                    const { updateSessionOrderDetails } = await import('./sessionService.js');
                    updateSessionOrderDetails(sessionKey, { summaryShown: false }, whatsappPhone);
                } catch (_) {}
                return { success: true, message: 'Cart khali kar diya gaya hai.' };
            }

            // 13. calculate_cart_totals
            case 'calculate_cart_totals': {
                const cart = await getActiveCart({ sessionKey, restaurantId: restId, chatId });
                const items = (cart.items || []).filter(i => i.menu_item_id).map(i => ({
                    menuItemId: i.menu_item_id, variantId: i.menu_variant_id, quantity: i.quantity,
                }));
                const deals = (cart.items || []).filter(i => i.deal_id).map(i => ({
                    dealId: i.deal_id, quantity: i.quantity,
                }));
                const pricing = await calculatePricing({ restaurantId: restId, items, deals });
                return {
                    itemCount: (cart.items || []).length,
                    itemsList: (cart.items || []).map(i => `${i.quantity}x ${i.deal ? i.deal.name : (i.menu_item?.name || 'Item')}`),
                    subtotal: Number(pricing.subtotal || 0),
                    deliveryFee: Number(pricing.deliveryFee || 0),
                    discount: Number(pricing.discountTotal || 0),
                    discountTotal: Number(pricing.discountTotal || 0),
                    total: Number(pricing.total || 0),
                    cartEmpty: (cart.items || []).length === 0,
                };
            }

            // 14. create_confirmed_order
            case 'create_confirmed_order': {
                let { customerName, deliveryAddress, phone, paymentMethod, notes } = args;
                const cleanPhoneDigitsForDetails = (whatsappPhone || phone || '').replace(/\D/g, '');
                const savedDetails = getSessionOrderDetails(sessionKey, cleanPhoneDigitsForDetails);

                // ── Strict Validation 1: Customer Name ──
                let trimmedName = (customerName || '').trim();
                let isPlaceholderName = !trimmedName ||
                    /^(customer|user|guest|none|\.|anonymous|client|bhai|sir|hlo|helo|hi|hello)$/i.test(trimmedName) ||
                    trimmedName.length < 2;

                if (isPlaceholderName && savedDetails.name) {
                    trimmedName = savedDetails.name;
                    isPlaceholderName = false;
                }

                if (isPlaceholderName) {
                    return { error: 'CUSTOMER_NAME_REQUIRED', message: 'Order complete karne ke liye baraye meherbani apna Naam bata dein.' };
                }

                // ── Strict Validation 2: Phone Number & Same Number Rule ──
                let targetPhone = (phone || savedDetails.phone || '').trim();
                const isSameNumberKeyword = /^(same|same\s*number|yahi|yehi|isi\s*pe|isi\s*number|wahi|whatsapp|apna\s*number)$/i.test(targetPhone);
                const isDummyPhone = /^(0300-?1234567|0312-?3456789|0300-?0000000|03000000000|0321-?1234567|03001234567|03123456789)$/i.test(targetPhone.replace(/\s/g, ''));

                if (!targetPhone || isSameNumberKeyword || isDummyPhone) {
                    targetPhone = whatsappPhone || '';
                }

                const cleanPhoneDigits = targetPhone.replace(/\D/g, '');
                if (cleanPhoneDigits.length < 10) {
                    return { error: 'CONTACT_NUMBER_REQUIRED', message: 'Valid 11-digit phone number zaroori hai.' };
                }

                // ── Strict Validation 2a: Phone Confirmation Required ──
                if (!savedDetails.phoneConfirmed) {
                    return { error: 'PHONE_CONFIRMATION_REQUIRED', message: 'Order process karne se pehle contact phone number confirm karwana LAZMI hai. Baraye meherbani customer se phone number confirm karwayein.' };
                }

                // ── Strict Validation 3: Delivery Address (Reject outlet branch) ──
                let trimmedAddress = (deliveryAddress || savedDetails.address || '').trim();
                const isRestaurantBranchAddress = /\b(school\s*stop|lehtrar\s*road|lehtrar|fazal\s*e?\s*haq|tarlai\s*kalan|tarlai)\b/i.test(trimmedAddress);
                const isPlaceholderAddress = /^(islamabad|rawalpindi|customer\s*address|\.)$/i.test(trimmedAddress) || trimmedAddress.length < 5;

                const activeLoc = locationData || savedDetails.location;

                // If restaurant address or placeholder given AND no location pin:
                if ((isRestaurantBranchAddress || isPlaceholderAddress) && !activeLoc) {
                    return { error: 'DELIVERY_ADDRESS_REQUIRED', message: 'Delivery address zaroori hai. Restaurant ka address nahi, apna ghar ya delivery address dein.' };
                }

                // ── Strict Validation 4: Cart Not Empty ──
                const cart = await getActiveCart({ sessionKey, restaurantId: restId, chatId });
                if (!cart.items || cart.items.length === 0) {
                    return { error: 'CART_EMPTY', message: 'Aap ka cart khali hai. Pehle koi item add karein.' };
                }

                // Use GPS location pin address if available and address was ambiguous/restaurant
                let finalAddress = trimmedAddress;
                if (activeLoc && (isRestaurantBranchAddress || isPlaceholderAddress || !finalAddress)) {
                    finalAddress = activeLoc.formattedAddress || activeLoc.address || `GPS Pin (${activeLoc.latitude}, ${activeLoc.longitude})`;
                }

                // ── Strict Validation 4a: Delivery Radius Check (5 KM Limit) ──
                try {
                    const { checkDeliveryAvailability } = await import('./deliveryService.js');
                    const isPin = activeLoc?.latitude != null && activeLoc?.longitude != null;
                    const delCheck = await checkDeliveryAvailability({
                        restaurantId: restId,
                        address: (!isPin ? finalAddress : null),
                        latitude: activeLoc?.latitude,
                        longitude: activeLoc?.longitude,
                    });
                    if (!delCheck.available) {
                        return {
                            error: 'LOCATION_OUT_OF_RANGE',
                            message: `${delCheck.message || 'Yeh location hamari 5 KM delivery range se bahar hai.'} Lekin aap hamare Ghauri Town Phase 4B outlet se *Takeaway / Self-Pickup* karwa sakte hain! 🏪`
                        };
                    }
                } catch (delErr) {
                    console.error('[AI_AGENT] Delivery availability check error in create_confirmed_order:', delErr.message);
                }

                // ── Strict Validation 4b: Explicit Payment Method Selection (Robust normalization) ──
                let rawPayment = (paymentMethod || savedDetails.paymentMethod || '').trim().toUpperCase();
                let chosenPaymentMethod = 'COD';
                if (/EASY\s*PAISA|EP/i.test(rawPayment)) {
                    chosenPaymentMethod = 'EASYPAISA';
                } else if (/COD|CASH/i.test(rawPayment)) {
                    chosenPaymentMethod = 'COD';
                } else if (savedDetails.paymentMethod) {
                    chosenPaymentMethod = /EASY/i.test(savedDetails.paymentMethod) ? 'EASYPAISA' : 'COD';
                } else {
                    chosenPaymentMethod = 'COD';
                }

                // ── Strict Validation 4c: Mandatory Order Summary Review ──
                // The customer MUST have been shown the complete final Order Summary card before the order is booked!
                if (!savedDetails.summaryShown) {
                    try {
                        const { updateSessionOrderDetails } = await import('./sessionService.js');
                        updateSessionOrderDetails(sessionKey, { summaryShown: true }, cleanPhoneDigitsForDetails);
                    } catch (_) {}
                    return {
                        error: 'SUMMARY_REVIEW_REQUIRED',
                        message: `Order confirm karne se pehle customer ko mukammal Order Summary dikhana laazmi hai! Abhi order place mat karein. Pehle customer ko yeh details dikhayein:\n\n📋 *ORDER SUMMARY*\n• Customer: ${trimmedName}\n• Contact Phone: ${cleanPhoneDigits}\n• Delivery Address: ${finalAddress}\n• Payment: ${chosenPaymentMethod === 'COD' ? 'Cash on Delivery (COD)' : 'EasyPaisa'}\n\nAur aakhri baar poochein: "Kya aap in tamam details ke sath order confirm karte hain? (Order book karne ke liye 'Confirm' ya 'Haan' likhein)"`
                    };
                }

                // ── Strict Validation 4d: Customer Confirmation ──
                if (!context.confirmIntent) {
                    return {
                        error: 'CONFIRMATION_REQUIRED',
                        message: 'Customer ne abhi tak final confirmation nahi di. Customer se poochein: "Kya aap yeh order confirm karte hain? (Order confirm karne ke liye Confirm ya Haan likhein)"'
                    };
                }

                const { createOrder } = await import('./orderService.js');
                const result = await createOrder({
                    restaurantId: restId,
                    sessionKey,
                    customerName: trimmedName,
                    phone: cleanPhoneDigits,
                    delivery: {
                        address: finalAddress,
                        latitude: locationData?.latitude ?? null,
                        longitude: locationData?.longitude ?? null,
                    },
                    paymentMethod: chosenPaymentMethod,
                    notes,
                    sock,
                });

                const finalOrderNum = result.order?.orderNumber || result.order?.order_number;
                const finalTotal = Number(result.order?.pricing?.total ?? result.order?.total ?? 0);
                const finalStatus = result.order?.orderStatus || result.order?.order_status || 'CONFIRMED';

                if (result.status === 'ORDER_EXISTS') {
                    return { success: true, isDuplicate: true, orderNumber: finalOrderNum, total: finalTotal };
                }
                if (!finalOrderNum) {
                    return { error: 'ORDER_CREATION_FAILED', message: 'Order place nahi ho saka. Dobara koshish karein.' };
                }

                try {
                    const { clearSessionOrderDetails, rememberCustomerDetails } = await import('./sessionService.js');
                    rememberCustomerDetails(sessionKey, {
                        name: trimmedName,
                        phone: cleanPhoneDigits,
                        address: finalAddress,
                        paymentMethod: chosenPaymentMethod,
                    }, cleanPhoneDigitsForDetails);
                    clearSessionOrderDetails(sessionKey, cleanPhoneDigitsForDetails);
                } catch (_) {}

                const finalDiscountTotal = Number(result.order?.pricing?.discountTotal ?? result.order?.discount_total ?? 0);
                return {
                    success: true,
                    orderNumber: finalOrderNum,
                    total: finalTotal,
                    discountTotal: finalDiscountTotal,
                    status: finalStatus,
                };
            }

            // 15. request_order_cancellation
            case 'request_order_cancellation':
            case 'cancel_order': {
                let orderNum = (args.orderNumber || '').toUpperCase().trim();
                const cart = await getActiveCart({ sessionKey, restaurantId: restId, chatId });
                if (!orderNum && cart?.items && cart.items.length > 0) {
                    await clearCartService({ sessionKey });
                    try {
                        const { clearSessionOrderDetails } = await import('./sessionService.js');
                        clearSessionOrderDetails(sessionKey, whatsappPhone);
                    } catch (_) {}
                    return { success: true, cartCleared: true, message: 'Aap ka draft cart khali kar diya gaya hai. Agar dobara kuch order karna ho to batayein! 😊' };
                }

                const prisma = getDbClient();
                if (!orderNum && prisma) {
                    const orConditions = await getOrderLookupOrConditions(prisma, { sessionKey, chatId, whatsappPhone });
                    const recent = orConditions.length > 0 ? await prisma.order.findFirst({
                        where: {
                            restaurant_id: restId,
                            OR: orConditions,
                        },
                        orderBy: { created_at: 'desc' },
                        select: { id: true, order_number: true, order_status: true },
                    }) : null;
                    if (recent) {
                        orderNum = recent.order_number;
                    }
                }

                if (!orderNum) {
                    return { error: 'NO_ACTIVE_ORDER', message: 'Aap ka koi active order nahi mila jise cancel kiya ja sake.' };
                }

                let order = null;
                if (prisma) {
                    order = await prisma.order.findFirst({
                        where: { restaurant_id: restId, order_number: orderNum },
                        select: { id: true, order_number: true, order_status: true },
                    });
                }

                const { getAdminContact } = await import('./restaurantService.js');
                const adminContact = await getAdminContact(restId);
                const displayNum = order?.order_number || orderNum;
                const waLink = `${adminContact.whatsappLink}?text=${encodeURIComponent(`Assalam-o-Alaikum Admin, mujhe apna order #${displayNum} cancel karwana hai.`)}`;

                return {
                    canCancel: false,
                    directCancelAllowed: false,
                    orderNumber: displayNum,
                    orderStatus: order?.order_status || 'CONFIRMED',
                    adminPhone: adminContact.displayPhone,
                    adminWhatsappLink: waLink,
                    message: `Bot direct order cancel nahi kar sakta. Customer ko batayein ke kitchen preparation ki wajah se direct cancel nahi ho sakta, aur hamare Store Admin / Manager ka number (${adminContact.displayPhone}) aur WhatsApp link (${waLink}) share karein taake woh cancellation process kar sakein.`,
                };
            }

            // 16. confirm_order_cancellation
            case 'confirm_order_cancellation': {
                let orderNum = (args.orderNumber || '').toUpperCase().trim();
                const prisma = getDbClient();
                if (!orderNum && prisma) {
                    const orConditions = await getOrderLookupOrConditions(prisma, { sessionKey, chatId, whatsappPhone });
                    const recent = orConditions.length > 0 ? await prisma.order.findFirst({
                        where: {
                            restaurant_id: restId,
                            OR: orConditions,
                        },
                        orderBy: { created_at: 'desc' },
                        select: { id: true, order_number: true, order_status: true },
                    }) : null;
                    if (recent) {
                        orderNum = recent.order_number;
                    }
                }

                const { getAdminContact } = await import('./restaurantService.js');
                const adminContact = await getAdminContact(restId);
                const displayNum = orderNum || 'CC-XXXXXX';
                const waLink = `${adminContact.whatsappLink}?text=${encodeURIComponent(`Assalam-o-Alaikum Admin, mujhe apna order #${displayNum} cancel karwana hai.`)}`;

                return {
                    success: false,
                    directCancelAllowed: false,
                    orderNumber: displayNum,
                    adminPhone: adminContact.displayPhone,
                    adminWhatsappLink: waLink,
                    message: `Bot direct order cancel nahi kar sakta. Customer ko Store Admin / Manager ka contact (${adminContact.displayPhone}) aur WhatsApp link (${waLink}) dein jo cancellation process karenge.`,
                };
            }

            // 17. send_alternate_confirmation
            case 'send_alternate_confirmation': {
                const targetPhone = cleanWhatsAppPhone(args.phone);
                if (!targetPhone) return { error: 'INVALID_PHONE', message: 'Valid phone number dein.' };
                const { sendCustomerOrderStatusNotification } = await import('./whatsappNotificationService.js');
                const prisma = getDbClient();
                const orders = prisma ? await prisma.order.findMany({
                    where: { restaurant_id: restId },
                    orderBy: { created_at: 'desc' },
                    take: 1,
                    select: { id: true, order_number: true },
                }) : [];
                if (orders.length > 0) {
                    await sendCustomerOrderStatusNotification({
                        orderId: orders[0].id,
                        newStatus: 'PENDING',
                        sock,
                        overridePhone: targetPhone,
                    }).catch(() => {});
                }
                return { success: true, phone: targetPhone };
            }

            // 18. request_human_handover
            case 'request_human_handover':
            case 'transfer_to_human_agent':
            case 'human_handover':
            case 'handover': {
                const muteRes = await muteChatForHandover({
                    chatId,
                    sessionKey,
                    reason: args.reason || 'Customer requested human handover / manager support',
                    customerPhone: whatsappPhone,
                    sock,
                });
                const mins = muteRes?.durationMinutes || 120;
                return { success: true, muted: true, durationMinutes: mins };
            }

            // 19. update_order_details
            case 'update_order_details':
            case 'modify_order': {
                const { updateOrderDetails } = await import('./orderService.js');
                let orderNum = (args.orderNumber || '').toUpperCase().trim();
                if (!orderNum) {
                    const prisma = getDbClient();
                    if (prisma) {
                        const orConditions = await getOrderLookupOrConditions(prisma, { sessionKey, chatId, whatsappPhone });
                        const recent = orConditions.length > 0 ? await prisma.order.findFirst({
                            where: {
                                restaurant_id: restId,
                                OR: orConditions,
                                order_status: { in: ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY'] },
                            },
                            orderBy: { created_at: 'desc' },
                            select: { id: true, order_number: true, order_status: true },
                        }) : null;
                        if (recent) {
                            orderNum = recent.order_number;
                        }
                    }
                }
                if (!orderNum) {
                    return { error: 'ORDER_NOT_FOUND', message: 'Update karne ke liye koi active order nahi mila.' };
                }
                const result = await updateOrderDetails({
                    restaurantId: restId,
                    orderNumber: orderNum,
                    customerName: args.customerName,
                    address: args.deliveryAddress || args.address,
                    phone: args.phone,
                    paymentMethod: args.paymentMethod,
                    changedByType: 'CUSTOMER',
                    sock,
                });
                return result;
            }

            default:
                return { error: `Unknown tool: ${toolName}` };
        }
    } catch (err) {
        console.error(`[AGENT] Tool '${toolName}' error:`, err.message);
        return { error: err.message };
    }
}

// ─── Output Sanitizer (Hissa 7) ───────────────────────────────────────────
const EMOJI_REGEX = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FEFF}\u{1F000}-\u{1FFFF}\u{200D}]/gu;

export function sanitizeOutput(text) {
    if (!text || typeof text !== 'string') return '';
    let clean = text;

    // 0. Remove leaked system prompt instructions or prefixes
    clean = clean.replace(/^(?:(?:aur\s+)?customer\s+(?:se\s+poocho|ko\s+bolo|se\s+kahein|ko\s+kahein)|aap\s+(?:ko\s+customer\s+se|customer\s+se)\s+(?:poochna|kehna)\s+hai|prompt|system|assistant)\s*:\s*"?/gi, '');
    clean = clean.replace(/\n(?:(?:aur\s+)?customer\s+(?:se\s+poocho|ko\s+bolo|se\s+kahein|ko\s+kahein)|aap\s+(?:ko\s+customer\s+se|customer\s+se)\s+(?:poochna|kehna)\s+hai|prompt|system|assistant)\s*:\s*"?/gi, '\n');
    clean = clean.replace(/"\s*$/g, '');

    // 0b. Catch and sanitize raw tool calls / JSON objects leaking to WhatsApp
    if (/^\s*\{[\s\S]*"(?:tool|name)"[\s\S]*\}\s*$/.test(clean) || clean.includes('"tool":') || clean.includes('"add_to_cart"')) {
        try {
            const cleanJson = clean.replace(/```(?:json)?/g, '').trim();
            const jMatch = cleanJson.match(/\{[\s\S]*\}/);
            if (jMatch) {
                const parsed = JSON.parse(jMatch[0]);
                if (parsed.tool === 'add_to_cart' || parsed.name === 'add_to_cart') {
                    const item = parsed.args?.itemName || 'Item';
                    return `Zabardast! *${item}* aapke cart mein add kar diya gaya hai! 🎉\n\nKya iske sath mazeed kuch add karna chahenge ya order finalize karein?`;
                }
                if (parsed.tool === 'check_delivery_availability' || parsed.name === 'check_delivery_availability') {
                    return 'Aap ki delivery location check ki ja rahi hai. Baraye meherbani apna mukammal address ya location pin share karein. 📍';
                }
                if (parsed.tool === 'create_confirmed_order' || parsed.name === 'create_confirmed_order') {
                    return 'Aap ka order process kiya ja raha hai. Shukriya!';
                }
            }
        } catch (_) {}
        return 'Aap ki request note kar li gayi hai! Kya iske sath mazeed kuch add karna chahenge ya order finalize karein? 😊';
    }

    // 1. Remove all internal IDs (menuItemId, variantId, dealId, cartItemId, id)
    clean = clean.replace(/\[\s*(?:menuItemId|variantId|dealId|cartItemId|id)\s*:[^\]]+\]/gi, '');
    // 2. Remove all asterisks
    clean = clean.replace(/\*/g, '');
    // 3. Remove all emojis and symbols
    clean = clean.replace(EMOJI_REGEX, '');
    // 4. Remove leftover backtick markdown
    clean = clean.replace(/`+/g, '');
    // 5. Remove informal slangs (jigri, jigar)
    clean = clean.replace(/\b(?:jigri|jigar)\b/gi, '');
    // 6. Clean up duplicate spaces
    clean = clean.replace(/[ \t]{2,}/g, ' ');
    // 7. Collapse multiple blank lines
    clean = clean.replace(/\n{3,}/g, '\n\n');
    return clean.trim();
}

// ─── Post-Verification (Hissa 7) ──────────────────────────────────────────
const BACKEND_ERROR_MESSAGES = {
    CONTACT_NUMBER_REQUIRED:  'Aapka contact number zaroori hai. Baraye meherbani apna 11-digit phone number bata dein (maslan 03001234567).',
    CONTACT_NUMBER_INVALID:   'Phone number valid nahi lagta. Sahi 11-digit Pakistani number dein.',
    CUSTOMER_NAME_REQUIRED:   'Order complete karne ke liye baraye meherbani apna Naam bata dein.',
    DELIVERY_ADDRESS_REQUIRED:'Delivery ke liye mukammal address zaroori hai. Apna ghar ya office ka mukammal pata ya WhatsApp location pin share karein.',
    DELIVERY_ADDRESS_INVALID: 'Aap ne restaurant ka branch address diya hai. Baraye meherbani apna ghar ya delivery point ka mukammal address ya WhatsApp location pin share karein.',
    CART_EMPTY:               'Aapka cart is waqt khali hai. Pehle koi item ya deal select karein, phir checkout karein.',
    ORDER_CREATION_FAILED:    'Aapka order place nahi ho saka. Baraye meherbani dobara "confirm" likhein taake retry ho sake, ya "agent" likhein hamara team member madad karega.',
};

function verifyOutput(aiText, toolResults) {
    // 1. Detect false order confirmation (claims confirm/place ho gaya without genuine CC-XXXXXX order number)
    const claimsOrderPlaced = /\b(?:order\s+(?:kamyabi\s+se\s+)?(?:place|book|confirm)\s+ho\s+gaya|order\s+confirm\s+ho\s+chuka|order\s+has\s+been\s+placed)\b/i.test(aiText);
    const hasOrderNumberInText = /CC-[0-9A-Z]{4,}/i.test(aiText);
    const hasRealOrderInTools = toolResults.some(r => r?.orderNumber && /CC-[0-9A-Z]{4,}/i.test(r.orderNumber));

    if (claimsOrderPlaced && !hasOrderNumberInText && !hasRealOrderInTools) {
        return 'Aapka order place nahi ho saka. Baraye meherbani dobara "confirm" likhein taake retry ho sake, ya "agent" likhein hamara team member madad karega.';
    }

    // 2. Detect backend error codes in tool results and surface them in Roman Urdu
    for (const result of toolResults) {
        if (result?.error && BACKEND_ERROR_MESSAGES[result.error]) {
            return BACKEND_ERROR_MESSAGES[result.error];
        }
    }

    return null; // Output is valid
}

// ─── Main AI Agent Loop (Tool Calling + Exact Token Tracking) ─────────────
const MAX_TOOL_ROUNDS = 3;

async function runAgentLoop(messages, context) {
    const allToolResults = [];
    const calledToolNames = [];

    let totalPromptTokens = 0;
    let totalReplyTokens = 0;
    let totalTokens = 0;
    let lastProvider = env.AI_PRIMARY_PROVIDER || 'gemini';
    let lastModel = env.GEMINI_MODEL || 'gemini-2.5-flash';
    let lastKeyIndex = 0;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        let aiResult = null;
        try {
            aiResult = await routeLLM(messages);
        } catch (err) {
            console.warn('[AGENT] LLM call failed, falling back to deterministic ordering orchestrator:', err.message);
            try {
                const { handleIncomingOrderMessage } = await import('./whatsappOrderOrchestrator.js');
                const ordRes = await handleIncomingOrderMessage({
                    sock: context.sock,
                    session: { id: context.sessionKey },
                    normalizedMessage: {
                        sessionId: context.sessionKey,
                        chatId: context.chatId,
                        messageId: 'fb_' + Date.now(),
                        text: context.effectiveText || '',
                        verifiedPhone: context.whatsappPhone,
                        pushName: '',
                        location: context.locationData,
                    }
                });
                const hasOrdContent = Boolean(
                    (ordRes && ordRes.text && ordRes.text.trim()) ||
                    (ordRes && ordRes.imageUrl) ||
                    (ordRes && Array.isArray(ordRes.imageUrls) && ordRes.imageUrls.length > 0)
                );
                if (ordRes && hasOrdContent) {
                    return {
                        text: ordRes.text || '',
                        imageUrl: ordRes.imageUrl || (Array.isArray(ordRes.imageUrls) ? ordRes.imageUrls[0] : null),
                        imageUrls: ordRes.imageUrls || (ordRes.imageUrl ? [ordRes.imageUrl] : []),
                        toolResults: allToolResults,
                        calledToolNames,
                        tokenUsage: { promptTokens: 0, replyTokens: 0, totalTokens: 0 },
                        providerInfo: { provider: 'native_orchestrator', model: 'fallback', keyIndex: 0 },
                    };
                }
            } catch (fallbackErr) {
                console.error('[AGENT] Fallback orchestrator error:', fallbackErr.message);
            }

            return {
                text: 'Mafi chahta hoon, rabtay mein thodi takheer ho sakti hai. Hamara menu dekhne ke liye \'menu\' ya deals dekhne ke liye \'deals\' likhein, ya support agent se rabte ke liye \'agent\' likhein.',
                toolResults: allToolResults,
                calledToolNames,
                tokenUsage: { promptTokens: totalPromptTokens, replyTokens: totalReplyTokens, totalTokens },
                providerInfo: { provider: lastProvider, model: lastModel, keyIndex: lastKeyIndex },
            };
        }

        // Track tokens from this call
        const resUsage = aiResult.usage || {};
        totalPromptTokens += Number(resUsage.promptTokens || 0);
        totalReplyTokens += Number(resUsage.replyTokens || 0);
        totalTokens += Number(resUsage.totalTokens || 0);

        lastProvider = aiResult.provider || lastProvider;
        lastModel = aiResult.model || lastModel;
        lastKeyIndex = aiResult.keyIndex ?? lastKeyIndex;

        const aiResponse = aiResult.content || '';

        // Parse tool call from response (strip markdown fences, support {"tool": ...} or {"name": ...})
        let toolCall = null;
        try {
            const cleanContent = aiResponse.replace(/```(?:json)?\s*([\s\S]*?)\s*```/gi, '$1').trim();
            const jsonMatch = cleanContent.match(/\{[\s\S]*"(?:tool|name)"\s*:\s*"[^"]+"[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                const toolName = parsed.tool || parsed.name;
                const toolArgs = parsed.args || parsed.arguments || {};
                if (toolName) {
                    toolCall = { tool: toolName, args: toolArgs };
                }
            }
        } catch (_) {}

        if (toolCall && toolCall.tool) {
            calledToolNames.push(toolCall.tool);
            console.log(`[AGENT] Executing local tool: ${toolCall.tool}`, JSON.stringify(toolCall.args || {}).slice(0, 100));

            const result = await executeTool(toolCall.tool, toolCall.args || {}, context);
            allToolResults.push(result);

            // If we are at the last allowable tool round, do not loop again: produce customer answer directly from tool result
            if (round === MAX_TOOL_ROUNDS - 1) {
                if (toolCall.tool === 'add_to_cart') {
                    const item = toolCall.args?.itemName || 'Item';
                    const notesStr = toolCall.args?.notes ? ` (${toolCall.args.notes})` : '';
                    return {
                        text: `Zabardast! *${item}*${notesStr} cart mein add kar diya gaya hai! 🎉\n\nKya iske sath kuch aur add karna chahenge ya order finalize karein?`,
                        imageUrl: null,
                        imageUrls: null,
                        toolResults: allToolResults,
                        calledToolNames,
                        tokenUsage: { promptTokens: totalPromptTokens, replyTokens: totalReplyTokens, totalTokens },
                        providerInfo: { provider: lastProvider, model: lastModel, keyIndex: lastKeyIndex },
                    };
                }
            }

            messages.push({ role: 'assistant', content: aiResponse });
            messages.push({
                role: 'user',
                content: `Tool result for ${toolCall.tool}:\n${JSON.stringify(result, null, 2)}\n\nAb customer ko Roman Urdu mein polite jawab dein. Agar order confirm ho chuka hai to asli CC-XXXXXX order number customer ko batayein.`,
            });
            continue; // Next round
        }

        // No tool call — final answer reached
        let aiImageUrl = null;
        let aiImageUrls = null;
        const lowerEff = (context?.effectiveText || '').toLowerCase();
        const asksDeals = calledToolNames.includes('get_current_deals') || /\b(deals?|deal|offers?)\b/i.test(lowerEff);
        const asksMenu = calledToolNames.includes('get_menu_categories') || /\b(menu|menue|catalog|card|rate\s*list)\b/i.test(lowerEff);

        const { haveDealsBeenSent, markDealsSent, hasMenuBeenSent, markMenuSent, getSessionOrderDetails } = await import('./sessionService.js');
        const sessionKey = context?.sessionKey;
        const cleanPhone = (context?.whatsappPhone || '').replace(/\D/g, '');
        const dealsAlreadySent = sessionKey ? haveDealsBeenSent(sessionKey, cleanPhone) : false;
        const menuAlreadySent = sessionKey ? hasMenuBeenSent(sessionKey, cleanPhone) : false;

        const hasShowOrSendDealWord = /\b(dikhao|dekhao|dikhayein|dikhana|bhejo|bhajo|bhej\s*do|send|share|list|card|flyer|photos?|pics?|images?)\b/i.test(lowerEff);
        const isSpecificDealOrHeadcount = !hasShowOrSendDealWord && (
            /\b(\d+|ek|aik|do|teen|tin|char|chaar|panch|paanch)\s*(?:k\s*lie|ke\s*lie|k\s*liye|ke\s*liye|liye|lie)?\s*(?:bando|bndo|bandon|bndon|bande|bnde|log|logo|logon|person|persons|people)\b/i.test(lowerEff) ||
            /\b(koi\s+(?:achi|acha|best)|konsi|konse|kaunsi|kaunsa|recommend|recommendation|sugest|suggest|suggestion)\b/i.test(lowerEff)
        );

        const isGenericDealsRequest = /\b(?:show\s+|send\s+|bhejo\s+|dikhao\s+|dekhao\s+)?deals?[\s.!?]*$/i.test(lowerEff) ||
            /\b(?:deals?\s*(?:dikhao|dekhao|bhejo|send|flyer|images?|pics?))\b/i.test(lowerEff) ||
            /\b(?:(?:acha|achha|theek|ok|aur)?\s*(?:deals?|offers?|combos?)\s*(?:dikhao|dekhao|bhejo|send|share))\b/i.test(lowerEff);

        if (asksDeals && !dealsAlreadySent && !isSpecificDealOrHeadcount && isGenericDealsRequest) {
            try {
                const { getCatalogCache } = await import('./catalogCacheService.js');
                const cache = await getCatalogCache();
                let images = (Array.isArray(cache.dealsImageUrls) && cache.dealsImageUrls.length > 0)
                    ? cache.dealsImageUrls
                    : (cache.dealsImageUrl ? [cache.dealsImageUrl] : []);
                if (images.length > 0) {
                    aiImageUrls = images;
                    aiImageUrl = images[0];
                    if (sessionKey) markDealsSent(sessionKey, cleanPhone);
                    const sDetails = sessionKey ? getSessionOrderDetails(sessionKey, cleanPhone) : null;
                    aiResponse = 'Cravey Crust ki taraf se mazedaar deals haazir hain! 🍕🔥\n\nIn mein se kaunsi deal aap ke liye cart mein add karun? 😊';
                }
            } catch (_) {}
        } else if (asksMenu && !menuAlreadySent && (!/\b(koi|konsa|konse|best|pizza|burger|fries|drink)\b/i.test(lowerEff) || /\b(dikhao|dekhao|bhejo|send|card|flyer)\b/i.test(lowerEff))) {
            try {
                const { getCatalogCache } = await import('./catalogCacheService.js');
                const cache = await getCatalogCache();
                let images = (Array.isArray(cache.menuImageUrls) && cache.menuImageUrls.length > 0)
                    ? cache.menuImageUrls
                    : (cache.menuImageUrl ? [cache.menuImageUrl] : []);
                if (images.length > 0) {
                    aiImageUrls = images;
                    aiImageUrl = images[0];
                    if (sessionKey) markMenuSent(sessionKey, cleanPhone);
                    const sDetails = sessionKey ? getSessionOrderDetails(sessionKey, cleanPhone) : null;
                    aiResponse = 'Cravey Crust ka menu haazir hai! 🍕🍔\n\nBataiye in mein se kya mangwana pasand karenge? 😊';
                }
            } catch (_) {}
        }

        return {
            text: aiResponse,
            imageUrl: aiImageUrl,
            imageUrls: aiImageUrls,
            toolResults: allToolResults,
            calledToolNames,
            tokenUsage: { promptTokens: totalPromptTokens, replyTokens: totalReplyTokens, totalTokens },
            providerInfo: { provider: lastProvider, model: lastModel, keyIndex: lastKeyIndex },
        };
    }

    return {
        text: 'Order process mein ek masla aaya. Meherbani farma kar dobara try karein.',
        toolResults: allToolResults,
        calledToolNames,
        tokenUsage: { promptTokens: totalPromptTokens, replyTokens: totalReplyTokens, totalTokens },
        providerInfo: { provider: lastProvider, model: lastModel, keyIndex: lastKeyIndex },
    };
}

// ─── Internal Implementation: _processMessageInternal ───────────────────
async function _processMessageInternal({ sock, msg, session, text, identity, locationData }) {
    const jid = msg?.key?.remoteJid || identity?.chatId || identity?.phone || 'default';
    const sessionKey = jid || identity?.phone || 'default';
    const syncEpoch = getSyncEpoch();

    // ── 1. Clean WhatsApp Phone (03XXXXXXXXX format) ──
    const rawSender = identity?.whatsappPhone || identity?.phone || '';
    const whatsappPhone = cleanWhatsAppPhone(rawSender);

    // ── 2. Location data extraction from text (if not in message payload) ──
    let activeLocation = locationData || extractLocationFromText(text);

    // ── 3. Build effective message text ──
    let effectiveText = (text || '').trim();
    if (!effectiveText && activeLocation) {
        if (activeLocation.latitude != null && activeLocation.longitude != null) {
            effectiveText = `https://www.google.com/maps?q=${activeLocation.latitude},${activeLocation.longitude}`;
        } else if (activeLocation.mapUrl) {
            effectiveText = activeLocation.mapUrl;
        } else if (activeLocation.address) {
            effectiveText = activeLocation.address;
        } else {
            effectiveText = 'Location Pin';
        }
    }

    if (!effectiveText) return '';

    // ── 4. Detect confirmIntent boolean (Hissa 3) ──
    const confirmIntent = detectConfirmIntent(effectiveText);

    // ── 5. Zero-Token Fast Routing (Hissa 4) ──
    try {
        const fastResult = await checkFastRoute({
            text: effectiveText,
            whatsappPhone,
            sessionKey,
            chatId: jid,
            sock,
        });

        const hasFastContent = Boolean(
            (fastResult.reply && fastResult.reply.trim()) ||
            fastResult.imageUrl ||
            (Array.isArray(fastResult.imageUrls) && fastResult.imageUrls.length > 0)
        );

        if (fastResult.handled && hasFastContent) {
            const cleanFastReply = fastResult.reply ? sanitizeOutput(fastResult.reply) : '';

            // Log zero tokens used (Hissa 2)
            logZeroTokenReply({
                whatsappPhone,
                message: effectiveText,
                routeName: fastResult.routeName || 'Local Command/Cache',
            });

            // Update session history
            appendSessionHistory(sessionKey, 'user', effectiveText, syncEpoch);
            if (cleanFastReply) {
                appendSessionHistory(sessionKey, 'assistant', cleanFastReply, syncEpoch);
            }

            return {
                text: cleanFastReply,
                imageUrl: fastResult.imageUrl || (fastResult.imageUrls && fastResult.imageUrls[0]) || null,
                imageUrls: fastResult.imageUrls || (fastResult.imageUrl ? [fastResult.imageUrl] : []),
            };
        }
    } catch (err) {
        console.error('[AGENT] Fast route check error:', err.message);
    }

    // ── Check Human Handover Mute (after fast routes, allowing unmute) ──
    const muteStatus = isChatMuted(jid) || isChatMuted(whatsappPhone) || (sessionKey ? isChatMuted(sessionKey) : null);
    if (muteStatus?.isMuted) {
        console.log(`[HANDOVER] Chat ${jid} (${whatsappPhone}) is muted for human support (${muteStatus.remainingMinutes}m remaining). Skipping AI.`);
        return '';
    }

    // ── 6. Standalone AI Agent Execution (Hissa 5) ──
    let restId;
    try {
        restId = await getDefaultRestaurantId();
    } catch (_) {
        return 'Store database se rabta nahi ho pa raha. Thodi der baad dobara koshish karein.';
    }

    const context = {
        sessionKey,
        chatId: jid,
        whatsappPhone,
        restId,
        sock,
        locationData: activeLocation,
        confirmIntent,
        effectiveText,
    };

    // Load live 5-second DB cache (Hissa 3)
    let cache = {};
    try {
        cache = await getCatalogCache();
    } catch (_) {}

    // ── 5b. Update Session Order Details from incoming message ──
    const sessionDetails = getSessionOrderDetails(sessionKey, whatsappPhone);
    const { getRememberedCustomerDetails } = await import('./sessionService.js');
    const rememberedDetails = await getRememberedCustomerDetails(sessionKey, whatsappPhone);

    // If session has no name, but database has customer's remembered profile, pre-fill it!
    if (!sessionDetails.name && rememberedDetails?.name) {
        sessionDetails.name = rememberedDetails.name;
    }
    if (!sessionDetails.address && rememberedDetails?.address) {
        sessionDetails.savedAddress = rememberedDetails.address;
    }
    if (!sessionDetails.phone && (rememberedDetails?.phone || whatsappPhone)) {
        sessionDetails.savedPhone = rememberedDetails.phone || whatsappPhone;
    }

    if (activeLocation) {
        updateSessionOrderDetails(sessionKey, {
            address: activeLocation.formattedAddress || activeLocation.address || 'Google Maps Location Pin',
            location: activeLocation,
        }, whatsappPhone);
    }
    const extracted = extractCustomerDetails(effectiveText, sessionDetails);
    const updatePayload = {};

    if (extracted.name) {
        if (!sessionDetails.name) {
            updatePayload.name = extracted.name;
        } else if (extracted.nameExplicit) {
            const isExplicitRename = /\b(?:badal|change|update|ab\s+(?:mera\s+)?naam|mera\s+naam|my\s+name\s+is|name\s+is)\b/i.test(effectiveText);
            if (isExplicitRename && extracted.name.toLowerCase() !== sessionDetails.name.toLowerCase()) {
                updatePayload.name = extracted.name;
            }
        }
    }
    if (extracted.address && (!sessionDetails.address || extracted.address.toLowerCase() !== sessionDetails.address.toLowerCase())) {
        updatePayload.address = extracted.address;
    }
    if (extracted.paymentMethod && (!sessionDetails.paymentMethod || extracted.paymentMethod !== sessionDetails.paymentMethod)) {
        updatePayload.paymentMethod = extracted.paymentMethod;
    }
    if (extracted.phone && (!sessionDetails.phone || extracted.phone !== sessionDetails.phone || !sessionDetails.phoneConfirmed)) {
        updatePayload.phone = extracted.phone === 'SAME_WHATSAPP' ? (whatsappPhone || '').replace(/\D/g, '') : extracted.phone;
        updatePayload.phoneConfirmed = true;
    }
    // If name is already known and phone is awaiting confirmation, check if affirmative reply
    if (sessionDetails.name && !sessionDetails.phoneConfirmed && !updatePayload.phone) {
        const isAffirmativePhone = /^(?:(?:haan?|g|ji|jee|yes|ok|theek\s*(?:hai|hy)?)\s*)?(?:same|yahi|yehi|yehe|yhe|wahi|isi\s*pe|yahi\s*hai|yehi\s*hai|isi\s*number|yehi\s*number|yahi\s*number|yehe\s*number|same\s*number|same\s*whatsapp|haan|han|hn|ji|jee|g|yes|theek\s*hai|theek\s*hy|ok|done)\s*(?:hi\s*)?(?:number|no|whatsapp|contact)?\s*(?:pe|par|per)?\s*(?:hoga|hogi|rahyga|rahega|rhega|ryga|rahy\s*ga|rahe\s*ga|rakh\s*lo|rakh\s*do|rakho|rakhein|rehn\s*do|rehne\s*do|dedo|de\s*do|likh\s*do|likh\s*lo|daal\s*do|kar\s*do|kr\s*do|karo|kro|bhej\s*do|bhejo|rabta\s*karein|rabta|rider\s*ko\s*de\s*do|rider\s*ko\s*dedo|theek\s*(?:hai|hy)?|hai|he|hy|yar|bhai)?[\s.!?]*$/i.test(effectiveText.trim()) ||
            /\b(?:same|yahi|yehi|yehe|wahi|isi)\s*(?:hi\s*)?(?:number|no|whatsapp)?\s*(?:pe|par|per)?\s*(?:rahyga|rahega|rhega|ryga|rahy\s*ga|rahe\s*ga|hoga|rakh\s*lo|rakh\s*do|rakho|dedo|de\s*do|likh\s*do|likh\s*lo|bhej\s*do)\b/i.test(effectiveText.trim()) ||
            /\b(?:btaya|bola|kaha)\s+to\s+h(?:ai|y)?.*(?:yehe|yehi|same|isi)\s+number\b/i.test(effectiveText.trim());
        if (isAffirmativePhone) {
            updatePayload.phone = (whatsappPhone || '').replace(/\D/g, '');
            updatePayload.phoneConfirmed = true;
        }
    }
    // Lock in phoneConfirmed so that phone confirmation is never asked twice
    if (sessionDetails.phoneConfirmed) {
        updatePayload.phoneConfirmed = true;
    }
    // If name & phone are confirmed and awaiting address (Step 3) or explicit address update provided
    if (sessionDetails.name && sessionDetails.phoneConfirmed && (!sessionDetails.address || extracted.address) && !updatePayload.address && !activeLocation) {
        const candidate = cleanExtractedAddress(effectiveText);
        const isNotAddr = /^(?:menu|deals?|cancel|khatam|band|nahi|no|theek|ok|done|hi|hello|hey|suno|bhai|cod|easypaisa)[\s.!?]*$/i.test(effectiveText.trim());
        if (candidate && candidate.length >= 3 && !isNotAddr && (!sessionDetails.address || candidate.toLowerCase() !== sessionDetails.address.toLowerCase())) {
            updatePayload.address = candidate;
        }
    }
    // If payment method update requested (Step 4 or subsequent modification)
    if (/^(?:cod|cash|cash\s*on\s*delivery|1)[\s.!?]*$/i.test(effectiveText.trim()) || /\b(?:cod|cash\s*on\s*delivery)\b/i.test(effectiveText.toLowerCase())) {
        if (!sessionDetails.paymentMethod || sessionDetails.paymentMethod !== 'COD') {
            updatePayload.paymentMethod = 'COD';
        }
    } else if (/^(?:easypaisa|easy\s*paisa|ep|2)[\s.!?]*$/i.test(effectiveText.trim()) || /\b(?:easypaisa|easy\s*paisa|ep)\b/i.test(effectiveText.toLowerCase())) {
        if (!sessionDetails.paymentMethod || sessionDetails.paymentMethod !== 'EASYPAISA') {
            updatePayload.paymentMethod = 'EASYPAISA';
        }
    }

    if (Object.keys(updatePayload).length > 0) {
        updateSessionOrderDetails(sessionKey, updatePayload, whatsappPhone);
        if (updatePayload.name) {
            updateCustomerNameForChat({
                chatId: jid || sessionKey,
                phone: whatsappPhone,
                customerName: updatePayload.name,
            }).catch(() => {});
        }
    }

    // Load active cart for real-time prompt grounding
    let activeCart = null;
    let activeCartSummary = 'Aap ke cart mein abhi koi item nahi hai.';
    try {
        activeCart = await getActiveCart({ sessionKey, restaurantId: restId, chatId: jid });
        if (activeCart?.items && activeCart.items.length > 0) {
            const totals = await calculateCartTotals({ sessionKey, restaurantId: restId, chatId: jid }).catch(() => null);
            if (totals && totals.items) {
                const lines = totals.items.map(it => {
                    const varStr = it.variantName ? ` (${it.variantName})` : '';
                    const strike = it.hasDiscount ? `~Rs. ${it.originalUnitPrice}~ Rs. ${it.unitPrice}` : `Rs. ${it.unitPrice}`;
                    return `• ${it.quantity}x ${it.name}${varStr} — ${strike} (Line Total: Rs. ${it.lineTotal})`;
                });
                (totals.deals || []).forEach(d => {
                    const fText = d.notes ? ` (${d.notes})` : '';
                    lines.push(`• ${d.quantity}x ${d.name}${fText} — Rs. ${d.lineTotal || d.totalPrice}`);
                });
                let cartText = lines.join('\n');
                if (totals.discountTotal > 0) {
                    cartText += `\nSubtotal: Rs. ${totals.subtotal.toLocaleString('en-PK')}\nDiscount: -Rs. ${totals.discountTotal.toLocaleString('en-PK')}\nTotal: Rs. ${totals.total.toLocaleString('en-PK')}`;
                } else {
                    cartText += `\nSubtotal: Rs. ${totals.subtotal.toLocaleString('en-PK')}`;
                }
                activeCartSummary = cartText;
            } else {
                const lines = activeCart.items.map(i => {
                    const name = i.deal ? i.deal.name : (i.menu_item?.name || 'Item');
                    const v = i.menu_variant ? ` (${i.menu_variant.name})` : '';
                    const unitPrice = Number(i.deal?.deal_price ?? i.menu_variant?.price ?? i.menu_item?.base_price ?? 0);
                    const p = unitPrice * i.quantity;
                    return `• ${i.quantity}x ${name}${v} — Rs. ${p.toLocaleString('en-PK')}`;
                });
                const subtotal = activeCart.items.reduce((s, i) => {
                    const unitPrice = Number(i.deal?.deal_price ?? i.menu_variant?.price ?? i.menu_item?.base_price ?? 0);
                    return s + unitPrice * i.quantity;
                }, 0);
                activeCartSummary = `${lines.join('\n')}\nSubtotal: Rs. ${subtotal.toLocaleString('en-PK')}`;
            }
        }
    } catch (_) {}

    const updatedDetails = getSessionOrderDetails(sessionKey, whatsappPhone);
    const rawCleanPhone = (whatsappPhone || '').replace(/\D/g, '');
    const displayPhone = updatedDetails.phone || (rawCleanPhone.startsWith('923') ? '03' + rawCleanPhone.slice(2) : (rawCleanPhone || '03XXXXXXXXX'));

    let checkoutStepGuidance = '';
    const hasCartItems = activeCart?.items && activeCart.items.length > 0;
    if (hasCartItems) {
        if (!updatedDetails.name) {
            checkoutStepGuidance = `\n\n🚨 SAKHT STEP-BY-STEP CHECKOUT PROTOCOL:
- CURRENT STEP: STEP 1 (CUSTOMER NAME).
- Customer ka cart active hai lekin Naam missing hai.
- Aap ko is turn mein SIRF AUR SIRF Customer ka Naam poochna hai (Maslan: "Order finalize karne ke liye baraye meherbani apna Naam bata dein? 😊").
- SAKHT MANA: Phone number, Delivery address, ya Payment method is message mein BILKUL MAT POOCHEIN! Ek waqt mein sirf ek sawaal!
- SAKHT MANA: Customer ko khud se pichli details bilkul mat batayein aur na hi unka poochein! Sirf step by step naam poochein.`;
        } else if (!updatedDetails.phoneConfirmed) {
            checkoutStepGuidance = `\n\n🚨 SAKHT STEP-BY-STEP CHECKOUT PROTOCOL:
- CURRENT STEP: STEP 2 (CONTACT PHONE).
- Customer ka Naam (${updatedDetails.name}) mil chuka hai.
- Aap ko is turn mein LAZMI rabta phone number confirm karna hai: "Shukriya ${updatedDetails.name}! Rabtay ke liye rider ko yahi WhatsApp number (${displayPhone}) dein ya koi doosra contact number likhna hai? 📞".
- SAKHT MANA: Delivery address ya Payment method is message mein BILKUL MAT POOCHEIN! Phone confirmation ke baghair order aage process BILKUL nahi karna!`;
        } else if (!updatedDetails.address && !activeLocation?.formattedAddress) {
            checkoutStepGuidance = `\n\n🚨 SAKHT STEP-BY-STEP CHECKOUT PROTOCOL:
- CURRENT STEP: STEP 3 (DELIVERY ADDRESS).
- Customer ka Naam aur Contact Phone dono mojood hain.
- Aap ko is turn mein SIRF Delivery Address ya Location Pin poochna hai: "Delivery kahan karni hai ${updatedDetails.name}? Baraye meherbani apna mukammal delivery address (ya WhatsApp location pin) bhej dein 📍".
- SAKHT MANA: Payment method is message mein BILKUL MAT POOCHEIN! Ek waqt mein sirf ek sawaal!`;
        } else if (!updatedDetails.paymentMethod) {
            checkoutStepGuidance = `\n\n🚨 SAKHT STEP-BY-STEP CHECKOUT PROTOCOL:
- CURRENT STEP: STEP 4 (PAYMENT METHOD).
- Customer ka Naam, Phone aur Delivery Address sab mil chuka hai.
- Aap ko is turn mein SIRF Payment Method poochna hai: "Payment method kaunsa pasand karenge ${updatedDetails.name} — Cash on Delivery (COD) ya EasyPaisa? 💵".
- SAKHT MANA: Payment method khud se COD assume mat karein! Customer ki selection ka intezar karein.`;
        } else {
            checkoutStepGuidance = `\n\n🚨 SAKHT STEP-BY-STEP CHECKOUT PROTOCOL:
- CURRENT STEP: STEP 5 (ORDER SUMMARY & CONFIRMATION).
- Chaaron (4) zaroori details (Naam, Phone, Address, Payment Method) mil chuki hain!
- Ab mukammal Order Summary dikhao aur confirmation poochein:
  📋 *ORDER SUMMARY:*
  ${activeCartSummary}
  👤 Customer Name: ${updatedDetails.name}
  📍 Delivery Address: ${updatedDetails.address || activeLocation?.formattedAddress}
  📞 Contact Phone: ${displayPhone}
  💵 Payment Method: ${updatedDetails.paymentMethod === 'COD' ? 'Cash on Delivery (COD)' : 'EasyPaisa'}
  
  "Ji ${updatedDetails.name}, kya iske sath kuch aur add karna chahenge (jaise Extra Drink ya Fries), ya yeh order confirm kar dein?"
- SAKHT MANA: Jab tak customer explicitly "Haan" ya "Confirm" na kahe, 'create_confirmed_order' call MAT karein! Jab customer "Haan" kahe to foran create_confirmed_order call karein.`;
        }
    }

    // Look up customer's live active order in DB (Database Ground Truth)
    let activeOrderSummary = 'Customer ka is waqt koi active order process nahi ho raha.';
    let activePlacedOrder = null;
    try {
        const prisma = getDbClient();
        if (prisma) {
            const orConditions = await getOrderLookupOrConditions(prisma, { sessionKey, chatId, whatsappPhone });
            if (orConditions.length > 0) {
                activePlacedOrder = await prisma.order.findFirst({
                    where: {
                        restaurant_id: restId,
                        OR: orConditions,
                        order_status: { in: ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY'] },
                    },
                    orderBy: { created_at: 'desc' },
                    include: { order_items: true },
                });
                if (activePlacedOrder) {
                    const itms = (activePlacedOrder.order_items || []).map(i => `${i.quantity}x ${i.item_name_snapshot || i.deal_name_snapshot || 'Item'}`).join(', ');
                    activeOrderSummary = `Order #${activePlacedOrder.order_number} | Status: ${activePlacedOrder.order_status} | Items: ${itms || 'Food'} | Total: Rs. ${activePlacedOrder.total}`;
                }
            }
        }
    } catch (_) {}

    const customerDetailsSummary = `Naam: ${updatedDetails.name || 'Not provided'}\nPhone: ${updatedDetails.phoneConfirmed || updatedDetails.phone ? displayPhone : 'Not confirmed'}\nDelivery Address: ${updatedDetails.address || (activeLocation?.formattedAddress || 'Not provided')}\nPayment Method: ${updatedDetails.paymentMethod || 'Not selected'}${checkoutStepGuidance}`;

    // Compute live discount context for AI from cache
    const gDiscount = cache.globalDiscount;
    let cachedDiscountInfo = 'Filhal koi store-wide discount active nahi hai. Menu items standard rates par hain. Customer ko budget deals recommend karein.';
    if (gDiscount && gDiscount.enabled && gDiscount.value > 0) {
        const discValStr = gDiscount.type === 'FIXED' ? `Rs. ${gDiscount.value} OFF` : `${gDiscount.value}% OFF`;
        cachedDiscountInfo = `🔥 LIVE STORE-WIDE DISCOUNT ACTIVE: "${gDiscount.title}" (${discValStr} on all menu items). Har menu item par yeh discount dynamically apply ho raha hai aur cart mein minus hota hai. Agar customer discount ya offer pooche, to unhe yeh discount zaroor batayein aur confirm karein ke yeh tamam items par dastiyab hai!`;
    } else {
        const itemDiscounts = [];
        (cache.rawCategories || []).forEach(c => {
            (c.menu_items || []).forEach(it => {
                if (it.discount_percent > 0) {
                    itemDiscounts.push(`${it.name} (${it.discount_percent}% OFF)`);
                } else if (it.discount_fixed > 0) {
                    itemDiscounts.push(`${it.name} (Rs. ${it.discount_fixed} OFF)`);
                }
            });
        });
        if (itemDiscounts.length > 0) {
            cachedDiscountInfo = `🔥 INDIVIDUAL ITEM DISCOUNTS ACTIVE: In items par discount active hai: ${itemDiscounts.slice(0, 10).join(', ')}. Tamam items par store-wide discount nahi hai lekin in specific items par discount dastiyab hai.`;
        }
    }

    // Build grounded System Prompt (Hissa 6)
    const systemPromptText = buildSystemPrompt({
        whatsappPhone,
        activeOrderSummary,
        storeName: cache.storeName || 'Cravey Crust',
        cachedCategoriesSummary: cache.cachedCategoriesSummary,
        cachedMenuCatalog: cache.cachedMenuCatalog,
        cachedDealsSummary: cache.cachedDealsSummary,
        cachedStoreInfo: cache.cachedStoreInfo,
        cachedFaqs: cache.cachedFaqs,
        cachedDiscountInfo,
        activeCartSummary,
        customerDetailsSummary,
        confirmIntent,
        maxDeliveryRadiusKm: cache.maxDeliveryRadiusKm || 10,
        adminPhone: cache.adminDisplayPhone || cache.adminPhone || '0343-4919319',
        adminWhatsappLink: cache.adminWhatsappLink || 'https://wa.me/923434919319',
    });

    const fullSystemPrompt = systemPromptText
        ? `${systemPromptText}\n\n${TOOLS_SCHEMA}`
        : (TOOLS_SCHEMA || '');

    // Load last 30 messages from sessionService (sessionKey + '-v9-ep' + syncEpoch)
    const history = getSessionHistory(sessionKey, syncEpoch);

    let locationPromptAddon = '';
    if (activeLocation) {
        locationPromptAddon = `\n[Customer ne location pin/link share kiya: lat=${activeLocation.latitude}, lng=${activeLocation.longitude}, address=${activeLocation.address || 'Location Pin'}]`;
    }

    const userTurnContent = effectiveText + locationPromptAddon;

    const messages = [
        { role: 'system', content: fullSystemPrompt },
        ...history,
        { role: 'user', content: userTurnContent },
    ];

    // Run Agent Loop
    const { text: aiRawText, imageUrl: aiImageUrl, imageUrls: aiImageUrls, toolResults, calledToolNames, tokenUsage, providerInfo } = await runAgentLoop(messages, context);

    // ── 7. Post-Verification & Cleanup (Hissa 7) ──
    const verificationOverride = verifyOutput(aiRawText || '', toolResults);
    const candidateText = verificationOverride || aiRawText || '';
    const cleanFinalReply = sanitizeOutput(candidateText);

    // ── 8. Console Logs Exact Token Tracking (Hissa 2) ──
    logAiTokenReply({
        whatsappPhone,
        message: effectiveText,
        provider: providerInfo?.provider || env.AI_PRIMARY_PROVIDER,
        model: providerInfo?.model || env.GEMINI_MODEL,
        keyIndex: providerInfo?.keyIndex ?? 0,
        promptTokens: tokenUsage.promptTokens,
        replyTokens: tokenUsage.replyTokens,
        totalTokens: tokenUsage.totalTokens,
        toolsCalled: calledToolNames,
    });

    // ── 9. Save Turn to Session History ──
    appendSessionHistory(sessionKey, 'user', effectiveText, syncEpoch);
    if (cleanFinalReply) {
        appendSessionHistory(sessionKey, 'assistant', cleanFinalReply, syncEpoch);
    }

    const hasReturnedImages = Boolean(aiImageUrl || (Array.isArray(aiImageUrls) && aiImageUrls.length > 0));
    return hasReturnedImages
        ? {
            text: cleanFinalReply,
            imageUrl: aiImageUrl || (aiImageUrls && aiImageUrls[0]) || null,
            imageUrls: aiImageUrls || (aiImageUrl ? [aiImageUrl] : []),
        }
        : cleanFinalReply;
}

// ─── Per-Chat Sequential Message Processing Queue ───
const _chatMessageQueues = new Map();
const _lastProcessedMessages = new Map(); // jid -> { text, timestamp }

async function _enqueueMessage(jid, params) {
    const prevPromise = _chatMessageQueues.get(jid) || Promise.resolve();

    const currentPromise = prevPromise
        .catch(() => {})
        .then(async () => {
            const reply = await _processMessageInternal(params);
            _lastProcessedMessages.set(jid, {
                text: (params?.text || '').trim(),
                timestamp: Date.now(),
            });
            return reply;
        })
        .finally(() => {
            if (_chatMessageQueues.get(jid) === currentPromise) {
                _chatMessageQueues.delete(jid);
            }
        });

    _chatMessageQueues.set(jid, currentPromise);
    return currentPromise;
}

/**
 * Process incoming message with per-chat sequential queuing and debounce buffering:
 * - Groups rapid split messages (e.g. "Deal kon c hain tmhary oas" + "Pas") into a single prompt.
 * - Suppresses isolated single-word typo corrections sent within 4s of an already answered query.
 */
export async function processMessage(params) {
    const jid = params?.msg?.key?.remoteJid || params?.identity?.chatId || params?.identity?.phone || 'default';
    const text = (params?.text || '').trim();

    // 1. Check if this is an immediate, isolated 1-word typo correction (e.g. "pas", "oas")
    // sent within 4 seconds of a previous question that was already processed
    const lastProcessed = _lastProcessedMessages.get(jid);
    const isSingleWordTypoCorrection = Boolean(text && text.split(/\s+/).length === 1 && text.length <= 5 &&
        /\b(?:pas|oas|ha|han|hn|ji|g|ho|ka|ki|ke|ko|se)\b/i.test(text));
    if (lastProcessed && (Date.now() - lastProcessed.timestamp < 5000) && isSingleWordTypoCorrection) {
        console.log(`[AI] Suppressing isolated rapid typo correction "${text}" from ${jid} (already answered prior message).`);
        return null;
    }

    // Process incoming message immediately without artificial debounce delay
    return _enqueueMessage(jid, params);
}

export default processMessage;
