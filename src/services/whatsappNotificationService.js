/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║   WhatsApp Notification Service                              ║
 * ║   src/services/whatsappNotificationService.js                ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Responsibilities:
 *   - sendAdminNewOrderNotification(): Notifies restaurant admin of new orders via WhatsApp.
 *   - sendCustomerOrderStatusNotification(): Notifies customer when order status changes.
 *   - sendCancellationNotification(): Notifies customer and admin when order is cancelled.
 *
 * Safety & Reliability Rules:
 *   - Notification failure must NEVER rollback or undo a valid database operation.
 *   - Errors are caught safely and logged.
 *   - Reuses existing connected Baileys WhatsApp socket.
 */

import { getDbClient } from '../db/client.js';
import { getDefaultRestaurantId } from './restaurantService.js';
import { logger } from '../utils/logger.js';

let _socketResolver = null;

/**
 * Register a socket resolver function or active sessions map
 * @param {Function|Map} resolver
 */
export function registerSocketResolver(resolver) {
    _socketResolver = resolver;
}

/**
 * Helper to resolve an active Baileys socket
 */
function resolveSocket(explicitSock) {
    if (explicitSock) return explicitSock;
    if (typeof _socketResolver === 'function') {
        const resolved = _socketResolver();
        if (resolved?.sendMessage) return resolved;
        if (resolved?.sock?.sendMessage) return resolved.sock;
        if (resolved instanceof Map) {
            for (const sess of resolved.values()) {
                if (sess.state === 'connected' && sess.sock?.sendMessage) {
                    return sess.sock;
                }
            }
        }
    } else if (_socketResolver instanceof Map) {
        for (const sess of _socketResolver.values()) {
            if (sess.state === 'connected' && sess.sock?.sendMessage) {
                return sess.sock;
            }
        }
    }
    return null;
}

/**
 * Format phone string to valid WhatsApp JID
 */
function formatPhoneToJid(phone) {
    if (!phone) return null;
    let clean = String(phone).replace(/\D/g, '');
    if (clean.startsWith('0092')) {
        clean = clean.slice(2);
    } else if (clean.startsWith('03')) {
        clean = '92' + clean.slice(1);
    } else if (clean.startsWith('3') && clean.length === 10) {
        clean = '92' + clean;
    }
    if (clean.length < 10) return null;
    // Reject dummy placeholder numbers (e.g. 923000000000 or all zeroes)
    if (/^920+$/.test(clean) || /^0+$/.test(clean) || /0000000/.test(clean)) return null;
    return `${clean}@s.whatsapp.net`;
}

/**
 * Resolves the dynamic admin/support WhatsApp recipient(s).
 * Strictly prioritizes the "Support Agent WhatsApp Number" (human_handoff_phone)
 * from Restaurant Settings / Admin Panel.
 * Dynamically reflects any update made in the settings dashboard without server restarts.
 * Falls back to restaurant.admin_notification_phone, environment variables, or scanned account ONLY if no setting is configured.
 *
 * @param {Object} [params]
 * @param {string} [params.restaurantId]
 * @param {Object} [params.sock]
 * @returns {Promise<{recipients: Set<string>, activeSock: Object|null, configuredPhone: string|null}>}
 */
