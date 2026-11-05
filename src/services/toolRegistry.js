/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║   Authoritative Tool Registry — src/services/toolRegistry.js ║
 * ║   Deterministic Backend Functions for AI Tool Execution     ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Core Principle:
 *   AI UNDERSTANDS & PLANS ACTIONS.
 *   BACKEND EXECUTES AUTHORITATIVELY AGAINST DB & VALIDATES.
 *   AI RESPONDS GROUNDED IN REAL EXECUTION RESULTS.
 */

import { getCatalogCache } from './catalogCacheService.js';
import { resolveMenuItemOrDeal, getActiveDeals } from './menuService.js';
import { addItemToCart, getActiveCart, calculateCartTotals } from './cartService.js';
import { resolveCartItemForRemoval, executeCartItemRemoval } from './cartItemResolver.js';
import { getSessionOrderDetails, updateSessionOrderDetails, markMenuSent, markDealsSent } from './sessionService.js';
import { checkDeliveryAvailability } from './deliveryService.js';
import { createOrder } from './orderService.js';
import { getDbClient } from '../db/client.js';
import { getDefaultRestaurantId } from './restaurantService.js';
import { RESPONSE_TEMPLATES } from './responseTemplates.js';
import {
    isPizzaDeal,
    getDealPizzaInfo,
    extractFlavoursFromText,
    formatDealFlavourPrompt,
    formatSingleFlavourConfirmationPrompt,
    setPendingDealFlavour,
    clearPendingDealFlavour,
} from './dealFlavourService.js';
import { matchVariant } from './cartService.js';

/**
 * 1. get_menu({ category?: string })
 * Retrieves authoritative menu image URLs, categories, and items.
 */
export async function get_menu(args = {}, context = {}) {
    const { sessionKey, whatsappPhone, sock, chatId } = context;
    const cache = await getCatalogCache();
    const cleanPhone = (whatsappPhone || '').replace(/\D/g, '');
    if (sessionKey) markMenuSent(sessionKey, cleanPhone);

    const targetMenuImages = (Array.isArray(cache.menuImageUrls) && cache.menuImageUrls.length > 0)
        ? cache.menuImageUrls
        : (cache.menuImageUrl ? [cache.menuImageUrl] : ['assets/menu/cravey_crust_main_menu.png']);

    const category = args.category?.toLowerCase()?.trim();
    let categoryText = null;

    if (category) {
        const cats = cache.rawCategories || [];
        const matchedCat = cats.find(c => c.name.toLowerCase().includes(category) || c.slug.toLowerCase().includes(category));
        if (matchedCat) {
            const items = matchedCat.menu_items || [];
            const itemLines = items.map(it => {
                const desc = it.description ? `\n   _${it.description}_` : '';
                return `• *${it.name}*: from Rs. ${Number(it.base_price)}${desc}`;
            });
            categoryText = `*${matchedCat.name.toUpperCase()}*\n━━━━━━━━━━━━━━━━━━━━━\n\n${itemLines.join('\n')}\n\nOrder karne ke liye item ka naam bata dein! 😊`;
        }
    }

    const caption = categoryText || 'Cravey Crust ka menu haazir hai! 🍕🍔\n\nBataiye in mein se kya mangwana pasand karenge? 😊';

    return {
        success: true,
        type: 'MENU',
        caption,
        imageUrl: targetMenuImages[0] || null,
        imageUrls: targetMenuImages,
    };
}

/**
 * 2. get_deals({ dealType?: 'all' | 'burger' | 'pizza' })
 * Retrieves authoritative live deals from DB with exact prices and items.
 */
