import express from 'express';
import { getDbClient } from '../../src/db/client.js';
import { createDealSchema, updateDealSchema, createDealItemSchema, updateDealItemSchema } from '../../src/validators/dealSchema.js';
import { slugify } from '../../src/utils/slugify.js';
import { notifyN8nSync } from '../../src/services/syncService.js';
import { getDefaultRestaurantId } from '../../src/services/restaurantService.js';

const router = express.Router();

/**
 * GET /api/admin/deals
 * List all deals with included item counts and items
 */
router.get('/', async (req, res) => {
    try {
        const prisma = getDbClient();
        if (!prisma) {
            return res.status(503).json({
                success: false,
                error: { code: 'DB_UNAVAILABLE', message: 'Database not available' },
            });
        }

        let restaurantId = req.user?.restaurantId || req.user?.restaurant_id;
        if (!restaurantId) {
            try {
                restaurantId = await getDefaultRestaurantId();
            } catch (_) {}
        }

        const buildWhere = (rid) => (rid ? { restaurant_id: rid } : {});

        let deals = [];
        try {
            deals = await prisma.deal.findMany({
                where: buildWhere(restaurantId),
                orderBy: [{ sort_order: 'asc' }, { created_at: 'desc' }],
                include: {
                    deal_items: {
                        include: {
                            menu_item: { select: { id: true, name: true, base_price: true, is_available: true } },
                            menu_variant: { select: { id: true, name: true, price: true, is_available: true } },
                        },
                    },
                },
            });
            if ((!deals || deals.length === 0) && restaurantId) {
                deals = await prisma.deal.findMany({
                    where: {},
                    orderBy: [{ sort_order: 'asc' }, { created_at: 'desc' }],
                    include: {
                        deal_items: {
                            include: {
                                menu_item: { select: { id: true, name: true, base_price: true, is_available: true } },
                                menu_variant: { select: { id: true, name: true, price: true, is_available: true } },
                            },
                        },
                    },
                });
            }
        } catch (queryErr) {
            console.warn('[ADMIN] Deals complex query failed, trying simplified include:', queryErr.message);
            try {
                deals = await prisma.deal.findMany({
                    where: buildWhere(restaurantId),
                    orderBy: { sort_order: 'asc' },
                    include: {
                        deal_items: {
                            include: {
                                menu_item: { select: { id: true, name: true } },
                            },
                        },
                    },
                });
                if ((!deals || deals.length === 0) && restaurantId) {
                    deals = await prisma.deal.findMany({
                        where: {},
                        orderBy: { sort_order: 'asc' },
                        include: {
                            deal_items: {
                                include: {
                                    menu_item: { select: { id: true, name: true } },
                                },
                            },
                        },
                    });
                }
            } catch (err2) {
                console.warn('[ADMIN] Final deals fallback without relation include:', err2.message);
                deals = await prisma.deal.findMany({
                    where: {},
                    include: {
                        deal_items: true,
                    },
                });
            }
        }

        const formatted = (deals || []).map(d => ({
            id: d.id,
            name: d.name || '',
            slug: d.slug || '',
            description: d.description || '',
            image_url: d.image_url || '',
            deal_price: Number(d.deal_price ?? 0),
            start_at: d.start_at || null,
            end_at: d.end_at || null,
            is_active: Boolean(d.is_active ?? true),
            sort_order: d.sort_order ?? 0,
            items_count: Array.isArray(d.deal_items) ? d.deal_items.length : 0,
            items: Array.isArray(d.deal_items) ? d.deal_items.map(di => ({
                id: di.id,
                menu_item_id: di.menu_item_id,
                item_name: di.menu_item?.name || 'Item',
                menu_variant_id: di.menu_variant_id || null,
                variant_name: di.menu_variant?.name || null,
                quantity: di.quantity ?? 1,
            })) : [],
            created_at: d.created_at || new Date(),
            updated_at: d.updated_at || new Date(),
        }));

        return res.json({ success: true, data: formatted });
    } catch (err) {
        console.error('[ADMIN] Error listing deals:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message || 'Failed to retrieve deals' },
        });
    }
});

/**
 * POST /api/admin/deals
 * Create a new deal (optionally with initial items)
 */
