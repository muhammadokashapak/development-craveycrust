/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║   Checkout State Machine — src/services/checkoutStateMachine.js║
 * ║   Deterministic 8-Stage Order State Machine & Confirmation Lock║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Strict 8-Stage Progression:
 *   1. CART_BUILDING
 *   2. CUSTOMER_DETAILS (Name, Phone, Address)
 *   3. DELIVERY_VALIDATION
 *   4. PAYMENT_SELECTION
 *   5. FINAL_REVIEW
 *   6. AWAITING_CONFIRMATION
 *   7. ORDER_PROCESSING (Atomic Confirmation Lock)
 *   8. ORDER_CONFIRMED
 */

export const ORDER_STAGES = {
    CART_BUILDING: 'CART_BUILDING',
    CUSTOMER_DETAILS: 'CUSTOMER_DETAILS',
    DELIVERY_VALIDATION: 'DELIVERY_VALIDATION',
    PAYMENT_SELECTION: 'PAYMENT_SELECTION',
    FINAL_REVIEW: 'FINAL_REVIEW',
    AWAITING_CONFIRMATION: 'AWAITING_CONFIRMATION',
    ORDER_PROCESSING: 'ORDER_PROCESSING',
    ORDER_CONFIRMED: 'ORDER_CONFIRMED',
};

// Backwards compatibility with legacy state references
export const CHECKOUT_STATES = {
    CART_REVIEW: 'CART_BUILDING',
    CUSTOMER_NAME: 'CUSTOMER_DETAILS',
    CONTACT_PHONE: 'CUSTOMER_DETAILS',
    DELIVERY_ADDRESS: 'DELIVERY_VALIDATION',
    PAYMENT_METHOD: 'PAYMENT_SELECTION',
    UPSELL: 'FINAL_REVIEW',
    FINAL_CART_VALIDATION: 'FINAL_REVIEW',
    ORDER_SUMMARY: 'FINAL_REVIEW',
    CUSTOMER_CONFIRMATION: 'AWAITING_CONFIRMATION',
    ORDER_CREATION: 'ORDER_PROCESSING',
    ORDER_CONFIRMED: 'ORDER_CONFIRMED',
};

const DUMMY_NAMES_REGEX = /^(customer|user|guest|none|\.|anonymous|client|bhai|sir|hlo|helo|hi|hello|haan|han|ji|g|yes|ok|okay|theek|done|cod|easypaisa|confirm|final)$/i;

// ─── Confirmation Lock & Snapshot Store (In-Memory Single Source of Truth) ───
const _confirmationLocks = new Map(); // sessionKey -> timestamp
const _orderSnapshots = new Map();    // sessionKey -> snapshot object
const LOCK_TIMEOUT_MS = 30000;         // 30-second atomic lock TTL

/**
 * Acquire confirmation lock to prevent duplicate order booking
 * @param {string} sessionKey
 * @returns {boolean} true if lock was acquired, false if already locked
 */
export function acquireConfirmationLock(sessionKey) {
    if (!sessionKey) return false;
    const now = Date.now();
    const existing = _confirmationLocks.get(sessionKey);
    if (existing && (now - existing) < LOCK_TIMEOUT_MS) {
        return false; // Still locked
    }
    _confirmationLocks.set(sessionKey, now);
    return true;
}

/**
 * Release confirmation lock
 * @param {string} sessionKey
 */
export function releaseConfirmationLock(sessionKey) {
    if (sessionKey) {
        _confirmationLocks.delete(sessionKey);
    }
}

/**
 * Check if session is currently locked in booking
 * @param {string} sessionKey
 * @returns {boolean}
 */
export function isConfirmationLocked(sessionKey) {
    if (!sessionKey) return false;
    const existing = _confirmationLocks.get(sessionKey);
    if (!existing) return false;
    if (Date.now() - existing >= LOCK_TIMEOUT_MS) {
        _confirmationLocks.delete(sessionKey);
        return false;
    }
    return true;
}

/**
 * Save snapshot of validated order summary for confirmation comparison
 * @param {string} sessionKey
 * @param {object} snapshot
 */
export function saveOrderSummarySnapshot(sessionKey, snapshot) {
    if (sessionKey && snapshot) {
        _orderSnapshots.set(sessionKey, {
            ...snapshot,
            savedAt: Date.now(),
        });
    }
}

/**
 * Retrieve saved order snapshot
 * @param {string} sessionKey
 * @returns {object|null}
 */
export function getOrderSummarySnapshot(sessionKey) {
    return sessionKey ? (_orderSnapshots.get(sessionKey) || null) : null;
}

/**
 * Clear order snapshot upon completion or modification
 * @param {string} sessionKey
 */
