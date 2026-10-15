import express from 'express';
import { calculatePricingSchema } from '../../src/validators/pricingSchema.js';
import { calculatePricing } from '../../src/services/pricingService.js';
import { getDefaultRestaurantId } from '../../src/services/restaurantService.js';

const router = express.Router();

/**
 * POST /api/internal/pricing/calculate
 * Calculate full order pricing (subtotal, deals, variants, discounts, delivery, total)
 */
router.post('/calculate', async (req, res) => {
    try {
        const parsed = calculatePricingSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: parsed.error.errors[0]?.message || 'Invalid pricing request',
                    details: parsed.error.errors,
                },
            });
        }

        const restaurantId = await getDefaultRestaurantId();
        const pricingResult = await calculatePricing({
            restaurantId,
            ...parsed.data,
        });

        return res.json({
            success: true,
            data: pricingResult,
        });
    } catch (err) {
        console.warn('[INTERNAL PRICING] Calculation error:', err.code || err.message);
        return res.status(err.code ? 400 : 500).json({
            success: false,
            error: {
                code: err.code || 'INTERNAL_ERROR',
                message: err.message || 'Failed to calculate pricing',
            },
        });
    }
});

export default router;