export async function getDynamicAdminRecipients({ restaurantId, sock } = {}) {
    const prisma = getDbClient();
    const restId = restaurantId || await getDefaultRestaurantId();
    const recipients = new Set();
    const activeSock = resolveSocket(sock);

    let configuredPhone = null;

    if (prisma) {
        try {
            // 1. Primary: human_handoff_phone from restaurantSetting (Dashboard -> Restaurant Settings)
            if (restId) {
                const handoffSetting = await prisma.restaurantSetting.findFirst({
                    where: { restaurant_id: restId, key: 'human_handoff_phone' },
                    orderBy: { updated_at: 'desc' },
                });
                if (handoffSetting?.value && handoffSetting.value.trim()) {
                    configuredPhone = handoffSetting.value.trim();
                }
            }
            if (!configuredPhone) {
                const anyHandoff = await prisma.restaurantSetting.findFirst({
                    where: { key: 'human_handoff_phone', value: { not: '' } },
                    orderBy: { updated_at: 'desc' },
                });
                if (anyHandoff?.value && anyHandoff.value.trim()) {
                    configuredPhone = anyHandoff.value.trim();
                }
            }

            // 2. Secondary check: restaurant.admin_notification_phone
            if (!configuredPhone && restId) {
                const restaurant = await prisma.restaurant.findUnique({
                    where: { id: restId },
                    select: { admin_notification_phone: true },
                });
                if (restaurant?.admin_notification_phone && restaurant.admin_notification_phone.trim()) {
                    configuredPhone = restaurant.admin_notification_phone.trim();
                }
            }
        } catch (e) {
            logger.warn({ err: e.message }, '[NOTIFY] Error reading dynamic admin/support phone setting');
        }
    }

    if (configuredPhone) {
        const jid = formatPhoneToJid(configuredPhone);
        if (jid) {
            recipients.add(jid);
            return { recipients, activeSock, configuredPhone };
        }
    }

    // Fallbacks ONLY if no phone number was configured in dashboard settings
    const envCandidates = [
        process.env.ADMIN_NOTIFICATION_PHONE,
        process.env.OWNER_NUMBER,
        process.env.ADMIN_PHONE,
        process.env.OWNER_PHONE,
    ];
    for (const num of envCandidates) {
        const jid = formatPhoneToJid(num);
        if (jid) {
            recipients.add(jid);
            break;
        }
    }

    if (recipients.size === 0 && activeSock) {
        const scannedRaw = activeSock.user?.id || activeSock.authState?.creds?.me?.id || '';
        const scannedDigits = scannedRaw.split('@')[0]?.split(':')[0]?.replace(/\D/g, '');
        const scannedJid = formatPhoneToJid(scannedDigits);
        if (scannedJid) {
            recipients.add(scannedJid);
        }
    }

    return { recipients, activeSock, configuredPhone: null };
}

/**
 * Send WhatsApp notification to Admin when a new order is placed
 *
 * @param {Object} params
 * @param {Object} params.order
 * @param {string} [params.restaurantId]
 * @param {Object} [params.sock]
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function sendAdminNewOrderNotification({ order, restaurantId, sock }) {
    try {
        if (!order) return { success: false, error: 'No order provided' };

        const restId = restaurantId || order.restaurantId || order.restaurant_id || await getDefaultRestaurantId();
        const { recipients, activeSock, configuredPhone } = await getDynamicAdminRecipients({ restaurantId: restId, sock });

        if (recipients.size === 0) {
            logger.warn({ orderNumber: order.order_number || order.orderNumber }, '[NOTIFY] Admin notification skipped: No valid admin/handoff phone configured');
            return { success: false, error: 'No valid admin phone configured' };
        }

        if (!activeSock) {
            logger.warn({ orderNumber: order.order_number || order.orderNumber }, '[NOTIFY] Admin notification skipped: WhatsApp socket not connected');
            return { success: false, error: 'WhatsApp socket not connected' };
        }

        if (configuredPhone) {
            logger.info({ configuredPhone, orderNumber: order.order_number || order.orderNumber }, '[NOTIFY] Order notification routed dynamically to Support Agent WhatsApp Number');
        }

        const orderId = order.orderNumber || order.order_number;
        const customerName = order.customerName || order.customer_name || order.customer?.name || 'Customer';
        const customerPhone = order.phone || order.customer?.phone || order.whatsapp_phone || order.whatsappPhone || '';

        let itemsLines = '';
        if (Array.isArray(order.items) && order.items.length > 0) {
            itemsLines = order.items.map(i => {
                const name = i.dealName || i.itemName || i.item_name_snapshot || 'Item';
                const variant = i.variantName || i.variant_name_snapshot ? ` (${i.variantName || i.variant_name_snapshot})` : '';
                const lineTotal = Number(i.lineTotal ?? i.line_total ?? (Number(i.unitPrice ?? i.unit_price ?? 0) * Number(i.quantity ?? 1))).toLocaleString('en-PK');
                return `${i.quantity}x ${name}${variant} — Rs. ${lineTotal}`;
            }).join('\n');
        } else if (Array.isArray(order.order_items) && order.order_items.length > 0) {
            itemsLines = order.order_items.map(i => {
                const name = i.deal_name_snapshot || i.deal?.name || i.item_name_snapshot || i.menu_item?.name || 'Item';
                const variant = i.variant_name_snapshot || i.menu_variant?.name ? ` (${i.variant_name_snapshot || i.menu_variant?.name})` : '';
                const lineTotal = Number(i.line_total ?? (Number(i.unit_price ?? 0) * Number(i.quantity ?? 1))).toLocaleString('en-PK');
                return `${i.quantity}x ${name}${variant} — Rs. ${lineTotal}`;
            }).join('\n');
        }

        const subtotal = Number(order.pricing?.subtotal ?? order.subtotal ?? 0).toLocaleString('en-PK');
        const discountTotal = Number(order.pricing?.discountTotal ?? order.discount_total ?? 0);
        const deliveryFee = Number(order.pricing?.deliveryFee ?? order.delivery_fee ?? 0).toLocaleString('en-PK');
        const total = Number(order.pricing?.total ?? order.total ?? order.final_total ?? 0).toLocaleString('en-PK');
        const rawPayment = order.payment?.method || order.payment_method || 'COD';
        const paymentMethod = String(rawPayment).toUpperCase() === 'COD' ? 'Cash on Delivery (COD)' : 'EasyPaisa';

        const lat = order.delivery?.latitude ?? order.latitude;
        const lng = order.delivery?.longitude ?? order.longitude;
        let locationBlock = '';
        if (lat != null && lng != null) {
            locationBlock = `Delivery Location:\nLatitude: ${lat}\nLongitude: ${lng}\nGoogle Maps: https://www.google.com/maps?q=${lat},${lng}`;
        } else {
            let addr = order.delivery?.address || order.delivery_address || 'Google Maps Location Pin';
            addr = addr.replace(/^customer\s*ne\s*location\s*(?:share\s*ki|pin)?\s*[:=-]?\s*/i, '').trim();
            locationBlock = `Delivery Location:\nAddress: ${addr}`;
        }

        const messageText = 
