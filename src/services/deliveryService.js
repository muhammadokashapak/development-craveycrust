import { getDbClient } from '../db/client.js';
import { getDefaultRestaurantId } from './restaurantService.js';
import { geocodeAddress } from './geocodingService.js';

/**
 * Fetch dynamic Out of Delivery Range Message from restaurant settings cache.
 */
export async function getOutOfDeliveryMessage(restaurantId, distanceKm = null, maxRadiusKm = null) {
    try {
        const { getCatalogCache } = await import('./catalogCacheService.js');
        const cache = await getCatalogCache();
        const configuredRadius = maxRadiusKm != null ? maxRadiusKm : (cache?.maxDeliveryRadiusKm ?? RESTAURANT_CENTER.maxRadiusKm);

        if (distanceKm != null && !isNaN(distanceKm)) {
            const distFormatted = distanceKm.toFixed(1);
            const radiusFormatted = configuredRadius % 1 === 0 ? configuredRadius.toFixed(0) : configuredRadius.toFixed(1);
            return `Maazrat! Aap ki location hamare restaurant se ${distFormatted} km door hai, jabke hamari delivery range ${radiusFormatted} km tak mehdood hai. Is waqt hum is area mein delivery provide nahi karte.\n\nAgar aap bahar hon ya pin mein masla ho, to aap apna Islamabad / Rawalpindi ka mukammal delivery address text mein bhi likh kar bhej sakte hain (jaise *Ghauri Town Phase 5, Street 12*). Shukriya! 📍`;
        }

        if (cache?.outOfDeliveryMessage) {
            return cache.outOfDeliveryMessage;
        }
    } catch (_) {}

    const radiusText = (configuredRadius ?? maxRadiusKm) != null ? `${(configuredRadius ?? maxRadiusKm)} km` : '10 km';
    return `Maazrat! Aap ki share ki hui location hamare restaurant se bahar hai. Hum sirf apne approved delivery range (${radiusText}) mein delivery provide karte hain.\n\nAgar pin bhejne mein masla ho ya aap bahar hon, to aap apna Islamabad / Rawalpindi ka delivery address text mein bhi likh kar bhej sakte hain (jaise *Ghauri Town Phase 5, Street 12*). Shukriya! 📍`;
}

/**
 * Calculate distance between two coordinates using the Haversine formula (in km).
 * No external API dependencies.
 *
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number} distance in kilometers
 */
export function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * Landmark coordinates for delivery coverage areas.
 */
