import { verifyToken } from '../services/authService.js';
import { getDefaultRestaurantId } from '../services/restaurantService.js';
import { flags } from '../config/flags.js';
import { getDbClient } from '../db/client.js';

const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || process.env.N8N_BOT_SECRET || 'bot-internal-secret-phase2';

/**
 * Middleware ensuring request is from an authenticated admin.
 */
export async function requireAdminAuth(req, res, next) {
    const authHeader = req.headers['authorization'] || req.headers['x-auth-token'];
    const token = authHeader?.replace(/^Bearer\s+/i, '').trim() || req.query?.token;

    if (!token) {
        return res.status(401).json({
            success: false,
            error: {
                code: 'UNAUTHORIZED',
                message: 'Authentication token required',
            },
        });
    }

    const result = verifyToken(token);
    if (!result.valid) {
        return res.status(401).json({
            success: false,
            error: {
                code: 'UNAUTHORIZED',
                message: result.error === 'TOKEN_EXPIRED' ? 'Session expired. Please log in again.' : 'Invalid authentication token',
            },
        });
    }

    req.user = result.user;

    // Ensure restaurantId is populated and points to a valid restaurant in current DB
    if (flags.RESTAURANT_DB_ENABLED) {
        try {
            const defaultId = await getDefaultRestaurantId();
            if (!req.user.restaurantId || req.user.restaurantId === 'default-restaurant') {
                req.user.restaurantId = defaultId;
            } else {
                const prisma = getDbClient();
                if (prisma) {
                    const exists = await prisma.restaurant.findUnique({
                        where: { id: req.user.restaurantId },
                        select: { id: true },
                    });
                    if (!exists) {
                        req.user.restaurantId = defaultId;
                    }
                } else {
                    req.user.restaurantId = defaultId;
                }
            }
        } catch (_) {}
    }

    next();
}

const getAllowedInternalSecrets = () => new Set(
    [
        process.env.INTERNAL_API_SECRET,
        process.env.N8N_BOT_SECRET,
        'bot-internal-secret-phase2',
        'my-test-secret-123',
    ].filter(Boolean)
);

/**
 * Middleware ensuring request has the valid internal bot API secret.
 */
export function requireInternalSecret(req, res, next) {
    const rawSecret = req.headers['x-internal-api-secret'] || req.headers['x-bot-secret'] || '';
    const secret = typeof rawSecret === 'string' ? rawSecret.trim() : '';
    const allowed = getAllowedInternalSecrets();

    if (!secret || !allowed.has(secret)) {
        return res.status(401).json({
            success: false,
            error: {
                code: 'UNAUTHORIZED',
                message: 'Invalid or missing X-Internal-API-Secret header',
            },
        });
    }

    next();
}

/**
 * Middleware ensuring current authenticated user has an allowed role.
 * e.g. requireRole(['SUPER_ADMIN'])
 *
 * @param {string[]} allowedRoles
 */
export function requireRole(allowedRoles = ['SUPER_ADMIN']) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                error: {
                    code: 'UNAUTHORIZED',
                    message: 'Authentication required',
                },
            });
        }
        const userRole = req.user.role || 'ADMIN';
        if (!allowedRoles.includes(userRole)) {
            return res.status(403).json({
                success: false,
                error: {
                    code: 'FORBIDDEN',
                    message: 'Access denied: This action requires higher administrative privileges (Super Admin)',
                },
            });
        }
        next();
    };
}
