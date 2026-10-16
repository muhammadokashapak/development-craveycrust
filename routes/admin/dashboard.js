import express from 'express';
import { getDbClient } from '../../src/db/client.js';

const router = express.Router();

// Ensure dashboard metrics and recent orders are never cached
router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
});

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
        let restId = restaurantId;
        if (!restId || restId === 'default-restaurant') {
            const { getDefaultRestaurantId } = await import('../../src/services/restaurantService.js');
            restId = await getDefaultRestaurantId().catch(() => null);
        }
        let where = restId && restId !== 'default-restaurant' ? { restaurant_id: restId } : {};

        // If scoped restaurant has 0 orders but global orders exist, fall back to all orders
        if (where.restaurant_id) {
            const countForRest = await prisma.order.count({ where });
            if (countForRest === 0) {
                const totalGlobal = await prisma.order.count();
                if (totalGlobal > 0) {
                    where = {};
                }
            }
        }

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
            totalOrdersCount,
            todayOrders,
            allOrdersForRevenue,
            recentOrdersRaw,
            restaurant,
        ] = await Promise.all([
            prisma.category.count({ where }),
            prisma.menuItem.count({ where }),
            prisma.menuItem.count({ where: { ...where, is_available: true, is_active: true } }),
            prisma.menuItem.count({ where: { ...where, OR: [{ is_available: false }, { is_active: false }] } }),
            prisma.menuVariant.count({
                where: restId ? { menu_item: { restaurant_id: restId } } : {},
            }),
            prisma.deal.count({ where }),
            prisma.promotion.count({ where }),
            prisma.deliveryArea.count({ where }),
            prisma.customer.count({ where }),
            prisma.order.count({ where }),
            prisma.order.findMany({
                where: { ...where, created_at: { gte: startOfToday } },
                select: { total: true, order_status: true },
            }),
            prisma.order.findMany({
                where: { ...where, order_status: { not: 'CANCELLED' } },
                select: { total: true },
            }),
            prisma.order.findMany({
                where,
                orderBy: { created_at: 'desc' },
                take: 5,
                include: { order_items: true },
            }),
            restId ? prisma.restaurant.findUnique({ where: { id: restId }, select: { name: true, currency: true } }) : null,
        ]);

        let todayRevenue = 0;
        for (const o of todayOrders) {
            if (o.order_status !== 'CANCELLED') {
                todayRevenue += Number(o.total);
            }
        }

        let totalRevenue = 0;
        for (const o of allOrdersForRevenue) {
            totalRevenue += Number(o.total);
        }

        const recentOrders = recentOrdersRaw.map(o => ({
            id: o.id,
            orderNumber: o.order_number,
            customerName: o.customer_name,
            phone: o.phone,
            total: Number(o.total),
            orderStatus: o.order_status,
            paymentMethod: o.payment_method,
            paymentStatus: o.payment_status,
            itemCount: o.order_items.reduce((sum, i) => sum + i.quantity, 0),
            itemsSummary: o.order_items.map(i => `${i.quantity}x ${i.item_name_snapshot || i.deal_name_snapshot}`).join(', '),
            createdAt: o.created_at,
        }));

        return res.json({
            success: true,
            data: {
                restaurant_name: 'Admin',
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
                    total_orders_count: totalOrdersCount,
                    today_orders_count: todayOrders.length,
                    today_revenue: Math.round(todayRevenue * 100) / 100,
                    total_revenue: Math.round(totalRevenue * 100) / 100,
                },
                recent_orders: recentOrders,
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
