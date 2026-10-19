import express from 'express';
import { getDbClient } from '../../src/db/client.js';
import { getDefaultRestaurantId } from '../../src/services/restaurantService.js';
import { checkDeliveryAvailability } from '../../src/services/deliveryService.js';
import { checkDeliverySchema } from '../../src/validators/deliveryCheckSchema.js';

const router = express.Router();

/**
 * GET /api/internal/delivery-areas or GET /api/internal/delivery/areas
 * List active delivery areas
 */
router.get(['/', '/areas'], async (req, res) => {
    try {
        const prisma = getDbClient();
        if (!prisma) {
            return res.status(503).json({
                success: false,
                error: { code: 'DB_UNAVAILABLE', message: 'Database not available' },
            });
        }

        const restaurantId = await getDefaultRestaurantId();
        let areas = await prisma.deliveryArea.findMany({
            where: {
                restaurant_id: restaurantId,
                is_active: true,
            },
            orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
        });

        if (areas.length === 0) {
            areas = await prisma.deliveryArea.findMany({
                where: { is_active: true },
                orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
            });
            if (areas.length === 0) {
                const { ensureDeliveryAreasSeeded } = await import('../../src/services/deliveryService.js');
                await ensureDeliveryAreasSeeded(prisma, restaurantId);
                areas = await prisma.deliveryArea.findMany({
                    where: { is_active: true },
                    orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
                });
            }
        }

        const formatted = areas.map(a => ({
            id: a.id,
            name: a.name,
            slug: a.slug,
            deliveryFee: Number(a.delivery_fee),
            minimumOrder: a.minimum_order != null ? Number(a.minimum_order) : 0,
        }));

        return res.json({
            success: true,
            data: formatted,
        });
    } catch (err) {
        console.error('[INTERNAL] Error listing delivery areas:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve delivery areas' },
        });
    }
});

/**
 * POST /api/internal/delivery/check
 * Check delivery availability for an area or coordinates
 */
router.post('/check', async (req, res) => {
    try {
        const prisma = getDbClient();
        if (!prisma) {
            return res.status(503).json({
                success: false,
                error: { code: 'DB_UNAVAILABLE', message: 'Database not available' },
            });
        }

        const parsed = checkDeliverySchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: parsed.error.errors[0]?.message || 'Invalid delivery check parameters',
                },
            });
        }

        const restaurantId = await getDefaultRestaurantId();
        const result = await checkDeliveryAvailability({
            restaurantId,
            ...parsed.data,
        });

        if (!result.available) {
            return res.json({
                success: true,
                data: {
                    available: false,
                    message: result.message,
                },
            });
        }

        return res.json({
            success: true,
            data: {
                available: true,
                areaName: result.area?.name || result.deliveryAddress || 'Delivery Area',
                areaId: result.area?.id || undefined,
                deliveryFee: result.deliveryFee,
                deliveryAddress: result.deliveryAddress,
            },
        });
    } catch (err) {
        console.error('[INTERNAL] Error checking delivery:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message },
        });
    }
});

export default router;
