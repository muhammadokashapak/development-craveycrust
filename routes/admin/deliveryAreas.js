import express from 'express';
import { getDbClient } from '../../src/db/client.js';
import { createDeliveryAreaSchema, updateDeliveryAreaSchema } from '../../src/validators/deliveryAreaSchema.js';
import { slugify } from '../../src/utils/slugify.js';
import { getDefaultRestaurantId } from '../../src/services/restaurantService.js';
import { ensureDeliveryAreasSeeded } from '../../src/services/deliveryService.js';

const router = express.Router();

/**
 * Helper to resolve the effective restaurant ID for delivery area operations.
 */
async function resolveRestaurantId(req, prisma) {
    let restaurantId = req.user?.restaurantId || req.user?.restaurant_id;
    if (!restaurantId || restaurantId === 'default-restaurant') {
        try {
            restaurantId = await getDefaultRestaurantId();
        } catch (_) {}
    }

    if (restaurantId) {
        const exists = await prisma.restaurant.findUnique({
            where: { id: restaurantId },
            select: { id: true },
        }).catch(() => null);
        if (!exists) {
            restaurantId = await getDefaultRestaurantId().catch(() => null);
        }
    } else {
        restaurantId = await getDefaultRestaurantId().catch(() => null);
    }

    return restaurantId;
}

/**
 * GET /api/admin/delivery-areas
 * List all delivery areas
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

        const restaurantId = await resolveRestaurantId(req, prisma);

        let areas = [];
        // Attempt 1: Query for scoped restaurant (if not SUPER_ADMIN)
        if (restaurantId && req.user?.role !== 'SUPER_ADMIN') {
            areas = await prisma.deliveryArea.findMany({
                where: { restaurant_id: restaurantId },
                orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
            });
        }

        // Attempt 2: If scoped query returned nothing or user is SUPER_ADMIN, fetch globally
        if (!areas || areas.length === 0) {
            areas = await prisma.deliveryArea.findMany({
                where: {},
                orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
            });
        }


        const formatted = areas.map(a => ({
            id: a.id,
            name: a.name,
            slug: a.slug,
            delivery_fee: Number(a.delivery_fee),
            minimum_order: a.minimum_order != null ? Number(a.minimum_order) : null,
            is_active: a.is_active,
            sort_order: a.sort_order,
            latitude: a.latitude,
            longitude: a.longitude,
            radius_km: a.radius_km,
            aliases: a.aliases || '',
            created_at: a.created_at,
            updated_at: a.updated_at,
        }));

        return res.json({ success: true, data: formatted });
    } catch (err) {
        console.error('[ADMIN] Error listing delivery areas:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve delivery areas' },
        });
    }
});

/**
 * POST /api/admin/delivery-areas
 * Create a new delivery area
 */
router.post('/', async (req, res) => {
    try {
        const prisma = getDbClient();
        if (!prisma) {
            return res.status(503).json({
                success: false,
                error: { code: 'DB_UNAVAILABLE', message: 'Database not available' },
            });
        }

        const restaurantId = await resolveRestaurantId(req, prisma);
        if (!restaurantId) {
            return res.status(400).json({
                success: false,
                error: { code: 'NO_RESTAURANT', message: 'No valid restaurant found to attach delivery area' },
            });
        }

        const parsed = createDeliveryAreaSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: parsed.error.errors[0]?.message || 'Invalid delivery area data',
                    details: parsed.error.errors,
                },
            });
        }

        const { name, delivery_fee, minimum_order, is_active, sort_order, latitude, longitude, radius_km, aliases } = parsed.data;

        let baseSlug = slugify(name);
        let slug = baseSlug;
        let counter = 1;
        while (await prisma.deliveryArea.findFirst({ where: { restaurant_id: restaurantId, slug } })) {
            slug = `${baseSlug}-${counter++}`;
        }

        const area = await prisma.deliveryArea.create({
            data: {
                restaurant_id: restaurantId,
                name: name.trim(),
                slug,
                delivery_fee,
                minimum_order: minimum_order != null ? minimum_order : null,
                is_active: is_active ?? true,
                sort_order: sort_order ?? 0,
                latitude: latitude ?? null,
                longitude: longitude ?? null,
                radius_km: radius_km ?? null,
                aliases: aliases ? aliases.trim() : null,
            },
        });

        return res.status(201).json({
            success: true,
            data: {
                ...area,
                delivery_fee: Number(area.delivery_fee),
                minimum_order: area.minimum_order != null ? Number(area.minimum_order) : null,
            },
        });
    } catch (err) {
        console.error('[ADMIN] Error creating delivery area:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Failed to create delivery area' },
        });
    }
});

/**
 * GET /api/admin/delivery-areas/:id
 */
router.get('/:id', async (req, res) => {
    try {
        const prisma = getDbClient();
        if (!prisma) {
            return res.status(503).json({
                success: false,
                error: { code: 'DB_UNAVAILABLE', message: 'Database not available' },
            });
        }

        let restaurantId = req.user?.restaurantId;
        if (restaurantId === 'default-restaurant') restaurantId = null;

        let area = null;
        if (restaurantId && req.user?.role !== 'SUPER_ADMIN') {
            area = await prisma.deliveryArea.findFirst({
                where: { id: req.params.id, restaurant_id: restaurantId },
            });
        }
        if (!area) {
            area = await prisma.deliveryArea.findUnique({
                where: { id: req.params.id },
            });
        }

        if (!area) {
            return res.status(404).json({
                success: false,
                error: { code: 'DELIVERY_AREA_NOT_FOUND', message: 'Delivery area not found' },
            });
        }

        return res.json({
            success: true,
            data: {
                ...area,
                delivery_fee: Number(area.delivery_fee),
                minimum_order: area.minimum_order != null ? Number(area.minimum_order) : null,
            },
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message },
        });
    }
});

