import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { getDbClient } from '../db/client.js';
import { flags } from '../config/flags.js';
import { getDefaultRestaurantId } from './restaurantService.js';

const AUTH_SECRET = process.env.AUTH_SECRET || 'restaurant-bot-auth-secret-key';
const TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Helper functions for dynamic credential resolution from environment
const getDashboardUser = () => (process.env.DASHBOARD_USER || process.env.ADMIN_USER || 'admin').trim();
const getDashboardPass = () => process.env.DASHBOARD_PASS || process.env.ADMIN_PASS || '';

const getSuperAdminUser = () => (process.env.SUPERADMIN_USER || process.env.SUPER_ADMIN_USER || 'superadmin').trim();
const getSuperAdminPass = () => process.env.SUPERADMIN_PASS || process.env.SUPER_ADMIN_PASS || '';

function isSuperAdminUsername(userStr) {
    if (!userStr) return false;
    const u = userStr.toLowerCase().trim();
    const configured = getSuperAdminUser().toLowerCase();
    return u === configured ||
           u === 'superadmin' ||
           u === 'superadmin@craveycrust.com' ||
           (configured.includes('@') && u === configured.split('@')[0]);
}

function isAdminUsername(userStr) {
    if (!userStr) return false;
    const u = userStr.toLowerCase().trim();
    const configured = getDashboardUser().toLowerCase();
    return u === configured ||
           u === 'admin' ||
           u === 'admin@craveycrust.com' ||
           (configured.includes('@') && u === configured.split('@')[0]);
}

/**
 * Generate a cryptographically signed admin token.
 * Token structure: base64(payload) . signature
 *
 * @param {object} payload
 * @returns {string}
 */
export function generateAdminToken(payload) {
    const data = {
        ...payload,
        iat: Date.now(),
        exp: Date.now() + TOKEN_EXPIRY_MS,
    };
    const encodedPayload = Buffer.from(JSON.stringify(data)).toString('base64url');
    const signature = crypto
        .createHmac('sha256', AUTH_SECRET)
        .update(encodedPayload)
        .digest('base64url');
    return `${encodedPayload}.${signature}`;
}

/**
 * Generate legacy HMAC token (backward compatibility with bot.js).
 * Format: timestamp.hash
 *
 * @param {string} user
 * @returns {string}
 */
export function generateLegacyToken(user) {
    const timestamp = Date.now();
    const hash = crypto
        .createHmac('sha256', AUTH_SECRET)
        .update(`${user}:${timestamp}`)
        .digest('hex');
    return `${timestamp}.${hash}`;
}

/**
 * Verify an incoming auth token.
 * Supports:
 *   1) Phase 2 signed admin tokens (`base64urlPayload.signature`)
 *   2) Legacy HMAC tokens (`timestamp.hash`)
 *
 * @param {string} token
 * @returns {{ valid: boolean, user?: object, error?: string }}
 */
export function verifyToken(token) {
    if (!token || typeof token !== 'string') {
        return { valid: false, error: 'NO_TOKEN' };
    }

    const trimmed = token.trim();

    // Check for Phase 2 signed admin token
    if (trimmed.includes('.')) {
        const parts = trimmed.split('.');
        if (parts.length === 2 && !/^\d+$/.test(parts[0])) {
            const [encodedPayload, signature] = parts;
            const expectedSig = crypto
                .createHmac('sha256', AUTH_SECRET)
                .update(encodedPayload)
                .digest('base64url');

            // Timing-safe signature check
            const sigBuf = Buffer.from(signature);
            const expBuf = Buffer.from(expectedSig);
            if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
                return { valid: false, error: 'INVALID_SIGNATURE' };
            }

            try {
                const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
                if (payload.exp && Date.now() > payload.exp) {
                    return { valid: false, error: 'TOKEN_EXPIRED' };
                }
                if (payload && payload.role !== 'SUPER_ADMIN' && isAdminUsername(payload.username)) {
                    payload.role = 'ADMIN';
                }
                return { valid: true, user: payload };
            } catch (err) {
                return { valid: false, error: 'MALFORMED_PAYLOAD' };
            }
        }
    }

    // Check for legacy HMAC token (timestamp.hash)
    const [timestamp, hash] = trimmed.split('.');
    if (timestamp && hash && /^\d+$/.test(timestamp)) {
        const ts = parseInt(timestamp, 10);
        if (Date.now() - ts > TOKEN_EXPIRY_MS) {
            return { valid: false, error: 'TOKEN_EXPIRED' };
        }
        const currentDashUser = getDashboardUser();
        const expectedHash = crypto
            .createHmac('sha256', AUTH_SECRET)
            .update(`${currentDashUser}:${timestamp}`)
            .digest('hex');

        const hashBuf = Buffer.from(hash);
        const expBuf = Buffer.from(expectedHash);
        if (hashBuf.length === expBuf.length && crypto.timingSafeEqual(hashBuf, expBuf)) {
            return {
                valid: true,
                user: {
                    userId: 'legacy-admin',
                    username: currentDashUser,
                    role: 'SUPER_ADMIN',
                    isLegacy: true,
                },
            };
        }
    }

    return { valid: false, error: 'INVALID_TOKEN' };
}

