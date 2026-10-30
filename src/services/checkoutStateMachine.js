/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║   Checkout State Machine — src/services/checkoutStateMachine.js║
 * ║   Deterministic 10-Step Order State Transition Engine       ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Required Sequence:
 *   1. CART_REVIEW
 *   2. CUSTOMER_NAME
 *   3. CONTACT_PHONE
 *   4. DELIVERY_ADDRESS
 *   5. PAYMENT_METHOD
 *   6. UPSELL
 *   7. FINAL_CART_VALIDATION
 *   8. ORDER_SUMMARY
 *   9. CUSTOMER_CONFIRMATION
 *   10. ORDER_CREATION
 *   11. ORDER_CONFIRMED
 */

export const CHECKOUT_STATES = {
    CART_REVIEW: 'CART_REVIEW',
    CUSTOMER_NAME: 'CUSTOMER_NAME',
    CONTACT_PHONE: 'CONTACT_PHONE',
    DELIVERY_ADDRESS: 'DELIVERY_ADDRESS',
    PAYMENT_METHOD: 'PAYMENT_METHOD',
    UPSELL: 'UPSELL',
    FINAL_CART_VALIDATION: 'FINAL_CART_VALIDATION',
    ORDER_SUMMARY: 'ORDER_SUMMARY',
    CUSTOMER_CONFIRMATION: 'CUSTOMER_CONFIRMATION',
    ORDER_CREATION: 'ORDER_CREATION',
    ORDER_CONFIRMED: 'ORDER_CONFIRMED',
};

const DUMMY_NAMES_REGEX = /^(customer|user|guest|none|\.|anonymous|client|bhai|sir|hlo|helo|hi|hello|haan|han|ji|g|yes|ok|okay|theek|done|cod|easypaisa|confirm|final)$/i;

/**
 * Validates customer name. Rejects greetings, affirmatives, slangs, or single characters.
 */
export function isValidCustomerName(name) {
    if (!name || typeof name !== 'string') return false;
    const clean = name.trim();
    if (clean.length < 2 || clean.length > 50) return false;
    if (DUMMY_NAMES_REGEX.test(clean)) return false;
    // Reject numbers or instructions
    if (/^\d+$/.test(clean) || /\b(instruction|discount|price|burger|pizza)\b/i.test(clean)) return false;
    return true;
}

/**
 * Validates Pakistani phone number (11 digits: 03XXXXXXXXX).
 */
export function isValidPhoneNumber(phone) {
    if (!phone || typeof phone !== 'string') return false;
    const clean = phone.replace(/\D/g, '');
    if (clean.length === 11 && clean.startsWith('03')) return true;
    if (clean.length === 12 && clean.startsWith('923')) return true;
    if (clean.length === 10 && clean.startsWith('3')) return true;
    return false;
}

/**
 * Resolves current checkout state and determines next mandatory step.
 *
 * @param {object} params
 * @param {object} params.cart Authoritative backend cart
 * @param {object} params.details Session customer details
 * @param {object} [params.totals] Cart pricing totals
 * @returns {{ currentState: string, nextAction: string, prompt: string, canProceedToOrder: boolean }}
 */
export function evaluateCheckoutState({ cart, details, totals, confirmIntent = false }) {
    // 1. CART_REVIEW
    if (!cart?.items || cart.items.length === 0) {
        return {
            currentState: CHECKOUT_STATES.CART_REVIEW,
            nextAction: 'ADD_ITEMS',
            prompt: "Aap ka cart is waqt khali hai. Hamara menu dekhne ke liye 'menu' ya deals dekhne ke liye 'deals' likhein!",
            canProceedToOrder: false,
        };
    }

    // 2. CUSTOMER_NAME
    if (!details?.name || !isValidCustomerName(details.name)) {
        return {
            currentState: CHECKOUT_STATES.CUSTOMER_NAME,
            nextAction: 'REQUEST_NAME',
            prompt: "Order finalize karne ke liye baraye meherbani apna *Naam* bata dein? 😊",
            canProceedToOrder: false,
        };
    }

    // 3. CONTACT_PHONE
    if (!details.phoneConfirmed) {
        const displayPhone = details.phone || 'WhatsApp Number';
        return {
            currentState: CHECKOUT_STATES.CONTACT_PHONE,
            nextAction: 'CONFIRM_PHONE',
            prompt: `Shukriya *${details.name}*! Rabtay ke liye rider ko yahi WhatsApp number (${displayPhone}) dein ya koi doosra contact number likhna hai? 📞`,
            canProceedToOrder: false,
        };
    }

    // 4. DELIVERY_ADDRESS
    const hasAddress = (details.address && details.address.length >= 5) || (details.location && details.location.latitude != null);
    if (!hasAddress) {
        return {
            currentState: CHECKOUT_STATES.DELIVERY_ADDRESS,
            nextAction: 'REQUEST_ADDRESS',
            prompt: `Delivery kahan karni hai ${details.name} bhai? Baraye meherbani apna mukammal delivery address (ya WhatsApp location pin) bhej dein 📍`,
            canProceedToOrder: false,
        };
    }

    // 5. PAYMENT_METHOD
    const validPayment = details.paymentMethod === 'COD' || details.paymentMethod === 'EASYPAISA';
    if (!validPayment) {
        return {
            currentState: CHECKOUT_STATES.PAYMENT_METHOD,
            nextAction: 'REQUEST_PAYMENT',
            prompt: `Payment method kaunsa pasand karenge ${details.name} — Cash on Delivery (COD) ya EasyPaisa? 💵`,
            canProceedToOrder: false,
        };
    }

    // 6 & 8. ORDER_SUMMARY
    if (!details.summaryShown) {
        return {
            currentState: CHECKOUT_STATES.ORDER_SUMMARY,
            nextAction: 'DISPLAY_SUMMARY',
            prompt: 'ORDER_SUMMARY_REQUIRED',
            canProceedToOrder: false,
        };
    }

    // 9. CUSTOMER_CONFIRMATION
    if (!confirmIntent) {
        return {
            currentState: CHECKOUT_STATES.CUSTOMER_CONFIRMATION,
            nextAction: 'AWAIT_CONFIRMATION',
            prompt: 'Kya yeh order confirm kar dein? (Order book karne ke liye "Haan" ya "Confirm" likhein)',
            canProceedToOrder: false,
        };
    }

    // 10. Ready for ORDER_CREATION
    return {
        currentState: CHECKOUT_STATES.ORDER_CREATION,
        nextAction: 'CREATE_ORDER',
        prompt: 'Order process kiya ja raha hai...',
        canProceedToOrder: true,
    };
}

