import express from 'express';
import { getDbClient } from '../../src/db/client.js';
import { updateDealItemSchema } from '../../src/validators/dealSchema.js';

const router = express.Router();

/**
 * PUT /api/admin/deal-items/:id
 * Update quantity or variant of a deal item
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
 * Remove a deal item from its deal
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
