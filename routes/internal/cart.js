import express from 'express';
import {
    getActiveCart,
    addItemToCart,
    updateCartItem,
    removeCartItem,
    clearCart,
    calculateCartTotals,
} from '../../src/services/cartService.js';
import { getDefaultRestaurantId } from '../../src/services/restaurantService.js';

const router = express.Router();

/**
 * Format a slim, token-optimized cart object for AI bots
 */
function formatSlimCart(cart) {
    if (!cart) return { items: [], subtotal: 0, totalItems: 0 };
    let subtotal = 0;
    const items = (cart.items || []).map(item => {
        const name = item.menu_item?.name || item.deal?.name || 'Item';
        const variant = item.menu_variant?.name || null;
        const unitPrice = Number(item.menu_variant?.price || item.menu_item?.base_price || item.deal?.deal_price || item.deal?.price || 0);
        const lineTotal = unitPrice * (item.quantity || 1);
        subtotal += lineTotal;
        return {
            cartItemId: item.id,
            name,
            variant: variant || undefined,
            quantity: item.quantity,
            price: unitPrice,
            lineTotal,
            notes: item.notes || undefined,
        };
    });
    return {
        cartId: cart.id,
        items,
        totalItems: items.reduce((acc, i) => acc + i.quantity, 0),
        subtotal,
    };
}

/**
 * Format slim totals for calculate endpoint
 */
function formatSlimTotals(totals) {
    if (!totals) return { items: [], subtotal: 0, total: 0 };
    return {
        items: (totals.items || []).map(i => ({
            name: i.name,
            variant: i.variantName || undefined,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            lineTotal: i.lineTotal,
        })),
        deals: (totals.deals || []).map(d => ({
            name: d.name,
            quantity: d.quantity,
            unitPrice: d.unitPrice,
            lineTotal: d.lineTotal,
        })),
        subtotal: totals.subtotal,
        deliveryFee: totals.deliveryFee,
        deliveryArea: totals.deliveryArea?.name || undefined,
        discountTotal: totals.discountTotal > 0 ? totals.discountTotal : undefined,
        total: totals.total,
    };
}

/**
 * GET /api/internal/cart/:sessionKey
 * Load active cart for a session
 */
router.get('/:sessionKey', async (req, res) => {
    try {
        const { sessionKey } = req.params;
        const restaurantId = await getDefaultRestaurantId();
        const cart = await getActiveCart({
            sessionKey,
            restaurantId,
            chatId: req.query.chatId,
            verifiedPhone: req.query.verifiedPhone,
        });

        return res.json({
            success: true,
            data: formatSlimCart(cart),
        });
    } catch (err) {
        return res.status(err.code ? 400 : 500).json({
            success: false,
            error: {
                code: err.code || 'INTERNAL_ERROR',
                message: err.message,
            },
        });
    }
});

/**
 * POST /api/internal/cart/:sessionKey/items
 * Add an item or deal to cart with strict backend validation
 */
router.post('/:sessionKey/items', async (req, res) => {
    try {
        const { sessionKey } = req.params;
        const restaurantId = await getDefaultRestaurantId();
        const verifiedPhone = req.body?.verifiedPhone || req.query?.verifiedPhone || (!sessionKey.includes('@lid') ? sessionKey.split('@')[0].replace(/\D/g, '') : undefined);
        const chatId = req.body?.chatId || req.query?.chatId || sessionKey;

        if (Array.isArray(req.body?.items) && req.body.items.length > 0) {
            let lastCart = null;
            for (const item of req.body.items) {
                lastCart = await addItemToCart({
                    sessionKey,
                    restaurantId,
                    menuItemId: item.menuItemId,
                    variantId: item.variantId,
                    dealId: item.dealId,
                    quantity: item.quantity ? parseInt(item.quantity, 10) : 1,
                    notes: item.notes,
                    chatId,
                    verifiedPhone,
                });
            }
            return res.status(201).json({
                success: true,
                message: `${req.body.items.length} items added to cart`,
                data: formatSlimCart(lastCart),
            });
        }

        const { menuItemId, variantId, dealId, quantity, notes } = req.body || {};

        const cart = await addItemToCart({
            sessionKey,
            restaurantId,
            menuItemId,
            variantId,
            dealId,
            quantity: quantity ? parseInt(quantity, 10) : 1,
            notes,
            chatId,
            verifiedPhone,
        });

        const addedItem = cart.items?.find(i => 
            (variantId && i.menu_variant_id === variantId) ||
            (menuItemId && i.menu_item_id === menuItemId) ||
            (dealId && i.deal_id === dealId)
        ) || cart.items?.[cart.items.length - 1];

        const itemName = addedItem?.menu_item?.name || addedItem?.deal?.name || 'Item';
        const variantName = addedItem?.menu_variant?.name;
        const totalItems = (cart.items || []).reduce((acc, i) => acc + i.quantity, 0);
        let subtotal = 0;
        for (const it of cart.items || []) {
            const price = Number(it.menu_variant?.price || it.menu_item?.base_price || it.deal?.deal_price || it.deal?.price || 0);
            subtotal += price * it.quantity;
        }

        return res.status(201).json({
            success: true,
            message: `Added ${quantity || 1}x ${itemName}${variantName ? ' (' + variantName + ')' : ''}`,
            data: {
                totalItems,
                subtotal,
            },
        });
    } catch (err) {
        return res.status(err.code ? 400 : 500).json({
            success: false,
            error: {
                code: err.code || 'CART_ADD_ERROR',
                message: err.message,
            },
        });
    }
});

