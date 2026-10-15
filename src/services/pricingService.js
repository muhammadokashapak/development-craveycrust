import { Prisma } from '@prisma/client';
import { getDbClient } from '../db/client.js';
import { getDefaultRestaurantId } from './restaurantService.js';
import { checkDeliveryAvailability } from './deliveryService.js';

const Decimal = Prisma.Decimal;

/**
 * Helper to convert any numeric/decimal value to a Prisma.Decimal safely
 */
export function toDecimal(val) {
    if (val === null || val === undefined) return new Decimal(0);
    if (val instanceof Decimal) return val;
    return new Decimal(val);
}

/**
 * Helper to round money amounts safely to 2 decimal places for serialization/display
 */
export function roundMoney(amount) {
    if (amount === null || amount === undefined) return 0;
    if (amount instanceof Decimal) {
        return Number(amount.toFixed(2));
    }
    const d = new Decimal(amount || 0);
    return Number(d.toFixed(2));
}

/**
 * Central Pricing Service
 * Sole authority for pricing, deals, discounts, delivery fees, and order totals.
 *
 * @param {Object} params
 * @param {string} [params.restaurantId]
 * @param {Array<{menuItemId: string, variantId?: string, quantity: number}>} [params.items]
 * @param {Array<{dealId: string, quantity: number}>} [params.deals]
 * @param {string} [params.promoCode]
 * @param {string} [params.deliveryAreaId]
 * @param {string} [params.deliveryAreaName]
 * @param {number} [params.latitude]
 * @param {number} [params.longitude]
 * @param {number} [params.deliveryFee]
 * @returns {Promise<Object>}
 */
