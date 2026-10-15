import { z } from 'zod';

export const createDeliveryAreaSchema = z.object({
    name: z.string().min(1, 'Delivery area name is required').max(100),
    delivery_fee: z.number().min(0, 'Delivery fee must be non-negative'),
    minimum_order: z.number().min(0).optional().nullable(),
    is_active: z.boolean().default(true),
    sort_order: z.number().int().default(0),
    latitude: z.number().min(-90).max(90).optional().nullable(),
    longitude: z.number().min(-180).max(180).optional().nullable(),
    radius_km: z.number().min(0).optional().nullable(),
    aliases: z.string().max(500).optional().nullable(),
});

export const updateDeliveryAreaSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    delivery_fee: z.number().min(0).optional(),
    minimum_order: z.number().min(0).optional().nullable(),
    is_active: z.boolean().optional(),
    sort_order: z.number().int().optional(),
    latitude: z.number().min(-90).max(90).optional().nullable(),
    longitude: z.number().min(-180).max(180).optional().nullable(),
    radius_km: z.number().min(0).optional().nullable(),
    aliases: z.string().max(500).optional().nullable(),
});