export async function get_deals(args = {}, context = {}) {
    const { sessionKey, whatsappPhone, sock, chatId } = context;
    const cache = await getCatalogCache();
    const cleanPhone = (whatsappPhone || '').replace(/\D/g, '');
    if (sessionKey) markDealsSent(sessionKey, cleanPhone);

    const targetDealsImages = (Array.isArray(cache.dealsImageUrls) && cache.dealsImageUrls.length > 0)
        ? cache.dealsImageUrls
        : (cache.dealsImageUrl ? [cache.dealsImageUrl] : [
            'assets/menu/cravey_crust_deals_menu.png',
            'assets/menu/cravey_crust_cravey20_deals.png'
        ]);

    const rawDeals = Array.isArray(cache.rawDeals)
        ? cache.rawDeals.filter(d => d.is_active !== false)
        : [];

    const dealsSummary = rawDeals.slice(0, 8).map(d => {
        return `• *${d.name}* — Rs. ${Number(d.deal_price)}`;
    }).join('\n');

    const caption = 'Cravey Crust ki taraf se mazedaar deals haazir hain! 🍕🔥\n\nIn mein se kaunsi deal aap ke liye cart mein add karun? 😊';

    return {
        success: true,
        type: 'DEALS',
        caption,
        dealsCount: rawDeals.length,
        dealsSummary,
        imageUrl: targetDealsImages[0] || null,
        imageUrls: targetDealsImages,
    };
}

/**
 * 3. get_deal_details({ dealName?: string, dealId?: string })
 * Authoritatively retrieves configuration of a specific deal (included items, drink size).
 * NEVER mutates cart!
 */
export async function get_deal_details(args = {}, context = {}) {
    const restId = context.restId || await getDefaultRestaurantId().catch(() => 'default');
    const query = args.dealName || args.dealId || '';
    const resolved = await resolveMenuItemOrDeal(query, restId);

    if (resolved && (resolved.type === 'DEAL' || resolved.deal)) {
        const deal = resolved.deal;
        const dealItems = deal.deal_items || [];
        const itemsList = dealItems.map(di => {
            const qty = di.quantity > 1 ? `${di.quantity}x ` : '1x ';
            const name = di.menu_item?.name || 'Item';
            return `${qty}${name}`;
        });

        const drinkItem = dealItems.find(di => /drink|pepsi|coke|beverage/i.test(di.menu_item?.name || ''));
        const hasDrink = Boolean(drinkItem || /drink|litre|liter|pepsi|coke/i.test(deal.description || ''));
        const drinkDescription = drinkItem
            ? `${drinkItem.quantity || 1}x ${drinkItem.menu_item?.name}`
            : (hasDrink ? 'Chilled Soft Drink (1 Litre)' : 'No drink included');

        const detailsText = `Ji bilkul! *${deal.name}* (Rs. ${Number(deal.deal_price)}) mein yeh shamil hai:\n\n` +
            (itemsList.length > 0 ? itemsList.map(it => `• ${it}`).join('\n') : `• ${deal.description || 'Mazedaar Cravey Crust items'}`) +
            `\n\nKya aap yeh deal cart mein add karwana chahenge? 😊`;

        return {
            success: true,
            found: true,
            dealName: deal.name,
            price: Number(deal.deal_price),
            description: deal.description,
            items: itemsList,
            hasDrink,
            drinkDescription,
            reply: detailsText,
        };
    }

    return {
        success: false,
        found: false,
        dealName: query,
        reply: `Maazrat! *"${query}"* naam ki deal hamare system mein nahi mili. Hamari active deals dekhne ke liye "deals" likhein! 😊`,
    };
}

/**
 * 4. get_product_details({ query?: string, queryType?: 'cheapest' | 'best' | 'zinger' | 'burger' | 'pizza' })
 * Retrieves authoritative menu options, lowest price items, best items, or flavour lists.
 */
export async function get_product_details(args = {}, context = {}) {
    const queryType = args.queryType?.toLowerCase();
    const query = args.query?.toLowerCase() || '';

    if (queryType === 'cheapest' || /\b(?:lowest|cheapest|sasti|kam\s*rate|low\s*price)\b/i.test(query)) {
        return {
            success: true,
            type: 'CHEAPEST_ITEMS',
            reply: RESPONSE_TEMPLATES.cheapestItemsList(),
        };
    }
    if (queryType === 'best' || /\b(?:best|mashhoor|top|favorite|sab\s*se\s*acha)\b/i.test(query)) {
        return {
            success: true,
            type: 'BEST_ITEMS',
            reply: RESPONSE_TEMPLATES.bestItemsList(),
        };
    }
    if (queryType === 'zinger' || /\b(?:zinger|zingr)\b/i.test(query)) {
        return {
            success: true,
            type: 'ZINGER_OPTIONS',
            reply: RESPONSE_TEMPLATES.zingerOptionsList(),
        };
    }
    if (queryType === 'burger' || /\b(?:burger|burgers)\b/i.test(query)) {
        return {
            success: true,
            type: 'BURGER_OPTIONS',
            reply: RESPONSE_TEMPLATES.burgerOptionsList(),
        };
    }
    if (queryType === 'pizza' || /\b(?:pizza|pizzas)\b/i.test(query)) {
        return {
            success: true,
            type: 'PIZZA_FLAVOURS',
            reply: RESPONSE_TEMPLATES.pizzaFlavoursList(),
        };
    }

    return {
        success: true,
        type: 'GENERAL_MENU',
        reply: RESPONSE_TEMPLATES.greeting({ storeName: 'Cravey Crust' }),
    };
}

