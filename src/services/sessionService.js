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

        // If expired, reset stage to START and expire active cart
        if (isExpired) {
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
    clearMenuSentTracking(sessionKey, altKey);
}

// ─── In-Memory Active Placed Order Update Tracker ────────────────────────
const _pendingOrderUpdate = new Map();

export function setPendingOrderUpdate(sessionKey, data, altKey) {
    if (!sessionKey && !altKey) return;
    const primary = sessionKey || altKey;
    _pendingOrderUpdate.set(primary, data);
    if (altKey) _pendingOrderUpdate.set(altKey, data);
    if (sessionKey) _pendingOrderUpdate.set(sessionKey, data);
}

export function getPendingOrderUpdate(sessionKey, altKey) {
    if (!sessionKey && !altKey) return null;
    const primary = sessionKey || altKey;
    let entry = _pendingOrderUpdate.get(primary);
    if (!entry && altKey) entry = _pendingOrderUpdate.get(altKey);
    if (!entry) return null;
    // Expire pending modification after 15 minutes
    if (entry.timestamp && Date.now() - entry.timestamp > 15 * 60 * 1000) {
        clearPendingOrderUpdate(sessionKey, altKey);
        return null;
    }
    return entry;
}

export function clearPendingOrderUpdate(sessionKey, altKey) {
    if (sessionKey) _pendingOrderUpdate.delete(sessionKey);
    if (altKey) _pendingOrderUpdate.delete(altKey);
}

// ─── Pending Cancellation Confirmation Tracker ──────────────────────────
const _pendingCancellation = new Map();

export function setPendingCancellation(key, data, altKey) {
    if (!key && !altKey) return;
    const primary = key || altKey;
    _pendingCancellation.set(primary, data);
    if (altKey) _pendingCancellation.set(altKey, data);
    if (key) _pendingCancellation.set(key, data);
}

export function getPendingCancellation(key, altKey) {
    if (!key && !altKey) return null;
    const primary = key || altKey;
    let entry = _pendingCancellation.get(primary);
    if (!entry && altKey) entry = _pendingCancellation.get(altKey);
    if (!entry) return null;
    if (entry.timestamp && Date.now() - entry.timestamp > 10 * 60 * 1000) {
        clearPendingCancellation(key, altKey);
        return null;
    }
    return entry;
}

export function clearPendingCancellation(key, altKey) {
    if (key) _pendingCancellation.delete(key);
    if (altKey) _pendingCancellation.delete(altKey);
}

// ─── Remembered Customer Details (Persisted Across Cancels & Orders) ────
const _rememberedCustomerDetails = new Map();

export function rememberCustomerDetails(key, details, altKey) {
    if ((!key && !altKey) || !details) return;
    const primary = key || altKey;
    const existing = _rememberedCustomerDetails.get(primary) || (altKey ? _rememberedCustomerDetails.get(altKey) : null) || {};
    const updated = {
        name: details.name || details.customerName || existing.name,
        phone: details.phone || existing.phone,
        whatsappPhone: details.whatsappPhone || existing.whatsappPhone,
        address: details.address || details.deliveryAddress || existing.address,
        areaName: details.areaName || details.deliveryAreaName || existing.areaName,
        location: details.location || existing.location,
        googleMapsUrl: details.googleMapsUrl || existing.googleMapsUrl,
        paymentMethod: details.paymentMethod || existing.paymentMethod || 'COD',
        timestamp: Date.now()
    };
    if (primary) _rememberedCustomerDetails.set(primary, updated);
    if (altKey) _rememberedCustomerDetails.set(altKey, updated);
    if (key) _rememberedCustomerDetails.set(key, updated);
}