export const DELIVERY_AREA_COORDINATES = {
    'ghauri-town-all-phase': { name: 'Ghauri Town all phase', lat: 33.6261, lng: 73.1255, radiusKm: 2.5 },
    'ghauri-vip':            { name: 'Ghauri VIP',            lat: 33.6250, lng: 73.1270, radiusKm: 1.2 },
    'ghauri-garden':         { name: 'Ghauri Garden',         lat: 33.6340, lng: 73.1380, radiusKm: 1.5 },
    'tarlai':                { name: 'Tarlai',                lat: 33.6490, lng: 73.1420, radiusKm: 2.0 },
    'taramari':              { name: 'Taramari',              lat: 33.6430, lng: 73.1550, radiusKm: 2.0 },
    'burma':                 { name: 'Burma',                 lat: 33.6550, lng: 73.1360, radiusKm: 1.8 },
    'khana-pull':            { name: 'Khana Pull',            lat: 33.6335, lng: 73.1125, radiusKm: 2.0 },
    'shakral':               { name: 'Shakral',               lat: 33.6390, lng: 73.1050, radiusKm: 2.0 },
    'zia-masjid':            { name: 'Zia Masjid',            lat: 33.6430, lng: 73.1020, radiusKm: 1.5 },
    'zia-market':            { name: 'Zia market',            lat: 33.6415, lng: 73.1035, radiusKm: 1.2 },
    'bilal-town':            { name: 'Bilal town',            lat: 33.6350, lng: 73.1170, radiusKm: 1.5 },
    'sanam-chok':            { name: 'Sanam Chok',            lat: 33.6295, lng: 73.1185, radiusKm: 1.2 },
    'madina-town':           { name: 'Madina Town',           lat: 33.6220, lng: 73.1200, radiusKm: 1.2 },
    'sarfraz-town':          { name: 'Sarfraz town',          lat: 33.6240, lng: 73.1140, radiusKm: 1.2 },
    'sharifabad':            { name: 'Sharifabad',            lat: 33.6300, lng: 73.1090, radiusKm: 1.2 },
    'malik-town':            { name: 'Malik Town',            lat: 33.6235, lng: 73.1310, radiusKm: 1.2 },
    'marwa-town':            { name: 'Marwa Town',            lat: 33.6190, lng: 73.1350, radiusKm: 1.5 },
    'basit-town':            { name: 'Basit town',            lat: 33.6310, lng: 73.1370, radiusKm: 1.2 },
    'albadar-masjid':        { name: 'Albadar Masjid',        lat: 33.6320, lng: 73.1305, radiusKm: 1.0 },
    'karachi-house':         { name: 'Karachi house',         lat: 33.6275, lng: 73.1280, radiusKm: 1.0 },
    'juma-bazar':            { name: 'Juma Bazar',            lat: 33.6290, lng: 73.1220, radiusKm: 1.0 },
    'school-stop':           { name: 'School Stop',           lat: 33.6455, lng: 73.1475, radiusKm: 1.2 },
    'dakhana-stop':          { name: 'Dakhana Stop',          lat: 33.6480, lng: 73.1440, radiusKm: 1.0 },
    'tali-mor':              { name: 'Tali mor',              lat: 33.6465, lng: 73.1510, radiusKm: 1.2 },
    'rehman-enclave':        { name: 'Rehman Enclave',        lat: 33.6515, lng: 73.1530, radiusKm: 1.5 },
    'zamna-bad':             { name: 'Zamna bad',             lat: 33.6390, lng: 73.1590, radiusKm: 1.5 },
    'p-v-scheme':            { name: 'P&V Scheme',            lat: 33.6410, lng: 73.1630, radiusKm: 1.8 },
    'sudran-road':           { name: 'Sudran Road',           lat: 33.6570, lng: 73.1490, radiusKm: 1.5 },
    'mehrban-town':          { name: 'Mehrban Town',          lat: 33.6440, lng: 73.1360, radiusKm: 1.2 },
    'chistiyan-market':      { name: 'Chistiyan market',      lat: 33.6520, lng: 73.1390, radiusKm: 1.2 },
    'gulberg-green':         { name: 'Gulberg green',         lat: 33.6020, lng: 73.1390, radiusKm: 3.5 },
    'gulzar-e-quaid':        { name: 'Gulzar e Quaid',        lat: 33.6080, lng: 73.1120, radiusKm: 2.5 },
};

export const RESTAURANT_CENTER = {
    lat: 33.6180334,
    lng: 73.1398525,
    maxRadiusKm: 10.0,
    mapUrl: 'https://maps.app.goo.gl/rVvANx8pRmtXrEMj9',
};

/**
 * Map micro-landmarks, stops, and chowks to their primary town/sector for GPS pin / live location matching.
 */
export const SUB_AREA_TO_PRIMARY = {
    'sanam-chok':       'ghauri-town-all-phase',
    'karachi-house':    'ghauri-town-all-phase',
    'juma-bazar':       'ghauri-town-all-phase',
    'albadar-masjid':   'ghauri-town-all-phase',
    'ghauri-vip':       'ghauri-town-all-phase',
    'basit-town':       'ghauri-town-all-phase',
    'malik-town':       'ghauri-town-all-phase',
    'marwa-town':       'ghauri-town-all-phase',
    'madina-town':      'khana-pull',
    'sarfraz-town':     'khana-pull',
    'bilal-town':       'khana-pull',
    'sharifabad':       'khana-pull',
    'zia-masjid':       'khana-pull',
    'zia-market':       'khana-pull',
    'school-stop':      'tarlai',
    'dakhana-stop':     'tarlai',
    'sudran-road':      'tarlai',
    'mehrban-town':     'tarlai',
    'chistiyan-market': 'tarlai',
    'zamna-bad':        'taramari',
    'p-v-scheme':       'taramari',
};

