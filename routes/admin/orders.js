import express from 'express';
import {
    getAdminOrders,
    getAdminOrderMetrics,
    getOrderByNumber,
    updateOrderStatus,
    deleteOrderByNumber,
} from '../../src/services/orderService.js';
import { registerSseClient } from '../../src/services/realtimeService.js';
import { getDefaultRestaurantId } from '../../src/services/restaurantService.js';

const router = express.Router();

/**
 * GET /api/admin/orders/stream
 * Real-time Server-Sent Events (SSE) feed for Admin Dashboard
 */
router.get('/stream', (req, res) => {
    registerSseClient(req, res);
});

/**
 * GET /api/admin/orders/metrics
 * Today's live order metrics strictly from PostgreSQL
 */
router.get('/metrics', async (req, res) => {
    try {
        const restaurantId = req.user?.restaurantId || req.user?.restaurant_id || await getDefaultRestaurantId();
        const metrics = await getAdminOrderMetrics({ restaurantId });

        return res.json({
            success: true,
            data: metrics,
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: err.message,
        });
    }
});

/**
 * GET /api/admin/orders
 * List orders with status, date, and search filters
 */
router.get('/', async (req, res) => {
    try {
        const restaurantId = req.user?.restaurantId || req.user?.restaurant_id || await getDefaultRestaurantId();
        const { status, date, search, page, limit } = req.query;

        const result = await getAdminOrders({
            restaurantId,
            status,
            date,
            search,
            page: page ? parseInt(page, 10) : 1,
            limit: limit ? parseInt(limit, 10) : 50,
        });

        return res.json({
            success: true,
            data: result,
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: err.message,
        });
    }
});

/**
 * GET /api/admin/orders/:orderNumber
 * Detailed view of order with items snapshots and status history
 */
router.get('/:orderNumber', async (req, res) => {
    try {
        const restaurantId = req.user?.restaurantId || req.user?.restaurant_id || await getDefaultRestaurantId();
        const { orderNumber } = req.params;

        const order = await getOrderByNumber({
            restaurantId,
            orderNumber,
        });

        if (!order) {
            return res.status(404).json({
                success: false,
                error: 'Order not found',
            });
        }

        return res.json({
            success: true,
            data: order,
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: err.message,
        });
    }
});

/**
 * PATCH /api/admin/orders/:orderNumber/status
 * Update status with state machine enforcement
 */
router.patch('/:orderNumber/status', async (req, res) => {
    try {
        const restaurantId = req.user?.restaurantId || req.user?.restaurant_id || await getDefaultRestaurantId();
        const { orderNumber } = req.params;
        const { status, reason } = req.body || {};

        if (!status) {
            return res.status(400).json({
                success: false,
                error: 'New status is required',
            });
        }

        const updatedOrder = await updateOrderStatus({
            restaurantId,
            orderNumber,
            newStatus: status,
            changedByType: 'ADMIN',
            changedById: req.user?.id || req.user?.userId || null,
            reason,
        });

        return res.json({
            success: true,
            data: updatedOrder,
        });
    } catch (err) {
        return res.status(err.code === 'INVALID_STATUS_TRANSITION' ? 400 : 500).json({
            success: false,
            error: {
                code: err.code || 'STATUS_UPDATE_ERROR',
                message: err.message,
            },
        });
    }
});

/**
 * POST /api/admin/orders/:orderNumber/cancel
 * Admin cancellation
 */
router.post('/:orderNumber/cancel', async (req, res) => {
    try {
        const restaurantId = req.user?.restaurantId || req.user?.restaurant_id || await getDefaultRestaurantId();
        const { orderNumber } = req.params;
        const { reason } = req.body || {};

        const updatedOrder = await updateOrderStatus({
            restaurantId,
            orderNumber,
            newStatus: 'CANCELLED',
            changedByType: 'ADMIN',
            changedById: req.user?.id || req.user?.userId || null,
            reason: reason || 'Cancelled by admin',
        });

        return res.json({
            success: true,
            data: updatedOrder,
        });
    } catch (err) {
        return res.status(err.code === 'INVALID_STATUS_TRANSITION' ? 400 : 500).json({
            success: false,
            error: {
                code: err.code || 'CANCEL_ERROR',
                message: err.message,
            },
        });
    }
});

/**
 * DELETE /api/admin/orders/:orderNumber
 * Permanently delete an order and related snapshots
 */
router.delete('/:orderNumber', async (req, res) => {
    try {
        const restaurantId = req.user?.restaurantId || req.user?.restaurant_id || await getDefaultRestaurantId();
        const { orderNumber } = req.params;

        await deleteOrderByNumber({
            restaurantId,
            orderNumber,
        });

        return res.json({
            success: true,
            message: `Order ${orderNumber} deleted successfully`,
        });
    } catch (err) {
        return res.status(err.code === 'ORDER_NOT_FOUND' ? 404 : 500).json({
            success: false,
            error: {
                code: err.code || 'DELETE_ERROR',
                message: err.message,
            },
        });
    }
});

export default router;
