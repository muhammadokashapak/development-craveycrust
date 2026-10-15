import { z } from 'zod';

export const pricingItemSchema = z.object({
    menuItemId: z.string().min(1, 'menuItemId is required'),
    variantId: z.string().nullable().optional(),
    quantity: z.number().int().min(1, 'Quantity must be at least 1').default(1),
});

export const pricingDealSchema = z.object({
    dealId: z.string().min(1, 'dealId is required'),
    quantity: z.number().int().min(1, 'Quantity must be at least 1').default(1),
});

export const calculatePricingSchema = z.object({
    items: z.array(pricingItemSchema).optional().default([]),
    deals: z.array(pricingDealSchema).optional().default([]),
    promoCode: z.string().trim().optional().nullable(),
    deliveryAreaId: z.string().optional().nullable(),
    deliveryAreaName: z.string().optional().nullable(),
    latitude: z.number().min(-90).max(90).optional().nullable(),
    longitude: z.number().min(-180).max(180).optional().nullable(),
}).refine(data => {
    return (data.items && data.items.length > 0) || (data.deals && data.deals.length > 0);
}, {
    message: 'At least one menu item or deal is required to calculate pricing',
    path: ['items'],
});
