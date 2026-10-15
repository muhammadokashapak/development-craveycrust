import { z } from 'zod';

export const createVariantSchema = z.object({
    name: z.string().trim().min(1, 'Variant name is required').max(100, 'Name too long'),
    price: z.coerce.number().min(0, 'Price must be greater than or equal to 0'),
    sort_order: z.coerce.number().int().min(0).default(0),
    is_available: z.coerce.boolean().default(true),
});

export const updateVariantSchema = z.object({
    name: z.string().trim().min(1, 'Variant name is required').max(100, 'Name too long').optional(),
    price: z.coerce.number().min(0, 'Price must be greater than or equal to 0').optional(),
    sort_order: z.coerce.number().int().min(0).optional(),
    is_available: z.coerce.boolean().optional(),
});
