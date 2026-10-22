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
15. request_order_cancellation(orderNumber: string) — Request order cancellation check.
16. confirm_order_cancellation(orderNumber: string) — Finalize order cancellation.
17. send_alternate_confirmation(phone: string) — Send notification to alternate phone.
18. request_human_handover(reason?: string) — Mute bot for 120 minutes and notify manager.
19. update_order_details(orderNumber?: string, customerName?: string, deliveryAddress?: string, phone?: string, paymentMethod?: string) — Update details (customer name, delivery address, phone, payment method) for an active placed order (PENDING/CONFIRMED/PREPARING).

TOOL CALL FORMAT:
{"tool": "tool_name", "args": {"param": "value"}}

If no tool is needed, respond directly with customer reply text in Roman Urdu.
`;

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
                const quantity = parseInt(args.quantity || 1, 10);
                const notes    = args.notes || undefined;

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
                return { success: true, cartItemId: updated.id, newQuantity: updated.quantity };
            }

            // 11. remove_cart_item
            case 'remove_cart_item': {
                await removeCartItem({ sessionKey, restaurantId: restId, cartItemId: args.cartItemId });
                return { success: true, cartItemId: args.cartItemId };
            }

            // 12. clear_cart
            case 'clear_cart': {
                await clearCartService({ sessionKey, restaurantId: restId });
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

                // ── Strict Validation 4c: Customer Confirmation ──
                if (!context.confirmIntent) {
                    return {
                        error: 'CONFIRMATION_REQUIRED',
                        message: 'Customer ne abhi tak final confirmation nahi di. Pehle customer ko mukammal Order Summary dikhao (Items, Total Bill, Delivery Address, Contact Phone, Payment Method) aur poocho: "Ji, kya iske sath kuch aur add karna chahenge (jaise Extra Drink ya Fries), ya yeh order confirm kar dein?". Jab customer "Haan", "Confirm" ya "Order kar do" kahe, sirf tab order book karein.'
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
                if (!orderNum) {
                    const cart = await getActiveCart({ sessionKey, restaurantId: restId, chatId });
                    if (cart?.items && cart.items.length > 0) {
                        await clearCartService({ sessionKey });
                        try {
                            const { clearSessionOrderDetails } = await import('./sessionService.js');
                            clearSessionOrderDetails(sessionKey, whatsappPhone);
                        } catch (_) {}
                        return { success: true, cartCleared: true, message: 'Cart khali aur pending order cancel kar diya gaya hai.' };
                    }
                    const prisma = getDbClient();
                    if (prisma) {
                        const cleanPhone = (whatsappPhone || '').replace(/\D/g, '');
                        const orConditions = [];
                        if (sessionKey) {
                            orConditions.push({ source_session_id: sessionKey });
                            orConditions.push({ source_chat_id: sessionKey });
                        }
                        if (chatId && chatId !== sessionKey) orConditions.push({ source_chat_id: chatId });
                        if (cleanPhone) {
                            orConditions.push({ phone: cleanPhone });
                            orConditions.push({ whatsapp_phone: cleanPhone });
                        }
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
                        return { error: 'ORDER_NUMBER_REQUIRED', message: 'Order cancel karne ke liye CC-XXXXXX order number dein.' };
                    }
                }
                const prisma = getDbClient();
                if (!prisma) return { error: 'Database unavailable' };
                const order = await prisma.order.findFirst({
                    where: { restaurant_id: restId, order_number: orderNum },
                    select: { id: true, order_number: true, order_status: true },
                });
                if (!order) return { error: 'ORDER_NOT_FOUND', message: 'Order nahi mila.' };
                if (!['PENDING', 'CONFIRMED', 'PREPARING'].includes(order.order_status)) {
                    return { error: 'ORDER_NOT_CANCELLABLE', status: order.order_status, message: 'Is waqt yeh order cancel nahi ho sakta.' };
                }
                return { canCancel: true, orderNumber: order.order_number, status: order.order_status };
            }

            // 16. confirm_order_cancellation
            case 'confirm_order_cancellation': {
                const { cancelOrder } = await import('./orderService.js');
                let orderNum = (args.orderNumber || '').toUpperCase().trim();
                if (!orderNum) {
                    const prisma = getDbClient();
                    if (prisma) {
                        const cleanPhone = (whatsappPhone || '').replace(/\D/g, '');
                        const orConditions = [];
                        if (sessionKey) {
                            orConditions.push({ source_session_id: sessionKey });
                            orConditions.push({ source_chat_id: sessionKey });
                        }
                        if (chatId && chatId !== sessionKey) orConditions.push({ source_chat_id: chatId });
                        if (cleanPhone) {
                            orConditions.push({ phone: cleanPhone });
                            orConditions.push({ whatsapp_phone: cleanPhone });
                        }
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
                }
                if (!orderNum) {
                    return { error: 'ORDER_NUMBER_REQUIRED', message: 'Cancel karne ke liye order number zaroori hai.' };
                }
                const result = await cancelOrder({
                    restaurantId: restId,
                    orderNumber: orderNum,
                    reason: 'Customer requested order cancellation',
                });
                if (result?.success) {
                    try {
                        const { rememberCustomerDetails, clearSessionOrderDetails } = await import('./sessionService.js');
                        const prisma = getDbClient();
                        const cleanPhone = (whatsappPhone || '').replace(/\D/g, '');
                        if (prisma) {
                            const ord = await prisma.order.findFirst({
                                where: { restaurant_id: restId, order_number: orderNum },
                            });
                            if (ord) {
                                rememberCustomerDetails(sessionKey, {
                                    name: ord.customer_name,
                                    phone: ord.phone,
                                    address: ord.delivery_address,
                                    areaName: ord.delivery_area_name,
                                    googleMapsUrl: ord.google_maps_url,
                                    paymentMethod: ord.payment_method,
                                }, cleanPhone);
                            }
                        }
                        clearSessionOrderDetails(sessionKey, cleanPhone);
                    } catch (_) {}
                }
                return result;
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
                        const cleanPhone = (whatsappPhone || '').replace(/\D/g, '');
                        const orConditions = [];
                        if (sessionKey) {
                            orConditions.push({ source_session_id: sessionKey });
                            orConditions.push({ source_chat_id: sessionKey });
                        }
                        if (chatId && chatId !== sessionKey) orConditions.push({ source_chat_id: chatId });
                        if (cleanPhone) {
                            orConditions.push({ phone: cleanPhone });
                            orConditions.push({ whatsapp_phone: cleanPhone });
                        }
                        const recent = orConditions.length > 0 ? await prisma.order.findFirst({
                            where: {
                                restaurant_id: restId,
                                OR: orConditions,
                                order_status: { in: ['PENDING', 'CONFIRMED', 'PREPARING'] },
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
    // 1. Remove all internal IDs (menuItemId, variantId, dealId, cartItemId, id)
    let clean = text.replace(/\[\s*(?:menuItemId|variantId|dealId|cartItemId|id)\s*:[^\]]+\]/gi, '');
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
    const claimsOrderPlaced = /(kamyabi se confirm|confirm ho gaya|place ho gaya|order book ho gaya|order confirm ho chuka)/i.test(aiText);
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
                if (ordRes && ordRes.text) {
                    return {
                        text: ordRes.text,
                        imageUrl: ordRes.imageUrl || null,
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

        // Parse tool call from response
        let toolCall = null;
        try {
            const jsonMatch = aiResponse.match(/\{[\s\S]*"tool"[\s\S]*\}/);
            if (jsonMatch) {
                toolCall = JSON.parse(jsonMatch[0]);
            }
        } catch (_) {}

        if (toolCall && toolCall.tool) {
            calledToolNames.push(toolCall.tool);
            console.log(`[AGENT] Executing local tool: ${toolCall.tool}`, JSON.stringify(toolCall.args || {}).slice(0, 100));

            const result = await executeTool(toolCall.tool, toolCall.args || {}, context);
            allToolResults.push(result);

            messages.push({ role: 'assistant', content: aiResponse });
            messages.push({
                role: 'user',
                content: `Tool result for ${toolCall.tool}:\n${JSON.stringify(result, null, 2)}\n\nAb customer ko Roman Urdu mein polite jawab dein. Agar order confirm ho chuka hai to asli CC-XXXXXX order number customer ko batayein.`,
            });
            continue; // Next round
        }

        // No tool call — final answer reached
        let aiImageUrl = null;
        if (calledToolNames.includes('get_menu_categories')) {
            aiImageUrl = 'assets/menu/cravey_crust_main_menu.png';
        } else if (calledToolNames.includes('get_current_deals')) {
            aiImageUrl = 'assets/menu/cravey_crust_deals_menu.png';
        }

        return {
            text: aiResponse,
            imageUrl: aiImageUrl,
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

// ─── Main Entry Point: processMessage ─────────────────────────────────────
/**
 * Process an incoming WhatsApp message through the standalone AI Agent.
 *
 * @param {Object} params
 * @param {Object} params.sock              Baileys socket
 * @param {Object} params.msg               Raw Baileys message
 * @param {Object} params.session           WhatsAppSession instance
 * @param {string} params.text              Extracted message text
 * @param {Object} params.identity          resolveSenderIdentity() result
 * @param {Object} [params.locationData]    extractLocation() result
 * @returns {Promise<string>}               Reply text to send back to customer
 */
export async function processMessage({ sock, msg, session, text, identity, locationData }) {
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

        if (fastResult.handled && fastResult.reply) {
            const cleanFastReply = sanitizeOutput(fastResult.reply);

            // Log zero tokens used (Hissa 2)
            logZeroTokenReply({
                whatsappPhone,
                message: effectiveText,
                routeName: fastResult.routeName || 'Local Command/Cache',
            });

            // Update session history
            appendSessionHistory(sessionKey, 'user', effectiveText, syncEpoch);
            appendSessionHistory(sessionKey, 'assistant', cleanFastReply, syncEpoch);

            return fastResult.imageUrl ? { text: cleanFastReply, imageUrl: fastResult.imageUrl } : cleanFastReply;
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
    const { getRememberedCustomerDetails, rememberCustomerDetails } = await import('./sessionService.js');
    const rememberedDetails = await getRememberedCustomerDetails(sessionKey, whatsappPhone);

    if (activeLocation) {
        updateSessionOrderDetails(sessionKey, {
            address: activeLocation.formattedAddress || activeLocation.address || 'Google Maps Location Pin',
            location: activeLocation,
        }, whatsappPhone);
    }
    const extracted = extractCustomerDetails(effectiveText, sessionDetails);
    const updatePayload = {};

    // Check if customer affirms previous/remembered order details (Re-order Confirmation)
    const isAffirmativeForRemembered =
        /^(?:haan?|han|ji|jee|yes|y|theek\s*(?:hai|hy)?|ok|okay|done|sure|confirm|bilkul|same|yehi|yahi|wahi)[\s!.?]*$/i.test(effectiveText.trim()) ||
        /\b(?:same|yehi|yahi|wahi)\s*(?:details?|rakho|rahygi|rahegi|hogi|hoga|pe|par|kardo|kar\s*do)?\b/i.test(effectiveText.toLowerCase()) ||
        /\b(?:pichli|purani)\s*(?:details?|address|number)?\s*(?:pe|par|hi|theek|sahi)\b/i.test(effectiveText.toLowerCase()) ||
        /\b(?:confirm\s*(?:kr|kar)?\s*d[ou]|order\s*confirm|order\s*book\s*kar\s*do|order\s*kardo)\b/i.test(effectiveText.toLowerCase());

    if (isAffirmativeForRemembered && rememberedDetails?.name && rememberedDetails?.address && (!sessionDetails.name || !sessionDetails.address)) {
        updatePayload.name = rememberedDetails.name;
        updatePayload.phone = rememberedDetails.phone || (whatsappPhone || '').replace(/\D/g, '');
        updatePayload.phoneConfirmed = true;
        updatePayload.address = rememberedDetails.address;
        updatePayload.paymentMethod = rememberedDetails.paymentMethod || 'COD';
        updatePayload.previousDetailsConfirmed = true;
        context.confirmIntent = true;
    }

    if (extracted.name && (!sessionDetails.name || extracted.nameExplicit || (extracted.name.toLowerCase() !== sessionDetails.name.toLowerCase() && !sessionDetails.name))) {
        updatePayload.name = extracted.name;
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
        const isAffirmativePhone = /^(?:(?:haan?|ji|jee|yes|ok|theek\s*(?:hai|hy)?)\s*)?(?:same|yahi|yehi|wahi|isi\s*pe|yahi\s*hai|yehi\s*hai|isi\s*number|yehi\s*number|yahi\s*number|same\s*number|same\s*whatsapp|haan|han|ji|jee|yes|theek\s*hai|theek\s*hy|ok|done)\s*(?:hi\s*)?(?:number|no|whatsapp|contact)?\s*(?:hoga|hogi|rahyga|rahega|rhega|ryga|rahy\s*ga|rahe\s*ga|rakho|rakhein|rehne\s*do|theek\s*(?:hai|hy)?|hai|he|hy)?[\s.!?]*$/i.test(effectiveText.trim()) ||
            /\b(?:same|yahi|yehi|wahi|isi)\s*(?:hi\s*)?(?:number|no|whatsapp)?\s*(?:rahyga|rahega|rhega|ryga|rahy\s*ga|rahe\s*ga|hoga|rakho)\b/i.test(effectiveText.trim());
        if (isAffirmativePhone) {
            updatePayload.phone = (whatsappPhone || '').replace(/\D/g, '');
            updatePayload.phoneConfirmed = true;
        }
    }
    // Lock in phoneConfirmed so that phone confirmation is never asked twice
    if (sessionDetails.phoneConfirmed || sessionDetails.phone) {
        updatePayload.phoneConfirmed = true;
    }
    // If name & phone are confirmed and awaiting address (Step 3) or explicit address update provided
    if (sessionDetails.name && (sessionDetails.phoneConfirmed || sessionDetails.phone) && (!sessionDetails.address || extracted.address) && !updatePayload.address && !activeLocation) {
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
                    lines.push(`• ${d.quantity}x ${d.name} — Rs. ${d.lineTotal || d.totalPrice}`);
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
        if (rememberedDetails?.name && rememberedDetails?.address && !updatedDetails.previousDetailsConfirmed && (!updatedDetails.name || !updatedDetails.address)) {
            const remName = rememberedDetails.name;
            const remPhone = rememberedDetails.phone || displayPhone;
            const remAddress = rememberedDetails.address;
            const remPayment = rememberedDetails.paymentMethod === 'EASYPAISA' ? 'EasyPaisa' : 'Cash on Delivery (COD)';

            checkoutStepGuidance = `\n\n🚨 RE-ORDER CHECKOUT PROTOCOL (PICHLI DETAILS CONFIRMATION):
