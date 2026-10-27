/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║   Fallback In-Memory Catalog — src/services/fallbackCatalog.js║
 * ║   Provides complete Cravey Crust menu, categories, deals     ║
 * ║   and delivery zones when PostgreSQL is offline / starting.  ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import { DELIVERY_AREA_COORDINATES } from './deliveryService.js';

// ─── 1. Fallback Categories ──────────────────────────────────────────────────
export const FALLBACK_CATEGORIES = [
    { id: 'cat-1', name: 'Starters', slug: 'starters', description: 'Crispy french fries, loaded cheesy fries & golden chicken nuggets', sort_order: 1, is_active: true },
    { id: 'cat-2', name: "King's Rolls", slug: 'kings-rolls', description: 'Signature freshly rolled shawarma paratha rolls with tender chicken', sort_order: 2, is_active: true },
    { id: 'cat-3', name: 'Chicken Box', slug: 'chicken-box', description: 'Fried chicken meal boxes served with hot fries, garlic sauce & buns', sort_order: 3, is_active: true },
    { id: 'cat-4', name: 'Wings', slug: 'wings', description: 'Fresh oven baked & frenzy crispy hot chicken wings', sort_order: 4, is_active: true },
    { id: 'cat-5', name: 'Platters', slug: 'platters', description: 'Value sharing platters with rolls, wings, fries and dips', sort_order: 5, is_active: true },
    { id: 'cat-6', name: 'Pastas', slug: 'pastas', description: 'Creamy Alfredo fettuccine and oven-baked crispy pasta', sort_order: 6, is_active: true },
    { id: 'cat-7', name: 'Sandwiches', slug: 'sandwiches', description: 'Crispy chicken sandwiches and stuffed chunks with fries', sort_order: 7, is_active: true },
    { id: 'cat-8', name: 'Burgers', slug: 'burgers', description: 'Juicy chicken burgers, Zinger fillet burgers and crispy patties', sort_order: 8, is_active: true },
    { id: 'cat-9', name: 'Premium Pizzas', slug: 'premium-pizzas', description: 'Extreme chicken toppings, stuffed & crown crusts and premium mozzarella', sort_order: 9, is_active: true },
    { id: 'cat-10', name: 'Classic Pizzas', slug: 'classic-pizzas', description: 'Traditional favorite pizzas loaded with rich cheese, tikka, fajita & tandoori chicken', sort_order: 10, is_active: true },
    { id: 'cat-11', name: 'Drinks', slug: 'drinks', description: 'Chilled soft drinks and purified mineral water', sort_order: 11, is_active: true },
];

