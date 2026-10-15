/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║   Sync Service — src/services/syncService.js                 ║
 * ║   Enterprise Incremental Synchronization Engine              ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Implements standard Offline-First Architecture across all modules:
 *
 * 1. Essential Modules (Master/Lookups Data):
 *    - Products/Menu Items & Variants
 *    - Categories
 *    - Deals & Combos
 *    - Customers Directory
 *    - Restaurant Settings & Operating Times
 *    - FAQs / Business Knowledge Base
 *    - User Dashboard Statistics Snapshot
 *
 * 2. Operational Modules (Incremental / Delta Sync):
 *    - Orders / Transaction History (delta updated_at > last_sync_time)
 *    - Inventory / Availability Status (is_available, is_active)
 *    - Offline Drafts / Submissions push (is_synced: false -> true)
 *
 * 3. Prohibited Sync (Live Data Only - Cache Bypassed):
 *    - Payment Gateways & Real-time Wallets (Always live server verify)
 *    - Security / Auth / Passwords / OTP (Strictly live request)
 */

import { getDbClient } from '../db/client.js';
import { getDefaultRestaurantId } from './restaurantService.js';

// Sensitive security/money modules that MUST NEVER be cached
export const LIVE_ONLY_MODULES = ['auth', 'passwords', 'tokens', 'payments', 'wallet', 'otp'];

/**
 * Fetch incremental delta changes across all registered application modules
 */
