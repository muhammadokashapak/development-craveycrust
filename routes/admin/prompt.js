import express from 'express';
import { getPromptInfo, saveCustomPrompt, resetCustomPrompt } from '../../src/config/systemPrompt.js';
import { requireRole } from '../../src/middleware/auth.js';

const router = express.Router();
router.use(requireRole(['SUPER_ADMIN', 'ADMIN']));

/**
 * GET /api/admin/prompt
 * Fetch active prompt, default prompt, and custom state
 */
router.get('/', (req, res) => {
    try {
        const info = getPromptInfo();
        return res.json({
            success: true,
            data: info,
        });
    } catch (err) {
        console.error('[ADMIN] Get prompt error:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message },
        });
    }
});

/**
 * PUT /api/admin/prompt
 * Save a new custom prompt
 */
router.put('/', async (req, res) => {
    try {
        const { prompt } = req.body || {};
        // If empty, treat as reset to clean default
        if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
            const resetInfo = await resetCustomPrompt();
            return res.json({
                success: true,
                message: 'Bot system prompt cleared and reset to default template.',
                data: resetInfo,
            });
        }

        const updatedInfo = await saveCustomPrompt(prompt);
        return res.json({
            success: true,
            message: 'Bot system prompt updated successfully! All future customer messages will use this prompt immediately.',
            data: updatedInfo,
        });
    } catch (err) {
        console.error('[ADMIN] Update prompt error:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message },
        });
    }
});

/**
 * POST /api/admin/prompt/reset
 * Revert prompt back to original default prompt
 */
router.post('/reset', async (req, res) => {
    try {
        const resetInfo = await resetCustomPrompt();
        return res.json({
            success: true,
            message: 'Bot system prompt has been reset to the default system prompt.',
            data: resetInfo,
        });
    } catch (err) {
        console.error('[ADMIN] Reset prompt error:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message },
        });
    }
});

export default router;
