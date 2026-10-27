import express from 'express';
import {
    listCustomers,
    getCustomerById,
    deleteCustomer,
    deleteCustomerByPhone,
    bulkDeleteCustomers,
} from '../../src/services/customerService.js';
import { getDefaultRestaurantId } from '../../src/services/restaurantService.js';

const router = express.Router();

/**
 * GET /api/admin/customers
 * List registered customers with search, order metrics and pagination
 */
router.get('/', async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        const restaurantId = req.user?.restaurantId || req.user?.restaurant_id || await getDefaultRestaurantId();
        const { search, page, limit } = req.query;

        const result = await listCustomers({
            restaurantId,
            search,
            page: page ? parseInt(page, 10) : 1,
            limit: limit ? parseInt(limit, 10) : 50,
        });

        return res.json({
            success: true,
            data: result,
        });
    } catch (err) {
        return res.json({
            success: true,
            data: {
                customers: [],
                total: 0,
                page: 1,
                limit: 50,
                totalPages: 0,
            },
        });
    }
});

/**
 * GET /api/admin/customers/:id
 * Retrieve single customer with complete order history
 */
router.get('/:id', async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        const restaurantId = req.user?.restaurantId || req.user?.restaurant_id || await getDefaultRestaurantId();
        const { id } = req.params;

        const customer = await getCustomerById({
            restaurantId,
            customerId: id,
        });

        if (!customer) {
            return res.status(404).json({
                success: false,
                error: 'Customer record not found',
            });
        }

        return res.json({
            success: true,
            data: customer,
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: err.message,
        });
    }
});

/**
 * DELETE /api/admin/customers/:id
 * Manually delete customer record and clean up associated carts/sessions
 * Query param: ?deleteOrders=true to also delete historical order records
 */
router.delete('/:id', async (req, res) => {
    try {
        const restaurantId = req.user?.restaurantId || req.user?.restaurant_id || await getDefaultRestaurantId();
        const { id } = req.params;
        const deleteOrders = req.query.deleteOrders === 'true' || req.body?.deleteOrders === true;

        const result = await deleteCustomer({
            restaurantId,
            customerId: id,
            deleteOrders,
        });

        return res.json({
            success: true,
            message: 'Customer record successfully deleted',
            data: result,
        });
    } catch (err) {
        if (err.message === 'Customer not found') {
            // Idempotent delete: if already removed from DB, return success so client cleans up cache
            return res.json({
                success: true,
                alreadyDeleted: true,
                message: 'Customer record already deleted or not found in database',
                data: { deleted: true, customerId: req.params.id, alreadyDeleted: true },
            });
        }
        return res.status(500).json({
            success: false,
            error: err.message,
        });
    }
});

/**
 * DELETE /api/admin/customers/by-phone/:phone
 * Delete customer records and sessions matching phone
 */
router.delete('/by-phone/:phone', async (req, res) => {
    try {
        const restaurantId = req.user?.restaurantId || req.user?.restaurant_id || await getDefaultRestaurantId();
        const { phone } = req.params;
        const deleteOrders = req.query.deleteOrders === 'true' || req.body?.deleteOrders === true;

        const result = await deleteCustomerByPhone({
            restaurantId,
            phone,
            deleteOrders,
        });

        return res.json({
            success: true,
            message: 'Customer data successfully deleted',
            data: result,
        });
    } catch (err) {
        if (err.message === 'Customer not found') {
            return res.json({
                success: true,
                alreadyDeleted: true,
                message: 'Customer record already deleted or not found in database',
                data: { deleted: true, phone: req.params.phone, alreadyDeleted: true },
            });
        }
        return res.status(500).json({
            success: false,
            error: err.message,
        });
    }
});

/**
 * POST /api/admin/customers/bulk-delete
 * Bulk delete customer records by IDs or inactive age (olderThanDays)
 */
router.post('/bulk-delete', async (req, res) => {
    try {
        const restaurantId = req.user?.restaurantId || req.user?.restaurant_id || await getDefaultRestaurantId();
        const { customerIds, olderThanDays, deleteOrders } = req.body || {};

        const result = await bulkDeleteCustomers({
            restaurantId,
            customerIds,
            olderThanDays,
            deleteOrders: Boolean(deleteOrders),
        });

        return res.json({
            success: true,
            message: `Successfully purged ${result.count} customer records`,
            data: result,
        });
    } catch (err) {
        return res.status(400).json({
            success: false,
            error: err.message,
        });
    }
});

/**
 * POST /api/admin/customers/delete-all
 * DELETE /api/admin/customers/delete-all
 */
const handleDeleteAllCustomers = async (req, res) => {
    try {
        const restaurantId = req.user?.restaurantId || req.user?.restaurant_id || await getDefaultRestaurantId();
        const deleteOrders = req.body?.deleteOrders === true || req.query?.deleteOrders === 'true';
        const result = await bulkDeleteCustomers({
            restaurantId,
            olderThanDays: 0,
            deleteOrders,
        });
        return res.json({
            success: true,
            count: result.count,
            message: `Successfully deleted all ${result.count} customer records`,
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
};

router.post('/delete-all', handleDeleteAllCustomers);
router.delete('/delete-all', handleDeleteAllCustomers);

export default router;
