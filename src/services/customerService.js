import { getDbClient } from '../db/client.js';
import { getDefaultRestaurantId } from './restaurantService.js';

/**
 * Normalizes phone number: strips non-digit characters, preserves international prefix
 * @param {string} phone
 * @returns {string}
 */
export function normalizePhone(phone) {
    if (!phone) return '';
    const cleaned = String(phone).replace(/[^\d+]/g, '');
    if (cleaned.startsWith('+')) {
        return cleaned.substring(1);
    }
    return cleaned;
}

/**
 * Get or create customer record
 * - Preserves verified WhatsApp phone
 * - Never derives real phone from @lid digits
 * - Avoids unnecessary duplication
 *
 * @param {Object} params
 * @param {string} [params.restaurantId]
 * @param {string} [params.name]
 * @param {string} [params.phone]
 * @param {string} [params.whatsappPhone]
 * @returns {Promise<Object>}
 */
export async function getOrCreateCustomer({ restaurantId, name, phone, whatsappPhone }) {
    const prisma = getDbClient();
    if (!prisma) {
        throw new Error('Database client not available');
    }

    const restId = restaurantId || await getDefaultRestaurantId();
    const cleanWhatsapp = normalizePhone(whatsappPhone);
    const cleanPhone = normalizePhone(phone);

    let customer = null;

    // 1. Try finding by verified WhatsApp phone first if present
    if (cleanWhatsapp) {
        customer = await prisma.customer.findUnique({
            where: {
                restaurant_id_whatsapp_phone: {
                    restaurant_id: restId,
                    whatsapp_phone: cleanWhatsapp,
                },
            },
        });
    }

    // 2. Fall back to finding by contact phone if WhatsApp lookup didn't find one
    if (!customer && cleanPhone) {
        customer = await prisma.customer.findFirst({
            where: {
                restaurant_id: restId,
                phone: cleanPhone,
            },
        });
    }

    // 3. If found, update details if new name or phones provided
    if (customer) {
        const updates = {};
        if (name && (!customer.name || customer.name !== name.trim())) {
            updates.name = name.trim();
        }
        if (cleanPhone && (!customer.phone || customer.phone !== cleanPhone)) {
            updates.phone = cleanPhone;
        }
        if (cleanWhatsapp && (!customer.whatsapp_phone || customer.whatsapp_phone !== cleanWhatsapp)) {
            updates.whatsapp_phone = cleanWhatsapp;
        }

        if (Object.keys(updates).length > 0) {
            customer = await prisma.customer.update({
                where: { id: customer.id },
                data: updates,
            });
        }
        return customer;
    }

    // 4. Otherwise create new customer
    customer = await prisma.customer.create({
        data: {
            restaurant_id: restId,
            name: name ? name.trim() : null,
            phone: cleanPhone || cleanWhatsapp || null,
            whatsapp_phone: cleanWhatsapp || null,
            total_orders: 0,
        },
    });

    return customer;
}

/**
 * Get customer by phone or WhatsApp phone
 */
export async function getCustomerByPhone({ restaurantId, phone }) {
    const prisma = getDbClient();
    if (!prisma) return null;

    const restId = restaurantId || await getDefaultRestaurantId();
    const clean = normalizePhone(phone);
    if (!clean) return null;

    return prisma.customer.findFirst({
        where: {
            restaurant_id: restId,
            OR: [
                { phone: clean },
                { whatsapp_phone: clean },
            ],
        },
    });
}

/**
 * List registered customers with search, pagination and aggregated stats
 */
export async function listCustomers({ restaurantId, search, page = 1, limit = 50 }) {
    const prisma = getDbClient();
    if (!prisma) {
        throw new Error('Database client not available');
    }

    const restId = restaurantId || await getDefaultRestaurantId();
    const take = Math.max(1, Math.min(parseInt(limit, 10) || 50, 100));
    const skip = (Math.max(1, parseInt(page, 10) || 1) - 1) * take;

    const where = {
        restaurant_id: restId,
    };

    if (search && search.trim()) {
        const q = search.trim();
        where.OR = [
            { name: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q, mode: 'insensitive' } },
            { whatsapp_phone: { contains: q, mode: 'insensitive' } },
        ];
    }

    const [total, customers] = await Promise.all([
        prisma.customer.count({ where }),
        prisma.customer.findMany({
            where,
            orderBy: { updated_at: 'desc' },
            skip,
            take,
            include: {
                orders: {
                    select: {
                        id: true,
                        order_number: true,
                        total: true,
                        order_status: true,
                        created_at: true,
                    },
                    orderBy: { created_at: 'desc' },
                    take: 5,
                },
            },
        }),
    ]);

    const formatted = await Promise.all(customers.map(async (c) => {
        const spendAgg = await prisma.order.aggregate({
            where: {
                restaurant_id: restId,
                customer_id: c.id,
            },
            _sum: { total: true },
            _count: { id: true },
        });

        const totalOrders = spendAgg._count.id || c.total_orders || 0;
        const totalSpent = Number(spendAgg._sum.total || 0);

        return {
            id: c.id,
            name: c.name || 'Anonymous Customer',
            phone: c.phone || '',
            whatsappPhone: c.whatsapp_phone || c.phone || '',
            totalOrders,
            totalSpent,
            firstOrder: c.first_order_at || c.created_at,
            lastOrder: c.last_order_at || c.updated_at,
            createdAt: c.created_at,
            recentOrders: c.orders.map(o => ({
                id: o.id,
                orderNumber: o.order_number,
                total: Number(o.total),
                orderStatus: o.order_status,
                createdAt: o.created_at,
            })),
        };
    }));

    return {
        customers: formatted,
        pagination: {
            total,
            page: Math.max(1, parseInt(page, 10) || 1),
            limit: take,
            totalPages: Math.ceil(total / take) || 1,
        },
    };
}

