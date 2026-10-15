import express from 'express';
import {
    createOrder,
    getOrderByNumber,
    getOrdersByCustomerPhone,
    requestOrderCancellation,
    confirmOrderCancellation,
} from '../../src/services/orderService.js';
import { getDefaultRestaurantId } from '../../src/services/restaurantService.js';

const router = express.Router();

/**
 * Helper to format a slim, token-optimized order object for AI bots
 */
function formatSlimOrder(order) {
    if (!order) return null;
    return {
        orderNumber: order.orderNumber,
        status: order.orderStatus || order.status || 'CONFIRMED',
        customerName: order.customerName || order.customer?.name || '',
        phone: order.phone || order.customer?.phone || '',
        total: order.pricing?.total ?? order.total ?? 0,
        subtotal: order.pricing?.subtotal ?? order.subtotal ?? 0,
        deliveryFee: order.pricing?.deliveryFee ?? order.deliveryFee ?? 0,
        deliveryAddress: order.delivery?.address || '',
        paymentMethod: order.payment?.method || order.paymentMethod || 'COD',
        items: (order.items || []).map(i => ({
            name: i.itemName || i.name,
            variant: i.variantName || undefined,
            quantity: i.quantity,
            price: i.unitPrice,
        })),
    };
}

/**
 * POST /api/internal/orders
 * Create an order from session cart with idempotency and transaction safety
 */
router.post('/', async (req, res) => {
    try {
        const restaurantId = await getDefaultRestaurantId();
        const idempotencyKey = req.headers['idempotency-key'] || req.body?.idempotencyKey;

        const result = await createOrder({
            restaurantId,
            idempotencyKey,
            ...req.body,
        });

        const statusCode = result.isDuplicate ? 200 : 201;
        return res.status(statusCode).json({
            success: true,
            status: result.status,
            isDuplicate: result.isDuplicate,
            data: formatSlimOrder(result.order),
        });
    } catch (err) {
        console.warn('[INTERNAL ORDER CREATE] Error:', err.code, err.message);
        return res.status(err.code ? 400 : 500).json({
            success: false,
            error: {
                code: err.code || 'ORDER_CREATION_FAILED',
                message: err.message,
            },
        });
    }
});

/**
 * GET /api/internal/orders/customer/:phone
 * Lookup recent orders for a customer (e.g. "mera order kahan hai?")
 */
router.get('/customer/:phone', async (req, res) => {
    try {
        const { phone } = req.params;
        const restaurantId = await getDefaultRestaurantId();
        const orders = await getOrdersByCustomerPhone({ restaurantId, phone });

        const slimOrders = (orders || []).map(o => ({
            orderNumber: o.orderNumber,
            status: o.orderStatus,
            total: o.pricing?.total ?? o.total ?? 0,
            createdAt: o.createdAt,
            items: (o.items || []).map(i => `${i.quantity}x ${i.itemName || i.name}`).join(', '),
        }));

        return res.json({
            success: true,
            data: slimOrders,
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: {
                code: err.code || 'CUSTOMER_ORDERS_ERROR',
                message: err.message,
            },
        });
    }
});

/**
 * GET /api/internal/orders/:orderNumber
 * Authoritative order details lookup
 */
router.get('/:orderNumber', async (req, res) => {
    try {
        const { orderNumber } = req.params;
        const restaurantId = await getDefaultRestaurantId();
        const order = await getOrderByNumber({ restaurantId, orderNumber });

        if (!order) {
            return res.status(404).json({
                success: false,
                error: {
                    code: 'ORDER_NOT_FOUND',
                    message: `Order ${orderNumber} not found`,
                },
            });
        }

        return res.json({
            success: true,
            data: formatSlimOrder(order),
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: {
                code: err.code || 'ORDER_LOOKUP_ERROR',
                message: err.message,
            },
        });
    }
});

/**
 * POST /api/internal/orders/:orderNumber/request-cancel
 * Two-Step Cancellation: Step 1
 */
router.post('/:orderNumber/request-cancel', async (req, res) => {
    try {
        const { orderNumber } = req.params;
        const { sessionKey } = req.body || {};
        const restaurantId = await getDefaultRestaurantId();

        const result = await requestOrderCancellation({
            restaurantId,
            orderNumber,
            sessionKey,
        });

        return res.json({
            success: true,
            ...result,
        });
    } catch (err) {
        return res.status(err.code ? 400 : 500).json({
            success: false,
            error: {
                code: err.code || 'CANCEL_REQUEST_FAILED',
                message: err.message,
            },
        });
    }
});

/**
 * POST /api/internal/orders/:orderNumber/confirm-cancel
 * Two-Step Cancellation: Step 2
 */
router.post('/:orderNumber/confirm-cancel', async (req, res) => {
    try {
        const { orderNumber } = req.params;
        const { sessionKey, confirmed } = req.body || {};
        const restaurantId = await getDefaultRestaurantId();

        const result = await confirmOrderCancellation({
            restaurantId,
            orderNumber,
            sessionKey,
            confirmed: confirmed === true || confirmed === 'true',
        });

        return res.json({
            success: true,
            ...result,
        });
    } catch (err) {
        return res.status(err.code ? 400 : 500).json({
            success: false,
            error: {
                code: err.code || 'CANCEL_CONFIRM_FAILED',
                message: err.message,
            },
        });
    }
});

export default router;
