import { getDbClient } from '../db/client.js';
import { getDefaultRestaurantId } from './restaurantService.js';
import { normalizePhone } from './customerService.js';

export const SESSION_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

export const SESSION_STAGES = [
    'START',
    'BROWSING_MENU',
    'BUILDING_CART',
    'WAITING_NAME',
    'WAITING_CONTACT',
    'WAITING_LOCATION',
    'WAITING_PAYMENT',
    'WAITING_ORDER_CONFIRMATION',
    'ORDER_CONFIRMED',
    'WAITING_CANCEL_ORDER_ID',
    'WAITING_CANCEL_CONFIRMATION',
    'CANCELLED',
];

/**
 * Get or create a conversation session
 * Handles 15-minute inactivity expiration
 *
 * @param {Object} params
 * @param {string} [params.restaurantId]
 * @param {string} params.chatId
 * @param {string} [params.sessionKey]
 * @param {string} [params.verifiedPhone]
 * @param {string} [params.stage]
 * @returns {Promise<Object>}
 */
export async function getOrCreateSession({ restaurantId, chatId, sessionKey, verifiedPhone, stage }) {
    const prisma = getDbClient();
    if (!prisma) {
        throw new Error('Database client not available');
    }

    const restId = restaurantId || await getDefaultRestaurantId();
    const key = sessionKey || chatId;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_TIMEOUT_MS);
    const cleanPhone = normalizePhone(verifiedPhone);

    let session = await prisma.conversationSession.findUnique({
        where: { session_key: key },
    });

    if (session) {
        const isExpired = session.expires_at < now;

        // If expired and not already confirmed, reset stage to START and expire active cart
        if (isExpired && session.stage !== 'ORDER_CONFIRMED') {
            await prisma.cart.updateMany({
                where: {
                    session_id: session.id,
                    status: 'ACTIVE',
                },
                data: {
                    status: 'EXPIRED',
                },
            });

            session = await prisma.conversationSession.update({
                where: { id: session.id },
                data: {
                    stage: stage || 'START',
                    verified_phone: cleanPhone || session.verified_phone,
                    pending_order_id: null,
                    pending_cancel_order_id: null,
                    last_activity_at: now,
                    expires_at: expiresAt,
                },
            });
        } else {
            // Update last activity and extend timeout
            const updateData = {
                last_activity_at: now,
                expires_at: expiresAt,
            };
            if (cleanPhone && cleanPhone !== session.verified_phone) {
                updateData.verified_phone = cleanPhone;
            }
            if (stage && SESSION_STAGES.includes(stage)) {
                updateData.stage = stage;
            }

            session = await prisma.conversationSession.update({
                where: { id: session.id },
                data: updateData,
            });
        }
        return session;
    }

    // Create brand new session
    session = await prisma.conversationSession.create({
        data: {
            restaurant_id: restId,
            session_key: key,
            chat_id: chatId,
            verified_phone: cleanPhone || null,
            stage: stage || 'START',
            last_activity_at: now,
            expires_at: expiresAt,
        },
    });

    return session;
}

/**
 * Update session stage and optional pending order references
 */
export async function updateSessionStage({ sessionKey, stage, pendingOrderId, pendingCancelOrderId }) {
    const prisma = getDbClient();
    if (!prisma) {
        throw new Error('Database client not available');
    }

    if (!SESSION_STAGES.includes(stage)) {
        throw new Error(`Invalid session stage: ${stage}`);
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_TIMEOUT_MS);

    const updateData = {
        stage,
        last_activity_at: now,
        expires_at: expiresAt,
    };

    if (pendingOrderId !== undefined) updateData.pending_order_id = pendingOrderId;
    if (pendingCancelOrderId !== undefined) updateData.pending_cancel_order_id = pendingCancelOrderId;

    return prisma.conversationSession.update({
        where: { session_key: sessionKey },
        data: updateData,
    });
}

/**
 * Touch session to keep it alive (resets 15m timer)
 */
export async function touchSession(sessionKey) {
    const prisma = getDbClient();
    if (!prisma) return null;

    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_TIMEOUT_MS);

    return prisma.conversationSession.update({
        where: { session_key: sessionKey },
        data: {
            last_activity_at: now,
            expires_at: expiresAt,
        },
    });
}

// ─── In-Memory Conversation History (10 messages, v9-ep{syncEpoch}) ──────

const _memoryStore = new Map();
const MAX_HISTORY_TURNS = 6; // last 6 turns (3 customer + 3 assistant)

export function getSessionHistoryKey(sessionKey, syncEpoch = 1) {
    return `${sessionKey}-v9-ep${syncEpoch}`;
}

export function getSessionHistory(sessionKey, syncEpoch = 1) {
    const key = getSessionHistoryKey(sessionKey, syncEpoch);
    if (!_memoryStore.has(key)) {
        _memoryStore.set(key, []);
    }
    return _memoryStore.get(key);
}

export function appendSessionHistory(sessionKey, role, content, syncEpoch = 1) {
    const history = getSessionHistory(sessionKey, syncEpoch);
    let safeContent = typeof content === 'string' ? content : JSON.stringify(content);
    // Token Saver: Never blow up context history with full menu or deal catalog dumps
    if (safeContent.includes('HAMARA MENU') || safeContent.includes('PREMIUM PIZZAS') || safeContent.length > 300) {
        safeContent = safeContent.slice(0, 180) + '... [catalog details omitted from history to save tokens]';
    }
    history.push({ role, content: safeContent });
    while (history.length > MAX_HISTORY_TURNS) {
        history.shift();
    }
}

export function clearSessionHistory(sessionKey, syncEpoch) {
    if (syncEpoch != null) {
        _memoryStore.delete(getSessionHistoryKey(sessionKey, syncEpoch));
    } else {
        for (const k of _memoryStore.keys()) {
            if (k.startsWith(`${sessionKey}-v9-`)) {
                _memoryStore.delete(k);
            }
        }
    }
}

// ─── In-Memory Session Customer & Order Details Tracker ──────────────────
const _sessionOrderDetails = new Map();

export function getSessionOrderDetails(sessionKey, altKey) {
    if (!sessionKey && !altKey) return {};
    const primary = sessionKey || altKey;
    let entry = _sessionOrderDetails.get(primary);
    if (!entry && altKey) {
        entry = _sessionOrderDetails.get(altKey);
    }
    if (!entry) {
        entry = {};
        _sessionOrderDetails.set(primary, entry);
    }
    if (altKey && !_sessionOrderDetails.has(altKey)) {
        _sessionOrderDetails.set(altKey, entry);
    }
    if (sessionKey && !_sessionOrderDetails.has(sessionKey)) {
        _sessionOrderDetails.set(sessionKey, entry);
    }
    return entry;
}

export function updateSessionOrderDetails(sessionKey, patch, altKey) {
    if (!sessionKey && !altKey) return {};
    const curr = getSessionOrderDetails(sessionKey, altKey);
    Object.assign(curr, patch);
    return curr;
}

export function clearSessionOrderDetails(sessionKey, altKey) {
    if (sessionKey) _sessionOrderDetails.delete(sessionKey);
    if (altKey) _sessionOrderDetails.delete(altKey);
}


