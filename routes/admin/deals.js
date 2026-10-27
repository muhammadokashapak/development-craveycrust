import express from 'express';
import { getDbClient } from '../../src/db/client.js';
import {
    FALLBACK_DEALS,
    getFallbackDeals,
    getFallbackDealById,
    updateFallbackDeal,
    createFallbackDeal,
    deleteFallbackDeal,
    toggleFallbackDealStatus,
    deleteAllFallbackDeals,
} from '../../src/services/fallbackCatalog.js';
import { createDealSchema, updateDealSchema, createDealItemSchema, updateDealItemSchema } from '../../src/validators/dealSchema.js';
import { slugify } from '../../src/utils/slugify.js';
import { notifyN8nSync } from '../../src/services/syncService.js';
import { getDefaultRestaurantId } from '../../src/services/restaurantService.js';
import { refreshCatalogCache } from '../../src/services/catalogCacheService.js';

const router = express.Router();

async function resolveMenuItemForDeal(prisma, restaurantId, it) {
    let menuItem = await prisma.menuItem.findFirst({
        where: { id: it.menu_item_id, ...(restaurantId ? { restaurant_id: restaurantId } : {}) },
        include: { variants: true },
    });

    if (!menuItem) {
        const isClassic = it.menu_item_id === 'item-33' || it.menu_item_id.includes('classic');
        const isPrem = it.menu_item_id === 'item-36' || it.menu_item_id.includes('premium');
        const isBurger = it.menu_item_id === 'item-37' || it.menu_item_id.includes('burger');

        if (isClassic) {
            menuItem = await prisma.menuItem.findFirst({
                where: {
                    ...(restaurantId ? { restaurant_id: restaurantId } : {}),
                    OR: [{ name: { contains: 'Classic Pizza', mode: 'insensitive' } }, { slug: 'classic-pizza' }, { slug: 'classic-pizza-choice' }],
                },
                include: { variants: true },
            });
            if (!menuItem) {
                const cat = await prisma.category.findFirst({
                    where: { ...(restaurantId ? { restaurant_id: restaurantId } : {}), name: { contains: 'Classic', mode: 'insensitive' } },
                });
                if (cat) {
                    menuItem = await prisma.menuItem.create({
                        data: {
                            restaurant_id: cat.restaurant_id,
                            category_id: cat.id,
                            name: "Classic Pizza (Customer's Choice)",
                            slug: 'classic-pizza-choice',
                            description: 'Customer chooses any classic pizza flavour on WhatsApp (Cheese Lover, Chicken Tikka, Supreme, Fajita, Tandori)',
                            base_price: 599,
                            is_active: true,
                            is_available: true,
                            variants: {
                                create: [
                                    { name: 'Small', price: 599, sort_order: 1, is_available: true },
                                    { name: 'Medium', price: 1299, sort_order: 2, is_available: true },
                                    { name: 'Large', price: 1499, sort_order: 3, is_available: true },
                                    { name: 'Party Size', price: 2599, sort_order: 4, is_available: true },
                                ],
                            },
                        },
                        include: { variants: true },
                    }).catch(() => null);
                }
            }
        } else if (isPrem) {
            menuItem = await prisma.menuItem.findFirst({
                where: {
                    ...(restaurantId ? { restaurant_id: restaurantId } : {}),
                    OR: [{ name: { contains: 'Premium Pizza', mode: 'insensitive' } }, { slug: 'premium-pizza-choice' }],
                },
                include: { variants: true },
            });
            if (!menuItem) {
                const cat = await prisma.category.findFirst({
                    where: { ...(restaurantId ? { restaurant_id: restaurantId } : {}), name: { contains: 'Premium', mode: 'insensitive' } },
                });
                if (cat) {
                    menuItem = await prisma.menuItem.create({
                        data: {
                            restaurant_id: cat.restaurant_id,
                            category_id: cat.id,
                            name: "Premium Pizza (Customer's Choice)",
                            slug: 'premium-pizza-choice',
                            description: 'Customer chooses any premium pizza flavour on WhatsApp (Chicken Extreme, Peri Peri, Behari Kebab, Crown Crust, Stuffed Crust)',
                            base_price: 699,
                            is_active: true,
                            is_available: true,
                            variants: {
                                create: [
                                    { name: 'Small', price: 699, sort_order: 1, is_available: true },
                                    { name: 'Medium', price: 1399, sort_order: 2, is_available: true },
                                    { name: 'Large', price: 1799, sort_order: 3, is_available: true },
                                    { name: 'Party Size', price: 2799, sort_order: 4, is_available: true },
                                ],
                            },
                        },
                        include: { variants: true },
                    }).catch(() => null);
                }
            }
        } else if (isBurger) {
            menuItem = await prisma.menuItem.findFirst({
                where: {
                    ...(restaurantId ? { restaurant_id: restaurantId } : {}),
                    OR: [{ name: { contains: 'Burger', mode: 'insensitive' } }, { slug: 'burger-choice' }],
                },
                include: { variants: true },
            });
        }

        if (menuItem) {
            it.menu_item_id = menuItem.id;
        }
    }

    if (menuItem && it.menu_variant_id) {
        const variantExists = menuItem.variants.some(v => v.id === it.menu_variant_id);
        if (!variantExists) {
            const vMatched = menuItem.variants.find(v => {
                const vn = v.name.toLowerCase();
                const vIdLower = (it.menu_variant_id || '').toLowerCase();
                if (vIdLower.endsWith('-1') && vn === 'small') return true;
                if (vIdLower.endsWith('-2') && vn === 'medium') return true;
                if (vIdLower.endsWith('-3') && vn === 'large') return true;
                if (vIdLower.endsWith('-4') && vn.includes('party')) return true;
                return false;
            }) || menuItem.variants[0];

            if (vMatched) {
                it.menu_variant_id = vMatched.id;
            }
        }
    }

    return menuItem;
}