// ─── 2. Fallback Menu Items with Variants ───────────────────────────────────
export const FALLBACK_MENU_ITEMS = [
    // Starters
    {
        id: 'item-1', category_id: 'cat-1', name: 'Fries', slug: 'fries',
        description: 'Crispy golden salted French fries', base_price: 220, spicy_level: 'NONE', is_available: true, is_active: true,
        variants: [{ id: 'v-1-1', name: 'Regular', price: 220 }, { id: 'v-1-2', name: 'Large', price: 320 }],
    },
    {
        id: 'item-2', category_id: 'cat-1', name: 'Nuggets (5 Pc)', slug: 'nuggets-5-pc',
        description: '5 Pcs crispy fried golden chicken nuggets', base_price: 399, spicy_level: 'NONE', is_available: true, is_active: true,
        variants: [{ id: 'v-2-1', name: 'Standard', price: 399 }],
    },
    {
        id: 'item-3', category_id: 'cat-1', name: 'Loaded Fries', slug: 'loaded-fries',
        description: 'Combination of sauce & chicken, cheese topped with black olive & pepper', base_price: 699, spicy_level: 'NONE', is_available: true, is_active: true,
        variants: [{ id: 'v-3-1', name: 'Standard', price: 699 }],
    },
    {
        id: 'item-4', category_id: 'cat-1', name: 'Regular Fries', slug: 'regular-fries',
        description: 'Crispy golden salted French fries', base_price: 220, spicy_level: 'NONE', is_available: true, is_active: true,
        variants: [{ id: 'v-4-1', name: 'Standard', price: 220 }],
    },

    // King's Rolls
    {
        id: 'item-5', category_id: 'cat-2', name: 'Behari Roll', slug: 'behari-roll',
        description: 'Delicious freshly rolled paratha stuffed with spicy behari chicken & special sauce', base_price: 599, spicy_level: 'MEDIUM', is_available: true, is_active: true,
        variants: [{ id: 'v-5-1', name: 'Standard', price: 599 }],
    },

    // Chicken Box
    {
        id: 'item-6', category_id: 'cat-3', name: 'Junior Chicken', slug: 'junior-chicken',
        description: '1 pc of chicken & fries', base_price: 349, spicy_level: 'NONE', is_available: true, is_active: true,
        variants: [{ id: 'v-6-1', name: 'Standard', price: 349 }],
    },
    {
        id: 'item-7', category_id: 'cat-3', name: 'Happy Box', slug: 'happy-box',
        description: '1 pc of chicken, 4 nuggets & fries', base_price: 599, spicy_level: 'NONE', is_available: true, is_active: true,
        variants: [{ id: 'v-7-1', name: 'Standard', price: 599 }],
    },
    {
        id: 'item-8', category_id: 'cat-3', name: 'Quarter Box', slug: 'quarter-box',
        description: '2 pcs fresh chicken served with fries, garlic sauce & bun', base_price: 699, spicy_level: 'NONE', is_available: true, is_active: true,
        variants: [{ id: 'v-8-1', name: 'Standard', price: 699 }],
    },
    {
        id: 'item-9', category_id: 'cat-3', name: 'Half Box', slug: 'half-box',
        description: '4 pcs fresh chicken served with fries, garlic sauce & 1 bun', base_price: 1199, spicy_level: 'NONE', is_available: true, is_active: true,
        variants: [{ id: 'v-9-1', name: 'Standard', price: 1199 }],
    },
    {
        id: 'item-10', category_id: 'cat-3', name: 'Chicken Piece', slug: 'chicken-piece',
        description: 'Crispy fried fresh chicken piece', base_price: 180, spicy_level: 'NONE', is_available: true, is_active: true,
        variants: [{ id: 'v-10-1', name: 'Standard', price: 180 }],
    },
    {
        id: 'item-11', category_id: 'cat-3', name: 'Full Box', slug: 'full-box',
        description: '8 pcs fresh chicken served with fries, garlic sauce & 2 bun', base_price: 2199, spicy_level: 'NONE', is_available: true, is_active: true,
        variants: [{ id: 'v-11-1', name: 'Standard', price: 2199 }],
    },

    // Wings
    {
        id: 'item-12', category_id: 'cat-4', name: 'Oven Baked Wings', slug: 'oven-baked-wings',
        description: 'Fresh Oven Baked Wings Served with Garlic Sauce', base_price: 599, spicy_level: 'NONE', is_available: true, is_active: true,
        variants: [{ id: 'v-12-1', name: '6 Pcs', price: 599 }, { id: 'v-12-2', name: '10 Pcs', price: 799 }],
    },
    {
        id: 'item-13', category_id: 'cat-4', name: 'Hot Wings', slug: 'hot-wings',
        description: 'Frenzy Crispy Hot Wings Served with Garlic Sauce', base_price: 599, spicy_level: 'HOT', is_available: true, is_active: true,
        variants: [{ id: 'v-13-1', name: '6 Pcs', price: 599 }, { id: 'v-13-2', name: '10 Pcs', price: 799 }],
    },

    // Platters
    {
        id: 'item-14', category_id: 'cat-5', name: 'Premium Platter', slug: 'premium-platter',
        description: '4 pcs behari roll, 6 pcs options wings served with Fries & Sauce', base_price: 1099, spicy_level: 'NONE', is_available: true, is_active: true,
        variants: [{ id: 'v-14-1', name: 'Standard', price: 1099 }],
    },
    {
        id: 'item-15', category_id: 'cat-5', name: 'Cheese Roll Platter', slug: 'cheese-roll-platter',
        description: '4 pcs behari roll, 4 arabic roll served with Fries & Sauce', base_price: 1099, spicy_level: 'NONE', is_available: true, is_active: true,
        variants: [{ id: 'v-15-1', name: 'Standard', price: 1099 }],
    },

    // Pastas
    {
        id: 'item-16', category_id: 'cat-6', name: 'Alfredo Pasta', slug: 'alfredo-pasta',
        description: 'Pasta combination of Alfredo fettuccine white sauce with grilled chicken, sauce with mushrooms & topped with mozzarella cheese', base_price: 849, spicy_level: 'NONE', is_available: true, is_active: true,
        variants: [{ id: 'v-16-1', name: 'Standard', price: 849 }],
    },
    {
        id: 'item-17', category_id: 'cat-6', name: 'Crispy Pasta', slug: 'crispy-pasta',
        description: 'A combination of macaroni, tikka, white sauce, top sauce, chilli sauce topped with crispy & mozzarella cheese', base_price: 799, spicy_level: 'MEDIUM', is_available: true, is_active: true,
        variants: [{ id: 'v-17-1', name: 'Standard', price: 799 }],
    },

    // Sandwiches
    {
        id: 'item-18', category_id: 'cat-7', name: 'Crispy Sandwich', slug: 'crispy-sandwich',
        description: 'Blend of crispy chicken, lettuce cheese combination of taco sauce & sandwich bun', base_price: 799, spicy_level: 'NONE', is_available: true, is_active: true,
        variants: [{ id: 'v-18-1', name: 'Standard', price: 799 }],
    },
    {
        id: 'item-19', category_id: 'cat-7', name: 'Stuffed Chunks', slug: 'stuffed-chunks',
        description: '4 pcs stuffed chunks served with sauce & fries', base_price: 1099, spicy_level: 'NONE', is_available: true, is_active: true,
        variants: [{ id: 'v-19-1', name: 'Standard', price: 1099 }],
    },

    // Burgers
    {
        id: 'item-20', category_id: 'cat-8', name: 'Zegy Burger', slug: 'zegy-burger',
        description: 'Combination of chicken patty, mayo, chilli sauce, lettuce & burger bun', base_price: 399, spicy_level: 'NONE', is_available: true, is_active: true,
        variants: [{ id: 'v-20-1', name: 'Standard', price: 399 }],
    },
    {
        id: 'item-21', category_id: 'cat-8', name: 'Chicken Burger', slug: 'chicken-burger',
        description: 'Chicken filet, mayonnaise With lettuce & burger bun', base_price: 499, spicy_level: 'NONE', is_available: true, is_active: true,
        variants: [{ id: 'v-21-1', name: 'Standard', price: 499 }],
    },
    {
        id: 'item-22', category_id: 'cat-8', name: 'Zinger Burger', slug: 'zinger-burger',
        description: 'Crispy crunchy spicy chicken fillet with fresh lettuce and signature mayo sauce', base_price: 499, spicy_level: 'MEDIUM', is_available: true, is_active: true,
        variants: [{ id: 'v-22-1', name: 'Standard', price: 499 }],
    },

    // Premium Pizzas
    {
        id: 'item-23', category_id: 'cat-9', name: 'Chicken Extreme', slug: 'chicken-extreme',
        description: 'A combination of 2 types of chicken, onion, green pepper with green olives & mozzarella cheese', base_price: 699, spicy_level: 'HOT', is_available: true, is_active: true,
        variants: [
            { id: 'v-23-1', name: 'Small', price: 699 },
            { id: 'v-23-2', name: 'Medium', price: 1399 },
            { id: 'v-23-3', name: 'Large', price: 1799 },
            { id: 'v-23-4', name: 'Party Size', price: 2799 },
        ],
    },
    {
        id: 'item-24', category_id: 'cat-9', name: 'Peri Peri Pizza', slug: 'peri-peri-pizza',
        description: 'A combination of 2 types of chicken, onion, green pepper with mozzarella cheese top with peri peri sauce', base_price: 699, spicy_level: 'HOT', is_available: true, is_active: true,
        variants: [
            { id: 'v-24-1', name: 'Small', price: 699 },
            { id: 'v-24-2', name: 'Medium', price: 1399 },
            { id: 'v-24-3', name: 'Large', price: 1799 },
            { id: 'v-24-4', name: 'Party Size', price: 2799 },
        ],
    },
    {
        id: 'item-25', category_id: 'cat-9', name: 'Behari Kebab Pizza', slug: 'behari-kebab-pizza',
        description: 'A combination of chicken chunks, onion, with mozzarella cheese top with optional sauce', base_price: 699, spicy_level: 'MEDIUM', is_available: true, is_active: true,
        variants: [
            { id: 'v-25-1', name: 'Small', price: 699 },
            { id: 'v-25-2', name: 'Medium', price: 1399 },
            { id: 'v-25-3', name: 'Large', price: 1799 },
            { id: 'v-25-4', name: 'Party Size', price: 2799 },
        ],
    },
    {
        id: 'item-26', category_id: 'cat-9', name: 'Crown Crust', slug: 'crown-crust',
        description: 'A combination of 2 types of chicken, onion, pepper with black olives & mozzarella cheese', base_price: 699, spicy_level: 'MEDIUM', is_available: true, is_active: true,
        variants: [
            { id: 'v-26-1', name: 'Small', price: 699 },
            { id: 'v-26-2', name: 'Medium', price: 1399 },
            { id: 'v-26-3', name: 'Large', price: 1799 },
            { id: 'v-26-4', name: 'Party Size', price: 2799 },
        ],
    },
    {
        id: 'item-27', category_id: 'cat-9', name: 'Stuffed Crust', slug: 'stuffed-crust',
        description: 'Special Chicken, Green Olives, Mushrooms, with the Crust filled with Cheese Or Kebab.', base_price: 1499, spicy_level: 'MEDIUM', is_available: true, is_active: true,
        variants: [
            { id: 'v-27-1', name: 'Medium', price: 1499 },
            { id: 'v-27-2', name: 'Large', price: 1999 },
            { id: 'v-27-3', name: 'Party Size', price: 2999 },
        ],
    },

    // Classic Pizzas
    {
        id: 'item-28', category_id: 'cat-10', name: 'Cheese Lover', slug: 'cheese-lover',
        description: 'A joyful cheesy delight over a pizza sauce base', base_price: 599, spicy_level: 'MILD', is_available: true, is_active: true,
        variants: [
            { id: 'v-28-1', name: 'Small', price: 599 },
            { id: 'v-28-2', name: 'Medium', price: 1299 },
            { id: 'v-28-3', name: 'Large', price: 1499 },
            { id: 'v-28-4', name: 'Party Size', price: 2599 },
        ],
    },
    {
        id: 'item-29', category_id: 'cat-10', name: 'Chicken Tikka', slug: 'chicken-tikka',
        description: 'Traditionally flavored chunks of chicken tikka with a blend of pizza sauce, onion & mozzarella cheese', base_price: 599, spicy_level: 'MEDIUM', is_available: true, is_active: true,
        variants: [
            { id: 'v-29-1', name: 'Small', price: 599 },
            { id: 'v-29-2', name: 'Medium', price: 1299 },
            { id: 'v-29-3', name: 'Large', price: 1499 },
            { id: 'v-29-4', name: 'Party Size', price: 2599 },
        ],
    },
    {
        id: 'item-30', category_id: 'cat-10', name: 'Chicken Supreme', slug: 'chicken-supreme',
        description: 'A combination of chicken with onion, mushroom, bell pepper & black olive over a pizza sauce', base_price: 599, spicy_level: 'MILD', is_available: true, is_active: true,
        variants: [
            { id: 'v-30-1', name: 'Small', price: 599 },
            { id: 'v-30-2', name: 'Medium', price: 1299 },
            { id: 'v-30-3', name: 'Large', price: 1499 },
            { id: 'v-30-4', name: 'Party Size', price: 2599 },
        ],
    },
    {
        id: 'item-31', category_id: 'cat-10', name: 'Chicken Fajita', slug: 'chicken-fajita',
        description: 'Divine flavored chunks of fajita chicken with a blend of pizza sauce, onion, bell peppers & mozzarella cheese', base_price: 599, spicy_level: 'MEDIUM', is_available: true, is_active: true,
        variants: [
            { id: 'v-31-1', name: 'Small', price: 599 },
            { id: 'v-31-2', name: 'Medium', price: 1299 },
            { id: 'v-31-3', name: 'Large', price: 1499 },
            { id: 'v-31-4', name: 'Party Size', price: 2599 },
        ],
    },
    {
        id: 'item-32', category_id: 'cat-10', name: 'Chicken Tandori', slug: 'chicken-tandori',
        description: 'A combination of beef & chicken with onion, bell peppers & mozzarella cheese', base_price: 599, spicy_level: 'HOT', is_available: true, is_active: true,
        variants: [
            { id: 'v-32-1', name: 'Small', price: 599 },
            { id: 'v-32-2', name: 'Medium', price: 1299 },
            { id: 'v-32-3', name: 'Large', price: 1499 },
            { id: 'v-32-4', name: 'Party Size', price: 2599 },
        ],
    },
    {
        id: 'item-33', category_id: 'cat-10', name: 'Classic Pizza (Customer\'s Choice)', slug: 'classic-pizza-choice',
        description: 'Customer chooses any classic pizza flavour (Cheese Lover, Chicken Tikka, Supreme, Fajita, Tandori)', base_price: 599, spicy_level: 'MILD', is_available: true, is_active: true,
        variants: [
            { id: 'v-33-1', name: 'Small', price: 599 },
            { id: 'v-33-2', name: 'Medium', price: 1299 },
            { id: 'v-33-3', name: 'Large', price: 1499 },
            { id: 'v-33-4', name: 'Party Size', price: 2599 },
        ],
    },
    {
        id: 'item-36', category_id: 'cat-9', name: 'Premium Pizza (Customer\'s Choice)', slug: 'premium-pizza-choice',
        description: 'Customer chooses any premium pizza flavour (Chicken Extreme, Peri Peri, Behari Kebab, Crown Crust, Stuffed Crust)', base_price: 699, spicy_level: 'HOT', is_available: true, is_active: true,
        variants: [
            { id: 'v-36-1', name: 'Small', price: 699 },
            { id: 'v-36-2', name: 'Medium', price: 1399 },
            { id: 'v-36-3', name: 'Large', price: 1799 },
            { id: 'v-36-4', name: 'Party Size', price: 2799 },
        ],
    },
    {
        id: 'item-37', category_id: 'cat-8', name: 'Burger (Customer\'s Choice)', slug: 'burger-choice',
        description: 'Customer chooses any burger flavour (Zegy Burger, Chicken Burger, Zinger Burger)', base_price: 499, spicy_level: 'MEDIUM', is_available: true, is_active: true,
        variants: [
            { id: 'v-37-1', name: 'Standard', price: 499 },
        ],
    },

    // Drinks
    {
        id: 'item-34', category_id: 'cat-11', name: 'Soft Drink', slug: 'soft-drink',
        description: 'Chilled soft drink (Pepsi / 7Up / Mirinda / Next Cola)', base_price: 110, spicy_level: 'NONE', is_available: true, is_active: true,
        variants: [
            { id: 'v-34-1', name: 'Regular', price: 110 },
            { id: 'v-34-2', name: 'Can', price: 130 },
            { id: 'v-34-3', name: '1 Liter', price: 200 },
            { id: 'v-34-4', name: '1.5 Liter', price: 240 },
        ],
    },
    {
        id: 'item-35', category_id: 'cat-11', name: 'Mineral Water', slug: 'mineral-water',
        description: 'Chilled purified mineral water bottle', base_price: 70, spicy_level: 'NONE', is_available: true, is_active: true,
        variants: [
            { id: 'v-35-1', name: 'Regular Bottle', price: 70 },
        ],
    },
];