/**
 * PATCH /api/internal/cart/:sessionKey/items/:cartItemId
 * Update quantity or notes of a cart item
 */
router.patch('/:sessionKey/items/:cartItemId', async (req, res) => {
    try {
        const { sessionKey, cartItemId } = req.params;
        const { quantity, notes } = req.body || {};

        const cart = await updateCartItem({
            sessionKey,
            cartItemId,
            quantity: quantity !== undefined ? parseInt(quantity, 10) : undefined,
            notes,
        });

        const totalItems = (cart.items || []).reduce((acc, i) => acc + i.quantity, 0);
        let subtotal = 0;
        for (const it of cart.items || []) {
            const price = Number(it.menu_variant?.price || it.menu_item?.base_price || it.deal?.deal_price || it.deal?.price || 0);
            subtotal += price * it.quantity;
        }

        return res.json({
            success: true,
            message: 'Cart item updated',
            data: { totalItems, subtotal },
        });
    } catch (err) {
        return res.status(err.code ? 400 : 500).json({
            success: false,
            error: {
                code: err.code || 'CART_UPDATE_ERROR',
                message: err.message,
            },
        });
    }
});

/**
 * DELETE /api/internal/cart/:sessionKey/items/:cartItemId
 * Remove an item from cart
 */
router.delete('/:sessionKey/items/:cartItemId', async (req, res) => {
    try {
        const { sessionKey, cartItemId } = req.params;
        const cart = await removeCartItem({ sessionKey, cartItemId });

        const totalItems = (cart.items || []).reduce((acc, i) => acc + i.quantity, 0);
        let subtotal = 0;
        for (const it of cart.items || []) {
            const price = Number(it.menu_variant?.price || it.menu_item?.base_price || it.deal?.deal_price || it.deal?.price || 0);
            subtotal += price * it.quantity;
        }

        return res.json({
            success: true,
            message: 'Cart item removed',
            data: { totalItems, subtotal },
        });
    } catch (err) {
        return res.status(err.code ? 400 : 500).json({
            success: false,
            error: {
                code: err.code || 'CART_DELETE_ERROR',
                message: err.message,
            },
        });
    }
});

/**
 * DELETE /api/internal/cart/:sessionKey
 * Clear entire cart
 */
router.delete('/:sessionKey', async (req, res) => {
    try {
        const { sessionKey } = req.params;
        await clearCart({ sessionKey });

        return res.json({
            success: true,
            message: 'Cart cleared successfully',
            data: { items: [], totalItems: 0, subtotal: 0 },
        });
    } catch (err) {
        return res.status(err.code ? 400 : 500).json({
            success: false,
            error: {
                code: err.code || 'CART_CLEAR_ERROR',
                message: err.message,
            },
        });
    }
});

/**
 * POST /api/internal/cart/:sessionKey/calculate
 * Calculate authoritative totals for active cart via pricingService
 */
router.post('/:sessionKey/calculate', async (req, res) => {
    try {
        const { sessionKey } = req.params;
        const restaurantId = await getDefaultRestaurantId();
        const { promoCode, deliveryAreaId, deliveryAreaName, latitude, longitude } = req.body || {};

        const totals = await calculateCartTotals({
            sessionKey,
            restaurantId,
            promoCode,
            deliveryAreaId,
            deliveryAreaName,
            latitude: latitude != null ? Number(latitude) : undefined,
            longitude: longitude != null ? Number(longitude) : undefined,
        });

        return res.json({
            success: true,
            data: formatSlimTotals(totals),
        });
    } catch (err) {
        return res.status(err.code ? 400 : 500).json({
            success: false,
            error: {
                code: err.code || 'CART_CALCULATION_ERROR',
                message: err.message,
            },
        });
    }
});

export default router;
