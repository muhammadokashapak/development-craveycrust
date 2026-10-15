import { z } from 'zod';

export const updateSettingsSchema = z.object({
    name: z.string().trim().min(1, 'Restaurant name is required').max(100).optional(),
    phone: z.string().trim().max(30).optional().nullable(),
    address: z.string().trim().max(255).optional().nullable(),
    currency: z.string().trim().max(10).default('PKR').optional(),
    timezone: z.string().trim().max(50).default('Asia/Karachi').optional(),
    opening_time: z.string().trim().max(10).optional().nullable(),
    closing_time: z.string().trim().max(10).optional().nullable(),
    min_order: z.coerce.number().min(0).optional().nullable(),
    default_delivery_fee: z.coerce.number().min(0).optional().nullable(),
    cod_enabled: z.coerce.boolean().optional(),
    easypaisa_enabled: z.coerce.boolean().optional(),
    easypaisa_number: z.string().trim().max(30).optional().nullable(),
    account_name: z.string().trim().max(100).optional().nullable(),
    admin_notification_phone: z.string().trim().max(30).optional().nullable(),
    custom_settings: z.record(z.string()).optional(),
});
