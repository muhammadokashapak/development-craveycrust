import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDbClient } from '../db/client.js';
import { getDefaultRestaurantId } from './restaurantService.js';
import { cleanWhatsAppPhone } from '../../utils/senderIdentity.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../data');
const CHAT_BACKUP_FILE = path.join(DATA_DIR, 'customer_chats.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    } catch (_) {}
}

// In-memory buffer for fast retrieval & fallback
let _localChatStore = [];
const _confirmedNamesByChat = new Map();
const _confirmedNamesByPhone = new Map();

try {
    if (fs.existsSync(CHAT_BACKUP_FILE)) {
        const raw = fs.readFileSync(CHAT_BACKUP_FILE, 'utf8');
        _localChatStore = JSON.parse(raw);
    }
} catch (e) {
    console.warn('[CHAT_SERVICE] Could not load local chat backup:', e.message);
    _localChatStore = [];
}

let _saveTimeout = null;
function scheduleSaveLocal() {
    if (_saveTimeout) return;
    _saveTimeout = setTimeout(() => {
        _saveTimeout = null;
        try {
            if (_localChatStore.length > 5000) {
                _localChatStore = _localChatStore.slice(-5000);
            }
            fs.writeFileSync(CHAT_BACKUP_FILE, JSON.stringify(_localChatStore, null, 2), 'utf8');
        } catch (err) {
            console.error('[CHAT_SERVICE] Failed to write chat backup file:', err.message);
        }
    }, 1000);
}

/**
 * Clean phone number helper
 */
function sanitizePhone(phone, chatId) {
    if (phone && typeof phone === 'string' && !phone.includes('@lid')) {
        const cleaned = phone.replace(/\D/g, '');
        if (cleaned) return cleaned;
    }
    if (chatId && typeof chatId === 'string' && chatId.endsWith('@s.whatsapp.net')) {
        const digits = chatId.split('@')[0].split(':')[0].replace(/\D/g, '');
        if (digits) return digits;
    }
    return '';
}

/**
 * Update and persist customer name across in-memory chat store, database messages, and customer records.
 */
export async function updateCustomerNameForChat({ chatId, phone, customerName, restaurantId } = {}) {
    if (!customerName || typeof customerName !== 'string') return;
    const cleanName = customerName.trim();
    if (!cleanName || cleanName.toLowerCase() === 'customer' || cleanName.toLowerCase() === 'null' || cleanName.toLowerCase() === 'undefined') return;

    const cleanChatId = chatId ? String(chatId).trim() : null;
    let cleanPhone = phone ? String(phone).replace(/\D/g, '') : null;
    const localPakPhone = cleanPhone && cleanPhone.startsWith('92') && cleanPhone.length === 12 ? '0' + cleanPhone.slice(2) : cleanPhone;
    const intlPakPhone = cleanPhone && cleanPhone.startsWith('03') && cleanPhone.length === 11 ? '92' + cleanPhone.slice(1) : cleanPhone;

    if (cleanChatId) _confirmedNamesByChat.set(cleanChatId, cleanName);
    if (cleanPhone) _confirmedNamesByPhone.set(cleanPhone, cleanName);
    if (localPakPhone) _confirmedNamesByPhone.set(localPakPhone, cleanName);
    if (intlPakPhone) _confirmedNamesByPhone.set(intlPakPhone, cleanName);

    // 1. Backfill all matching messages in in-memory store
    let updatedCount = 0;
    for (let i = 0; i < _localChatStore.length; i++) {
        const entry = _localChatStore[i];
        const matchChat = cleanChatId && (entry.chat_id === cleanChatId || entry.chatId === cleanChatId);
        const entryPhone = entry.phone ? String(entry.phone).replace(/\D/g, '') : null;
        const matchPhone = (cleanPhone && entryPhone === cleanPhone) ||
                           (localPakPhone && entryPhone === localPakPhone) ||
                           (intlPakPhone && entryPhone === intlPakPhone);

        if (matchChat || matchPhone) {
            entry.customer_name = cleanName;
            if (cleanPhone && !entry.phone) {
                entry.phone = cleanPhone;
            }
            updatedCount++;
        }
    }

    if (updatedCount > 0) {
        scheduleSaveLocal();
    }

    // 2. Persist update to DB asynchronously
    setImmediate(async () => {
        try {
            const prisma = getDbClient();
            if (!prisma) return;

            const orConditions = [];
            if (cleanChatId) orConditions.push({ chat_id: cleanChatId });
            if (cleanPhone) orConditions.push({ phone: cleanPhone });
            if (localPakPhone && localPakPhone !== cleanPhone) orConditions.push({ phone: localPakPhone });
            if (intlPakPhone && intlPakPhone !== cleanPhone) orConditions.push({ phone: intlPakPhone });

            if (prisma.chatMessage && orConditions.length > 0) {
                await prisma.chatMessage.updateMany({
                    where: { OR: orConditions },
                    data: { customer_name: cleanName },
                }).catch(() => {});
            }

            if (prisma.customer && (cleanPhone || localPakPhone)) {
                await prisma.customer.updateMany({
                    where: {
                        OR: [
                            ...(cleanPhone ? [{ phone: cleanPhone }, { whatsapp_phone: cleanPhone }] : []),
                            ...(localPakPhone ? [{ phone: localPakPhone }, { whatsapp_phone: localPakPhone }] : []),
                            ...(intlPakPhone ? [{ phone: intlPakPhone }, { whatsapp_phone: intlPakPhone }] : []),
                        ],
                    },
                    data: { name: cleanName },
                }).catch(() => {});
            }
        } catch (err) {
            console.warn('[CHAT_SERVICE] Error updating customer name in DB:', err.message);
        }
    });
}