/**
 * 5. add_to_cart({ itemName: string, quantity?: number, size?: string, flavours?: string[] })
 * Authoritatively validates against DB and adds to active cart.
 */
export async function add_to_cart(args = {}, context = {}) {
    const { sessionKey, whatsappPhone, chatId, restId: ctxRestId } = context;
    const restId = ctxRestId || await getDefaultRestaurantId().catch(() => 'default');
    const itemName = args.itemName || '';
    const quantity = Math.max(1, parseInt(args.quantity, 10) || 1);

    const resolved = await resolveMenuItemOrDeal(itemName, restId);
    const isDeal = resolved && (resolved.type === 'DEAL' || resolved.type === 'deal' || Boolean(resolved.deal));
    const isItem = resolved && (resolved.type === 'ITEM' || resolved.type === 'item' || resolved.type === 'MENU_ITEM' || resolved.type === 'menu_item' || Boolean(resolved.item));

    if (isDeal) {
        const dealObj = resolved.deal;
        if (isPizzaDeal(dealObj)) {
            const pizzaInfo = getDealPizzaInfo(dealObj);
            const extractedFlavours = args.flavours || extractFlavoursFromText(itemName, pizzaInfo.pizzaCount);
            if (extractedFlavours.length < pizzaInfo.pizzaCount) {
                setPendingDealFlavour(sessionKey, {
                    deal: dealObj,
                    quantity,
                    pizzaInfo,
                    firstFlavour: extractedFlavours[0] || null,
                });
                let flavourPrompt = '';
                if (extractedFlavours.length === 0) {
                    flavourPrompt = formatDealFlavourPrompt(dealObj, pizzaInfo);
                } else {
                    flavourPrompt = formatSingleFlavourConfirmationPrompt(extractedFlavours[0], pizzaInfo);
                }
                return {
                    success: true,
                    requiresFlavourSelection: true,
                    dealName: dealObj.name,
                    reply: flavourPrompt,
                };
            }
        }

        await addItemToCart({
            sessionKey,
            restaurantId: restId,
            chatId,
            verifiedPhone: whatsappPhone,
            dealId: dealObj.id,
            quantity,
        });

        const nextPrompt = 'Kya aap iske sath kuch aur order karna chahenge (jaise Fries ya Cold Drink), ya order finalize karein? 😊';
        return {
            success: true,
            itemName: dealObj.name,
            quantity,
            price: Number(dealObj.deal_price),
            reply: RESPONSE_TEMPLATES.itemAdded({
                itemName: dealObj.name,
                quantity,
                price: Number(dealObj.deal_price),
                nextStepPrompt: nextPrompt,
            }),
        };
    }

    if (isItem) {
        const itemObj = resolved.item;
        let chosenVariant = null;
        if ((itemObj.variants || []).length > 0) {
            chosenVariant = matchVariant(itemObj.variants, args.size || itemName) || itemObj.variants[0];
        }

        await addItemToCart({
            sessionKey,
            restaurantId: restId,
            chatId,
            verifiedPhone: whatsappPhone,
            menuItemId: itemObj.id,
            variantId: chosenVariant?.id,
            quantity,
        });

        const nextPrompt = 'Kya aap iske sath kuch aur order karna chahenge (jaise Fries ya Cold Drink), ya order finalize karein? 😊';
        return {
            success: true,
            itemName: itemObj.name,
            quantity,
            size: chosenVariant?.name,
            price: Number(chosenVariant?.price || itemObj.base_price),
            reply: RESPONSE_TEMPLATES.itemAdded({
                itemName: itemObj.name,
                quantity,
                size: chosenVariant?.name,
                price: Number(chosenVariant?.price || itemObj.base_price),
                nextStepPrompt: nextPrompt,
            }),
        };
    }

    // Item not found in menu
    let cleanItemName = (itemName || '').replace(/\b(?:chiye|chahiye|mangwana|daal\s*do|add|kardo|krdo|mujay|mujhe|me|kar\s*do|bhai|yar|please|plz)\b/gi, '').trim();
    cleanItemName = cleanItemName.replace(/^(?:aik|ek|ik|1|2|3|4|5|one|two|do|teen)\s*(?:x\s+)?/i, '').trim();
    if (!cleanItemName) cleanItemName = itemName;

    return {
        success: false,
        notFound: true,
        itemName: cleanItemName,
        reply: RESPONSE_TEMPLATES.itemNotInMenu({ itemName: cleanItemName }),
    };
}

