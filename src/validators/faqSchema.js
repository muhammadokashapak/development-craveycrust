import { z } from 'zod';

const sanitizeStringList = (val) => {
    if (!val) return [];
    let list = [];
    if (Array.isArray(val)) {
        list = val;
    } else if (typeof val === 'string') {
        list = val.split(/[,\n]/);
    }
    return Array.from(
        new Set(
            list
                .map((s) => (typeof s === 'string' ? s.trim() : ''))
                .filter((s) => s.length > 0)
        )
    );
};

export const createFaqSchema = z.object({
    category_id: z.string().trim().optional().nullable(),
    question: z.string().trim().min(3, 'Question must be at least 3 characters').max(500, 'Question too long (max 500 characters)'),
    answer: z.string().trim().min(3, 'Answer must be at least 3 characters').max(5000, 'Answer too long (max 5000 characters)'),
    keywords: z.union([z.array(z.string()), z.string()]).optional().transform(sanitizeStringList),
    alternative_questions: z.union([z.array(z.string()), z.string()]).optional().transform(sanitizeStringList),
    is_active: z.coerce.boolean().default(true),
    sort_order: z.coerce.number().int().min(0).default(0),
    language: z.string().trim().max(10).optional().default('en'),
});

export const updateFaqSchema = z.object({
    category_id: z.string().trim().optional().nullable(),
    question: z.string().trim().min(3, 'Question must be at least 3 characters').max(500, 'Question too long (max 500 characters)').optional(),
    answer: z.string().trim().min(3, 'Answer must be at least 3 characters').max(5000, 'Answer too long (max 5000 characters)').optional(),
    keywords: z.union([z.array(z.string()), z.string()]).optional().transform(sanitizeStringList),
    alternative_questions: z.union([z.array(z.string()), z.string()]).optional().transform(sanitizeStringList),
    is_active: z.coerce.boolean().optional(),
    sort_order: z.coerce.number().int().min(0).optional(),
    language: z.string().trim().max(10).optional(),
});