export async function calculatePricing(params) {
    const prisma = getDbClient();
    if (!prisma) {
        throw new Error('Database client not available');
    }

    const restaurantId = params.restaurantId || await getDefaultRestaurantId();
    const itemsInput = params.items || [];
    const dealsInput = params.deals || [];
    const promoCode = params.promoCode?.trim();

    let subtotal = new Decimal(0);
    const resolvedItems = [];
    const resolvedDeals = [];

    // 1. Resolve & calculate Menu Items
    for (const itemReq of itemsInput) {
        const item = await prisma.menuItem.findFirst({
            where: {
                id: itemReq.menuItemId,
                restaurant_id: restaurantId,
            },
            include: {
                category: { select: { id: true, name: true, is_active: true } },
                variants: true,
            },
        });

        if (!item) {
            const err = new Error(`Menu item not found: ${itemReq.menuItemId}`);
            err.code = 'MENU_ITEM_NOT_FOUND';
            throw err;
        }

        if (!item.is_active || !item.is_available || (item.category && !item.category.is_active)) {
            const err = new Error(`Menu item '${item.name}' is currently unavailable`);
            err.code = 'MENU_ITEM_UNAVAILABLE';
            throw err;
        }

        let unitPrice = new Decimal(item.base_price);
        let selectedVariant = null;

        if (itemReq.variantId) {
            selectedVariant = item.variants.find(v => v.id === itemReq.variantId);
            if (!selectedVariant) {
                const err = new Error(`Variant not found for item '${item.name}'`);
                err.code = 'VARIANT_NOT_FOUND';
                throw err;
            }
            if (!selectedVariant.is_available) {
                const err = new Error(`Variant '${selectedVariant.name}' for '${item.name}' is unavailable`);
                err.code = 'VARIANT_UNAVAILABLE';
                throw err;
            }
            unitPrice = new Decimal(selectedVariant.price);
        }

        const quantity = Math.max(1, parseInt(itemReq.quantity, 10) || 1);
        const lineTotal = unitPrice.times(quantity);
        subtotal = subtotal.plus(lineTotal);

        resolvedItems.push({
            itemId: item.id,
            name: item.name,
            categoryId: item.category_id,
            categoryName: item.category?.name || '',
            variantId: selectedVariant?.id || null,
            variantName: selectedVariant?.name || null,
            unitPrice: roundMoney(unitPrice),
            unitPriceDecimal: unitPrice,
            quantity,
            lineTotal: roundMoney(lineTotal),
            lineTotalDecimal: lineTotal,
        });
    }

    // 2. Resolve & calculate Deals
    for (const dealReq of dealsInput) {
        const deal = await prisma.deal.findFirst({
            where: {
                id: dealReq.dealId,
                restaurant_id: restaurantId,
            },
            include: {
                deal_items: {
                    include: {
                        menu_item: { select: { id: true, name: true, is_active: true, is_available: true } },
                        menu_variant: { select: { id: true, name: true, is_available: true } },
                    },
                },
            },
        });

        if (!deal) {
            const err = new Error(`Deal not found: ${dealReq.dealId}`);
            err.code = 'DEAL_NOT_FOUND';
            throw err;
        }

        if (!deal.is_active) {
            const err = new Error(`Deal '${deal.name}' is inactive`);
            err.code = 'DEAL_INACTIVE';
            throw err;
        }

        const now = new Date();
        if (deal.start_at && now < new Date(deal.start_at)) {
            const err = new Error(`Deal '${deal.name}' is not yet active`);
            err.code = 'DEAL_NOT_YET_ACTIVE';
            throw err;
        }

        if (deal.end_at && now > new Date(deal.end_at)) {
            const err = new Error(`Deal '${deal.name}' has expired`);
            err.code = 'DEAL_EXPIRED';
            throw err;
        }

        // Verify included items in deal are available
        for (const di of deal.deal_items) {
            if (!di.menu_item.is_active || !di.menu_item.is_available) {
                const err = new Error(`Item '${di.menu_item.name}' in deal '${deal.name}' is unavailable`);
                err.code = 'MENU_ITEM_UNAVAILABLE';
                throw err;
            }
            if (di.menu_variant && !di.menu_variant.is_available) {
                const err = new Error(`Variant in deal '${deal.name}' is unavailable`);
                err.code = 'VARIANT_UNAVAILABLE';
                throw err;
            }
        }

        const quantity = Math.max(1, parseInt(dealReq.quantity, 10) || 1);
        const unitPrice = new Decimal(deal.deal_price);
        const lineTotal = unitPrice.times(quantity);
        subtotal = subtotal.plus(lineTotal);

        resolvedDeals.push({
            dealId: deal.id,
            name: deal.name,
            unitPrice: roundMoney(unitPrice),
            unitPriceDecimal: unitPrice,
            quantity,
            lineTotal: roundMoney(lineTotal),
            lineTotalDecimal: lineTotal,
        });
    }

    // 3. Resolve Promotions & Discounts
    const appliedDiscounts = [];
    const appliedPromotionIds = [];
    let discountTotal = new Decimal(0);

    if (promoCode) {
        const promotions = await prisma.promotion.findMany({
            where: {
                restaurant_id: restaurantId,
            },
            include: {
                targets: true,
            },
        });

        // Case-insensitive match on promo code
        const promo = promotions.find(p => p.code && p.code.trim().toUpperCase() === promoCode.toUpperCase());

        if (!promo) {
            const err = new Error(`Invalid promo code: '${promoCode}'`);
            err.code = 'INVALID_PROMO_CODE';
            throw err;
        }

        if (!promo.is_active) {
            const err = new Error(`Promotion '${promo.name}' is currently inactive`);
            err.code = 'PROMOTION_INACTIVE';
            throw err;
        }

        const now = new Date();
        if (promo.start_at && now < new Date(promo.start_at)) {
            const err = new Error(`Promotion '${promo.name}' has not started yet`);
            err.code = 'PROMOTION_NOT_YET_ACTIVE';
            throw err;
        }

        if (promo.end_at && now > new Date(promo.end_at)) {
            const err = new Error(`Promotion '${promo.name}' has expired`);
            err.code = 'PROMOTION_EXPIRED';
            throw err;
        }

        const minOrder = promo.minimum_order != null ? new Decimal(promo.minimum_order) : new Decimal(0);
        if (subtotal.lessThan(minOrder)) {
            const err = new Error(`Minimum order of Rs. ${roundMoney(minOrder)} required for promo '${promo.name}'`);
            err.code = 'PROMOTION_MINIMUM_NOT_MET';
            throw err;
        }

        // Determine eligible base amount based on promotion targets
        let eligibleAmount = new Decimal(0);
        const targets = promo.targets || [];

        if (targets.length === 0 || targets.some(t => t.target_type === 'ALL')) {
            eligibleAmount = subtotal;
        } else {
            for (const target of targets) {
                if (target.target_type === 'CATEGORY') {
                    for (const item of resolvedItems) {
                        if (item.categoryId === target.target_id) {
                            eligibleAmount = eligibleAmount.plus(item.lineTotalDecimal);
                        }
                    }
                } else if (target.target_type === 'MENU_ITEM') {
                    for (const item of resolvedItems) {
                        if (item.itemId === target.target_id) {
                            eligibleAmount = eligibleAmount.plus(item.lineTotalDecimal);
                        }
                    }
                } else if (target.target_type === 'VARIANT') {
                    for (const item of resolvedItems) {
                        if (item.variantId === target.target_id) {
                            eligibleAmount = eligibleAmount.plus(item.lineTotalDecimal);
                        }
                    }
                } else if (target.target_type === 'DEAL') {
                    for (const deal of resolvedDeals) {
                        if (deal.dealId === target.target_id) {
                            eligibleAmount = eligibleAmount.plus(deal.lineTotalDecimal);
                        }
                    }
                }
            }
        }

        let calcDiscount = new Decimal(0);
        if (eligibleAmount.greaterThan(0)) {
            if (promo.discount_type === 'PERCENTAGE') {
                calcDiscount = eligibleAmount.times(new Decimal(promo.discount_value)).dividedBy(100);
                if (promo.maximum_discount != null) {
                    calcDiscount = Decimal.min(calcDiscount, new Decimal(promo.maximum_discount));
                }
            } else if (promo.discount_type === 'FIXED') {
                calcDiscount = Decimal.min(eligibleAmount, new Decimal(promo.discount_value));
            }
        }

        calcDiscount = Decimal.min(subtotal, calcDiscount);

        if (calcDiscount.greaterThan(0)) {
            appliedDiscounts.push({
                id: promo.id,
                name: promo.name,
                code: promo.code,
                type: promo.discount_type,
                amount: roundMoney(calcDiscount),
                amountDecimal: calcDiscount,
            });
            appliedPromotionIds.push(promo.id);
            discountTotal = discountTotal.plus(calcDiscount);
        }
    }

    // Ensure discount never exceeds subtotal
    discountTotal = Decimal.min(subtotal, discountTotal);

    // 4. Calculate Delivery Fee
    let deliveryFee = new Decimal(0);
    let resolvedDeliveryArea = null;

    if (params.deliveryFee !== undefined && params.deliveryFee !== null) {
        deliveryFee = new Decimal(params.deliveryFee);
    } else if (params.deliveryAreaId || params.deliveryAreaName || (params.latitude != null && params.longitude != null)) {
        const deliveryCheck = await checkDeliveryAvailability({
            restaurantId,
            areaId: params.deliveryAreaId,
            areaName: params.deliveryAreaName,
            latitude: params.latitude,
            longitude: params.longitude,
            subtotal: roundMoney(subtotal),
        });

        if (!deliveryCheck.available) {
            const err = new Error(deliveryCheck.message || 'Delivery not available in this area');
            err.code = deliveryCheck.code || 'DELIVERY_NOT_AVAILABLE';
            throw err;
        }

        if (deliveryCheck.minimumMet === false) {
            const err = new Error(deliveryCheck.message);
            err.code = deliveryCheck.code || 'DELIVERY_MINIMUM_NOT_MET';
            throw err;
        }

        deliveryFee = new Decimal(deliveryCheck.deliveryFee);
        resolvedDeliveryArea = deliveryCheck.area;
    }

    // 5. Final Grand Total
    const finalTotal = Decimal.max(0, subtotal.minus(discountTotal)).plus(deliveryFee);

    return {
        subtotal: roundMoney(subtotal),
        subtotalDecimal: subtotal,
        discounts: appliedDiscounts,
        discountTotal: roundMoney(discountTotal),
        discountTotalDecimal: discountTotal,
        deliveryFee: roundMoney(deliveryFee),
        deliveryFeeDecimal: deliveryFee,
        total: roundMoney(finalTotal),
        totalDecimal: finalTotal,
        appliedPromotionIds,
        deliveryArea: resolvedDeliveryArea,
        breakdown: {
            items: resolvedItems,
            deals: resolvedDeals,
        },
    };
}
