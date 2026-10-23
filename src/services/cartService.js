import { getDbClient } from '../db/client.js';
import { getDefaultRestaurantId } from './restaurantService.js';
import { getOrCreateSession, touchSession } from './sessionService.js';
import { calculatePricing } from './pricingService.js';

/**
 * Get or create the active cart for a session
 */
export async function getActiveCart({ sessionKey, restaurantId, chatId, verifiedPhone }) {
    const prisma = getDbClient();
    if (!prisma) {
        throw new Error('Database client not available');
    }

    const restId = restaurantId || await getDefaultRestaurantId();
    const session = await getOrCreateSession({
        restaurantId: restId,
        sessionKey,
        chatId: chatId || sessionKey,
        verifiedPhone,
    });

    let cart = await prisma.cart.findFirst({
        where: {
            session_id: session.id,
            restaurant_id: restId,
            status: 'ACTIVE',
        },
        include: {
            items: {
                include: {
                    menu_item: {
                        include: { category: true },
                    },
                    menu_variant: true,
                    deal: {
                        include: {
                            deal_items: {
                                include: {
                                    menu_item: true,
                                    menu_variant: true,
                                },
                            },
                        },
                    },
                },
                orderBy: { created_at: 'asc' },
            },
        },
    });

    if (!cart) {
        cart = await prisma.cart.create({
            data: {
                restaurant_id: restId,
                session_id: session.id,
                status: 'ACTIVE',
            },
            include: {
                items: {
                    include: {
                        menu_item: { include: { category: true } },
                        menu_variant: true,
                        deal: true,
                    },
                },
            },
        });
    }

    return cart;
}

/**
 * Robust variant matcher: matches by database CUID, exact name, or common size aliases.
 */
export function matchVariant(variants, query) {
    if (!variants || !Array.isArray(variants) || variants.length === 0 || !query) return null;
    const raw = String(query).trim();
    const q = raw.toLowerCase();

    // 1. Exact ID match (CUID)
    const byId = variants.find(v => v.id === raw || v.id === q);
    if (byId) return byId;

    // 2. Exact name match (case-insensitive)
    const byName = variants.find(v => v.name.toLowerCase() === q);
    if (byName) return byName;

    // 3. Name slug match (ignore spaces and punctuation)
    const qSlug = q.replace(/[^a-z0-9]/g, '');
    const bySlug = variants.find(v => v.name.toLowerCase().replace(/[^a-z0-9]/g, '') === qSlug);
    if (bySlug) return bySlug;

    // 4. Normalized alias match (with typo tolerance e.g. 'Partybsize', 'medum', 'larg')
    const isParty = /\b(?:party|family|partyb?size)\b/i.test(q) || qSlug.includes('partysize') || qSlug.includes('partybsize') || qSlug.startsWith('party');
    const isLarge = !isParty && (/\b(?:large|larg|lrg|bada|bara)\b/i.test(q) || /^(?:l|large|larg)$/i.test(q.trim()) || qSlug.includes('largesize'));
    const isMedium = /\b(?:medium|medum|med|darmiyan|darmiyana)\b/i.test(q) || /^(?:m|med|medium|medum)$/i.test(q.trim()) || qSlug.includes('mediumsize');
    const isSmall = /\b(?:small|smal|chota|chhota)\b/i.test(q) || /^(?:s|sm|small|smal)$/i.test(q.trim()) || qSlug.includes('smallsize');
    const isRegular = /\b(?:regular|reg)\b/i.test(q);

    if (isParty) {
        const found = variants.find(v => /party/i.test(v.name));
        if (found) return found;
    }
    if (isLarge) {
        const found = variants.find(v => /large/i.test(v.name));
        if (found) return found;
    }
    if (isMedium) {
        const found = variants.find(v => /medium/i.test(v.name));
        if (found) return found;
    }
    if (isSmall) {
        const found = variants.find(v => /small/i.test(v.name));
        if (found) return found;
    }
    if (isRegular) {
        const found = variants.find(v => /regular/i.test(v.name));
        if (found) return found;
    }

    // 5. Word boundary / substring
    const foundSub = variants.find(v => {
        const vn = v.name.toLowerCase();
        return q.includes(vn) || vn.includes(q);
    });
    if (foundSub) return foundSub;

    return null;
}

/**
 * Validate item or deal before adding to cart
 */
