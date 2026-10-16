import { getDbClient } from '../src/db/client.js';
import { getDefaultRestaurantId } from '../src/services/restaurantService.js';
import { checkFastRoute } from '../src/services/intentParser.js';
import { clearPendingOrderUpdate } from '../src/services/sessionService.js';
import { updateCustomerNameForChat, getConversations } from '../src/services/chatService.js';

async function runTest() {
    console.log('--- STARTING ORDER UPDATE FLOW TEST ---');
    const prisma = getDbClient();
    if (!prisma) {
        console.error('Database client not available');
        process.exit(1);
    }

    const restId = await getDefaultRestaurantId();
    const testPhone = '03199947554';
    const cleanPhone = '03199947554';
    const sessionKey = '923199947554@s.whatsapp.net';
    const chatId = sessionKey;

    // 1. Prepare or reset test order CC-000012
    let existingOrder = await prisma.order.findFirst({
        where: { order_number: 'CC-000012' },
        include: { customer: true },
    });

    if (!existingOrder) {
        console.log('Creating CC-000012 for test...');
        let cust = await prisma.customer.findFirst({
            where: { restaurant_id: restId, OR: [{ phone: cleanPhone }, { whatsapp_phone: cleanPhone }] },
        });
        if (!cust) {
            cust = await prisma.customer.create({
                data: {
                    restaurant_id: restId,
                    name: 'Test',
                    phone: cleanPhone,
                    whatsapp_phone: cleanPhone,
                },
            });
        } else {
            await prisma.customer.update({
                where: { id: cust.id },
                data: { name: 'Test' },
            });
        }

        existingOrder = await prisma.order.create({
            data: {
                restaurant_id: restId,
                order_number: 'CC-000012',
                customer_id: cust.id,
                customer_name: 'Test',
                phone: cleanPhone,
                whatsapp_phone: cleanPhone,
                source_chat_id: chatId,
                source_session_id: sessionKey,
                delivery_address: 'Ghauri town vip block',
                payment_method: 'COD',
                order_status: 'CONFIRMED',
                subtotal: 1399,
                total: 1399,
                order_items: {
                    create: [
                        {
                            item_name_snapshot: 'Behari Kebab Pizza',
                            variant_name_snapshot: 'Medium',
                            quantity: 1,
                            unit_price: 1399,
                            line_total: 1399,
                        }
                    ]
                }
            },
            include: { customer: true },
        });
    } else {
        console.log('Resetting CC-000012 to original state...');
        await prisma.order.update({
            where: { id: existingOrder.id },
            data: {
                customer_name: 'Test',
                delivery_address: 'Ghauri town vip block',
                order_status: 'CONFIRMED',
                source_chat_id: chatId,
                source_session_id: sessionKey,
                phone: cleanPhone,
                whatsapp_phone: cleanPhone,
            },
        });
        if (existingOrder.customer_id) {
            await prisma.customer.update({
                where: { id: existingOrder.customer_id },
                data: { name: 'Test' },
            });
        }
    }

    clearPendingOrderUpdate(sessionKey, cleanPhone);

    // Turn 1: "Address change krna ha"
    console.log('\n[Turn 1] Customer: "Address change krna ha"');
    const res1 = await checkFastRoute({
        text: 'Address change krna ha',
        whatsappPhone: testPhone,
        sessionKey,
        chatId,
    });
    console.log('Bot:', res1.reply);
    if (!res1.handled || !res1.reply.includes('naya delivery address kya rakhna chahenge')) {
        throw new Error('Turn 1 failed! Expected address prompt.');
    }

    // Turn 2: "Khanna pull krdo"
    console.log('\n[Turn 2] Customer: "Khanna pull krdo"');
    const res2 = await checkFastRoute({
        text: 'Khanna pull krdo',
        whatsappPhone: testPhone,
        sessionKey,
        chatId,
    });
    console.log('Bot:', res2.reply);
    if (!res2.handled || !res2.reply.includes('Khana Pull')) {
        throw new Error('Turn 2 failed! Expected staged address Khana Pull.');
    }

    // Turn 3: "Name bhi change kr k smilekashii kr do"
    console.log('\n[Turn 3] Customer: "Name bhi change kr k smilekashii kr do"');
    const res3 = await checkFastRoute({
        text: 'Name bhi change kr k smilekashii kr do',
        whatsappPhone: testPhone,
        sessionKey,
        chatId,
    });
    console.log('Bot:', res3.reply);
    if (!res3.handled || !res3.reply.includes('Smilekashii') || !res3.reply.includes('Khana Pull')) {
        throw new Error('Turn 3 failed! Expected staged name Smilekashii and address Khana Pull.');
    }

    // Turn 4: "Nahi bss yehi confirm kr do"
    console.log('\n[Turn 4] Customer: "Nahi bss yehi confirm kr do"');
    const res4 = await checkFastRoute({
        text: 'Nahi bss yehi confirm kr do',
        whatsappPhone: testPhone,
        sessionKey,
        chatId,
    });
    console.log('Bot:', res4.reply);
    if (!res4.handled || !res4.reply.includes('update ho gayi hain')) {
        throw new Error('Turn 4 failed! Expected order update confirmation.');
    }

    // Verify Database state
    const updatedOrder = await prisma.order.findFirst({
        where: { order_number: 'CC-000012' },
        include: { customer: true },
    });
    console.log('\n[DB Verification]');
    console.log('Order Customer Name:', updatedOrder.customer_name);
    console.log('Order Delivery Address:', updatedOrder.delivery_address);
    console.log('Customer Profile Name:', updatedOrder.customer?.name);

    if (updatedOrder.customer_name !== 'Smilekashii') {
        throw new Error(`DB order customer_name mismatch! Got: ${updatedOrder.customer_name}`);
    }
    if (updatedOrder.delivery_address !== 'Khana Pull') {
        throw new Error(`DB order delivery_address mismatch! Got: ${updatedOrder.delivery_address}`);
    }
    if (updatedOrder.customer?.name !== 'Smilekashii') {
        throw new Error(`DB customer table name mismatch! Got: ${updatedOrder.customer?.name}`);
    }

    // Turn 5: "Purany order ka adress kia ha ab?"
    console.log('\n[Turn 5] Customer: "Purany order ka adress kia ha ab?"');
    const res5 = await checkFastRoute({
        text: 'Purany order ka adress kia ha ab?',
        whatsappPhone: testPhone,
        sessionKey,
        chatId,
    });
    console.log('Bot:', res5.reply);
    if (!res5.handled || !res5.reply.includes('Khana Pull') || !res5.reply.includes('Smilekashii')) {
        throw new Error('Turn 5 failed! Expected current status with updated address and name.');
    }

    console.log('\n✅ ALL TEST STEPS PASSED SUCCESSFULLY!');
    process.exit(0);
}

runTest().catch(err => {
    console.error('\n❌ Test Error:', err);
    process.exit(1);
});
