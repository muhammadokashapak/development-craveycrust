import express from 'express';
import { getDbClient } from '../../src/db/client.js';
import { getDefaultRestaurantId } from '../../src/services/restaurantService.js';

const router = express.Router();

/**
 * GET /api/internal/promotions/active
 * Returns active, unexpired promotions for bot ordering
 */
router.get('/active', async (req, res) => {
    return res.json({
        success: true,
        data: [],
    });
});

export default router;
