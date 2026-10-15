import express from 'express';
import { getDbClient } from '../../src/db/client.js';
import { updateSettingsSchema } from '../../src/validators/settingsSchema.js';
import { getDefaultRestaurantId } from '../../src/services/restaurantService.js';
import { requireRole } from '../../src/middleware/auth.js';

const router = express.Router();
router.use(requireRole(['SUPER_ADMIN']));

/**
 * GET /api/admin/settings
 * Fetch restaurant profile and key-value settings
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

        const restaurantId = req.user?.restaurantId || (await getDefaultRestaurantId());
        const restaurant = await prisma.restaurant.findUnique({
            where: { id: restaurantId },
            include: { settings: true },
        });

        if (!restaurant) {
            return res.status(404).json({
                success: false,
                error: { code: 'RESTAURANT_NOT_FOUND', message: 'Restaurant record not found' },
            });
        }

        const customSettingsMap = {};
        restaurant.settings.forEach(s => {
            customSettingsMap[s.key] = s.value;
        });

        const data = {
            id: restaurant.id,
            name: restaurant.name,
            slug: restaurant.slug,
            logo_url: restaurant.logo_url,
            phone: restaurant.phone,
            address: restaurant.address,
            currency: restaurant.currency,
            timezone: restaurant.timezone,
            opening_time: restaurant.opening_time,
            closing_time: restaurant.closing_time,
            min_order: restaurant.min_order !== null ? Number(restaurant.min_order) : null,
            default_delivery_fee: restaurant.default_delivery_fee !== null ? Number(restaurant.default_delivery_fee) : null,
            cod_enabled: restaurant.cod_enabled,
            easypaisa_enabled: restaurant.easypaisa_enabled,
            easypaisa_number: restaurant.easypaisa_number,
            account_name: restaurant.account_name,
            admin_notification_phone: restaurant.admin_notification_phone,
            is_active: restaurant.is_active,
            custom_settings: customSettingsMap,
        };

        return res.json({ success: true, data });
    } catch (err) {
        console.error('[ADMIN] Get settings error:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message },
        });
    }
});

/**
 * PUT /api/admin/settings
 * Update restaurant profile and key-value settings
 */
router.put('/', async (req, res) => {
    try {
        const parseResult = updateSettingsSchema.safeParse(req.body);
        if (!parseResult.success) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: parseResult.error.errors[0]?.message || 'Invalid settings data',
                },
            });
        }

        const prisma = getDbClient();
        const restaurantId = req.user?.restaurantId || (await getDefaultRestaurantId());
        const {
            name,
            phone,
            address,
            currency,
            timezone,
            opening_time,
            closing_time,
            min_order,
            default_delivery_fee,
            cod_enabled,
            easypaisa_enabled,
            easypaisa_number,
            account_name,
            admin_notification_phone,
            custom_settings,
        } = parseResult.data;

        const updateData = {};
        if (name !== undefined) {
            updateData.name = name;
            updateData.slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/^-+|-+$/g, '') || 'store';
        }
        if (phone !== undefined) updateData.phone = phone;
        if (address !== undefined) updateData.address = address;
        if (currency !== undefined) updateData.currency = currency;
        if (timezone !== undefined) updateData.timezone = timezone;
        if (opening_time !== undefined) updateData.opening_time = opening_time;
        if (closing_time !== undefined) updateData.closing_time = closing_time;
        if (min_order !== undefined) updateData.min_order = min_order;
        if (default_delivery_fee !== undefined) updateData.default_delivery_fee = default_delivery_fee;
        if (cod_enabled !== undefined) updateData.cod_enabled = cod_enabled;
        if (easypaisa_enabled !== undefined) updateData.easypaisa_enabled = easypaisa_enabled;
        if (easypaisa_number !== undefined) updateData.easypaisa_number = easypaisa_number;
        if (account_name !== undefined) updateData.account_name = account_name;
        if (admin_notification_phone !== undefined) updateData.admin_notification_phone = admin_notification_phone;

        const updated = await prisma.restaurant.update({
            where: { id: restaurantId },
            data: updateData,
        });

        // Update custom settings key-values if provided
        if (custom_settings && typeof custom_settings === 'object') {
            for (const [key, val] of Object.entries(custom_settings)) {
                await prisma.restaurantSetting.upsert({
                    where: {
                        restaurant_id_key: {
                            restaurant_id: restaurantId,
                            key,
                        },
                    },
                    update: { value: String(val) },
                    create: {
                        restaurant_id: restaurantId,
                        key,
                        value: String(val),
                    },
                });
            }
        }

        try {
            const { bumpSyncEpoch } = await import('../../src/services/catalogCacheService.js');
            bumpSyncEpoch();
        } catch (_) {}

        return res.json({
            success: true,
            data: {
                ...updated,
                min_order: updated.min_order !== null ? Number(updated.min_order) : null,
                default_delivery_fee: updated.default_delivery_fee !== null ? Number(updated.default_delivery_fee) : null,
            },
        });
    } catch (err) {
        console.error('[ADMIN] Update settings error:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message },
        });
    }
});

export default router;
