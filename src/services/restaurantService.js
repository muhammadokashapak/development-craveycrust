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

/**
 * Format phone to standard Pakistani display format (e.g. 0343-4919319)
 */
export function formatDisplayPhone(raw) {
    if (!raw) return '';
    const digits = String(raw).replace(/\D/g, '');
    let standard = digits;
    if (digits.startsWith('92') && digits.length >= 12) {
        standard = '0' + digits.slice(2);
    } else if (!digits.startsWith('0') && digits.length === 10) {
        standard = '0' + digits;
    }
    if (standard.length === 11) {
        return `${standard.slice(0, 4)}-${standard.slice(4)}`;
    }
    return raw.trim();
}

/**
 * Format phone to international WhatsApp format without plus or symbols (e.g. 923434919319)
 */
export function formatWhatsAppPhone(raw) {
    if (!raw) return '';
    const digits = String(raw).replace(/\D/g, '');
    if (digits.startsWith('03') && digits.length === 11) {
        return '92' + digits.slice(1);
    }
    if (digits.startsWith('92')) {
        return digits;
    }
    return digits;
}

/**
 * Get dynamic Admin / Manager contact information directly from settings/database.
 * Priority:
 *   1. restaurantSetting key 'human_handoff_phone' (Configured in Settings -> Support Agent Phone)
 *   2. restaurant.admin_notification_phone (Configured in Settings -> Admin Notification Phone)
 *   3. restaurant.phone (Restaurant Helpline)
 *   4. Environment variables (ADMIN_NOTIFICATION_PHONE / OWNER_NUMBER)
 *
 * @param {string} [restaurantId]
 * @returns {Promise<{raw: string, displayPhone: string, whatsappPhone: string, whatsappLink: string}>}
 */
export async function getAdminContact(restaurantId = null) {
    const prisma = getDbClient();
    const restId = restaurantId || await getDefaultRestaurantId().catch(() => null);

    let configuredPhone = null;

    if (prisma && restId) {
        try {
            // 1. Primary check: custom_settings.human_handoff_phone
            const handoffSetting = await prisma.restaurantSetting.findFirst({
                where: { restaurant_id: restId, key: 'human_handoff_phone' },
                orderBy: { updated_at: 'desc' },
            });
            if (handoffSetting?.value && handoffSetting.value.trim()) {
                configuredPhone = handoffSetting.value.trim();
            }

            // 2. Secondary check: restaurant.admin_notification_phone
            if (!configuredPhone) {
                const rest = await prisma.restaurant.findUnique({
                    where: { id: restId },
                    select: { admin_notification_phone: true, phone: true },
                });
                if (rest?.admin_notification_phone && rest.admin_notification_phone.trim()) {
                    configuredPhone = rest.admin_notification_phone.trim();
                } else if (rest?.phone && rest.phone.trim() && rest.phone !== '+92-300-0000000') {
                    configuredPhone = rest.phone.trim();
                }
            }
        } catch (_) {}
    }

    if (!configuredPhone) {
        configuredPhone = process.env.ADMIN_NOTIFICATION_PHONE || process.env.OWNER_NUMBER || '923001234567';
    }

    const waPhone = formatWhatsAppPhone(configuredPhone);
    const displayPhone = formatDisplayPhone(configuredPhone);
    const whatsappLink = waPhone ? `https://wa.me/${waPhone}` : '';

    return {
        raw: configuredPhone,
        displayPhone: displayPhone || configuredPhone,
        whatsappPhone: waPhone,
        whatsappLink,
    };
}