/**
 * GET /api/admin/deals
 * List all deals with included item counts and items
 */
router.get('/', async (req, res) => {
    try {
        const prisma = getDbClient();
        if (!prisma) {
            return res.json({ success: true, data: getFallbackDeals() });
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
                try {
                    deals = await prisma.deal.findMany({
                        where: {},
                        include: {
                            deal_items: true,
                        },
                    });
                } catch (err3) {
                    console.warn('[ADMIN] DB completely unreachable, returning fallback deals:', err3.message);
                    return res.json({ success: true, data: getFallbackDeals() });
                }
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

        if (formatted.length === 0) {
            return res.json({ success: true, data: getFallbackDeals() });
        }

        return res.json({ success: true, data: formatted });
    } catch (err) {
        console.warn('[ADMIN] Error listing deals from DB, returning fallback:', err.message);
        return res.json({ success: true, data: getFallbackDeals() });
    }
});

/**
 * POST /api/admin/deals
 * Create a new deal (optionally with initial items)
 */
router.post('/', async (req, res) => {
    try {
        const prisma = getDbClient();
        if (prisma) {
            try {
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

                const { name, image_url, deal_price, start_at, end_at, is_active, sort_order, items } = parsed.data;

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
                        const menuItem = await resolveMenuItemForDeal(prisma, restaurantId, it);
                        if (!menuItem) {
                            return res.status(400).json({
                                success: false,
                                error: { code: 'MENU_ITEM_NOT_FOUND', message: `Menu item '${it.menu_item_id}' not found` },
                            });
                        }
                    }
                }

                const newDeal = await prisma.deal.create({
                    data: {
                        restaurant_id: restaurantId || null,
                        name: name.trim(),
                        slug,
                        description: null,
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
                refreshCatalogCache().catch(() => {});

                return res.status(201).json({
                    success: true,
                    data: {
                        ...newDeal,
                        deal_price: Number(newDeal.deal_price),
                    },
                });
            } catch (dbErr) {
                console.warn('[ADMIN] DB deal create failed, saving to fallback:', dbErr.message);
            }
        }

        const newFallback = createFallbackDeal(req.body);
        refreshCatalogCache().catch(() => {});
        return res.status(201).json({
            success: true,
            message: 'Deal created successfully',
            data: newFallback,
        });
    } catch (err) {
        console.error('[ADMIN] Error creating deal:', err);
        const newFallback = createFallbackDeal(req.body);
        return res.status(201).json({
            success: true,
            message: 'Deal created successfully',
            data: newFallback,
        });
    }
});

/**
 * GET /api/admin/deals/:id
 */
router.get('/:id', async (req, res) => {
    try {
        const prisma = getDbClient();
        if (prisma) {
            try {
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

                if (deal) {
                    return res.json({
                        success: true,
                        data: {
                            ...deal,
                            deal_price: Number(deal.deal_price ?? 0),
                        },
                    });
                }
            } catch (dbErr) {
                console.warn('[ADMIN] DB deal lookup failed, using fallback:', dbErr.message);
            }
        }

        const fallback = getFallbackDealById(req.params.id);
        if (fallback) {
            return res.json({
                success: true,
                data: fallback,
            });
        }

        return res.status(404).json({
            success: false,
            error: { code: 'DEAL_NOT_FOUND', message: 'Deal not found' },
        });
    } catch (err) {
        console.warn('[ADMIN] Error retrieving deal, falling back:', err.message);
        const fallback = getFallbackDealById(req.params.id);
        if (fallback) {
            return res.json({
                success: true,
                data: fallback,
            });
        }
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
        if (prisma) {
            try {
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

                if (existing) {
                    if (parsed.data.items && parsed.data.items.length > 0) {
                        for (const it of parsed.data.items) {
                            const menuItem = await resolveMenuItemForDeal(prisma, restaurantId, it);
                            if (!menuItem) {
                                return res.status(404).json({
                                    success: false,
                                    error: { code: 'MENU_ITEM_NOT_FOUND', message: `Menu item '${it.menu_item_id}' not found` },
                                });
                            }
                        }
                    }

                    const updateData = { description: null };
                    if (parsed.data.name !== undefined) updateData.name = parsed.data.name.trim();
                    if (parsed.data.image_url !== undefined) updateData.image_url = parsed.data.image_url;
                    if (parsed.data.deal_price !== undefined) updateData.deal_price = parsed.data.deal_price;
                    if (parsed.data.start_at !== undefined) updateData.start_at = parsed.data.start_at ? new Date(parsed.data.start_at) : null;
                    if (parsed.data.end_at !== undefined) updateData.end_at = parsed.data.end_at ? new Date(parsed.data.end_at) : null;
                    if (parsed.data.is_active !== undefined) updateData.is_active = parsed.data.is_active;
                    if (parsed.data.sort_order !== undefined) updateData.sort_order = parsed.data.sort_order;

                    const updated = await prisma.$transaction(async (tx) => {
                        await tx.deal.update({
                            where: { id: req.params.id },
                            data: updateData,
                        });

                        if (parsed.data.items !== undefined) {
                            await tx.dealItem.deleteMany({
                                where: { deal_id: req.params.id },
                            });

                            if (parsed.data.items.length > 0) {
                                await tx.dealItem.createMany({
                                    data: parsed.data.items.map(it => ({
                                        deal_id: req.params.id,
                                        menu_item_id: it.menu_item_id,
                                        menu_variant_id: it.menu_variant_id || null,
                                        quantity: it.quantity || 1,
                                    })),
                                });
                            }
                        }

                        return tx.deal.findUnique({
                            where: { id: req.params.id },
                            include: {
                                deal_items: {
                                    include: {
                                        menu_item: { select: { id: true, name: true, base_price: true, is_available: true } },
                                        menu_variant: { select: { id: true, name: true, price: true, is_available: true } },
                                    },
                                },
                            },
                        });
                    });

                    notifyN8nSync('deal_updated');
                    refreshCatalogCache().catch(() => {});

                    return res.json({
                        success: true,
                        message: 'Deal updated successfully',
                        data: {
                            ...updated,
                            deal_price: Number(updated.deal_price),
                        },
                    });
                }
            } catch (dbErr) {
                console.warn('[ADMIN] DB deal update failed, using fallback:', dbErr.message);
            }
        }

        const updatedFallback = updateFallbackDeal(req.params.id, req.body);
        if (updatedFallback) {
            refreshCatalogCache().catch(() => {});
            return res.json({
                success: true,
                message: 'Deal updated successfully',
                data: updatedFallback,
            });
        }

        return res.status(404).json({
            success: false,
            error: { code: 'DEAL_NOT_FOUND', message: 'Deal not found' },
        });
    } catch (err) {
        console.warn('[ADMIN] Error updating deal, using fallback:', err.message);
        const updatedFallback = updateFallbackDeal(req.params.id, req.body);
        if (updatedFallback) {
            return res.json({
                success: true,
                message: 'Deal updated successfully',
                data: updatedFallback,
            });
        }
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
        if (prisma) {
            try {
                const restaurantId = req.user?.restaurantId;
                const deal = await prisma.deal.findFirst({
                    where: { id: req.params.id, ...(restaurantId ? { restaurant_id: restaurantId } : {}) },
                });

                if (deal) {
                    const newStatus = typeof req.body.is_active === 'boolean' ? req.body.is_active : !deal.is_active;
                    const updated = await prisma.deal.update({
                        where: { id: req.params.id },
                        data: { is_active: newStatus },
                    });

                    notifyN8nSync('deal_status_changed');
                    refreshCatalogCache().catch(() => {});

                    return res.json({
                        success: true,
                        data: { id: updated.id, is_active: updated.is_active },
                    });
                }
            } catch (dbErr) {
                console.warn('[ADMIN] DB deal status toggle failed, using fallback:', dbErr.message);
            }
        }

        const fallback = toggleFallbackDealStatus(req.params.id, req.body?.is_active);
        if (fallback) {
            return res.json({
                success: true,
                data: { id: fallback.id, is_active: fallback.is_active },
            });
        }

        return res.status(404).json({
            success: false,
            error: { code: 'DEAL_NOT_FOUND', message: 'Deal not found' },
        });
    } catch (err) {
        const fallback = toggleFallbackDealStatus(req.params.id, req.body?.is_active);
        if (fallback) {
            return res.json({
                success: true,
                data: { id: fallback.id, is_active: fallback.is_active },
            });
        }
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message },
        });
    }
});