export async function getRememberedCustomerDetails(key, altKey) {
    if (!key && !altKey) return null;
    const primary = key || altKey;
    let details = _rememberedCustomerDetails.get(primary);
    if (!details && altKey) details = _rememberedCustomerDetails.get(altKey);

    // If not in-memory (e.g. after fresh boot), fetch from DB (last customer order)
    if (!details || !details.name || !details.address) {
        try {
            const { getDbClient } = await import('../db/client.js');
            const prisma = getDbClient();
            if (prisma) {
                const cleanPhone = (altKey || key || '').replace(/\D/g, '');
                const orConds = [];
                if (key) {
                    orConds.push({ source_session_id: key });
                    orConds.push({ source_chat_id: key });
                }
                if (cleanPhone) {
                    orConds.push({ phone: cleanPhone });
                    orConds.push({ whatsapp_phone: cleanPhone });
                    if (cleanPhone.length >= 9) {
                        const last9 = cleanPhone.slice(-9);
                        orConds.push({ phone: { contains: last9 } });
                    }
                }
                if (orConds.length > 0) {
                    const lastOrder = await prisma.order.findFirst({
                        where: { OR: orConds },
                        orderBy: { created_at: 'desc' },
                        include: { customer: true }
                    });
                    if (lastOrder) {
                        details = {
                            name: lastOrder.customer_name || lastOrder.customer?.name,
                            phone: lastOrder.phone || lastOrder.customer?.phone,
                            whatsappPhone: lastOrder.whatsapp_phone || lastOrder.customer?.whatsapp_phone,
                            address: lastOrder.delivery_address,
                            areaName: lastOrder.delivery_area_name,
                            googleMapsUrl: lastOrder.google_maps_url,
                            paymentMethod: lastOrder.payment_method || 'COD',
                            timestamp: Date.now()
                        };
                        rememberCustomerDetails(key, details, altKey);
                    }
                }
            }
        } catch (_) {}
    }
    return details;
}

// ─── Menu / Deals Send Throttle Tracker (Single-Send per Session) ────────
const _menuSentTracker = new Map();

export function markMenuSent(sessionKey, altKey) {
    if (!sessionKey && !altKey) return;
    const primary = sessionKey || altKey;
    const now = Date.now();
    const entry = _menuSentTracker.get(primary) || (altKey ? _menuSentTracker.get(altKey) : null) || {};
    entry.menuSentAt = now;
    if (primary) _menuSentTracker.set(primary, entry);
    if (altKey) _menuSentTracker.set(altKey, entry);
    if (sessionKey) _menuSentTracker.set(sessionKey, entry);
}

export function hasMenuBeenSent(sessionKey, altKey, maxAgeMs = 30 * 60 * 1000) {
    if (!sessionKey && !altKey) return false;
    const primary = sessionKey || altKey;
    let entry = _menuSentTracker.get(primary);
    if (!entry && altKey) entry = _menuSentTracker.get(altKey);
    if (!entry || !entry.menuSentAt) return false;
    if (Date.now() - entry.menuSentAt > maxAgeMs) {
        entry.menuSentAt = null;
        return false;
    }
    return true;
}
export const haveMenuBeenSent = hasMenuBeenSent;

export function markDealsSent(sessionKey, altKey) {
    if (!sessionKey && !altKey) return;
    const primary = sessionKey || altKey;
    const now = Date.now();
    const entry = _menuSentTracker.get(primary) || (altKey ? _menuSentTracker.get(altKey) : null) || {};
    entry.dealsSentAt = now;
    if (primary) _menuSentTracker.set(primary, entry);
    if (altKey) _menuSentTracker.set(altKey, entry);
    if (sessionKey) _menuSentTracker.set(sessionKey, entry);
}

export function haveDealsBeenSent(sessionKey, altKey, maxAgeMs = 30 * 60 * 1000) {
    if (!sessionKey && !altKey) return false;
    const primary = sessionKey || altKey;
    let entry = _menuSentTracker.get(primary);
    if (!entry && altKey) entry = _menuSentTracker.get(altKey);
    if (!entry || !entry.dealsSentAt) return false;
    if (Date.now() - entry.dealsSentAt > maxAgeMs) {
        entry.dealsSentAt = null;
        return false;
    }
    return true;
}
export const hasDealsBeenSent = haveDealsBeenSent;

export function clearMenuSentTracking(sessionKey, altKey) {
    if (sessionKey) _menuSentTracker.delete(sessionKey);
    if (altKey) _menuSentTracker.delete(altKey);
}
