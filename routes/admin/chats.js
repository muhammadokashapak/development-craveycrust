import express from 'express';
import { getConversations, getCustomerChatMessages } from '../../src/services/chatService.js';
import { requireRole } from '../../src/middleware/auth.js';

const router = express.Router();

// Customer chat endpoints require ADMIN or SUPER_ADMIN role
router.use(requireRole(['SUPER_ADMIN', 'ADMIN']));

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

export default router;