`NEW CONFIRMED ORDER — CRAVEY CRUST
Order ID: ${orderId}
Status: Confirmed
Customer Name: ${customerName}
Customer Phone: ${customerPhone}
Items:
${itemsLines || '• 1x Order'}
Subtotal: Rs. ${subtotal}
${discountTotal > 0 ? `Discount: -Rs. ${discountTotal.toLocaleString('en-PK')}\n` : ''}Delivery Charges: Rs. ${deliveryFee}
Total: Rs. ${total}
Payment Method: ${paymentMethod}
${locationBlock}

Please review and process this order.`;

        for (const adminJid of recipients) {
            await activeSock.sendMessage(adminJid, { text: messageText });
            logger.info({ orderNumber: orderId, adminJid }, '[NOTIFY] Admin WhatsApp notification sent with full order details');
        }
        return { success: true };
    } catch (err) {
        logger.error({ err: err.message, orderNumber: order?.order_number || order?.orderNumber }, '[NOTIFY] Failed to send admin new order notification');
        return { success: false, error: err.message };
    }
}

/**
 * Send WhatsApp status update notification to the customer
 *
 * @param {Object} params
 * @param {Object} params.order
 * @param {string} params.newStatus
 * @param {string} [params.reason]
 * @param {Object} [params.sock]
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function sendCustomerOrderStatusNotification({ order, newStatus, reason, sock }) {
    try {
        if (!order) return { success: false, error: 'No order provided' };

        const orderNumber = order.orderNumber || order.order_number;
        const targetPhone = order.phone || order.customer?.phone || order.whatsappPhone || order.whatsapp_phone;
        const customerJid = formatPhoneToJid(targetPhone);
        if (!customerJid) {
            logger.warn({ orderNumber }, '[NOTIFY] Customer status notification skipped: No valid customer phone');
            return { success: false, error: 'No valid customer phone' };
        }

        const activeSock = resolveSocket(sock);
        if (!activeSock) {
            logger.warn({ orderNumber }, '[NOTIFY] Customer status notification skipped: WhatsApp socket not connected');
            return { success: false, error: 'WhatsApp socket not connected' };
        }

        let statusMessage = '';
        switch (newStatus) {
            case 'CONFIRMED':
                statusMessage = `Aap ka order #${orderNumber} confirm ho chuka hai. Hum jald is par kaam shuru kar rahe hain!`;
                break;
            case 'PREPARING':
                statusMessage = `Aap ka order #${orderNumber} kitchen mein prepare ho raha hai!`;
                break;
            case 'READY':
                statusMessage = `Aap ka order #${orderNumber} ready hai aur packing complete ho chuki hai!`;
                break;
            case 'OUT_FOR_DELIVERY':
                statusMessage = `Aap ka order #${orderNumber} delivery rider ke paas hai aur aap ki taraf nikal chuka hai!`;
                break;
            case 'DELIVERED':
                statusMessage = `Aap ka order #${orderNumber} successfully deliver ho gaya hai. Hum se order karne ka shukriya! Apne feedback se zaroor aagah kijiyega.`;
                break;
            case 'CANCELLED':
                statusMessage = `Aap ka order #${orderNumber} cancel kar diya gaya hai.${reason ? ` Reason: ${reason}` : ''}`;
                break;
            default:
                statusMessage = `Aap ke order #${orderNumber} ka status update ho kar ${newStatus} ho gaya hai.`;
        }

        await activeSock.sendMessage(customerJid, { text: statusMessage });
        logger.info({ orderNumber, newStatus, customerJid }, '[NOTIFY] Customer status notification sent');
        return { success: true };
    } catch (err) {
        logger.error({ err: err.message, orderNumber: order?.order_number }, '[NOTIFY] Failed to send customer status notification');
        return { success: false, error: err.message };
    }
}

/**
 * Send WhatsApp notification to Admin/Support when an order is cancelled
 *
 * @param {Object} params
 * @param {Object} params.order
 * @param {string} [params.reason]
 * @param {string} [params.restaurantId]
 * @param {Object} [params.sock]
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function sendAdminOrderCancelledNotification({ order, reason = 'Customer cancelled', restaurantId, sock }) {
    try {
        if (!order) return { success: false, error: 'No order provided' };

        const prisma = getDbClient();
        const restId = restaurantId || order.restaurantId || order.restaurant_id || await getDefaultRestaurantId();

        const { recipients, activeSock, configuredPhone } = await getDynamicAdminRecipients({ restaurantId: restId, sock });

        if (recipients.size === 0) {
            logger.warn({ orderNumber: order.order_number || order.orderNumber }, '[NOTIFY] Admin cancellation alert skipped: No valid admin phone configured');
            return { success: false, error: 'No valid admin phone configured' };
        }

        if (!activeSock) {
            logger.warn({ orderNumber: order.order_number || order.orderNumber }, '[NOTIFY] Admin cancellation alert skipped: WhatsApp socket not connected');
            return { success: false, error: 'WhatsApp socket not connected' };
        }

        if (configuredPhone) {
            logger.info({ configuredPhone, orderNumber: order.order_number || order.orderNumber }, '[NOTIFY] Order cancellation alert routed dynamically to Support Agent WhatsApp Number');
        }

        // Enrich order if missing items or customer details
        let enrichedOrder = order;
        if (prisma && (!order.items || order.items.length === 0) && (!order.order_items || order.order_items.length === 0)) {
            try {
                const { getOrderByNumber } = await import('./orderService.js');
                const full = await getOrderByNumber({ restaurantId: restId, orderNumber: order.order_number || order.orderNumber, orderId: order.id });
                if (full) enrichedOrder = full;
            } catch (_) {}
        }

        const orderId = enrichedOrder.orderNumber || enrichedOrder.order_number;
        const customerName = enrichedOrder.customerName || enrichedOrder.customer_name || enrichedOrder.customer?.name || 'Customer';
        const customerPhone = enrichedOrder.phone || enrichedOrder.customer?.phone || enrichedOrder.whatsapp_phone || enrichedOrder.whatsappPhone || '';

        let itemsLines = '';
        if (Array.isArray(enrichedOrder.items) && enrichedOrder.items.length > 0) {
            itemsLines = enrichedOrder.items.map(i => {
                const name = i.dealName || i.itemName || i.item_name_snapshot || 'Item';
                const variant = i.variantName || i.variant_name_snapshot ? ` (${i.variantName || i.variant_name_snapshot})` : '';
                const lineTotal = Number(i.lineTotal ?? i.line_total ?? (Number(i.unitPrice ?? i.unit_price ?? 0) * Number(i.quantity ?? 1))).toLocaleString('en-PK');
                return `${i.quantity}x ${name}${variant} — Rs. ${lineTotal}`;
            }).join('\n');
        } else if (Array.isArray(enrichedOrder.order_items) && enrichedOrder.order_items.length > 0) {
            itemsLines = enrichedOrder.order_items.map(i => {
                const name = i.deal_name_snapshot || i.deal?.name || i.item_name_snapshot || i.menu_item?.name || 'Item';
                const variant = i.variant_name_snapshot || i.menu_variant?.name ? ` (${i.variant_name_snapshot || i.menu_variant?.name})` : '';
                const lineTotal = Number(i.line_total ?? (Number(i.unit_price ?? 0) * Number(i.quantity ?? 1))).toLocaleString('en-PK');
                return `${i.quantity}x ${name}${variant} — Rs. ${lineTotal}`;
            }).join('\n');
        }

        const subtotal = Number(enrichedOrder.pricing?.subtotal ?? enrichedOrder.subtotal ?? 0).toLocaleString('en-PK');
        const deliveryFee = Number(enrichedOrder.pricing?.deliveryFee ?? enrichedOrder.delivery_fee ?? 0).toLocaleString('en-PK');
        const total = Number(enrichedOrder.pricing?.total ?? enrichedOrder.total ?? enrichedOrder.final_total ?? 0).toLocaleString('en-PK');
        const rawPayment = enrichedOrder.payment?.method || enrichedOrder.payment_method || 'COD';
        const paymentMethod = String(rawPayment).toUpperCase() === 'COD' ? 'Cash on Delivery (COD)' : 'EasyPaisa';

        const lat = enrichedOrder.delivery?.latitude ?? enrichedOrder.latitude;
        const lng = enrichedOrder.delivery?.longitude ?? enrichedOrder.longitude;
        let locationBlock = '';
        if (lat != null && lng != null) {
            locationBlock = `Delivery Location:\nLatitude: ${lat}\nLongitude: ${lng}\nGoogle Maps: https://www.google.com/maps?q=${lat},${lng}`;
        } else {
            let addr = enrichedOrder.delivery?.address || enrichedOrder.delivery_address || 'Google Maps Location Pin';
            addr = addr.replace(/^customer\s*ne\s*location\s*(?:share\s*ki|pin)?\s*[:=-]?\s*/i, '').trim();
            locationBlock = `Delivery Location:\nAddress: ${addr}`;
        }

        const cancelMessageText = 
