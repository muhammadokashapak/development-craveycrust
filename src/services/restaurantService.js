import { getDbClient, markDbOffline } from '../db/client.js';

let _cachedRestaurantId = null;

/**
 * Get the current restaurant ID.
 * Multi-tenant ready: defaults to 'cravey-crust' or creates a fallback if empty.
 *
 * @returns {Promise<string>}
 */
export async function getDefaultRestaurantId() {
    if (_cachedRestaurantId) {
        return _cachedRestaurantId;
    }

    const prisma = getDbClient();
    if (!prisma) {
        _cachedRestaurantId = 'default-restaurant';
        return _cachedRestaurantId;
    }

    try {
        let restaurant = await prisma.restaurant.findFirst({
            where: { slug: 'cravey-crust', is_active: true },
            select: { id: true },
        });

        if (!restaurant) {
            restaurant = await prisma.restaurant.findFirst({
                where: { is_active: true },
                orderBy: { created_at: 'asc' },
                select: { id: true },
            });
        }

        if (restaurant) {
            _cachedRestaurantId = restaurant.id;
            return _cachedRestaurantId;
        }
    } catch (err) {
        markDbOffline();
        _cachedRestaurantId = 'default-restaurant';
        return _cachedRestaurantId;
    }

    _cachedRestaurantId = 'default-restaurant';
    return _cachedRestaurantId;
}

/**
 * Reset cached restaurant ID (useful in tests)
 */
export function resetCachedRestaurantId() {
    _cachedRestaurantId = null;
}
