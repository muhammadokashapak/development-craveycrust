import { Prisma } from '@prisma/client';
import { getDbClient } from '../db/client.js';
import { getDefaultRestaurantId } from './restaurantService.js';
import { getOrCreateCustomer, normalizePhone } from './customerService.js';
import { getActiveCart } from './cartService.js';
import { calculatePricing } from './pricingService.js';
import { generateOrderNumber } from './orderNumberService.js';
import { broadcastOrderEvent } from './realtimeService.js';
import { updateSessionStage } from './sessionService.js';
import { sendAdminNewOrderNotification, sendCustomerOrderStatusNotification, sendCancellationNotification } from './whatsappNotificationService.js';
import { updateCustomerNameForChat } from './chatService.js';

const Decimal = Prisma.Decimal;

export const VALID_STATUS_TRANSITIONS = {
    PENDING: ['CONFIRMED', 'CANCELLED'],
    CONFIRMED: ['PREPARING', 'CANCELLED'],
    PREPARING: ['READY', 'CANCELLED'],
    READY: ['OUT_FOR_DELIVERY', 'CANCELLED'],
    OUT_FOR_DELIVERY: ['DELIVERED'],
    DELIVERED: [],
    CANCELLED: [],
};

export const CANCELLABLE_STATUSES = ['PENDING', 'CONFIRMED', 'PREPARING'];

/**
 * Create a new order with atomic Prisma transaction and idempotency protection
 */
