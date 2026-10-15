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
    const restaurant = await prisma.restaurant.upsert({
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
    console.log(`✅ Restaurant: ${restaurant.name} (${restaurant.id})`);

    // ── Admin User ────────────────────────────────────────────
    const password_hash = await bcrypt.hash('admin12345', 12);

    const adminUser = await prisma.adminUser.upsert({
        where: { email: 'admin@store.com' },
        update: {},
        create: {
            restaurant_id: restaurant.id,
            username: 'admin',
            email: 'admin@store.com',
            password_hash,
            role: 'SUPER_ADMIN',
            is_active: true,
        },
    });
    console.log(`✅ Admin user: ${adminUser.username} (${adminUser.email})`);

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

    // ── Seed Complete Live Menu, Deals, Delivery Areas, and FAQs ──────
    const { seedCustomMenuAndFaqs } = await import('../scripts/seed_custom_menu_and_faqs.js');
    await seedCustomMenuAndFaqs();

    console.log('\n🌱 Seed complete!\n');
    console.log('═══════════════════════════════════════════════');
    console.log(`  Restaurant: ${restaurant.name}`);
    console.log(`  Restaurant ID: ${restaurant.id}`);
    console.log(`  Admin login: admin@store.com`);
    console.log(`  Admin password: admin12345`);
    console.log('  ⚠️  Change password before production use!');
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