// Attach category object & _count to categories and menu items
export function getFallbackCategoriesWithCounts() {
    return FALLBACK_CATEGORIES.map(cat => {
        const count = FALLBACK_MENU_ITEMS.filter(it => it.category_id === cat.id).length;
        return {
            ...cat,
            _count: { menu_items: count },
        };
    });
}

export function getFallbackMenuItems() {
    const catMap = new Map(FALLBACK_CATEGORIES.map(c => [c.id, c]));
    return FALLBACK_MENU_ITEMS.map(it => ({
        ...it,
        category: catMap.get(it.category_id) || { name: 'General' },
    }));
}

// ─── 3. Fallback Deals ───────────────────────────────────────────────────────
function buildFallbackDealItem(dealId, idx, menuItemId, variantId, qty) {
    const it = FALLBACK_MENU_ITEMS.find(m => m.id === menuItemId) || { name: 'Item', base_price: 0, is_available: true };
    const variant = it.variants?.find(v => v.id === variantId) || (it.variants?.[0] || null);
    const id = `di-${dealId}-${idx}`;
    return {
        itemObj: {
            id,
            menu_item_id: menuItemId,
            item_name: it.name,
            menu_variant_id: variant ? variant.id : null,
            variant_name: variant ? variant.name : null,
            quantity: qty,
        },
        dealItemObj: {
            id,
            deal_id: dealId,
            menu_item_id: menuItemId,
            menu_variant_id: variant ? variant.id : null,
            quantity: qty,
            menu_item: {
                id: it.id,
                name: it.name,
                base_price: it.base_price,
                is_available: it.is_available,
            },
            menu_variant: variant ? {
                id: variant.id,
                name: variant.name,
                price: variant.price,
                is_available: true,
            } : null,
        },
    };
}