export async function createOrder(params) {
    const prisma = getDbClient();
    if (!prisma) {
        throw new Error('Database client not available');
    }

    const {
        restaurantId,
        sessionKey,
        customerName,
        phone,
        contactNumberMode = 'provided',
        confirmationNumberMode = 'default',
        confirmationPhone,
        delivery,
        paymentMethod = 'COD',
        promoCode,
        notes,
        idempotencyKey,
        sock,
    } = params;

    const restId = restaurantId || await getDefaultRestaurantId();

    if (!sessionKey) {
        const err = new Error('Session key is required to place an order');
        err.code = 'SESSION_KEY_REQUIRED';
        throw err;
    }

    // ─── 0. Idempotency Check ────────────────────────────────────────────────
    if (idempotencyKey) {
        const existingMessage = await prisma.processedMessage.findUnique({
            where: {
                restaurant_id_idempotency_key: {
                    restaurant_id: restId,
                    idempotency_key: idempotencyKey,
                },
            },
        });

        if (existingMessage && existingMessage.result_id) {
            const existingOrder = await getOrderByNumber({
                restaurantId: restId,
                orderId: existingMessage.result_id,
            });
            if (existingOrder) {
                return {
                    status: 'ORDER_EXISTS',
                    isDuplicate: true,
                    order: existingOrder,
                };
            }
        }
    }

    // ─── 1. Load active cart & session ───────────────────────────────────────
    const cart = await getActiveCart({ sessionKey, restaurantId: restId });
    if (!cart.items || cart.items.length === 0) {
        const err = new Error('Cannot create order from an empty cart');
        err.code = 'CART_EMPTY';
        throw err;
    }

    const session = await prisma.conversationSession.findUnique({
        where: { session_key: sessionKey },
    });

    if (!session) {
        const err = new Error('Conversation session not found');
        err.code = 'SESSION_NOT_FOUND';
        throw err;
    }

    // ─── 2. Validate Contact Mode & Phone Numbers ────────────────────────────
    let finalPhone = '';
    const phoneStr = String(phone || '').toLowerCase().trim();
    const isSameNumberRequest = phoneStr === 'same' || 
        phoneStr === 'same number' || 
        phoneStr === 'same_number' || 
        phoneStr === 'whatsapp' || 
        phoneStr === 'same_whatsapp' || 
        phoneStr === 'yahi' ||
        phoneStr === 'yehi' ||
        phoneStr === 'wahi' ||
        phoneStr.includes('same') ||
        contactNumberMode === 'same_whatsapp';

    const cleanDigits = phoneStr.replace(/\D/g, '');
    const isDummy = /^(0?3001234567|0?3123456789|0?3000000000|0?3211234567|0?3009876543|0?3120000000|0?3451234567|0?3331234567|0?3001111111|0?3001234568|0?3000000001|0?3111111111)$/.test(cleanDigits);

    if (isSameNumberRequest || isDummy || !phone) {
        if (session.verified_phone) {
            finalPhone = normalizePhone(session.verified_phone);
        }
    } else {
        finalPhone = normalizePhone(phone);
        // Fallback to verified_phone if phone string couldn't be parsed but session has verified_phone
        if (!finalPhone && session.verified_phone) {
            finalPhone = normalizePhone(session.verified_phone);
        }
    }

    // Fallback: extract clean digits from session_key, chat_id, or sessionKey if not raw @lid
    if (!finalPhone) {
        const candidates = [session.verified_phone, session.session_key, session.chat_id, sessionKey];
        for (const c of candidates) {
            if (c && !String(c).includes('@lid')) {
                const digits = String(c).split('@')[0].replace(/\D/g, '');
                if (digits.length >= 10) {
                    finalPhone = normalizePhone(digits.startsWith('92') && digits.length === 12 ? '0' + digits.slice(2) : digits);
                    break;
                }
            }
        }
    }

    if (!finalPhone) {
        const err = new Error('Contact phone number is required');
        err.code = 'CONTACT_NUMBER_REQUIRED';
        throw err;
    }

    const cleanCustomerName = (customerName || '').trim();
    const isDummyName = !cleanCustomerName || 
        cleanCustomerName.length < 2 || 
        /^(customer|user|guest|none|unknown|customer\s*name|name|\.|\.\.|\-|\_)$/i.test(cleanCustomerName);

    if (isDummyName) {
        const err = new Error('Customer actual name is required. Please ask the customer for their real name.');
        err.code = 'CUSTOMER_NAME_REQUIRED';
        throw err;
    }

    // ─── 3. Recheck Item / Deal Availability & Re-run Pricing ────────────────
    const itemsForPricing = [];
    const dealsForPricing = [];

    for (const item of cart.items) {
        if (item.menu_item_id) {
            itemsForPricing.push({
                menuItemId: item.menu_item_id,
                variantId: item.menu_variant_id || undefined,
                quantity: item.quantity,
            });
        } else if (item.deal_id) {
            dealsForPricing.push({
                dealId: item.deal_id,
                quantity: item.quantity,
            });
        }
    }

    const hasDeliveryInfo = !!(delivery?.areaId || delivery?.areaName || delivery?.address || (delivery?.latitude != null && delivery?.longitude != null));

    const pricing = await calculatePricing({
        restaurantId: restId,
        items: itemsForPricing,
        deals: dealsForPricing,
        promoCode,
        deliveryAreaId: delivery?.areaId,
        deliveryAreaName: delivery?.areaName,
        deliveryAddress: delivery?.address,
        latitude: delivery?.latitude,
        longitude: delivery?.longitude,
        deliveryFee: hasDeliveryInfo ? undefined : 0,
    });

    // ─── 4. Validate Minimum Order & Payment Method ──────────────────────────
    const restaurant = await prisma.restaurant.findUnique({
        where: { id: restId },
    });

    if (!restaurant) {
        throw new Error('Restaurant not found');
    }

    if (restaurant.min_order != null) {
        const minOrder = new Decimal(restaurant.min_order);
        if (pricing.subtotalDecimal.lessThan(minOrder)) {
            const err = new Error(`Order subtotal does not meet restaurant minimum order of Rs. ${minOrder}`);
            err.code = 'MINIMUM_ORDER_NOT_MET';
            throw err;
        }
    }

    const upperPayment = (paymentMethod || 'COD').toUpperCase();
    if (upperPayment === 'COD' && !restaurant.cod_enabled) {
        const err = new Error('Cash on Delivery (COD) is currently disabled');
        err.code = 'PAYMENT_METHOD_DISABLED';
        throw err;
    }
    if (upperPayment === 'EASYPAISA' && !restaurant.easypaisa_enabled) {
        const err = new Error('Easypaisa payment is currently disabled');
        err.code = 'PAYMENT_METHOD_DISABLED';
        throw err;
    }
    if (!['COD', 'EASYPAISA'].includes(upperPayment)) {
        const err = new Error(`Unsupported payment method: ${paymentMethod}`);
        err.code = 'INVALID_PAYMENT_METHOD';
        throw err;
    }

    // ─── 5. Concurrency-Safe Order Number ────────────────────────────────────
    const orderNumber = await generateOrderNumber({ prefix: 'CC' });

    // ─── 6. Execute Atomic Prisma Transaction ────────────────────────────────
    const orderResult = await prisma.$transaction(async (tx) => {
        // A. Upsert Customer
        const customer = await getOrCreateCustomer({
            restaurantId: restId,
            name: customerName.trim(),
            phone: finalPhone,
            whatsappPhone: session.verified_phone || (contactNumberMode === 'same_whatsapp' ? finalPhone : null),
        });

        await tx.customer.update({
            where: { id: customer.id },
            data: {
                total_orders: { increment: 1 },
                last_order_at: new Date(),
                first_order_at: customer.first_order_at || new Date(),
            },
        });

        // B. Prepare snapshot values
        const googleMapsUrl = (delivery?.latitude && delivery?.longitude)
            ? `https://maps.google.com/?q=${delivery.latitude},${delivery.longitude}`
            : (delivery?.googleMapsUrl || null);

        let finalNotes = notes || '';
        if (confirmationNumberMode === 'provided' && confirmationPhone) {
            finalNotes = finalNotes ? `${finalNotes} | Alt Confirm Phone: ${confirmationPhone}` : `Alt Confirm Phone: ${confirmationPhone}`;
        }

        // C. Create Order
        let finalDeliveryAddress = (delivery?.address || '').trim();
        const dummyAddressRegex = /^(school\s*stop|tarlai|tarlai\s*kalan|lehtrar\s*road|near\s*fazal|fazal\s*e\s*haq|islamabad|rawalpindi|customer\s*address|none|unknown|n\/a|address|delivery\s*address|\.|\-)$/i;
        const isRestaurantAddress = /lehtrar\s*road/i.test(finalDeliveryAddress) && (/fazal/i.test(finalDeliveryAddress) || /school\s*stop/i.test(finalDeliveryAddress));
        const areaLabel = pricing.deliveryArea?.name || delivery?.areaName || '';
        const isOnlyAreaName = areaLabel && finalDeliveryAddress.toLowerCase() === areaLabel.toLowerCase();

        if (dummyAddressRegex.test(finalDeliveryAddress) || isRestaurantAddress || isOnlyAreaName) {
            finalDeliveryAddress = '';
        }

        if (!finalDeliveryAddress) {
            if (delivery?.latitude != null && delivery?.longitude != null) {
                finalDeliveryAddress = `${areaLabel ? areaLabel + ' ' : ''}(Location Pin: https://www.google.com/maps?q=${delivery.latitude},${delivery.longitude})`;
            } else if (delivery?.address && /google\.com\/maps|location\s*pin|maps/i.test(delivery.address)) {
                finalDeliveryAddress = delivery.address;
            }
        }

        if (!finalDeliveryAddress || finalDeliveryAddress.length < 5) {
            const err = new Error('Valid customer delivery address or location pin is required. Please ask the customer for their specific house/street delivery address.');
            err.code = 'DELIVERY_ADDRESS_REQUIRED';
            throw err;
        }

        let validDeliveryAreaId = null;
        const candidateAreaId = pricing.deliveryArea?.id || delivery?.areaId;
        if (candidateAreaId && candidateAreaId !== 'radius-zone') {
            const areaExists = await tx.deliveryArea.findUnique({
                where: { id: candidateAreaId },
                select: { id: true },
            }).catch(() => null);
            if (areaExists) {
                validDeliveryAreaId = candidateAreaId;
            }
        }

        const createdOrder = await tx.order.create({
            data: {
                order_number: orderNumber,
                restaurant_id: restId,
                customer_id: customer.id,
                customer_name: customerName.trim(),
                phone: finalPhone,
                whatsapp_phone: session.verified_phone || customer.whatsapp_phone || null,
                delivery_address: finalDeliveryAddress || null,
                delivery_area_id: validDeliveryAreaId,
                delivery_area_name: pricing.deliveryArea?.name || delivery?.areaName || (delivery?.latitude != null ? 'Delivery Zone' : 'Standard Delivery'),
                latitude: delivery?.latitude != null ? Number(delivery.latitude) : null,
                longitude: delivery?.longitude != null ? Number(delivery.longitude) : null,
                google_maps_url: googleMapsUrl,
                subtotal: pricing.subtotalDecimal,
                discount_total: pricing.discountTotalDecimal,
                delivery_fee: pricing.deliveryFeeDecimal,
                total: pricing.totalDecimal,
                payment_method: upperPayment,
                payment_status: 'PENDING',
                order_status: 'CONFIRMED',
                notes: finalNotes || null,
                source: 'WHATSAPP',
                source_chat_id: session.chat_id,
                source_session_id: session.id,
                idempotency_key: idempotencyKey || null,
            },
        });

        // D. Create OrderItem Snapshots (Section 9)
        for (const item of pricing.breakdown.items) {
            const rawCartItem = cart.items.find(ci => ci.menu_item_id === item.itemId && ci.menu_variant_id === (item.variantId || null));
            await tx.orderItem.create({
                data: {
                    order_id: createdOrder.id,
                    menu_item_id: item.itemId,
                    menu_variant_id: item.variantId || null,
                    item_name_snapshot: item.name,
                    variant_name_snapshot: item.variantName || null,
                    unit_price: item.unitPriceDecimal,
                    quantity: item.quantity,
                    discount_amount: item.discountAmountDecimal || new Decimal(item.discountAmount || 0),
                    line_total: item.lineTotalDecimal,
                    notes: rawCartItem?.notes || null,
                },
            });
        }

        for (const deal of pricing.breakdown.deals) {
            const rawCartItem = cart.items.find(ci => ci.deal_id === deal.dealId);
            await tx.orderItem.create({
                data: {
                    order_id: createdOrder.id,
                    deal_id: deal.dealId,
                    deal_name_snapshot: deal.name,
                    unit_price: deal.unitPriceDecimal,
                    quantity: deal.quantity,
                    discount_amount: new Decimal(0),
                    line_total: deal.lineTotalDecimal,
                    notes: rawCartItem?.notes || null,
                },
            });
        }

        // E. Add Initial Status History
        await tx.orderStatusHistory.create({
            data: {
                order_id: createdOrder.id,
                previous_status: null,
                new_status: 'CONFIRMED',
                changed_by_type: 'SYSTEM',
                reason: 'Initial order placement',
            },
        });

        // F. Mark Cart as Completed
        await tx.cart.update({
            where: { id: cart.id },
            data: {
                status: 'COMPLETED',
                customer_id: customer.id,
            },
        });

        // G. Update Session Stage
        await tx.conversationSession.update({
            where: { id: session.id },
            data: {
                stage: 'ORDER_CONFIRMED',
                pending_order_id: createdOrder.id,
            },
        });

        // H. Record Processed Message for Idempotency
        if (idempotencyKey) {
            await tx.processedMessage.create({
                data: {
                    restaurant_id: restId,
                    chat_id: session.chat_id,
                    idempotency_key: idempotencyKey,
                    result_type: 'ORDER',
                    result_id: createdOrder.id,
                },
            });
        }

        return createdOrder;
    });

    // ─── 7. Broadcast Real-time Event ────────────────────────────────────────
    broadcastOrderEvent('order.created', {
        id: orderResult.id,
        orderNumber: orderResult.order_number,
        customerName: orderResult.customer_name,
        phone: orderResult.phone,
        total: Number(orderResult.total),
        status: orderResult.order_status,
        paymentMethod: orderResult.payment_method,
        createdAt: orderResult.created_at,
    });

    // Synchronize confirmed customer name to customer chats & records
    if (orderResult.customer_name && (session.chat_id || orderResult.phone)) {
        updateCustomerNameForChat({
            chatId: session.chat_id,
            phone: orderResult.phone || session.verified_phone,
            customerName: orderResult.customer_name,
            restaurantId: restId,
        }).catch(err => console.warn('[ORDER_SERVICE] updateCustomerNameForChat error:', err.message));
    }

    const fullOrder = await getOrderByNumber({ restaurantId: restId, orderNumber: orderResult.order_number });
    
    // Asynchronously dispatch admin WhatsApp notification (never blocks or rolls back order)
    sendAdminNewOrderNotification({ order: fullOrder, restaurantId: restId, sock }).catch(() => {});

    return {
        status: 'ORDER_CREATED',
        isDuplicate: false,
        order: fullOrder,
    };
}

