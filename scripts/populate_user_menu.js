/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║   Populate Complete Restaurant Menu & Deals Catalog          ║
 * ║   scripts/populate_user_menu.js                              ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import { getDbClient } from '../src/db/client.js';
import { getDefaultRestaurantId } from '../src/services/restaurantService.js';
import { slugify } from '../src/utils/slugify.js';

async function populateMenu() {
    console.log('🚀 Starting menu & deals population...');
    const prisma = getDbClient();
    if (!prisma) {
        throw new Error('Database client could not be initialized.');
    }

    const restaurantId = await getDefaultRestaurantId();
    const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId } });
    console.log(`📌 Target Restaurant: "${restaurant?.name}" (ID: ${restaurantId})`);

    // ── 1. Clean existing menu data (cart items, deals, variants, items, categories) ──
    console.log('🧹 Cleaning previous menu data...');
    await prisma.cartItem.deleteMany({
        where: { cart: { restaurant_id: restaurantId } },
    });
    await prisma.dealItem.deleteMany({
        where: { deal: { restaurant_id: restaurantId } },
    });
    await prisma.deal.deleteMany({
        where: { restaurant_id: restaurantId },
    });
    await prisma.menuVariant.deleteMany({
        where: { menu_item: { restaurant_id: restaurantId } },
    });
    await prisma.menuItem.deleteMany({
        where: { restaurant_id: restaurantId },
    });
    await prisma.category.deleteMany({
        where: { restaurant_id: restaurantId },
    });
    console.log('✅ Cleaned previous menu & deals data.');

    // ── 2. Categories ────────────────────────────────────────────────────────
    const categoriesData = [
        {
            name: 'Premium Pizzas',
            slug: 'premium-pizzas',
            description: 'Freshly baked dough with extreme chicken toppings, stuffed & crown crusts and premium mozzarella',
            sort_order: 1,
        },
        {
            name: 'Classic Pizzas',
            slug: 'classic-pizzas',
            description: 'Traditional favorite pizzas loaded with rich cheese, tikka, fajita & tandoori chicken',
            sort_order: 2,
        },
        {
            name: 'Pizza Deals',
            slug: 'pizza-deals',
            description: 'Value pizza combo meals with chilled drinks',
            sort_order: 3,
        },
        {
            name: 'Burger Deals',
            slug: 'burger-deals',
            description: 'Zinger burger meals with fries and chilled drinks',
            sort_order: 4,
        },
        {
            name: 'Cravey 2.0 Deals',
            slug: 'cravey-2-0-deals',
            description: 'Special combo feasts and burger feasts',
            sort_order: 5,
        },
        {
            name: 'Drinks',
            slug: 'drinks',
            description: 'Chilled soft drinks and purified mineral water',
            sort_order: 6,
        },
    ];

    const categoryMap = {};
    for (const cat of categoriesData) {
        const createdCat = await prisma.category.create({
            data: {
                restaurant_id: restaurantId,
                name: cat.name,
                slug: cat.slug,
                description: cat.description,
                sort_order: cat.sort_order,
                is_active: true,
            },
        });
        categoryMap[cat.name] = createdCat.id;
        console.log(`📁 Category created: ${createdCat.name}`);
    }

    // ── 3. Menu Items & Variants ─────────────────────────────────────────────

    // A. Premium Pizzas
    const premiumPizzas = [
        {
            name: 'Chicken Extreme',
            slug: 'chicken-extreme',
            description: 'Freshly baked dough with extreme chicken toppings & mozzarella cheese',
            base_price: 699,
            spicy_level: 'HOT',
            variants: [
                { name: 'Small', price: 699, sort_order: 1 },
                { name: 'Medium', price: 1399, sort_order: 2 },
                { name: 'Large', price: 1799, sort_order: 3 },
                { name: 'Party Size', price: 2799, sort_order: 4 },
            ],
        },
        {
            name: 'Peri Peri Pizza',
            slug: 'peri-peri-pizza',
            description: 'Spicy peri peri marinated chicken, onions, peppers & mozzarella',
            base_price: 699,
            spicy_level: 'HOT',
            variants: [
                { name: 'Small', price: 699, sort_order: 1 },
                { name: 'Medium', price: 1399, sort_order: 2 },
                { name: 'Large', price: 1799, sort_order: 3 },
                { name: 'Party Size', price: 2799, sort_order: 4 },
            ],
        },
        {
            name: 'Behari Kebab Pizza',
            slug: 'behari-kebab-pizza',
            description: 'Traditional behari chicken kebab chunks, onions & special sauce',
            base_price: 699,
            spicy_level: 'MEDIUM',
            variants: [
                { name: 'Small', price: 699, sort_order: 1 },
                { name: 'Medium', price: 1399, sort_order: 2 },
                { name: 'Large', price: 1799, sort_order: 3 },
                { name: 'Party Size', price: 2799, sort_order: 4 },
            ],
        },
        {
            name: 'Crown Crust',
            slug: 'crown-crust',
            description: 'Golden crown crust stuffed with tender chicken bites & cheese',
            base_price: 699,
            spicy_level: 'MEDIUM',
            variants: [
                { name: 'Small', price: 699, sort_order: 1 },
                { name: 'Medium', price: 1399, sort_order: 2 },
                { name: 'Large', price: 1799, sort_order: 3 },
                { name: 'Party Size', price: 2799, sort_order: 4 },
            ],
        },
        {
            name: 'Stuffed Crust',
            slug: 'stuffed-crust',
            description: 'Rich cheese & chicken kebab stuffed ring crust pizza',
            base_price: 1499,
            spicy_level: 'MEDIUM',
            variants: [
                { name: 'Medium', price: 1499, sort_order: 1 },
                { name: 'Large', price: 1999, sort_order: 2 },
                { name: 'Party Size', price: 2999, sort_order: 3 },
            ],
        },
    ];

    for (const item of premiumPizzas) {
        const created = await prisma.menuItem.create({
            data: {
                restaurant_id: restaurantId,
                category_id: categoryMap['Premium Pizzas'],
                name: item.name,
                slug: item.slug,
                description: item.description,
                base_price: item.base_price,
                spicy_level: item.spicy_level,
                is_available: true,
                is_active: true,
            },
        });
        for (const v of item.variants) {
            await prisma.menuVariant.create({
                data: {
                    menu_item_id: created.id,
                    name: v.name,
                    price: v.price,
                    sort_order: v.sort_order,
                    is_available: true,
                },
            });
        }
        console.log(`🍕 Added Premium Pizza: ${item.name} (${item.variants.length} variants)`);
    }

    // B. Classic Pizzas
    const classicPizzas = [
        {
            name: 'Cheese Lover',
            slug: 'cheese-lover',
            description: 'Rich pizza sauce loaded with premium 100% mozzarella cheese',
            base_price: 599,
            spicy_level: 'MILD',
            variants: [
                { name: 'Small', price: 599, sort_order: 1 },
                { name: 'Medium', price: 1299, sort_order: 2 },
                { name: 'Large', price: 1499, sort_order: 3 },
                { name: 'Party Size', price: 2599, sort_order: 4 },
            ],
        },
        {
            name: 'Chicken Tikka',
            slug: 'chicken-tikka',
            description: 'Traditional chicken tikka chunks, sliced onions & rich cheese',
            base_price: 599,
            spicy_level: 'MEDIUM',
            variants: [
                { name: 'Small', price: 599, sort_order: 1 },
                { name: 'Medium', price: 1299, sort_order: 2 },
                { name: 'Large', price: 1499, sort_order: 3 },
                { name: 'Party Size', price: 2599, sort_order: 4 },
            ],
        },
        {
            name: 'Chicken Supreme',
            slug: 'chicken-supreme',
            description: 'Tender chicken chunks, capsicum, black olives, mushrooms & cheese',
            base_price: 599,
            spicy_level: 'MILD',
            variants: [
                { name: 'Small', price: 599, sort_order: 1 },
                { name: 'Medium', price: 1299, sort_order: 2 },
                { name: 'Large', price: 1499, sort_order: 3 },
                { name: 'Party Size', price: 2599, sort_order: 4 },
            ],
        },
        {
            name: 'Chicken Fajita',
            slug: 'chicken-fajita',
            description: 'Mexican style marinated fajita chicken, onions & bell peppers',
            base_price: 599,
            spicy_level: 'MEDIUM',
            variants: [
                { name: 'Small', price: 599, sort_order: 1 },
                { name: 'Medium', price: 1299, sort_order: 2 },
                { name: 'Large', price: 1499, sort_order: 3 },
                { name: 'Party Size', price: 2599, sort_order: 4 },
            ],
        },
        {
            name: 'Chicken Tandori',
            slug: 'chicken-tandori',
            description: 'Smoky tandoori chicken chunks, onions & spicy tandoori sauce',
            base_price: 599,
            spicy_level: 'HOT',
            variants: [
                { name: 'Small', price: 599, sort_order: 1 },
                { name: 'Medium', price: 1299, sort_order: 2 },
                { name: 'Large', price: 1499, sort_order: 3 },
                { name: 'Party Size', price: 2599, sort_order: 4 },
            ],
        },
    ];

    for (const item of classicPizzas) {
        const created = await prisma.menuItem.create({
            data: {
                restaurant_id: restaurantId,
                category_id: categoryMap['Classic Pizzas'],
                name: item.name,
                slug: item.slug,
                description: item.description,
                base_price: item.base_price,
                spicy_level: item.spicy_level,
                is_available: true,
                is_active: true,
            },
        });
        for (const v of item.variants) {
            await prisma.menuVariant.create({
                data: {
                    menu_item_id: created.id,
                    name: v.name,
                    price: v.price,
                    sort_order: v.sort_order,
                    is_available: true,
                },
            });
        }
        console.log(`🍕 Added Classic Pizza: ${item.name} (${item.variants.length} variants)`);
    }

    // C. Pizza Deals
    const pizzaDeals = [
        {
            name: 'Pizza Meal For 1',
            slug: 'pizza-meal-for-1',
            description: 'Small Pizza, Regular Drink',
            price: 599,
            variantName: 'Meal for 1',
        },
        {
            name: 'Pizza Meal For 2',
            slug: 'pizza-meal-for-2',
            description: 'Regular Pizza, 2 Regular Drink',
            price: 1299,
            variantName: 'Meal for 2',
        },
        {
            name: 'Pizza Meal For 3',
            slug: 'pizza-meal-for-3',
            description: 'Large Pizza, 1 liter Drink',
            price: 1599,
            variantName: 'Meal for 3',
        },
        {
            name: 'Pizza Meal For 4',
            slug: 'pizza-meal-for-4',
            description: 'Party size Pizza, 1.5 liter Drink',
            price: 2499,
            variantName: 'Meal for 4',
        },
    ];

    for (const item of pizzaDeals) {
        const created = await prisma.menuItem.create({
            data: {
                restaurant_id: restaurantId,
                category_id: categoryMap['Pizza Deals'],
                name: item.name,
                slug: item.slug,
                description: item.description,
                base_price: item.price,
                spicy_level: 'NONE',
                is_available: true,
                is_active: true,
            },
        });
        await prisma.menuVariant.create({
            data: {
                menu_item_id: created.id,
                name: item.variantName,
                price: item.price,
                sort_order: 1,
                is_available: true,
            },
        });
        console.log(`🍕 Added Pizza Deal Item: ${item.name} — Rs. ${item.price}`);
    }

    // D. Burger Deals
    const burgerDeals = [
        {
            name: 'Burger Meal For 1',
            slug: 'burger-meal-for-1',
            description: 'Zinger Burger, Regular Fries, Regular Drink',
            price: 599,
            variantName: 'Meal for 1',
        },
        {
            name: 'Burger Meal For 2',
            slug: 'burger-meal-for-2',
            description: '2 Zinger Burger, Regular Fries, 2 Regular Drink',
            price: 999,
            variantName: 'Meal for 2',
        },
        {
            name: 'Burger Meal For 3',
            slug: 'burger-meal-for-3',
            description: '3 Zinger Burger, 3 Chicken Piece, 1 Litre Drink',
            price: 1599,
            variantName: 'Meal for 3',
        },
    ];

    for (const item of burgerDeals) {
        const created = await prisma.menuItem.create({
            data: {
                restaurant_id: restaurantId,
                category_id: categoryMap['Burger Deals'],
                name: item.name,
                slug: item.slug,
                description: item.description,
                base_price: item.price,
                spicy_level: 'NONE',
                is_available: true,
                is_active: true,
            },
        });
        await prisma.menuVariant.create({
            data: {
                menu_item_id: created.id,
                name: item.variantName,
                price: item.price,
                sort_order: 1,
                is_available: true,
            },
        });
        console.log(`🍔 Added Burger Deal Item: ${item.name} — Rs. ${item.price}`);
    }

    // E. Cravey 2.0 Deals
    const craveyDeals = [
        {
            name: 'Deal 1',
            slug: 'deal-1',
            description: '2 Small Pizza, 2 Reg Drinks',
            price: 1099,
            variantName: 'Combo',
        },
        {
            name: 'Deal 2',
            slug: 'deal-2',
            description: '2 Medium Pizza, 1L Drink',
            price: 2099,
            variantName: 'Combo',
        },
        {
            name: 'Deal 3',
            slug: 'deal-3',
            description: '2 Large Pizza, 1L Drink',
            price: 2999,
            variantName: 'Combo',
        },
        {
            name: 'Deal 4',
            slug: 'deal-4',
            description: '4 Zeggy Burgers',
            price: 999,
            variantName: 'Burger Feast',
        },
        {
            name: 'Deal 5',
            slug: 'deal-5',
            description: '3 Zinger Burger, 1L Drink',
            price: 1099,
            variantName: 'Burger Feast',
        },
    ];

    for (const item of craveyDeals) {
        const created = await prisma.menuItem.create({
            data: {
                restaurant_id: restaurantId,
                category_id: categoryMap['Cravey 2.0 Deals'],
                name: item.name,
                slug: item.slug,
                description: item.description,
                base_price: item.price,
                spicy_level: 'NONE',
                is_available: true,
                is_active: true,
            },
        });
        await prisma.menuVariant.create({
            data: {
                menu_item_id: created.id,
                name: item.variantName,
                price: item.price,
                sort_order: 1,
                is_available: true,
            },
        });
        console.log(`🔥 Added Cravey 2.0 Deal Item: ${item.name} — Rs. ${item.price}`);
    }

    // F. Drinks
    const drinkItems = [
        {
            name: 'Soft Drink',
            slug: 'soft-drink',
            description: 'Chilled soft drink (Pepsi / 7Up / Mirinda)',
            base_price: 110,
            spicy_level: 'NONE',
            variants: [
                { name: 'Regular', price: 110, sort_order: 1 },
                { name: 'Can', price: 130, sort_order: 2 },
                { name: '1 Liter', price: 200, sort_order: 3 },
                { name: '1.5 Liter', price: 240, sort_order: 4 },
            ],
        },
        {
            name: 'Mineral Water',
            slug: 'mineral-water',
            description: 'Chilled purified mineral water bottle',
            base_price: 70,
            spicy_level: 'NONE',
            variants: [
                { name: 'Regular Bottle', price: 70, sort_order: 1 },
            ],
        },
    ];

    for (const item of drinkItems) {
        const created = await prisma.menuItem.create({
            data: {
                restaurant_id: restaurantId,
                category_id: categoryMap['Drinks'],
                name: item.name,
                slug: item.slug,
                description: item.description,
                base_price: item.base_price,
                spicy_level: item.spicy_level,
                is_available: true,
                is_active: true,
            },
        });
        for (const v of item.variants) {
            await prisma.menuVariant.create({
                data: {
                    menu_item_id: created.id,
                    name: v.name,
                    price: v.price,
                    sort_order: v.sort_order,
                    is_available: true,
                },
            });
        }
        console.log(`🥤 Added Drink: ${item.name} (${item.variants.length} variants)`);
    }

    // ── 4. Deals in Deals Table (For Deals View & Deals WhatsApp Fast Router) ───
    console.log('🎁 Populating Deals table...');
    const allDeals = [
        { name: 'Pizza Meal For 1', slug: 'deal-pizza-meal-for-1', price: 599, description: 'Small Pizza, Regular Drink', sort_order: 1 },
        { name: 'Pizza Meal For 2', slug: 'deal-pizza-meal-for-2', price: 1299, description: 'Regular Pizza, 2 Regular Drink', sort_order: 2 },
        { name: 'Pizza Meal For 3', slug: 'deal-pizza-meal-for-3', price: 1599, description: 'Large Pizza, 1 liter Drink', sort_order: 3 },
        { name: 'Pizza Meal For 4', slug: 'deal-pizza-meal-for-4', price: 2499, description: 'Party size Pizza, 1.5 liter Drink', sort_order: 4 },
        { name: 'Burger Meal For 1', slug: 'deal-burger-meal-for-1', price: 599, description: 'Zinger Burger, Regular Fries, Regular Drink', sort_order: 5 },
        { name: 'Burger Meal For 2', slug: 'deal-burger-meal-for-2', price: 999, description: '2 Zinger Burger, Regular Fries, 2 Regular Drink', sort_order: 6 },
        { name: 'Burger Meal For 3', slug: 'deal-burger-meal-for-3', price: 1599, description: '3 Zinger Burger, 3 Chicken Piece, 1 Litre Drink', sort_order: 7 },
        { name: 'Deal 1', slug: 'deal-1', price: 1099, description: '2 Small Pizza, 2 Reg Drinks', sort_order: 8 },
        { name: 'Deal 2', slug: 'deal-2', price: 2099, description: '2 Medium Pizza, 1L Drink', sort_order: 9 },
        { name: 'Deal 3', slug: 'deal-3', price: 2999, description: '2 Large Pizza, 1L Drink', sort_order: 10 },
        { name: 'Deal 4', slug: 'deal-4', price: 999, description: '4 Zeggy Burgers', sort_order: 11 },
        { name: 'Deal 5', slug: 'deal-5', price: 1099, description: '3 Zinger Burger, 1L Drink', sort_order: 12 },
    ];

    for (const d of allDeals) {
        await prisma.deal.create({
            data: {
                restaurant_id: restaurantId,
                name: d.name,
                slug: d.slug,
                description: d.description,
                deal_price: d.price,
                sort_order: d.sort_order,
                is_active: true,
            },
        });
        console.log(`🎁 Added Deal: ${d.name} — Rs. ${d.price}`);
    }

    console.log('🎉 ALL CATEGORIES, MENU ITEMS, VARIANTS, AND DEALS POPULATED SUCCESSFULLY!');
}

populateMenu()
    .catch((err) => {
        console.error('❌ Failed to populate menu:', err);
        process.exit(1);
    })
    .finally(() => {
        const prisma = getDbClient();
        if (prisma) prisma.$disconnect();
    });
