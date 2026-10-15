/**
 * ╔══════════════════════════════════════════╗
 * ║   Feature Flags — src/config/flags.js   ║
 * ║   Safe migration flags for phased        ║
 * ║   rollout of new system features.        ║
 * ╚══════════════════════════════════════════╝
 *
 * All flags default to FALSE so the existing system
 * remains fully operational by default.
 *
 * Usage:
 *   import { flags } from './src/config/flags.js';
 *   if (flags.RESTAURANT_DB_ENABLED) { ... }
 *
 * To enable a flag, set in .env:
 *   RESTAURANT_DB_ENABLED=true
 */

/**
 * Read a boolean environment variable.
 * Only the exact string "true" (case-insensitive) enables the flag.
 * Everything else (missing, "false", "0", "yes") returns false.
 */
function readBoolFlag(envKey, defaultValue = false) {
    const val = process.env[envKey];
    if (val === undefined || val === null || val === '') return defaultValue;
    return val.trim().toLowerCase() === 'true';
}

export const flags = Object.freeze({
    /**
     * RESTAURANT_DB_ENABLED
     * When true: Prisma client will connect to PostgreSQL.
     * When false: DB module remains dormant. Zero database calls.
     * Phase 1: false (DB schema exists but not yet used by bot logic)
     * Phase 2+: true (dashboard reads/writes to DB)
     */
    RESTAURANT_DB_ENABLED: readBoolFlag('RESTAURANT_DB_ENABLED', false),
    CORE_ORDER_ENGINE_ENABLED: readBoolFlag('CORE_ORDER_ENGINE_ENABLED', false),
    CUSTOM_AI_ENABLED: readBoolFlag('CUSTOM_AI_ENABLED', false),
    REALTIME_DASHBOARD_ENABLED: readBoolFlag('REALTIME_DASHBOARD_ENABLED', false),
    KNOWLEDGE_BASE_ENABLED: readBoolFlag('KNOWLEDGE_BASE_ENABLED', true),
    WHATSAPP_ORDERING_ENABLED: readBoolFlag('WHATSAPP_ORDERING_ENABLED', true),
    N8N_ENABLED: readBoolFlag('N8N_ENABLED', false),
    N8N_INTEGRATION_ENABLED: readBoolFlag('N8N_INTEGRATION_ENABLED', false),
});

// Log flag state at startup (safe — no secret values)
export function logFlags() {
    const entries = Object.entries(flags);
    const width = Math.max(...entries.map(([k]) => k.length));
    console.log('\n[FLAGS] Feature flag state:');
    for (const [key, val] of entries) {
        const padded = key.padEnd(width);
        const status = val ? '✅ ENABLED ' : '🔲 disabled';
        console.log(`  ${status}  ${padded}`);
    }
    console.log('');
}