/**
 * Two-Step Cancellation: Step 1 Request Cancel
 */
export async function requestOrderCancellation({ restaurantId, orderNumber, sessionKey }) {
    const prisma = getDbClient();
    if (!prisma) throw new Error('Database client not available');

    const restId = restaurantId || await getDefaultRestaurantId();

    const order = await prisma.order.findFirst({
        where: {
            restaurant_id: restId,
            order_number: orderNumber,
        },
    });

    if (!order) {
        const err = new Error(`Order not found: ${orderNumber}`);
        err.code = 'ORDER_NOT_FOUND';
        throw err;
    }

    if (!CANCELLABLE_STATUSES.includes(order.order_status)) {
        const err = new Error(`Order ${orderNumber} is in status '${order.order_status}' and cannot be cancelled`);
        err.code = 'ORDER_NOT_CANCELLABLE';
        throw err;
    }

    const session = await prisma.conversationSession.findUnique({
        where: { session_key: sessionKey },
    });

    if (!session) {
        const err = new Error('Conversation session not found');
        err.code = 'SESSION_NOT_FOUND';
        throw err;
    }

    // Verify order belongs to session/chat/phone
    const isSameSession = !order.source_session_id || order.source_session_id === session.id;
    const isSameChat = session.chat_id && (order.chat_id === session.chat_id || order.delivery_address?.includes(session.chat_id));
    const isSamePhone = session.verified_phone && (order.phone === session.verified_phone || order.whatsapp_phone === session.verified_phone);

    if (order.source_session_id && !isSameSession && !isSameChat && !isSamePhone) {
        const err = new Error('Order does not belong to this conversation session');
        err.code = 'UNAUTHORIZED_ORDER_ACCESS';
        throw err;
    }

    // Set session stage to WAITING_CANCEL_CONFIRMATION
    await prisma.conversationSession.update({
        where: { id: session.id },
        data: {
            pending_cancel_order_id: order.id,
            stage: 'WAITING_CANCEL_CONFIRMATION',
            last_activity_at: new Date(),
        },
    });

    const fullOrder = await getOrderByNumber({ restaurantId: restId, orderNumber: order.order_number });
    const itemsList = (fullOrder?.items || []).map(it => {
        const title = it.dealName || (it.itemName + (it.variantName ? ` (${it.variantName})` : ''));
        const price = it.lineTotal || (it.unitPrice * it.quantity);
        return `${title} x ${it.quantity} (Rs. ${price})`;
    });

    const subtotal = fullOrder?.pricing?.subtotal || Number(order.subtotal);
    const deliveryFee = fullOrder?.pricing?.deliveryFee || Number(order.delivery_fee);
    const total = fullOrder?.pricing?.total || Number(order.total);

    const confirmationText = 
`Aap ke order #${order.order_number} mein yeh items shamil hain:
${itemsList.length > 0 ? itemsList.map(i => '- ' + i).join('\n') : '- ' + (order.order_items?.[0]?.item_name_snapshot || 'Order Items')}
Subtotal: Rs. ${subtotal}
Delivery Fee: Rs. ${deliveryFee}
Total Bill: Rs. ${total}

Kya aap waqai is order ko cancel karna chahte hain? Haan ya Nahi confirm kar dein.`;

    return {
        status: 'CANCELLATION_CONFIRMATION_REQUIRED',
        orderNumber: order.order_number,
        currentStatus: order.order_status,
        order: {
            orderNumber: fullOrder?.orderNumber || order.order_number,
            items: fullOrder?.items || [],
            itemsSummary: itemsList,
            subtotal,
            deliveryFee,
            total,
        },
        message: confirmationText,
    };
}

