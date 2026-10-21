import express from 'express';
import { getDbClient } from '../../src/db/client.js';
import { getDefaultRestaurantId } from '../../src/services/restaurantService.js';

const router = express.Router();

/**
 * GET /api/internal/deals
 * Returns active, unexpired deals formatted for bot consumption.
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

        let restaurantId;
        try {
            restaurantId = await getDefaultRestaurantId();
        } catch (_) {}
        const now = new Date();

        const deals = await prisma.deal.findMany({
            where: {
                ...(restaurantId ? { restaurant_id: restaurantId } : {}),
                is_active: true,
                AND: [
                    { OR: [{ start_at: null }, { start_at: { lte: now } }] },
                    { OR: [{ end_at: null }, { end_at: { gte: now } }] },
                ],
            },
            orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
            include: {
                deal_items: {
                    include: {
                        menu_item: { select: { id: true, name: true, is_active: true, is_available: true } },
                        menu_variant: { select: { id: true, name: true, is_available: true } },
                    },
                },
            },
        });

        // Filter out deals if any contained item is unavailable
        const availableDeals = deals.filter(d => {
            return d.deal_items.every(di => {
                if (!di.menu_item || !di.menu_item.is_active || !di.menu_item.is_available) {
                    return false;
                }
                if (di.menu_variant && !di.menu_variant.is_available) {
                    return false;
                }
                return true;
            });
        });

        const typeFilter = String(req.query.type || req.query.category || '').trim().toLowerCase();

        const formatted = availableDeals.map(d => {
            const itemsText = (d.deal_items || []).map(di => di.menu_item?.name || '').join(' ');
            const fullText = (d.name + ' ' + itemsText).toLowerCase();
            const isBurger = /\b(burger|zinger|zeggy)\b/i.test(fullText);
            const isPizza = /\b(pizza)\b/i.test(fullText);
            let category = 'Special Deals';
            if (isBurger && !isPizza) category = 'Burger Deals';
            else if (isPizza && !isBurger) category = 'Pizza Deals';

            return {
                id: d.id,
                name: d.name,
                category,
                dealPrice: Number(d.deal_price),
                items: d.deal_items.map(di => ({
                    name: di.menu_item?.name || '',
                    variant: di.menu_variant?.name || undefined,
                    quantity: di.quantity,
                })),
            };
        }).filter(d => {
            if (!typeFilter) return true;
            if (typeFilter.includes('burger') || typeFilter.includes('zinger')) return d.category === 'Burger Deals';
            if (typeFilter.includes('pizza')) return d.category === 'Pizza Deals';
            return true;
        });

        return res.json({
            success: true,
            data: formatted,
        });
    } catch (err) {
        console.error('[INTERNAL] Error listing deals:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve deals' },
        });
    }
});

export default router;