router.post('/', async (req, res) => {
    try {
        const prisma = getDbClient();
        if (!prisma) {
            return res.status(503).json({
                success: false,
                error: { code: 'DB_UNAVAILABLE', message: 'Database not available' },
            });
        }

        let restaurantId = req.user?.restaurantId;
        if (!restaurantId) {
            try {
                restaurantId = await getDefaultRestaurantId();
            } catch (_) {}
        }
        const parsed = createDealSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: parsed.error.errors[0]?.message || 'Invalid input data',
                    details: parsed.error.errors,
                },
            });
        }

        const { name, description, image_url, deal_price, start_at, end_at, is_active, sort_order, items } = parsed.data;

        // Auto-generate unique slug
        let baseSlug = slugify(name);
        let slug = baseSlug;
        let counter = 1;
        while (await prisma.deal.findFirst({
            where: {
                ...(restaurantId ? { restaurant_id: restaurantId } : {}),
                slug,
            },
        })) {
            slug = `${baseSlug}-${counter++}`;
        }

        // Validate items if provided
        if (items && items.length > 0) {
            for (const it of items) {
                const menuItem = await prisma.menuItem.findFirst({
                    where: {
                        id: it.menu_item_id,
                        ...(restaurantId ? { restaurant_id: restaurantId } : {}),
                    },
                    include: { variants: true },
                });
                if (!menuItem) {
                    return res.status(400).json({
                        success: false,
                        error: { code: 'MENU_ITEM_NOT_FOUND', message: `Menu item '${it.menu_item_id}' not found` },
                    });
                }
                if (it.menu_variant_id) {
                    const variantExists = menuItem.variants.some(v => v.id === it.menu_variant_id);
                    if (!variantExists) {
                        return res.status(400).json({
                            success: false,
                            error: { code: 'VARIANT_NOT_FOUND', message: `Variant does not belong to item '${menuItem.name}'` },
                        });
                    }
                }
            }
        }

        const newDeal = await prisma.deal.create({
            data: {
                restaurant_id: restaurantId || null,
                name: name.trim(),
                slug,
                description: description?.trim() || null,
                image_url: image_url || null,
                deal_price,
                start_at: start_at ? new Date(start_at) : null,
                end_at: end_at ? new Date(end_at) : null,
                is_active: is_active ?? true,
                sort_order: sort_order ?? 0,
                ...(items && items.length > 0 ? {
                    deal_items: {
                        create: items.map(it => ({
                            menu_item_id: it.menu_item_id,
                            menu_variant_id: it.menu_variant_id || null,
                            quantity: it.quantity || 1,
                        })),
                    },
                } : {}),
            },
            include: {
                deal_items: {
                    include: {
                        menu_item: { select: { id: true, name: true } },
                        menu_variant: { select: { id: true, name: true } },
                    },
                },
            },
        });

        notifyN8nSync('deal_created');

        return res.status(201).json({
            success: true,
            data: {
                ...newDeal,
                deal_price: Number(newDeal.deal_price),
            },
        });
    } catch (err) {
        console.error('[ADMIN] Error creating deal:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Failed to create deal' },
        });
    }
});

/**
 * GET /api/admin/deals/:id
 */
router.get('/:id', async (req, res) => {
    try {
        const prisma = getDbClient();
        if (!prisma) {
            return res.status(503).json({
                success: false,
                error: { code: 'DB_UNAVAILABLE', message: 'Database not available' },
            });
        }

        let restaurantId = req.user?.restaurantId || req.user?.restaurant_id;
        let deal = await prisma.deal.findFirst({
            where: {
                id: req.params.id,
                ...(restaurantId ? { restaurant_id: restaurantId } : {}),
            },
            include: {
                deal_items: {
                    include: {
                        menu_item: true,
                        menu_variant: true,
                    },
                },
            },
        });

        if (!deal && restaurantId) {
            deal = await prisma.deal.findFirst({
                where: { id: req.params.id },
                include: {
                    deal_items: {
                        include: {
                            menu_item: true,
                            menu_variant: true,
                        },
                    },
                },
            });
        }

        if (!deal) {
            return res.status(404).json({
                success: false,
                error: { code: 'DEAL_NOT_FOUND', message: 'Deal not found' },
            });
        }

        return res.json({
            success: true,
            data: {
                ...deal,
                deal_price: Number(deal.deal_price ?? 0),
            },
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message || 'Failed to retrieve deal' },
        });
    }
});

/**
 * PUT /api/admin/deals/:id
 * Update deal details
 */
