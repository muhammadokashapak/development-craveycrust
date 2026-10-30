import { getDbClient } from '../db/client.js';
import { getDefaultRestaurantId } from './restaurantService.js';
import { getOrCreateSession, touchSession } from './sessionService.js';
import { calculatePricing } from './pricingService.js';
import { FALLBACK_MENU_ITEMS, FALLBACK_DEALS } from './fallbackCatalog.js';

const _inMemoryCarts = new Map();
const _cartVersions = new Map();
const _sessionLocks = new Map();

/**
 * Executes a cart operation sequentially per session to prevent race conditions & duplicate additions
 */
export async function withCartLock(sessionKey, fn) {
    const key = String(sessionKey || 'default');
    const prevLock = _sessionLocks.get(key) || Promise.resolve();
    let release;
    const currentLock = new Promise(resolve => { release = resolve; });
    _sessionLocks.set(key, prevLock.then(() => currentLock));
    try {
        await prevLock;
        return await fn();
    } finally {
        release();
        if (_sessionLocks.get(key) === currentLock) {
            _sessionLocks.delete(key);
        }
    }
}

/**
 * Returns current authoritative cart version for optimistic locking
 */
export function getCartVersion(sessionKey) {
    return _cartVersions.get(String(sessionKey)) || 1;
}

/**
 * Increments cart version on every modification
 */
export function incrementCartVersion(sessionKey) {
    const key = String(sessionKey);
    const nextVer = (_cartVersions.get(key) || 1) + 1;
    _cartVersions.set(key, nextVer);
    return nextVer;
}

/**
 * Get or create the active cart for a session
 */
