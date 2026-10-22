/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║   Catalog Cache Service — src/services/catalogCacheService.js ║
 * ║   5-second in-memory menu + deals cache for AI & fast-router ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * - Refreshed automatically every 5 seconds (TTL-based)
 * - Refreshed instantly on admin mutations / sync triggers
 * - Classifies deals into strictly 5 sections with [dealId:...] tags
 * - Filters out test categories (aleem, test, demo)
 * - Embeds menuItemId & variantId tags for zero hallucination
 * - Increments syncEpoch (+1) whenever catalog changes
 */

import { getActiveMenu, getActiveDeals } from './menuService.js';
import { getDefaultRestaurantId } from './restaurantService.js';
import { getDbClient } from '../db/client.js';
import { getGlobalDiscountSettings, calculateDiscount } from './discountService.js';

// ─── Sync Epoch (bumped by admin sync + catalog updates) ──────────────────
let _syncEpoch = 1;

export function getSyncEpoch() {
    return _syncEpoch;
}

export function bumpSyncEpoch() {
    _syncEpoch += 1;
    console.log(`[CATALOG] syncEpoch bumped to ${_syncEpoch} — invalidating session memory & cache.`);
    _invalidateCache();
}

// ─── Cache State ──────────────────────────────────────────────────────────
const CACHE_TTL_MS = 5_000; // 5 seconds live DB cache

let _cache = null;
let _cacheTime = 0;
let _isRefreshing = false;

function _invalidateCache() {
    _cache = null;
    _cacheTime = 0;
}

// ─── Helper: Test category detector ───────────────────────────────────────
function isTestCategory(name) {
    const lower = (name || '').toLowerCase();
    return lower.includes('aleem') || lower.includes('test') || lower.includes('demo');
}

// ─── Helper: Format Included Items for Deal ─────────────────────────────
function formatDealItemsText(deal) {
    if (deal.deal_items && deal.deal_items.length > 0) {
        return deal.deal_items.map(di => {
            const qty = di.quantity || 1;
            const qtyStr = `${qty}x `;
            const itemName = di.menu_item?.name || 'Item';
            const variantName = di.menu_variant?.name || '';
            const needsVariant = variantName && !itemName.toLowerCase().includes(variantName.toLowerCase());
            return `${qtyStr}${itemName}${needsVariant ? ` (${variantName})` : ''}`;
        }).join(', ');
    }
    return '';
}

// ─── Helper: Classify deals into strictly 5 sections ──────────────────────
function classifyDeal(deal) {
    const name = (deal.name || '').toLowerCase();
    const itemsText = (deal.deal_items || []).map(di => di.menu_item?.name || '').join(' ').toLowerCase();

    // 1. === BURGER MEALS ===
    if (name.includes('burger meal') || (name.includes('burger') && name.includes('meal'))) {
        return 'BURGER_MEALS';
    }

    // 2. === BURGER VALUE DEALS ===
    if (name.includes('deal 4') || name.includes('deal 5') || (name.includes('burger') && (name.includes('deal') || name.includes('value')))) {
        return 'BURGER_VALUE_DEALS';
    }

    // 3. === PIZZA MEALS (1 Pizza + Drinks) ===
    if (name.includes('pizza meal') || (name.includes('pizza') && name.includes('meal'))) {
        return 'PIZZA_MEALS';
    }

    // 4. === PIZZA VALUE DEALS (Multiple Pizzas + Drink) ===
    if (name.includes('deal 1') || name.includes('deal 2') || name.includes('deal 3') || (name.includes('pizza') && (name.includes('deal') || name.includes('value')))) {
        return 'PIZZA_VALUE_DEALS';
    }

    // Fallback: Check items included
    if (itemsText.includes('burger') && !itemsText.includes('pizza')) {
        return 'BURGER_VALUE_DEALS';
    }
    if (itemsText.includes('pizza') && !itemsText.includes('burger')) {
        return 'PIZZA_VALUE_DEALS';
    }

    // 5. === SPECIAL / COMBO DEALS ===
    return 'SPECIAL_COMBO_DEALS';
}

