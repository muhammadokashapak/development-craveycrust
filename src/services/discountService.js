import { getDbClient } from '../db/client.js';
import { getDefaultRestaurantId } from './restaurantService.js';

/**
 * Fetch global menu discount settings for a restaurant.
 * Stored in restaurant_settings table so both ADMIN and SUPER_ADMIN have full control.
 *
 * @param {string} [restaurantId]
 * @returns {Promise<{enabled: boolean, type: string, value: number, title: string}>}
 */
export async function getGlobalDiscountSettings(restaurantId = null) {
    const prisma = getDbClient();
    if (!prisma) return { enabled: false, type: 'PERCENTAGE', value: 0, title: 'Special Discount' };

    let rid = restaurantId;
    if (!rid) {
        rid = await getDefaultRestaurantId().catch(() => null);
    }
    if (!rid) return { enabled: false, type: 'PERCENTAGE', value: 0, title: 'Special Discount' };

    try {
        const settings = await prisma.restaurantSetting.findMany({
            where: {
                restaurant_id: rid,
                key: {
                    in: [
                        'global_discount_enabled',
                        'global_discount_type',
                        'global_discount_value',
                        'global_discount_title',
                    ],
                },
            },
        });

        const map = {};
        settings.forEach(s => { map[s.key] = s.value; });

        const enabled = map.global_discount_enabled === 'true' || map.global_discount_enabled === '1';
        const type = (map.global_discount_type === 'FIXED') ? 'FIXED' : 'PERCENTAGE';
        const value = parseFloat(map.global_discount_value || '0') || 0;
        const title = map.global_discount_title || 'Special Discount';

        return {
            enabled: enabled && value > 0,
            type,
            value,
            title,
        };
    } catch (err) {
        return { enabled: false, type: 'PERCENTAGE', value: 0, title: 'Special Discount' };
    }
}

/**
 * Calculate the effective price and discount details for a menu item or variant.
 * Priority: Item-specific discount (if set) > Global store discount (if enabled).
 *
 * @param {number|string} basePrice - Original item or variant price
 * @param {number|null} [itemDiscountPercent=null] - Item-specific percent discount
 * @param {number|null} [itemDiscountFixed=null] - Item-specific fixed discount
 * @param {Object|null} [globalSettings=null] - Global discount settings
 * @returns {Object} Detailed discount object with formatted strikethrough
 */
export function calculateDiscount(basePrice, itemDiscountPercent = null, itemDiscountFixed = null, globalSettings = null) {
    const originalPrice = Math.max(0, Number(basePrice) || 0);
    if (originalPrice === 0) {
        return {
            hasDiscount: false,
            originalPrice: 0,
            discountedPrice: 0,
            discountAmount: 0,
            discountPercent: 0,
            label: '',
            badgeText: '',
            formattedStrikethrough: 'Rs. 0',
            formattedFull: 'Rs. 0',
            source: 'NONE',
        };
    }

    let hasDiscount = false;
    let discountAmount = 0;
    let discountPercent = 0;
    let source = 'NONE';
    let label = '';

    // 1. Priority: Item-specific discount
    const itemPct = itemDiscountPercent !== null && itemDiscountPercent !== undefined && !isNaN(Number(itemDiscountPercent))
        ? Number(itemDiscountPercent)
        : null;
    const itemFixed = itemDiscountFixed !== null && itemDiscountFixed !== undefined && !isNaN(Number(itemDiscountFixed))
        ? Number(itemDiscountFixed)
        : null;

    if (itemPct !== null && itemPct > 0) {
        hasDiscount = true;
        discountPercent = Math.min(100, itemPct);
        discountAmount = Math.round((originalPrice * discountPercent) / 100);
        source = 'ITEM';
        label = `${discountPercent}% OFF`;
    } else if (itemFixed !== null && itemFixed > 0) {
        hasDiscount = true;
        discountAmount = Math.min(originalPrice, itemFixed);
        discountPercent = Math.round((discountAmount / originalPrice) * 100);
        source = 'ITEM';
        label = `Rs. ${discountAmount} OFF`;
    } else if (globalSettings && globalSettings.enabled && globalSettings.value > 0) {
        // 2. Global store discount
        hasDiscount = true;
        source = 'GLOBAL';
        if (globalSettings.type === 'FIXED') {
            discountAmount = Math.min(originalPrice, globalSettings.value);
            discountPercent = Math.round((discountAmount / originalPrice) * 100);
            label = `Rs. ${discountAmount} OFF`;
        } else {
            discountPercent = Math.min(100, globalSettings.value);
            discountAmount = Math.round((originalPrice * discountPercent) / 100);
            label = `${discountPercent}% OFF`;
        }
    }

    const discountedPrice = Math.max(0, originalPrice - discountAmount);

    let formattedStrikethrough = `Rs. ${originalPrice}`;
    let formattedFull = `Rs. ${originalPrice}`;

    if (hasDiscount && discountAmount > 0) {
        formattedStrikethrough = `~Rs. ${originalPrice}~ Rs. ${discountedPrice}`;
        formattedFull = `~Rs. ${originalPrice}~ Rs. ${discountedPrice} (${label})`;
    }

    return {
        hasDiscount: hasDiscount && discountAmount > 0,
        originalPrice,
        discountedPrice,
        discountAmount,
        discountPercent,
        label,
        badgeText: label,
        formattedStrikethrough,
        formattedFull,
        source,
    };
}

/**
 * Bulk apply a discount to all menu items in a restaurant.
 * If discountPercent and discountFixed are null, removes all individual discounts.
 *
 * @param {string} restaurantId
 * @param {Object} options
 * @param {number|null} [options.discountPercent]
 * @param {number|null} [options.discountFixed]
 * @param {string|null} [options.categoryId]
 * @returns {Promise<number>} Number of updated items
 */
export async function bulkApplyDiscountToAllItems(restaurantId, { discountPercent = null, discountFixed = null, categoryId = null } = {}) {
    const prisma = getDbClient();
    if (!prisma) throw new Error('Database client not available');

    let rid = restaurantId;
    if (!rid) {
        rid = await getDefaultRestaurantId();
    }

    const where = {
        restaurant_id: rid,
        ...(categoryId ? { category_id: categoryId } : {}),
    };

    const updateData = {
        discount_percent: discountPercent !== null && discountPercent !== undefined ? discountPercent : null,
        discount_fixed: discountFixed !== null && discountFixed !== undefined ? discountFixed : null,
    };

    const result = await prisma.menuItem.updateMany({
        where,
        data: updateData,
    });

    // If clearing discounts across items, also clear individual variant overrides
    if (discountPercent === null && discountFixed === null) {
        await prisma.menuVariant.updateMany({
            where: {
                menu_item: where,
            },
            data: {
                discount_percent: null,
                discount_fixed: null,
            },
        }).catch(() => {});
    }

    try {
        const { bumpSyncEpoch } = await import('./catalogCacheService.js');
        bumpSyncEpoch();
    } catch (_) {}

    return result.count;
}