/**
 * 6. remove_from_cart({ itemName: string, quantity?: number })
 * Authoritatively locates item in active cart and executes removal.
 */
export async function remove_from_cart(args = {}, context = {}) {
    const { sessionKey, chatId, restId: ctxRestId } = context;
    const restId = ctxRestId || await getDefaultRestaurantId().catch(() => 'default');
    const activeCart = await getActiveCart({ sessionKey, restaurantId: restId, chatId });

    if (!activeCart?.items || activeCart.items.length === 0) {
        return {
            success: false,
            emptyCart: true,
            reply: RESPONSE_TEMPLATES.emptyCartConfirmGuard(),
        };
    }

    const resolution = resolveCartItemForRemoval({
        messageText: args.itemName || '',
        activeCart,
    });

    if (resolution.status === 'MATCH_FOUND') {
        const removalResult = await executeCartItemRemoval({
            cart: activeCart,
            match: resolution,
            sessionKey,
            restaurantId: restId,
        });

        const freshTotals = await calculateCartTotals({ sessionKey, restaurantId: restId });
        return {
            success: true,
            itemName: removalResult.itemName,
            newQuantity: removalResult.newQuantity,
            updatedTotal: freshTotals.total,
            reply: RESPONSE_TEMPLATES.itemRemoved({
                itemName: removalResult.itemName,
                updatedTotal: freshTotals.total,
            }),
        };
    }

    if (resolution.status === 'CLARIFICATION_NEEDED') {
        return {
            success: false,
            clarificationNeeded: true,
            reply: resolution.clarificationMessage,
        };
    }

    return {
        success: false,
        itemNotFoundInCart: true,
        reply: RESPONSE_TEMPLATES.itemNotFoundInCart({ targetItem: args.itemName || 'item' }),
    };
}

/**
 * 7. get_cart()
 * Retrieves current active cart lines and totals.
 */
export async function get_cart(args = {}, context = {}) {
    const { sessionKey, chatId, restId: ctxRestId } = context;
    const restId = ctxRestId || await getDefaultRestaurantId().catch(() => 'default');
    const activeCart = await getActiveCart({ sessionKey, restaurantId: restId, chatId });

    if (!activeCart?.items || activeCart.items.length === 0) {
        return {
            success: true,
            hasItems: false,
            reply: 'Aap ka cart is waqt khali hai. Kuch mazedaar order karne ke liye "menu" ya "deals" likhein! 😊',
        };
    }

    const freshTotals = await calculateCartTotals({ sessionKey, restaurantId: restId });
    const cartLines = (activeCart.items || []).map(i => {
        const title = i.deal ? i.deal.name : (i.menu_item?.name || 'Item');
        const sizeStr = i.variant?.name ? ` (${i.variant.name})` : '';
        const price = Number(i.unit_price || 0) * i.quantity;
        return `• ${i.quantity}x ${title}${sizeStr} — Rs. ${price.toLocaleString('en-PK')}`;
    }).join('\n');

    return {
        success: true,
        hasItems: true,
        itemsCount: activeCart.items.length,
        subtotal: freshTotals.subtotal,
        deliveryFee: freshTotals.deliveryFee,
        total: freshTotals.total,
        cartLines,
        reply: RESPONSE_TEMPLATES.cartSummary({
            cartLines,
            subtotal: freshTotals.subtotal,
            deliveryFee: freshTotals.deliveryFee,
            total: freshTotals.total,
        }),
    };
}

