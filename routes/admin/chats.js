import express from 'express';
import { getConversations, getCustomerChatMessages, recordChatMessage } from '../../src/services/chatService.js';
import { requireRole } from '../../src/middleware/auth.js';

const router = express.Router();

// Customer chat endpoints require SUPER_ADMIN role only
router.use(requireRole(['SUPER_ADMIN']));

/**
 * GET /api/admin/chats/conversations
 * Returns list of customer conversation threads
 */
router.get('/conversations', async (req, res) => {
    try {
        const { search, limit, page } = req.query;
        const restaurantId = req.user?.restaurantId;

        const result = await getConversations({
            restaurantId,
            search: search || '',
            limit: limit ? parseInt(limit, 10) : 50,
            page: page ? parseInt(page, 10) : 1,
        });

        res.json({ success: true, data: result });
    } catch (err) {
        console.error('[CHATS_ROUTE] Error getting conversations:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/admin/chats/conversations/:chatId/messages
 * Returns full message thread for a specific customer
 */
router.get('/conversations/:chatId/messages', async (req, res) => {
    try {
        const { chatId } = req.params;
        const { limit } = req.query;
        const restaurantId = req.user?.restaurantId;

        const messages = await getCustomerChatMessages(chatId, {
            restaurantId,
            limit: limit ? parseInt(limit, 10) : 200,
        });

        res.json({ success: true, data: { chatId, messages } });
    } catch (err) {
        console.error('[CHATS_ROUTE] Error getting messages:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/admin/chats/conversations/:chatId/messages
 * Sends a manual agent message to the customer WhatsApp thread
 */
router.post('/conversations/:chatId/messages', async (req, res) => {
    try {
        const { chatId } = req.params;
        const { message } = req.body;
        if (!message || typeof message !== 'string' || !message.trim()) {
            return res.status(400).json({ success: false, error: 'Message text is required' });
        }

        const restaurantId = req.user?.restaurantId || 'default-restaurant';
        const cleanMsg = message.trim();
        let sentViaWhatsApp = false;

        // Try to dispatch through active WhatsApp socket if connected
        try {
            const sessions = global.activeSessions;
            if (sessions && sessions.size > 0) {
                const session = Array.from(sessions.values()).find(s => s.state === 'connected' && s.sock);
                if (session && session.sock) {
                    const recipientJid = chatId.includes('@') ? chatId : `${chatId.replace(/\D/g, '')}@s.whatsapp.net`;
                    await session.sock.sendMessage(recipientJid, { text: cleanMsg });
                    sentViaWhatsApp = true;
                }
            }
        } catch (sockErr) {
            console.warn('[CHATS_ROUTE] Warning: could not send via WhatsApp socket directly:', sockErr.message);
        }

        // Record message in history
        const saved = await recordChatMessage({
            restaurantId,
            chatId,
            sender: 'bot',
            message: cleanMsg,
        });

        res.json({
            success: true,
            data: {
                message: saved || { message: cleanMsg, sender: 'bot', created_at: new Date().toISOString() },
                sentViaWhatsApp,
            },
        });
    } catch (err) {
        console.error('[CHATS_ROUTE] Error sending message:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/admin/chats/delete-all
 * DELETE /api/admin/chats/delete-all
 * Clear all customer chats
 */
const handleDeleteAllChats = async (req, res) => {
    try {
        const { clearAllChats } = await import('../../src/services/chatService.js');
        const count = await clearAllChats();
        return res.json({
            success: true,
            count,
            message: 'All customer chats cleared successfully',
        });
    } catch (err) {
        console.error('[CHATS_ROUTE] Error deleting all chats:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
};

router.post('/delete-all', handleDeleteAllChats);
router.delete('/delete-all', handleDeleteAllChats);

export default router;
