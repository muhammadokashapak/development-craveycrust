import { getDbClient } from '../db/client.js';
import { clearCart } from './cartService.js';
import { sendAdminHandoverAlert } from './whatsappNotificationService.js';
import { getDefaultRestaurantId } from './restaurantService.js';
import { logger } from '../utils/logger.js';

// In-memory store of active human handover mutes
// Key: normalized phone or JID (e.g. "923001234567")
// Value: { chatId, phone, sessionKey, mutedAt, mutedUntil, durationMinutes, reason }
const mutedChats = new Map();

/**
 * Normalizes phone or WhatsApp JID to plain digits for consistent matching
 */
export function normalizePhoneOrJid(identifier) {
    if (!identifier || typeof identifier !== 'string') return '';
    const clean = identifier.trim().toLowerCase();
    // NEVER convert @lid JID to phone digits!
    if (clean.includes('@lid')) return '';
    // Extract digits before @
    const userPart = clean.includes('@') ? clean.split('@')[0] : clean;
    // Strip device suffix (e.g. 923001234567:1 -> 923001234567)
    const basePart = userPart.split(':')[0];
    let digits = basePart.replace(/\D/g, '');
    if (digits.startsWith('03')) {
        digits = '92' + digits.slice(1);
    }
    return digits;
}

/**
 * Read configured human handoff mute duration (in minutes) from database
 */
export async function getHandoffMuteMinutes() {
    try {
        const prisma = getDbClient();
        const restId = await getDefaultRestaurantId();
        if (prisma && restId) {
            const setting = await prisma.restaurantSetting.findFirst({
                where: { restaurant_id: restId, key: 'human_handoff_mute_minutes' }
            });
            if (setting && !isNaN(parseInt(setting.value, 10)) && parseInt(setting.value, 10) > 0) {
                return parseInt(setting.value, 10);
            }
        }
    } catch (_) {}
    return 120;
}

/**
 * Mute a chat for human handover (dynamically configured via dashboard)
 * and clear active cart/session memory so unconfirmed orders don't linger.
 */
export async function muteChatForHandover({ chatId, sessionKey, durationMinutes, reason = 'Customer requested human support', customerName, customerPhone, sock }) {
    const rawChatId = (chatId || '').trim();
    const rawSessionKey = (sessionKey || '').trim();
    const phoneDigits = normalizePhoneOrJid(customerPhone) || normalizePhoneOrJid(rawChatId) || normalizePhoneOrJid(rawSessionKey);

    let effectiveDuration = Number(durationMinutes);
    if (!effectiveDuration || isNaN(effectiveDuration) || durationMinutes === 120 || durationMinutes == null) {
        effectiveDuration = await getHandoffMuteMinutes();
    }

    const now = new Date();
    const durationMs = effectiveDuration * 60 * 1000;
    const mutedUntil = new Date(now.getTime() + durationMs);

    const record = {
        chatId: rawChatId,
        phone: phoneDigits,
        sessionKey: rawSessionKey,
        mutedAt: now,
        mutedUntil,
        durationMinutes: effectiveDuration,
        reason,
    };

    // Store under both raw chatId and normalized digits for robust matching
    if (rawChatId) mutedChats.set(rawChatId, record);
    if (phoneDigits) mutedChats.set(phoneDigits, record);
    if (rawChatId && !rawChatId.endsWith('@s.whatsapp.net') && phoneDigits) {
        mutedChats.set(`${phoneDigits}@s.whatsapp.net`, record);
    }

    logger.info({ rawChatId, phoneDigits, mutedUntil, durationMinutes: effectiveDuration }, '[HANDOVER] Chat muted for human support');

    let resolvedCustomerName = customerName || null;
    let resolvedCustomerPhone = (customerPhone && !String(customerPhone).includes('@lid') ? normalizePhoneOrJid(customerPhone) : null) || phoneDigits || null;
    if (resolvedCustomerPhone && (resolvedCustomerPhone.includes('@lid') || resolvedCustomerPhone.length > 13 || resolvedCustomerPhone.length < 10)) {
        resolvedCustomerPhone = null;
    }

    // ── 1. Clear Active Cart & Memory in Database ──
    try {
        const prisma = getDbClient();
        if (prisma) {
            // Find session by sessionKey or chat_id
            const sessionQuery = [];
            if (rawSessionKey) sessionQuery.push({ session_key: rawSessionKey });
            if (rawChatId) sessionQuery.push({ chat_id: rawChatId });
            if (phoneDigits) sessionQuery.push({ verified_phone: phoneDigits });

            if (sessionQuery.length > 0) {
                const sessions = await prisma.conversationSession.findMany({
                    where: { OR: sessionQuery },
                    select: {
                        id: true,
                        session_key: true,
                        verified_phone: true,
                    },
                });

                if (!resolvedCustomerPhone && sessions.length > 0) {
                    resolvedCustomerPhone = sessions.find(s => s.verified_phone)?.verified_phone || null;
                }

                if (phoneDigits || resolvedCustomerPhone) {
                    const lookupPhone = phoneDigits || resolvedCustomerPhone;
                    const cust = await prisma.customer.findFirst({
                        where: {
                            OR: [
                                { whatsapp_phone: lookupPhone },
                                { phone: lookupPhone },
                                { whatsapp_phone: `+${lookupPhone}` },
                            ],
                        },
                        select: { name: true, phone: true },
                    }).catch(() => null);

                    if (cust?.name && !resolvedCustomerName) resolvedCustomerName = cust.name;
                    if (cust?.phone && !resolvedCustomerPhone) resolvedCustomerPhone = cust.phone;
                }

                for (const s of sessions) {
                    // Reset session stage and clear pending orders
                    await prisma.conversationSession.update({
                        where: { id: s.id },
                        data: {
                            stage: 'START',
                            pending_order_id: null,
                            pending_cancel_order_id: null,
                            last_activity_at: now,
                        },
                    }).catch(() => {});

                    // Mark active carts as ABANDONED
                    await prisma.cart.updateMany({
                        where: { session_id: s.id, status: 'ACTIVE' },
                        data: { status: 'ABANDONED' },
                    }).catch(() => {});
                }
            }
        }

        // Also call clearCart if sessionKey provided
        if (rawSessionKey) {
            await clearCart({ sessionKey: rawSessionKey }).catch(() => {});
        }
    } catch (err) {
        logger.warn({ err: err.message }, '[HANDOVER] Non-fatal error while clearing cart memory');
    }

    // ── 2. Send Admin Notification via WhatsApp ──
    sendAdminHandoverAlert({
        customerChatId: rawChatId,
        sessionKey: rawSessionKey,
        customerPhone: resolvedCustomerPhone,
        customerName: resolvedCustomerName,
        durationMinutes: record.durationMinutes,
        reason,
        sock,
    }).catch(() => {});

    return {
        success: true,
        muted: true,
        chatId: rawChatId,
        phone: phoneDigits,
        mutedAt: now.toISOString(),
        mutedUntil: mutedUntil.toISOString(),
        durationMinutes: record.durationMinutes,
        message: `Chat is muted for ${record.durationMinutes} minutes. Bot will not respond, and cart memory has been cleared.`,
    };
}

