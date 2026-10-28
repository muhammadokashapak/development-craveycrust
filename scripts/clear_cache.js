#!/usr/bin/env node
/**
 * Post-deploy / manual cache clearing script.
 * Run via: npm run clear-cache OR node scripts/clear_cache.js
 */
import { clearAllCaches } from '../src/services/catalogCacheService.js';

async function main() {
    console.log('[DEPLOY] Clearing all application and catalog caches...');
    const cache = await clearAllCaches();
    console.log(`[DEPLOY] Cache clearing complete. Loaded ${cache?.rawDeals?.length || 0} deals, ${cache?.rawCategories?.length || 0} categories.`);
    process.exit(0);
}

main().catch(err => {
    console.error('[DEPLOY] Cache clear error:', err);
    process.exit(1);
});
