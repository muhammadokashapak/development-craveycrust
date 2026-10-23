/**
 * ╔══════════════════════════════════════════╗
 * ║   Prisma Seed — prisma/seed.js           ║
 * ║   Seeds initial development data.        ║
 * ║   Run with: npm run db:seed              ║
 * ║   SAFE: uses upsert — idempotent.        ║
 * ╚══════════════════════════════════════════╝
 *
 * WARNING: Do NOT run in production unless you explicitly want
 * to reset to sample data. This is for development/staging only.
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
    console.log('🌱 Starting database seed...\n');

    // ── Restaurant ────────────────────────────────────────────
    let restaurant = await prisma.restaurant.findFirst({
        where: { slug: 'cravey-crust' }
    });
    if (!restaurant) {
        restaurant = await prisma.restaurant.upsert({
            where: { slug: 'store-admin' },
            update: {},
            create: {
                name: 'Store Admin',
                slug: 'store-admin',
                phone: '+92-300-0000000',
                address: 'Main Boulevard',
                currency: 'PKR',
                timezone: 'Asia/Karachi',
                opening_time: '10:00',
                closing_time: '23:00',
                min_order: 0,
                default_delivery_fee: 0,
                cod_enabled: true,
                easypaisa_enabled: false,
                easypaisa_number: null,
                account_name: 'Store Admin',
                is_active: true,
            },
        });
    }
    console.log(`✅ Restaurant: ${restaurant.name} (${restaurant.id})`);

    // ── Admin Users (Super Admin & Admin / Staff) ────────────
    const superadminPass = process.env.SUPERADMIN_PASS || process.env.SUPER_ADMIN_PASS || 'superadmin123';
    const adminPass = process.env.DASHBOARD_PASS || process.env.ADMIN_PASS || 'admin123';
    const superadminEmail = process.env.SUPERADMIN_USER || 'superadmin@craveycrust.com';
    const adminEmail = process.env.DASHBOARD_USER || 'admin@craveycrust.com';

    const superadmin_hash = await bcrypt.hash(superadminPass, 12);
    const admin_hash = await bcrypt.hash(adminPass, 12);

    const superAdminUser = await prisma.adminUser.upsert({
        where: { email: superadminEmail.includes('@') ? superadminEmail : `${superadminEmail}@craveycrust.com` },
        update: {
            role: 'SUPER_ADMIN',
            password_hash: superadmin_hash,
        },
        create: {
            restaurant_id: restaurant.id,
            username: superadminEmail.includes('@') ? superadminEmail.split('@')[0] : superadminEmail,
            email: superadminEmail.includes('@') ? superadminEmail : `${superadminEmail}@craveycrust.com`,
            password_hash: superadmin_hash,
            role: 'SUPER_ADMIN',
            is_active: true,
        },
    });
    console.log(`✅ Super Admin: ${superAdminUser.username} (${superAdminUser.email})`);

    const adminUser = await prisma.adminUser.upsert({
        where: { email: adminEmail.includes('@') ? adminEmail : `${adminEmail}@craveycrust.com` },
        update: {
            role: 'ADMIN',
            password_hash: admin_hash,
        },
        create: {
            restaurant_id: restaurant.id,
            username: adminEmail.includes('@') ? adminEmail.split('@')[0] : adminEmail,
            email: adminEmail.includes('@') ? adminEmail : `${adminEmail}@craveycrust.com`,
            password_hash: admin_hash,
            role: 'ADMIN',
            is_active: true,
        },
    });
    console.log(`✅ Admin / Branch Manager: ${adminUser.username} (${adminUser.email})`);

    // ── Restaurant Settings ───────────────────────────────────
    const settings = [
        { key: 'whatsapp_greeting', value: 'Assalam o Alaikum! Khush amdeed 🍔' },
        { key: 'order_number_prefix', value: 'ORD' },
        { key: 'session_timeout_minutes', value: '15' },
        { key: 'max_items_per_order', value: '20' },
    ];

    for (const setting of settings) {
        await prisma.restaurantSetting.upsert({
            where: { restaurant_id_key: { restaurant_id: restaurant.id, key: setting.key } },
            update: {},
            create: { restaurant_id: restaurant.id, ...setting },
        });
    }
    console.log(`✅ Restaurant settings: ${settings.length} seeded`);

    // ── Seed Complete Live Cravey Crust Menu, Deals, and Categories ──────
    const existingMenuCount = await prisma.menuItem.count();
    if (existingMenuCount === 0) {
        console.log('🌱 No menu items found, seeding initial Cravey Crust menu & deals...');
        const { populateFullMenu } = await import('../scripts/populate_user_menu.js');
        await populateFullMenu({ skipClean: true });
    } else {
        console.log(`ℹ️ Preserving existing ${existingMenuCount} menu items in database (wipe skipped on seed/restart).`);
    }

    console.log('\n🌱 Seed complete!\n');
    console.log('═══════════════════════════════════════════════');
    console.log(`  Restaurant: ${restaurant.name}`);
    console.log(`  Restaurant ID: ${restaurant.id}`);
    console.log(`  Super Admin: ${superAdminUser.email} (configured via SUPERADMIN_PASS)`);
    console.log(`  Admin login: ${adminUser.email} (configured via DASHBOARD_PASS)`);
    console.log('  ⚠️  Keep environment variables secure on your server!');
    console.log('═══════════════════════════════════════════════\n');
}

main()
    .catch((err) => {
        console.error('Seed failed:', err);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
