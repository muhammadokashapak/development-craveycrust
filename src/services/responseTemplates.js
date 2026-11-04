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
        return nextStepPrompt ? `${base}\n\n${nextStepPrompt}` : base;
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
};
