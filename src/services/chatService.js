import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDbClient } from '../db/client.js';
import { getDefaultRestaurantId } from './restaurantService.js';

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
            // Keep last 5,000 messages locally to keep file size reasonable
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
 * Record a message (user or bot) in real-time.
 */
export async function recordChatMessage({
    restaurantId,
    chatId,
    phone,
    customerName,
    sender, // 'user' | 'bot'
    message,
    messageType = 'text',
}) {
    if (!chatId || !message) return null;

    const cleanChatId = String(chatId).trim();
    const cleanPhone = phone ? String(phone).replace(/\D/g, '') : cleanChatId.split('@')[0].replace(/\D/g, '');
    const cleanMsg = typeof message === 'string' ? message.trim() : JSON.stringify(message);
    const cleanSender = sender === 'bot' ? 'bot' : 'user';
    const timestamp = new Date();

    const localEntry = {
        id: `chat_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        restaurant_id: restaurantId || 'default-restaurant',
        chat_id: cleanChatId,
        phone: cleanPhone,
        customer_name: customerName ? String(customerName).trim() : null,
        sender: cleanSender,
        message: cleanMsg,
        message_type: messageType || 'text',
        created_at: timestamp.toISOString(),
    };

    // If existing local messages for this customer have a name, keep or update it
    if (customerName) {
        for (let i = _localChatStore.length - 1; i >= 0; i--) {
            if (_localChatStore[i].chat_id === cleanChatId && !_localChatStore[i].customer_name) {
                _localChatStore[i].customer_name = customerName;
            }
        }
    } else {
        // Try to backfill customerName from previous entries
        const prev = _localChatStore.findLast(m => m.chat_id === cleanChatId && m.customer_name);
        if (prev) {
            localEntry.customer_name = prev.customer_name;
        }
    }

    _localChatStore.push(localEntry);
    scheduleSaveLocal();

    // Async persist to PostgreSQL via Prisma
    setImmediate(async () => {
        try {
            const prisma = getDbClient();
            if (!prisma || !prisma.chatMessage) return;

            let restId = restaurantId;
            if (!restId || restId === 'default-restaurant') {
                restId = await getDefaultRestaurantId().catch(() => null);
            }
            if (!restId) return;

            await prisma.chatMessage.create({
                data: {
                    restaurant_id: restId,
                    chat_id: cleanChatId,
                    phone: cleanPhone,
                    customer_name: localEntry.customer_name,
                    sender: cleanSender,
                    message: cleanMsg,
                    message_type: messageType || 'text',
                    created_at: timestamp,
                },
            });
        } catch (err) {
            // DB might be reconnecting or table pending migration — local buffer is safe
            // console.warn('[CHAT_SERVICE] DB persist skipped:', err.message);
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

    // 1. Try DB first if Prisma model is ready
    if (prisma && prisma.chatMessage) {
        try {
            if (!restId || restId === 'default-restaurant') {
                restId = await getDefaultRestaurantId().catch(() => null);
            }

            const where = restId ? { restaurant_id: restId } : {};
            const dbMsgs = await prisma.chatMessage.findMany({
                where,
                orderBy: { created_at: 'desc' },
                take: 1000,
            });

            for (const msg of dbMsgs) {
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
                    if (!conv.customerName && msg.customer_name) {
                        conv.customerName = msg.customer_name;
                    }
                }
            }
        } catch (_) {}
    }

    // 2. Merge / Fallback to local memory store
    for (let i = _localChatStore.length - 1; i >= 0; i--) {
        const msg = _localChatStore[i];
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
        }
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
                    phone: m.phone,
                    customerName: m.customer_name,
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
            phone: m.phone,
            customerName: m.customer_name,
            sender: m.sender,
            message: m.message,
            messageType: m.message_type,
            createdAt: new Date(m.created_at),
        }));

    if (messages.length === 0) {
        messages = localMatches;
    } else {
        // Merge by unique id or message content + timestamp
        const existingKeys = new Set(messages.map(m => `${m.sender}_${new Date(m.createdAt).getTime()}_${m.message.slice(0, 30)}`));
        for (const loc of localMatches) {
            const key = `${loc.sender}_${new Date(loc.createdAt).getTime()}_${loc.message.slice(0, 30)}`;
            if (!existingKeys.has(key)) {
                messages.push(loc);
                existingKeys.add(key);
            }
        }
    }

    messages.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    return messages.slice(-limit);
}