/**
 * Auto-seeds standard delivery areas if none exist.
 * Idempotent: uses upsert on (restaurant_id, slug).
 *
 * @param {object} [prismaClient]
 * @param {string} [restaurantId]
 * @returns {Promise<number>} Number of areas seeded/confirmed
 */
export async function ensureDeliveryAreasSeeded(prismaClient = null, restaurantId = null, force = false) {
    if (!force) return 0;
    const prisma = prismaClient || getDbClient();
    if (!prisma) return 0;

    try {
        let rid = restaurantId;
        if (!rid || rid === 'default-restaurant') {
            rid = await getDefaultRestaurantId().catch(() => null);
        } else {
            const exists = await prisma.restaurant.findUnique({
                where: { id: rid },
                select: { id: true },
            }).catch(() => null);
            if (!exists) {
                rid = await getDefaultRestaurantId().catch(() => null);
            }
        }

        if (!rid) return 0;

        console.log(`[DELIVERY] Syncing 32 delivery areas with accurate coordinates for restaurant ${rid}...`);
        const entries = Object.entries(DELIVERY_AREA_COORDINATES);
        let sortOrder = 1;

        for (const [slug, item] of entries) {
            await prisma.deliveryArea.upsert({
                where: {
                    restaurant_id_slug: {
                        restaurant_id: rid,
                        slug,
                    },
                },
                update: {
                    name: item.name,
                    latitude: item.lat,
                    longitude: item.lng,
                    radius_km: item.radiusKm,
                },
                create: {
                    restaurant_id: rid,
                    name: item.name,
                    slug,
                    delivery_fee: 0,
                    minimum_order: 0,
                    is_active: true,
                    sort_order: sortOrder++,
                    latitude: item.lat,
                    longitude: item.lng,
                    radius_km: item.radiusKm,
                },
            });
        }

        console.log(`[DELIVERY] ✅ 32 delivery areas successfully synced for restaurant ${rid}.`);
        return entries.length;
    } catch (err) {
        console.error('[DELIVERY] Error auto-seeding delivery areas:', err.message);
        return 0;
    }
}


function escapeRegex(string) {
    return string.replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&');
}

/**
 * Helper to match text against known areas.
 */