/**
 * Two-Step Cancellation: Step 2 Confirm Cancel
 */
export async function confirmOrderCancellation({ restaurantId, orderNumber, sessionKey, confirmed }) {
    const prisma = getDbClient();
    if (!prisma) throw new Error('Database client not available');

    const restId = restaurantId || await getDefaultRestaurantId();

    const session = await prisma.conversationSession.findUnique({
        where: { session_key: sessionKey },
    });

    if (!session) {
        const err = new Error('Conversation session not found');
        err.code = 'SESSION_NOT_FOUND';
        throw err;
    }

    const order = await prisma.order.findFirst({
        where: {
            restaurant_id: restId,
            order_number: orderNumber,
        },
    });

    if (!order) {
        const err = new Error(`Order not found: ${orderNumber}`);
        err.code = 'ORDER_NOT_FOUND';
        throw err;
    }

    // User aborted cancellation
    if (confirmed !== true) {
        await prisma.conversationSession.update({
            where: { id: session.id },
            data: {
                pending_cancel_order_id: null,
                stage: 'START',
                last_activity_at: new Date(),
            },
        });
        return {
            status: 'CANCELLATION_ABORTED',
            orderNumber: order.order_number,
            currentStatus: order.order_status,
            message: `Cancellation aborted. Order ${order.order_number} remains ${order.order_status}.`,
        };
    }

    // User confirmed cancellation
    if (session.pending_cancel_order_id !== order.id) {
        const err = new Error('Session does not have a pending cancellation matching this order');
        err.code = 'CANCELLATION_MISMATCH';
        throw err;
    }

    if (!CANCELLABLE_STATUSES.includes(order.order_status)) {
        const err = new Error(`Order ${orderNumber} is no longer cancellable (status: ${order.order_status})`);
        err.code = 'ORDER_NOT_CANCELLABLE';
        throw err;
    }

    const previousStatus = order.order_status;

    // Transaction to update order, history, and session
    await prisma.$transaction(async (tx) => {
        await tx.order.update({
            where: { id: order.id },
            data: {
                order_status: 'CANCELLED',
            },
        });

        await tx.orderStatusHistory.create({
            data: {
                order_id: order.id,
                previous_status: previousStatus,
                new_status: 'CANCELLED',
                changed_by_type: 'CUSTOMER',
                reason: 'Customer confirmed cancellation via two-step flow',
            },
        });

        await tx.conversationSession.update({
            where: { id: session.id },
            data: {
                pending_cancel_order_id: null,
                stage: 'CANCELLED',
                last_activity_at: new Date(),
            },
        });
    });

    broadcastOrderEvent('order.cancelled', {
        id: order.id,
        orderNumber: order.order_number,
        previousStatus,
        status: 'CANCELLED',
        reason: 'Customer cancelled',
    });

    const fullOrder = await getOrderByNumber({ restaurantId: restId, orderNumber: order.order_number });
    sendCancellationNotification({ order: fullOrder || order, reason: 'Customer cancelled' }).catch(() => {});

    return {
        status: 'ORDER_CANCELLED',
        orderNumber: order.order_number,
        orderStatus: 'CANCELLED',
        message: `Order ${order.order_number} has been cancelled successfully.`,
    };
}