/**
 * 8. update_customer_details({ name?: string, phone?: string, address?: string, paymentMethod?: string })
 * Updates specific customer fields safely.
 */
export async function update_customer_details(args = {}, context = {}) {
    const { sessionKey, whatsappPhone } = context;
    const details = getSessionOrderDetails(sessionKey, whatsappPhone);
    const updatePayload = {};

    if (args.name && args.name.trim().length >= 2) {
        updatePayload.name = args.name.trim();
        updatePayload.nameExplicit = true;
    }
    if (args.phone) {
        updatePayload.phone = args.phone.replace(/\D/g, '');
        updatePayload.phoneConfirmed = true;
    }
    if (args.address && args.address.trim().length >= 3) {
        updatePayload.address = args.address.trim();
    }
    if (args.paymentMethod) {
        const pm = /easy|ep/i.test(args.paymentMethod) ? 'EASYPAISA' : 'COD';
        updatePayload.paymentMethod = pm;
    }

    updateSessionOrderDetails(sessionKey, updatePayload, whatsappPhone);
    return {
        success: true,
        updatedFields: Object.keys(updatePayload),
        currentDetails: { ...details, ...updatePayload },
    };
}

/**
 * 9. validate_delivery_location({ address: string })
 * Verifies address availability and radius.
 */
export async function validate_delivery_location(args = {}, context = {}) {
    const restId = context.restId || await getDefaultRestaurantId().catch(() => 'default');
    const address = args.address || '';
    const check = await checkDeliveryAvailability({ address, restaurantId: restId });

    if (!check.available && check.code === 'ADDRESS_INCOMPLETE') {
        return {
            success: false,
            code: 'ADDRESS_INCOMPLETE',
            locality: check.areaName || address,
            reply: RESPONSE_TEMPLATES.addressIncomplete({ locality: check.areaName || address }),
        };
    }
    if (!check.available) {
        return {
            success: false,
            code: 'OUT_OF_RANGE',
            maxRadiusKm: check.maxRadiusKm,
            distanceKm: check.distanceKm,
            reply: RESPONSE_TEMPLATES.addressOutOfRange({ maxRadiusKm: check.maxRadiusKm, distanceKm: check.distanceKm }),
        };
    }

    return {
        success: true,
        available: true,
        distanceKm: check.distanceKm,
        locality: check.areaName || address,
    };
}

/**
 * 10. confirm_order()
 * Atomically validates cart, checks required details, and creates order in DB.
 */
export async function confirm_order(args = {}, context = {}) {
    const { sessionKey, whatsappPhone, sock } = context;
    const restId = context.restId || await getDefaultRestaurantId().catch(() => 'default');
    const sessionDetails = getSessionOrderDetails(sessionKey, whatsappPhone);
    const activeCart = await getActiveCart({ sessionKey, restaurantId: restId });

    if (!activeCart?.items || activeCart.items.length === 0) {
        return {
            success: false,
            reason: 'EMPTY_CART',
            reply: RESPONSE_TEMPLATES.emptyCartConfirmGuard(),
        };
    }
    if (!sessionDetails.name) {
        return {
            success: false,
            reason: 'MISSING_NAME',
            reply: RESPONSE_TEMPLATES.namePrompt(),
        };
    }
    if (!sessionDetails.phone) {
        return {
            success: false,
            reason: 'MISSING_PHONE',
            reply: RESPONSE_TEMPLATES.phonePrompt({ name: sessionDetails.name, displayPhone: whatsappPhone }),
        };
    }
    if (!sessionDetails.address) {
        return {
            success: false,
            reason: 'MISSING_ADDRESS',
            reply: RESPONSE_TEMPLATES.addressPrompt({ name: sessionDetails.name }),
        };
    }
    if (!sessionDetails.paymentMethod) {
        return {
            success: false,
            reason: 'MISSING_PAYMENT',
            reply: RESPONSE_TEMPLATES.paymentPrompt({ name: sessionDetails.name }),
        };
    }

    const bookingResult = await createOrder({
        restaurantId: restId,
        sessionKey,
        customerName: sessionDetails.name,
        phone: sessionDetails.phone,
        delivery: { address: sessionDetails.address },
        paymentMethod: sessionDetails.paymentMethod,
        sock,
    });

    if (bookingResult && bookingResult.success && bookingResult.order) {
        updateSessionOrderDetails(sessionKey, {
            orderConfirmed: true,
            lastOrderNumber: bookingResult.order.orderNumber,
            summaryShown: false,
            extraItemsAnswered: false,
        }, whatsappPhone);

        const safeOrderNum = bookingResult.order.orderNumber || bookingResult.order.order_number;
        const safeTotal = bookingResult.order.total ?? bookingResult.order.pricing?.total ?? 0;

        const reply = RESPONSE_TEMPLATES.orderConfirmed({
            name: sessionDetails.name,
            orderNumber: safeOrderNum,
            total: safeTotal,
            paymentLabel: sessionDetails.paymentMethod === 'COD' ? 'Cash on Delivery (COD)' : 'EasyPaisa',
            address: sessionDetails.address,
        });

        return {
            success: true,
            orderNumber: safeOrderNum,
            total: safeTotal,
            reply,
        };
    }

    return {
        success: false,
        reason: 'BOOKING_FAILED',
        reply: RESPONSE_TEMPLATES.orderBookingFailed(),
    };
}

