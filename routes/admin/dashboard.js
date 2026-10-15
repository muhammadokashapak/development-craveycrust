import express from 'express';
import { getDbClient } from '../../src/db/client.js';

const router = express.Router();

/**
 * GET /api/admin/dashboard
 * Summary statistics based exclusively on real database counts
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

        const restaurantId = req.user?.restaurantId;
        const where = restaurantId ? { restaurant_id: restaurantId } : {};

        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);

        const [
            categoriesCount,
            itemsCount,
            availableItemsCount,
            unavailableItemsCount,
            variantsCount,
            dealsCount,
            promotionsCount,
            deliveryAreasCount,
            customersCount,
            todayOrders,
            restaurant,
        ] = await Promise.all([
            prisma.category.count({ where }),
            prisma.menuItem.count({ where }),
            prisma.menuItem.count({ where: { ...where, is_available: true, is_active: true } }),
            prisma.menuItem.count({ where: { ...where, OR: [{ is_available: false }, { is_active: false }] } }),
            prisma.menuVariant.count({
                where: restaurantId ? { menu_item: { restaurant_id: restaurantId } } : {},
            }),
            prisma.deal.count({ where }),
            prisma.promotion.count({ where }),
            prisma.deliveryArea.count({ where }),
            prisma.customer.count({ where }),
            prisma.order.findMany({
                where: { ...where, created_at: { gte: startOfToday } },
                select: { total: true, order_status: true },
            }),
            restaurantId ? prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { name: true, currency: true } }) : null,
        ]);

        let todayRevenue = 0;
        for (const o of todayOrders) {
            if (o.order_status !== 'CANCELLED') {
                todayRevenue += Number(o.total);
            }
        }

        return res.json({
            success: true,
            data: {
                restaurant_name: restaurant?.name && !/cravey/i.test(restaurant.name) ? restaurant.name : 'Store Admin',
                currency: restaurant?.currency || 'PKR',
                stats: {
                    categories_count: categoriesCount,
                    items_count: itemsCount,
                    available_items_count: availableItemsCount,
                    unavailable_items_count: unavailableItemsCount,
                    variants_count: variantsCount,
                    deals_count: dealsCount,
                    promotions_count: promotionsCount,
                    delivery_areas_count: deliveryAreasCount,
                    customers_count: customersCount,
                    today_orders_count: todayOrders.length,
                    today_revenue: Math.round(todayRevenue * 100) / 100,
                },
                modules: {
                    orders: 'active',
                    deals: 'active',
                    delivery_areas: 'active',
                    customers: 'active',
                },
            },
        });
    } catch (err) {
        console.error('[ADMIN] Dashboard stats error:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message },
        });
    }
});

export default router;
