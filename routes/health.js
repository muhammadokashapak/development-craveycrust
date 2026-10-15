/**
 * ╔══════════════════════════════════════════╗
 * ║   Health Route — routes/health.js        ║
 * ║   GET /api/health                        ║
 * ║   Returns system + DB status.            ║
 * ║   Does NOT require auth — safe for       ║
 * ║   load balancer / uptime monitoring.     ║
 * ╚══════════════════════════════════════════╝
 *
 * Response shape:
 *   {
 *     status: 'ok' | 'degraded',
 *     version: string,
 *     uptime_s: number,
 *     memory_mb: number,
 *     timestamp: string,
 *     services: {
 *       bot: { status: 'ok', sessions: number },
 *       database: { status: 'ok'|'disabled'|'error', latency_ms, message },
 *       flags: { RESTAURANT_DB_ENABLED, CORE_ORDER_ENGINE_ENABLED, ... }
 *     }
 *   }
 */

import express from 'express';
import { checkDbHealth } from '../src/db/health.js';
import { flags } from '../src/config/flags.js';

const router = express.Router();

// Package version (read once at module load)
let _version = '1.0.0';
try {
    const { createRequire } = await import('module');
    const require = createRequire(import.meta.url);
    const pkg = require('../package.json');
    _version = pkg.version || '1.0.0';
} catch (_) {}

/**
 * GET /api/health
 * Public — no auth required.
 *
 * The activeSessions map is injected from bot.js so we can report
 * connected session count without importing bot internals.
 */
let _getSessions = () => new Map();

export function injectSessionGetter(fn) {
    _getSessions = fn;
}

router.get('/', async (req, res) => {
    const start = Date.now();

    // ── Bot status ────────────────────────────────────────────
    const sessions = _getSessions();
    const connectedCount = Array.from(sessions.values()).filter(s => s.state === 'connected').length;
    const totalSessions  = sessions.size;

    // ── Database health ───────────────────────────────────────
    const dbHealth = await checkDbHealth();

    // ── Memory ───────────────────────────────────────────────
    const memUsage  = process.memoryUsage();
    const memory_mb = (memUsage.rss / 1024 / 1024).toFixed(1);

    // ── Overall status ────────────────────────────────────────
    // 'degraded' if DB is enabled but unhealthy; otherwise 'ok'
    const isDbDegraded = flags.RESTAURANT_DB_ENABLED && dbHealth.status === 'error';
    const overallStatus = isDbDegraded ? 'degraded' : 'ok';

    const body = {
        status:    overallStatus,
        version:   _version,
        uptime_s:  Math.floor(process.uptime()),
        memory_mb: parseFloat(memory_mb),
        timestamp: new Date().toISOString(),
        services: {
            bot: {
                status:    'ok',
                sessions:  totalSessions,
                connected: connectedCount,
            },
            database: dbHealth,
            flags: {
                RESTAURANT_DB_ENABLED:     flags.RESTAURANT_DB_ENABLED,
                CORE_ORDER_ENGINE_ENABLED: flags.CORE_ORDER_ENGINE_ENABLED,
                CUSTOM_AI_ENABLED:         flags.CUSTOM_AI_ENABLED,
                REALTIME_DASHBOARD_ENABLED: flags.REALTIME_DASHBOARD_ENABLED,
            },
        },
        response_ms: Date.now() - start,
    };

    // Return 503 only if a critical service is degraded
    const httpStatus = overallStatus === 'ok' ? 200 : 503;
    return res.status(httpStatus).json(body);
});

export default router;