export async function validateCartItemInput({ restaurantId, menuItemId, variantId, dealId, quantity }) {
    const prisma = getDbClient();
    if (!prisma) throw new Error('Database client not available');

    const restId = restaurantId || await getDefaultRestaurantId();
    const qty = parseInt(quantity, 10);
    if (isNaN(qty) || qty < 1) {
        const err = new Error('Quantity must be an integer greater than 0');
        err.code = 'INVALID_QUANTITY';
        throw err;
    }

    if (!menuItemId && !dealId) {
        const err = new Error('Either menuItemId or dealId must be provided');
        err.code = 'INVALID_ITEM_INPUT';
        throw err;
    }

    if (menuItemId && dealId) {
        const err = new Error('Cannot specify both menuItemId and dealId on a single cart item');
        err.code = 'INVALID_ITEM_INPUT';
        throw err;
    }

    // Validate Menu Item & Variant
    if (menuItemId) {
        const item = await prisma.menuItem.findFirst({
            where: {
                id: menuItemId,
                restaurant_id: restId,
            },
            include: {
                category: true,
                variants: true,
            },
        });

        if (!item) {
            const err = new Error(`Menu item not found: ${menuItemId}`);
            err.code = 'MENU_ITEM_NOT_FOUND';
            throw err;
        }

        if (!item.is_active || !item.is_available) {
            const err = new Error(`Menu item '${item.name}' is currently unavailable`);
            err.code = 'MENU_ITEM_UNAVAILABLE';
            throw err;
        }

        if (item.category && !item.category.is_active) {
            const err = new Error(`Category '${item.category.name}' is currently inactive`);
            err.code = 'CATEGORY_INACTIVE';
            throw err;
        }

        let matchedVariant = null;
        if (item.variants && item.variants.length > 0) {
            if (variantId) {
                matchedVariant = matchVariant(item.variants, variantId);
                if (!matchedVariant) {
                    const err = new Error(`Variant '${variantId}' not found for item '${item.name}'`);
                    err.code = 'VARIANT_NOT_FOUND';
                    throw err;
                }
                if (!matchedVariant.is_available) {
                    const err = new Error(`Variant '${matchedVariant.name}' for '${item.name}' is unavailable`);
                    err.code = 'VARIANT_UNAVAILABLE';
                    throw err;
                }
            } else if (item.variants.length === 1 && item.variants[0].is_available) {
                // Auto-select single variant if only 1 exists
                matchedVariant = item.variants[0];
            }
        }

        return { type: 'item', item, variant: matchedVariant, quantity: qty };
    }

    // Validate Deal
    if (dealId) {
        const deal = await prisma.deal.findFirst({
            where: {
                id: dealId,
                restaurant_id: restId,
            },
            include: {
                deal_items: {
                    include: {
                        menu_item: true,
                        menu_variant: true,
                    },
                },
            },
        });

        if (!deal) {
            const err = new Error(`Deal not found: ${dealId}`);
            err.code = 'DEAL_NOT_FOUND';
            throw err;
        }

        if (!deal.is_active) {
            const err = new Error(`Deal '${deal.name}' is currently inactive`);
            err.code = 'DEAL_INACTIVE';
            throw err;
        }

        const now = new Date();
        if (deal.start_at && now < new Date(deal.start_at)) {
            const err = new Error(`Deal '${deal.name}' has not started yet`);
            err.code = 'DEAL_NOT_YET_ACTIVE';
            throw err;
        }

        if (deal.end_at && now > new Date(deal.end_at)) {
            const err = new Error(`Deal '${deal.name}' has expired`);
            err.code = 'DEAL_EXPIRED';
            throw err;
        }

        for (const di of deal.deal_items) {
            if (!di.menu_item.is_active || !di.menu_item.is_available) {
                const err = new Error(`Item '${di.menu_item.name}' in deal is unavailable`);
                err.code = 'MENU_ITEM_UNAVAILABLE';
                throw err;
            }
            if (di.menu_variant && !di.menu_variant.is_available) {
                const err = new Error(`Variant in deal is unavailable`);
                err.code = 'VARIANT_UNAVAILABLE';
                throw err;
            }
        }

        return { type: 'deal', deal, quantity: qty };
    }
}

/**
 * Add an item or deal to cart with strict validation
 */
export async function addItemToCart({ sessionKey, restaurantId, menuItemId, variantId, dealId, quantity = 1, notes, chatId, verifiedPhone }) {
    const prisma = getDbClient();
    if (!prisma) throw new Error('Database client not available');

    const restId = restaurantId || await getDefaultRestaurantId();
    const validated = await validateCartItemInput({
        restaurantId: restId,
        menuItemId,
        variantId,
        dealId,
        quantity,
    });

    const finalVariantId = validated?.type === 'item' ? (validated.variant?.id || null) : null;
    const cart = await getActiveCart({ sessionKey, restaurantId: restId, chatId, verifiedPhone });

    // Check if duplicate item already exists in cart -> increment quantity
    let existingItem = null;
    if (menuItemId) {
        existingItem = cart.items.find(i => i.menu_item_id === menuItemId && i.menu_variant_id === finalVariantId);
    } else if (dealId) {
        existingItem = cart.items.find(i => i.deal_id === dealId);
    }

    if (existingItem) {
        const updated = await prisma.cartItem.update({
            where: { id: existingItem.id },
            data: {
                quantity: existingItem.quantity + quantity,
                notes: notes !== undefined ? notes : existingItem.notes,
            },
        });
        await touchSession(sessionKey);
        return getActiveCart({ sessionKey, restaurantId: restId });
    }

    await prisma.cartItem.create({
        data: {
            cart_id: cart.id,
            menu_item_id: menuItemId || null,
            menu_variant_id: finalVariantId,
            deal_id: dealId || null,
            quantity: quantity,
            notes: notes || null,
        },
    });

    await touchSession(sessionKey);
    return getActiveCart({ sessionKey, restaurantId: restId });
}

