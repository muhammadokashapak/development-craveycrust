import express from 'express';
import { getDbClient } from '../../src/db/client.js';
import { getDefaultRestaurantId } from '../../src/services/restaurantService.js';

const router = express.Router();

/**
 * GET /api/internal/faq-categories
 * List active FAQ categories for internal consumers.
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

        const categories = await prisma.fAQCategory.findMany({
            where: {
                restaurant_id: restaurantId,
                is_active: true,
            },
            orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
        });

        return res.json({
            success: true,
            data: categories.map((c) => ({
                id: c.id,
                name: c.name,
                slug: c.slug,
                description: c.description,
            })),
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message },
        });
    }
});

export default router;