// ─── Data Fetcher ─────────────────────────────────────────────────────────
async function fetchAllCatalog() {
    try {
        const restId = await getDefaultRestaurantId();
        const prisma = getDbClient();

        const [categories, rawDeals, restaurant, faqs, globalDiscount] = await Promise.all([
            getActiveMenu(restId),
            getActiveDeals(restId),
            prisma ? prisma.restaurant.findUnique({ where: { id: restId }, include: { settings: true } }) : null,
            prisma ? prisma.fAQ.findMany({
                where: { restaurant_id: restId, is_active: true },
                orderBy: { sort_order: 'asc' },
                take: 50,
            }) : [],
            getGlobalDiscountSettings(restId),
        ]);

        // ── 1. Filter out test categories (aleem, test, demo) & deals (deals belong to Deals catalog) ──
        const validCategories = (categories || []).filter(c => !isTestCategory(c.name) && !/deals?/i.test(c.name));

        // Format Categories Summary
        const cachedCategoriesSummary = validCategories.map((c, idx) =>
            `${idx + 1}. ${c.name} (${c.menu_items?.length || 0} items)`
        ).join('\n') || 'Main Menu Dastiyab Hai';

        // ── 2. Compact Menu Items Catalog (Token-efficient for AI Context) ──
        const menuCatalogParts = [];
        for (const cat of validCategories) {
            const items = (cat.menu_items || []).map(item => {
                const basePrice = Number(item.base_price || 0);
                const variants = item.variants || [];
                if (variants.length > 1) {
                    const vStr = variants.map(v => {
                        const vDisc = calculateDiscount(v.price || basePrice, v.discount_percent ?? item.discount_percent, v.discount_fixed ?? item.discount_fixed, globalDiscount);
                        return `${v.name}:${vDisc.hasDiscount ? vDisc.discountedPrice : Number(v.price || basePrice)}`;
                    }).join(', ');
                    return `• ${item.name} (${vStr})`;
                }
                const disc = calculateDiscount(basePrice, item.discount_percent, item.discount_fixed, globalDiscount);
                const desc = item.description ? ` - ${item.description}` : '';
                const pText = disc.hasDiscount ? `Rs. ${disc.discountedPrice} (${disc.label})` : `Rs. ${basePrice}`;
                return `• ${item.name} (${pText})${desc}`;
            });
            menuCatalogParts.push(`[${cat.name}]\n${items.join('\n')}`);
        }
        const cachedMenuCatalog = menuCatalogParts.join('\n\n') || '(Menu items available)';

        // ── 2b. Clean Customer Menu Catalog (Visually Stunning & Highly Readable for WhatsApp) ──
        const customerMenuParts = [];
        for (const cat of validCategories) {
            const validItems = cat.menu_items || [];
            if (validItems.length === 0) continue;

            const isDealsCategory = /deals?/i.test(cat.name);
            const isDrinkCategory = /drinks?/i.test(cat.name);

            let headerEmoji = '🍕';
            if (cat.name.includes('Starter')) headerEmoji = '🍟';
            else if (cat.name.includes('Roll')) headerEmoji = '🌯';
            else if (cat.name.includes('Box')) headerEmoji = '🍗';
            else if (cat.name.includes('Wing')) headerEmoji = '🍗';
            else if (cat.name.includes('Platter')) headerEmoji = '🍱';
            else if (cat.name.includes('Pasta')) headerEmoji = '🍝';
            else if (cat.name.includes('Sandwich')) headerEmoji = '🥪';
            else if (cat.name.includes('Burger')) headerEmoji = '🍔';
            else if (cat.name.includes('Premium')) headerEmoji = '🌟';
            else if (cat.name.includes('Classic')) headerEmoji = '🍕';
            else if (isDrinkCategory) headerEmoji = '🥤';

            const itemLines = validItems.map(item => {
                const basePrice = Number(item.base_price || 0);
                const variants = item.variants || [];

                // A. Deal Items (or single variant items with description)
                if (isDealsCategory || (variants.length <= 1 && item.description)) {
                    const rawPrice = variants.length > 0 ? Number(variants[0].price || basePrice) : basePrice;
                    const vPct = variants.length > 0 ? variants[0].discount_percent : null;
                    const vFixed = variants.length > 0 ? variants[0].discount_fixed : null;
                    const disc = calculateDiscount(rawPrice, vPct ?? item.discount_percent, vFixed ?? item.discount_fixed, globalDiscount);
                    const priceText = disc.hasDiscount ? disc.formattedFull : `Rs. ${rawPrice}`;
                    const desc = item.description ? `\n   _${item.description}_` : '';
                    return `• *${item.name}* — ${priceText}${desc}`;
                }

                // B. Multi-variant Pizza / Food Items (e.g. Small, Medium, Large, Party Size)
                if (variants.length > 1) {
                    const sizesStr = variants.map(v => {
                        const vDisc = calculateDiscount(v.price || basePrice, v.discount_percent ?? item.discount_percent, v.discount_fixed ?? item.discount_fixed, globalDiscount);
                        const vPriceText = vDisc.hasDiscount ? vDisc.formattedFull : `Rs. ${Number(v.price || basePrice)}`;
                        return `${v.name}: ${vPriceText}`;
                    }).join(' | ');
                    const spicyTag = (item.spicy_level && item.spicy_level !== 'NONE') ? ` _(${item.spicy_level === 'HOT' ? 'Spicy' : 'Medium'})_` : '';
                    const desc = item.description ? `\n   _${item.description}_` : '';
                    return `• *${item.name}*${spicyTag}\n   ${sizesStr}${desc}`;
                }

                // C. Single standard item
                const disc = calculateDiscount(basePrice, item.discount_percent, item.discount_fixed, globalDiscount);
                const priceText = disc.hasDiscount ? disc.formattedFull : `Rs. ${basePrice}`;
                return `• *${item.name}* — ${priceText}`;
            });

            customerMenuParts.push(`${headerEmoji} *${cat.name.toUpperCase()}*\n━━━━━━━━━━━━━━━━━━━━━\n${itemLines.join('\n\n')}`);
        }

        const discountBanner = (globalDiscount && globalDiscount.enabled)
            ? `🏷️ *SPECIAL OFFER: ${globalDiscount.title.toUpperCase()} (${globalDiscount.type === 'FIXED' ? 'Rs. ' + globalDiscount.value : globalDiscount.value + '%'} OFF ON ALL ITEMS)* 🏷️\n\n`
            : '';

        const customerMenuCatalog = (discountBanner + customerMenuParts.join('\n\n\n')) || cachedCategoriesSummary;

        // ── 3. Classify Deals strictly into sections ──
        const dealBuckets = {
            BURGER_MEALS: [],
            BURGER_VALUE_DEALS: [],
            PIZZA_MEALS: [],
            PIZZA_VALUE_DEALS: [],
            SPECIAL_COMBO_DEALS: [],
        };

        for (const deal of (rawDeals || [])) {
            const bucket = classifyDeal(deal);
            dealBuckets[bucket].push(deal);
        }

        // Compact AI deals summary (single line per deal with dealId & included items)
        const cachedDealsSummary = (rawDeals || []).map(d => {
            const itemsText = formatDealItemsText(d);
            const desc = itemsText ? ` (${itemsText})` : '';
            return `• ${d.name} (Rs. ${Number(d.deal_price)})${desc} [dealId:${d.id}]`;
        }).join('\n') || '(No deals currently active)';

        // Clean, beautiful customer deals formatting for WhatsApp (based on included items)
        const formatCustomerDealBlock = (title, emoji, dealList) => {
            if (!dealList || dealList.length === 0) return null;
            const lines = dealList.map(d => {
                const itemsText = formatDealItemsText(d);
                const desc = itemsText ? `\n   _${itemsText}_` : '';
                return `• *${d.name}* — Rs. ${Number(d.deal_price)}${desc}`;
            });
            return `${emoji} *${title}*\n━━━━━━━━━━━━━━━━━━━━━\n${lines.join('\n\n')}`;
        };

        const burgerDealsList = [...dealBuckets.BURGER_MEALS, ...dealBuckets.BURGER_VALUE_DEALS];
        const pizzaDealsList  = [...dealBuckets.PIZZA_MEALS, ...dealBuckets.PIZZA_VALUE_DEALS];

        const burgerSection = formatCustomerDealBlock('BURGER DEALS', '🍔', burgerDealsList);
        const pizzaSection  = formatCustomerDealBlock('PIZZA DEALS', '🍕', pizzaDealsList);
        const comboSection  = formatCustomerDealBlock('COMBO & SPECIAL DEALS', '🔥', dealBuckets.SPECIAL_COMBO_DEALS);

        const customerBurgerDeals = burgerSection || 'Burger deals abhi available nahi hain.';
        const customerPizzaDeals  = pizzaSection || 'Pizza deals abhi available nahi hain.';
        const customerAllDeals    = [burgerSection, pizzaSection, comboSection].filter(Boolean).join('\n\n\n') || 'Deals abhi available nahi hain.';

        // ── 4. Format Store Info ──
        const storeName    = restaurant?.name && !/cravey/i.test(restaurant.name) ? restaurant.name : (restaurant?.name || 'Cravey Crust');
        const storeAddress = restaurant?.address || '';
        const storePhone   = restaurant?.phone || '';
        const rawOpening   = restaurant?.opening_time || '';
        const rawClosing   = restaurant?.closing_time || '';
        const formatTime12h = (t) => {
            if (!t) return '';
            const m = t.match(/^(\d{1,2}):(\d{2})$/);
            if (!m) return t;
            let h = parseInt(m[1], 10);
            const min = m[2];
            const ampm = h >= 12 ? 'PM' : 'AM';
            h = h % 12;
            h = h ? h : 12;
            return `${h < 10 ? '0' + h : h}:${min} ${ampm}`;
        };
        const openingTimeFormatted = formatTime12h(rawOpening) || rawOpening || '04:00 PM';
        const closingTimeFormatted = formatTime12h(rawClosing) || rawClosing || '02:00 AM';
        const storeTimings = (openingTimeFormatted && closingTimeFormatted)
            ? `${openingTimeFormatted} - ${closingTimeFormatted}`
            : '04:00 PM - 02:00 AM';
        const codEnabled       = restaurant?.cod_enabled ?? true;
        const easypaisaEnabled = restaurant?.easypaisa_enabled ?? false;
        const easypaisaNumber  = restaurant?.easypaisa_number || '03434919319';
        const accountName      = restaurant?.account_name || 'Muhammad Shoaib';
        const minOrder         = Number(restaurant?.min_order || 0);
        const deliveryFee      = Number(restaurant?.default_delivery_fee || 0);

        const cachedStoreInfo = `Name: ${storeName}
Outlet Address: ${storeAddress}
Timings: ${storeTimings}
Phone: ${storePhone}
Min Order: Rs. ${minOrder} | Default Delivery Fee: Rs. ${deliveryFee}
COD: ${codEnabled ? 'Yes' : 'No'} | EasyPaisa: ${easypaisaEnabled ? 'Yes' : 'No'} (${easypaisaNumber} - ${accountName})`;

        const defaultOutOfDeliveryMsg = 'Maazrat! Aapki share ki hui location hamari delivery range se bahar hai. Hum sirf apne approved delivery areas mein delivery provide karte hain.\n\nBarah-e-karam kisi approved delivery area ka address ya WhatsApp location pin share karein, taake hum aapki delivery confirm kar sakein. Shukriya!';
        const outOfDeliverySetting = (restaurant?.settings || []).find(s => s.key === 'out_of_delivery_range_message');
        const outOfDeliveryMessage = (outOfDeliverySetting?.value && outOfDeliverySetting.value.trim()) ? outOfDeliverySetting.value.trim() : defaultOutOfDeliveryMsg;

        const defaultReviewsUrl = 'https://maps.app.goo.gl/rVvANx8pRmtXrEMj9';
        const reviewsSetting = (restaurant?.settings || []).find(s => s.key === 'google_reviews_url');
        const googleReviewsUrl = (reviewsSetting?.value && reviewsSetting.value.trim()) ? reviewsSetting.value.trim() : defaultReviewsUrl;

        const radiusSetting = (restaurant?.settings || []).find(s => s.key === 'max_delivery_radius_km');
        const maxDeliveryRadiusKm = (radiusSetting?.value && !isNaN(parseFloat(radiusSetting.value))) ? parseFloat(radiusSetting.value) : 10.0;

        const latSetting = (restaurant?.settings || []).find(s => s.key === 'restaurant_lat');
        const restaurantLat = (latSetting?.value && !isNaN(parseFloat(latSetting.value))) ? parseFloat(latSetting.value) : 33.6180334;

        const lngSetting = (restaurant?.settings || []).find(s => s.key === 'restaurant_lng');
        const restaurantLng = (lngSetting?.value && !isNaN(parseFloat(lngSetting.value))) ? parseFloat(lngSetting.value) : 73.1398525;

        const mapUrlSetting = (restaurant?.settings || []).find(s => s.key === 'restaurant_map_url');
        const restaurantMapUrl = (mapUrlSetting?.value && mapUrlSetting.value.trim()) ? mapUrlSetting.value.trim() : 'https://maps.app.goo.gl/rVvANx8pRmtXrEMj9';

        // ── 5. Compact Knowledge & FAQ Summary for AI Prompt (Saves 4,000+ Tokens) ──
        const cachedFaqs = `• Free Delivery Areas: Ghauri Town (All Phases), Ghauri VIP, Taramari, Tarlai, Burma, Khana Pull, Rehman Enclave, Sanam Chowk, Shakral, Madina Town, Bilal Town, Gulzar-e-Quaid, Gulberg Green. Delivery radius ${maxDeliveryRadiusKm}KM.
• Payment: COD or advance EasyPaisa (${easypaisaNumber} - ${accountName}).
• Food Quality: 100% Halal fresh dough pizzas & burgers.`;

        return {
            restId,
            syncEpoch: _syncEpoch,
            dealsCount: rawDeals.length,
            cachedCategoriesSummary,
            cachedMenuCatalog,
            customerMenuCatalog,
            cachedDealsSummary,
            cachedStoreInfo,
            cachedFaqs,
            customerBurgerDeals,
            customerPizzaDeals,
            customerAllDeals,
            storeName,
            storeAddress,
            storePhone,
            openingTime: openingTimeFormatted,
            closingTime: closingTimeFormatted,
            storeTimings,
            codEnabled,
            easypaisaEnabled,
            easypaisaNumber,
            accountName,
            minOrder,
            defaultDeliveryFee: deliveryFee,
            outOfDeliveryMessage,
            googleReviewsUrl,
            maxDeliveryRadiusKm,
            restaurantLat,
            restaurantLng,
            restaurantMapUrl,
            rawCategories: validCategories,
            rawDeals,
            globalDiscount,
        };
    } catch (err) {
        console.error('[CATALOG] Cache fetch error:', err.message);
        const fallbackDeals = [
            '=== BURGER MEALS ===\n(Deals abhi available nahi hain)',
            '=== BURGER VALUE DEALS ===\n(Deals abhi available nahi hain)',
            '=== PIZZA MEALS (1 Pizza + Drinks) ===\n(Deals abhi available nahi hain)',
            '=== PIZZA VALUE DEALS (Multiple Pizzas + Drink) ===\n(Deals abhi available nahi hain)',
            '=== SPECIAL / COMBO DEALS ===\n(Deals abhi available nahi hain)',
        ].join('\n\n');

        return {
            restId: null,
            syncEpoch: _syncEpoch,
            dealsCount: 0,
            cachedCategoriesSummary: 'Main Menu Dastiyab Hai',
            cachedMenuCatalog: '',
            customerMenuCatalog: 'Main Menu Dastiyab Hai',
            cachedDealsSummary: fallbackDeals,
            cachedStoreInfo: '\nName: Burger Mehfil\nOutlet Address: Main Boulevard\nTimings: 04:00 PM - 02:00 AM\n',
            cachedFaqs: '',
            customerBurgerDeals: 'Burger deals load nahi ho saki.',
            customerPizzaDeals: 'Pizza deals load nahi ho saki.',
            customerAllDeals: 'Deals load nahi ho saki.',
            storeName: 'Burger Mehfil',
            storeAddress: 'Main Boulevard',
            storePhone: '',
            openingTime: '04:00 PM',
            closingTime: '02:00 AM',
            storeTimings: '04:00 PM - 02:00 AM',
            codEnabled: true,
            easypaisaEnabled: true,
            easypaisaNumber: '03434919319',
            accountName: 'Store Admin',
            minOrder: 0,
            defaultDeliveryFee: 0,
            outOfDeliveryMessage: 'Maazrat! Aapki share ki hui location hamari delivery range se bahar hai. Hum sirf apne approved delivery areas mein delivery provide karte hain.\n\nBarah-e-karam kisi approved delivery area ka address ya WhatsApp location pin share karein, taake hum aapki delivery confirm kar sakein. Shukriya!',
            rawCategories: [],
            rawDeals: [],
        };
    }

}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Get the cached catalog. Auto-refreshes if TTL (5 seconds) has elapsed.
 * @returns {Promise<Object>}
 */
export async function getCatalogCache() {
    const now = Date.now();
    if (_cache && (now - _cacheTime) < CACHE_TTL_MS) {
        return _cache;
    }

    if (!_isRefreshing) {
        _isRefreshing = true;
        fetchAllCatalog().then(data => {
            _cache = data;
            _cacheTime = Date.now();
            _isRefreshing = false;
        }).catch(() => {
            _isRefreshing = false;
        });
    }

    // Return stale cache if available while refresh is in progress
    if (_cache) return _cache;

    // First synchronous load
    _cache = await fetchAllCatalog();
    _cacheTime = Date.now();
    _isRefreshing = false;
    return _cache;
}

/**
 * Force a synchronous cache refresh (called by admin sync routes).
 */
export async function refreshCatalogCache() {
    _invalidateCache();
    _cache = await fetchAllCatalog();
    _cacheTime = Date.now();
    console.log(`[CATALOG] Cache force-refreshed (syncEpoch: ${_syncEpoch}).`);
    return _cache;
}