function createInitialDeal(id, name, slug, price, sortOrder, itemsConfig) {
    const built = itemsConfig.map((cfg, idx) => buildFallbackDealItem(id, idx + 1, cfg.itemId, cfg.variantId, cfg.qty));
    return {
        id,
        name,
        slug,
        deal_price: price,
        sort_order: sortOrder,
        is_active: true,
        start_at: null,
        end_at: null,
        items: built.map(b => b.itemObj),
        deal_items: built.map(b => b.dealItemObj),
        created_at: new Date(),
        updated_at: new Date(),
    };
}

export let FALLBACK_DEALS = [
    createInitialDeal('deal-1', 'Pizza Meal For 1', 'deal-pizza-meal-for-1', 599, 1, [
        { itemId: 'item-33', variantId: 'v-33-1', qty: 1 },
        { itemId: 'item-34', variantId: 'v-34-1', qty: 1 },
    ]),
    createInitialDeal('deal-2', 'Pizza Meal For 2', 'deal-pizza-meal-for-2', 1299, 2, [
        { itemId: 'item-33', variantId: 'v-33-2', qty: 1 },
        { itemId: 'item-34', variantId: 'v-34-1', qty: 2 },
    ]),
    createInitialDeal('deal-3', 'Pizza Meal For 3', 'deal-pizza-meal-for-3', 1599, 3, [
        { itemId: 'item-33', variantId: 'v-33-3', qty: 1 },
        { itemId: 'item-34', variantId: 'v-34-3', qty: 1 },
    ]),
    createInitialDeal('deal-4', 'Pizza Meal For 4', 'deal-pizza-meal-for-4', 2499, 4, [
        { itemId: 'item-33', variantId: 'v-33-4', qty: 1 },
        { itemId: 'item-34', variantId: 'v-34-4', qty: 1 },
    ]),
    createInitialDeal('deal-5', 'Burger Meal For 1', 'deal-burger-meal-for-1', 599, 5, [
        { itemId: 'item-22', variantId: 'v-22-1', qty: 1 },
        { itemId: 'item-4',  variantId: 'v-4-1',  qty: 1 },
        { itemId: 'item-34', variantId: 'v-34-1', qty: 1 },
    ]),
    createInitialDeal('deal-6', 'Burger Meal For 2', 'deal-burger-meal-for-2', 999, 6, [
        { itemId: 'item-22', variantId: 'v-22-1', qty: 2 },
        { itemId: 'item-4',  variantId: 'v-4-1',  qty: 1 },
        { itemId: 'item-34', variantId: 'v-34-1', qty: 2 },
    ]),
    createInitialDeal('deal-7', 'Burger Meal For 3', 'deal-burger-meal-for-3', 1599, 7, [
        { itemId: 'item-22', variantId: 'v-22-1', qty: 3 },
        { itemId: 'item-10', variantId: 'v-10-1', qty: 3 },
        { itemId: 'item-34', variantId: 'v-34-3', qty: 1 },
    ]),
    createInitialDeal('deal-8', 'Deal 1', 'deal-1', 1099, 8, [
        { itemId: 'item-33', variantId: 'v-33-1', qty: 2 },
        { itemId: 'item-34', variantId: 'v-34-1', qty: 2 },
    ]),
    createInitialDeal('deal-9', 'Deal 2', 'deal-2', 2099, 9, [
        { itemId: 'item-33', variantId: 'v-33-2', qty: 2 },
        { itemId: 'item-34', variantId: 'v-34-3', qty: 1 },
    ]),
    createInitialDeal('deal-10', 'Deal 3', 'deal-3', 2999, 10, [
        { itemId: 'item-33', variantId: 'v-33-3', qty: 2 },
        { itemId: 'item-34', variantId: 'v-34-3', qty: 1 },
    ]),
    createInitialDeal('deal-11', 'Deal 4', 'deal-4', 999, 11, [
        { itemId: 'item-20', variantId: 'v-20-1', qty: 4 },
    ]),
    createInitialDeal('deal-12', 'Deal 5', 'deal-5', 1099, 12, [
        { itemId: 'item-22', variantId: 'v-22-1', qty: 3 },
        { itemId: 'item-34', variantId: 'v-34-3', qty: 1 },
    ]),
];