/**
 * Authenticate admin user credentials.
 * Checks PostgreSQL AdminUser first, then falls back to .env credentials.
 *
 * @param {string} username
 * @param {string} password
 * @returns {Promise<{ user: object, token: string } | null>}
 */
export async function authenticateAdmin(username, password) {
    if (!username || !password) return null;

    const trimmedUser = username.trim();
    const cleanUserLower = trimmedUser.toLowerCase();

    const envAdminPass = getDashboardPass();
    const envSuperPass = getSuperAdminPass();

    // 1. Database-backed authentication (if RESTAURANT_DB_ENABLED)
    if (flags.RESTAURANT_DB_ENABLED) {
        const prisma = getDbClient();
        if (prisma) {
            try {
                const dbUser = await prisma.adminUser.findFirst({
                    where: {
                        OR: [
                            { username: trimmedUser },
                            { email: cleanUserLower },
                        ],
                        is_active: true,
                    },
                    include: { restaurant: true },
                });

                if (dbUser) {
                    let match = false;

                    // If env credentials are set for Super Admin or Admin, they are authoritative
                    if (isSuperAdminUsername(cleanUserLower) && envSuperPass) {
                        match = (password === envSuperPass);
                    } else if (isAdminUsername(cleanUserLower) && envAdminPass) {
                        match = (password === envAdminPass);
                    } else if (dbUser.password_hash) {
                        match = await bcrypt.compare(password, dbUser.password_hash);
                    }

                    // If env password matched, ensure DB hash is synchronized in background
                    if (match && dbUser.password_hash && (isSuperAdminUsername(cleanUserLower) || isAdminUsername(cleanUserLower))) {
                        bcrypt.compare(password, dbUser.password_hash).then(hashesMatch => {
                            if (!hashesMatch) {
                                bcrypt.hash(password, 12).then(newHash => {
                                    prisma.adminUser.update({
                                        where: { id: dbUser.id },
                                        data: { password_hash: newHash },
                                    }).catch(() => {});
                                }).catch(() => {});
                            }
                        }).catch(() => {});
                    }

                    if (match) {
                        prisma.adminUser.update({
                            where: { id: dbUser.id },
                            data: { last_login_at: new Date() },
                        }).catch(() => {});

                        const isSuper = isSuperAdminUsername(cleanUserLower) || dbUser.role === 'SUPER_ADMIN';
                        const userRole = isSuper ? 'SUPER_ADMIN' : (dbUser.role || 'ADMIN');
                        const restName = dbUser.restaurant?.name || 'Admin';

                        const userPayload = {
                            userId: dbUser.id,
                            username: dbUser.username,
                            email: dbUser.email,
                            role: userRole,
                            restaurantId: dbUser.restaurant_id,
                            restaurantName: restName,
                        };

                        const token = generateAdminToken(userPayload);
                        return { user: userPayload, token };
                    } else {
                        return null;
                    }
                }
            } catch (err) {
                console.error('[AUTH] DB auth lookup failed:', err.message);
            }
        }
    }

    // 2. Built-in / Fallback Credentials from Environment Variables (works with or without DB)
    let matchedRole = null;
    let matchedUsername = null;

    // Super Admin Check (from environment)
    if (isSuperAdminUsername(cleanUserLower) && envSuperPass && password === envSuperPass) {
        matchedRole = 'SUPER_ADMIN';
        matchedUsername = getSuperAdminUser();
    }
    // Admin Check (from environment)
    else if (isAdminUsername(cleanUserLower) && envAdminPass && password === envAdminPass) {
        matchedRole = 'ADMIN';
        matchedUsername = getDashboardUser();
    }

    if (matchedRole) {
        let restaurantId = 'default-restaurant';
        try {
            if (flags.RESTAURANT_DB_ENABLED) {
                restaurantId = await getDefaultRestaurantId();
            }
        } catch (_) {}

        const userPayload = {
            userId: matchedRole === 'SUPER_ADMIN' ? 'env-superadmin' : 'env-admin',
            username: matchedUsername,
            role: matchedRole,
            restaurantId,
            restaurantName: 'Admin',
            isLegacy: true,
        };

        const token = generateAdminToken(userPayload);
        return { user: userPayload, token };
    }

    return null;
}
