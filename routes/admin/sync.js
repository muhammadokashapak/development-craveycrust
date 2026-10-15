import express from 'express';
import { getIncrementalChanges, processClientMutations, LIVE_ONLY_MODULES } from '../../src/services/syncService.js';
import { getDefaultRestaurantId } from '../../src/services/restaurantService.js';
// ─── Catalog Cache: bump syncEpoch & refresh when admin syncs ─────────────
import { bumpSyncEpoch, refreshCatalogCache } from '../../src/services/catalogCacheService.js';

const router = express.Router();

/**
 * GET /api/admin/sync
 * Multi-Module Incremental Synchronization Endpoint (Offline-First / Cache-First)
 * Query params:
 *   - last_sync_time / since / version: ISO 8601 string of client's last sync
 *   - entities: comma-separated list of entities to sync
 */
router.get('/', async (req, res) => {
    try {
        const restaurantId = req.user?.restaurantId || req.user?.restaurant_id || await getDefaultRestaurantId();
        const lastSyncTime = req.query.last_sync_time || req.query.since || req.query.version;
        const entitiesParam = req.query.entities || 'all';

        // Check if any requested entity is strictly live-only
        const requested = String(entitiesParam).split(',').map(s => s.trim().toLowerCase());
        const hasLiveOnly = requested.some(e => LIVE_ONLY_MODULES.includes(e));
        if (hasLiveOnly) {
            return res.status(400).json({
                success: false,
                error: 'Security, authentication, and payment transactions are strictly live-only and cannot be synchronized or cached.',
                liveOnlyModules: LIVE_ONLY_MODULES
            });
        }

        const result = await getIncrementalChanges({
            restaurantId,
            since: lastSyncTime,
            entities: entitiesParam,
        });

        // Bump syncEpoch + refresh catalog cache so AI sessions get fresh context
        setImmediate(() => {
            bumpSyncEpoch();
            refreshCatalogCache().catch(() => {});
        });

        return res.json(result);
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: err.message,
        });
    }
});

/**
 * POST /api/admin/sync
 * Push client-side local changes & offline drafts to server
 */
router.post('/', async (req, res) => {
    try {
        const restaurantId = req.user?.restaurantId || req.user?.restaurant_id || await getDefaultRestaurantId();
        const { mutations = [] } = req.body;

        const result = await processClientMutations({
            restaurantId,
            mutations,
        });

        // Bump syncEpoch + refresh catalog cache after mutations
        setImmediate(() => {
            bumpSyncEpoch();
            refreshCatalogCache().catch(() => {});
        });

        return res.json(result);
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: err.message,
        });
    }
});

export default router;
