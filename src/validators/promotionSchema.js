import { z } from 'zod';

export const promotionTargetInputSchema = z.object({
    target_type: z.enum(['ALL', 'CATEGORY', 'MENU_ITEM', 'VARIANT', 'DEAL']).default('ALL'),
    target_id: z.string().nullable().optional(),
});

export const createPromotionSchema = z.object({
    name: z.string().min(1, 'Promotion name is required').max(100),
    code: z.string().max(50).optional().nullable(),
    description: z.string().max(500).optional().nullable(),
    discount_type: z.enum(['PERCENTAGE', 'FIXED']).default('PERCENTAGE'),
    discount_value: z.number().min(0, 'Discount value must be at least 0'),
    minimum_order: z.number().min(0).optional().nullable(),
    maximum_discount: z.number().min(0).optional().nullable(),
    start_at: z.union([z.string().datetime(), z.string(), z.date()]).optional().nullable(),
    end_at: z.union([z.string().datetime(), z.string(), z.date()]).optional().nullable(),
    is_active: z.boolean().default(true),
    targets: z.array(promotionTargetInputSchema).optional(),
}).refine(data => {
    if (data.discount_type === 'PERCENTAGE' && data.discount_value > 100) {
        return false;
    }
    return true;
}, {
    message: 'Percentage discount cannot exceed 100%',
    path: ['discount_value'],
});

export const updatePromotionSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    code: z.string().max(50).optional().nullable(),
    description: z.string().max(500).optional().nullable(),
    discount_type: z.enum(['PERCENTAGE', 'FIXED']).optional(),
    discount_value: z.number().min(0).optional(),
    minimum_order: z.number().min(0).optional().nullable(),
    maximum_discount: z.number().min(0).optional().nullable(),
    start_at: z.union([z.string().datetime(), z.string(), z.date()]).optional().nullable(),
    end_at: z.union([z.string().datetime(), z.string(), z.date()]).optional().nullable(),
    is_active: z.boolean().optional(),
    targets: z.array(promotionTargetInputSchema).optional(),
}).refine(data => {
    if (data.discount_type === 'PERCENTAGE' && data.discount_value !== undefined && data.discount_value > 100) {
        return false;
    }
    return true;
}, {
    message: 'Percentage discount cannot exceed 100%',
    path: ['discount_value'],
});
