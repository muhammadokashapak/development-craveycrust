import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDbClient } from '../src/db/client.js';
import { getDefaultRestaurantId } from '../src/services/restaurantService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../data');
const CHAT_BACKUP_FILE = path.join(DATA_DIR, 'customer_chats.json');

const PAST_CONVERSATIONS = [
    // ══════════════════════════════════════════════════════════════════════════
    // Customer 1: Okasha (03495696659) - Orders CC-000012, 14, 15, 16, 17
    // ══════════════════════════════════════════════════════════════════════════
    {
        chatId: '240071710126199@lid',
        phone: '03495696659',
        customerName: 'Okasha',
        messages: [
            { sender: 'user', text: 'hello', timeOffset: -7200 },
            { sender: 'bot', text: 'Walaikum Assalam! Khushamdeed! Main aapki kya madad kar sakta hoon? Hamara menu dekhna chahenge ya koi deal order karni hai?', timeOffset: -7195 },
            { sender: 'user', text: 'tumhary pas best item konsa ha', timeOffset: -7100 },
            { sender: 'bot', text: 'Hamare paas Premium Pizza Meal for 3, Zinger Burger Deal, aur Behari Kebab Pizza sab se zyada pasand kiye jaate hain! Aap kya try karna chahenge?', timeOffset: -7092 },
            { sender: 'user', text: 'acha bhook lagi hoi ha dono kr do y', timeOffset: -7000 },
            { sender: 'bot', text: 'Theek hai! Dono items aapke cart mein add kar diye gaye hain. Kya aap in ka size specify karna chahenge?', timeOffset: -6990 },
            { sender: 'user', text: 'dono party size mein kr do', timeOffset: -6900 },
            { sender: 'bot', text: 'Done! Dono items Party Size mein update kar diye gaye hain. Please apna Delivery Address aur payment method (Cash on Delivery ya EasyPaisa) bata dein.', timeOffset: -6890 },
            { sender: 'user', text: 'nam okasha delivery address Paracha Chowk, Tarlai same number Cash on Delivery', timeOffset: -6750 },
            { sender: 'bot', text: 'Delivery address Paracha Chowk, Tarlai note ho gaya hai. Payment Cash on Delivery. Order #CC-000014 generate ho gaya hai.', timeOffset: -6740 },
            { sender: 'user', text: 'Ghauri town vip phase Islamabad', timeOffset: -6600 },
            { sender: 'bot', text: 'Address update: House no, 55 Street Number 3, Ghauri Town VIP Phase, Islamabad.', timeOffset: -6590 },
            { sender: 'user', text: 'total bil kitna banta ha', timeOffset: -6500 },
            { sender: 'bot', text: 'Aap ka total bill Rs. 4,998 banta hai (Delivery charges shamil hain). Order confirm kar dein?', timeOffset: -6492 },
            { sender: 'user', text: 'confirm kr do', timeOffset: -6400 },
            { sender: 'bot', text: 'Shukriya Okasha! Aap ka order CC-000012 confirm ho chuka hai. Hamari delivery team jald hi aap ke address par pohnch rahi hai!', timeOffset: -6390 },
            { sender: 'user', text: 'mjhy tumhary agent se baat krni ha', timeOffset: -6200 },
            { sender: 'bot', text: 'Aap ki chat human support manager ko alert bhej di gayi hai. Representative rabta karega.', timeOffset: -6195 },
            { sender: 'user', text: 'Menu Dikkhao', timeOffset: -5500 },
            { sender: 'bot', text: 'Categories: 1. Pizzas 2. Burgers 3. Value Deals 4. Beverages. Aap ko kya dekhna hai?', timeOffset: -5492 },
            { sender: 'user', text: 'yrr Tumhari service bht slow ha', timeOffset: -5200 },
            { sender: 'bot', text: 'Mafi chahte hain! Hum delivery rider ko expedite karwa rahe hain taake aap ka khana garam pohnche.', timeOffset: -5190 },
            { sender: 'user', text: 'mere abhi kitny order hen', timeOffset: -5000 },
            { sender: 'bot', text: 'Aap ke record mein abhi confirmed orders mojood hain jin mein CC-000012 aur CC-000014 delivery queue mein hain.', timeOffset: -4992 },
            { sender: 'user', text: 'sari deals confirm kr do pizza wali party size mein', timeOffset: -4400 },
            { sender: 'bot', text: 'Pizza deals party size mein cart mein shamil kar di gayi hain! Total: Rs. 20,985.', timeOffset: -4390 },
            { sender: 'user', text: 'khanna pul mein delivery krni ha numbr sam ryga', timeOffset: -4300 },
            { sender: 'bot', text: 'Delivery address Khanna Pul aur payment Cash on Delivery note ho gaya hai.', timeOffset: -4290 },
            { sender: 'user', text: 'payment COD', timeOffset: -4200 },
            { sender: 'bot', text: 'Shukriya Smileee! Order #CC-000016 kamyabi se confirm ho gaya! Total amount: Rs. 20,985.', timeOffset: -4190 },
            { sender: 'user', text: 'Hello', timeOffset: -3000 },
            { sender: 'bot', text: 'Walaikum Assalam Okasha! Khushamdeed dobara! Aaj kya mangwayenge?', timeOffset: -2995 },
            { sender: 'user', text: 'han bhaie kya ha menu mein', timeOffset: -2900 },
            { sender: 'bot', text: 'Hamare paas Behari Kebab Pizza, Chicken Tikka, Fajita, aur Zinger Burgers available hain.', timeOffset: -2890 },
            { sender: 'user', text: 'behari kebab kr do party Size', timeOffset: -2800 },
            { sender: 'bot', text: 'Behari Kebab Party Size cart mein add kar diya gaya hai!', timeOffset: -2792 },
            { sender: 'user', text: 'large kr do', timeOffset: -2700 },
            { sender: 'bot', text: 'Size Large update ho gaya.', timeOffset: -2692 },
            { sender: 'user', text: 'easypaisa kr do payment method name okasha ha', timeOffset: -2600 },
            { sender: 'bot', text: 'Payment EasyPaisa select ho gaya hai: 03495696659.', timeOffset: -2592 },
            { sender: 'user', text: 'location Ghauri VIP block', timeOffset: -2500 },
            { sender: 'bot', text: 'Location Ghauri VIP Block set kar di gayi hai.', timeOffset: -2492 },
            { sender: 'user', text: 'han kr do', timeOffset: -2400 },
            { sender: 'bot', text: 'Mubarak ho! Aap ka order CC-000017 confirm ho gaya hai! Grand Total: Rs. 34,976.', timeOffset: -2390 },
        ]
    },

    // ══════════════════════════════════════════════════════════════════════════
    // Customer 2: Ali (03470393013) - Orders CC-000011, CC-000013
    // ══════════════════════════════════════════════════════════════════════════
    {
        chatId: '178447737462918@lid',
        phone: '03470393013',
        customerName: 'Ali',
        messages: [
            { sender: 'user', text: 'Hiii', timeOffset: -7500 },
            { sender: 'bot', text: 'Walaikum Assalam! Khushamdeed! Main aap ki kya khidmat kar sakta hoon?', timeOffset: -7495 },
            { sender: 'user', text: 'Khana order Karna tha', timeOffset: -7400 },
            { sender: 'bot', text: 'Ji zaroor! Hamare paas fresh pizzas, crispy burgers aur special deals mojood hain. Aap kya mangwana chahenge?', timeOffset: -7390 },
            { sender: 'user', text: 'Menu batao na g', timeOffset: -7300 },
            { sender: 'bot', text: 'Hamari top deals:\n- Deal 1: 1 Zinger Burger + Regular Fries + Drink\n- Deal 2: 1 Medium Pizza + 2 Drinks\n- Deal 3: 2 Large Pizzas + 1.5L Drink\nAap ko kaunsi pasand hai?', timeOffset: -7290 },
            { sender: 'user', text: 'Deal 3 kar do', timeOffset: -7200 },
            { sender: 'bot', text: 'Deal 3 cart mein add ho gayi hai!', timeOffset: -7192 },
            { sender: 'user', text: 'Sat AK Pani ki botal kar do', timeOffset: -7100 },
            { sender: 'bot', text: 'Mineral Water botal bhi cart mein add kar di gayi hai!', timeOffset: -7092 },
            { sender: 'user', text: 'Meara total bill Katna bana ha', timeOffset: -7000 },
            { sender: 'bot', text: 'Aap ka Deal 3 + Mineral Water mila kar total Rs. 6,068 banta hai (delivery shamil hai).', timeOffset: -6992 },
            { sender: 'user', text: 'Ok done karo na khan', timeOffset: -6900 },
            { sender: 'bot', text: 'Please apna naam, delivery location aur payment method bata dein taake order book ho sake.', timeOffset: -6892 },
            { sender: 'user', text: 'Ali meara name ha shah g gueat house meari location ha payment easy paisa', timeOffset: -6800 },
            { sender: 'bot', text: 'Ji Ali bhai, Shah G Guest House delivery aur EasyPaisa payment note ho gaya hai. Final confirmation ke liye "han kar do" bhej dein.', timeOffset: -6790 },
            { sender: 'user', text: 'Hn kar do Yar', timeOffset: -6700 },
            { sender: 'bot', text: 'Shukriya Ali bhai! Order #CC-000011 kamyabi se confirm ho chuka hai! Kitchen mein tayari shuru ho gayi hai.', timeOffset: -6690 },
        ]
    },

    // ══════════════════════════════════════════════════════════════════════════
    // Customer 3: Asim (03324400131)
    // ══════════════════════════════════════════════════════════════════════════
    {
        chatId: '923324400131@s.whatsapp.net',
        phone: '03324400131',
        customerName: 'Asim',
        messages: [
            { sender: 'user', text: 'hii', timeOffset: -8500 },
            { sender: 'bot', text: 'Walaikum Assalam! Khushamdeed! Main aap ki kya madad kar sakta hoon?', timeOffset: -8495 },
            { sender: 'user', text: 'menu dikhao', timeOffset: -8400 },
            { sender: 'bot', text: 'Hamare paas Pizza Deals, Burger Deals, Wraps aur Drinks dastiyab hain. Aap kya dekhna chahenge?', timeOffset: -8392 },
            { sender: 'user', text: 'deal 5 mai kya kya h?', timeOffset: -8300 },
            { sender: 'bot', text: 'Deal 5 mein 1 Large Pizza + 2 Zinger Burgers + 1.5L Drink shamil hai sirf Rs. 2,499 mein.', timeOffset: -8290 },
            { sender: 'user', text: 'han order kr du', timeOffset: -8200 },
            { sender: 'bot', text: 'Deal 5 cart mein add kar di gayi hai! Apna delivery address aur naam bata dein.', timeOffset: -8192 },
            { sender: 'user', text: 'name asim ha phone number same jis sai msg kr rha ho delivery dhoke kala khan ha', timeOffset: -8100 },
            { sender: 'bot', text: 'Asim bhai, Dhoke Kala Khan address note ho gaya hai. Payment method Cash on Delivery select hua hai.', timeOffset: -8090 },
            { sender: 'user', text: 'Customer ne location share ki: lat=33.648047, lng=73.0928036, url=https://maps.google.com/?q=33.648047,73.0928036', timeOffset: -8000 },
            { sender: 'bot', text: 'GPS Location receive ho gayi hai! Location confirm ho chuki hai.', timeOffset: -7990 },
            { sender: 'user', text: 'cash on delivery krni ha', timeOffset: -7900 },
            { sender: 'bot', text: 'Cash on delivery confirm! Order tayar kiya ja raha hai.', timeOffset: -7890 },
            { sender: 'user', text: 'mera order confirmation du howa k nai', timeOffset: -7800 },
            { sender: 'bot', text: 'Ji haan Asim bhai, aap ka order successfully confirm ho chuka hai aur rider raste mein hai.', timeOffset: -7790 },
        ]
    },

    // ══════════════════════════════════════════════════════════════════════════
    // Customer 4: 03278497923
    // ══════════════════════════════════════════════════════════════════════════
    {
        chatId: '86634523582505@lid',
        phone: '03278497923',
        customerName: 'Customer (03278497923)',
        messages: [
            { sender: 'user', text: 'Hello', timeOffset: -4000 },
            { sender: 'bot', text: 'Walaikum Assalam! Khushamdeed! Aaj aap kya mangwayenge?', timeOffset: -3995 },
            { sender: 'user', text: 'Bhook lagi ha kch acha sa batao', timeOffset: -3900 },
            { sender: 'bot', text: 'Hamari Deal 4 (Medium Pizza + Fries + Drink) ya Double Zinger Burger Meal bohot zabardast choice hai!', timeOffset: -3890 },
            { sender: 'user', text: 'Deal 4', timeOffset: -3800 },
            { sender: 'bot', text: 'Deal 4 cart mein add ho gayi!', timeOffset: -3792 },
            { sender: 'user', text: 'Customer ne location share ki: lat=33.6264068, lng=73.1187324', timeOffset: -3700 },
            { sender: 'bot', text: 'Location receive ho gayi hai. Total bill Rs. 1,450. Cash on delivery par confirm karein?', timeOffset: -3690 },
            { sender: 'user', text: 'Cash on delivery', timeOffset: -3600 },
            { sender: 'bot', text: 'Aap ka order process ho gaya hai! Shukriya.', timeOffset: -3590 },
            { sender: 'user', text: 'Tumhari caprii theek nahi ha. Apny manager se baat krwao', timeOffset: -1200 },
            { sender: 'bot', text: 'Mafi chahte hain! Hum ne manager ko notify kar diya hai, wo jald aap ko call ya message karenge.', timeOffset: -1190 },
        ]
    },

    // ══════════════════════════════════════════════════════════════════════════
    // Customer 5: 03130549931
    // ══════════════════════════════════════════════════════════════════════════
    {
        chatId: '19014558462153@lid',
        phone: '03130549931',
        customerName: 'Customer (03130549931)',
        messages: [
            { sender: 'user', text: 'kyaa chal rha h', timeOffset: -5000 },
            { sender: 'bot', text: 'Walaikum Assalam! Khidmat ke liye hazir hain. Kya aap khana order karna chahte hain?', timeOffset: -4995 },
            { sender: 'user', text: 'deal 5 kr du', timeOffset: -4900 },
            { sender: 'bot', text: 'Deal 5 cart mein add kar di gayi hai! Apna delivery address share karein.', timeOffset: -4890 },
            { sender: 'user', text: 'ok kro', timeOffset: -4800 },
            { sender: 'bot', text: 'Order receive ho gaya hai! Shukriya.', timeOffset: -4790 },
        ]
    }
];