`❌ ORDER CANCELLED — CRAVEY CRUST
Order ID: ${orderId}
Status: CANCELLED
Reason / Wajah: ${reason || 'Customer cancelled'}
Customer Name: ${customerName}
Customer Phone: ${customerPhone}
Items:
${itemsLines || '• 1x Order'}
Subtotal: Rs. ${subtotal}
Delivery Charges: Rs. ${deliveryFee}
Total Bill: Rs. ${total}
Payment Method: ${paymentMethod}
${locationBlock}

⚠️ Alert: Yeh order cancel ho chuka hai. Please kitchen aur delivery team ko update kar dein.`;

        for (const adminJid of recipients) {
            await activeSock.sendMessage(adminJid, { text: cancelMessageText });
            logger.info({ orderNumber: orderId, adminJid }, '[NOTIFY] Admin WhatsApp order cancellation alert sent');
        }

        return { success: true };
    } catch (err) {
        logger.error({ err: err.message, orderNumber: order?.order_number || order?.orderNumber }, '[NOTIFY] Failed to send admin order cancellation alert');
        return { success: false, error: err.message };
    }
}

/**
 * Send cancellation notification to admin/support agent and optionally customer.
 * Default notifyCustomer: false ensures customer only receives the single direct bot reply.
 */
/**
 * Send WhatsApp notification to Admin/Support when customer REQUESTS cancellation of an active order.
 * Forwards customer details, order number, and items to admin immediately.
 */