/**
 * Get customer details and complete order history by customer ID
 */
export async function getCustomerById({ restaurantId, customerId }) {
    const prisma = getDbClient();
    if (!prisma) {
        throw new Error('Database client not available');
    }

    const restId = restaurantId || await getDefaultRestaurantId();

    const customer = await prisma.customer.findFirst({
        where: {
            id: customerId,
            restaurant_id: restId,
        },
        include: {
            orders: {
                orderBy: { created_at: 'desc' },
                include: {
                    order_items: true,
                },
            },
        },
    });

    if (!customer) return null;

    const spendAgg = await prisma.order.aggregate({
        where: {
            restaurant_id: restId,
            customer_id: customer.id,
        },
        _sum: { total: true },
        _count: { id: true },
    });

    return {
        id: customer.id,
        name: customer.name || 'Anonymous Customer',
        phone: customer.phone || '',
        whatsappPhone: customer.whatsapp_phone || customer.phone || '',
        totalOrders: spendAgg._count.id || customer.total_orders || 0,
        totalSpent: Number(spendAgg._sum.total || 0),
        firstOrder: customer.first_order_at || customer.created_at,
        lastOrder: customer.last_order_at || customer.updated_at,
        createdAt: customer.created_at,
        orders: customer.orders.map(o => ({
            id: o.id,
            orderNumber: o.order_number,
            customerName: o.customer_name,
            phone: o.phone,
            deliveryAddress: o.delivery_address,
            paymentMethod: o.payment_method,
            paymentStatus: o.payment_status,
            orderStatus: o.order_status,
            total: Number(o.total),
            subtotal: Number(o.subtotal),
            deliveryFee: Number(o.delivery_fee),
            itemCount: o.order_items?.length || 0,
            itemsSummary: o.order_items?.map(it => `${it.quantity}x ${it.item_name_snapshot || 'Item'}`).join(', ') || '',
            createdAt: o.created_at,
        })),
    };
}

/**
 * Delete a single customer record and clean up associated carts/sessions
 * @param {Object} params
 * @param {string} [params.restaurantId]
 * @param {string} params.customerId
 * @param {boolean} [params.deleteOrders=false]
 */
export async function deleteCustomer({ restaurantId, customerId, deleteOrders = false }) {
    const prisma = getDbClient();
    if (!prisma) {
        throw new Error('Database client not available');
    }

    const restId = restaurantId || await getDefaultRestaurantId();

    const customer = await prisma.customer.findFirst({
        where: {
            id: customerId,
            restaurant_id: restId,
        },
    });

    if (!customer) {
        throw new Error('Customer not found');
    }

    const cleanPhones = [customer.phone, customer.whatsapp_phone].filter(Boolean);
    let deletedOrdersCount = 0;

    await prisma.$transaction(async (tx) => {
        // 1. If deleteOrders is true, completely remove orders, items and histories
        if (deleteOrders) {
            const customerOrders = await tx.order.findMany({
                where: {
                    restaurant_id: restId,
                    OR: [
                        { customer_id: customerId },
                        ...(cleanPhones.length > 0 ? [{ phone: { in: cleanPhones } }] : []),
                    ],
                },
                select: { id: true },
            });

            if (customerOrders.length > 0) {
                const orderIds = customerOrders.map(o => o.id);
                await tx.orderItem.deleteMany({ where: { order_id: { in: orderIds } } });
                await tx.orderStatusHistory.deleteMany({ where: { order_id: { in: orderIds } } });
                const delRes = await tx.order.deleteMany({ where: { id: { in: orderIds } } });
                deletedOrdersCount = delRes.count;
            }
        } else {
            // Unlink customer from orders to keep accounting totals intact
            await tx.order.updateMany({
                where: {
                    restaurant_id: restId,
                    customer_id: customerId,
                },
                data: {
                    customer_id: null,
                },
            });
        }

        // 2. Delete Carts associated with this customer
        const customerCarts = await tx.cart.findMany({
            where: {
                restaurant_id: restId,
                customer_id: customerId,
            },
            select: { id: true },
        });

        if (customerCarts.length > 0) {
            const cartIds = customerCarts.map(c => c.id);
            await tx.cartItem.deleteMany({ where: { cart_id: { in: cartIds } } });
            await tx.cart.deleteMany({ where: { id: { in: cartIds } } });
        }

        // 3. Delete Conversation Sessions matching customer phones
        if (cleanPhones.length > 0) {
            const matchingSessions = await tx.conversationSession.findMany({
                where: {
                    restaurant_id: restId,
                    OR: [
                        { verified_phone: { in: cleanPhones } },
                        ...cleanPhones.map(p => ({ chat_id: { contains: p } })),
                    ],
                },
                select: { id: true },
            });

            if (matchingSessions.length > 0) {
                const sessionIds = matchingSessions.map(s => s.id);
                const sessionCarts = await tx.cart.findMany({
                    where: { session_id: { in: sessionIds } },
                    select: { id: true },
                });
                if (sessionCarts.length > 0) {
                    const scIds = sessionCarts.map(c => c.id);
                    await tx.cartItem.deleteMany({ where: { cart_id: { in: scIds } } });
                    await tx.cart.deleteMany({ where: { id: { in: scIds } } });
                }
                await tx.conversationSession.deleteMany({ where: { id: { in: sessionIds } } });
            }
        }

        // 4. Delete Customer row
        await tx.customer.delete({
            where: { id: customerId },
        });
    });

    return {
        deleted: true,
        customerId,
        customerName: customer.name,
        phone: customer.phone,
        deletedOrdersCount,
    };
}