/**
 * Record a message (user, bot, or staff) in real-time.
 */
export async function recordChatMessage({
    restaurantId,
    chatId,
    phone,
    customerName,
    sender, // 'user' | 'bot' | 'agent'
    message,
    messageType = 'text',
}) {
    if (!chatId || !message) return null;

    const cleanChatId = String(chatId).trim();
    let cleanPhone = sanitizePhone(phone, cleanChatId);
    const cleanMsg = typeof message === 'string' ? message.trim() : JSON.stringify(message);
    // Discard empty or dummy protocol stubs
    if (!cleanMsg || cleanMsg === 'Message') return null;

    const cleanSender = (sender === 'bot' || sender === 'agent') ? 'bot' : 'user';
    const timestamp = new Date();

    // Check confirmed names cache first (highest authority)
    let cleanName = null;
    if (cleanChatId && _confirmedNamesByChat.has(cleanChatId)) {
        cleanName = _confirmedNamesByChat.get(cleanChatId);
    } else if (cleanPhone && _confirmedNamesByPhone.has(cleanPhone)) {
        cleanName = _confirmedNamesByPhone.get(cleanPhone);
    }

    // Clean customer name if provided and not yet confirmed
    if (!cleanName && customerName && typeof customerName === 'string') {
        const trimmed = customerName.trim();
        if (trimmed && trimmed.toLowerCase() !== 'null' && trimmed.toLowerCase() !== 'undefined' && trimmed.toLowerCase() !== 'customer') {
            cleanName = trimmed;
        }
    }

    // If name not provided, check local store for previous customer name
    if (!cleanName) {
        const prev = _localChatStore.findLast(m => m.chat_id === cleanChatId && m.customer_name);
        if (prev) {
            cleanName = prev.customer_name;
        }
        if (!cleanPhone && prev && prev.phone) {
            cleanPhone = prev.phone;
        }
    }

    const localEntry = {
        id: `chat_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        restaurant_id: restaurantId || 'default-restaurant',
        chat_id: cleanChatId,
        phone: cleanPhone,
        customer_name: cleanName,
        sender: cleanSender,
        message: cleanMsg,
        message_type: messageType || 'text',
        created_at: timestamp.toISOString(),
    };

    // If new name provided, backfill previous local entries
    if (cleanName) {
        for (let i = _localChatStore.length - 1; i >= 0; i--) {
            if (_localChatStore[i].chat_id === cleanChatId && !_localChatStore[i].customer_name) {
                _localChatStore[i].customer_name = cleanName;
            }
        }
    }

    _localChatStore.push(localEntry);
    scheduleSaveLocal();

    // Async persist to PostgreSQL via Prisma
    setImmediate(async () => {
        try {
            const prisma = getDbClient();
            if (!prisma) return;

            let restId = restaurantId;
            if (!restId || restId === 'default-restaurant') {
                restId = await getDefaultRestaurantId().catch(() => null);
            }
            if (!restId) return;

            // If name is still missing, lookup registered customer in DB
            if (!cleanName && cleanPhone) {
                const altPhone = cleanPhone.startsWith('92') && cleanPhone.length === 12 ? '0' + cleanPhone.slice(2) : cleanPhone;
                const dbCust = await prisma.customer.findFirst({
                    where: {
                        restaurant_id: restId,
                        OR: [
                            { whatsapp_phone: cleanPhone },
                            { phone: cleanPhone },
                            { whatsapp_phone: altPhone },
                            { phone: altPhone },
                        ],
                    },
                    select: { name: true, phone: true, whatsapp_phone: true },
                });
                if (dbCust && dbCust.name) {
                    cleanName = dbCust.name;
                    localEntry.customer_name = cleanName;
                }
            }

            // Save to chat_messages table
            if (prisma.chatMessage) {
                await prisma.chatMessage.create({
                    data: {
                        restaurant_id: restId,
                        chat_id: cleanChatId,
                        phone: cleanPhone,
                        customer_name: cleanName,
                        sender: cleanSender,
                        message: cleanMsg,
                        message_type: messageType || 'text',
                        created_at: timestamp,
                    },
                });

                // If name is known, backfill previous messages in DB where customer_name was missing
                if (cleanName) {
                    await prisma.chatMessage.updateMany({
                        where: {
                            restaurant_id: restId,
                            chat_id: cleanChatId,
                            OR: [
                                { customer_name: null },
                                { customer_name: 'Customer' },
                                { customer_name: '' },
                            ],
                        },
                        data: {
                            customer_name: cleanName,
                        },
                    }).catch(() => {});
                }
            }

            // Also ensure Customer record exists/updates in database
            if (cleanPhone && cleanName) {
                const localPakPhone = cleanPhone.startsWith('92') && cleanPhone.length === 12 ? '0' + cleanPhone.slice(2) : cleanPhone;
                const existing = await prisma.customer.findFirst({
                    where: {
                        restaurant_id: restId,
                        OR: [
                            { whatsapp_phone: cleanPhone },
                            { phone: cleanPhone },
                            { whatsapp_phone: localPakPhone },
                            { phone: localPakPhone },
                        ],
                    },
                });

                if (!existing) {
                    await prisma.customer.create({
                        data: {
                            restaurant_id: restId,
                            name: cleanName,
                            phone: localPakPhone,
                            whatsapp_phone: cleanPhone,
                            total_orders: 0,
                        },
                    }).catch(() => {});
                } else if (!existing.name || existing.name === 'Customer') {
                    await prisma.customer.update({
                        where: { id: existing.id },
                        data: { name: cleanName },
                    }).catch(() => {});
                }
            }
        } catch (err) {
            console.warn('[CHAT_SERVICE] Error during async DB persist:', err.message);
        }
    });

    return localEntry;
}

/**
 * Get list of all conversation threads grouped by customer.
 */
export async function getConversations({ restaurantId, search, limit = 50, page = 1 } = {}) {
    let restId = restaurantId;
    const prisma = getDbClient();

    let conversationsMap = new Map();

    // 1. Try DB first
    if (prisma && prisma.chatMessage) {
        try {
            if (!restId || restId === 'default-restaurant') {
                restId = await getDefaultRestaurantId().catch(() => null);
            }

            const where = restId ? { restaurant_id: restId } : {};
            const dbMsgs = await prisma.chatMessage.findMany({
                where,
                orderBy: { created_at: 'desc' },
                take: 2000,
            });

            for (const msg of dbMsgs) {
                if (!msg.message || msg.message.trim() === 'Message') continue;
                const key = msg.chat_id;
                if (!conversationsMap.has(key)) {
                    conversationsMap.set(key, {
                        chatId: msg.chat_id,
                        phone: msg.phone,
                        customerName: msg.customer_name || 'Customer',
                        lastMessage: msg.message,
                        lastMessageSender: msg.sender,
                        lastMessageAt: msg.created_at,
                        totalMessages: 1,
                    });
                } else {
                    const conv = conversationsMap.get(key);
                    conv.totalMessages += 1;
                    if ((!conv.customerName || conv.customerName === 'Customer') && msg.customer_name) {
                        conv.customerName = msg.customer_name;
                    }
                    if (!conv.phone && msg.phone) {
                        conv.phone = msg.phone;
                    }
                }
            }
        } catch (_) {}
    }

    // 2. Merge / Fallback to local memory store
    for (let i = _localChatStore.length - 1; i >= 0; i--) {
        const msg = _localChatStore[i];
        if (!msg.message || msg.message.trim() === 'Message') continue;
        const key = msg.chat_id;
        if (!conversationsMap.has(key)) {
            conversationsMap.set(key, {
                chatId: msg.chat_id,
                phone: msg.phone,
                customerName: msg.customer_name || 'Customer',
                lastMessage: msg.message,
                lastMessageSender: msg.sender,
                lastMessageAt: new Date(msg.created_at),
                totalMessages: 1,
            });
        } else {
            const conv = conversationsMap.get(key);
            conv.totalMessages += 1;
            if ((!conv.customerName || conv.customerName === 'Customer') && msg.customer_name) {
                conv.customerName = msg.customer_name;
            }
            if (!conv.phone && msg.phone) {
                conv.phone = msg.phone;
            }
        }
    }

    // 3. Prioritize Confirmed Order Customer Names from Order table
    if (prisma && prisma.order) {
        try {
            const recentOrders = await prisma.order.findMany({
                where: restId ? { restaurant_id: restId } : {},
                orderBy: { created_at: 'desc' },
                take: 1000,
                select: {
                    customer_name: true,
                    phone: true,
                    whatsapp_phone: true,
                    source_chat_id: true,
                },
            });

            const orderNameByChat = new Map();
            const orderNameByPhone = new Map();

            for (const ord of recentOrders) {
                const oName = ord.customer_name?.trim();
                if (!oName || oName.toLowerCase() === 'customer' || oName.toLowerCase() === 'null') continue;

                if (ord.source_chat_id && !orderNameByChat.has(ord.source_chat_id)) {
                    orderNameByChat.set(ord.source_chat_id, oName);
                    _confirmedNamesByChat.set(ord.source_chat_id, oName);
                }
                const p1 = ord.whatsapp_phone ? ord.whatsapp_phone.replace(/\D/g, '') : null;
                const p2 = ord.phone ? ord.phone.replace(/\D/g, '') : null;
                for (const p of [p1, p2]) {
                    if (p && !orderNameByPhone.has(p)) {
                        orderNameByPhone.set(p, oName);
                        _confirmedNamesByPhone.set(p, oName);
                        if (p.startsWith('92') && p.length === 12) {
                            orderNameByPhone.set('0' + p.slice(2), oName);
                            _confirmedNamesByPhone.set('0' + p.slice(2), oName);
                        }
                        if (p.startsWith('03') && p.length === 11) {
                            orderNameByPhone.set('92' + p.slice(1), oName);
                            _confirmedNamesByPhone.set('92' + p.slice(1), oName);
                        }
                    }
                }
            }

            for (const [key, conv] of conversationsMap.entries()) {
                const confName = orderNameByChat.get(conv.chatId) ||
                                 orderNameByChat.get(key) ||
                                 (conv.phone ? orderNameByPhone.get(conv.phone) : null) ||
                                 (conv.phone && conv.phone.startsWith('92') && conv.phone.length === 12 ? orderNameByPhone.get('0' + conv.phone.slice(2)) : null);
                if (confName) {
                    conv.customerName = confName;
                }
            }
        } catch (_) {}
    }

    // 4. Cross-reference customer table for any unknown or placeholder names
    if (prisma && prisma.customer) {
        try {
            const unknownList = Array.from(conversationsMap.values()).filter(c => !c.customerName || c.customerName === 'Customer' || c.customerName.startsWith('Customer ('));
            if (unknownList.length > 0) {
                const phones = unknownList.map(c => c.phone).filter(Boolean);
                const altPhones = phones.map(p => p.startsWith('92') && p.length === 12 ? '0' + p.slice(2) : p);
                const allQueryPhones = [...new Set([...phones, ...altPhones])];

                const matchedCustomers = await prisma.customer.findMany({
                    where: {
                        restaurant_id: restId,
                        OR: [
                            { whatsapp_phone: { in: allQueryPhones } },
                            { phone: { in: allQueryPhones } },
                        ],
                    },
                    select: { name: true, phone: true, whatsapp_phone: true },
                });

                const nameByPhone = new Map();
                for (const cust of matchedCustomers) {
                    if (cust.name && cust.name.trim() && cust.name !== 'Customer') {
                        if (cust.whatsapp_phone) nameByPhone.set(cust.whatsapp_phone, cust.name.trim());
                        if (cust.phone) nameByPhone.set(cust.phone, cust.name.trim());
                    }
                }

                for (const conv of unknownList) {
                    if (conv.phone && nameByPhone.has(conv.phone)) {
                        conv.customerName = nameByPhone.get(conv.phone);
                    }
                }
            }
        } catch (_) {}
    }

    let list = Array.from(conversationsMap.values());

    // Filter by search query if provided (Customer Name or Phone)
    if (search && search.trim()) {
        const q = search.trim().toLowerCase();
        list = list.filter(c =>
            (c.customerName && c.customerName.toLowerCase().includes(q)) ||
            (c.phone && c.phone.includes(q)) ||
            (c.lastMessage && c.lastMessage.toLowerCase().includes(q))
        );
    }

    // Sort by latest message first
    list.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());

    const total = list.length;
    const startIndex = (page - 1) * limit;
    const paginated = list.slice(startIndex, startIndex + limit);

    return {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
        conversations: paginated,
    };
}

/**
 * Get complete conversation history with a specific customer.
 */
export async function getCustomerChatMessages(chatId, { restaurantId, limit = 200 } = {}) {
    if (!chatId) return [];
    const cleanChatId = String(chatId).trim();

    const prisma = getDbClient();
    let messages = [];

    // First find any associated phone from local store, DB messages, or conversation session
    let associatedPhone = null;
    const localSample = _localChatStore.findLast(m => (m.chat_id === cleanChatId || m.chatId === cleanChatId) && m.phone);
    if (localSample?.phone) {
        associatedPhone = String(localSample.phone).replace(/\D/g, '');
    }
    if (!associatedPhone && prisma && prisma.chatMessage) {
        try {
            const dbSample = await prisma.chatMessage.findFirst({
                where: { chat_id: cleanChatId, phone: { not: null } },
                orderBy: { created_at: 'desc' },
                select: { phone: true },
            });
            if (dbSample?.phone) associatedPhone = String(dbSample.phone).replace(/\D/g, '');
        } catch (_) {}
    }
    if (!associatedPhone && prisma && prisma.conversationSession) {
        try {
            const sess = await prisma.conversationSession.findFirst({
                where: { OR: [{ chat_id: cleanChatId }, { session_key: cleanChatId }] },
                select: { verified_phone: true },
            });
            if (sess?.verified_phone) associatedPhone = String(sess.verified_phone).replace(/\D/g, '');
        } catch (_) {}
    }
    if (!associatedPhone && cleanChatId.includes('@s.whatsapp.net')) {
        const rawDigits = cleanChatId.split('@')[0].split(':')[0].replace(/\D/g, '');
        if (rawDigits.length >= 10 && rawDigits.length <= 13) associatedPhone = rawDigits;
    }

    // Build all phone format variations for accurate lookup
    const phoneVariants = new Set();
    if (associatedPhone) {
        phoneVariants.add(associatedPhone);
        if (associatedPhone.startsWith('92') && associatedPhone.length === 12) {
            phoneVariants.add('0' + associatedPhone.slice(2));
            phoneVariants.add(associatedPhone.slice(2));
        } else if (associatedPhone.startsWith('03') && associatedPhone.length === 11) {
            phoneVariants.add('92' + associatedPhone.slice(1));
            phoneVariants.add(associatedPhone.slice(1));
        } else if (associatedPhone.startsWith('3') && associatedPhone.length === 10) {
            phoneVariants.add('92' + associatedPhone);
            phoneVariants.add('0' + associatedPhone);
        }
    }

    // Resolve most authoritative confirmed customer name
    let resolvedCustomerName = _confirmedNamesByChat.get(cleanChatId);
    if (!resolvedCustomerName && phoneVariants.size > 0) {
        for (const pv of phoneVariants) {
            if (_confirmedNamesByPhone.has(pv)) {
                resolvedCustomerName = _confirmedNamesByPhone.get(pv);
                break;
            }
        }
    }

    if (!resolvedCustomerName && prisma && prisma.order) {
        try {
            const orConditions = [
                { source_chat_id: cleanChatId },
                { phone: cleanChatId.split('@')[0] },
                { whatsapp_phone: cleanChatId.split('@')[0] },
            ];
            for (const pv of phoneVariants) {
                orConditions.push({ phone: pv });
                orConditions.push({ whatsapp_phone: pv });
            }
            const ord = await prisma.order.findFirst({
                where: { OR: orConditions },
                orderBy: { created_at: 'desc' },
                select: { customer_name: true },
            });
            if (ord?.customer_name && ord.customer_name.trim() && ord.customer_name.toLowerCase() !== 'customer') {
                resolvedCustomerName = ord.customer_name.trim();
                _confirmedNamesByChat.set(cleanChatId, resolvedCustomerName);
                if (associatedPhone) _confirmedNamesByPhone.set(associatedPhone, resolvedCustomerName);
            }
        } catch (_) {}
    }

    if (!resolvedCustomerName && prisma && prisma.customer && phoneVariants.size > 0) {
        try {
            const cust = await prisma.customer.findFirst({
                where: {
                    OR: [
                        ...Array.from(phoneVariants).map(p => ({ phone: p })),
                        ...Array.from(phoneVariants).map(p => ({ whatsapp_phone: p })),
                    ],
                },
                select: { name: true },
            });
            if (cust?.name && cust.name.trim() && cust.name.toLowerCase() !== 'customer') {
                resolvedCustomerName = cust.name.trim();
            }
        } catch (_) {}
    }

    // 1. Try DB
    if (prisma && prisma.chatMessage) {
        try {
            let restId = restaurantId;
            if (!restId || restId === 'default-restaurant') {
                restId = await getDefaultRestaurantId().catch(() => null);
            }

            const dbList = await prisma.chatMessage.findMany({
                where: {
                    chat_id: cleanChatId,
                    ...(restId ? { restaurant_id: restId } : {}),
                },
                orderBy: { created_at: 'asc' },
                take: limit,
            });

            if (dbList && dbList.length > 0) {
                messages = dbList.map(m => ({
                    id: m.id,
                    chatId: m.chat_id,
                    phone: m.phone || associatedPhone,
                    customerName: (m.sender === 'user') ? (resolvedCustomerName || m.customer_name || 'Customer') : 'Burger Raja',
                    sender: m.sender,
                    message: m.message,
                    messageType: m.message_type,
                    createdAt: m.created_at,
                }));
            }
        } catch (_) {}
    }

    // 2. Merge local store if DB was empty or missing recent entries
    const localMatches = _localChatStore
        .filter(m => m.chat_id === cleanChatId)
        .map(m => ({
            id: m.id,
            chatId: m.chat_id,
            phone: m.phone || associatedPhone,
            customerName: (m.sender === 'user') ? (resolvedCustomerName || m.customer_name || 'Customer') : 'Burger Raja',
            sender: m.sender,
            message: m.message,
            messageType: m.message_type,
            createdAt: new Date(m.created_at),
        }));

    if (messages.length === 0) {
        messages = localMatches;
    } else {
        const existingKeys = new Set(messages.map(m => `${m.sender}_${new Date(m.createdAt).getTime()}_${m.message.slice(0, 30)}`));
        for (const loc of localMatches) {
            const key = `${loc.sender}_${new Date(loc.createdAt).getTime()}_${loc.message.slice(0, 30)}`;
            if (!existingKeys.has(key)) {
                messages.push(loc);
                existingKeys.add(key);
            }
        }
    }

    messages = messages.filter(m => m.message && m.message.trim() && m.message.trim() !== 'Message');
    messages.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    return messages.slice(-limit);
}

/**
 * Delete chat history for specific customer phones or chat IDs
 */
export async function deleteCustomerChatHistory(identifiers = []) {
    if (!Array.isArray(identifiers) || identifiers.length === 0) return 0;
    const targets = new Set(identifiers.filter(Boolean).map(x => String(x).toLowerCase().replace(/\D/g, '')).filter(Boolean));
    const targetChatIds = new Set(identifiers.filter(Boolean).map(x => String(x).toLowerCase()));

    const prevLength = _localChatStore.length;
    _localChatStore = _localChatStore.filter(msg => {
        const msgPhone = sanitizePhone(msg.phone, msg.chatId);
        const msgChat = (msg.chatId || msg.chat_id || '').toLowerCase();
        if (msgPhone && targets.has(msgPhone)) return false;
        if (msgChat && targetChatIds.has(msgChat)) return false;
        for (const t of targets) {
            if (msgChat.includes(t)) return false;
        }
        return true;
    });

    const deletedCount = prevLength - _localChatStore.length;
    if (deletedCount > 0) {
        try {
            fs.writeFileSync(CHAT_BACKUP_FILE, JSON.stringify(_localChatStore, null, 2), 'utf8');
        } catch (_) {}
    }
    return deletedCount;
}