export function getFallbackDeals() {
    return FALLBACK_DEALS.map(d => ({
        ...d,
        deal_price: Number(d.deal_price ?? 0),
        items_count: Array.isArray(d.deal_items) ? d.deal_items.length : (d.items?.length || 0),
    }));
}

export function getFallbackDealById(idOrSlug) {
    if (!idOrSlug) return null;
    const deal = FALLBACK_DEALS.find(d => d.id === idOrSlug || d.slug === idOrSlug);
    if (!deal) return null;
    return {
        ...deal,
        deal_price: Number(deal.deal_price ?? 0),
    };
}

export function updateFallbackDeal(id, updateData) {
    const deal = FALLBACK_DEALS.find(d => d.id === id);
    if (!deal) return null;

    if (updateData.name !== undefined) deal.name = String(updateData.name).trim();
    if (updateData.deal_price !== undefined) deal.deal_price = Number(updateData.deal_price);
    if (updateData.sort_order !== undefined) deal.sort_order = Number(updateData.sort_order);
    if (updateData.is_active !== undefined) deal.is_active = Boolean(updateData.is_active);
    if (updateData.start_at !== undefined) deal.start_at = updateData.start_at ? new Date(updateData.start_at) : null;
    if (updateData.end_at !== undefined) deal.end_at = updateData.end_at ? new Date(updateData.end_at) : null;
    if (updateData.image_url !== undefined) deal.image_url = updateData.image_url;

    if (Array.isArray(updateData.items)) {
        const built = updateData.items.map((cfg, idx) =>
            buildFallbackDealItem(id, idx + 1, cfg.menu_item_id || cfg.itemId, cfg.menu_variant_id || cfg.variantId, cfg.quantity || cfg.qty || 1)
        );
        deal.items = built.map(b => b.itemObj);
        deal.deal_items = built.map(b => b.dealItemObj);
    }

    deal.updated_at = new Date();
    return {
        ...deal,
        deal_price: Number(deal.deal_price ?? 0),
    };
}