router.put('/:id', async (req, res) => {
    try {
        const prisma = getDbClient();
        if (!prisma) {
            return res.status(503).json({
                success: false,
                error: { code: 'DB_UNAVAILABLE', message: 'Database not available' },
            });
        }

        const restaurantId = req.user?.restaurantId;
        const parsed = updateDealSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: parsed.error.errors[0]?.message || 'Invalid input data',
                },
            });
        }

        const existing = await prisma.deal.findFirst({
            where: { id: req.params.id, ...(restaurantId ? { restaurant_id: restaurantId } : {}) },
        });
        if (!existing) {
            return res.status(404).json({
                success: false,
                error: { code: 'DEAL_NOT_FOUND', message: 'Deal not found' },
            });
        }

        const updateData = {};
        if (parsed.data.name !== undefined) updateData.name = parsed.data.name.trim();
        if (parsed.data.description !== undefined) updateData.description = parsed.data.description?.trim() || null;
        if (parsed.data.image_url !== undefined) updateData.image_url = parsed.data.image_url;
        if (parsed.data.deal_price !== undefined) updateData.deal_price = parsed.data.deal_price;
        if (parsed.data.start_at !== undefined) updateData.start_at = parsed.data.start_at ? new Date(parsed.data.start_at) : null;
        if (parsed.data.end_at !== undefined) updateData.end_at = parsed.data.end_at ? new Date(parsed.data.end_at) : null;
        if (parsed.data.is_active !== undefined) updateData.is_active = parsed.data.is_active;
        if (parsed.data.sort_order !== undefined) updateData.sort_order = parsed.data.sort_order;

        const updated = await prisma.deal.update({
            where: { id: req.params.id },
            data: updateData,
            include: {
                deal_items: {
                    include: {
                        menu_item: true,
                        menu_variant: true,
                    },
                },
            },
        });

        notifyN8nSync('deal_updated');

        return res.json({
            success: true,
            data: {
                ...updated,
                deal_price: Number(updated.deal_price),
            },
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message },
        });
    }
});

/**
 * PATCH /api/admin/deals/:id/status
 * Toggle deal active status
 */
router.patch('/:id/status', async (req, res) => {
    try {
        const prisma = getDbClient();
        if (!prisma) {
            return res.status(503).json({
                success: false,
                error: { code: 'DB_UNAVAILABLE', message: 'Database not available' },
            });
        }

        const restaurantId = req.user?.restaurantId;
        const deal = await prisma.deal.findFirst({
            where: { id: req.params.id, ...(restaurantId ? { restaurant_id: restaurantId } : {}) },
        });

        if (!deal) {
            return res.status(404).json({
                success: false,
                error: { code: 'DEAL_NOT_FOUND', message: 'Deal not found' },
            });
        }

        const newStatus = typeof req.body.is_active === 'boolean' ? req.body.is_active : !deal.is_active;
        const updated = await prisma.deal.update({
            where: { id: req.params.id },
            data: { is_active: newStatus },
        });

        notifyN8nSync('deal_status_changed');

        return res.json({
            success: true,
            data: { id: updated.id, is_active: updated.is_active },
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message },
        });
    }
});

/**
 * DELETE /api/admin/deals/:id
 */
router.delete('/:id', async (req, res) => {
    try {
        const prisma = getDbClient();
        if (!prisma) {
            return res.status(503).json({
                success: false,
                error: { code: 'DB_UNAVAILABLE', message: 'Database not available' },
            });
        }

        const restaurantId = req.user?.restaurantId;
        const deal = await prisma.deal.findFirst({
            where: { id: req.params.id, ...(restaurantId ? { restaurant_id: restaurantId } : {}) },
        });

        if (!deal) {
            return res.status(404).json({
                success: false,
                error: { code: 'DEAL_NOT_FOUND', message: 'Deal not found' },
            });
        }

        await prisma.deal.delete({ where: { id: req.params.id } });

        notifyN8nSync('deal_deleted');

        return res.json({
            success: true,
            data: { id: req.params.id, message: 'Deal deleted successfully' },
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message },
        });
    }
});

// ─── Deal Items Endpoints ─────────────────────────────────

/**
 * POST /api/admin/deals/:id/items
 * Add an item to a deal
 */