- Customer ka cart active hai aur pichli order details hamare pas pehle se mojood hain:
  👤 Naam: ${remName}
  📞 Contact Phone: ${remPhone}
  📍 Delivery Address: ${remAddress}
  💵 Payment Method: ${remPayment}
- 🚨 SAKHT HIDAYAT: Customer se dobaara naye siray se Naam, Phone ya Address ALAG ALAG MAT POOCHEIN!
- Is turn mein customer ko cart items aur total batayein, aur pichli details confirm karne ka poochein:
  "Aap ka item cart mein add ho gaya hai! 🎉

  📋 *Pichli Delivery Details:*
  👤 Naam: ${remName}
  📞 Phone: ${remPhone}
  📍 Address: ${remAddress}
  💵 Payment: ${remPayment}

  Kya aap ka yeh order inhi pichli details par confirm kar dein? (Haan / Nahi)"
- Agar customer "Haan", "Yes", "Same", "Yehi rahyga", "Confirm" kahe, to FORAN 'create_confirmed_order' tool call karke order book karein (customerName: "${remName}", phone: "${remPhone}", deliveryAddress: "${remAddress}", paymentMethod: "${rememberedDetails.paymentMethod || 'COD'}").
- Agar customer koi detail badalna chahe (maslan "address yeh hai" ya "naam badal do"), to naye address/naam ke sath update karein.`;
        } else if (!updatedDetails.name) {
            checkoutStepGuidance = `\n\n🚨 SAKHT STEP-BY-STEP CHECKOUT PROTOCOL:
