import { getDbClient } from '../src/db/client.js';
import { refreshCatalogCache } from '../src/services/catalogCacheService.js';

async function linkDealItems() {
    const prisma = getDbClient();
    if (!prisma) {
        console.error('Database client not available');
        process.exit(1);
    }

    const rest = await prisma.restaurant.findFirst({
        where: { is_active: true, slug: 'cravey-crust' },
    }) || await prisma.restaurant.findFirst();

    if (!rest) {
        console.error('No active restaurant found');
        process.exit(1);
    }

    const restaurantId = rest.id;
    console.log(`Using restaurant: ${rest.name} (${restaurantId})`);

    // 1. Ensure "Burgers & Sides" Category exists
    let burgerCat = await prisma.category.findFirst({
        where: { restaurant_id: restaurantId, name: 'Burgers & Sides' },
    });
    if (!burgerCat) {
        burgerCat = await prisma.category.create({
            data: {
                restaurant_id: restaurantId,
                name: 'Burgers & Sides',
                slug: 'burgers-sides',
                description: 'Crispy Zinger Burgers, Zeggy Burgers, golden fries & sides',
                sort_order: 3,
                is_active: true,
            },
        });
        console.log('✅ Created category: Burgers & Sides');
    }

    // 2. Ensure "Classic Pizzas" Category
    const classicPizzaCat = await prisma.category.findFirst({
        where: { restaurant_id: restaurantId, name: 'Classic Pizzas' },
    });

    // 3. Helper to get or create a MenuItem
    async function getOrCreateMenuItem(catId, name, slug, description, basePrice, variants = []) {
        let item = await prisma.menuItem.findFirst({
            where: { restaurant_id: restaurantId, name },
            include: { variants: true },
        });

        if (!item) {
            item = await prisma.menuItem.create({
                data: {
                    restaurant_id: restaurantId,
                    category_id: catId,
                    name,
                    slug,
                    description,
                    base_price: basePrice,
                    is_active: true,
                    is_available: true,
                    variants: variants.length > 0 ? {
                        create: variants.map((v, idx) => ({
                            name: v.name,
                            price: v.price,
                            sort_order: idx + 1,
                            is_available: true,
                        })),
                    } : undefined,
                },
                include: { variants: true },
            });
            console.log(`✅ Created MenuItem: ${name}`);
        }
        return item;
    }

    // Create Burger & Side items
    const zingerBurger = await getOrCreateMenuItem(burgerCat.id, 'Zinger Burger', 'zinger-burger', 'Crispy spicy chicken fillet with lettuce & mayo', 350);
    const zeggyBurger = await getOrCreateMenuItem(burgerCat.id, 'Zeggy Burger', 'zeggy-burger', 'Classic tender chicken patty burger', 250);
    const regularFries = await getOrCreateMenuItem(burgerCat.id, 'Regular Fries', 'regular-fries', 'Crispy golden salted French fries', 180);
    const chickenPiece = await getOrCreateMenuItem(burgerCat.id, 'Chicken Piece', 'chicken-piece', 'Crispy fried chicken piece', 180);

    // Create / Get Classic Pizza item with 4 sizes
    const classicPizza = await getOrCreateMenuItem(
        classicPizzaCat.id,
        'Classic Pizza',
        'classic-pizza',
        'Traditional fresh baked pizza in your choice of classic flavours',
        599,
        [
            { name: 'Small', price: 599 },
            { name: 'Medium', price: 1299 },
            { name: 'Large', price: 1499 },
            { name: 'Party Size', price: 2599 },
        ]
    );

    const pizzaVariants = {};
    for (const v of classicPizza.variants) {
        pizzaVariants[v.name.toLowerCase()] = v.id;
    }

    // Get Soft Drink
    const softDrink = await prisma.menuItem.findFirst({
        where: { restaurant_id: restaurantId, name: 'Soft Drink' },
        include: { variants: true },
    });
    const drinkVariants = {};
    for (const v of softDrink.variants) {
        drinkVariants[v.name.toLowerCase()] = v.id;
    }

    // Deal Items Mapping definition
    const dealMappings = [
        {
            name: 'Pizza Meal For 1',
            items: [
                { item: classicPizza, variantId: pizzaVariants['small'], qty: 1 },
                { item: softDrink, variantId: drinkVariants['regular'], qty: 1 },
            ],
        },
        {
            name: 'Pizza Meal For 2',
            items: [
                { item: classicPizza, variantId: pizzaVariants['medium'], qty: 1 },
                { item: softDrink, variantId: drinkVariants['regular'], qty: 2 },
            ],
        },
        {
            name: 'Pizza Meal For 3',
            items: [
                { item: classicPizza, variantId: pizzaVariants['large'], qty: 1 },
                { item: softDrink, variantId: drinkVariants['1 liter'], qty: 1 },
            ],
        },
        {
            name: 'Pizza Meal For 4',
            items: [
                { item: classicPizza, variantId: pizzaVariants['party size'], qty: 1 },
                { item: softDrink, variantId: drinkVariants['1.5 liter'], qty: 1 },
            ],
        },
        {
            name: 'Burger Meal For 1',
            items: [
                { item: zingerBurger, variantId: null, qty: 1 },
                { item: regularFries, variantId: null, qty: 1 },
                { item: softDrink, variantId: drinkVariants['regular'], qty: 1 },
            ],
        },
        {
            name: 'Burger Meal For 2',
            items: [
                { item: zingerBurger, variantId: null, qty: 2 },
                { item: regularFries, variantId: null, qty: 1 },
                { item: softDrink, variantId: drinkVariants['regular'], qty: 2 },
            ],
        },
        {
            name: 'Burger Meal For 3',
            items: [
                { item: zingerBurger, variantId: null, qty: 3 },
                { item: chickenPiece, variantId: null, qty: 3 },
                { item: softDrink, variantId: drinkVariants['1 liter'], qty: 1 },
            ],
        },
        {
            name: 'Deal 1',
            items: [
                { item: classicPizza, variantId: pizzaVariants['small'], qty: 2 },
                { item: softDrink, variantId: drinkVariants['regular'], qty: 2 },
            ],
        },
        {
            name: 'Deal 2',
            items: [
                { item: classicPizza, variantId: pizzaVariants['medium'], qty: 2 },
                { item: softDrink, variantId: drinkVariants['1 liter'], qty: 1 },
            ],
        },
        {
            name: 'Deal 3',
            items: [
                { item: classicPizza, variantId: pizzaVariants['large'], qty: 2 },
                { item: softDrink, variantId: drinkVariants['1 liter'], qty: 1 },
            ],
        },
        {
            name: 'Deal 4',
            items: [
                { item: zeggyBurger, variantId: null, qty: 4 },
            ],
        },
        {
            name: 'Deal 5',
            items: [
                { item: zingerBurger, variantId: null, qty: 3 },
                { item: softDrink, variantId: drinkVariants['1 liter'], qty: 1 },
            ],
        },
    ];

    // Link each deal
    for (const mapping of dealMappings) {
        const deal = await prisma.deal.findFirst({
            where: { restaurant_id: restaurantId, name: mapping.name },
        });

        if (!deal) {
            console.warn(`⚠️ Deal '${mapping.name}' not found`);
            continue;
        }

        // Clear existing deal items
        await prisma.dealItem.deleteMany({ where: { deal_id: deal.id } });

        // Insert new deal items
        await prisma.dealItem.createMany({
            data: mapping.items.map(m => ({
                deal_id: deal.id,
                menu_item_id: m.item.id,
                menu_variant_id: m.variantId || null,
                quantity: m.qty,
            })),
        });

        console.log(`🎁 Linked items for '${deal.name}': ${mapping.items.length} items`);
    }

    // Refresh cache
    await refreshCatalogCache();
    console.log('🎉 ALL 12 DEALS LINKED TO ACTUAL MENU ITEMS SUCCESSFULLY!');
}

linkDealItems()
    .catch(err => {
        console.error('Error linking deal items:', err);
        process.exit(1);
    })
    .finally(() => {
        const prisma = getDbClient();
        if (prisma) prisma.$disconnect();
    });