/**
 * Delete customer by phone number (used for WhatsApp self-deletion commands)
 */
export async function deleteCustomerByPhone({ restaurantId, phone, deleteOrders = false }) {
    const prisma = getDbClient();
    if (!prisma) {
        throw new Error('Database client not available');
    }

    const restId = restaurantId || await getDefaultRestaurantId();
    const clean = normalizePhone(phone);
    if (!clean) {
        throw new Error('Valid phone number is required');
    }

    const customer = await prisma.customer.findFirst({
        where: {
            restaurant_id: restId,
            OR: [
                { phone: clean },
                { whatsapp_phone: clean },
            ],
        },
    });

    if (customer) {
        return deleteCustomer({
            restaurantId: restId,
            customerId: customer.id,
            deleteOrders,
        });
    }

    // Even if no Customer record exists, purge active sessions and carts for this phone
    const matchingSessions = await prisma.conversationSession.findMany({
        where: {
            restaurant_id: restId,
            OR: [
                { verified_phone: clean },
                { chat_id: { contains: clean } },
            ],
        },
        select: { id: true },
    });

    if (matchingSessions.length > 0) {
        const sessionIds = matchingSessions.map(s => s.id);
        const sessionCarts = await prisma.cart.findMany({
            where: { session_id: { in: sessionIds } },
            select: { id: true },
        });
        if (sessionCarts.length > 0) {
            const scIds = sessionCarts.map(c => c.id);
            await prisma.cartItem.deleteMany({ where: { cart_id: { in: scIds } } });
            await prisma.cart.deleteMany({ where: { id: { in: scIds } } });
        }
        await prisma.conversationSession.deleteMany({ where: { id: { in: sessionIds } } });
    }

    return {
        deleted: true,
        customerId: null,
        phone: clean,
        deletedOrdersCount: 0,
    };
}

/**
 * Bulk delete customers by IDs or inactive cutoff days
 */
export async function bulkDeleteCustomers({ restaurantId, customerIds = [], olderThanDays = null, deleteOrders = false }) {
    const prisma = getDbClient();
    if (!prisma) {
        throw new Error('Database client not available');
    }

    const restId = restaurantId || await getDefaultRestaurantId();
    const where = { restaurant_id: restId };

    if (Array.isArray(customerIds) && customerIds.length > 0) {
        where.id = { in: customerIds };
    } else if (olderThanDays !== null && olderThanDays !== undefined && olderThanDays !== '') {
        const days = parseInt(olderThanDays, 10);
        if (days > 0) {
            const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
            where.OR = [
                { last_order_at: { lt: cutoff } },
                { AND: [{ last_order_at: null }, { created_at: { lt: cutoff } }] },
            ];
        }
        // If days === 0 or 'all', no date filter needed, matches all customers of the restaurant
    } else {
        throw new Error('Either customerIds or olderThanDays must be specified');
    }

    const customersToDelete = await prisma.customer.findMany({
        where,
        select: { id: true },
    });

    let count = 0;
    for (const cust of customersToDelete) {
        try {
            await deleteCustomer({
                restaurantId: restId,
                customerId: cust.id,
                deleteOrders,
            });
            count++;
        } catch (e) {
            console.error(`Failed to delete customer ${cust.id}:`, e.message);
        }
    }

    return {
        success: true,
        count,
        totalTargeted: customersToDelete.length,
    };
}