router.post('/:id/items', async (req, res) => {
    try {
        const prisma = getDbClient();
        if (!prisma) {
            return res.status(503).json({
                success: false,
                error: { code: 'DB_UNAVAILABLE', message: 'Database not available' },
            });
        }

        const restaurantId = req.user?.restaurantId;
        const deal = await prisma.deal.findFirst({
            where: { id: req.params.id, ...(restaurantId ? { restaurant_id: restaurantId } : {}) },
        });
        if (!deal) {
            return res.status(404).json({
                success: false,
                error: { code: 'DEAL_NOT_FOUND', message: 'Deal not found' },
            });
        }

        const parsed = createDealItemSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: parsed.error.errors[0]?.message || 'Invalid deal item data',
                },
            });
        }

        const { menu_item_id, menu_variant_id, quantity } = parsed.data;

        const menuItem = await prisma.menuItem.findFirst({
            where: { id: menu_item_id, ...(restaurantId ? { restaurant_id: restaurantId } : {}) },
            include: { variants: true },
        });
        if (!menuItem) {
            return res.status(400).json({
                success: false,
                error: { code: 'MENU_ITEM_NOT_FOUND', message: 'Referenced menu item not found' },
            });
        }

        if (menu_variant_id) {
            const variantExists = menuItem.variants.some(v => v.id === menu_variant_id);
            if (!variantExists) {
                return res.status(400).json({
                    success: false,
                    error: { code: 'VARIANT_NOT_FOUND', message: `Variant does not belong to '${menuItem.name}'` },
                });
            }
        }

        const dealItem = await prisma.dealItem.create({
            data: {
                deal_id: deal.id,
                menu_item_id,
                menu_variant_id: menu_variant_id || null,
                quantity: quantity || 1,
            },
            include: {
                menu_item: { select: { id: true, name: true } },
                menu_variant: { select: { id: true, name: true } },
            },
        });

        return res.status(201).json({
            success: true,
            data: dealItem,
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message },
        });
    }
});

/**
 * PUT /api/admin/deal-items/:id
 * Update deal item (variant or quantity)
 */
router.put('/items/:id', async (req, res) => {
    try {
        const prisma = getDbClient();
        if (!prisma) {
            return res.status(503).json({
                success: false,
                error: { code: 'DB_UNAVAILABLE', message: 'Database not available' },
            });
        }

        const parsed = updateDealItemSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: parsed.error.errors[0]?.message || 'Invalid deal item data',
                },
            });
        }

        const existing = await prisma.dealItem.findUnique({
            where: { id: req.params.id },
            include: { menu_item: { include: { variants: true } } },
        });
        if (!existing) {
            return res.status(404).json({
                success: false,
                error: { code: 'DEAL_ITEM_NOT_FOUND', message: 'Deal item not found' },
            });
        }

        if (parsed.data.menu_variant_id) {
            const variantExists = existing.menu_item.variants.some(v => v.id === parsed.data.menu_variant_id);
            if (!variantExists) {
                return res.status(400).json({
                    success: false,
                    error: { code: 'VARIANT_NOT_FOUND', message: 'Variant does not belong to the menu item' },
                });
            }
        }

        const updateData = {};
        if (parsed.data.menu_variant_id !== undefined) updateData.menu_variant_id = parsed.data.menu_variant_id || null;
        if (parsed.data.quantity !== undefined) updateData.quantity = parsed.data.quantity;

        const updated = await prisma.dealItem.update({
            where: { id: req.params.id },
            data: updateData,
            include: {
                menu_item: { select: { id: true, name: true } },
                menu_variant: { select: { id: true, name: true } },
            },
        });

        return res.json({ success: true, data: updated });
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message },
        });
    }
});

/**
 * DELETE /api/admin/deal-items/:id
 */
router.delete('/items/:id', async (req, res) => {
    try {
        const prisma = getDbClient();
        if (!prisma) {
            return res.status(503).json({
                success: false,
                error: { code: 'DB_UNAVAILABLE', message: 'Database not available' },
            });
        }

        const existing = await prisma.dealItem.findUnique({ where: { id: req.params.id } });
        if (!existing) {
            return res.status(404).json({
                success: false,
                error: { code: 'DEAL_ITEM_NOT_FOUND', message: 'Deal item not found' },
            });
        }

        await prisma.dealItem.delete({ where: { id: req.params.id } });

        return res.json({
            success: true,
            data: { id: req.params.id, message: 'Deal item removed successfully' },
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message },
        });
    }
});

export default router;
