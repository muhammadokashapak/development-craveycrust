/**
 * ╔══════════════════════════════════════════╗
 * ║   Prisma Client — src/db/client.js       ║
 * ║   Singleton PrismaClient instance.       ║
 * ║   Only connects when                     ║
 * ║   RESTAURANT_DB_ENABLED=true             ║
 * ╚══════════════════════════════════════════╝
 *
 * IMPORTANT:
 *   - Never import this if RESTAURANT_DB_ENABLED=false
 *   - The client.connect() is lazy — it won't crash if DB is down
 *     unless you actually run a query
 *   - Use getDbClient() which returns null when DB is disabled
 */

import fs from 'fs';
import net from 'net';
import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import { flags } from '../config/flags.js';
import { dbLogger } from '../utils/logger.js';

let _prisma = null;
let _dbStatus = 'UNKNOWN'; // 'ONLINE' | 'OFFLINE' | 'UNKNOWN'
let _lastProbeTime = 0;
let _isProbing = false;
const PROBE_INTERVAL_MS = 30000; // 30 seconds

function getDbHostAndPort() {
    try {
        const urlStr = process.env.DATABASE_URL;
        if (!urlStr) return { host: '127.0.0.1', port: 5432 };
        const parsed = new URL(urlStr);
        return {
            host: parsed.hostname || '127.0.0.1',
            port: parseInt(parsed.port, 10) || 5432,
        };
    } catch (_) {
        return { host: '127.0.0.1', port: 5432 };
    }
}

/**
 * Fast non-blocking socket probe (max 300ms) to check if PostgreSQL port is open.
 */
export function probeDbConnection(timeoutMs = 300) {
    if (_isProbing) return Promise.resolve(_dbStatus === 'ONLINE');
    _isProbing = true;
    const { host, port } = getDbHostAndPort();

    return new Promise((resolve) => {
        const socket = new net.Socket();
        let settled = false;

        socket.setTimeout(timeoutMs);

        const done = (isOnline) => {
            if (!settled) {
                settled = true;
                _isProbing = false;
                _lastProbeTime = Date.now();
                const prev = _dbStatus;
                _dbStatus = isOnline ? 'ONLINE' : 'OFFLINE';
                if (prev !== _dbStatus) {
                    if (isOnline) {
                        dbLogger.info({ host, port }, 'Database TCP socket reachable — ONLINE');
                    } else {
                        dbLogger.warn({ host, port }, 'Database TCP socket unreachable — OFFLINE (instant fallback active)');
                    }
                }
                try { socket.destroy(); } catch (_) {}
                resolve(isOnline);
            }
        };

        socket.once('connect', () => done(true));
        socket.once('timeout', () => done(false));
        socket.once('error', () => done(false));

        try {
            socket.connect(port, host);
        } catch (_) {
            done(false);
        }
    });
}

// Initial probe immediately on module load
if (flags.RESTAURANT_DB_ENABLED) {
    probeDbConnection(300).catch(() => {});
} else {
    _dbStatus = 'OFFLINE';
}

/**
 * Mark DB offline when a query fails with connection error
 */
export function markDbOffline() {
    _dbStatus = 'OFFLINE';
    _lastProbeTime = Date.now();
}

export function markDbOnline() {
    _dbStatus = 'ONLINE';
    _lastProbeTime = Date.now();
}

export function isDbOnline() {
    return _dbStatus === 'ONLINE';
}

/**
 * Get the PrismaClient singleton.
 * Returns null immediately if RESTAURANT_DB_ENABLED=false or DB is OFFLINE.
 *
 * @returns {PrismaClient|null}
 */
export function getDbClient() {
    if (!flags.RESTAURANT_DB_ENABLED) {
        return null;
    }

    if (_dbStatus === 'OFFLINE') {
        if (Date.now() - _lastProbeTime > PROBE_INTERVAL_MS) {
            probeDbConnection(300).catch(() => {});
        }
        return null; // Return null INSTANTLY! No delay!
    }

    if (_dbStatus === 'UNKNOWN') {
        probeDbConnection(300).catch(() => {});
        return null;
    }

    if (!_prisma) {
        let effectiveDbUrl = process.env.DATABASE_URL;
        if (!effectiveDbUrl) {
            dbLogger.error('DATABASE_URL is not set — cannot create PrismaClient');
            return null;
        }

        // When running outside Docker on Linux host, resolve internal container hostname to bridge IP
        if (effectiveDbUrl.includes('@cravey-postgres:5432') && !fs.existsSync('/.dockerenv')) {
            let containerIp = '127.0.0.1';
            try {
                const detected = execSync("docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' cravey-postgres 2>/dev/null", { encoding: 'utf8' }).trim();
                if (detected) containerIp = detected;
            } catch (_) {}
            effectiveDbUrl = effectiveDbUrl.replace('@cravey-postgres:5432', `@${containerIp}:5432`);
        }

        _prisma = new PrismaClient({
            datasources: {
                db: { url: effectiveDbUrl },
            },
            log: [
                { level: 'warn',  emit: 'event' },
                { level: 'error', emit: 'event' },
                ...(process.env.NODE_ENV === 'development'
                    ? [{ level: 'query', emit: 'event' }]
                    : []),
            ],
        });

        // Forward Prisma events to our structured logger
        _prisma.$on('warn',  (e) => dbLogger.warn(e.message));
        _prisma.$on('error', (e) => {
            if (/reach database|ECONNREFUSED|connect.*5432/i.test(e.message)) {
                markDbOffline();
            }
            dbLogger.error(e.message);
        });

        if (process.env.NODE_ENV === 'development') {
            _prisma.$on('query', (e) => {
                dbLogger.debug({ query: e.query, duration: `${e.duration}ms` }, 'DB query');
            });
        }

        dbLogger.info('PrismaClient initialized');
    }

    return _prisma;
}

/**
 * Gracefully disconnect PrismaClient on shutdown.
 * Call this in SIGTERM/SIGINT handlers.
 */
export async function disconnectDb() {
    if (_prisma) {
        await _prisma.$disconnect();
        _prisma = null;
        dbLogger.info('PrismaClient disconnected');
    }
}

// Export singleton for direct use where flag check is already done
export const prisma = flags.RESTAURANT_DB_ENABLED ? (() => {
    const client = getDbClient();
    return client;
})() : null;