function findAreaByText(areas, text) {
    if (!text || typeof text !== 'string') return null;
    const cleanLower = text.toLowerCase().replace(/[,.-]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!cleanLower || cleanLower === 'islamabad' || cleanLower === 'rawalpindi' || cleanLower === 'pakistan') {
        return null;
    }

    // 1. Exact name or slug match
    let found = areas.find(a => 
        a.name.toLowerCase() === cleanLower ||
        a.slug.toLowerCase() === cleanLower
    );
    if (found) return found;

    // 2. Check Area Aliases configured in Dashboard / DB
    for (const a of areas) {
        if (!a.aliases || typeof a.aliases !== 'string') continue;
        const aliasList = a.aliases.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        for (const alias of aliasList) {
            if (cleanLower === alias) return a;
            const regex = new RegExp(`(^|\\s)${escapeRegex(alias)}(\\s|$)`, 'i');
            if (regex.test(cleanLower)) return a;
            if (alias.length >= 4 && (cleanLower.includes(alias) || alias.includes(cleanLower))) {
                return a;
            }
        }
    }

    // 3. Name word boundary matching on DB areas
    for (const a of areas) {
        const aName = a.name.toLowerCase();
        const regex = new RegExp(`(^|\\s)${escapeRegex(aName)}(\\s|$)`, 'i');
        if (regex.test(cleanLower)) return a;
    }

    // 4. Precise Pakistani Area Aliases & Rule-based Matching fallback
    if (cleanLower.includes('dakhana') || cleanLower.includes('dak hana')) {
        found = areas.find(a => a.slug === 'dakhana-stop' || a.slug === 'tarlai');
    } else if (cleanLower.includes('khanna') || cleanLower.includes('khana pull') || cleanLower.includes('khana pul') || (cleanLower.includes('khana') && !cleanLower.includes('dak'))) {
        found = areas.find(a => a.slug === 'khana-pull');
    }

    if (!found && (cleanLower.includes('ghauri') || cleanLower.includes('ghori'))) {
        if (cleanLower.includes('vip') || cleanLower.includes('vvip')) {
            found = areas.find(a => a.slug === 'ghauri-vip');
        } else if (cleanLower.includes('garden')) {
            found = areas.find(a => a.slug === 'ghauri-garden');
        } else {
            found = areas.find(a => a.slug === 'ghauri-town-all-phase');
        }
    } else if (!found && (cleanLower.includes('vip') || cleanLower.includes('vvip'))) {
        found = areas.find(a => a.slug === 'ghauri-vip');
    }

    if (!found) {
        if (cleanLower.includes('rehman')) found = areas.find(a => a.slug === 'rehman-enclave');
        else if (cleanLower.includes('gulberg')) found = areas.find(a => a.slug === 'gulberg-green');
        else if (cleanLower.includes('gulzar')) found = areas.find(a => a.slug === 'gulzar-e-quaid');
        else if (cleanLower.includes('sanam')) found = areas.find(a => a.slug === 'sanam-chok');
        else if (cleanLower.includes('tarlai')) found = areas.find(a => a.slug === 'tarlai');
        else if (cleanLower.includes('taramari')) found = areas.find(a => a.slug === 'taramari');
        else if (cleanLower.includes('burma')) found = areas.find(a => a.slug === 'burma');
        else if (cleanLower.includes('shakral') || cleanLower.includes('shakrial')) found = areas.find(a => a.slug === 'shakral');
        else if (cleanLower.includes('zia masjid')) found = areas.find(a => a.slug === 'zia-masjid');
        else if (cleanLower.includes('zia market')) found = areas.find(a => a.slug === 'zia-market');
        else if (cleanLower.includes('bilal')) found = areas.find(a => a.slug === 'bilal-town');
        else if (cleanLower.includes('madina')) found = areas.find(a => a.slug === 'madina-town');
        else if (cleanLower.includes('malik')) found = areas.find(a => a.slug === 'malik-town');
        else if (cleanLower.includes('marwa')) found = areas.find(a => a.slug === 'marwa-town');
        else if (cleanLower.includes('mehrban')) found = areas.find(a => a.slug === 'mehrban-town');
        else if (cleanLower.includes('sarfraz')) found = areas.find(a => a.slug === 'sarfraz-town');
        else if (cleanLower.includes('basit')) found = areas.find(a => a.slug === 'basit-town');
        else if (cleanLower.includes('albadar') || cleanLower.includes('al badar')) found = areas.find(a => a.slug === 'albadar-masjid');
        else if (cleanLower.includes('sudran')) found = areas.find(a => a.slug === 'sudran-road');
        else if (cleanLower.includes('school')) found = areas.find(a => a.slug === 'school-stop');
        else if (cleanLower.includes('zamna')) found = areas.find(a => a.slug === 'zamna-bad');
        else if (cleanLower.includes('p&v') || cleanLower.includes('pv')) found = areas.find(a => a.slug === 'p-v-scheme');
        else if (cleanLower.includes('chistiyan') || cleanLower.includes('chishtian')) found = areas.find(a => a.slug === 'chistiyan-market');
        else if (cleanLower.includes('sharif')) found = areas.find(a => a.slug === 'sharifabad');
        else if (cleanLower.includes('tali')) found = areas.find(a => a.slug === 'tali-mor');
        else if (cleanLower.includes('karachi house')) found = areas.find(a => a.slug === 'karachi-house');
        else if (cleanLower.includes('juma bazar')) found = areas.find(a => a.slug === 'juma-bazar');
    }

    if (!found) {
        found = areas.find(a => {
            const aName = a.name.toLowerCase();
            if (cleanLower.length >= 4 && (cleanLower.includes(aName) || aName.includes(cleanLower))) {
                if (cleanLower.includes('vip') && aName !== 'ghauri vip') return false;
                if (!cleanLower.includes('vip') && aName === 'ghauri vip') return false;
                if (aName === 'dakhana stop' && (cleanLower.includes('khanna') || cleanLower.includes('pull') || cleanLower.includes('pul'))) return false;
                return true;
            }
            return false;
        });
    }

    return found || null;
}