export async function getActiveCart({ sessionKey, restaurantId, chatId, verifiedPhone }) {
    const prisma = getDbClient();
    let restId = restaurantId || await getDefaultRestaurantId().catch(() => 'cravey-crust-main');
    if (prisma && (!restId || restId === 'default-restaurant' || restId === 'cravey-crust-main')) {
        const resolved = await getDefaultRestaurantId().catch(() => null);
        if (resolved && resolved !== 'default-restaurant') {
            restId = resolved;
        }
    }

    if (!prisma) {
        let cart = _inMemoryCarts.get(sessionKey);
        if (cart) {
            const cartAgeMs = Date.now() - new Date(cart.updated_at).getTime();
            if (cartAgeMs > 15 * 60 * 1000) {
                cart.status = 'EXPIRED';
                cart.items = [];
                _inMemoryCarts.delete(sessionKey);
                cart = null;
            }
        }
        if (!cart) {
            cart = {
                id: `cart_${sessionKey}`,
                restaurant_id: restId,
                session_id: `sess_${sessionKey}`,
                status: 'ACTIVE',
                items: [],
                created_at: new Date(),
                updated_at: new Date(),
            };
            _inMemoryCarts.set(sessionKey, cart);
        }
        cart.version = _cartVersions.get(String(sessionKey)) || 1;
        _cartVersions.set(String(sessionKey), cart.version);
        _cartVersions.set(String(cart.id), cart.version);
        return cart;
    }

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

    if (cart) {
        const cartAgeMs = Date.now() - new Date(cart.updated_at).getTime();
        // If an abandoned cart has been idle for more than 15 minutes, expire it so old items don't leak into new orders
        if (cartAgeMs > 15 * 60 * 1000) {
            await prisma.cart.update({
                where: { id: cart.id },
                data: { status: 'EXPIRED' },
            }).catch(() => null);
            cart = null;
        }
    }

    if (!cart) {
        if (!restId || restId === 'default-restaurant' || restId === 'cravey-crust-main') {
            const resolved = await getDefaultRestaurantId().catch(() => null);
            if (resolved && resolved !== 'default-restaurant') {
                restId = resolved;
            }
        }
        if (!restId || restId === 'default-restaurant' || restId === 'cravey-crust-main') {
            let fallbackCart = _inMemoryCarts.get(sessionKey);
            if (!fallbackCart) {
                fallbackCart = {
                    id: `cart_${sessionKey}`,
                    restaurant_id: restId || 'cravey-crust-main',
                    session_id: session?.id || `sess_${sessionKey}`,
                    status: 'ACTIVE',
                    items: [],
                    created_at: new Date(),
                    updated_at: new Date(),
                };
                _inMemoryCarts.set(sessionKey, fallbackCart);
            }
            return fallbackCart;
        }

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
    const is1_5Liter = /\b(?:1\.5\s*(?:l|liter|litre|ltr)?|derh\s*liter)\b/i.test(q) || qSlug.includes('15liter') || qSlug.includes('15l');
    const is1Liter = !is1_5Liter && (/\b(?:1\s*(?:l|liter|litre|ltr)|aik\s*liter|ek\s*liter|liter|litre|1l)\b/i.test(q) || qSlug.includes('1liter') || qSlug.includes('1l') || qSlug === 'liter');
    const isCan = /\b(?:can|tin\s*pack)\b/i.test(q) || qSlug === 'can';
    const isParty = /\b(?:party|family|partyb?size)\b/i.test(q) || qSlug.includes('partysize') || qSlug.includes('partybsize') || qSlug.startsWith('party');
    const isLarge = !isParty && (/\b(?:large|larg|lrg|bada|bara)\b/i.test(q) || /^(?:l|large|larg)$/i.test(q.trim()) || qSlug.includes('largesize'));
    const isMedium = /\b(?:medium|medum|med|darmiyan|darmiyana)\b/i.test(q) || /^(?:m|med|medium|medum)$/i.test(q.trim()) || qSlug.includes('mediumsize');
    const isSmall = /\b(?:small|smal|chota|chhota)\b/i.test(q) || /^(?:s|sm|small|smal)$/i.test(q.trim()) || qSlug.includes('smallsize');
    const isRegular = /\b(?:regular|reg)\b/i.test(q);

    if (is1_5Liter) {
        const found = variants.find(v => /1\.5/i.test(v.name));
        if (found) return found;
    }
    if (is1Liter) {
        const found = variants.find(v => /\b1\s*liter\b|\b1l\b/i.test(v.name) && !/1\.5/i.test(v.name));
        if (found) return found;
    }
    if (isCan) {
        const found = variants.find(v => /can/i.test(v.name));
        if (found) return found;
    }

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
    const restId = restaurantId || await getDefaultRestaurantId().catch(() => 'cravey-crust-main');
    const num = Number(quantity);
    if (isNaN(num) || !Number.isInteger(num) || num < 1 || num > 50) {
        const err = new Error('Quantity must be an integer between 1 and 50');
        err.code = 'INVALID_QUANTITY';
        throw err;
    }
    const qty = num;

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

    if (!prisma) {
        if (menuItemId) {
            const lowerId = String(menuItemId).toLowerCase();
            const item = FALLBACK_MENU_ITEMS.find(it => it.id.toLowerCase() === lowerId || it.slug.toLowerCase() === lowerId || it.name.toLowerCase() === lowerId);
            if (!item) {
                const err = new Error(`Menu item not found: ${menuItemId}`);
                err.code = 'MENU_ITEM_NOT_FOUND';
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
                } else if (item.variants.length === 1) {
                    matchedVariant = item.variants[0];
                }
            }
            return { type: 'item', item, variant: matchedVariant, quantity: qty };
        }
        if (dealId) {
            const lowerDealId = String(dealId).toLowerCase();
            const deal = FALLBACK_DEALS.find(d => d.id.toLowerCase() === lowerDealId || d.slug.toLowerCase() === lowerDealId || d.name.toLowerCase() === lowerDealId);
            if (!deal) {
                const err = new Error(`Deal not found: ${dealId}`);
                err.code = 'DEAL_NOT_FOUND';
                throw err;
            }
            return { type: 'deal', deal, quantity: qty };
        }
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
        let deal = null;
        if (prisma) {
            try {
                // 1. Try finding by ID
                deal = await prisma.deal.findFirst({
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

                // 2. If not found by ID, try finding by slug or name in DB
                if (!deal) {
                    deal = await prisma.deal.findFirst({
                        where: {
                            OR: [
                                { slug: dealId },
                                { slug: String(dealId).toLowerCase() },
                                { name: { equals: String(dealId), mode: 'insensitive' } },
                            ],
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
                }
            } catch (_) {}
        }

        // 3. Fallback to FALLBACK_DEALS if not in DB, DB offline, or fallback ID passed
        if (!deal) {
            const lowerDealId = String(dealId).toLowerCase();
            const lowerNorm = lowerDealId.replace(/\bfor\b/gi, '').replace(/#|\s+/g, '');
            deal = FALLBACK_DEALS.find(d => 
                d.id.toLowerCase() === lowerDealId || 
                d.slug.toLowerCase() === lowerDealId || 
                d.name.toLowerCase() === lowerDealId ||
                d.name.toLowerCase().replace(/\bfor\b/gi, '').replace(/#|\s+/g, '') === lowerNorm
            );
        }

        if (!deal) {
            const err = new Error(`Deal not found: ${dealId}`);
            err.code = 'DEAL_NOT_FOUND';
            throw err;
        }

        if (deal.is_active === false) {
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

        return { type: 'deal', deal, quantity: qty };
    }
}

/**
 * Add an item or deal to cart with strict validation
 */
export async function addItemToCart({ sessionKey, restaurantId, menuItemId, variantId, dealId, quantity = 1, notes, chatId, verifiedPhone }) {
    const prisma = getDbClient();
    const restId = restaurantId || await getDefaultRestaurantId().catch(() => 'cravey-crust-main');
    const validated = await validateCartItemInput({
        restaurantId: restId,
        menuItemId,
        variantId,
        dealId,
        quantity,
    });

    const finalVariantId = validated?.type === 'item' ? (validated.variant?.id || null) : null;
    const cart = await getActiveCart({ sessionKey, restaurantId: restId, chatId, verifiedPhone });

    if (!prisma) {
        let existingItem = null;
        if (menuItemId) {
            existingItem = cart.items.find(i => i.menu_item_id === menuItemId && i.menu_variant_id === finalVariantId);
        } else if (dealId) {
            existingItem = cart.items.find(i => i.deal_id === dealId && (notes === undefined || i.notes === (notes || null)));
        }

        if (existingItem) {
            existingItem.quantity += validated.quantity;
            if (notes !== undefined) existingItem.notes = notes;
            cart.updated_at = new Date();
            cart.version = incrementCartVersion(sessionKey);
            await touchSession(sessionKey);
            return cart;
        }

        const newItem = {
            id: `ci_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            cart_id: cart.id,
            menu_item_id: validated.type === "item" ? (validated.item?.id || menuItemId) : null,
            menu_variant_id: finalVariantId,
            deal_id: dealId || null,
            quantity: validated.quantity,
            notes: notes || null,
            menu_item: validated.type === 'item' ? validated.item : null,
            menu_variant: validated.type === 'item' ? validated.variant : null,
            deal: validated.type === 'deal' ? validated.deal : null,
            created_at: new Date(),
        };
        cart.items.push(newItem);
        cart.updated_at = new Date();
        cart.version = incrementCartVersion(sessionKey);
        await touchSession(sessionKey);
        return cart;
    }

    let resolvedDealId = validated?.type === 'deal' ? (validated.deal?.id || dealId) : null;
    let fallbackDealNotes = null;

    if (resolvedDealId && prisma) {
        const dbDeal = await prisma.deal.findFirst({
            where: {
                OR: [
                    { id: resolvedDealId },
                    { slug: resolvedDealId },
                    { slug: validated.deal?.slug },
                    { name: { equals: validated.deal?.name, mode: 'insensitive' } },
                ],
                restaurant_id: restId,
            },
            select: { id: true },
        }).catch(() => null);

        if (dbDeal) {
            resolvedDealId = dbDeal.id;
        } else {
            try {
                const newDbDeal = await prisma.deal.create({
                    data: {
                        restaurant_id: restId,
                        name: validated.deal?.name || 'Special Deal',
                        slug: validated.deal?.slug || `deal-${Date.now()}`,
                        deal_price: validated.deal?.deal_price || 0,
                        is_active: true,
                    },
                });
                resolvedDealId = newDbDeal.id;
            } catch (_) {
                resolvedDealId = null;
                fallbackDealNotes = `Deal: ${validated.deal?.name || 'Deal'}`;
            }
        }
    }

    // Check if duplicate item already exists in cart -> increment quantity
    let existingItem = null;
    if (menuItemId) {
        existingItem = cart.items.find(i => i.menu_item_id === menuItemId && i.menu_variant_id === finalVariantId);
    } else if (resolvedDealId || dealId) {
        existingItem = cart.items.find(i => (i.deal_id === resolvedDealId || i.deal_id === dealId) && (notes === undefined || i.notes === (notes || null)));
    }

    if (existingItem) {
        if (!existingItem.id || existingItem.id.startsWith('ci_')) {
            existingItem.quantity += validated.quantity;
            if (notes !== undefined) existingItem.notes = notes;
            cart.updated_at = new Date();
            await touchSession(sessionKey);
            return cart;
        }
        await prisma.cartItem.update({
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
            deal_id: resolvedDealId || null,
            quantity: quantity,
            notes: notes || fallbackDealNotes || null,
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
    if (!prisma) {
        const cart = await getActiveCart({ sessionKey });
        const itemIdx = cart.items.findIndex(i => i.id === cartItemId);
        if (itemIdx === -1) {
            const err = new Error('Cart item not found');
            err.code = 'CART_ITEM_NOT_FOUND';
            throw err;
        }
        if (quantity !== undefined) {
            const num = Number(quantity);
            if (isNaN(num) || !Number.isInteger(num) || num < 0 || num > 50) {
                const err = new Error('Quantity must be an integer between 0 and 50');
                err.code = 'INVALID_QUANTITY';
                throw err;
            }
            const qty = num;
            if (qty <= 0) {
                cart.items.splice(itemIdx, 1);
            } else {
                cart.items[itemIdx].quantity = qty;
                if (notes !== undefined) cart.items[itemIdx].notes = notes;
            }
        } else if (notes !== undefined) {
            cart.items[itemIdx].notes = notes;
        }
        cart.updated_at = new Date();
        await touchSession(sessionKey);
        return cart;
    }

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
        const num = Number(quantity);
        if (isNaN(num) || !Number.isInteger(num) || num < 0 || num > 50) {
            const err = new Error('Quantity must be an integer between 0 and 50');
            err.code = 'INVALID_QUANTITY';
            throw err;
        }
        const qty = num;
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
    if (!prisma) {
        const cart = await getActiveCart({ sessionKey });
        const exists = cart.items.some(i => i.id === cartItemId);
        if (!exists) {
            const err = new Error('Cart item not found');
            err.code = 'CART_ITEM_NOT_FOUND';
            throw err;
        }
        cart.items = cart.items.filter(i => i.id !== cartItemId);
        cart.updated_at = new Date();
        await touchSession(sessionKey);
        return cart;
    }

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
    if (!prisma) {
        cart.items = [];
        cart.updated_at = new Date();
        await touchSession(sessionKey);
        return cart;
    }

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
        items: (pricing.breakdown.items || []).map(it => {
            const raw = cart.items.find(ci => ci.menu_item_id === it.itemId && ci.menu_variant_id === (it.variantId || null));
            return { ...it, notes: raw?.notes || null };
        }),
        deals: (pricing.breakdown.deals || []).map(d => {
            const raw = cart.items.find(ci => ci.deal_id === d.dealId);
            return { ...d, notes: raw?.notes || null };
        }),
        subtotal: pricing.subtotal,
        discounts: pricing.discounts,
        discountTotal: pricing.discountTotal,
        discount: pricing.discountTotal,
        deliveryFee: hasDeliveryInfo ? pricing.deliveryFee : 0,
        deliverySelected: hasDeliveryInfo,
        deliveryArea: pricing.deliveryArea,
        total: pricing.total,
        cartVersion: cart.version || getCartVersion(sessionKey) || 1,
    };
}

export { addItemToCart as addToCart };


/**
 * Atomically executes batch add to cart for multiple items sequentially under session lock.
 */
export async function batchAddToCart({ sessionKey, restaurantId, chatId, verifiedPhone, items = [] }) {
    return withCartLock(sessionKey, async () => {
        const restId = restaurantId || await getDefaultRestaurantId().catch(() => 'cravey-crust-main');
        const added = [];
        const failed = [];
        for (const it of items) {
            try {
                await addItemToCart({
                    sessionKey,
                    restaurantId: restId,
                    chatId,
                    verifiedPhone,
                    menuItemId: it.menuItemId,
                    variantId: it.variantId,
                    dealId: it.dealId,
                    quantity: it.quantity || 1,
                    notes: it.notes || null,
                });
                added.push(it);
            } catch (err) {
                failed.push({ item: it, error: err.message });
            }
        }
        const cart = await getActiveCart({ sessionKey, restaurantId: restId, chatId });
        const totals = await calculateCartTotals({ sessionKey, restaurantId: restId, chatId });
        return {
            success: added.length > 0 && failed.length === 0,
            added,
            failed,
            cart,
            totals,
            cartVersion: cart.version || getCartVersion(sessionKey),
        };
    });
}