- CURRENT STEP: STEP 1 (CUSTOMER NAME).
- Customer ka cart active hai lekin Naam missing hai.
- Aap ko is turn mein SIRF AUR SIRF Customer ka Naam poochna hai (Maslan: "Order finalize karne ke liye baraye meherbani apna Naam bata dein? 😊").
- SAKHT MANA: Phone number, Delivery address, ya Payment method is message mein BILKUL MAT POOCHEIN! Ek waqt mein sirf ek sawaal!`;
        } else if (!updatedDetails.phoneConfirmed && !updatedDetails.phone) {
            checkoutStepGuidance = `\n\n🚨 SAKHT STEP-BY-STEP CHECKOUT PROTOCOL:
- CURRENT STEP: STEP 2 (CONTACT PHONE).
- Customer ka Naam (${updatedDetails.name}) mil chuka hai.
- Aap ko is turn mein SIRF rabta phone number confirm karna hai: "Shukriya ${updatedDetails.name}! Rabtay ke liye rider ko yahi WhatsApp number (${displayPhone}) dein ya koi doosra contact number likhna hai?".
- SAKHT MANA: Delivery address ya Payment method is message mein BILKUL MAT POOCHEIN! Ek waqt mein sirf ek sawaal!`;
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
    });

    const fullSystemPrompt = systemPromptText
        ? `${systemPromptText}\n\n${TOOLS_SCHEMA}`
        : (TOOLS_SCHEMA || '');

    // Load last 10 messages from sessionService (sessionKey + '-v9-ep' + syncEpoch)
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
    const { text: aiRawText, imageUrl: aiImageUrl, toolResults, calledToolNames, tokenUsage, providerInfo } = await runAgentLoop(messages, context);

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
    appendSessionHistory(sessionKey, 'assistant', cleanFinalReply, syncEpoch);

    return aiImageUrl ? { text: cleanFinalReply, imageUrl: aiImageUrl } : cleanFinalReply;
}

export default processMessage;
