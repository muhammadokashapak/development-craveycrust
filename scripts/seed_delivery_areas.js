import { getDbClient } from '../src/db/client.js';
import { getDefaultRestaurantId } from '../src/services/restaurantService.js';

const CORE_AREAS = [
    {
        name: 'Ghauri Town all phase',
        slug: 'ghauri-town-all-phase',
        delivery_fee: 100,
        minimum_order: 500,
        latitude: 33.6261,
        longitude: 73.1255,
        radius_km: 3.5,
        aliases: 'ghauri town, ghori town, ghauri, ghori, ghauri garden, ghauri vip, sanam chowk, sanam chok, karachi house, albadar masjid, juma bazar',
        sort_order: 1,
    },
    {
        name: 'Khana Pull',
        slug: 'khana-pull',
        delivery_fee: 120,
        minimum_order: 500,
        latitude: 33.6335,
        longitude: 73.1125,
        radius_km: 3.0,
        aliases: 'khanna pul, khana pull, khana pul, khana mor, khanna interchange, madina town, sarfraz town, bilal town, sharifabad, zia masjid, zia market',
        sort_order: 2,
    },
    {
        name: 'Tarlai',
        slug: 'tarlai',
        delivery_fee: 120,
        minimum_order: 500,
        latitude: 33.6490,
        longitude: 73.1420,
        radius_km: 2.5,
        aliases: 'tarlai, tarlai kalan, dakhana stop, dak hana, school stop, sudran road, mehrban town, chistiyan market',
        sort_order: 3,
    },
    {
        name: 'Taramari',
        slug: 'taramari',
        delivery_fee: 150,
        minimum_order: 500,
        latitude: 33.6430,
        longitude: 73.1550,
        radius_km: 2.5,
        aliases: 'taramari, tarmani, tali mor, zamna bad, p&v scheme, pv scheme',
        sort_order: 4,
    },
    {
        name: 'Burma',
        slug: 'burma',
        delivery_fee: 150,
        minimum_order: 500,
        latitude: 33.6550,
        longitude: 73.1360,
        radius_km: 2.0,
        aliases: 'burma, burma bridge, burma town',
        sort_order: 5,
    },
    {
        name: 'Shakral',
        slug: 'shakral',
        delivery_fee: 130,
        minimum_order: 500,
        latitude: 33.6390,
        longitude: 73.1050,
        radius_km: 2.0,
        aliases: 'shakral, shakrial',
        sort_order: 6,
    },
    {
        name: 'Gulberg Greens',
        slug: 'gulberg-green',
        delivery_fee: 200,
        minimum_order: 800,
        latitude: 33.6020,
        longitude: 73.1390,
        radius_km: 4.0,
        aliases: 'gulberg, gulberg green, gulberg greens',
        sort_order: 7,
    },
    {
        name: 'Gulzar e Quaid',
        slug: 'gulzar-e-quaid',
        delivery_fee: 180,
        minimum_order: 700,
        latitude: 33.6080,
        longitude: 73.1120,
        radius_km: 3.0,
        aliases: 'gulzar e quaid, gulzar-e-quaid, gulzar quaid',
        sort_order: 8,
    },
];

async function seed() {
    const prisma = getDbClient();
    const restaurantId = await getDefaultRestaurantId();
    if (!restaurantId) {
        console.error('Restaurant ID not found');
        process.exit(1);
    }

    console.log(`Seeding delivery areas for restaurant: ${restaurantId}`);

    for (const area of CORE_AREAS) {
        const existing = await prisma.deliveryArea.findFirst({
            where: { restaurant_id: restaurantId, slug: area.slug },
        });

        if (existing) {
            await prisma.deliveryArea.update({
                where: { id: existing.id },
                data: {
                    latitude: area.latitude,
                    longitude: area.longitude,
                    radius_km: area.radius_km,
                    aliases: area.aliases,
                },
            });
            console.log(`Updated existing area: ${area.name}`);
        } else {
            await prisma.deliveryArea.create({
                data: {
                    restaurant_id: restaurantId,
                    name: area.name,
                    slug: area.slug,
                    delivery_fee: area.delivery_fee,
                    minimum_order: area.minimum_order,
                    is_active: true,
                    sort_order: area.sort_order,
                    latitude: area.latitude,
                    longitude: area.longitude,
                    radius_km: area.radius_km,
                    aliases: area.aliases,
                },
            });
            console.log(`Created new area: ${area.name}`);
        }
    }

    console.log('Seeding completed successfully!');
    process.exit(0);
}

seed().catch(err => {
    console.error('Seeding error:', err);
    process.exit(1);
});
