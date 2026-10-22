/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║   Populate Complete Cravey Crust Google Maps Menu & Deals    ║
 * ║   scripts/populate_google_maps_menu.js                       ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Populates ALL items, categories, variants, and deals directly from
 * the official Cravey Crust Google Maps menu cards.
 */

import { getDbClient } from '../src/db/client.js';
import { getDefaultRestaurantId } from '../src/services/restaurantService.js';
import { refreshCatalogCache } from '../src/services/catalogCacheService.js';

async function populateFullMenu() {
    console.log('🚀 Starting complete Cravey Crust Google Maps menu population...');
    const prisma = getDbClient();
    if (!prisma) {
        throw new Error('Database client could not be initialized.');
    }

    const restaurantId = await getDefaultRestaurantId();
    const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId } });
    console.log(`📌 Target Restaurant: "${restaurant?.name}" (ID: ${restaurantId})`);

    // ── 0. Update Restaurant Profile & Settings from Menu Card ─────────────────
    await prisma.restaurant.update({
        where: { id: restaurantId },
        data: {
            name: 'Cravey Crust',
            phone: '03301233927',
            address: 'Cravey Crust, Phase 4-B Phase 5, Nearby AQ Khan School, Ghauri Town, Islamabad',
        },
    });

    const settingsToUpdate = [
        { key: 'phone_alternate', value: '03392022339' },
        { key: 'restaurant_map_url', value: 'https://www.google.com/maps/place/Cravey+Crust/@33.6180334,73.1398525' },
        { key: 'restaurant_lat', value: '33.6180334' },
        { key: 'restaurant_lng', value: '73.1398525' },
        { key: 'website', value: 'www.craveycrust.com' },
        { key: 'instagram', value: '@craveycrust' },
    ];

    for (const s of settingsToUpdate) {
        await prisma.restaurantSetting.upsert({
            where: { restaurant_id_key: { restaurant_id: restaurantId, key: s.key } },
            create: { restaurant_id: restaurantId, key: s.key, value: s.value },
            update: { value: s.value },
        });
    }
    console.log('✅ Updated restaurant profile & settings.');

    // ── 1. Clean previous menu data ──────────────────────────────────────────
    console.log('🧹 Cleaning previous menu & deal data...');
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
            name: 'Starters',
            slug: 'starters',
            description: 'Crispy french fries, loaded cheesy fries & golden chicken nuggets',
            sort_order: 1,
        },
        {
            name: "King's Rolls",
            slug: 'kings-rolls',
            description: 'Signature freshly rolled shawarma paratha rolls with tender chicken',
            sort_order: 2,
        },
        {
            name: 'Chicken Box',
            slug: 'chicken-box',
            description: 'Fried chicken meal boxes served with hot fries, garlic sauce & buns',
            sort_order: 3,
        },
        {
            name: 'Wings',
            slug: 'wings',
            description: 'Fresh oven baked & frenzy crispy hot chicken wings',
            sort_order: 4,
        },
        {
            name: 'Platters',
            slug: 'platters',
            description: 'Value sharing platters with rolls, wings, fries and dips',
            sort_order: 5,
        },
        {
            name: 'Pastas',
            slug: 'pastas',
            description: 'Creamy Alfredo fettuccine and oven-baked crispy pasta',
            sort_order: 6,
        },
        {
            name: 'Sandwiches',
            slug: 'sandwiches',
            description: 'Crispy chicken sandwiches and stuffed chunks with fries',
            sort_order: 7,
        },
        {
            name: 'Burgers',
            slug: 'burgers',
            description: 'Juicy chicken burgers, Zinger fillet burgers and crispy patties',
            sort_order: 8,
        },
        {
            name: 'Premium Pizzas',
            slug: 'premium-pizzas',
            description: 'Extreme chicken toppings, stuffed & crown crusts and premium mozzarella',
            sort_order: 9,
        },
        {
            name: 'Classic Pizzas',
            slug: 'classic-pizzas',
            description: 'Traditional favorite pizzas loaded with rich cheese, tikka, fajita & tandoori chicken',
            sort_order: 10,
        },
        {
            name: 'Drinks',
            slug: 'drinks',
            description: 'Chilled soft drinks and purified mineral water',
            sort_order: 11,
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

    // Map to hold created MenuItems and Variants for easy deal linking
    const itemCache = {};
    const variantCache = {};

    async function addItem({ categoryName, name, slug, description, basePrice, spicyLevel = 'NONE', variants = [] }) {
        const created = await prisma.menuItem.create({
            data: {
                restaurant_id: restaurantId,
                category_id: categoryMap[categoryName],
                name,
                slug,
                description,
                base_price: basePrice,
                spicy_level: spicyLevel,
                is_available: true,
                is_active: true,
            },
        });
        itemCache[name] = created;

        if (variants && variants.length > 0) {
            for (let i = 0; i < variants.length; i++) {
                const v = variants[i];
                const createdVar = await prisma.menuVariant.create({
                    data: {
                        menu_item_id: created.id,
                        name: v.name,
                        price: v.price,
                        sort_order: i + 1,
                        is_available: true,
                    },
                });
                variantCache[`${name}_${v.name.toLowerCase()}`] = createdVar;
            }
        }
        console.log(`  ✓ Added: ${name} (Rs. ${basePrice}${variants.length > 0 ? `, ${variants.length} variants` : ''})`);
        return created;
    }

    // ── 3. Populate Category Items ────────────────────────────────────────────

    // 1. Starters
    console.log('\n🍟 Populating Starters...');
    await addItem({
        categoryName: 'Starters',
        name: 'Fries',
        slug: 'fries',
        description: 'Crispy golden salted French fries',
        basePrice: 220,
        variants: [
            { name: 'Regular', price: 220 },
            { name: 'Large', price: 320 },
        ],
    });
    await addItem({
        categoryName: 'Starters',
        name: 'Nuggets (5 Pc)',
        slug: 'nuggets-5-pc',
        description: '5 Pcs crispy fried golden chicken nuggets',
        basePrice: 399,
    });
    await addItem({
        categoryName: 'Starters',
        name: 'Loaded Fries',
        slug: 'loaded-fries',
        description: 'Combination of sauce & chicken, cheese topped with black olive & pepper',
        basePrice: 699,
    });
    await addItem({
        categoryName: 'Starters',
        name: 'Regular Fries',
        slug: 'regular-fries',
        description: 'Crispy golden salted French fries',
        basePrice: 220,
    });

    // 2. King's Rolls
    console.log("\n🌯 Populating King's Rolls...");
    await addItem({
        categoryName: "King's Rolls",
        name: 'Behari Roll',
        slug: 'behari-roll',
        description: 'Delicious freshly rolled paratha stuffed with spicy behari chicken & special sauce',
        basePrice: 599,
        spicyLevel: 'MEDIUM',
    });

    // 3. Chicken Box
    console.log('\n🍗 Populating Chicken Box...');
    await addItem({
        categoryName: 'Chicken Box',
        name: 'Junior Chicken',
        slug: 'junior-chicken',
        description: '1 pc of chicken & fries',
        basePrice: 349,
    });
    await addItem({
        categoryName: 'Chicken Box',
        name: 'Happy Box',
        slug: 'happy-box',
        description: '1 pc of chicken, 4 nuggets & fries',
        basePrice: 599,
    });
    await addItem({
        categoryName: 'Chicken Box',
        name: 'Quarter Box',
        slug: 'quarter-box',
        description: '2 pcs fresh chicken served with fries, garlic sauce & bun',
        basePrice: 699,
    });
    await addItem({
        categoryName: 'Chicken Box',
        name: 'Half Box',
        slug: 'half-box',
        description: '4 pcs fresh chicken served with fries, garlic sauce & 1 bun',
        basePrice: 1199,
    });
    await addItem({
        categoryName: 'Chicken Box',
        name: 'Chicken Piece',
        slug: 'chicken-piece',
        description: 'Crispy fried fresh chicken piece',
        basePrice: 180,
    });
    await addItem({
        categoryName: 'Chicken Box',
        name: 'Full Box',
        slug: 'full-box',
        description: '8 pcs fresh chicken served with fries, garlic sauce & 2 bun',
        basePrice: 2199,
    });

    // 4. Wings
    console.log('\n🍗 Populating Wings...');
    await addItem({
        categoryName: 'Wings',
        name: 'Oven Baked Wings',
        slug: 'oven-baked-wings',
        description: 'Fresh Oven Baked Wings Served with Garlic Sauce',
        basePrice: 599,
        variants: [
            { name: '6 Pcs', price: 599 },
            { name: '10 Pcs', price: 799 },
        ],
    });
    await addItem({
        categoryName: 'Wings',
        name: 'Hot Wings',
        slug: 'hot-wings',
        description: 'Frenzy Crispy Hot Wings Served with Garlic Sauce',
        basePrice: 599,
        spicyLevel: 'HOT',
        variants: [
            { name: '6 Pcs', price: 599 },
            { name: '10 Pcs', price: 799 },
        ],
    });

    // 5. Platters
    console.log('\n🍱 Populating Platters...');
    await addItem({
        categoryName: 'Platters',
        name: 'Premium Platter',
        slug: 'premium-platter',
        description: '4 pcs behari roll, 6 pcs options wings served with Fries & Sauce',
        basePrice: 1099,
    });
    await addItem({
        categoryName: 'Platters',
        name: 'Cheese Roll Platter',
        slug: 'cheese-roll-platter',
        description: '4 pcs behari roll, 4 arabic roll served with Fries & Sauce',
        basePrice: 1099,
    });

    // 6. Pastas
    console.log('\n🍝 Populating Pastas...');
    await addItem({
        categoryName: 'Pastas',
        name: 'Alfredo Pasta',
        slug: 'alfredo-pasta',
        description: 'Pasta combination of Alfredo fettuccine white sauce with grilled chicken, sauce with mushrooms & topped with mozzarella cheese',
        basePrice: 849,
    });
    await addItem({
        categoryName: 'Pastas',
        name: 'Crispy Pasta',
        slug: 'crispy-pasta',
        description: 'A combination of macaroni, tikka, white sauce, top sauce, chilli sauce topped with crispy & mozzarella cheese',
        basePrice: 799,
        spicyLevel: 'MEDIUM',
    });

    // 7. Sandwiches
    console.log('\n🥪 Populating Sandwiches...');
    await addItem({
        categoryName: 'Sandwiches',
        name: 'Crispy Sandwich',
        slug: 'crispy-sandwich',
        description: 'Blend of crispy chicken, lettuce cheese combination of taco sauce & sandwich bun',
        basePrice: 799,
    });
    await addItem({
        categoryName: 'Sandwiches',
        name: 'Stuffed Chunks',
        slug: 'stuffed-chunks',
        description: '4 pcs stuffed chunks served with sauce & fries',
        basePrice: 1099,
    });

    // 8. Burgers & Sides
    console.log('\n🍔 Populating Burgers...');
    await addItem({
        categoryName: 'Burgers',
        name: 'Zegy Burger',
        slug: 'zegy-burger',
        description: 'Combination of chicken patty, mayo, chilli sauce, lettuce & burger bun',
        basePrice: 399,
    });
    await addItem({
        categoryName: 'Burgers',
        name: 'Chicken Burger',
        slug: 'chicken-burger',
        description: 'Chicken filet, mayonnaise With lettuce & burger bun',
        basePrice: 499,
    });
    await addItem({
        categoryName: 'Burgers',
        name: 'Zinger Burger',
        slug: 'zinger-burger',
        description: 'Crispy crunchy spicy chicken fillet with fresh lettuce and signature mayo sauce',
        basePrice: 499,
        spicyLevel: 'MEDIUM',
    });

    // 9. Premium Pizzas
    console.log('\n🍕 Populating Premium Pizzas...');
    const premiumPizzas = [
        {
            name: 'Chicken Extreme',
            slug: 'chicken-extreme',
            description: 'A combination of 2 types of chicken, onion, green pepper with green olives & mozzarella cheese',
            basePrice: 699,
            spicyLevel: 'HOT',
            variants: [
                { name: 'Small', price: 699 },
                { name: 'Medium', price: 1399 },
                { name: 'Large', price: 1799 },
                { name: 'Party Size', price: 2799 },
            ],
        },
        {
            name: 'Peri Peri Pizza',
            slug: 'peri-peri-pizza',
            description: 'A combination of 2 types of chicken, onion, green pepper with mozzarella cheese top with peri peri sauce',
            basePrice: 699,
            spicyLevel: 'HOT',
            variants: [
                { name: 'Small', price: 699 },
                { name: 'Medium', price: 1399 },
                { name: 'Large', price: 1799 },
                { name: 'Party Size', price: 2799 },
            ],
        },
        {
            name: 'Behari Kebab Pizza',
            slug: 'behari-kebab-pizza',
            description: 'A combination of chicken chunks, onion, with mozzarella cheese top with optional sauce',
            basePrice: 699,
            spicyLevel: 'MEDIUM',
            variants: [
                { name: 'Small', price: 699 },
                { name: 'Medium', price: 1399 },
                { name: 'Large', price: 1799 },
                { name: 'Party Size', price: 2799 },
            ],
        },
        {
            name: 'Crown Crust',
            slug: 'crown-crust',
            description: 'A combination of 2 types of chicken, onion, pepper with black olives & mozzarella cheese',
            basePrice: 699,
            spicyLevel: 'MEDIUM',
            variants: [
                { name: 'Small', price: 699 },
                { name: 'Medium', price: 1399 },
                { name: 'Large', price: 1799 },
                { name: 'Party Size', price: 2799 },
            ],
        },
        {
            name: 'Stuffed Crust',
            slug: 'stuffed-crust',
            description: 'Special Chicken, Green Olives, Mushrooms, with the Crust filled with Cheese Or Kebab.',
            basePrice: 1499,
            spicyLevel: 'MEDIUM',
            variants: [
                { name: 'Medium', price: 1499 },
                { name: 'Large', price: 1999 },
                { name: 'Party Size', price: 2999 },
            ],
        },
    ];

    for (const p of premiumPizzas) {
        await addItem({
            categoryName: 'Premium Pizzas',
            name: p.name,
            slug: p.slug,
            description: p.description,
            basePrice: p.basePrice,
            spicyLevel: p.spicyLevel,
            variants: p.variants,
        });
    }

    // 10. Classic Pizzas
    console.log('\n🍕 Populating Classic Pizzas...');
    const classicPizzas = [
        {
            name: 'Cheese Lover',
            slug: 'cheese-lover',
            description: 'A joyful cheesy delight over a pizza sauce base',
            basePrice: 599,
            spicyLevel: 'MILD',
            variants: [
                { name: 'Small', price: 599 },
                { name: 'Medium', price: 1299 },
                { name: 'Large', price: 1499 },
                { name: 'Party Size', price: 2599 },
            ],
        },
        {
            name: 'Chicken Tikka',
            slug: 'chicken-tikka',
            description: 'Traditionally flavored chunks of chicken tikka with a blend of pizza sauce, onion & mozzarella cheese',
            basePrice: 599,
            spicyLevel: 'MEDIUM',
            variants: [
                { name: 'Small', price: 599 },
                { name: 'Medium', price: 1299 },
                { name: 'Large', price: 1499 },
                { name: 'Party Size', price: 2599 },
            ],
        },
        {
            name: 'Chicken Supreme',
            slug: 'chicken-supreme',
            description: 'A combination of chicken with onion, mushroom, bell pepper & black olive over a pizza sauce',
            basePrice: 599,
            spicyLevel: 'MILD',
            variants: [
                { name: 'Small', price: 599 },
                { name: 'Medium', price: 1299 },
                { name: 'Large', price: 1499 },
                { name: 'Party Size', price: 2599 },
            ],
        },
        {
            name: 'Chicken Fajita',
            slug: 'chicken-fajita',
            description: 'Divine flavored chunks of fajita chicken with a blend of pizza sauce, onion, bell peppers & mozzarella cheese',
            basePrice: 599,
            spicyLevel: 'MEDIUM',
            variants: [
                { name: 'Small', price: 599 },
                { name: 'Medium', price: 1299 },
                { name: 'Large', price: 1499 },
                { name: 'Party Size', price: 2599 },
            ],
        },
        {
            name: 'Chicken Tandori',
            slug: 'chicken-tandori',
            description: 'A combination of beef & chicken with onion, bell peppers & mozzarella cheese',
            basePrice: 599,
            spicyLevel: 'HOT',
            variants: [
                { name: 'Small', price: 599 },
                { name: 'Medium', price: 1299 },
                { name: 'Large', price: 1499 },
                { name: 'Party Size', price: 2599 },
            ],
        },
        {
            name: 'Classic Pizza',
            slug: 'classic-pizza',
            description: 'Traditional fresh baked pizza in your choice of classic flavours',
            basePrice: 599,
            spicyLevel: 'MILD',
            variants: [
                { name: 'Small', price: 599 },
                { name: 'Medium', price: 1299 },
                { name: 'Large', price: 1499 },
                { name: 'Party Size', price: 2599 },
            ],
        },
    ];

    for (const p of classicPizzas) {
        await addItem({
            categoryName: 'Classic Pizzas',
            name: p.name,
            slug: p.slug,
            description: p.description,
            basePrice: p.basePrice,
            spicyLevel: p.spicyLevel,
            variants: p.variants,
        });
    }

    // 11. Drinks
    console.log('\n🥤 Populating Drinks...');
    await addItem({
        categoryName: 'Drinks',
        name: 'Soft Drink',
        slug: 'soft-drink',
        description: 'Chilled soft drink (Pepsi / 7Up / Mirinda / Next Cola)',
        basePrice: 110,
        variants: [
            { name: 'Regular', price: 110 },
            { name: 'Can', price: 130 },
            { name: '1 Liter', price: 200 },
            { name: '1.5 Liter', price: 240 },
        ],
    });
    await addItem({
        categoryName: 'Drinks',
        name: 'Mineral Water',
        slug: 'mineral-water',
        description: 'Chilled purified mineral water bottle',
        basePrice: 70,
        variants: [
            { name: 'Regular Bottle', price: 70 },
        ],
    });

    // ── 4. Populate Deals Table (`Deal` and `DealItem`) ────────────────────────
    console.log('\n🎁 Populating Deals Table with Linked Menu Items (description: null as requested)...');

    const pizzaItem = itemCache['Classic Pizza'];
    const softDrinkItem = itemCache['Soft Drink'];
    const zingerItem = itemCache['Zinger Burger'];
    const zeggyItem = itemCache['Zegy Burger'];
    const friesItem = itemCache['Regular Fries'];
    const chickenPieceItem = itemCache['Chicken Piece'];

    const allDeals = [
        {
            name: 'Pizza Meal For 1',
            slug: 'deal-pizza-meal-for-1',
            price: 599,
            sort_order: 1,
            items: [
                { item: pizzaItem, variant: variantCache['Classic Pizza_small'], qty: 1 },
                { item: softDrinkItem, variant: variantCache['Soft Drink_regular'], qty: 1 },
            ],
        },
        {
            name: 'Pizza Meal For 2',
            slug: 'deal-pizza-meal-for-2',
            price: 1299,
            sort_order: 2,
            items: [
                { item: pizzaItem, variant: variantCache['Classic Pizza_medium'], qty: 1 },
                { item: softDrinkItem, variant: variantCache['Soft Drink_regular'], qty: 2 },
            ],
        },
        {
            name: 'Pizza Meal For 3',
            slug: 'deal-pizza-meal-for-3',
            price: 1599,
            sort_order: 3,
            items: [
                { item: pizzaItem, variant: variantCache['Classic Pizza_large'], qty: 1 },
                { item: softDrinkItem, variant: variantCache['Soft Drink_1 liter'], qty: 1 },
            ],
        },
        {
            name: 'Pizza Meal For 4',
            slug: 'deal-pizza-meal-for-4',
            price: 2499,
            sort_order: 4,
            items: [
                { item: pizzaItem, variant: variantCache['Classic Pizza_party size'], qty: 1 },
                { item: softDrinkItem, variant: variantCache['Soft Drink_1.5 liter'], qty: 1 },
            ],
        },
        {
            name: 'Burger Meal For 1',
            slug: 'deal-burger-meal-for-1',
            price: 599,
            sort_order: 5,
            items: [
                { item: zingerItem, variant: null, qty: 1 },
                { item: friesItem, variant: null, qty: 1 },
                { item: softDrinkItem, variant: variantCache['Soft Drink_regular'], qty: 1 },
            ],
        },
        {
            name: 'Burger Meal For 2',
            slug: 'deal-burger-meal-for-2',
            price: 999,
            sort_order: 6,
            items: [
                { item: zingerItem, variant: null, qty: 2 },
                { item: friesItem, variant: null, qty: 1 },
                { item: softDrinkItem, variant: variantCache['Soft Drink_regular'], qty: 2 },
            ],
        },
        {
            name: 'Burger Meal For 3',
            slug: 'deal-burger-meal-for-3',
            price: 1599,
            sort_order: 7,
            items: [
                { item: zingerItem, variant: null, qty: 3 },
                { item: chickenPieceItem, variant: null, qty: 3 },
                { item: softDrinkItem, variant: variantCache['Soft Drink_1 liter'], qty: 1 },
            ],
        },
        {
            name: 'Deal 1',
            slug: 'deal-1',
            price: 1099,
            sort_order: 8,
            items: [
                { item: pizzaItem, variant: variantCache['Classic Pizza_small'], qty: 2 },
                { item: softDrinkItem, variant: variantCache['Soft Drink_regular'], qty: 2 },
            ],
        },
        {
            name: 'Deal 2',
            slug: 'deal-2',
            price: 2099,
            sort_order: 9,
            items: [
                { item: pizzaItem, variant: variantCache['Classic Pizza_medium'], qty: 2 },
                { item: softDrinkItem, variant: variantCache['Soft Drink_1 liter'], qty: 1 },
            ],
        },
        {
            name: 'Deal 3',
            slug: 'deal-3',
            price: 2999,
            sort_order: 10,
            items: [
                { item: pizzaItem, variant: variantCache['Classic Pizza_large'], qty: 2 },
                { item: softDrinkItem, variant: variantCache['Soft Drink_1 liter'], qty: 1 },
            ],
        },
        {
            name: 'Deal 4',
            slug: 'deal-4',
            price: 999,
            sort_order: 11,
            items: [
                { item: zeggyItem, variant: null, qty: 4 },
            ],
        },
        {
            name: 'Deal 5',
            slug: 'deal-5',
            price: 1099,
            sort_order: 12,
            items: [
                { item: zingerItem, variant: null, qty: 3 },
                { item: softDrinkItem, variant: variantCache['Soft Drink_1 liter'], qty: 1 },
            ],
        },
    ];

    for (const d of allDeals) {
        const createdDeal = await prisma.deal.create({
            data: {
                restaurant_id: restaurantId,
                name: d.name,
                slug: d.slug,
                description: null, // As requested by user: description is completely removed, items are shown via DealItem
                deal_price: d.price,
                sort_order: d.sort_order,
                is_active: true,
                deal_items: {
                    create: d.items.map(m => ({
                        menu_item_id: m.item.id,
                        menu_variant_id: m.variant?.id || null,
                        quantity: m.qty,
                    })),
                },
            },
        });
        console.log(`🎁 Created Deal: ${createdDeal.name} (Rs. ${d.price}) with ${d.items.length} linked items`);
    }

    // ── 5. Refresh Catalog Cache ──────────────────────────────────────────────
    console.log('\n⚡ Refreshing in-memory catalog cache...');
    await refreshCatalogCache();

    console.log('\n🎉 ALL GOOGLE MAPS MENU ITEMS, CATEGORIES, VARIANTS & DEALS POPULATED SUCCESSFULLY!');
}

export { populateFullMenu };

// If executed directly from CLI (e.g. `node scripts/populate_google_maps_menu.js`)
if (process.argv[1] && (process.argv[1].endsWith('populate_user_menu.js') || process.argv[1].endsWith('populate_google_maps_menu.js'))) {
    populateFullMenu()
        .catch((err) => {
            console.error('❌ Failed to populate menu:', err);
            process.exit(1);
        })
        .finally(() => {
            const prisma = getDbClient();
            if (prisma) prisma.$disconnect();
        });
}
