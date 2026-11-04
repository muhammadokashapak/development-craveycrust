/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║   Response Templates — src/services/responseTemplates.js     ║
 * ║   Deterministic Predefined Roman Urdu Customer Templates    ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Principle: The AI never generates customer responses.
 * All customer messages are produced deterministically by the backend
 * using verified state data.
 */

export const RESPONSE_TEMPLATES = {
    // ── Item Added ──
    itemAdded({ itemName, quantity = 1, size = null, price = null, nextStepPrompt = '' }) {
        const sizeStr = size ? ` (${size})` : '';
        const priceStr = price ? ` — Rs. ${Number(price).toLocaleString('en-PK')}` : '';
        const base = `Zabardast! *${quantity}x ${itemName}${sizeStr}*${priceStr} cart mein add kar di gayi hai! 🛒`;
        const prompt = nextStepPrompt || 'Kya aap iske sath kuch aur order karna chahenge (jaise Fries ya Cold Drink), ya order finalize karein? 😊';
        return `${base}\n\n${prompt}`;
    },

    // ── Deal Query / Included Items ──
    dealDetails({ dealName, includedItems = '', price = null, nextStepPrompt = '' }) {
        const priceStr = price ? ` — Rs. ${Number(price).toLocaleString('en-PK')}` : '';
        const base = `Ji bilkul! *${dealName}*${priceStr} mein ye shamil hai:\n\n${includedItems}\n\nKya ye deal aap ke cart mein add karoon? 😊`;
        return nextStepPrompt ? `${base}\n\n${nextStepPrompt}` : base;
    },

    // ── Deal Drink Included Inquiry ──
    dealDrinkIncluded({ dealName, drinkDetails = '1 Liter Soft Drink' }) {
        return `Ji bilkul! *${dealName}* mein pehle se *${drinkDetails}* included hai. Aap ko alag se drink add karne ki zaroorat nahi. 😊\n\nKya aap koi aur item add karna chahte hain ya order finalize karein?`;
    },

    // ── Cart Summary ──
    cartSummary({ cartLines = '', subtotal = 0, deliveryFee = 0, total = 0, nextStepPrompt = '' }) {
        const feeStr = deliveryFee > 0 ? `Rs. ${Number(deliveryFee).toLocaleString('en-PK')}` : 'Free';
        const base = `📋 *AAP KA CART:*\n\n${cartLines}\n\n` +
            `Subtotal: Rs. ${Number(subtotal).toLocaleString('en-PK')}\n` +
            `Delivery Charges: ${feeStr}\n` +
            `*Total Bill: Rs. ${Number(total).toLocaleString('en-PK')}*`;
        return nextStepPrompt ? `${base}\n\n${nextStepPrompt}` : `${base}\n\nOrder confirm karne ke liye "confirm" likhein!`;
    },

    // ── Item Removed ──
    itemRemoved({ itemName, updatedTotal = 0 }) {
        return `Theek hai! *${itemName}* cart se remove kar diya gaya hai. 👍\n\nNaya Total: Rs. ${Number(updatedTotal).toLocaleString('en-PK')}`;
    },

    // ── Step 1: Customer Name ──
    namePrompt() {
        return 'Order finalize karne ke liye baraye meherbani pehle apna *Naam* bata dein? 😊';
    },

    nameConfirmed({ name, nextPrompt = '' }) {
        const base = `Theek hai ${name} bhai! Aap ka naam note kar liya hai. 👍`;
        return nextPrompt ? `${base}\n\n${nextPrompt}` : base;
    },

    // ── Step 2: Contact Phone ──
    phonePrompt({ name, displayPhone }) {
        return `Shukriya ${name}! Rabtay ke liye rider ko yahi WhatsApp number (*${displayPhone}*) dein ya koi doosra contact number likhna hai? 📞`;
    },

    phoneConfirmed({ name, phone, nextPrompt = '' }) {
        const base = `Theek hai ${name} bhai! Contact number confirm ho gaya (*${phone}*). 👍`;
        return nextPrompt ? `${base}\n\n${nextPrompt}` : base;
    },

    // ── Step 3: Delivery Address / Pin ──
    addressPrompt({ name }) {
        return `Delivery kahan karni hai ${name}? Baraye meherbani pehle apni *WhatsApp Location Pin* share karein 📍 (taake exact rider coordinates mil sakein).\n\nAgar pin share nahi kar saktay, to apna *mukammal address* (House/Street/Phase) dein ya qareeb ka mashhoor *Landmark* (school, masjid, plaza, chowk) bata dein!`;
    },

    addressConfirmed({ name, address, distanceKm = null, nextPrompt = '' }) {
        const distStr = distanceKm != null ? ` (delivery range mein available hai - approx. ${distanceKm} km)` : '';
        const base = `Delivery address (*${address}*) note kar liya hai${distStr}. 📍`;
        return nextPrompt ? `${base}\n\n${nextPrompt}` : base;
    },

    addressIncomplete({ locality }) {
        return `Ji, *${locality}* samajh aa gaya. Baraye meherbani qareebi street, sector ya kisi mashhoor landmark ka naam bata dein taake delivery location verify kar sakein. 📍`;
    },

    addressOutOfRange({ maxRadiusKm = 10, distanceKm = null }) {
        const distStr = distanceKm != null ? ` (Aap ka address approx. ${distanceKm} km door hai)` : '';
        return `Maazrat! Yeh address hamari standard delivery range (${maxRadiusKm} km) se bahar hai${distStr}. 😔\n\nKya aap koi doosra qareebi address dein ge ya Takeaway / Self-Pickup karna chahenge?`;
    },

    // ── Step 4: Payment Method ──
    paymentPrompt({ name }) {
        return `Payment method kaunsa pasand karenge ${name} — *Cash on Delivery (COD)* ya *EasyPaisa*? 💵`;
    },

    paymentConfirmed({ name, paymentLabel, nextPrompt = '' }) {
        const base = `Payment method (*${paymentLabel}*) note kar liya hai. 👍`;
        return nextPrompt ? `${base}\n\n${nextPrompt}` : base;
    },

    // ── Step 5: Extra Items Upsell ──
    extraItemsUpsell({ name }) {
        return `Ji ${name} bhai, kya iske sath kuch aur add karna chahenge (jaise Extra Drink ya Fries)? 🍟🥤`;
    },

    // ── Step 6: Final Summary & Confirmation Request ──
    finalReview({ name, cartSummary, address, phone, paymentLabel }) {
        return `${name} bhai, aap ke order ki final details ye hain:\n\n` +
            `📋 *ORDER SUMMARY:*\n` +
            `${cartSummary}\n\n` +
            `👤 Customer Name: *${name}*\n` +
            `📍 Delivery Location: *${address}*\n` +
            `📞 Contact: *${phone}*\n` +
            `💵 Payment: *${paymentLabel}*\n\n` +
            `Kya aap tamam details check karke is order ko confirm karte hain?\n` +
            `Order book karne ke liye *"Confirm"* ya *"Haan"* likhein. Agar koi detail change karni hai to bata dein.`;
    },

    // ── Step 7 & 8: Order Confirmed ──
    orderConfirmed({ name, orderNumber, total, paymentLabel, address }) {
        return `${name} bhai, aap ka order successfully confirm ho gaya hai! 🎉\n\n` +
            `*Order Number:* ${orderNumber}\n` +
            `*Order Total:* Rs. ${Number(total).toLocaleString('en-PK')}\n` +
            `*Payment:* ${paymentLabel}\n` +
            `*Delivery Address:* ${address}\n\n` +
            `Aap ka order Cravey Crust ki team ko bhej diya gaya hai. Shukriya, aur mazay se khana enjoy karein! 🍕🔥`;
    },

    orderProcessing() {
        return 'Aap ka order process ho raha hai, baraye meherbani thoda intezar karein... ⏳';
    },

    // ── Guards & Context Handlers ──
    emptyCartConfirmGuard() {
        return 'Aap ka cart is waqt khali hai. 🛒\n\nOrder confirm karne se pehle menu dekhne ke liye "menu" ya deals dekhne ke liye "deals" likh kar koi item select karein!';
    },

    duplicateConfirmNotice({ orderNumber }) {
        return `Aap ka order (*${orderNumber}*) pehle hi confirm ho chuka hai aur kitchen mein tayyar ho raha hai! 😊 Rider jald aap se rabta karega.`;
    },

    // ── Existing Orders Status & Deletion Guidance ──
    existingOrdersList({ orders = [] }) {
        const listText = orders.map((ord, idx) => {
            const itms = (ord.order_items || []).map(i => `${i.quantity}x ${i.item_name_snapshot || i.deal_name_snapshot || 'Item'}`).join(', ');
            return `*${idx + 1}. Order #${ord.order_number}* (${ord.order_status})\n   • Items: ${itms}\n   • Total: Rs. ${Number(ord.total).toLocaleString('en-PK')}\n   • Address: *${ord.delivery_address || 'Registered Address'}*`;
        }).join('\n\n');

        return `Aap ke is waqt ${orders.length} active order${orders.length > 1 ? 's' : ''} process ho rahe hain:\n\n${listText}\n\nAgar kisi order ki details update karni hon to order number bata dein, ya naya order karne ke liye *"deals"* likhein! 😊`;
    },

    noActiveOrders() {
        return `Aap ka is waqt koi active order process nahi ho raha. 😊\n\nNaya mazedaar khana order karne ke liye:\n• Tamam deals dekhne ke liye *"deals"* likhein.\n• Mukammal menu dekhne ke liye *"menu"* likhein. 🍕🍔`;
    },

    orderDeletionNotAllowed({ adminPhone = '0343-4919319', whatsappLink = 'https://wa.me/923434919319' }) {
        return `Maazrat! System par pehle se confirm shuda / process hone walay orders ko WhatsApp par directly cancel ya delete nahi kiya ja sakta. 🚫\n\nAgar aap koi tabdeeli ya cancellation karwana chahte hain to baraye meherbani Cravey Crust manager se foran rabta karein:\n\n📞 *Store Admin / Manager:* ${adminPhone}\n💬 *WhatsApp:* ${whatsappLink}\n\nNaya order karne ke liye *"deals"* ya *"menu"* likhein! 🍕`;
    },

    selectionPreserved() {
        return 'Theek hai! Aap ki maujooda selection mehfooz hai aur koi tabdeeli nahi ki gayi. 👍\n\nAgla step proceed karne ke liye tayyar hain?';
    },

    contextRecalled({ knownDetails = [] }) {
        return `Ji bilkul! Aap ki yeh details hamare paas pehle se mehfooz hain: 😊\n\n• ${knownDetails.join('\n• ')}\n\nKya isi address par order proceed karein ya koi cheez change karni hai?`;
    },

    greeting({ storeName = 'Cravey Crust' }) {
        return `Khushamdeed! 🍕 Cravey Crust mein aap ka swagat hai.\n\n` +
            `Aap aaj kya order karna chahenge?\n` +
            `• Tamam deals dekhne ke liye *"deals"* likhein.\n` +
            `• Mukammal menu dekhne ke liye *"menu"* likhein.\n\n` +
            `Humari mazedaar pizzas aur crispy burgers aap ke muntazir hain! 😊`;
    },

    clarification({ reason = 'Baraye meherbani thori wazahat kar dein.' }) {
        return `${reason} 😊\n\nAap menu dekhne ke liye "menu" ya deals ke liye "deals" likh sakte hain.`;
    },

    // ── Item Not in Menu ──
    itemNotInMenu({ itemName = null }) {
        const itemStr = itemName ? `*"${itemName}"*` : 'Yeh item';
        return `Maazrat! ${itemStr} hamare menu mein available nahi hai. 😔\n\n` +
            `Hamare pas mazedaar *Crispy Zinger Burgers*, *Cheesy Pizzas*, *Loaded Fries* aur zabardast *Deals* available hain. Aap hamara menu check karke koi doosri cheez order kar sakte hain! 🍕🍔\n\n` +
            `• Mukammal menu dekhne ke liye *"menu"* likhein.\n` +
            `• Deals dekhne ke liye *"deals"* likhein.`;
    },

    // ── Cheapest / Lowest Price Items ──
    cheapestItemsList() {
        return `Hamare menu mein sab se low price aur sasti items yeh hain: 🏷️\n\n` +
            `🥤 *Drinks:*\n` +
            `• Mineral Water — Rs. 70\n` +
            `• Soft Drink (Regular) — Rs. 110\n\n` +
            `🍟 *Starters & Chicken:*\n` +
            `• 1 Pc Chicken Piece — Rs. 180\n` +
            `• Regular Fries — Rs. 220\n\n` +
            `🍔 *Burgers:*\n` +
            `• Zegy Burger — Rs. 399\n` +
            `• Crispy Zinger Burger — Rs. 499\n\n` +
            `🍕 *Pizzas & Deals:*\n` +
            `• Classic Pizza (Small) — Rs. 599\n` +
            `• Pizza Meal For 1 / Burger Meal For 1 — Rs. 599\n\n` +
            `In mein se aap ke liye kya add karoon? 😊`;
    },

    // ── Best / Most Popular Items ──
    bestItemsList() {
        return `Cravey Crust ki sab se best aur customer-favorite items yeh hain: 🔥🍕\n\n` +
            `🍔 *Crispy Zinger Burger (Rs. 499):*\n` +
            `Hamara signature crunchy chicken fillet burger — sab se zyada pasand kiya jane wala!\n\n` +
            `🍕 *Chicken Supreme & Peri Peri Pizza:*\n` +
            `Rich chicken chunks, black olives, veggies aur extra melted cheese se bharpoor top-rated pizza! (Small Rs. 599/699, Medium Rs. 1,199/1,399)\n\n` +
            `🎁 *Zinger Deals (1 to 4):*\n` +
            `Crispy zinger burgers aur chilled soft drink ka best value combo (Rs. 950 se Rs. 2,150 tak)!\n\n` +
            `🍟 *Loaded Fries (Rs. 699):*\n` +
            `Crispy fries topped with chicken chunks, cheese aur secret sauces!\n\n` +
            `In mein se aap ke liye kaunsi item add karoon? 😊`;
    },

    // ── Zinger Options ──
    zingerOptionsList() {
        return `Cravey Crust ke pas zinger aur burgers mein yeh mazedaar options hain: 🍔🔥\n\n` +
            `• *Crispy Zinger Burger* — Crunchy chicken fillet with secret mayo (Rs. 499)\n` +
            `• *Zegy Burger* — Crispy fried patty burger (Rs. 399)\n` +
            `• *Chicken Burger* — Classic tender chicken burger (Rs. 499)\n\n` +
            `🔥 *Zinger Combo Deals:*\n` +
            `• *Zinger Deal 1:* 2x Zinger Burger + 1 Litre Drink — Rs. 950\n` +
            `• *Zinger Deal 2:* 3x Zinger Burger + 1 Litre Drink — Rs. 1,350\n` +
            `• *Zinger Deal 3:* 4x Zinger Burger + 1 Litre Drink — Rs. 1,750\n` +
            `• *Zinger Deal 4:* 5x Zinger Burger + 1 Litre Drink — Rs. 2,150\n\n` +
            `Aap ke liye kaunsa zinger burger ya deal add karoon? 😊`;
    },

    // ── Burger Options ──
    burgerOptionsList() {
        return `Cravey Crust ke pas burgers ki yeh variety available hai: 🍔\n\n` +
            `• *Zegy Burger* — Rs. 399\n` +
            `• *Chicken Burger* — Rs. 499\n` +
            `• *Crispy Zinger Burger* — Rs. 499\n` +
            `• *Burger Meal For 1* (1x Burger + Fries + Drink) — Rs. 599\n` +
            `• *Burger Meal For 2* (2x Burger + Fries + Drink) — Rs. 999\n` +
            `• *Burger Meal For 3* (3x Burger + Fries + Drink) — Rs. 1,599\n\n` +
            `In mein se kaunsa burger aap ke liye cart mein add karoon? 😊`;
    },

    // ── Pizza Flavours ──
    pizzaFlavoursList() {
        return `Cravey Crust ke mazedaar pizza flavours yeh hain: 🍕🔥\n\n` +
            `⭐ *Classic Flavours (Small Rs. 599 | Medium Rs. 1,299 | Large Rs. 1,499 | Party Rs. 2,599):*\n` +
            `• *Chicken Tikka:* Traditional spicy BBQ tikka chunks with onions & cheese\n` +
            `• *Chicken Fajita:* Mexican marinated chicken with bell peppers & onions\n` +
            `• *Chicken Supreme:* Loaded with chicken, black olives, mushrooms & peppers\n` +
            `• *Chicken Tandori:* Aromatic tandoori chicken chunks\n` +
            `• *Cheese Lover:* Loaded 100% pure melted mozzarella cheese\n\n` +
            `👑 *Premium Flavours (Small Rs. 699 | Medium Rs. 1,399 | Large Rs. 1,799 | Party Rs. 2,799):*\n` +
            `• *Chicken Extreme:* Extra spiced chunks with rich toppings\n` +
            `• *Peri Peri Pizza:* Tangy spicy peri peri sauce with grilled chicken\n` +
            `• *Behari Kebab Pizza:* Tender seekh kebab chunks with signature sauce\n` +
            `• *Crown Crust:* Stuffed crown edges with mouthwatering toppings\n\n` +
            `Kaunsa pizza flavour aur size aap ke liye ready karoon? 😊`;
    },
};