/**
 * Validate and resolve delivery availability and fee for an area or coordinates.
 *
 * @param {Object} params
 * @param {string} [params.restaurantId]
 * @param {string} [params.areaId]
 * @param {string} [params.areaName]
 * @param {string} [params.address]
 * @param {number} [params.latitude]
 * @param {number} [params.longitude]
 * @param {number} [params.subtotal]
 * @returns {Promise<Object>}
 */
export async function checkDeliveryAvailability(params) {
    const prisma = getDbClient();
    const restaurantId = params.restaurantId || 'default-restaurant';
    const { areaId, areaName, address, subtotal } = params;

    let lat = (params.latitude != null && !isNaN(Number(params.latitude))) ? Number(params.latitude) : null;
    let lng = (params.longitude != null && !isNaN(Number(params.longitude))) ? Number(params.longitude) : null;

    // Auto-extract coords from areaName/address if Google Maps URL or query was passed
    if ((lat == null || lng == null) && (areaName || address)) {
        const textToSearch = `${areaName || ''} ${address || ''}`;
        const urlMatch = textToSearch.match(/(?:q=|@)(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
        if (urlMatch) {
            lat = Number(urlMatch[1]);
            lng = Number(urlMatch[2]);
        }
    }

    let matchedArea = null;

    // Determine restaurant center and max delivery radius (dynamically from cache or DB settings)
    let centerLat = RESTAURANT_CENTER.lat;
    let centerLng = RESTAURANT_CENTER.lng;
    let maxRadiusKm = RESTAURANT_CENTER.maxRadiusKm;

    try {
        const { getCatalogCache } = await import('./catalogCacheService.js');
        const cache = await getCatalogCache();
        if (cache) {
            if (typeof cache.maxDeliveryRadiusKm === 'number') maxRadiusKm = cache.maxDeliveryRadiusKm;
            if (typeof cache.restaurantLat === 'number') centerLat = cache.restaurantLat;
            if (typeof cache.restaurantLng === 'number') centerLng = cache.restaurantLng;
        }
    } catch (_) {}

    if (prisma) {
        try {
            const settings = await prisma.restaurantSetting.findMany({
                where: {
                    restaurant_id: restaurantId,
                    key: { in: ['max_delivery_radius_km', 'restaurant_lat', 'restaurant_lng'] },
                },
            });
            for (const s of settings) {
                if (s.key === 'max_delivery_radius_km' && !isNaN(parseFloat(s.value))) {
                    maxRadiusKm = parseFloat(s.value);
                } else if (s.key === 'restaurant_lat' && !isNaN(parseFloat(s.value))) {
                    centerLat = parseFloat(s.value);
                } else if (s.key === 'restaurant_lng' && !isNaN(parseFloat(s.value))) {
                    centerLng = parseFloat(s.value);
                }
            }
        } catch (_) {}
    }

    // 1. Direct Area ID
    if (areaId && prisma) {
        const area = await prisma.deliveryArea.findFirst({
            where: {
                id: areaId,
                restaurant_id: restaurantId,
            },
        }).catch(() => null);
        if (area) {
            if (!area.is_active) {
                return { available: false, code: 'DELIVERY_NOT_AVAILABLE', message: 'Delivery is currently unavailable in this area' };
            }
            matchedArea = area;
        }
    }

    // 2. Fetch all configured areas for this restaurant (with offline fallback)
    let allAreas = [];
    if (prisma) {
        try {
            allAreas = await prisma.deliveryArea.findMany({
                where: { restaurant_id: restaurantId },
                orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
            });
            if (allAreas.length === 0) {
                allAreas = await prisma.deliveryArea.findMany({
                    where: {},
                    orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
                });
            }
        } catch (_) {}
    }

    if (!allAreas || allAreas.length === 0) {
        allAreas = Object.entries(DELIVERY_AREA_COORDINATES).map(([slug, item], idx) => ({
            id: `area_${slug}`,
            restaurant_id: restaurantId || 'default-restaurant',
            name: item.name,
            slug,
            delivery_fee: 0,
            minimum_order: 0,
            is_active: true,
            sort_order: idx + 1,
            latitude: item.lat,
            longitude: item.lng,
            radius_km: item.radiusKm || 2.5,
            aliases: '',
        }));
    }

    // 3. If GPS coordinates provided, match by circular radius first
    if (!matchedArea && lat != null && lng != null) {
        const distToRestaurant = calculateHaversineDistance(lat, lng, centerLat, centerLng);
        const activeAreas = allAreas.filter(a => a.is_active);

        // Check if GPS pin falls within any explicitly configured active delivery area
        const matchingApprovedArea = activeAreas.find(a => {
            const coords = DELIVERY_AREA_COORDINATES[a.slug];
            const areaLat = (a.latitude != null && a.latitude !== 0) ? a.latitude : coords?.lat;
            const areaLng = (a.longitude != null && a.longitude !== 0) ? a.longitude : coords?.lng;
            if (areaLat == null || areaLng == null) return false;
            const distToAreaCenter = calculateHaversineDistance(lat, lng, areaLat, areaLng);
            const radiusKm = (a.radius_km != null && a.radius_km > 0) ? a.radius_km : (coords?.radiusKm || 1.5);
            return distToAreaCenter <= radiusKm;
        });

        // 0.35 km soft tolerance buffer for boundary landmarks (e.g. Khanna Pul at 3.05 - 3.1 km)
        const effectiveMaxRadius = maxRadiusKm + 0.35;

        if (distToRestaurant > effectiveMaxRadius && !matchingApprovedArea) {
            const outOfDeliveryMsg = await getOutOfDeliveryMessage(restaurantId, distToRestaurant, maxRadiusKm);
            return {
                available: false,
                code: 'DELIVERY_OUT_OF_RANGE',
                message: outOfDeliveryMsg,
                distanceKm: Math.round(distToRestaurant * 10) / 10,
                maxRadiusKm,
            };
        }

        // Rank areas by distance from the shared coordinates to each area's known center
        const rankedAreas = activeAreas.map(a => {
            const coords = DELIVERY_AREA_COORDINATES[a.slug];
            const areaLat = (a.latitude != null && a.latitude !== 0) ? a.latitude : (coords?.lat ?? centerLat);
            const areaLng = (a.longitude != null && a.longitude !== 0) ? a.longitude : (coords?.lng ?? centerLng);
            const dist = calculateHaversineDistance(lat, lng, areaLat, areaLng);
            const radiusKm = (a.radius_km != null && a.radius_km > 0) ? a.radius_km : (coords?.radiusKm || 2.5);
            return { area: a, distance: dist, radiusKm };
        });

        rankedAreas.sort((a, b) => a.distance - b.distance);

        if (rankedAreas.length > 0) {
            matchedArea = rankedAreas[0].area;
        } else {
            matchedArea = {
                id: 'radius-zone',
                name: 'Delivery Zone',
                slug: 'delivery-zone',
                delivery_fee: 0,
                minimum_order: 0,
                is_active: true,
            };
        }
    }

    // 4. Match by name or address if coordinates were not provided or did not resolve
    const rawAddressText = `${areaName || ''} ${address || ''}`.trim();
    if (!matchedArea && rawAddressText) {
        let textFound = findAreaByText(allAreas, rawAddressText);
        if (!textFound) {
            const fallbackAreas = Object.entries(DELIVERY_AREA_COORDINATES).map(([slug, item]) => ({
                id: 'radius-zone',
                name: item.name,
                slug,
                latitude: item.lat,
                longitude: item.lng,
                radius_km: item.radiusKm,
                delivery_fee: 0,
                minimum_order: 0,
                is_active: true,
            }));
            textFound = findAreaByText(fallbackAreas, rawAddressText);
        }
        if (textFound && textFound.is_active) {
            matchedArea = textFound;
        }
    }

    // Ensure coordinates are resolved for matched area using accurate landmark coords
    if (matchedArea && (lat == null || lng == null)) {
        const coords = DELIVERY_AREA_COORDINATES[matchedArea.slug];
        if (coords?.lat != null && coords?.lng != null) {
            lat = coords.lat;
            lng = coords.lng;
        } else if (matchedArea.latitude != null && matchedArea.latitude !== 0 && matchedArea.longitude != null && matchedArea.longitude !== 0) {
            lat = Number(matchedArea.latitude);
            lng = Number(matchedArea.longitude);
        }
    }

    if (matchedArea && (lat == null || lng == null)) {
        try {
            const geoRes = await geocodeAddress(`${matchedArea.name}, Islamabad`, { centerLat, centerLng });
            if (geoRes && geoRes.success) {
                lat = geoRes.latitude;
                lng = geoRes.longitude;
            }
        } catch (_) {}
    }

    // 5. Map micro-landmarks, stops, and chowks to their primary town/sector (e.g. Sanam Chowk -> Ghauri Town)
    if (matchedArea && SUB_AREA_TO_PRIMARY[matchedArea.slug]) {
        const primarySlug = SUB_AREA_TO_PRIMARY[matchedArea.slug];
        const primary = allAreas.find(a => a.slug === primarySlug && a.is_active);
        if (primary) {
            matchedArea = primary;
        }
    }

    // 6. Phase 3: Automated Geocoding fallback when text is not in static DB areas
    if (!matchedArea && (lat == null || lng == null) && rawAddressText.length >= 3) {
        try {
            const queryText = /islamabad|rawalpindi/i.test(rawAddressText) ? rawAddressText : `${rawAddressText}, Islamabad`;
            const geocodeResult = await geocodeAddress(queryText, {
                centerLat,
                centerLng,
            });

            if (geocodeResult && geocodeResult.success) {
                const geoDist = geocodeResult.distanceKm;
                const effectiveMaxRadius = maxRadiusKm + 0.35;
                if (geoDist > effectiveMaxRadius) {
                    const outOfDeliveryMsg = await getOutOfDeliveryMessage(restaurantId, geoDist, maxRadiusKm);
                    return {
                        available: false,
                        code: 'DELIVERY_OUT_OF_RANGE',
                        message: outOfDeliveryMsg,
                        distanceKm: Math.round(geoDist * 10) / 10,
                        maxRadiusKm,
                    };
                }

                // Within range! Assign geocoded coordinates
                lat = geocodeResult.latitude;
                lng = geocodeResult.longitude;

                const activeAreas = allAreas.filter(a => a.is_active);
                const rankedAreas = activeAreas.map(a => {
                    const coords = DELIVERY_AREA_COORDINATES[a.slug];
                    const aLat = (a.latitude != null && a.latitude !== 0) ? a.latitude : (coords?.lat ?? centerLat);
                    const aLng = (a.longitude != null && a.longitude !== 0) ? a.longitude : (coords?.lng ?? centerLng);
                    const dist = calculateHaversineDistance(lat, lng, aLat, aLng);
                    const rKm = (a.radius_km != null && a.radius_km > 0) ? a.radius_km : (coords?.radiusKm || 2.5);
                    return { area: a, distance: dist, radiusKm: rKm };
                });

                rankedAreas.sort((a, b) => a.distance - b.distance);

                if (rankedAreas.length > 0) {
                    matchedArea = rankedAreas[0].area;
                } else {
                    matchedArea = {
                        id: 'radius-zone',
                        name: 'Delivery Zone',
                        slug: 'delivery-zone',
                        delivery_fee: 0,
                        minimum_order: 0,
                        is_active: true,
                    };
                }
            }
        } catch (_) {}
    }

    // 7. If still not matched, check if DB has no areas configured -> allow open delivery
    if (!matchedArea) {
        if (allAreas.length === 0 && rawAddressText.length >= 5) {
            matchedArea = {
                id: 'radius-zone',
                name: 'Standard Delivery',
                slug: 'standard-delivery',
                delivery_fee: 0,
                minimum_order: 0,
                is_active: true,
            };
        } else {
            if (areaName || address) {
                const outOfDeliveryMsg = await getOutOfDeliveryMessage(restaurantId, null, maxRadiusKm);
                return {
                    available: false,
                    code: 'DELIVERY_NOT_AVAILABLE',
                    message: outOfDeliveryMsg,
                    maxRadiusKm,
                };
            }
            return {
                available: false,
                code: 'INVALID_DELIVERY_REQUEST',
                message: 'Delivery check karne ke liye barah-e-karam apna area ya WhatsApp location pin share karein.',
            };
        }
    }

    const deliveryFee = Number(matchedArea.delivery_fee);
    const minimumOrder = matchedArea.minimum_order != null ? Number(matchedArea.minimum_order) : 0;
    const hasSubtotal = subtotal != null && !isNaN(Number(subtotal));
    const subtotalNum = hasSubtotal ? Number(subtotal) : null;
    const minMet = subtotalNum !== null ? subtotalNum >= minimumOrder : true;

    // Clean, natural display name for customers
    const rawName = matchedArea.name;
    const cleanDisplayName = rawName
        .replace(/\s+all\s+phase/i, '')
        .replace(/^Gulberg green$/i, 'Gulberg Greens')
        .replace(/^Khana Pull$/i, 'Khanna Pul')
        .trim();

    // Construct the formatted delivery address from shared location
    const mapUrl = (lat != null && lng != null) ? `https://www.google.com/maps?q=${lat},${lng}` : null;
    let deliveryAddress = '';

    const candidateText = [address, areaName].filter(Boolean).find(t => t && !t.startsWith('http') && !t.includes('lat='));
    if (candidateText && candidateText.trim().length > 0) {
        deliveryAddress = candidateText.trim();
        if (!deliveryAddress.toLowerCase().includes(cleanDisplayName.toLowerCase())) {
            deliveryAddress = `${deliveryAddress}, ${cleanDisplayName}`;
        }
    } else {
        deliveryAddress = cleanDisplayName;
    }

    if (mapUrl && !deliveryAddress.includes('maps.google.com') && !deliveryAddress.includes('google.com/maps')) {
        deliveryAddress += ` (Location Pin: ${mapUrl})`;
    }

    const distToRest = (lat != null && lng != null)
        ? Math.round(calculateHaversineDistance(lat, lng, centerLat, centerLng) * 10) / 10
        : null;

    // Strict circular radius enforcement across ALL matched areas and text lookups
    if (distToRest != null && distToRest > maxRadiusKm) {
        const outOfDeliveryMsg = await getOutOfDeliveryMessage(restaurantId, distToRest, maxRadiusKm);
        return {
            available: false,
            code: 'DELIVERY_OUT_OF_RANGE',
            message: outOfDeliveryMsg,
            distanceKm: distToRest,
            maxRadiusKm,
        };
    }

    return {
        available: true,
        area: {
            id: matchedArea.id,
            name: cleanDisplayName,
            originalName: matchedArea.name,
            slug: matchedArea.slug,
            deliveryFee,
            minimumOrder,
        },
        deliveryFee,
        minimumOrder,
        minimumMet: minMet,
        deliveryAddress,
        formattedAddress: deliveryAddress,
        latitude: lat,
        longitude: lng,
        googleMapsUrl: mapUrl,
        distanceKm: distToRest,
        maxRadiusKm,
        ...(minMet ? {} : {
            code: 'DELIVERY_MINIMUM_NOT_MET',
            message: `Order subtotal of Rs. ${subtotalNum} is below minimum delivery order of Rs. ${minimumOrder}`,
        }),
    };
}