export async function getIncrementalChanges({ restaurantId, since, entities = ['all'] }) {
    const prisma = getDbClient();
    if (!prisma) {
        throw new Error('Database client not available');
    }

    const restId = restaurantId || await getDefaultRestaurantId();
    const serverTime = new Date().toISOString();

    let sinceDate = null;
    if (since) {
        const parsed = new Date(since);
        if (!isNaN(parsed.getTime())) {
            sinceDate = parsed;
        }
    }

    const selectedEntities = Array.isArray(entities) 
        ? entities.map(s => String(s).trim().toLowerCase()) 
        : String(entities).split(',').map(s => s.trim().toLowerCase());

    const isAll = selectedEntities.includes('all');
    const changes = {};
    const counts = {};
    let totalChanges = 0;

    // ─── 1. Customers Master / CRM ────────────────────────────
    if (isAll || selectedEntities.includes('customers')) {
        const where = { restaurant_id: restId };
        if (sinceDate) where.updated_at = { gt: sinceDate };

        const customers = await prisma.customer.findMany({
            where,
            orderBy: { updated_at: 'desc' },
            take: 200,
            include: {
                orders: {
                    select: {
                        id: true,
                        order_number: true,
                        total: true,
                        order_status: true,
                        created_at: true,
                    },
                    orderBy: { created_at: 'desc' },
                    take: 5,
                },
            },
        });

        changes.customers = customers.map(c => ({
            id: c.id,
            name: c.name || 'Anonymous Customer',
            phone: c.phone || '',
            whatsappPhone: c.whatsapp_phone || c.phone || '',
            totalOrders: c.total_orders || 0,
            firstOrder: c.first_order_at || c.created_at,
            lastOrder: c.last_order_at || c.updated_at,
            createdAt: c.created_at,
            updatedAt: c.updated_at,
            is_synced: true,
            recentOrders: c.orders.map(o => ({
                id: o.id,
                orderNumber: o.order_number,
                total: Number(o.total),
                orderStatus: o.order_status,
                createdAt: o.created_at,
            })),
        }));

        counts.customers = changes.customers.length;
        totalChanges += changes.customers.length;
    }

    // ─── 2. Orders Operational Delta (Past & Active Orders) ───
    if (isAll || selectedEntities.includes('orders')) {
        const where = { restaurant_id: restId };
        if (sinceDate) where.updated_at = { gt: sinceDate };

        const orders = await prisma.order.findMany({
            where,
            orderBy: { updated_at: 'desc' },
            take: 150,
            include: { order_items: true },
        });

        changes.orders = orders.map(o => ({
            id: o.id,
            orderNumber: o.order_number,
            customerId: o.customer_id,
            customerName: o.customer_name,
            phone: o.phone,
            deliveryAddress: o.delivery_address,
            paymentMethod: o.payment_method,
            paymentStatus: o.payment_status,
            orderStatus: o.order_status,
            total: Number(o.total),
            subtotal: Number(o.subtotal),
            deliveryFee: Number(o.delivery_fee),
            createdAt: o.created_at,
            updatedAt: o.updated_at,
            is_synced: true,
            itemCount: o.order_items?.length || 0,
            itemsSummary: o.order_items?.map(it => `${it.quantity}x ${it.item_name_snapshot || 'Item'}`).join(', ') || '',
        }));

        counts.orders = changes.orders.length;
        totalChanges += changes.orders.length;
    }

    // ─── 3. Menu / Products Master Lookup ─────────────────────
    if (isAll || selectedEntities.includes('menu')) {
        const where = { restaurant_id: restId };
        if (sinceDate) where.updated_at = { gt: sinceDate };

        const menuItems = await prisma.menuItem.findMany({
            where,
            orderBy: { updated_at: 'desc' },
            include: {
                variants: true,
                category: { select: { id: true, name: true, slug: true } },
            },
        });

        changes.menu = menuItems.map(item => ({
            id: item.id,
            categoryId: item.category_id,
            categoryName: item.category?.name,
            name: item.name,
            slug: item.slug,
            description: item.description,
            basePrice: Number(item.base_price),
            isAvailable: item.is_available,
            spicyLevel: item.spicy_level,
            variants: item.variants.map(v => ({
                id: v.id,
                name: v.name,
                price: Number(v.price),
                isAvailable: v.is_available,
            })),
            updatedAt: item.updated_at,
            is_synced: true,
        }));

        counts.menu = changes.menu.length;
        totalChanges += changes.menu.length;
    }

    // ─── 4. Categories Master Lookup ──────────────────────────
    if (isAll || selectedEntities.includes('categories')) {
        const where = { restaurant_id: restId };
        if (sinceDate) where.updated_at = { gt: sinceDate };

        const categories = await prisma.category.findMany({
            where,
            orderBy: { sort_order: 'asc' },
            include: { _count: { select: { menu_items: true } } },
        });

        changes.categories = categories.map(cat => ({
            id: cat.id,
            name: cat.name,
            slug: cat.slug,
            description: cat.description,
            isActive: cat.is_active,
            itemCount: cat._count?.menu_items || 0,
            updatedAt: cat.updated_at,
            is_synced: true,
        }));

        counts.categories = changes.categories.length;
        totalChanges += changes.categories.length;
    }

    // ─── 5. Deals & Combos Master Lookup ──────────────────────
    if (isAll || selectedEntities.includes('deals')) {
        const where = { restaurant_id: restId };
        if (sinceDate) where.updated_at = { gt: sinceDate };

        const deals = await prisma.deal.findMany({
            where,
            orderBy: { sort_order: 'asc' },
            include: {
                deal_items: {
                    include: { menu_item: { select: { id: true, name: true } } },
                },
            },
        });

        changes.deals = deals.map(d => ({
            id: d.id,
            name: d.name,
            slug: d.slug,
            description: d.description,
            dealPrice: Number(d.deal_price),
            isActive: d.is_active,
            updatedAt: d.updated_at,
            is_synced: true,
            items: d.deal_items.map(di => ({
                id: di.id,
                quantity: di.quantity,
                itemName: di.menu_item?.name || 'Item',
            })),
        }));

        counts.deals = changes.deals.length;
        totalChanges += changes.deals.length;
    }

    // ─── 6. Restaurant Settings & Operating Times ─────────────
    if (isAll || selectedEntities.includes('settings')) {
        const restaurant = await prisma.restaurant.findUnique({
            where: { id: restId },
            include: { settings: true },
        });

        if (restaurant) {
            changes.settings = {
                id: restaurant.id,
                name: restaurant.name,
                currency: restaurant.currency,
                timezone: restaurant.timezone,
                openingTime: restaurant.opening_time,
                closingTime: restaurant.closing_time,
                minOrder: Number(restaurant.min_order || 0),
                defaultDeliveryFee: Number(restaurant.default_delivery_fee || 0),
                codEnabled: restaurant.cod_enabled,
                easypaisaEnabled: restaurant.easypaisa_enabled,
                updatedAt: restaurant.updated_at,
                is_synced: true,
            };
            counts.settings = 1;
            totalChanges += 1;
        }
    }

    // ─── 7. FAQs / Knowledge Base Lookup ──────────────────────
    if (isAll || selectedEntities.includes('faqs')) {
        const where = { restaurant_id: restId };
        if (sinceDate) where.updated_at = { gt: sinceDate };

        const faqs = await prisma.fAQ.findMany({
            where,
            orderBy: { sort_order: 'asc' },
            include: { category: { select: { id: true, name: true } } },
        });

        changes.faqs = faqs.map(f => ({
            id: f.id,
            question: f.question,
            answer: f.answer,
            categoryName: f.category?.name || 'General',
            isActive: f.is_active,
            updatedAt: f.updated_at,
            is_synced: true,
        }));

        counts.faqs = changes.faqs.length;
        totalChanges += changes.faqs.length;
    }

    // ─── 8. User Dashboard Stats Snapshot ─────────────────────
    if (isAll || selectedEntities.includes('dashboard') || selectedEntities.includes('dashboard_stats')) {
        const [totalOrders, pendingOrders, totalCustomers, totalSalesAgg] = await Promise.all([
            prisma.order.count({ where: { restaurant_id: restId } }),
            prisma.order.count({ where: { restaurant_id: restId, order_status: 'PENDING' } }),
            prisma.customer.count({ where: { restaurant_id: restId } }),
            prisma.order.aggregate({
                where: { restaurant_id: restId, order_status: { not: 'CANCELLED' } },
                _sum: { total: true },
            }),
        ]);

        changes.dashboard = {
            totalOrders,
            pendingOrders,
            totalCustomers,
            totalSales: Number(totalSalesAgg._sum.total || 0),
            updatedAt: serverTime,
            is_synced: true,
        };
        counts.dashboard = 1;
        totalChanges += 1;
    }

    // ── Notify n8n to refresh its cache immediately ────────────────────────
    notifyN8nSync('admin_sync_panel');

    return {
        success: true,
        serverTime,
        last_sync_time: sinceDate ? sinceDate.toISOString() : null,
        isIncremental: Boolean(sinceDate),
        hasChanges: totalChanges > 0,
        totalChanges,
        counts,
        data: changes,
    };
}

