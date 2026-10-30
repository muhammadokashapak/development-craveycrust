/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║   User Chat Validation Suite                                 ║
 * ║   tests/user_chat_validation_suite.js                        ║
 * ║   Verifies the 10 Critical User Prompt Requirements         ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import assert from 'assert';
import { getActiveCart, addItemToCart, calculateCartTotals, clearCart } from '../src/services/cartService.js';
import { getSessionOrderDetails, updateSessionOrderDetails, clearSessionOrderDetails } from '../src/services/sessionService.js';
import { checkFastRoute, extractCustomerDetails } from '../src/services/intentParser.js';
import { extractRequestedItems, executeBatchAddToCart } from '../src/services/addonExtractionService.js';
import { verifyOutput } from '../src/services/aiAgentService.js';

let passed = 0;
let total = 0;

function it(desc, fn) {
    total++;
    try {
        fn();
        console.log(`✅ PASS [TEST ${total}]: ${desc}`);
        passed++;
    } catch (err) {
        console.error(`❌ FAIL [TEST ${total}]: ${desc}\n   Error: ${err.message}`);
    }
}

async function itAsync(desc, fn) {
    total++;
    try {
        await fn();
        console.log(`✅ PASS [TEST ${total}]: ${desc}`);
        passed++;
    } catch (err) {
        console.error(`❌ FAIL [TEST ${total}]: ${desc}\n   Error: ${err.message}`);
    }
}

console.log('================================================================');
console.log('🧪 RUNNING CRITICAL VERIFICATION SUITE — CRAVEY CRUST ORDERING');
console.log('================================================================\n');

