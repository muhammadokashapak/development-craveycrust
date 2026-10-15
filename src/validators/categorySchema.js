import { z } from 'zod';

export const createCategorySchema = z.object({
    name: z.string().trim().min(1, 'Category name is required').max(100, 'Name too long'),
    description: z.string().trim().max(500, 'Description too long').optional().nullable(),
    sort_order: z.coerce.number().int().min(0).default(0),
    is_active: z.coerce.boolean().default(true),
});

export const updateCategorySchema = z.object({
    name: z.string().trim().min(1, 'Category name is required').max(100, 'Name too long').optional(),
    description: z.string().trim().max(500, 'Description too long').optional().nullable(),
    sort_order: z.coerce.number().int().min(0).optional(),
    is_active: z.coerce.boolean().optional(),
});