/**
 * Direct cancel order helper
 */
export async function cancelOrder({ restaurantId, orderNumber, reason = 'Customer cancelled', changedByType = 'CUSTOMER' }) {
    try {
        const res = await updateOrderStatus({
            restaurantId,
            orderNumber,
            newStatus: 'CANCELLED',
            changedByType,
            reason,
        });
        return {
            success: true,
            status: 'ORDER_CANCELLED',
            orderNumber,
            message: `Order #${orderNumber} has been cancelled successfully.`,
            order: res,
        };
    } catch (err) {
        return {
            success: false,
            status: 'CANCEL_FAILED',
            orderNumber,
            message: err.message,
            error: err.code || 'CANCEL_ERROR',
        };
    }
}

/**
 * Update placed order details (customer name, delivery address, phone, payment method)
 * and synchronize with customer profile and chat history.
 */
export async function updateOrderDetails({
    restaurantId,
    orderNumber,
    customerName,
    address,
    location,
    phone,
    paymentMethod,
    changedByType = 'CUSTOMER',
    sock,
}) {
    const prisma = getDbClient();
    if (!prisma) throw new Error('Database client not available');

    const restId = restaurantId === null ? null : (restaurantId || await getDefaultRestaurantId());

    const where = { order_number: orderNumber };
    if (restId) where.restaurant_id = restId;

    let order = await prisma.order.findFirst({
        where,
        include: {
            order_items: true,
            customer: true,
        },
    });

    if (!order && restId) {
        order = await prisma.order.findFirst({
            where: { order_number: orderNumber },
            include: {
                order_items: true,
                customer: true,
            },
        });
    }

    if (!order) {
        return { success: false, error: 'ORDER_NOT_FOUND', message: `Order #${orderNumber} nahi mila.` };
    }

    if (order.order_status === 'DELIVERED') {
        return { success: false, error: 'ORDER_ALREADY_DELIVERED', message: `Order #${orderNumber} deliver ho chuka hai, is liye ab update nahi kiya ja sakta.` };
    }

    if (order.order_status === 'CANCELLED') {
        return { success: false, error: 'ORDER_ALREADY_CANCELLED', message: `Order #${orderNumber} cancel ho chuka hai.` };
    }

    const updateData = {};
    const changeLog = [];

    if (customerName && typeof customerName === 'string' && customerName.trim() && customerName.trim() !== order.customer_name) {
        updateData.customer_name = customerName.trim();
        changeLog.push(`Name: ${order.customer_name} -> ${customerName.trim()}`);
    }

    if (address && typeof address === 'string' && address.trim() && address.trim() !== order.delivery_address) {
        updateData.delivery_address = address.trim();
        changeLog.push(`Address: ${order.delivery_address || 'None'} -> ${address.trim()}`);
    }

    if (location?.latitude != null && location?.longitude != null) {
        updateData.latitude = Number(location.latitude);
        updateData.longitude = Number(location.longitude);
        updateData.google_maps_url = location.mapUrl || `https://www.google.com/maps?q=${location.latitude},${location.longitude}`;
        changeLog.push(`Location Pin updated`);
    }

    if (phone && typeof phone === 'string') {
        const cleanPh = phone.replace(/\D/g, '');
        if (cleanPh && cleanPh !== order.phone) {
            updateData.phone = cleanPh;
            changeLog.push(`Phone: ${order.phone} -> ${cleanPh}`);
        }
    }

    if (paymentMethod && typeof paymentMethod === 'string') {
        const pm = /EASY/i.test(paymentMethod) ? 'EASYPAISA' : 'COD';
        if (pm !== order.payment_method) {
            updateData.payment_method = pm;
            changeLog.push(`Payment: ${order.payment_method} -> ${pm}`);
        }
    }

    if (Object.keys(updateData).length === 0) {
        return { success: true, order, noChanges: true, message: 'Details pehle se yahi set hain.' };
    }

    const updated = await prisma.order.update({
        where: { id: order.id },
        data: updateData,
        include: {
            order_items: true,
            customer: true,
        },
    });

    // Record status history entry
    await prisma.orderStatusHistory.create({
        data: {
            order_id: order.id,
            previous_status: order.order_status,
            new_status: order.order_status,
            changed_by_type: changedByType,
            reason: `Customer updated: ${changeLog.join(', ')}`,
        },
    }).catch(() => {});

    // Broadcast SSE live event to dashboard
    broadcastOrderEvent('order.status_changed', {
        id: order.id,
        orderNumber: order.order_number,
        previousStatus: order.order_status,
        newStatus: order.order_status,
        paymentStatus: updated.payment_status,
        customerName: updated.customer_name,
        deliveryAddress: updated.delivery_address,
        updatedAt: updated.updated_at,
    });

    // Update customer in database if name or phone changed
    if (order.customer_id) {
        const custUpdate = {};
        if (updateData.customer_name) custUpdate.name = updateData.customer_name;
        if (updateData.phone) {
            custUpdate.phone = updateData.phone;
            custUpdate.whatsapp_phone = updateData.phone;
        }
        if (Object.keys(custUpdate).length > 0) {
            await prisma.customer.update({
                where: { id: order.customer_id },
                data: custUpdate,
            }).catch(() => {});
        }
    }

    // Update chat history & memory so admin panel immediately shows updated name
    if (updateData.customer_name) {
        try {
            const { updateCustomerNameForChat } = await import('./chatService.js');
            await updateCustomerNameForChat({
                chatId: order.source_chat_id || order.source_session_id,
                phone: order.whatsapp_phone || order.phone,
                customerName: updateData.customer_name,
                restaurantId: order.restaurant_id,
            });
        } catch (_) {}
    }

    return {
        success: true,
        order: updated,
        changes: changeLog,
    };
}

