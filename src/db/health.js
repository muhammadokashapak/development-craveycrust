/**
 * ╔══════════════════════════════════════════╗
 * ║   DB Health — src/db/health.js           ║
 * ║   Database connectivity check for the   ║
 * ║   /api/health endpoint.                  ║
 * ╚══════════════════════════════════════════╝
 */

import { getDbClient } from './client.js';
import { flags } from '../config/flags.js';

/**
 * Check database connectivity.
 *
 * @returns {Promise<{
 *   status: 'ok' | 'disabled' | 'error',
 *   latency_ms: number | null,
 *   message: string
 * }>}
 */
export async function checkDbHealth() {
    // If DB flag is disabled, return clean "disabled" status — never an error
    if (!flags.RESTAURANT_DB_ENABLED) {
        return {
            status: 'disabled',
            latency_ms: null,
            message: 'Database not enabled (RESTAURANT_DB_ENABLED=false)',
        };
    }

    const db = getDbClient();

    if (!db) {
        return {
            status: 'error',
            latency_ms: null,
            message: 'PrismaClient could not be initialized (check DATABASE_URL)',
        };
    }

    const start = Date.now();

    try {
        // Simple raw query — fastest connectivity check
        await db.$queryRaw`SELECT 1`;
        const latency_ms = Date.now() - start;

        return {
            status: 'ok',
            latency_ms,
            message: `Connected (${latency_ms}ms)`,
        };
    } catch (err) {
        return {
            status: 'error',
            latency_ms: Date.now() - start,
            message: `Connection failed: ${err.message}`,
        };
    }
}
