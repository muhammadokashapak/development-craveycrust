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
import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import { flags } from '../config/flags.js';
import { dbLogger } from '../utils/logger.js';

let _prisma = null;

/**
 * Get the PrismaClient singleton.
 * Returns null if RESTAURANT_DB_ENABLED=false.
 *
 * @returns {PrismaClient|null}
 */
export function getDbClient() {
    if (!flags.RESTAURANT_DB_ENABLED) {
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
        _prisma.$on('error', (e) => dbLogger.error(e.message));
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
