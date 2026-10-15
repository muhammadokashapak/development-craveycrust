/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║   Seed Custom Menu, Deals, Delivery Areas, and FAQs          ║
 * ║   scripts/seed_custom_menu_and_faqs.js                       ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Replaces existing items, categories, deals, and FAQs with generic catalog.
 */

import { getDbClient } from '../src/db/client.js';
import { getDefaultRestaurantId } from '../src/services/restaurantService.js';
import { DELIVERY_AREA_COORDINATES } from '../src/services/deliveryService.js';

async function seed() {
    console.log('🚀 Starting database update for Menu, Deals, and FAQs...');
    const prisma = getDbClient();
    if (!prisma) {
        throw new Error('Database client could not be initialized.');
    }

    const restaurantId = await getDefaultRestaurantId();
    console.log(`📌 Using restaurant ID: ${restaurantId}`);

    // ── 1. Update Restaurant Settings & Info ──────────────────────────────────
    await prisma.restaurant.update({
        where: { id: restaurantId },
        data: {
            name: 'Store Admin',
            slug: 'store-admin',
            address: 'Main Street',
            opening_time: '12:00',
            closing_time: '23:00',
            min_order: 0,
            default_delivery_fee: 0,
            cod_enabled: true,
            easypaisa_enabled: false,
            easypaisa_number: null,
            account_name: 'Store Admin',
        },
    });
    console.log('✅ Restaurant details set to default Store Admin');

    // ── 2. Clean previous data ────────────────────────────────────────────────
    console.log('🧹 Cleaning previous cart items, deals, menu items, categories, and FAQs...');
    
    // Clear cart items
    await prisma.cartItem.deleteMany({
        where: { cart: { restaurant_id: restaurantId } },
    });

    // Clear deal items and deals
    await prisma.dealItem.deleteMany({
        where: { deal: { restaurant_id: restaurantId } },
    });
    await prisma.deal.deleteMany({
        where: { restaurant_id: restaurantId },
    });

    // Clear menu variants, menu items, and categories
    await prisma.menuVariant.deleteMany({
        where: { menu_item: { restaurant_id: restaurantId } },
    });
    await prisma.menuItem.deleteMany({
        where: { restaurant_id: restaurantId },
    });
    await prisma.category.deleteMany({
        where: { restaurant_id: restaurantId },
    });

    // Clear FAQs and FAQ categories
    await prisma.fAQ.deleteMany({
        where: { restaurant_id: restaurantId },
    });
    await prisma.fAQCategory.deleteMany({
        where: { restaurant_id: restaurantId },
    });

    console.log('✅ Previous catalog, deals, and FAQs deleted successfully.');

    // ── 3. Seed Free Delivery Areas (32 areas) ────────────────────────────────
    console.log('📍 Seeding 32 free delivery areas...');
    const deliveryAreasList = [
        'Taramari', 'Tarlai', 'School Stop', 'Zamna bad', 'P&V Scheme',
        'Basit town', 'Albadar Masjid', 'Ghauri Garden', 'Burma', 'Dakhana Stop',
        'Rehman Enclave', 'Sanam Chok', 'Khana Pull', 'Shakral', 'Zia Masjid',
        'Ghauri Town all phase', 'Sudran Road', 'Madina Town', 'Malik Town',
        'Marwa Town', 'Mehrban Town', 'Sarfraz town', 'Bilal town',
        'Chistiyan market', 'Gulzar e Quaid', 'Gulberg green', 'Sharifabad',
        'Zia market', 'Tali mor', 'Karachi house', 'Juma Bazar', 'Ghauri VIP'
    ];

    for (const areaName of deliveryAreasList) {
        const slug = areaName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        const coords = DELIVERY_AREA_COORDINATES[slug] || { lat: 33.6261, lng: 73.1255, radiusKm: 2.5 };
        await prisma.deliveryArea.upsert({
            where: {
                restaurant_id_slug: {
                    restaurant_id: restaurantId,
                    slug,
                },
            },
            update: {
                name: areaName,
                delivery_fee: 0,
                minimum_order: 0,
                is_active: true,
                latitude: coords.lat,
                longitude: coords.lng,
                radius_km: coords.radiusKm,
            },
            create: {
                restaurant_id: restaurantId,
                name: areaName,
                slug,
                delivery_fee: 0,
                minimum_order: 0,
                is_active: true,
                latitude: coords.lat,
                longitude: coords.lng,
                radius_km: coords.radiusKm,
            },
        });
    }
    console.log(`✅ ${deliveryAreasList.length} free delivery areas updated with accurate coordinates.`);

    // ── 4. Seed Categories ───────────────────────────────────────────────────
    console.log('📋 Creating categories...');
    const categoryDefs = [
        { name: 'Premium Pizzas', slug: 'premium-pizzas', description: 'Freshly baked dough with extreme chicken toppings, stuffed crusts and rich mozzarella', sort_order: 1 },
        { name: 'Classic Pizzas', slug: 'classic-pizzas', description: 'Traditional favorite pizzas loaded with premium mozzarella & flavorful chunks', sort_order: 2 },
        { name: 'Pizza Deals', slug: 'pizza-deals', description: 'Value pizza combo meals with chilled drinks', sort_order: 3 },
        { name: 'Burger Deals', slug: 'burger-deals', description: 'Zinger burger feast meals with fries and drinks', sort_order: 4 },
        { name: 'Special Deals', slug: 'special-deals', description: 'Special bundle deals and combo feasts', sort_order: 5 },
        { name: 'Drinks', slug: 'drinks', description: 'Chilled soft drinks and purified mineral water', sort_order: 6 },
    ];

    const categoryMap = {};
    for (const cat of categoryDefs) {
        const created = await prisma.category.create({
            data: {
                restaurant_id: restaurantId,
                name: cat.name,
                slug: cat.slug,
                description: cat.description,
                sort_order: cat.sort_order,
                is_active: true,
            },
        });
        categoryMap[cat.name] = created.id;
    }
    console.log('✅ 6 categories created.');

    // ── 5. Seed Menu Items & Variants ─────────────────────────────────────────
    console.log('🍕 Creating menu items and variants...');

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
        const createdItem = await prisma.menuItem.create({
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
                    menu_item_id: createdItem.id,
                    name: v.name,
                    price: v.price,
                    sort_order: v.sort_order,
                    is_available: true,
                },
            });
        }
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
        const createdItem = await prisma.menuItem.create({
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
                    menu_item_id: createdItem.id,
                    name: v.name,
                    price: v.price,
                    sort_order: v.sort_order,
                    is_available: true,
                },
            });
        }
    }

    // C. Pizza Deals (as Menu Items with Variant)
    const pizzaDealItems = [
        { name: 'Pizza Meal For 1', slug: 'pizza-meal-for-1', description: 'Small Pizza, Regular Drink', price: 599, variantName: 'Meal for 1' },
        { name: 'Pizza Meal For 2', slug: 'pizza-meal-for-2', description: 'Regular Pizza, 2 Regular Drink', price: 1299, variantName: 'Meal for 2' },
        { name: 'Pizza Meal For 3', slug: 'pizza-meal-for-3', description: 'Large Pizza, 1 liter Drink', price: 1599, variantName: 'Meal for 3' },
        { name: 'Pizza Meal For 4', slug: 'pizza-meal-for-4', description: 'Party size Pizza, 1.5 liter Drink', price: 2499, variantName: 'Meal for 4' },
    ];
    for (const item of pizzaDealItems) {
        const createdItem = await prisma.menuItem.create({
            data: {
                restaurant_id: restaurantId,
                category_id: categoryMap['Pizza Deals'],
                name: item.name,
                slug: item.slug,
                description: item.description,
                base_price: item.price,
                is_available: true,
                is_active: true,
            },
        });
        await prisma.menuVariant.create({
            data: {
                menu_item_id: createdItem.id,
                name: item.variantName,
                price: item.price,
                sort_order: 1,
                is_available: true,
            },
        });
    }

    // D. Burger Deals (as Menu Items with Variant)
    const burgerDealItems = [
        { name: 'Burger Meal For 1', slug: 'burger-meal-for-1', description: 'Zinger Burger, Regular Fries, Regular Drink', price: 599, variantName: 'Meal for 1' },
        { name: 'Burger Meal For 2', slug: 'burger-meal-for-2', description: '2 Zinger Burger, Regular Fries, 2 Regular Drink', price: 999, variantName: 'Meal for 2' },
        { name: 'Burger Meal For 3', slug: 'burger-meal-for-3', description: '3 Zinger Burger, 3 Chicken Piece, 1 Litre Drink', price: 1599, variantName: 'Meal for 3' },
    ];
    for (const item of burgerDealItems) {
        const createdItem = await prisma.menuItem.create({
            data: {
                restaurant_id: restaurantId,
                category_id: categoryMap['Burger Deals'],
                name: item.name,
                slug: item.slug,
                description: item.description,
                base_price: item.price,
                is_available: true,
                is_active: true,
            },
        });
        await prisma.menuVariant.create({
            data: {
                menu_item_id: createdItem.id,
                name: item.variantName,
                price: item.price,
                sort_order: 1,
                is_available: true,
            },
        });
    }

    // E. Special Deals (as Menu Items with Variant)
    const specialDealItems = [
        { name: 'Deal 1', slug: 'deal-1', description: '2 Small Pizza, 2 Reg Drinks', price: 1099, variantName: 'Combo' },
        { name: 'Deal 2', slug: 'deal-2', description: '2 Medium Pizza, 1L Drink', price: 2099, variantName: 'Combo' },
        { name: 'Deal 3', slug: 'deal-3', description: '2 Large Pizza, 1L Drink', price: 2999, variantName: 'Combo' },
        { name: 'Deal 4', slug: 'deal-4', description: '4 Burgers', price: 999, variantName: 'Burger Feast' },
        { name: 'Deal 5', slug: 'deal-5', description: '3 Zinger Burger, 1L Drink', price: 1099, variantName: 'Burger Feast' },
    ];
    for (const item of specialDealItems) {
        const createdItem = await prisma.menuItem.create({
            data: {
                restaurant_id: restaurantId,
                category_id: categoryMap['Special Deals'],
                name: item.name,
                slug: item.slug,
                description: item.description,
                base_price: item.price,
                is_available: true,
                is_active: true,
            },
        });
        await prisma.menuVariant.create({
            data: {
                menu_item_id: createdItem.id,
                name: item.variantName,
                price: item.price,
                sort_order: 1,
                is_available: true,
            },
        });
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
        const createdItem = await prisma.menuItem.create({
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
                    menu_item_id: createdItem.id,
                    name: v.name,
                    price: v.price,
                    sort_order: v.sort_order,
                    is_available: true,
                },
            });
        }
    }

    console.log('✅ All menu items and variants created successfully.');

    // ── 6. Seed Deals in Deal Table ───────────────────────────────────────────
    console.log('🎁 Creating deals in Deals table...');
    const allDeals = [
        { name: 'Pizza Meal For 1', slug: 'deal-pizza-meal-for-1', price: 599, description: 'Small Pizza, Regular Drink', sort_order: 1 },
        { name: 'Pizza Meal For 2', slug: 'deal-pizza-meal-for-2', price: 1299, description: 'Regular Pizza, 2 Regular Drink', sort_order: 2 },
        { name: 'Pizza Meal For 3', slug: 'deal-pizza-meal-for-3', price: 1599, description: 'Large Pizza, 1 liter Drink', sort_order: 3 },
        { name: 'Pizza Meal For 4', slug: 'deal-pizza-meal-for-4', price: 2499, description: 'Party size Pizza, 1.5 liter Drink', sort_order: 4 },
        { name: 'Burger Meal For 1', slug: 'deal-burger-meal-for-1', price: 599, description: 'Zinger Burger, Regular Fries, Regular Drink', sort_order: 5 },
        { name: 'Burger Meal For 2', slug: 'deal-burger-meal-for-2', price: 999, description: '2 Zinger Burger, Regular Fries, 2 Regular Drink', sort_order: 6 },
        { name: 'Burger Meal For 3', slug: 'deal-burger-meal-for-3', price: 1599, description: '3 Zinger Burger, 3 Chicken Piece, 1 Litre Drink', sort_order: 7 },
        { name: 'Deal 1', slug: 'deal-special-1', price: 1099, description: '2 Small Pizza, 2 Reg Drinks', sort_order: 8 },
        { name: 'Deal 2', slug: 'deal-special-2', price: 2099, description: '2 Medium Pizza, 1L Drink', sort_order: 9 },
        { name: 'Deal 3', slug: 'deal-special-3', price: 2999, description: '2 Large Pizza, 1L Drink', sort_order: 10 },
        { name: 'Deal 4', slug: 'deal-special-4', price: 999, description: '4 Burgers', sort_order: 11 },
        { name: 'Deal 5', slug: 'deal-special-5', price: 1099, description: '3 Zinger Burger, 1L Drink', sort_order: 12 },
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
    }
    console.log('✅ 12 deals created in Deals table.');

    // ── 6.5. Clear Promotions & Discounts ────────────────────
    console.log('🎟️ Clearing promotions and discounts...');
    await prisma.promotionTarget.deleteMany({
        where: { promotion: { restaurant_id: restaurantId } },
    });
    await prisma.promotion.deleteMany({
        where: { restaurant_id: restaurantId },
    });
    console.log('✅ Promotions cleared.');

    // ── 7. Seed FAQ Categories & FAQs ─────────────────────────────────────────
    console.log('💡 Creating FAQ categories and FAQs...');
    const faqCategoryDefs = [
        { name: 'Bot Persona', slug: 'bot-persona', sort_order: 1 },
        { name: 'Ordering', slug: 'ordering', sort_order: 2 },
        { name: 'Delivery', slug: 'delivery', sort_order: 3 },
        { name: 'Payments', slug: 'payments', sort_order: 4 },
        { name: 'Menu', slug: 'menu', sort_order: 5 },
        { name: 'Deals', slug: 'deals', sort_order: 6 },
        { name: 'Support', slug: 'support', sort_order: 7 },
        { name: 'General', slug: 'general', sort_order: 8 },
    ];

    const faqCatMap = {};
    for (const fc of faqCategoryDefs) {
        const created = await prisma.fAQCategory.create({
            data: {
                restaurant_id: restaurantId,
                name: fc.name,
                slug: fc.slug,
                sort_order: fc.sort_order,
                is_active: true,
            },
        });
        faqCatMap[fc.name] = created.id;
    }

    const faqEntries = [
        {
            category: 'Bot Persona',
            question: 'Bot Role & Identity',
            answer: 'Tum ek friendly AI food ordering assistant ho. Main kaam WhatsApp par orders lena aur customer ki madad karna hai. Polite, helpful, aur seedhi Roman Urdu ya English mein baat karo.',
            keywords: ['who are you', 'identity', 'bot name'],
            alternative_questions: ['Aap kon hain?', 'Tumhara naam kya hai?'],
            sort_order: 1,
        },
        {
            category: 'Bot Persona',
            question: 'Bot Language, Tone & Mood Judgement Rules',
            answer: "Hamesha Roman Urdu mein jawab do (Urdu script bilkul nahi). Customer ke sath hamesha ba-adab, respectful aur polite Roman Urdu mein baat karo ('Aap / Ji / Sir / Bhai' use karo). Slangs ya ghair zaroori alfaaz BILKUL USE NA KAREIN. Naraz customer ke sath empathetic professional 'Sir/Aap' use karo. Emojis munasib andaaz mein. 'Oye' ya 'Mama' bilkul mana hai.",
            keywords: ['tone', 'language', 'polite', 'roman urdu', 'rules'],
            alternative_questions: ['Bot ki zuban kya hai?', 'Tone rules kya hain?'],
            sort_order: 2,
        },
        {
            category: 'Ordering',
            question: 'Order Taking Process (Steps 1-4)',
            answer: '1. Greeting: Polite salam aur welcome ("Walaikum Assalam! Khush aamdeed. Main aapke food order mein kaise madad kar sakta hoon?"). 2. Menu Items: Catalog se item name & price confirm karo. 3. Quantity: Hamesha confirm karo. 4. Final Confirmation: Summary do: Items, Address, Payment method, Total + Delivery. Sahi hai ya kuch add karna hai?',
            keywords: ['order process', 'how to order', 'order steps'],
            alternative_questions: ['Order kaise karun?', 'How to place order?'],
            sort_order: 3,
        },
        {
            category: 'Ordering',
            question: 'Order Confirmation, Order ID & Kitchen Alert (Step 5)',
            answer: 'Jab customer order confirm kar de: Order ID share karo ("Shukriya! Aap ka order #CC-1024 confirm ho gaya hai. Delivery 30-45 minute mein pahunch jayegi. Garma garam aur lazeez khana deliver hoga!"). Chat par "New Order" label lagao. System message bhejo: "KITCHEN ALERT: Naya order aya hai. [Order ID] - [Items] - [Address] - [Total]".',
            keywords: ['order confirmation', 'order id', 'delivery time', 'kitchen alert', '30-45 minute'],
            alternative_questions: ['Order kitni dair mein pohnchta hai?', 'Delivery kitni dair mein hogi?'],
            sort_order: 4,
        },
        {
            category: 'Delivery',
            question: 'Free Delivery Areas List',
            answer: 'Free delivery areas: Taramari, Tarlai, School Stop, Zamna bad, P&V Scheme, Basit town, Albadar Masjid, Ghauri Garden, Burma, Dakhana Stop, Rehman Enclave, Sanam Chok, Khana Pull, Shakral, Zia Masjid, Ghauri Town all phase, Sudran Road, Madina Town, Malik Town, Marwa Town, Mehrban Town, Sarfraz town, Bilal town, Chistiyan market, Gulzar e Quaid, Gulberg green, Sharifabad, Zia market, Tali mor, Karachi house, Juma Bazar, Ghauri VIP.',
            keywords: ['free delivery', 'delivery areas', 'free delivery areas', 'coverage areas', 'taramari'],
            alternative_questions: ['Free delivery kin ilaqon mein hai?', 'Where do you deliver for free?', 'Kahan kahan deliver karte ho?'],
            sort_order: 5,
        },
        {
            category: 'Delivery',
            question: 'Delivery Location Check & Handoff Rules',
            answer: '1. Exact Match: Delivery FREE hai ("Aray wah! [Area Name] toh hamara hi ilaqa hai. Delivery free hai, order confirm kar deta hun"). 2. Milta Julta Naam: Cross-verify karo ("Ji, aap ka matlab [Sahi Area Name] hai na?"). 3. Out of Area: Ghauri Town se 10KM radius tak delivery hai, bahar extra charges lagenge. 4. Location Handoff: Agar bahar ho ya unclear ho, "Confirm Location" label lagao aur team ko handoff karo.',
            keywords: ['delivery charges', 'radius', '10km', 'location check', 'delivery fee'],
            alternative_questions: ['Delivery ke charges kya hain?', 'Is delivery free?', 'Delivery fee kitni hai?'],
            sort_order: 6,
        },
        {
            category: 'Payments',
            question: 'Payment Methods & EasyPaisa Details',
            answer: 'Payment options: Cash on Delivery (COD) ya advance EasyPaisa. Customer se poocho: "Aap Cash on Delivery karenge ya Easypaisa se advance? EasyPaisa number hai: 03434919319 (Muhammad Shoaib)."',
            keywords: ['payment', 'payment methods', 'easypaisa', 'cod', 'cash on delivery', 'advance payment', '03434919319', 'muhammad shoaib'],
            alternative_questions: ['Payment kaise karein?', 'EasyPaisa number kya hai?', 'Do you accept Cash on Delivery?'],
            sort_order: 7,
        },
        {
            category: 'Menu',
            question: 'Menu & Catalog Inquiries',
            answer: 'Hamara menu dekhne ke liye WhatsApp par "Menu" ya "Deals" likhein. Aap direct items bhi order kar sakte hain (e.g. 2 Zinger Burger ya 1 Cheese Lover Pizza).',
            keywords: ['menu', 'catalog', 'popular items', 'food menu'],
            alternative_questions: ['Menu dikhao', 'Catalog kahan hai?', 'What do you recommend?'],
            sort_order: 8,
        },
        {
            category: 'Deals',
            question: 'Offers & Deals Policy',
            answer: 'Hamari special discount deals dekhne ke liye "Deals" reply karein. Hamare paas Pizza Deals, Burger Deals aur Special Deals dastiyab hain!',
            keywords: ['deals', 'offers', 'discount', 'promotions', 'special deals'],
            alternative_questions: ['Koi deal hai?', 'Are there any discounts?', 'Offers kya hain?'],
            sort_order: 9,
        },
        {
            category: 'Support',
            question: 'Customer Reviews & Google Maps Feedback Link',
            answer: 'Hamare khane aur service ka review dene ke liye ye rahi hamari Google review link: https://maps.app.goo.gl/rVvANx8pRmtXrEMj9. Aap ka feedback hamare liye bohat qeemti hai!',
            keywords: ['review', 'feedback', 'google maps', 'rating', 'stars', 'maps review'],
            alternative_questions: ['Review kahan doon?', 'Google review link?', 'How to rate?'],
            sort_order: 10,
        },
        {
            category: 'Support',
            question: 'Human Handoff Triggers & Escalation Protocol',
            answer: 'Agar aapko kisi maslay par restaurant team se baat karni hai toh "Agent" ya "Human" likhein, hamara representative foran rabta karega.',
            keywords: ['human handoff', 'complaint', 'manager', 'shikayat', 'refund', 'escalation'],
            alternative_questions: ['Manager se baat karni hai', 'Complaint karni hai', 'Talk to human agent'],
            sort_order: 11,
        },
        {
            category: 'General',
            question: 'Business Information & Restaurant Timings',
            answer: 'Business Name: Store. Timings: rozana open. Delivery Charges: Qabil-e-delivery areas mein bilkul FREE, bahar extra charges.',
            keywords: ['timing', 'restaurant address', 'restaurant location', 'opening time', 'closing time', 'business hours'],
            alternative_questions: ['Restaurant kab khulta hai?', 'Address kya hai?', 'What are opening hours?'],
            sort_order: 12,
        },
        {
            category: 'General',
            question: 'Bot Quick FAQs & Standard Answers',
            answer: 'Timing: "Hum rozana 4:00 PM se 2:00 AM tak open hote hain. Jab bhi zaroorat ho, zaroor rabta karein." Delivery charge: "Qabil-e-delivery areas mein delivery bilkul free hai!" Kahan deliver karte hain: "Hum Ghouri Town se 10KM radius mein deliver karte hain. Aap ka area kaunsa hai? Main check kar deta hun." Menu: Catalog link do. Reviews: Google review link share karo.',
            keywords: ['quick faqs', 'faq answers', 'radius 10km'],
            alternative_questions: ['Quick information', 'General sawal'],
            sort_order: 13,
        },
    ];

    for (const faq of faqEntries) {
        await prisma.fAQ.create({
            data: {
                restaurant_id: restaurantId,
                category_id: faqCatMap[faq.category],
                question: faq.question,
                answer: faq.answer,
                keywords: faq.keywords,
                alternative_questions: faq.alternative_questions,
                sort_order: faq.sort_order,
                is_active: true,
                language: 'ur-roman',
            },
        });
    }

    console.log('✅ 13 FAQs created successfully across 8 FAQ categories.');
    console.log('🎉 Database seeding complete!');
}

export { seed as seedCustomMenuAndFaqs };

if (process.argv[1] && process.argv[1].includes('seed_custom_menu_and_faqs.js')) {
    seed()
        .then(() => process.exit(0))
        .catch((err) => {
            console.error('❌ Seeding failed:', err);
            process.exit(1);
        });
}