export function clearOrderSummarySnapshot(sessionKey) {
    if (sessionKey) {
        _orderSnapshots.delete(sessionKey);
    }
}

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
 * Resolves current checkout state and determines next mandatory step according to the 8-stage state machine.
 *
 * @param {object} params
 * @param {object} params.cart Authoritative backend cart
 * @param {object} params.details Session customer details
 * @param {object} [params.totals] Cart pricing totals
 * @param {boolean} [params.confirmIntent]
 * @returns {{ stage: string, currentState: string, nextAction: string, prompt: string, canProceedToOrder: boolean }}
 */
export function evaluateCheckoutState({ cart, details, totals, confirmIntent = false }) {
    // 1. CART_BUILDING
    if (!cart?.items || cart.items.length === 0) {
        return {
            stage: ORDER_STAGES.CART_BUILDING,
            currentState: ORDER_STAGES.CART_BUILDING,
            nextAction: 'ADD_ITEMS',
            prompt: "Aap ka cart is waqt khali hai. Hamara menu dekhne ke liye 'menu' ya deals dekhne ke liye 'deals' likhein!",
            canProceedToOrder: false,
        };
    }

    // 2. CUSTOMER_DETAILS (Name)
    if (!details?.name || !isValidCustomerName(details.name)) {
        return {
            stage: ORDER_STAGES.CUSTOMER_DETAILS,
            currentState: 'CUSTOMER_NAME',
            nextAction: 'REQUEST_NAME',
            prompt: "Order finalize karne ke liye baraye meherbani apna *Naam* bata dein? 😊",
            canProceedToOrder: false,
        };
    }

    // 2. CUSTOMER_DETAILS (Phone)
    if (!details.phoneConfirmed) {
        const displayPhone = details.phone || 'WhatsApp Number';
        return {
            stage: ORDER_STAGES.CUSTOMER_DETAILS,
            currentState: 'CONTACT_PHONE',
            nextAction: 'CONFIRM_PHONE',
            prompt: `Shukriya *${details.name}*! Rabtay ke liye rider ko yahi WhatsApp number (${displayPhone}) dein ya koi doosra contact number likhna hai? 📞`,
            canProceedToOrder: false,
        };
    }

    // 3. DELIVERY_VALIDATION (Address)
    const hasAddress = (details.address && details.address.length >= 5) || (details.location && details.location.latitude != null);
    if (!hasAddress) {
        return {
            stage: ORDER_STAGES.DELIVERY_VALIDATION,
            currentState: 'DELIVERY_ADDRESS',
            nextAction: 'REQUEST_ADDRESS',
            prompt: `Delivery kahan karni hai ${details.name} bhai? Baraye meherbani pehle apni *WhatsApp Location Pin* share karein 📍 (taake exact rider coordinates mil sakein).\nAgar pin share nahi kar saktay, to apna *mukammal address* dein ya qareeb ka mashhoor *Landmark* bata dein!`,
            canProceedToOrder: false,
        };
    }

    // 4. PAYMENT_SELECTION
    const validPayment = details.paymentMethod === 'COD' || details.paymentMethod === 'EASYPAISA';
    if (!validPayment) {
        return {
            stage: ORDER_STAGES.PAYMENT_SELECTION,
            currentState: 'PAYMENT_METHOD',
            nextAction: 'REQUEST_PAYMENT',
            prompt: `Payment method kaunsa pasand karenge ${details.name} — Cash on Delivery (COD) ya EasyPaisa? 💵`,
            canProceedToOrder: false,
        };
    }

    // 5. FINAL_REVIEW
    if (!details.summaryShown) {
        return {
            stage: ORDER_STAGES.FINAL_REVIEW,
            currentState: 'ORDER_SUMMARY',
            nextAction: 'DISPLAY_SUMMARY',
            prompt: 'ORDER_SUMMARY_REQUIRED',
            canProceedToOrder: false,
        };
    }

    // 6. AWAITING_CONFIRMATION
    if (!confirmIntent) {
        return {
            stage: ORDER_STAGES.AWAITING_CONFIRMATION,
            currentState: 'CUSTOMER_CONFIRMATION',
            nextAction: 'AWAIT_CONFIRMATION',
            prompt: 'Kya yeh order confirm kar dein? (Order book karne ke liye "Haan" ya "Confirm" likhein)',
            canProceedToOrder: false,
        };
    }

    // 7. ORDER_PROCESSING (Ready for atomic creation)
    return {
        stage: ORDER_STAGES.ORDER_PROCESSING,
        currentState: 'ORDER_CREATION',
        nextAction: 'CREATE_ORDER',
        prompt: 'Order process kiya ja raha hai...',
        canProceedToOrder: true,
    };
}