/**
 * 11. get_order_status({ orderNumber?: string })
 * Authoritatively retrieves customer's active orders from database.
 */
export async function get_order_status(args = {}, context = {}) {
    const { sessionKey, whatsappPhone } = context;
    const cleanPhone = (whatsappPhone || '').replace(/\D/g, '');
    const prisma = getDbClient();

    let activeOrders = [];
    if (prisma) {
        try {
            activeOrders = await prisma.order.findMany({
                where: {
                    order_status: { in: ['CONFIRMED', 'PREPARING', 'READY', 'PENDING', 'OUT_FOR_DELIVERY'] },
                    OR: [
                        { phone: cleanPhone },
                        { whatsapp_phone: cleanPhone },
                        { source_session_id: sessionKey },
                        { source_chat_id: sessionKey },
                    ],
                },
                orderBy: { created_at: 'desc' },
                include: { order_items: true },
            });
        } catch (_) {}
    }

    if (activeOrders && activeOrders.length > 0) {
        return {
            success: true,
            hasActiveOrders: true,
            ordersCount: activeOrders.length,
            reply: RESPONSE_TEMPLATES.existingOrdersList({ orders: activeOrders }),
        };
    }

    return {
        success: true,
        hasActiveOrders: false,
        reply: RESPONSE_TEMPLATES.noActiveOrders(),
    };
}

/**
 * 12. request_order_cancellation()
 * Informs customer of cancellation policy with Admin contact.
 */
export async function request_order_cancellation(args = {}, context = {}) {
    const cache = await getCatalogCache();
    const { getAdminContact } = await import('./restaurantService.js');
    const adminContact = await getAdminContact(cache?.restId);
    const waLink = `${adminContact.whatsappLink}?text=${encodeURIComponent('Assalam-o-Alaikum Cravey Crust, mujhe apna order cancel / delete karwana hai.')}`;

    return {
        success: true,
        reply: RESPONSE_TEMPLATES.orderDeletionNotAllowed({
            adminPhone: adminContact.displayPhone,
            whatsappLink: waLink,
        }),
    };
}

/**
 * Master Tool Execution Router
 */
export async function executeRegisteredTool(toolName, args = {}, context = {}) {
    switch (toolName) {
        case 'get_menu':
            return await get_menu(args, context);
        case 'get_deals':
            return await get_deals(args, context);
        case 'get_deal_details':
            return await get_deal_details(args, context);
        case 'get_product_details':
            return await get_product_details(args, context);
        case 'add_to_cart':
            return await add_to_cart(args, context);
        case 'remove_from_cart':
            return await remove_from_cart(args, context);
        case 'get_cart':
            return await get_cart(args, context);
        case 'update_customer_details':
            return await update_customer_details(args, context);
        case 'validate_delivery_location':
            return await validate_delivery_location(args, context);
        case 'confirm_order':
            return await confirm_order(args, context);
        case 'get_order_status':
            return await get_order_status(args, context);
        case 'request_order_cancellation':
            return await request_order_cancellation(args, context);
        default:
            return {
                success: false,
                unknownTool: true,
                message: `Tool ${toolName} not recognized`,
            };
    }
}