export function createFallbackDeal(data) {
    const id = `deal-${Date.now()}`;
    const slug = data.slug || `deal-${String(data.name || 'custom').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const price = Number(data.deal_price ?? 0);
    const sortOrder = Number(data.sort_order ?? (FALLBACK_DEALS.length + 1));

    const itemsConfig = Array.isArray(data.items)
        ? data.items.map(it => ({
            itemId: it.menu_item_id || it.itemId,
            variantId: it.menu_variant_id || it.variantId,
            qty: it.quantity || it.qty || 1,
        }))
        : [];

    const newDeal = createInitialDeal(id, data.name || 'New Deal', slug, price, sortOrder, itemsConfig);
    newDeal.is_active = data.is_active !== undefined ? Boolean(data.is_active) : true;
    newDeal.start_at = data.start_at ? new Date(data.start_at) : null;
    newDeal.end_at = data.end_at ? new Date(data.end_at) : null;
    newDeal.image_url = data.image_url || '';

    FALLBACK_DEALS.push(newDeal);
    return newDeal;
}

export function deleteFallbackDeal(id) {
    const idx = FALLBACK_DEALS.findIndex(d => d.id === id);
    if (idx === -1) return false;
    FALLBACK_DEALS.splice(idx, 1);
    return true;
}

export function toggleFallbackDealStatus(id, isActive) {
    const deal = FALLBACK_DEALS.find(d => d.id === id);
    if (!deal) return null;
    deal.is_active = typeof isActive === 'boolean' ? isActive : !deal.is_active;
    deal.updated_at = new Date();
    return deal;
}

export function deleteAllFallbackDeals() {
    const count = FALLBACK_DEALS.length;
    FALLBACK_DEALS.length = 0;
    return count;
}

// ─── 4. Fallback Delivery Areas ──────────────────────────────────────────────
export const FALLBACK_DELIVERY_AREAS = Object.entries(DELIVERY_AREA_COORDINATES).map(([slug, coords], idx) => {
    // Format human readable name from slug
    const name = slug
        .split('-')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');

    return {
        id: `da-${idx + 1}`,
        name,
        slug,
        delivery_fee: 0,
        minimum_order: 0,
        is_active: true,
        sort_order: idx + 1,
        latitude: coords.lat,
        longitude: coords.lng,
        radius_km: coords.radiusKm,
    };
});
