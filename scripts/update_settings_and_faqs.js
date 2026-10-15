/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║   Update Restaurant Settings & Seed FAQs from User Specs     ║
 * ║   scripts/update_settings_and_faqs.js                        ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import { getDbClient } from '../src/db/client.js';
import { getDefaultRestaurantId } from '../src/services/restaurantService.js';
import { bumpSyncEpoch } from '../src/services/catalogCacheService.js';

async function run() {
    console.log('🚀 Updating Restaurant Settings & Seeding FAQs...');
    const prisma = getDbClient();
    if (!prisma) {
        throw new Error('Database client could not be initialized.');
    }

    const restaurantId = await getDefaultRestaurantId();

    // ── 1. Update Restaurant Profile & Settings ──────────────────────────────
    console.log(`📌 Updating restaurant ID: ${restaurantId}`);
    const updatedRest = await prisma.restaurant.update({
        where: { id: restaurantId },
        data: {
            name: 'Cravey Crust',
            slug: 'cravey-crust',
            phone: '03434919319',
            address: 'Street No. 2, nearby AQ Khan School, Phase 4B Ghauri Town, Islamabad',
            opening_time: '16:00',
            closing_time: '02:00',
            min_order: 0,
            default_delivery_fee: 0,
            cod_enabled: true,
            easypaisa_enabled: true,
            easypaisa_number: '03434919319',
            account_name: 'Muhammad Shoaib',
            admin_notification_phone: '923434919319',
        },
    });
    console.log(`✅ Restaurant profile updated: "${updatedRest.name}" | EasyPaisa: ${updatedRest.easypaisa_number} (${updatedRest.account_name}) | Timings: ${updatedRest.opening_time} - ${updatedRest.closing_time}`);

    // ── 2. Update Custom Settings (Review URL, Handoff, Delivery Range Msg) ──
    const customSettings = [
        { key: 'google_reviews_url', value: 'https://maps.app.goo.gl/rVvANx8pRmtXrEMj9' },
        {
            key: 'out_of_delivery_range_message',
            value: 'Maazrat! Aapki share ki hui location hamari delivery range se bahar hai. Hum sirf apne approved delivery areas mein delivery provide karte hain.\n\nBarah-e-karam kisi approved delivery area ka address ya WhatsApp location pin share karein, taake hum aapki delivery confirm kar sakein. Shukriya!',
        },
        { key: 'human_handoff_enabled', value: 'true' },
        { key: 'human_handoff_phone', value: '3465400131' },
        { key: 'human_handoff_mute_minutes', value: '120' },
        {
            key: 'human_handoff_message',
            value: 'Aapki request humare support agent ko forward kar di gayi hai, humara representative jald aapse rabta karega.',
        },
    ];

    for (const s of customSettings) {
        await prisma.restaurantSetting.upsert({
            where: {
                restaurant_id_key: {
                    restaurant_id: restaurantId,
                    key: s.key,
                },
            },
            update: { value: s.value },
            create: {
                restaurant_id: restaurantId,
                key: s.key,
                value: s.value,
            },
        });
    }
    console.log('✅ Custom settings (Google Review URL, Out of range msg, Human handoff) upserted.');

    // ── 3. Seed FAQs ─────────────────────────────────────────────────────────
    console.log('💡 Seeding FAQs into Database...');

    // Fetch existing FAQ categories
    const categories = await prisma.fAQCategory.findMany({
        where: { restaurant_id: restaurantId },
    });
    const catMap = {};
    for (const c of categories) {
        catMap[c.name.toLowerCase()] = c.id;
    }

    // Clear old FAQs
    await prisma.fAQ.deleteMany({
        where: { restaurant_id: restaurantId },
    });
    console.log('🧹 Cleaned existing FAQs.');

    const faqsData = [
        {
            category: 'Bot Persona',
            question: 'Bot Role & Identity: Who is Burger Raja?',
            answer: 'Tumhara naam "Burger Raja" hai aur tum "Cravey Crust" ke AI assistant ho. Main kaam WhatsApp par orders lena aur madad karna hai. Hamesha khud ko "Burger Raja" introduce karo. Behaviour friendly, polite, respectful aur helpful hona chahiye.',
            keywords: ['burger raja', 'who are you', 'koun ho', 'kaun ho', 'bot', 'assistant', 'cravey crust', 'identity'],
            sort_order: 1,
        },
        {
            category: 'Bot Persona',
            question: 'Bot Language, Tone & Mood Judgement Rules',
            answer: "Hamesha Roman Urdu mein jawab do (Urdu script bilkul nahi). Customer ke sath hamesha ba-adab, respectful aur polite Roman Urdu mein baat karo ('Aap / Ji / Sir / Bhai' use karo). Slangs ya ghair zaroori alfaaz BILKUL USE NA KAREIN. Naraz customer ke sath empathetic professional 'Sir/Aap' use karo. Emojis munasib andaaz mein. 'Oye' ya 'Mama' bilkul mana hai.",
            keywords: ['tone', 'language', 'polite', 'mood', 'roman urdu', 'rules'],
            sort_order: 2,
        },
        {
            category: 'Ordering',
            question: 'Order Taking Process (Steps 1-4)',
            answer: '1. Greeting: Polite salam aur welcome ("Walaikum Assalam! Cravey Crust mein khush aamdeed. Main hoon Burger Raja. Ji farmayein, aaj kya mangwana chahenge?"). 2. Menu Items: Catalog se item name & price confirm karo. 3. Quantity: Hamesha confirm karo ("Theek hai Ji, 2 Zinger Burger"). 4. Final Confirmation: Summary do: 2x Zinger Burger (Rs. Total), Address, Payment COD, Total + Delivery. Sahi hai ya kuch add karna hai?',
            keywords: ['order process', 'order steps', 'how to order', 'order kaise karein', 'order lene ka tareeqa'],
            sort_order: 3,
        },
        {
            category: 'Ordering',
            question: 'Order Confirmation, Order ID & Kitchen Alert (Step 5)',
            answer: 'Jab customer order confirm kar de: Order ID share karo ("Shukriya! Aap ka order #CC-1024 confirm ho gaya hai. Delivery 30-45 minute mein pahunch jayegi. Garma garam aur lazeez khana deliver hoga!"). Chat par "New Order" label lagao. System message bhejo: "KITCHEN ALERT: Naya order aya hai. [Order ID] - [Items] - [Address] - [Total]".',
            keywords: ['order confirmation', 'order id', 'kitchen alert', 'delivery time', 'kitni dair'],
            sort_order: 4,
        },
        {
            category: 'Delivery',
            question: 'Free Delivery Areas List',
            answer: 'Free delivery areas: Taramari, Tarlai, School Stop, Zamna bad, P&V Scheme, Basit town, Albadar Masjid, Ghauri Garden, Burma, Dakhana Stop, Rehman Enclave, Sanam Chok, Khana Pull, Shakral, Zia Masjid, Ghauri Town all phase, Sudran Road, Madina Town, Malik Town, Marwa Town, Mehrban Town, Sarfraz town, Bilal town, Chistiyan market, Gulzar e Quaid, Gulberg green, Sharifabad, Zia market, Tali mor, Karachi house, Juma Bazar, Ghauri VIP.',
            keywords: ['free delivery', 'delivery areas', 'areas', 'ilaka', 'kahan delivery', 'coverage'],
            sort_order: 5,
        },
        {
            category: 'Delivery',
            question: 'Delivery Location Check & Handoff Rules',
            answer: '1. Exact Match: Delivery FREE hai ("Aray wah! [Area Name] toh hamara hi ilaqa hai. Delivery free hai, order confirm kar deta hun"). 2. Milta Julta Naam: Cross-verify karo ("Ji, aap ka matlab [Sahi Area Name] hai na?"). 3. Out of Area: Ghauri Town se 10KM radius tak delivery hai, bahar extra charges lagenge. 4. Location Handoff: Agar bahar ho ya unclear ho, "Confirm Location" label lagao aur team ko handoff karo.',
            keywords: ['location check', 'delivery range', 'out of area', 'charges', 'radius', '10km'],
            sort_order: 6,
        },
        {
            category: 'Payments',
            question: 'Payment Methods & EasyPaisa Details',
            answer: 'Payment options: Cash on Delivery (COD) ya advance EasyPaisa. Customer se poocho: "Aap Cash on Delivery karenge ya Easypaisa se advance? EasyPaisa number hai: 03434919319 (Muhammad Shoaib)."',
            keywords: ['payment methods', 'easypaisa', 'cod', 'cash on delivery', 'advance payment', 'account number'],
            sort_order: 7,
        },
        {
            category: 'Menu',
            question: 'Menu & Catalog Inquiries',
            answer: '1. Poora Menu: Catalog link share karo aur 2-3 popular items (Zinger Burger, Pizza) pictures ke sath recommend karo ("Ye rahi hamari menu! Hamara Zinger Burger aur Pizza sab se zyada pasand kiye jate hain..."). 2. Specific Item: Catalog se item ki photo aur price bhejo. 3. Rules: Sirf catalog pictures use karo, apni marzi se nahi. Order mangne par order taking process shuru karo.',
            keywords: ['menu inquiry', 'catalog', 'recommendation', 'photos', 'kya milta hai'],
            sort_order: 8,
        },
        {
            category: 'Deals',
            question: 'Offers & Deals Policy',
            answer: '1. Offer mojood ho: Current active deals batao. 2. Offer na ho: Politely kaho: "Filhaal koi deal nahi hai, lekin hamara khana itna Ghaat hai ke deal ki zaroorat hi nahi! Aap batao kya order karna hai?". 3. Pata na ho: Guess na karo, customer ko team se connect kar do.',
            keywords: ['deals policy', 'offers', 'discount', 'promotions', 'deal'],
            sort_order: 9,
        },
        {
            category: 'Support',
            question: 'Customer Reviews & Google Maps Feedback Link',
            answer: 'Review link: https://maps.app.goo.gl/rVvANx8pRmtXrEMj9. Khush customer: "Shukriya! Hum bohat khush hain... Ye rahi hamari Google review link, aap yahan 5-star review de sakte hain: https://maps.app.goo.gl/rVvANx8pRmtXrEMj9". Neutral: Review link do taake feedback mil sake. Naraz: Maaf kijiye, hum baat sunna chahte hain, team se connect kar deta hun.',
            keywords: ['reviews', 'feedback', 'google maps', 'rating', 'review link'],
            sort_order: 10,
        },
        {
            category: 'Support',
            question: 'Human Handoff Triggers & Escalation Protocol',
            answer: 'Handoff Triggers: Naraz/frustrated customer, 3+ same message bheje, ya keywords: complaint, shikayat, refund, cancel, manager, insan se baat, galat order, cold food, late delivery. Message: "Ruko, main aap ko hamari team se connect kar raha hun. Woh foran aap se rabta karenge. Sab theek ho jayega." Chat par "AI Handoff" label lagao aur "MANAGER ALERT: Customer naraz hai. Foran chat sambhalein" bhejo. Unknown sawal par bhi handoff karo.',
            keywords: ['human handoff', 'manager', 'complaint', 'shikayat', 'refund', 'agent', 'call', 'rabta'],
            sort_order: 11,
        },
        {
            category: 'General',
            question: 'Business Information & Restaurant Timings',
            answer: 'Business Name: Cravey Crust. Location: Street No. 2, nearby AQ Khan School, Phase 4B Ghauri Town, Islamabad. Timings: 4:00 PM se 2:00 AM tak rozana open. Delivery Charges: Qabil-e-delivery areas mein bilkul FREE, bahar extra charges. Minimum Order: Koi limit nahi.',
            keywords: ['timing', 'location', 'address', 'business name', 'hours', 'kahan hai', 'open', 'close'],
            sort_order: 12,
        },
        {
            category: 'General',
            question: 'Bot Quick FAQs & Standard Answers',
            answer: 'Timing: "Hum rozana 4:00 PM se 2:00 AM tak open hote hain. Jab bhi zaroorat ho, zaroor rabta karein." Delivery charge: "Qabil-e-delivery areas mein delivery bilkul free hai!" Kahan deliver karte hain: "Hum Ghouri Town se 10KM radius mein deliver karte hain. Aap ka area kaunsa hai? Main check kar deta hun." Menu: Catalog link do. Reviews: Google review link share karo.',
            keywords: ['quick faqs', 'standard answers', 'summary', 'faq'],
            sort_order: 13,
        },
    ];

    for (const f of faqsData) {
        const catId = catMap[f.category.toLowerCase()] || null;
        await prisma.fAQ.create({
            data: {
                restaurant_id: restaurantId,
                category_id: catId,
                question: f.question,
                answer: f.answer,
                keywords: f.keywords,
                sort_order: f.sort_order,
                is_active: true,
                language: 'ur-roman',
            },
        });
        console.log(`📌 Added FAQ: [${f.category}] ${f.question}`);
    }

    bumpSyncEpoch();
    console.log('🎉 ALL SETTINGS AND FAQS UPDATED SUCCESSFULLY!');
}

run()
    .catch((err) => {
        console.error('❌ Error updating settings and FAQs:', err);
        process.exit(1);
    })
    .finally(() => {
        const prisma = getDbClient();
        if (prisma) prisma.$disconnect();
    });