async function seedPastChats() {
    console.log('🌱 Starting past customer chats seeding...');

    const prisma = getDbClient();
    const restId = await getDefaultRestaurantId().catch(() => null);
    console.log('Restaurant ID:', restId);

    const now = Date.now();
    const localStore = [];
    const dbRows = [];

    for (const conv of PAST_CONVERSATIONS) {
        for (const m of conv.messages) {
            const createdAt = new Date(now + (m.timeOffset * 1000));
            const id = `chat_${createdAt.getTime()}_${Math.random().toString(36).substring(2, 7)}`;

            const entry = {
                id,
                restaurant_id: restId || 'cmv8uhedo00009ozj7ssctgc1',
                chat_id: conv.chatId,
                phone: conv.phone,
                customer_name: conv.customerName,
                sender: m.sender,
                message: m.text,
                message_type: 'text',
                created_at: createdAt.toISOString(),
            };
            localStore.push(entry);

            dbRows.push({
                id,
                restaurant_id: restId || 'cmv8uhedo00009ozj7ssctgc1',
                chat_id: conv.chatId,
                phone: conv.phone,
                customer_name: conv.customerName,
                sender: m.sender,
                message: m.text,
                message_type: 'text',
                created_at: createdAt,
            });
        }
    }

    // 1. Write to data/customer_chats.json
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(CHAT_BACKUP_FILE, JSON.stringify(localStore, null, 2), 'utf8');
    console.log(`✅ Saved ${localStore.length} messages to ${CHAT_BACKUP_FILE}`);

    // 2. Persist to PostgreSQL via Prisma
    if (prisma && prisma.chatMessage) {
        try {
            await prisma.chatMessage.deleteMany({}); // clear any partial
            await prisma.chatMessage.createMany({
                data: dbRows,
            });
            console.log(`✅ Inserted ${dbRows.length} messages into PostgreSQL 'chat_messages' table!`);
        } catch (dbErr) {
            console.warn('⚠️ Prisma insert failed, but JSON backup is intact:', dbErr.message);
        }
    }

    console.log('🎉 Past chats successfully seeded!');
    process.exit(0);
}

seedPastChats().catch(err => {
    console.error('Fatal seed error:', err);
    process.exit(1);
});