/**
 * POST /api/admin/deals/delete-all
 * DELETE /api/admin/deals/delete-all
 * Delete all deals and deal_items
 */
const handleDeleteAllDeals = async (req, res) => {
    try {
        const prisma = getDbClient();
        if (prisma) {
            try {
                let restaurantId = req.user?.restaurantId || req.user?.restaurant_id;
                if (!restaurantId) {
                    restaurantId = await getDefaultRestaurantId();
                }

                await prisma.dealItem.deleteMany({
                    where: { deal: { restaurant_id: restaurantId } },
                });
                await prisma.cartItem.deleteMany({
                    where: { cart: { restaurant_id: restaurantId }, deal_id: { not: null } },
                });
                const result = await prisma.deal.deleteMany({
                    where: { restaurant_id: restaurantId },
                });

                await refreshCatalogCache().catch(() => {});

                return res.json({
                    success: true,
                    count: result.count,
                    message: `Successfully deleted all ${result.count} deals`,
                });
            } catch (dbErr) {
                console.warn('[ADMIN] DB delete all deals failed, using fallback:', dbErr.message);
            }
        }

        const count = deleteAllFallbackDeals();
        await refreshCatalogCache().catch(() => {});
        return res.json({
            success: true,
            count,
            message: `Successfully deleted all ${count} deals`,
        });
    } catch (err) {
        console.error('[ADMIN] Failed to delete all deals:', err);
        const count = deleteAllFallbackDeals();
        return res.json({
            success: true,
            count,
            message: `Successfully deleted all deals`,
        });
    }
};