export async function sendAdminOrderCancellationRequest({ order, reason = 'Customer requested cancellation via WhatsApp', restaurantId, sock, customerPhone: overridePhone }) {
    try {
        if (!order) return { success: false, error: 'No order provided' };

        const prisma = getDbClient();
        const restId = restaurantId || order.restaurantId || order.restaurant_id || await getDefaultRestaurantId();

        const { recipients, activeSock, configuredPhone } = await getDynamicAdminRecipients({ restaurantId: restId, sock });

        if (recipients.size === 0) {
            logger.warn({ orderNumber: order.order_number || order.orderNumber }, '[NOTIFY] Admin cancellation request alert skipped: No valid admin phone configured');
            return { success: false, error: 'No valid admin phone configured' };
        }

        if (!activeSock) {
            logger.warn({ orderNumber: order.order_number || order.orderNumber }, '[NOTIFY] Admin cancellation request alert skipped: WhatsApp socket not connected');
            return { success: false, error: 'WhatsApp socket not connected' };
        }

        // Enrich order if missing items or customer details
        let enrichedOrder = order;
        if (prisma && (!order.items || order.items.length === 0) && (!order.order_items || order.order_items.length === 0)) {
            try {
                const { getOrderByNumber } = await import('./orderService.js');
                const full = await getOrderByNumber({ restaurantId: restId, orderNumber: order.order_number || order.orderNumber, orderId: order.id });
                if (full) enrichedOrder = full;
            } catch (_) {}
        }

        const orderId = enrichedOrder.orderNumber || enrichedOrder.order_number;
        const customerName = enrichedOrder.customerName || enrichedOrder.customer_name || enrichedOrder.customer?.name || 'Customer';
        const customerPhone = overridePhone || enrichedOrder.phone || enrichedOrder.customer?.phone || enrichedOrder.whatsapp_phone || enrichedOrder.whatsappPhone || '';

        let itemsLines = '';
        if (Array.isArray(enrichedOrder.items) && enrichedOrder.items.length > 0) {
            itemsLines = enrichedOrder.items.map(i => {
                const name = i.dealName || i.itemName || i.item_name_snapshot || 'Item';
                const variant = i.variantName || i.variant_name_snapshot ? ` (${i.variantName || i.variant_name_snapshot})` : '';
                const lineTotal = Number(i.lineTotal ?? i.line_total ?? (Number(i.unitPrice ?? i.unit_price ?? 0) * Number(i.quantity ?? 1))).toLocaleString('en-PK');
                return `• ${i.quantity}x ${name}${variant} — Rs. ${lineTotal}`;
            }).join('\n');
        } else if (Array.isArray(enrichedOrder.order_items) && enrichedOrder.order_items.length > 0) {
            itemsLines = enrichedOrder.order_items.map(i => {
                const name = i.deal_name_snapshot || i.deal?.name || i.item_name_snapshot || i.menu_item?.name || 'Item';
                const variant = i.variant_name_snapshot || i.menu_variant?.name ? ` (${i.variant_name_snapshot || i.menu_variant?.name})` : '';
                const lineTotal = Number(i.line_total ?? (Number(i.unit_price ?? 0) * Number(i.quantity ?? 1))).toLocaleString('en-PK');
                return `• ${i.quantity}x ${name}${variant} — Rs. ${lineTotal}`;
            }).join('\n');
        }

        const total = Number(enrichedOrder.pricing?.total ?? enrichedOrder.total ?? enrichedOrder.final_total ?? 0).toLocaleString('en-PK');

        const requestText = 
`🚨 *CUSTOMER ORDER CANCELLATION REQUEST!*
Customer ne WhatsApp bot par apna order cancel karne ki request ki hai:

• Order Number: *#${orderId}*
• Current Status: *${enrichedOrder.order_status || 'CONFIRMED'}*
• Customer Name: *${customerName}*
• Customer Phone: *${customerPhone}*
• Total Bill: *Rs. ${total}*
• Items:
${itemsLines || '• Food items'}

⚠️ *Action Required:* Baraye meherbani customer se foran rabta karein ya Store Dashboard se order cancellation review/process karein.`;

        for (const adminJid of recipients) {
            await activeSock.sendMessage(adminJid, { text: requestText });
            logger.info({ orderNumber: orderId, adminJid }, '[NOTIFY] Admin WhatsApp order cancellation request forwarded');
        }

        return { success: true };
    } catch (err) {
        logger.error({ err: err.message, orderNumber: order?.order_number || order?.orderNumber }, '[NOTIFY] Failed to forward cancellation request to admin');
        return { success: false, error: err.message };
    }
}