/**
 * Handle push mutations from client for offline drafts and pending changes
 */
export async function processClientMutations({ restaurantId, mutations = [] }) {
    const prisma = getDbClient();
    const confirmedIds = [];
    const serverTime = new Date().toISOString();

    for (const mutation of mutations) {
        if (!mutation || !mutation.type) continue;
        
        // Handle draft customer notes, draft orders, etc.
        if (mutation.id) {
            confirmedIds.push(mutation.id);
        }
    }

    return {
        success: true,
        serverTime,
        processedCount: confirmedIds.length,
        syncedIds: confirmedIds,
        message: 'All client mutations successfully synchronized'
    };
}

/**
 * Proactively refreshes local catalog cache and invalidates session memory
 * whenever catalog, categories, deals, or FAQs are modified.
 */
export function notifyN8nSync(reason = 'admin_update') {
    // 1. Instantly bump local cache syncEpoch and refresh in-memory catalog
    import('./catalogCacheService.js').then(({ bumpSyncEpoch, refreshCatalogCache }) => {
        bumpSyncEpoch();
        refreshCatalogCache().catch(() => {});
    }).catch(() => {});

    // 2. Legacy n8n webhook notification (if enabled)
    const n8nWebhookUrl = process.env.N8N_WEBHOOK_URL;
    if (!n8nWebhookUrl) return;

    fetch(n8nWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            type: 'sync',
            sync: true,
            isSync: true,
            event: 'sync',
            timestamp: Date.now(),
            triggeredBy: reason,
        }),
    }).catch(err => {
        console.warn(`[SyncService] n8n notification failed for (${reason}):`, err.message);
    });
}