/**
 * Update cart item quantity or notes
 */
export async function updateCartItem({ sessionKey, cartItemId, quantity, notes }) {
    const prisma = getDbClient();
    if (!prisma) throw new Error('Database client not available');

    const item = await prisma.cartItem.findUnique({
        where: { id: cartItemId },
        include: { cart: { include: { session: true } } },
    });

    if (!item || item.cart.session.session_key !== sessionKey) {
        const err = new Error('Cart item not found');
        err.code = 'CART_ITEM_NOT_FOUND';
        throw err;
    }

    if (quantity !== undefined) {
        const qty = parseInt(quantity, 10);
        if (qty <= 0) {
            await prisma.cartItem.delete({ where: { id: cartItemId } });
            await touchSession(sessionKey);
            return getActiveCart({ sessionKey });
        }
        await prisma.cartItem.update({
            where: { id: cartItemId },
            data: {
                quantity: qty,
                notes: notes !== undefined ? notes : item.notes,
            },
        });
    } else if (notes !== undefined) {
        await prisma.cartItem.update({
            where: { id: cartItemId },
            data: { notes },
        });
    }

    await touchSession(sessionKey);
    return getActiveCart({ sessionKey });
}

/**
 * Remove an item from cart
 */
export async function removeCartItem({ sessionKey, cartItemId }) {
    const prisma = getDbClient();
    if (!prisma) throw new Error('Database client not available');

    const item = await prisma.cartItem.findUnique({
        where: { id: cartItemId },
        include: { cart: { include: { session: true } } },
    });

    if (!item || item.cart.session.session_key !== sessionKey) {
        const err = new Error('Cart item not found');
        err.code = 'CART_ITEM_NOT_FOUND';
        throw err;
    }

    await prisma.cartItem.delete({ where: { id: cartItemId } });
    await touchSession(sessionKey);
    return getActiveCart({ sessionKey });
}

/**
 * Clear all items in active cart
 */
export async function clearCart({ sessionKey }) {
    const cart = await getActiveCart({ sessionKey });
    const prisma = getDbClient();
    if (!prisma) throw new Error('Database client not available');

    await prisma.cartItem.deleteMany({
        where: { cart_id: cart.id },
    });

    await touchSession(sessionKey);
    return getActiveCart({ sessionKey });
}

/**
 * Calculate totals for active cart using central pricingService
 * Never stores permanent unvalidated prices in cart
 */
export async function calculateCartTotals({ sessionKey, restaurantId, promoCode, deliveryAreaId, deliveryAreaName, latitude, longitude }) {
    const cart = await getActiveCart({ sessionKey, restaurantId });
    const restId = restaurantId || cart.restaurant_id;

    if (!cart.items || cart.items.length === 0) {
        return {
            items: [],
            deals: [],
            subtotal: 0,
            discounts: [],
            discountTotal: 0,
            deliveryFee: 0,
            deliverySelected: false,
            total: 0,
        };
    }

    const itemsForPricing = [];
    const dealsForPricing = [];

    for (const item of cart.items) {
        if (item.menu_item_id) {
            itemsForPricing.push({
                menuItemId: item.menu_item_id,
                variantId: item.menu_variant_id || undefined,
                quantity: item.quantity,
            });
        } else if (item.deal_id) {
            dealsForPricing.push({
                dealId: item.deal_id,
                quantity: item.quantity,
            });
        }
    }

    const hasDeliveryInfo = !!(deliveryAreaId || deliveryAreaName || (latitude != null && longitude != null));

    const pricing = await calculatePricing({
        restaurantId: restId,
        items: itemsForPricing,
        deals: dealsForPricing,
        promoCode,
        deliveryAreaId,
        deliveryAreaName,
        latitude,
        longitude,
        deliveryFee: hasDeliveryInfo ? undefined : 0,
    });

    return {
        cartId: cart.id,
        items: pricing.breakdown.items,
        deals: pricing.breakdown.deals,
        subtotal: pricing.subtotal,
        discounts: pricing.discounts,
        discountTotal: pricing.discountTotal,
        discount: pricing.discountTotal,
        deliveryFee: hasDeliveryInfo ? pricing.deliveryFee : 0,
        deliverySelected: hasDeliveryInfo,
        deliveryArea: pricing.deliveryArea,
        total: pricing.total,
    };
}

export { addItemToCart as addToCart };