/**
 * Update order status with state machine enforcement
 */
export async function updateOrderStatus({ restaurantId, orderNumber, newStatus, changedByType = 'ADMIN', changedById, reason }) {
    const prisma = getDbClient();
    if (!prisma) throw new Error('Database client not available');

    const restId = restaurantId === null ? null : (restaurantId || await getDefaultRestaurantId());

    let order = await prisma.order.findFirst({
        where: restId ? { restaurant_id: restId, order_number: orderNumber } : { order_number: orderNumber },
    });

    if (!order && restId) {
        order = await prisma.order.findFirst({
            where: { order_number: orderNumber },
        });
    }

    if (!order) {
        const err = new Error(`Order not found: ${orderNumber}`);
        err.code = 'ORDER_NOT_FOUND';
        throw err;
    }

    const currentStatus = order.order_status;
    const allowed = VALID_STATUS_TRANSITIONS[currentStatus] || [];

    if (!allowed.includes(newStatus)) {
        const err = new Error(`Invalid status transition from '${currentStatus}' to '${newStatus}'. Allowed: [${allowed.join(', ')}]`);
        err.code = 'INVALID_STATUS_TRANSITION';
        throw err;
    }

    const updates = { order_status: newStatus };
    if (newStatus === 'DELIVERED' && order.payment_method === 'COD') {
        updates.payment_status = 'PAID';
    }

    const updatedOrder = await prisma.$transaction(async (tx) => {
        const ord = await tx.order.update({
            where: { id: order.id },
            data: updates,
        });

        await tx.orderStatusHistory.create({
            data: {
                order_id: order.id,
                previous_status: currentStatus,
                new_status: newStatus,
                changed_by_type: changedByType,
                changed_by_id: changedById || null,
                reason: reason || null,
            },
        });

        return ord;
    });

    broadcastOrderEvent('order.status_changed', {
        id: order.id,
        orderNumber: order.order_number,
        previousStatus: currentStatus,
        newStatus,
        paymentStatus: updatedOrder.payment_status,
        changedByType,
    });

    const fullUpdatedOrder = await getOrderByNumber({ restaurantId: restId, orderNumber });
    if (newStatus === 'CANCELLED') {
        sendCancellationNotification({ order: fullUpdatedOrder || order, reason: reason || 'Cancelled' }).catch(() => {});
    } else {
        sendCustomerOrderStatusNotification({ order: fullUpdatedOrder || order, newStatus, reason }).catch(() => {});
    }

    return fullUpdatedOrder;
}

/**
 * Get detailed order by orderNumber or ID
 */
