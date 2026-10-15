import { z } from 'zod';

export const dealItemInputSchema = z.object({
    menu_item_id: z.string().min(1, 'Menu item ID is required'),
    menu_variant_id: z.string().nullable().optional(),
    quantity: z.number().int().min(1, 'Quantity must be at least 1').default(1),
});

export const createDealSchema = z.object({
    name: z.string().min(1, 'Deal name is required').max(100),
    description: z.string().max(500).optional().nullable(),
    image_url: z.string().max(500).optional().nullable(),
    deal_price: z.number().min(0, 'Deal price must be non-negative'),
    start_at: z.union([z.string().datetime(), z.string(), z.date()]).optional().nullable(),
    end_at: z.union([z.string().datetime(), z.string(), z.date()]).optional().nullable(),
    is_active: z.boolean().default(true),
    sort_order: z.number().int().default(0),
    items: z.array(dealItemInputSchema).optional(),
});

export const updateDealSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional().nullable(),
    image_url: z.string().max(500).optional().nullable(),
    deal_price: z.number().min(0).optional(),
    start_at: z.union([z.string().datetime(), z.string(), z.date()]).optional().nullable(),
    end_at: z.union([z.string().datetime(), z.string(), z.date()]).optional().nullable(),
    is_active: z.boolean().optional(),
    sort_order: z.number().int().optional(),
});

export const createDealItemSchema = z.object({
    menu_item_id: z.string().min(1, 'Menu item ID is required'),
    menu_variant_id: z.string().nullable().optional(),
    quantity: z.number().int().min(1, 'Quantity must be at least 1').default(1),
});

export const updateDealItemSchema = z.object({
    menu_variant_id: z.string().nullable().optional(),
    quantity: z.number().int().min(1, 'Quantity must be at least 1').optional(),
});
