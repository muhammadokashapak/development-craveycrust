import { z } from 'zod';

export const checkDeliverySchema = z.object({
    areaId: z.string().optional().nullable(),
    areaName: z.string().optional().nullable(),
    address: z.string().optional().nullable(),
    latitude: z.number().min(-90).max(90).optional().nullable(),
    longitude: z.number().min(-180).max(180).optional().nullable(),
    subtotal: z.number().min(0).optional().nullable(),
}).refine(data => {
    return Boolean(data.areaId || data.areaName || data.address || (data.latitude != null && data.longitude != null));
}, {
    message: 'Must provide areaId, areaName, address, or coordinates (latitude and longitude)',
});