export async function getOrderByNumber({ restaurantId, orderNumber, orderId }) {
    const prisma = getDbClient();
    if (!prisma) return null;

    let restId = restaurantId;
    if (restId === 'default-restaurant' || restId === 'ALL') {
        restId = null;
    }
    const where = {};
    if (restId) where.restaurant_id = restId;
    if (orderNumber) where.order_number = orderNumber;
    if (orderId) where.id = orderId;

    let order = await prisma.order.findFirst({
        where,
        include: {
            customer: true,
            delivery_area: true,
            order_items: {
                include: {
                    menu_item: true,
                    menu_variant: true,
                    deal: true,
                },
                orderBy: { created_at: 'asc' },
            },
            status_history: {
                orderBy: { created_at: 'asc' },
            },
        },
    });

    if (!order && (orderNumber || orderId)) {
        const fallbackWhere = {};
        if (orderNumber) fallbackWhere.order_number = orderNumber;
        if (orderId) fallbackWhere.id = orderId;
        order = await prisma.order.findFirst({
            where: fallbackWhere,
            include: {
                customer: true,
                delivery_area: true,
                order_items: {
                    include: {
                        menu_item: true,
                        menu_variant: true,
                        deal: true,
                    },
                    orderBy: { created_at: 'asc' },
                },
                status_history: {
                    orderBy: { created_at: 'asc' },
                },
            },
        });
    }

    if (!order) return null;

    return {
        id: order.id,
        orderNumber: order.order_number,
        restaurantId: order.restaurant_id,
        customer: order.customer ? {
            id: order.customer.id,
            name: order.customer.name,
            phone: order.customer.phone,
            whatsappPhone: order.customer.whatsapp_phone,
            totalOrders: order.customer.total_orders,
        } : null,
        customerName: order.customer_name,
        phone: order.phone,
        whatsappPhone: order.whatsapp_phone,
        delivery: {
            address: order.delivery_address,
            areaId: order.delivery_area_id,
            areaName: order.delivery_area_name,
            latitude: order.latitude,
            longitude: order.longitude,
            googleMapsUrl: order.google_maps_url,
        },
        pricing: {
            subtotal: Number(order.subtotal),
            discountTotal: Number(order.discount_total),
            deliveryFee: Number(order.delivery_fee),
            total: Number(order.total),
        },
        payment: {
            method: order.payment_method,
            status: order.payment_status,
        },
        orderStatus: order.order_status,
        notes: order.notes,
        source: order.source,
        createdAt: order.created_at,
        updatedAt: order.updated_at,
        items: order.order_items.map(item => ({
            id: item.id,
            menuItemId: item.menu_item_id,
            menuVariantId: item.menu_variant_id,
            dealId: item.deal_id,
            itemName: item.item_name_snapshot || item.menu_item?.name,
            variantName: item.variant_name_snapshot || item.menu_variant?.name,
            dealName: item.deal_name_snapshot || item.deal?.name,
            unitPrice: Number(item.unit_price),
            quantity: item.quantity,
            discountAmount: Number(item.discount_amount),
            lineTotal: Number(item.line_total),
            notes: item.notes,
        })),
        statusHistory: order.status_history.map(h => ({
            id: h.id,
            previousStatus: h.previous_status,
            newStatus: h.new_status,
            changedByType: h.changed_by_type,
            changedById: h.changed_by_id,
            reason: h.reason,
            createdAt: h.created_at,
        })),
    };
}

/**
 * Get orders by customer phone (for bot "mera order kahan hai?")
 */
export async function getOrdersByCustomerPhone({ restaurantId, phone }) {
    const prisma = getDbClient();
    if (!prisma) return [];

    const restId = restaurantId || await getDefaultRestaurantId();
    const clean = normalizePhone(phone);
    if (!clean) return [];

    const orders = await prisma.order.findMany({
        where: {
            restaurant_id: restId,
            OR: [
                { phone: clean },
                { whatsapp_phone: clean },
            ],
        },
        orderBy: { created_at: 'desc' },
        take: 10,
        include: {
            order_items: true,
        },
    });

    return orders.map(o => ({
        orderNumber: o.order_number,
        customerName: o.customer_name,
        orderStatus: o.order_status,
        total: Number(o.total),
        itemCount: o.order_items.reduce((sum, i) => sum + i.quantity, 0),
        createdAt: o.created_at,
    }));
}

/**
 * Admin: Get orders with comprehensive filters
 */
export async function getAdminOrders({ restaurantId, status, date, search, page = 1, limit = 50 }) {
    const prisma = getDbClient();
    if (!prisma) throw new Error('Database client not available');

    let restId = restaurantId;
    if (restId === 'default-restaurant' || restId === 'ALL') {
        restId = null;
    } else if (restId) {
        const restExists = await prisma.restaurant.findUnique({
            where: { id: restId },
            select: { id: true },
        });
        if (!restExists) {
            restId = null;
        }
    }
    const conditions = [];
    if (restId) {
        conditions.push({ restaurant_id: restId });
    }

    if (status && status !== 'ALL') {
        conditions.push({ order_status: status });
    }

    if (date) {
        const start = new Date(date);
        start.setHours(0, 0, 0, 0);
        const end = new Date(date);
        end.setHours(23, 59, 59, 999);
        conditions.push({ created_at: { gte: start, lte: end } });
    }

    if (search && search.trim()) {
        const s = search.trim();
        conditions.push({
            OR: [
                { order_number: { contains: s, mode: 'insensitive' } },
                { customer_name: { contains: s, mode: 'insensitive' } },
                { phone: { contains: s } },
            ]
        });
    }

    const where = conditions.length > 0 ? { AND: conditions } : {};

    const skip = (Math.max(1, page) - 1) * limit;

    let [totalCount, rawOrders] = await Promise.all([
        prisma.order.count({ where }),
        prisma.order.findMany({
            where,
            orderBy: { created_at: 'desc' },
            skip,
            take: limit,
            include: {
                order_items: true,
            },
        }),
    ]);

    // Fallback: If scoped restaurant returned 0 orders, but global orders exist in DB,
    // fall back without restaurant_id condition so orders are never hidden from admins
    if (totalCount === 0 && restId) {
        const globalConditions = conditions.filter(c => !c.restaurant_id);
        const globalWhere = globalConditions.length > 0 ? { AND: globalConditions } : {};
        const globalCount = await prisma.order.count({ where: globalWhere });
        if (globalCount > 0) {
            totalCount = globalCount;
            rawOrders = await prisma.order.findMany({
                where: globalWhere,
                orderBy: { created_at: 'desc' },
                skip,
                take: limit,
                include: {
                    order_items: true,
                },
            });
        }
    }

    const orders = rawOrders.map(o => ({
        id: o.id,
        orderNumber: o.order_number,
        customerName: o.customer_name,
        phone: o.phone,
        deliveryArea: o.delivery_area_name,
        total: Number(o.total),
        paymentMethod: o.payment_method,
        paymentStatus: o.payment_status,
        orderStatus: o.order_status,
        itemCount: o.order_items.reduce((sum, i) => sum + i.quantity, 0),
        itemsSummary: o.order_items.map(i => {
            const f = i.notes ? ` [${i.notes}]` : '';
            return `${i.quantity}x ${i.item_name_snapshot || i.deal_name_snapshot}${f}`;
        }).join(', '),
        createdAt: o.created_at,
    }));

    return {
        total: totalCount,
        page,
        limit,
        totalPages: Math.ceil(totalCount / limit),
        orders,
    };
}