/**
 * Check if a chat or phone number is currently muted
 */
export function isChatMuted(identifier) {
    if (!identifier) return { isMuted: false };

    const raw = (identifier || '').trim();
    const digits = normalizePhoneOrJid(raw);

    const record = mutedChats.get(raw) || (digits ? mutedChats.get(digits) : null);
    if (!record) {
        return { isMuted: false };
    }

    const now = new Date();
    if (record.mutedUntil <= now) {
        // Expired -> clean up
        mutedChats.delete(raw);
        if (digits) mutedChats.delete(digits);
        return { isMuted: false };
    }

    const remainingMs = record.mutedUntil.getTime() - now.getTime();
    const remainingMinutes = Math.max(1, Math.ceil(remainingMs / (60 * 1000)));

    return {
        isMuted: true,
        remainingMinutes,
        mutedUntil: record.mutedUntil,
        reason: record.reason,
    };
}

/**
 * Manually unmute a chat
 */
export function unmuteChat(identifier) {
    if (!identifier) return { success: false, error: 'Identifier required' };
    const raw = (identifier || '').trim();
    const digits = normalizePhoneOrJid(raw);

    let removed = false;
    if (mutedChats.has(raw)) {
        mutedChats.delete(raw);
        removed = true;
    }
    if (digits && mutedChats.has(digits)) {
        mutedChats.delete(digits);
        removed = true;
    }

    logger.info({ identifier, removed }, '[HANDOVER] Chat unmuted');
    return { success: true, unmuted: true, removed };
}

/**
 * Get all active handover mutes
 */
export function getActiveHandoverMutes() {
    const now = new Date();
    const result = [];
    for (const [key, record] of mutedChats.entries()) {
        if (record.mutedUntil > now) {
            const remainingMinutes = Math.max(1, Math.ceil((record.mutedUntil.getTime() - now.getTime()) / 60000));
            result.push({
                key,
                chatId: record.chatId,
                phone: record.phone,
                remainingMinutes,
                mutedUntil: record.mutedUntil,
                reason: record.reason,
            });
        } else {
            mutedChats.delete(key);
        }
    }
    return result;
}