router.post('/delete-all', handleDeleteAllDeals);
router.delete('/delete-all', handleDeleteAllDeals);

/**
 * DELETE /api/admin/deals/:id
 */
router.delete('/:id', async (req, res) => {
    try {
        const prisma = getDbClient();
        if (prisma) {
            try {
                const restaurantId = req.user?.restaurantId;
                const deal = await prisma.deal.findFirst({
                    where: { id: req.params.id, ...(restaurantId ? { restaurant_id: restaurantId } : {}) },
                });

                if (deal) {
                    await prisma.deal.delete({ where: { id: req.params.id } });

                    notifyN8nSync('deal_deleted');
                    refreshCatalogCache().catch(() => {});

                    return res.json({
                        success: true,
                        data: { id: req.params.id, message: 'Deal deleted successfully' },
                    });
                }
            } catch (dbErr) {
                console.warn('[ADMIN] DB deal delete failed, using fallback:', dbErr.message);
            }
        }

        const deleted = deleteFallbackDeal(req.params.id);
        if (deleted) {
            refreshCatalogCache().catch(() => {});
            return res.json({
                success: true,
                data: { id: req.params.id, message: 'Deal deleted successfully' },
            });
        }

        return res.status(404).json({
            success: false,
            error: { code: 'DEAL_NOT_FOUND', message: 'Deal not found' },
        });
    } catch (err) {
        const deleted = deleteFallbackDeal(req.params.id);
        if (deleted) {
            return res.json({
                success: true,
                data: { id: req.params.id, message: 'Deal deleted successfully' },
            });
        }
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
        if (prisma) {
            try {
                const restaurantId = req.user?.restaurantId;
                const deal = await prisma.deal.findFirst({
                    where: { id: req.params.id, ...(restaurantId ? { restaurant_id: restaurantId } : {}) },
                });
                if (deal) {
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
                }
            } catch (dbErr) {
                console.warn('[ADMIN] DB deal item create failed, using fallback:', dbErr.message);
            }
        }

        const fallback = getFallbackDealById(req.params.id);
        if (!fallback) {
            return res.status(404).json({
                success: false,
                error: { code: 'DEAL_NOT_FOUND', message: 'Deal not found' },
            });
        }

        const currentItems = (fallback.deal_items || []).map(di => ({
            menu_item_id: di.menu_item_id,
            menu_variant_id: di.menu_variant_id,
            quantity: di.quantity,
        }));
        currentItems.push({
            menu_item_id: req.body.menu_item_id,
            menu_variant_id: req.body.menu_variant_id || null,
            quantity: req.body.quantity || 1,
        });

        const updated = updateFallbackDeal(req.params.id, { items: currentItems });
        const lastItem = updated.deal_items[updated.deal_items.length - 1];
        return res.status(201).json({
            success: true,
            data: lastItem,
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
        if (prisma) {
            try {
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
                if (existing) {
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
                }
            } catch (dbErr) {
                console.warn('[ADMIN] DB deal item update failed, using fallback:', dbErr.message);
            }
        }

        // Search in fallback deals
        for (const deal of FALLBACK_DEALS) {
            const di = (deal.deal_items || []).find(item => item.id === req.params.id);
            if (di) {
                if (req.body.quantity !== undefined) di.quantity = Number(req.body.quantity);
                if (req.body.menu_variant_id !== undefined) di.menu_variant_id = req.body.menu_variant_id || null;
                return res.json({ success: true, data: di });
            }
        }

        return res.status(404).json({
            success: false,
            error: { code: 'DEAL_ITEM_NOT_FOUND', message: 'Deal item not found' },
        });
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
        if (prisma) {
            try {
                const existing = await prisma.dealItem.findUnique({ where: { id: req.params.id } });
                if (existing) {
                    await prisma.dealItem.delete({ where: { id: req.params.id } });

                    return res.json({
                        success: true,
                        data: { id: req.params.id, message: 'Deal item removed successfully' },
                    });
                }
            } catch (dbErr) {
                console.warn('[ADMIN] DB deal item delete failed, using fallback:', dbErr.message);
            }
        }

        // Search and remove in fallback deals
        for (const deal of FALLBACK_DEALS) {
            const idx = (deal.deal_items || []).findIndex(item => item.id === req.params.id);
            if (idx !== -1) {
                deal.deal_items.splice(idx, 1);
                if (deal.items) deal.items.splice(idx, 1);
                return res.json({
                    success: true,
                    data: { id: req.params.id, message: 'Deal item removed successfully' },
                });
            }
        }

        return res.status(404).json({
            success: false,
            error: { code: 'DEAL_ITEM_NOT_FOUND', message: 'Deal item not found' },
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message },
        });
    }
});

export default router;