/**
 * Admin: Dashboard metrics computed strictly from PostgreSQL
 */
export async function getAdminOrderMetrics({ restaurantId }) {
    const prisma = getDbClient();
    if (!prisma) throw new Error('Database client not available');

    let restId = restaurantId;
    if (restId === 'default-restaurant' || restId === 'ALL') {
        restId = null;
    } else if (restId) {
        const restExists = await prisma.restaurant.findUnique({
            where: { id: restId },
            select: { id: true },
        });
        if (!restExists) {
            restId = null;
        }
    }

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const whereToday = { created_at: { gte: startOfToday } };
    const whereAll = {};
    if (restId) {
        whereToday.restaurant_id = restId;
        whereAll.restaurant_id = restId;
    }

    let [todayOrders, statusCounts] = await Promise.all([
        prisma.order.findMany({
            where: whereToday,
            select: {
                total: true,
                order_status: true,
            },
        }),
        prisma.order.groupBy({
            by: ['order_status'],
            where: whereAll,
            _count: { id: true },
        }),
    ]);

    // If scoped query yielded 0 today orders and 0 status counts, fallback to global metrics
    if (restId && todayOrders.length === 0 && statusCounts.length === 0) {
        const [globalToday, globalStatus] = await Promise.all([
            prisma.order.findMany({
                where: { created_at: { gte: startOfToday } },
                select: {
                    total: true,
                    order_status: true,
                },
            }),
            prisma.order.groupBy({
                by: ['order_status'],
                _count: { id: true },
            }),
        ]);
        if (globalToday.length > 0 || globalStatus.length > 0) {
            todayOrders = globalToday;
            statusCounts = globalStatus;
        }
    }

    let todayRevenue = new Decimal(0);
    for (const o of todayOrders) {
        if (o.order_status !== 'CANCELLED') {
            todayRevenue = todayRevenue.plus(new Decimal(o.total));
        }
    }

    const counts = {
        PENDING: 0,
        CONFIRMED: 0,
        PREPARING: 0,
        READY: 0,
        OUT_FOR_DELIVERY: 0,
        DELIVERED: 0,
        CANCELLED: 0,
    };

    for (const sc of statusCounts) {
        counts[sc.order_status] = sc._count.id;
    }

    return {
        todayOrdersCount: todayOrders.length,
        todayRevenue: Number(todayRevenue.toFixed(2)),
        confirmed: counts.CONFIRMED,
        preparing: counts.PREPARING,
        ready: counts.READY,
        outForDelivery: counts.OUT_FOR_DELIVERY,
        delivered: counts.DELIVERED,
        cancelled: counts.CANCELLED,
        pending: counts.PENDING,
    };
}

/**
 * Permanently delete an order and its associated records
 */
export async function deleteOrderByNumber({ restaurantId, orderNumber }) {
    const prisma = getDbClient();
    if (!prisma) throw new Error('Database client not available');

    const restId = restaurantId === null ? null : (restaurantId || await getDefaultRestaurantId());

    let order = await prisma.order.findFirst({
        where: restId ? { restaurant_id: restId, order_number: orderNumber } : { order_number: orderNumber },
    });

    if (!order && restId) {
        order = await prisma.order.findFirst({
            where: { order_number: orderNumber },
        });
    }

    if (!order) {
        const err = new Error(`Order ${orderNumber} not found`);
        err.code = 'ORDER_NOT_FOUND';
        throw err;
    }

    const deleted = await prisma.$transaction(async (tx) => {
        await tx.orderItem.deleteMany({ where: { order_id: order.id } });
        await tx.orderStatusHistory.deleteMany({ where: { order_id: order.id } });
        return await tx.order.delete({ where: { id: order.id } });
    });

    broadcastOrderEvent('order.deleted', {
        id: order.id,
        orderNumber: order.order_number,
    });

    return deleted;
}

/**
 * Permanently purge all orders, order items, status history, and customers
 * Preserves customer_chats.json untouched.
 */
export async function purgeAllOrdersAndCustomers({ restaurantId = null } = {}) {
    const prisma = getDbClient();
    if (!prisma) throw new Error('Database client not available');

    return await prisma.$transaction(async (tx) => {
        // 1. Unlink customer from carts to avoid FK constraint
        await tx.cart.updateMany({
            data: { customer_id: null },
        });

        // 2. Clear order references in conversation sessions
        await tx.conversationSession.updateMany({
            data: {
                pending_order_id: null,
                pending_cancel_order_id: null,
                stage: 'START',
            },
        });

        // 3. Delete order items & status history
        await tx.orderItem.deleteMany({});
        await tx.orderStatusHistory.deleteMany({});

        // 4. Delete all orders
        const ordersDeleted = await tx.order.deleteMany({});

        // 5. Delete all customers
        const customersDeleted = await tx.customer.deleteMany({});

        return {
            ordersCount: ordersDeleted.count,
            customersCount: customersDeleted.count,
        };
    });
}
