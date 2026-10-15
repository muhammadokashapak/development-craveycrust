import express from 'express';
import { getDbClient } from '../../src/db/client.js';
import { getDefaultRestaurantId } from '../../src/services/restaurantService.js';

const router = express.Router();

/**
 * GET /api/internal/restaurant
 * Returns live restaurant identity, timings, location, and payment details.
 */
router.get('/', async (req, res) => {
    try {
        const prisma = getDbClient();
        if (!prisma) {
            return res.status(503).json({
                success: false,
                error: { code: 'DB_UNAVAILABLE', message: 'Database not available' },
            });
        }

        const restaurantId = await getDefaultRestaurantId();
        const restaurant = await prisma.restaurant.findUnique({
            where: { id: restaurantId },
            include: { settings: true },
        });

        if (!restaurant) {
            return res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Restaurant not found' },
            });
        }

        const settingsMap = {};
        for (const s of restaurant.settings || []) {
            settingsMap[s.key] = s.value;
        }

        return res.json({
            success: true,
            data: {
                name: restaurant.name,
                address: restaurant.address || '',
                phone: restaurant.phone || '',
                timings: `${restaurant.opening_time || ''} to ${restaurant.closing_time || ''}`,
                minOrder: Number(restaurant.min_order || 0),
                codEnabled: restaurant.cod_enabled,
                easypaisaEnabled: restaurant.easypaisa_enabled,
                easypaisaNumber: restaurant.easypaisa_number || '',
            },
        });
    } catch (err) {
        console.error('[INTERNAL] Error fetching restaurant info:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'SERVER_ERROR', message: err.message },
        });
    }
});

export default router;
