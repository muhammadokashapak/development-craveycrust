/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║   Wipe Entire Database Script                                ║
 * ║   scripts/wipe_entire_database.js                            ║
 * ║   Completely cleans all menu items, categories, deals,       ║
 * ║   orders, customers, delivery areas, and FAQs.               ║
 * ║   Keeps AdminUser and Restaurant intact for dashboard login. ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import { getDbClient } from '../src/db/client.js';
import { refreshCatalogCache } from '../src/services/catalogCacheService.js';

async function wipeDatabase() {
    console.log('🧹 Starting complete database wipe...');
    const prisma = getDbClient();
    if (!prisma) {
        throw new Error('Database client could not be initialized.');
    }

    // Unlink customer from sessions/carts to prevent FK constraint errors
    await prisma.conversationSession.updateMany({
        data: {
            pending_order_id: null,
            pending_cancel_order_id: null,
        },
    }).catch(() => {});

    await prisma.cart.updateMany({
        data: { customer_id: null },
    }).catch(() => {});

    // 1. Delete cart & deals items
    console.log('  - Deleting cart items & deal items...');
    await prisma.cartItem.deleteMany({});
    await prisma.cart.deleteMany({});
    await prisma.dealItem.deleteMany({});
    await prisma.deal.deleteMany({});

    // 2. Delete order items, history & orders
    console.log('  - Deleting orders & order history...');
    await prisma.orderItem.deleteMany({});
    await prisma.orderStatusHistory.deleteMany({});
    await prisma.order.deleteMany({});

    // 3. Delete menu variants, menu items & categories
    console.log('  - Deleting menu items, variants & categories...');
    await prisma.menuVariant.deleteMany({});
    await prisma.menuItem.deleteMany({});
    await prisma.category.deleteMany({});

    // 4. Delete promotions, delivery areas & FAQs
    console.log('  - Deleting delivery areas, promotions & FAQs...');
    await prisma.promotion.deleteMany({});
    await prisma.deliveryArea.deleteMany({});
    await prisma.fAQ.deleteMany({});
    await prisma.fAQCategory.deleteMany({});

    // 5. Delete sessions, customers, chats
    console.log('  - Deleting customers & sessions...');
    await prisma.conversationSession.deleteMany({});
    await prisma.customer.deleteMany({});
    await prisma.chatMessage.deleteMany({});
    await prisma.processedMessage.deleteMany({});

    // Refresh memory cache
    await refreshCatalogCache();

    console.log('\n✨ Database is completely CLEAN & EMPTY!');
    console.log('   - Menu Items: 0');
    console.log('   - Categories: 0');
    console.log('   - Deals: 0');
    console.log('   - Orders: 0');
    console.log('   - Customers: 0');
    console.log('   - Delivery Areas: 0');
    console.log('   - FAQs: 0');
    console.log('   (Admin logins & Restaurant profile remain intact).\n');
}

wipeDatabase()
    .catch((err) => {
        console.error('❌ Failed to wipe database:', err);
        process.exit(1);
    })
    .finally(() => {
        const prisma = getDbClient();
        if (prisma) prisma.$disconnect();
    });
