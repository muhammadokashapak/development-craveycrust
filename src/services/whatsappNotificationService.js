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

        const prisma = getDbClient();
        const restId = restaurantId || order.restaurant_id || await getDefaultRestaurantId();

        const recipients = new Set();

        // 1. Env candidates
        const envCandidates = [
            process.env.OWNER_NUMBER,
            process.env.ADMIN_NOTIFICATION_PHONE,
            process.env.ADMIN_PHONE,
            process.env.OWNER_PHONE,
        ];
        for (const num of envCandidates) {
            const jid = formatPhoneToJid(num);
            if (jid) recipients.add(jid);
        }

        // 2. Database candidates
        if (prisma) {
            try {
                const restaurant = await prisma.restaurant.findUnique({
                    where: { id: restId },
                    select: { admin_notification_phone: true, phone: true },
                });
                const dbAdminJid = formatPhoneToJid(restaurant?.admin_notification_phone);
                if (dbAdminJid) recipients.add(dbAdminJid);
                const dbPhoneJid = formatPhoneToJid(restaurant?.phone);
                if (dbPhoneJid) recipients.add(dbPhoneJid);
            } catch (_) {}
        }

        if (recipients.size === 0) {
            logger.warn({ orderNumber: order.order_number }, '[NOTIFY] Admin notification skipped: No valid admin phone configured');
            return { success: false, error: 'No valid admin phone configured' };
        }

        const activeSock = resolveSocket(sock);
        if (!activeSock) {
            logger.warn({ orderNumber: order.order_number }, '[NOTIFY] Admin notification skipped: WhatsApp socket not connected');
            return { success: false, error: 'WhatsApp socket not connected' };
        }

        const customerName = order.customerName || order.customer_name || order.customer?.name || 'Customer';
        const total = order.pricing?.total != null 
            ? Number(order.pricing.total).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) 
            : (order.final_total != null ? Number(order.final_total).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00');
        const areaName = order.delivery?.areaName || order.delivery_area_name || order.delivery_address || 'Delivery Area';
        const payment = order.payment?.method || order.payment_method || 'COD';

        const messageText = 
`New Order Received

Order: #${order.orderNumber || order.order_number}
Customer: ${customerName}
Total: Rs.${total}
Area: ${areaName}
Payment: ${payment}

View in dashboard: http://localhost:3000`;

        for (const adminJid of recipients) {
            await activeSock.sendMessage(adminJid, { text: messageText });
            logger.info({ orderNumber: order.order_number, adminJid }, '[NOTIFY] Admin WhatsApp notification sent');
        }
        return { success: true };
    } catch (err) {
        // Notification failure must NEVER rollback or throw
        logger.error({ err: err.message, orderNumber: order?.order_number }, '[NOTIFY] Failed to send admin new order notification');
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
 * Send cancellation notification
 */
export async function sendCancellationNotification({ order, reason, sock }) {
    return sendCustomerOrderStatusNotification({ order, newStatus: 'CANCELLED', reason, sock });
}

/**
 * Send human handover alert to the scanned WhatsApp number and configured admin/owner
 */
export async function sendAdminHandoverAlert({ customerChatId, customerPhone, customerName, durationMinutes = 120, reason = 'Human representative requested', sock }) {
    try {
        const activeSock = resolveSocket(sock);
        if (!activeSock) {
            logger.warn({ customerChatId }, '[HANDOVER] Admin alert skipped: WhatsApp socket not connected');
            return { success: false, error: 'WhatsApp socket not connected' };
        }

        const recipients = new Set();
        const prisma = getDbClient();

        // 1. Check designated Human Handoff support phone from Settings
        let humanHandoffEnabled = true;
        try {
            const restId = await getDefaultRestaurantId();
            if (prisma && restId) {
                const settings = await prisma.restaurantSetting.findMany({
                    where: {
                        restaurant_id: restId,
                        key: { in: ['human_handoff_enabled', 'human_handoff_phone', 'human_handoff_message', 'human_handoff_mute_minutes'] }
                    }
                });
                const sMap = {};
                settings.forEach(s => { sMap[s.key] = s.value; });

                if (sMap.human_handoff_enabled === 'false') {
                    humanHandoffEnabled = false;
                    logger.info({ customerChatId }, '[HANDOVER] Human handoff disabled in store settings');
                    return { success: false, disabled: true };
                }

                if (sMap.human_handoff_phone) {
                    const agentJid = formatPhoneToJid(sMap.human_handoff_phone);
                    if (agentJid) {
                        recipients.add(agentJid);
                        logger.info({ agentJid, rawPhone: sMap.human_handoff_phone }, '[HANDOVER] Support agent added to alert recipients');
                    } else {
                        logger.warn({ rawPhone: sMap.human_handoff_phone }, '[HANDOVER] Invalid support agent phone in settings');
                    }
                }

                if (sMap.human_handoff_mute_minutes && !isNaN(parseInt(sMap.human_handoff_mute_minutes, 10)) && parseInt(sMap.human_handoff_mute_minutes, 10) > 0) {
                    durationMinutes = parseInt(sMap.human_handoff_mute_minutes, 10);
                }
            }
        } catch (err) {
            logger.warn({ err: err.message }, '[HANDOVER] Error reading handoff settings');
        }

        // 2. Check explicit admin/owner notification numbers from .env
        const envCandidates = [
            process.env.OWNER_NUMBER,
            process.env.ADMIN_NOTIFICATION_PHONE,
            process.env.ADMIN_PHONE,
            process.env.OWNER_PHONE,
        ];
        for (const num of envCandidates) {
            const jid = formatPhoneToJid(num);
            if (jid) recipients.add(jid);
        }

        // 3. Also check if an explicit admin notification number is set in Restaurant model
        try {
            const prisma = getDbClient();
            const restId = await getDefaultRestaurantId();
            if (prisma && restId) {
                const restaurant = await prisma.restaurant.findUnique({
                    where: { id: restId },
                    select: { admin_notification_phone: true, phone: true },
                });
                const dbAdminJid = formatPhoneToJid(restaurant?.admin_notification_phone);
                if (dbAdminJid) recipients.add(dbAdminJid);
                const dbPhoneJid = formatPhoneToJid(restaurant?.phone);
                if (dbPhoneJid) recipients.add(dbPhoneJid);
            }
        } catch (_) {}

        // 4. Automatically detect the phone number that scanned the QR code (this bot's logged-in account)
        const scannedRaw = activeSock.user?.id || activeSock.authState?.creds?.me?.id || '';
        const scannedDigits = scannedRaw.split('@')[0]?.split(':')[0]?.replace(/\D/g, '');
        const scannedJid = formatPhoneToJid(scannedDigits);
        if (scannedJid) {
            recipients.add(scannedJid);
        }

        if (recipients.size === 0) {
            logger.warn({ customerChatId }, '[HANDOVER] Admin alert skipped: No valid scanned or configured recipient found');
            return { success: false, error: 'No valid recipient phone found' };
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

        const alertText = 
`🚨 *HUMAN HANDOVER REQUEST* 🚨

Aap ke WhatsApp bot par aik customer ne real support agent se baat karne ki request ki hai:

👤 *Customer:* ${displayName}
📱 *Phone Number:* ${displayPhone}
${waLink ? `💬 *Direct Chat Link:* ${waLink}\n` : ''}❓ *Wajah / Reason:* ${reason}
${chatSummarySection}⏱️ *Bot Status:* Muted (Agley ${durationMinutes} minutes tak bot is customer ko auto-reply nahi karega)

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

