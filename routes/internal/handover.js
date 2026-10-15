import { Router } from 'express';
import { muteChatForHandover, isChatMuted, unmuteChat, getActiveHandoverMutes } from '../../src/services/handoverService.js';

const router = Router();

/**
 * POST /api/internal/handover
 * Mute chat for human handover (default 2 hours / 120 mins) and clear active cart memory
 */
router.post('/', async (req, res) => {
    try {
        const { chatId, sessionKey, durationMinutes = 120, reason, customerName, customerPhone, pushName } = req.body || {};

        if (!chatId && !sessionKey) {
            return res.status(400).json({
                success: false,
                error: 'chatId or sessionKey is required',
            });
        }

        const result = await muteChatForHandover({
            chatId,
            sessionKey,
            durationMinutes: Number(durationMinutes) || 120,
            reason: reason || 'Customer requested human support representative',
            customerName: customerName || pushName || null,
            customerPhone: customerPhone || null,
        });

        return res.json(result);
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: {
                code: 'HANDOVER_ERROR',
                message: err.message,
            },
        });
    }
});

/**
 * POST /api/internal/handover/unmute
 * Unmute a chat before the 2 hours expire
 */
router.post('/unmute', async (req, res) => {
    try {
        const { chatId } = req.body || {};
        if (!chatId) {
            return res.status(400).json({ success: false, error: 'chatId is required' });
        }
        const result = unmuteChat(chatId);
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/internal/handover/status
 * Check mute status for a specific chat or get all active mutes
 */
router.get('/status', (req, res) => {
    const { chatId } = req.query || {};
    if (chatId) {
        const status = isChatMuted(chatId);
        return res.json({ success: true, ...status });
    }
    const all = getActiveHandoverMutes();
    return res.json({ success: true, activeMutes: all });
});

export default router;
