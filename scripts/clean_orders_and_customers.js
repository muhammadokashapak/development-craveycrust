/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║   Purge All Orders & Customers Script                          ║
 * ║   Usage: node scripts/clean_orders_and_customers.js            ║
 * ║   Wipes all orders and customers completely.                   ║
 * ║   STRICT CONSTRAINT: data/customer_chats.json remains intact!  ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('🧹 Purging all orders and customers from database...');

    const result = await prisma.$transaction(async (tx) => {
        // 1. Unlink customer from carts to prevent FK errors
        const cartsUpdated = await tx.cart.updateMany({
            data: { customer_id: null },
        });

        // 2. Clear pending orders in conversation sessions
        const sessionsUpdated = await tx.conversationSession.updateMany({
            data: {
                pending_order_id: null,
                pending_cancel_order_id: null,
                stage: 'START',
            },
        });

        // 3. Delete order items & status history
        const itemsDeleted = await tx.orderItem.deleteMany({});
        const historyDeleted = await tx.orderStatusHistory.deleteMany({});

        // 4. Delete all orders
        const ordersDeleted = await tx.order.deleteMany({});

        // 5. Delete all customers
        const customersDeleted = await tx.customer.deleteMany({});

        return {
            cartsUpdated: cartsUpdated.count,
            sessionsUpdated: sessionsUpdated.count,
            itemsDeleted: itemsDeleted.count,
            historyDeleted: historyDeleted.count,
            ordersDeleted: ordersDeleted.count,
            customersDeleted: customersDeleted.count,
        };
    });

    console.log('✅ Cleanup completed successfully!');
    console.log(`   - Orders deleted: ${result.ordersDeleted}`);
    console.log(`   - Customers deleted: ${result.customersDeleted}`);
    console.log(`   - Order items deleted: ${result.itemsDeleted}`);
    console.log(`   - Order status history deleted: ${result.historyDeleted}`);
    console.log('   - Customer chats (data/customer_chats.json): 100% UNTOUCHED & INTACT.');
}

main()
    .catch((err) => {
        console.error('❌ Error during purge:', err);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