/**
 * PUT /api/admin/delivery-areas/:id
 */
router.put('/:id', async (req, res) => {
    try {
        const prisma = getDbClient();
        if (!prisma) {
            return res.status(503).json({
                success: false,
                error: { code: 'DB_UNAVAILABLE', message: 'Database not available' },
            });
        }

        const parsed = updateDeliveryAreaSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: parsed.error.errors[0]?.message || 'Invalid delivery area data',
                },
            });
        }

        let restaurantId = req.user?.restaurantId;
        if (restaurantId === 'default-restaurant') restaurantId = null;

        let existing = null;
        if (restaurantId && req.user?.role !== 'SUPER_ADMIN') {
            existing = await prisma.deliveryArea.findFirst({
                where: { id: req.params.id, restaurant_id: restaurantId },
            });
        }
        if (!existing) {
            existing = await prisma.deliveryArea.findUnique({
                where: { id: req.params.id },
            });
        }

        if (!existing) {
            return res.status(404).json({
                success: false,
                error: { code: 'DELIVERY_AREA_NOT_FOUND', message: 'Delivery area not found' },
            });
        }

        const updateData = {};
        if (parsed.data.name !== undefined) updateData.name = parsed.data.name.trim();
        if (parsed.data.delivery_fee !== undefined) updateData.delivery_fee = parsed.data.delivery_fee;
        if (parsed.data.minimum_order !== undefined) updateData.minimum_order = parsed.data.minimum_order;
        if (parsed.data.is_active !== undefined) updateData.is_active = parsed.data.is_active;
        if (parsed.data.sort_order !== undefined) updateData.sort_order = parsed.data.sort_order;
        if (parsed.data.latitude !== undefined) updateData.latitude = parsed.data.latitude;
        if (parsed.data.longitude !== undefined) updateData.longitude = parsed.data.longitude;
        if (parsed.data.radius_km !== undefined) updateData.radius_km = parsed.data.radius_km;
        if (parsed.data.aliases !== undefined) updateData.aliases = parsed.data.aliases ? parsed.data.aliases.trim() : null;

        const updated = await prisma.deliveryArea.update({
            where: { id: req.params.id },
            data: updateData,
        });

        return res.json({
            success: true,
            data: {
                ...updated,
                delivery_fee: Number(updated.delivery_fee),
                minimum_order: updated.minimum_order != null ? Number(updated.minimum_order) : null,
            },
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message },
        });
    }
});

/**
 * PATCH /api/admin/delivery-areas/:id/status
 */
router.patch('/:id/status', async (req, res) => {
    try {
        const prisma = getDbClient();
        if (!prisma) {
            return res.status(503).json({
                success: false,
                error: { code: 'DB_UNAVAILABLE', message: 'Database not available' },
            });
        }

        let restaurantId = req.user?.restaurantId;
        if (restaurantId === 'default-restaurant') restaurantId = null;

        let area = null;
        if (restaurantId && req.user?.role !== 'SUPER_ADMIN') {
            area = await prisma.deliveryArea.findFirst({
                where: { id: req.params.id, restaurant_id: restaurantId },
            });
        }
        if (!area) {
            area = await prisma.deliveryArea.findUnique({
                where: { id: req.params.id },
            });
        }

        if (!area) {
            return res.status(404).json({
                success: false,
                error: { code: 'DELIVERY_AREA_NOT_FOUND', message: 'Delivery area not found' },
            });
        }

        const newStatus = typeof req.body.is_active === 'boolean' ? req.body.is_active : !area.is_active;
        const updated = await prisma.deliveryArea.update({
            where: { id: req.params.id },
            data: { is_active: newStatus },
        });

        return res.json({
            success: true,
            data: { id: updated.id, is_active: updated.is_active },
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message },
        });
    }
});

/**
 * DELETE /api/admin/delivery-areas/:id
 */
router.delete('/:id', async (req, res) => {
    try {
        const prisma = getDbClient();
        if (!prisma) {
            return res.status(503).json({
                success: false,
                error: { code: 'DB_UNAVAILABLE', message: 'Database not available' },
            });
        }

        let restaurantId = req.user?.restaurantId;
        if (restaurantId === 'default-restaurant') restaurantId = null;

        let area = null;
        if (restaurantId && req.user?.role !== 'SUPER_ADMIN') {
            area = await prisma.deliveryArea.findFirst({
                where: { id: req.params.id, restaurant_id: restaurantId },
            });
        }
        if (!area) {
            area = await prisma.deliveryArea.findUnique({
                where: { id: req.params.id },
            });
        }

        if (!area) {
            return res.status(404).json({
                success: false,
                error: { code: 'DELIVERY_AREA_NOT_FOUND', message: 'Delivery area not found' },
            });
        }

        await prisma.deliveryArea.delete({ where: { id: req.params.id } });

        return res.json({
            success: true,
            data: { id: req.params.id, message: 'Delivery area deleted successfully' },
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message },
        });
    }
});

export default router;
