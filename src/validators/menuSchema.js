import { z } from 'zod';

export const createMenuItemSchema = z.object({
    name: z.string().trim().min(1, 'Item name is required').max(100, 'Name too long'),
    category_id: z.string().trim().min(1, 'Category is required'),
    description: z.string().trim().max(1000, 'Description too long').optional().nullable(),
    base_price: z.coerce.number().min(0, 'Price must be greater than or equal to 0'),
    image_url: z.string().trim().max(500).optional().nullable(),
    spicy_level: z.enum(['NONE', 'MILD', 'MEDIUM', 'HOT']).default('NONE'),
    is_available: z.coerce.boolean().default(true),
    is_active: z.coerce.boolean().default(true),
    discount_percent: z.coerce.number().min(0, 'Discount must be at least 0%').max(100, 'Discount cannot exceed 100%').optional().nullable(),
    discount_fixed: z.coerce.number().min(0, 'Fixed discount must be at least 0').optional().nullable(),
});

export const updateMenuItemSchema = z.object({
    name: z.string().trim().min(1, 'Item name is required').max(100, 'Name too long').optional(),
    category_id: z.string().trim().min(1, 'Category is required').optional(),
    description: z.string().trim().max(1000, 'Description too long').optional().nullable(),
    base_price: z.coerce.number().min(0, 'Price must be greater than or equal to 0').optional(),
    image_url: z.string().trim().max(500).optional().nullable(),
    spicy_level: z.enum(['NONE', 'MILD', 'MEDIUM', 'HOT']).optional(),
    is_available: z.coerce.boolean().optional(),
    is_active: z.coerce.boolean().optional(),
    discount_percent: z.coerce.number().min(0, 'Discount must be at least 0%').max(100, 'Discount cannot exceed 100%').optional().nullable(),
    discount_fixed: z.coerce.number().min(0, 'Fixed discount must be at least 0').optional().nullable(),
});