export async function sendCancellationNotification({ order, reason, sock, notifyCustomer = false }) {
    const results = { customer: null, admin: null };
    if (notifyCustomer) {
        try {
            results.customer = await sendCustomerOrderStatusNotification({ order, newStatus: 'CANCELLED', reason, sock });
        } catch (err) {
            logger.error({ err: err.message }, '[NOTIFY] Error sending customer cancellation notification');
        }
    }
    try {
        results.admin = await sendAdminOrderCancelledNotification({ order, reason, sock });
    } catch (err) {
        logger.error({ err: err.message }, '[NOTIFY] Error sending admin order cancellation alert');
    }
    return results;
}

/**
 * Send human handover alert to the scanned WhatsApp number and configured admin/owner
 */
export async function sendAdminHandoverAlert({ customerChatId, sessionKey, customerPhone, customerName, durationMinutes = 120, reason = 'Human representative requested', sock }) {
    try {
        const prisma = getDbClient();

        // 1. Check if human handoff is enabled or custom mute minutes configured
        try {
            const restId = await getDefaultRestaurantId();
            if (prisma && restId) {
                const settings = await prisma.restaurantSetting.findMany({
                    where: {
                        restaurant_id: restId,
                        key: { in: ['human_handoff_enabled', 'human_handoff_mute_minutes'] }
                    }
                });
                const sMap = {};
                settings.forEach(s => { sMap[s.key] = s.value; });

                if (sMap.human_handoff_enabled === 'false') {
                    logger.info({ customerChatId }, '[HANDOVER] Human handoff disabled in store settings');
                    return { success: false, disabled: true };
                }

                if (sMap.human_handoff_mute_minutes && !isNaN(parseInt(sMap.human_handoff_mute_minutes, 10)) && parseInt(sMap.human_handoff_mute_minutes, 10) > 0) {
                    durationMinutes = parseInt(sMap.human_handoff_mute_minutes, 10);
                }
            }
        } catch (err) {
            logger.warn({ err: err.message }, '[HANDOVER] Error reading handoff settings');
        }

        // 2. Resolve recipients dynamically using the same unified helper
        const { recipients, activeSock, configuredPhone } = await getDynamicAdminRecipients({ sock });

        if (!activeSock) {
            logger.warn({ customerChatId }, '[HANDOVER] Admin alert skipped: WhatsApp socket not connected');
            return { success: false, error: 'WhatsApp socket not connected' };
        }

        if (recipients.size === 0) {
            logger.warn({ customerChatId }, '[HANDOVER] Admin alert skipped: No valid scanned or configured recipient found');
            return { success: false, error: 'No valid recipient phone found' };
        }

        if (configuredPhone) {
            logger.info({ configuredPhone, customerChatId }, '[HANDOVER] Human handover alert routed dynamically to Support Agent WhatsApp Number');
        }

        // Format customer phone & direct chat link
        let cleanCustomerDigits = (customerPhone || '').replace(/\D/g, '');
        // NEVER extract phone digits from a LID identifier
        if (!cleanCustomerDigits && customerChatId && !customerChatId.includes('@lid')) {
            cleanCustomerDigits = customerChatId.split('@')[0]?.split(':')[0]?.replace(/\D/g, '');
        }
        if (cleanCustomerDigits.startsWith('03')) {
            cleanCustomerDigits = '92' + cleanCustomerDigits.slice(1);
        }

        // If phone is missing or looks like LID digits, check DB session for real verified phone
        if (!cleanCustomerDigits || cleanCustomerDigits.length < 10 || cleanCustomerDigits.length > 13) {
            try {
                if (prisma && customerChatId) {
                    const session = await prisma.conversationSession.findFirst({
                        where: {
                            OR: [
                                { chat_id: customerChatId },
                                { session_key: customerChatId },
                            ],
                        },
                        select: {
                            verified_phone: true,
                        },
                    });
                    const foundPhone = session?.verified_phone;
                    if (foundPhone) {
                        let digits = String(foundPhone).replace(/\D/g, '');
                        if (digits.startsWith('03')) digits = '92' + digits.slice(1);
                        else if (digits.startsWith('3') && digits.length === 10) digits = '92' + digits;
                        if (digits.length >= 10 && digits.length <= 13) {
                            cleanCustomerDigits = digits;
                        }
                    }

                    if (cleanCustomerDigits) {
                        const cust = await prisma.customer.findFirst({
                            where: {
                                OR: [
                                    { whatsapp_phone: cleanCustomerDigits },
                                    { phone: cleanCustomerDigits },
                                    { whatsapp_phone: `+${cleanCustomerDigits}` },
                                ],
                            },
                            select: { name: true, phone: true },
                        }).catch(() => null);
                        if (cust?.name && !customerName) customerName = cust.name;
                    }
                }
            } catch (_) {}
        }

        // Verify if it's a real phone number (Pakistani or international, never LID)
        const isRealPhone = cleanCustomerDigits.length >= 10 && cleanCustomerDigits.length <= 13;
        const waLink = isRealPhone ? `https://wa.me/${cleanCustomerDigits}` : null;
        const displayPhone = isRealPhone
            ? (cleanCustomerDigits.startsWith('92') ? '0' + cleanCustomerDigits.slice(2) : cleanCustomerDigits)
            : `Number private / hidden hai (${customerChatId})`;
        const displayName = customerName && String(customerName).trim() ? String(customerName).trim() : 'Customer';

        // Retrieve recent chat history for context
        let chatSummarySection = '';
        try {
            const { getSessionHistory } = await import('./sessionService.js');
            const history = getSessionHistory(sessionKey || customerChatId) || [];
            if (history.length > 0) {
                const recent = history.slice(-6);
                const lines = recent.map(m => {
                    const roleLabel = m.role === 'user' ? '👤 Customer' : '🤖 Bot';
                    const textSnippet = (m.content || '').replace(/\s+/g, ' ').slice(0, 100);
                    return `${roleLabel}: "${textSnippet}"`;
                });
                chatSummarySection = `\n📝 *Recent Chat Summary:*\n${lines.join('\n')}\n`;
            }
        } catch (_) {}

        // Retrieve recent order for context
        let recentOrderSection = '';
        try {
            if (prisma) {
                const lookupPhone = cleanCustomerDigits || '';
                    const orConds = [];
                    if (customerChatId) orConds.push({ source_chat_id: customerChatId });
                    if (sessionKey) {
                        orConds.push({ source_session_id: sessionKey });
                        orConds.push({ source_chat_id: sessionKey });
                    }
                    if (lookupPhone) {
                        orConds.push({ phone: lookupPhone });
                        orConds.push({ whatsapp_phone: lookupPhone });
                    }
                    const ord = orConds.length > 0 ? await prisma.order.findFirst({
                        where: {
                            OR: orConds,
                        },
                        orderBy: { created_at: 'desc' },
                        select: { order_number: true, order_status: true, total: true },
                    }) : null;
                if (ord) {
                    recentOrderSection = `📦 *Recent Order:* #${ord.order_number} (${ord.order_status} — Rs. ${Number(ord.total)})\n`;
                }
            }
        } catch (_) {}

        const alertText = 
`🚨 *HUMAN HANDOVER REQUEST* 🚨

Aap ke WhatsApp bot par aik customer ne real support agent se baat karne ki request ki hai:

👤 *Customer:* ${displayName}
📱 *Phone Number:* ${displayPhone}
${waLink ? `💬 *Direct Chat Link:* ${waLink}\n` : ''}❓ *Wajah / Reason:* ${reason}
${recentOrderSection}${chatSummarySection}⏱️ *Bot Status:* Muted (Agley ${durationMinutes} minutes tak bot is customer ko auto-reply nahi karega)

👉 *Action:* Aap direct customer ke number par ya diye gaye chat link par rabta kar saktay hain.
💡 *Bot Resume:* Baat mukammal honay ke baad chat mein \`bot start\` ya \`.unmute\` likh kar bot dobara on kar saktay hain.`;

        let sentCount = 0;
        for (const recipientJid of recipients) {
            try {
                await activeSock.sendMessage(recipientJid, { text: alertText });
                sentCount++;
                logger.info({ customerChatId, recipientJid }, '[HANDOVER] Handover alert dispatched to recipient');
            } catch (sendErr) {
                logger.error({ err: sendErr.message, recipientJid }, '[HANDOVER] Failed sending alert to recipient');
            }
        }

        return { success: sentCount > 0, recipients: Array.from(recipients) };
    } catch (err) {
        logger.error({ err: err.message, customerChatId }, '[HANDOVER] Failed to send admin handover alert');
        return { success: false, error: err.message };
    }
}