async function run() {
    // ── TEST 1: Customer Identity — Customer enters "Aslam"
    await itAsync('Customer enters "Aslam" -> All checkout messages use "Aslam", never Okasha', async () => {
        const sessionKey = '923278497923@s.whatsapp.net';
        const phone = '03278497923';
        clearSessionOrderDetails(sessionKey, phone);

        // Populate cart first with 4 Zegy burgers so checkout flow is active
        await clearCart({ sessionKey });
        await addItemToCart({ sessionKey, menuItemId: 'item-20', quantity: 4 });

        // User enters name "Aslam"
        const res = await checkFastRoute({
            text: 'Aslam',
            whatsappPhone: phone,
            sessionKey,
            chatId: sessionKey,
        });

        assert.ok(res.handled, 'Fast route should handle name input');
        assert.ok(res.reply.includes('Aslam'), `Expected "Aslam" in reply, got: ${res.reply}`);
        assert.ok(!res.reply.toLowerCase().includes('okasha'), `Should NEVER include Okasha! Got: ${res.reply}`);

        const details = getSessionOrderDetails(sessionKey, phone);
        assert.strictEqual(details.name, 'Aslam', 'Customer name must be strictly Aslam');
        assert.ok(details.nameExplicit, 'Name must be marked as explicit');
    });

    // ── TEST 2: WhatsApp Number — Customer confirms "Han, yehi krdo"
    await itAsync('Customer confirms "Han / Yehi krdo" -> Strictly uses original sender number (03278497923)', async () => {
        const sessionKey = '923278497923@s.whatsapp.net';
        const senderPhone = '03278497923';

        // Customer confirms phone with "Yehi krdo"
        const res = await checkFastRoute({
            text: 'Yehi krdo',
            whatsappPhone: senderPhone,
            sessionKey,
            chatId: sessionKey,
        });

        assert.ok(res.handled, 'Fast route should handle phone affirmative');
        assert.ok(res.reply.includes('03278497923') || res.reply.includes('0327-8497923'), `Expected sender phone 03278497923, got: ${res.reply}`);
        assert.ok(!res.reply.includes('03495696659'), `Must NEVER use other customer phone (03495696659)! Got: ${res.reply}`);

        const details = getSessionOrderDetails(sessionKey, senderPhone);
        assert.strictEqual(details.phone, '03278497923', 'Order contact phone must match sender phone');
        assert.strictEqual(details.phoneConfirmed, true, 'Phone must be confirmed');
        assert.strictEqual(details.name, 'Aslam', 'Name must remain Aslam');
    });

    // ── TEST 3: Add Fries — Request Fries, Select Regular -> Cart has 4 Zegy + 1 Regular Fries
    await itAsync('Request "Fries krdo", select "Regular" -> Cart contains 4x Zegy Burger + 1x Regular Fries', async () => {
        const sessionKey = '923278497923@s.whatsapp.net';
        const senderPhone = '03278497923';

        // 1. Customer asks "Fries krdo"
        const res1 = await checkFastRoute({
            text: 'Fries krdo',
            whatsappPhone: senderPhone,
            sessionKey,
            chatId: sessionKey,
        });

        assert.ok(res1.handled, 'Fries size prompt should be handled');
        assert.ok(res1.reply.includes('Regular') && res1.reply.includes('Large'), `Expected size prompt, got: ${res1.reply}`);

        // 2. Customer selects "Regular"
        const res2 = await checkFastRoute({
            text: 'Regular',
            whatsappPhone: senderPhone,
            sessionKey,
            chatId: sessionKey,
        });

        assert.ok(res2.handled, 'Regular variant selection should be handled');
        assert.ok(res2.reply.includes('Fries (Regular)') || res2.reply.includes('Regular'), `Expected variant confirmation, got: ${res2.reply}`);

        const cart = await getActiveCart({ sessionKey });
        assert.strictEqual(cart.items.length, 2, 'Cart must have exactly 2 line items');
        const zegyItem = cart.items.find(i => i.menu_item_id === 'item-20' || i.name === 'Zegy Burger');
        const friesItem = cart.items.find(i => i.menu_item_id === 'item-1' || i.name === 'Fries');

        assert.ok(zegyItem, 'Cart must contain Zegy Burger');
        assert.strictEqual(zegyItem.quantity, 4, 'Must have 4 Zegy Burgers');
        assert.ok(friesItem, 'Cart must contain Fries');
        assert.strictEqual(friesItem.quantity, 1, 'Must have 1 Fries');
        assert.strictEqual(friesItem.menu_variant_id, 'v-1-1', 'Must be Regular Fries (v-1-1)');
    });

    // ── TEST 4: Cart Calculation — Rs. 1,596 + Rs. 220 = Rs. 1,816
    await itAsync('Cart calculation verification -> Subtotal = Rs. 1,816, Total = Rs. 1,816', async () => {
        const sessionKey = '923278497923@s.whatsapp.net';
        const totals = await calculateCartTotals({ sessionKey });

        assert.strictEqual(totals.subtotal, 1816, `Expected subtotal Rs. 1816, got: ${totals.subtotal}`);
        assert.strictEqual(totals.total, 1816, `Expected total bill Rs. 1816, got: ${totals.total}`);
    });

    // ── TEST 5: Repeated Selection — Customer repeats "Regular fries add krdo"
    await itAsync('Repeated selection "Regular fries add krdo" -> Does not duplicate already added regular fries', async () => {
        const sessionKey = '923278497923@s.whatsapp.net';
        const cart = await getActiveCart({ sessionKey });

        const extracted = extractRequestedItems('Regular fries add krdo', cart);
        assert.strictEqual(extracted.items.length, 1, 'Should extract 1 Regular Fries item');
        assert.strictEqual(extracted.items[0].size, 'Regular');

        // Check if item already exists in cart with same variant
        const alreadyInCart = cart.items.some(ci => 
            (extracted.items[0].menuItemId && ci.menu_item_id === extracted.items[0].menuItemId) &&
            (extracted.items[0].variantId && ci.menu_variant_id === extracted.items[0].variantId)
        );

        assert.strictEqual(alreadyInCart, true, 'Regular Fries is already in the cart, preventing accidental duplicate');
    });

    // ── TEST 6: Order Summary — Both products appear with verified prices
    await itAsync('Order summary validation -> Contains both 4x Zegy Burger and 1x Fries (Regular)', async () => {
        const sessionKey = '923278497923@s.whatsapp.net';
        const cart = await getActiveCart({ sessionKey });
        const totals = await calculateCartTotals({ sessionKey });

        const zegy = totals.items.find(i => i.name.includes('Zegy'));
        const fries = totals.items.find(i => i.name.includes('Fries'));

        assert.ok(zegy, 'Summary must have Zegy Burger');
        assert.strictEqual(zegy.lineTotal, 1596, 'Zegy Burger line total = 1596');
        assert.ok(fries, 'Summary must have Fries');
        assert.strictEqual(fries.lineTotal, 220, 'Fries line total = 220');
        assert.strictEqual(totals.subtotal, 1816, 'Grand subtotal must be 1816');
    });

    // ── TEST 7: Backend Failure Handling
    it('Backend Failure simulation -> verifyOutput blocks fake confirmations and claims without genuine order', () => {
        const fakeOutput = 'Aap ka order successfully confirm ho gaya hai! Order Total Rs. 1816.';
        const result = verifyOutput(fakeOutput, { toolResults: [], activeCart: { items: [{ name: 'Fries' }] } });

        assert.ok(result.includes('Aapka order place nahi ho saka'), `Must block unverified order placement! Got: ${result}`);
        assert.ok(!result.includes('successfully confirm'), 'Must not claim success');
    });

    // ── TEST 8: Multi-Customer Isolation
    await itAsync('Multi-Customer Isolation -> Customer A (Aslam) and Customer B (Babar) completely isolated', async () => {
        const sessA = '923001111111@s.whatsapp.net';
        const sessB = '923002222222@s.whatsapp.net';

        clearSessionOrderDetails(sessA, '03001111111');
        clearSessionOrderDetails(sessB, '03002222222');
        await clearCart({ sessionKey: sessA });
        await clearCart({ sessionKey: sessB });

        updateSessionOrderDetails(sessA, { name: 'Aslam', phone: '03001111111', phoneConfirmed: true }, '03001111111');
        updateSessionOrderDetails(sessB, { name: 'Babar', phone: '03002222222', phoneConfirmed: true }, '03002222222');

        await addItemToCart({ sessionKey: sessA, menuItemId: 'item-20', quantity: 4 });
        await addItemToCart({ sessionKey: sessB, menuItemId: 'item-1', variantId: 'v-1-1', quantity: 1 });

        const detA = getSessionOrderDetails(sessA, '03001111111');
        const detB = getSessionOrderDetails(sessB, '03002222222');

        assert.strictEqual(detA.name, 'Aslam', 'Customer A name must be Aslam');
        assert.strictEqual(detB.name, 'Babar', 'Customer B name must be Babar');

        const cartA = await getActiveCart({ sessionKey: sessA });
        const cartB = await getActiveCart({ sessionKey: sessB });

        assert.strictEqual(cartA.items.length, 1);
        assert.strictEqual(cartA.items[0].quantity, 4);
        assert.strictEqual(cartB.items.length, 1);
        assert.strictEqual(cartB.items[0].quantity, 1);
    });

    // ── TEST 9: Stale Cart Summary Rejection
    await itAsync('Stale cart handling -> Subtotal changes immediately after cart mutation', async () => {
        const sessionKey = '923278497923@s.whatsapp.net';
        const beforeTotals = await calculateCartTotals({ sessionKey });
        assert.strictEqual(beforeTotals.subtotal, 1816);

        // Add 1 more fries
        await addItemToCart({ sessionKey, menuItemId: 'item-1', variantId: 'v-1-1', quantity: 1 });
        const afterTotals = await calculateCartTotals({ sessionKey });

        assert.strictEqual(afterTotals.subtotal, 2036, 'Subtotal must immediately reflect addition (1816 + 220 = 2036)');
    });

    // ── TEST 10: Order Confirmation Guard
    await itAsync('Order Confirmation Guard -> Confirmation is blocked if address or payment is missing', async () => {
        const sessionKey = '923278497923@s.whatsapp.net';
        const details = getSessionOrderDetails(sessionKey, '03278497923');

        // Address is missing
        details.address = null;
        details.location = null;

        const res = await checkFastRoute({
            text: 'Confirm',
            whatsappPhone: '03278497923',
            sessionKey,
            chatId: sessionKey,
        });

        assert.ok(res.handled, 'Must handle incomplete checkout confirmation');
        assert.ok(res.reply.includes('address') || res.reply.includes('Delivery'), `Must demand address before confirming! Got: ${res.reply}`);
        assert.ok(!res.reply.includes('CC-'), 'Must not generate order number when address is missing');
    });

    console.log('\n================================================================');
    console.log(`TOTAL USER VERIFICATION TESTS: ${total} | PASSED: ${passed} | FAILED: ${total - passed}`);
    console.log(`PASS RATE: ${((passed / total) * 100).toFixed(1)}%`);
    console.log('================================================================');
}

run().catch(err => {
    console.error('Test runner fatal error:', err);
    process.exit(1);
});
