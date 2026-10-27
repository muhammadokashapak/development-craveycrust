import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { getDbClient } from '../../src/db/client.js';
import { getFallbackMenuItems } from '../../src/services/fallbackCatalog.js';
import { createMenuItemSchema, updateMenuItemSchema } from '../../src/validators/menuSchema.js';
import { slugify } from '../../src/utils/slugify.js';
import { notifyN8nSync } from '../../src/services/syncService.js';
import { bumpSyncEpoch, refreshCatalogCache } from '../../src/services/catalogCacheService.js';
import { calculateDiscount, getGlobalDiscountSettings, bulkApplyDiscountToAllItems } from '../../src/services/discountService.js';
import { getDefaultRestaurantId } from '../../src/services/restaurantService.js';

const router = express.Router();

/**
 * GET /api/admin/menu
 * List menu items with filters (category, available, search)
 */
router.get('/', async (req, res) => {
    try {
        const prisma = getDbClient();
        if (!prisma) {
            return res.json({ success: true, data: getFallbackMenuItems(), meta: { global_discount: null } });
        }

        const restaurantId = req.user?.restaurantId || (await getDefaultRestaurantId());
        const defaultRestId = await getDefaultRestaurantId();
        const targetRestIds = Array.from(new Set([restaurantId, defaultRestId].filter(Boolean)));
        const { category_id, available, search } = req.query;

        const where = {
            ...(targetRestIds.length > 0 ? { restaurant_id: { in: targetRestIds } } : {}),
        };

        if (category_id) {
            where.category_id = category_id;
        }

        if (available !== undefined && available !== '') {
            where.is_available = available === 'true' || available === '1';
        }

        if (search && search.trim()) {
            where.OR = [
                { name: { contains: search.trim(), mode: 'insensitive' } },
                { description: { contains: search.trim(), mode: 'insensitive' } },
            ];
        }

        let items;
        try {
            items = await prisma.menuItem.findMany({
                where,
                include: {
                    category: { select: { id: true, name: true, slug: true } },
                    variants: {
                        orderBy: { sort_order: 'asc' },
                        select: { id: true, name: true, price: true, is_available: true, sort_order: true },
                    },
                },
                orderBy: [{ category: { sort_order: 'asc' } }, { name: 'asc' }],
            });
        } catch (orderErr) {
            console.warn('[ADMIN] Falling back to standard name sort for menu items:', orderErr.message);
            items = await prisma.menuItem.findMany({
                where,
                include: {
                    category: { select: { id: true, name: true, slug: true } },
                    variants: {
                        select: { id: true, name: true, price: true, is_available: true, sort_order: true },
                    },
                },
                orderBy: [{ name: 'asc' }],
            });
        }

        // If scoped restaurant has no items, fallback to global items (matching categories.js behavior)
        if ((!items || items.length === 0) && where.restaurant_id) {
            const fallbackWhere = { ...where };
            delete fallbackWhere.restaurant_id;
            try {
                items = await prisma.menuItem.findMany({
                    where: fallbackWhere,
                    include: {
                        category: { select: { id: true, name: true, slug: true } },
                        variants: {
                            orderBy: { sort_order: 'asc' },
                            select: { id: true, name: true, price: true, is_available: true, sort_order: true },
                        },
                    },
                    orderBy: [{ category: { sort_order: 'asc' } }, { name: 'asc' }],
                });
            } catch (fallbackErr) {
                items = await prisma.menuItem.findMany({
                    where: fallbackWhere,
                    include: {
                        category: { select: { id: true, name: true, slug: true } },
                        variants: {
                            select: { id: true, name: true, price: true, is_available: true, sort_order: true },
                        },
                    },
                    orderBy: [{ name: 'asc' }],
                });
            }
        }

        // Exclude deal items from menu items (deals have dedicated management tab)
        items = (items || []).filter(item => !/deals?/i.test(item.category?.name || '') && !/deals?/i.test(item.category?.slug || ''));

        const globalDiscount = await getGlobalDiscountSettings(restaurantId);

        const formatted = items.map(item => {
            const itemDiscount = calculateDiscount(
                item.base_price,
                item.discount_percent,
                item.discount_fixed,
                globalDiscount
            );

            return {
                id: item.id,
                name: item.name,
                slug: item.slug,
                description: item.description,
                base_price: Number(item.base_price),
                image_url: item.image_url,
                spicy_level: item.spicy_level,
                is_available: item.is_available,
                is_active: item.is_active,
                discount_percent: item.discount_percent !== null ? Number(item.discount_percent) : null,
                discount_fixed: item.discount_fixed !== null ? Number(item.discount_fixed) : null,
                discount_info: itemDiscount,
                category: item.category || { id: item.category_id, name: 'Uncategorized', slug: 'uncategorized' },
                category_id: item.category_id,
                variants_count: Array.isArray(item.variants) ? item.variants.length : 0,
                variants: (item.variants || []).map(v => {
                    const variantDiscount = calculateDiscount(
                        v.price,
                        v.discount_percent || item.discount_percent,
                        v.discount_fixed || item.discount_fixed,
                        globalDiscount
                    );
                    return {
                        id: v.id,
                        name: v.name,
                        price: Number(v.price),
                        discount_percent: v.discount_percent !== null ? Number(v.discount_percent) : null,
                        discount_fixed: v.discount_fixed !== null ? Number(v.discount_fixed) : null,
                        discount_info: variantDiscount,
                        is_available: v.is_available,
                        sort_order: v.sort_order,
                    };
                }),
                created_at: item.created_at,
                updated_at: item.updated_at,
            };
        });

        if (formatted.length === 0) {
            return res.json({
                success: true,
                data: getFallbackMenuItems(),
                meta: { global_discount: globalDiscount },
            });
        }

        return res.json({
            success: true,
            data: formatted,
            meta: {
                global_discount: globalDiscount,
            },
        });
    } catch (err) {
        console.warn('[ADMIN] Error listing menu items from DB, returning fallback:', err.message);
        return res.json({
            success: true,
            data: getFallbackMenuItems(),
            meta: { global_discount: null },
        });
    }
});

// ─── WhatsApp Bot Menu & Deals Image & PDF Upload & Management ─────────────────

const CARD_UPLOADS_DIR = path.join(process.cwd(), 'uploads', 'menu');
if (!fs.existsSync(CARD_UPLOADS_DIR)) {
    fs.mkdirSync(CARD_UPLOADS_DIR, { recursive: true });
}

const ALLOWED_CARD_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff', '.svg', '.heic', '.avif', '.pdf'];
const ALLOWED_CARD_MIMES = [
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/tiff', 'image/svg+xml', 'image/heic', 'image/avif',
    'application/pdf', 'application/x-pdf'
];

const cardStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, CARD_UPLOADS_DIR);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const safeExt = ALLOWED_CARD_EXTS.includes(ext) ? ext : (file.mimetype === 'application/pdf' ? '.pdf' : '.png');
        const typePrefix = req.body?.type === 'deals' ? 'deals_card' : 'menu_card';
        const uniqueName = `${typePrefix}_${Date.now()}_${crypto.randomBytes(6).toString('hex')}${safeExt}`;
        cb(null, uniqueName);
    },
});

const cardUpload = multer({
    storage: cardStorage,
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ALLOWED_CARD_MIMES.includes(file.mimetype) || ALLOWED_CARD_EXTS.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error(`INVALID_FILE_TYPE: File type '${ext || file.mimetype}' is not supported. Please upload an image or PDF.`));
        }
    },
    limits: {
        fileSize: 25 * 1024 * 1024, // 25MB limit
        files: 20,
    },
});

// Helper to extract parsed image array from DB settings
function parseSettingImages(settingsMap, arrayKey, singleKey, defaultAsset) {
    if (settingsMap[arrayKey] !== undefined && settingsMap[arrayKey] !== null) {
        try {
            const parsed = JSON.parse(settingsMap[arrayKey]);
            if (Array.isArray(parsed)) return parsed.filter(Boolean);
        } catch (_) {
            if (typeof settingsMap[arrayKey] === 'string' && settingsMap[arrayKey].trim()) {
                return [settingsMap[arrayKey].trim()];
            }
        }
    }
    if (settingsMap[singleKey] !== undefined && typeof settingsMap[singleKey] === 'string' && settingsMap[singleKey].trim()) {
        return [settingsMap[singleKey].trim()];
    }
    return [];
}

/**
 * GET /api/admin/menu/cards
 * Fetch active multi-page Menu and Deals cards
 */
router.get('/cards', async (req, res) => {
    try {
        const prisma = getDbClient();
        if (prisma) {
            try {
                let restaurantId = req.user?.restaurantId;
                if (!restaurantId) {
                    try { restaurantId = await getDefaultRestaurantId(); } catch (_) {}
                }
                const targetRestIds = new Set();
                if (restaurantId) targetRestIds.add(restaurantId);

                const settings = await prisma.restaurantSetting.findMany({
                    where: {
                        ...(targetRestIds.size > 0 ? { restaurant_id: { in: Array.from(targetRestIds) } } : {}),
                        key: { in: ['menu_image_urls', 'deals_image_urls', 'menu_image_url', 'deals_image_url'] },
                    },
                    orderBy: { updated_at: 'desc' },
                });

                const settingsMap = {};
                settings.forEach(s => {
                    if (!settingsMap[s.key] && s.value) settingsMap[s.key] = s.value;
                });

                const menuImages = parseSettingImages(settingsMap, 'menu_image_urls', 'menu_image_url', 'assets/menu/cravey_crust_main_menu.png');
                const dealsImages = parseSettingImages(settingsMap, 'deals_image_urls', 'deals_image_url', 'assets/menu/cravey_crust_deals_menu.png');

                return res.json({
                    success: true,
                    data: {
                        menuImages,
                        dealsImages,
                        isCustomMenu: Boolean(settingsMap.menu_image_urls || settingsMap.menu_image_url),
                        isCustomDeals: Boolean(settingsMap.deals_image_urls || settingsMap.deals_image_url),
                        defaultMenuImages: ['assets/menu/cravey_crust_main_menu.png'],
                        defaultDealsImages: ['assets/menu/cravey_crust_deals_menu.png'],
                    },
                });
            } catch (dbErr) {
                console.warn('[ADMIN] Fetch cards DB error, using default cards:', dbErr.message);
            }
        }

        return res.json({
            success: true,
            data: {
                menuImages: ['assets/menu/cravey_crust_main_menu.png'],
                dealsImages: ['assets/menu/cravey_crust_deals_menu.png'],
                isCustomMenu: false,
                isCustomDeals: false,
                defaultMenuImages: ['assets/menu/cravey_crust_main_menu.png'],
                defaultDealsImages: ['assets/menu/cravey_crust_deals_menu.png'],
            },
        });
    } catch (err) {
        console.warn('[ADMIN] Fetch cards error, using default cards:', err.message);
        return res.json({
            success: true,
            data: {
                menuImages: ['assets/menu/cravey_crust_main_menu.png'],
                dealsImages: ['assets/menu/cravey_crust_deals_menu.png'],
                isCustomMenu: false,
                isCustomDeals: false,
                defaultMenuImages: ['assets/menu/cravey_crust_main_menu.png'],
                defaultDealsImages: ['assets/menu/cravey_crust_deals_menu.png'],
            },
        });
    }
});

/**
 * Legacy compatibility: GET /api/admin/menu/bot-images
 */
router.get('/bot-images', async (req, res) => {
    try {
        const prisma = getDbClient();
        if (prisma) {
            try {
                let restaurantId = req.user?.restaurantId;
                if (!restaurantId) {
                    try { restaurantId = await getDefaultRestaurantId(); } catch (_) {}
                }
                const targetRestIds = new Set();
                if (restaurantId) targetRestIds.add(restaurantId);

                const settings = await prisma.restaurantSetting.findMany({
                    where: {
                        ...(targetRestIds.size > 0 ? { restaurant_id: { in: Array.from(targetRestIds) } } : {}),
                        key: { in: ['menu_image_urls', 'deals_image_urls', 'menu_image_url', 'deals_image_url'] },
                    },
                    orderBy: { updated_at: 'desc' },
                });

                const settingsMap = {};
                settings.forEach(s => {
                    if (!settingsMap[s.key] && s.value) settingsMap[s.key] = s.value;
                });

                const menuImages = parseSettingImages(settingsMap, 'menu_image_urls', 'menu_image_url', 'assets/menu/cravey_crust_main_menu.png');
                const dealsImages = parseSettingImages(settingsMap, 'deals_image_urls', 'deals_image_url', 'assets/menu/cravey_crust_deals_menu.png');

                return res.json({
                    success: true,
                    data: {
                        menuImageUrl: menuImages[0] || 'assets/menu/cravey_crust_main_menu.png',
                        dealsImageUrl: dealsImages[0] || 'assets/menu/cravey_crust_deals_menu.png',
                        menuImages,
                        dealsImages,
                        isCustomMenu: Boolean(settingsMap.menu_image_urls || settingsMap.menu_image_url),
                        isCustomDeals: Boolean(settingsMap.deals_image_urls || settingsMap.deals_image_url),
                    },
                });
            } catch (dbErr) {
                console.warn('[ADMIN] Bot-images DB error, using default:', dbErr.message);
            }
        }

        return res.json({
            success: true,
            data: {
                menuImageUrl: 'assets/menu/cravey_crust_main_menu.png',
                dealsImageUrl: 'assets/menu/cravey_crust_deals_menu.png',
                menuImages: ['assets/menu/cravey_crust_main_menu.png'],
                dealsImages: ['assets/menu/cravey_crust_deals_menu.png'],
                isCustomMenu: false,
                isCustomDeals: false,
            },
        });
    } catch (err) {
        return res.json({
            success: true,
            data: {
                menuImageUrl: 'assets/menu/cravey_crust_main_menu.png',
                dealsImageUrl: 'assets/menu/cravey_crust_deals_menu.png',
                menuImages: ['assets/menu/cravey_crust_main_menu.png'],
                dealsImages: ['assets/menu/cravey_crust_deals_menu.png'],
                isCustomMenu: false,
                isCustomDeals: false,
            },
        });
    }
});

/**
 * POST /api/admin/menu/cards/upload
 * Upload 1 or multiple files (images or PDFs) to add as pages to Menu or Deals.
 * Strictly preserves existing pages unless mode: 'replace' (single page update) or mode: 'replaceAll' is specified.
 */
router.post('/cards/upload', (req, res) => {
    cardUpload.array('images', 20)(req, res, async (err) => {
        if (err instanceof multer.MulterError) {
            return res.status(400).json({
                success: false,
                error: { message: err.code === 'LIMIT_FILE_SIZE' ? 'Each file must be under 25MB' : err.message },
            });
        } else if (err) {
            return res.status(400).json({ success: false, error: { message: err.message } });
        }

        const files = req.files || (req.file ? [req.file] : []);
        if (files.length === 0) {
            return res.status(400).json({ success: false, error: { message: 'No files were uploaded' } });
        }

        try {
            const prisma = getDbClient();
            if (!prisma) {
                return res.status(503).json({ success: false, error: { message: 'Database unavailable' } });
            }

            const restaurantId = req.user?.restaurantId || (await getDefaultRestaurantId());
            const defaultRestId = await getDefaultRestaurantId();
            const type = (req.body?.type || req.query?.type || 'menu').toLowerCase() === 'deals' ? 'deals' : 'menu';
            const arrayKey = type === 'deals' ? 'deals_image_urls' : 'menu_image_urls';
            const singleKey = type === 'deals' ? 'deals_image_url' : 'menu_image_url';

            const targetRestIds = new Set([restaurantId]);
            if (defaultRestId) targetRestIds.add(defaultRestId);
            try {
                const allActiveRests = await prisma.restaurant.findMany({ select: { id: true } });
                allActiveRests.forEach(r => targetRestIds.add(r.id));
            } catch (_) {}

            // Load existing array across active restaurants so previous menu is never lost
            const currentSettings = await prisma.restaurantSetting.findMany({
                where: {
                    restaurant_id: { in: Array.from(targetRestIds) },
                    key: { in: [arrayKey, singleKey] },
                },
                orderBy: { updated_at: 'desc' },
            });

            let currentImages = [];
            const arraySetting = currentSettings.find(s => s.key === arrayKey && s.value);
            if (arraySetting?.value) {
                try {
                    const parsed = JSON.parse(arraySetting.value);
                    if (Array.isArray(parsed)) currentImages = parsed.filter(Boolean);
                } catch (_) {}
            }

            // Fallback to singleKey if array not set yet
            if (currentImages.length === 0) {
                const singleSetting = currentSettings.find(s => s.key === singleKey && s.value);
                if (singleSetting?.value && singleSetting.value.trim()) {
                    currentImages = [singleSetting.value.trim()];
                }
            }

            const defaultAsset = type === 'deals' ? 'assets/menu/cravey_crust_deals_menu.png' : 'assets/menu/cravey_crust_main_menu.png';
            const mode = (req.body?.mode || 'append').toLowerCase();
            const replaceIndex = req.body?.replaceIndex !== undefined && req.body?.replaceIndex !== ''
                ? parseInt(req.body.replaceIndex, 10)
                : -1;

            const newUrls = files.map(f => `uploads/menu/${f.filename}`);
            let updatedImages = [];

            if (mode === 'replace' && replaceIndex >= 0 && replaceIndex < currentImages.length) {
                // Replace ONLY the specific card page at replaceIndex, keeping all other pages intact
                updatedImages = [...currentImages];
                updatedImages[replaceIndex] = newUrls[0];
            } else if (mode === 'replaceall') {
                // Explicitly replace all pages
                updatedImages = [...newUrls];
            } else {
                // Default: Append new files while strictly preserving all existing pages
                const isDefaultOnly = currentImages.length === 1 && currentImages[0] === defaultAsset;
                if (isDefaultOnly && (req.body?.keepDefault !== 'true')) {
                    updatedImages = [...newUrls];
                } else {
                    updatedImages = [...currentImages, ...newUrls];
                }
            }

            for (const tId of targetRestIds) {
                await prisma.restaurantSetting.upsert({
                    where: { restaurant_id_key: { restaurant_id: tId, key: arrayKey } },
                    update: { value: JSON.stringify(updatedImages) },
                    create: { restaurant_id: tId, key: arrayKey, value: JSON.stringify(updatedImages) },
                });
                await prisma.restaurantSetting.upsert({
                    where: { restaurant_id_key: { restaurant_id: tId, key: singleKey } },
                    update: { value: updatedImages[0] || '' },
                    create: { restaurant_id: tId, key: singleKey, value: updatedImages[0] || '' },
                });
            }

            bumpSyncEpoch();
            await refreshCatalogCache().catch(() => {});

            return res.json({
                success: true,
                data: {
                    type,
                    images: updatedImages,
                    addedCount: newUrls.length,
                    message: mode === 'replace' && replaceIndex >= 0
                        ? `Page ${replaceIndex + 1} successfully updated!`
                        : `${newUrls.length} ${type === 'deals' ? 'deal file(s)' : 'menu file(s)'} added successfully (previous pages preserved)!`,
                },
            });
        } catch (dbErr) {
            console.error('[ADMIN] Error saving card files:', dbErr);
            return res.status(500).json({ success: false, error: { message: dbErr.message } });
        }
    });
});

/**
 * DELETE /api/admin/menu/cards
 * Delete a specific card file from the list
 */
router.delete('/cards', async (req, res) => {
    try {
        const prisma = getDbClient();
        if (!prisma) return res.status(503).json({ success: false, error: { message: 'Database unavailable' } });

        const restaurantId = req.user?.restaurantId || (await getDefaultRestaurantId());
        const defaultRestId = await getDefaultRestaurantId();
        const type = (req.body?.type || req.query?.type || 'menu').toLowerCase() === 'deals' ? 'deals' : 'menu';
        const arrayKey = type === 'deals' ? 'deals_image_urls' : 'menu_image_urls';
        const singleKey = type === 'deals' ? 'deals_image_url' : 'menu_image_url';
        const defaultAsset = type === 'deals' ? 'assets/menu/cravey_crust_deals_menu.png' : 'assets/menu/cravey_crust_main_menu.png';

        const index = req.body?.index !== undefined && req.body?.index !== null && req.body?.index !== ''
            ? parseInt(req.body.index, 10)
            : -1;
        const targetUrl = req.body?.url ? String(req.body.url).trim() : '';

        const targetRestIds = new Set([restaurantId]);
        if (defaultRestId) targetRestIds.add(defaultRestId);
        try {
            const allActiveRests = await prisma.restaurant.findMany({ select: { id: true } });
            allActiveRests.forEach(r => targetRestIds.add(r.id));
        } catch (_) {}

        // Load existing settings across all target restaurants
        const currentSettings = await prisma.restaurantSetting.findMany({
            where: {
                restaurant_id: { in: Array.from(targetRestIds) },
                key: { in: [arrayKey, singleKey] },
            },
            orderBy: { updated_at: 'desc' },
        });

        const settingsMap = {};
        currentSettings.forEach(s => {
            if (!settingsMap[s.key] && s.value) settingsMap[s.key] = s.value;
        });

        const currentImages = parseSettingImages(settingsMap, arrayKey, singleKey, defaultAsset);

        let updatedImages = [...currentImages];
        let removedItem = null;

        if (index >= 0 && index < updatedImages.length) {
            removedItem = updatedImages.splice(index, 1)[0];
        } else if (targetUrl) {
            const idx = updatedImages.findIndex(u => u === targetUrl || u.endsWith(targetUrl) || targetUrl.endsWith(u));
            if (idx !== -1) {
                removedItem = updatedImages.splice(idx, 1)[0];
            }
        }

        // Fallback: if only 1 item existed and index is 0 or target not matched, delete that single item
        if (!removedItem && updatedImages.length > 0 && (index === 0 || updatedImages.length === 1)) {
            removedItem = updatedImages.shift();
        }

        if (!removedItem) {
            return res.status(404).json({ success: false, error: { message: 'Card item not found to delete' } });
        }

        if (removedItem && removedItem.startsWith('uploads/menu/')) {
            const localFile = path.join(process.cwd(), removedItem);
            if (fs.existsSync(localFile)) {
                try { fs.unlinkSync(localFile); } catch (_) {}
            }
        }

        for (const tId of targetRestIds) {
            await prisma.restaurantSetting.upsert({
                where: { restaurant_id_key: { restaurant_id: tId, key: arrayKey } },
                update: { value: JSON.stringify(updatedImages) },
                create: { restaurant_id: tId, key: arrayKey, value: JSON.stringify(updatedImages) },
            });
            await prisma.restaurantSetting.upsert({
                where: { restaurant_id_key: { restaurant_id: tId, key: singleKey } },
                update: { value: updatedImages[0] || '' },
                create: { restaurant_id: tId, key: singleKey, value: updatedImages[0] || '' },
            });
        }

        bumpSyncEpoch();
        await refreshCatalogCache().catch(() => {});

        return res.json({
            success: true,
            data: {
                type,
                images: updatedImages,
                deleted: removedItem,
                message: `Card deleted successfully`,
            },
        });
    } catch (err) {
        console.error('[ADMIN] Delete card error:', err);
        return res.status(500).json({ success: false, error: { message: err.message } });
    }
});

/**
 * POST /api/admin/menu/cards/save
 * Explicitly save and apply the active list of Menu or Deals images, update settings, bump epoch, and refresh live cache.
 */
router.post('/cards/save', async (req, res) => {
    try {
        const prisma = getDbClient();
        if (!prisma) return res.status(503).json({ success: false, error: { message: 'Database unavailable' } });

        const restaurantId = req.user?.restaurantId || (await getDefaultRestaurantId());
        const defaultRestId = await getDefaultRestaurantId();
        const type = (req.body?.type || 'menu').toLowerCase() === 'deals' ? 'deals' : 'menu';
        const arrayKey = type === 'deals' ? 'deals_image_urls' : 'menu_image_urls';
        const singleKey = type === 'deals' ? 'deals_image_url' : 'menu_image_url';

        const newImages = req.body?.images;
        if (!Array.isArray(newImages)) {
            return res.status(400).json({ success: false, error: { message: 'Invalid images array' } });
        }

        const cleaned = newImages.filter(u => typeof u === 'string' && u.trim().length > 0);

        const targetRestIds = new Set([restaurantId]);
        if (defaultRestId) targetRestIds.add(defaultRestId);
        try {
            const allActiveRests = await prisma.restaurant.findMany({ select: { id: true } });
            allActiveRests.forEach(r => targetRestIds.add(r.id));
        } catch (_) {}

        for (const tId of targetRestIds) {
            await prisma.restaurantSetting.upsert({
                where: { restaurant_id_key: { restaurant_id: tId, key: arrayKey } },
                update: { value: JSON.stringify(cleaned) },
                create: { restaurant_id: tId, key: arrayKey, value: JSON.stringify(cleaned) },
            });
            await prisma.restaurantSetting.upsert({
                where: { restaurant_id_key: { restaurant_id: tId, key: singleKey } },
                update: { value: cleaned[0] || '' },
                create: { restaurant_id: tId, key: singleKey, value: cleaned[0] || '' },
            });
        }

        bumpSyncEpoch();
        await refreshCatalogCache().catch(e => console.error('[ADMIN] refreshCatalogCache error on save:', e));

        return res.json({
            success: true,
            data: {
                type,
                images: cleaned,
                count: cleaned.length,
                message: `${type === 'deals' ? 'Deals flyers' : 'Menu pages'} successfully saved and live on WhatsApp!`,
            },
        });
    } catch (err) {
        console.error('[ADMIN] Save cards error:', err);
        return res.status(500).json({ success: false, error: { message: err.message } });
    }
});

/**
 * PUT /api/admin/menu/cards/reorder
 * Reorder card pages in sequence
 */
router.put('/cards/reorder', async (req, res) => {
    try {
        const prisma = getDbClient();
        if (!prisma) return res.status(503).json({ success: false, error: { message: 'Database unavailable' } });

        const restaurantId = req.user?.restaurantId || (await getDefaultRestaurantId());
        const defaultRestId = await getDefaultRestaurantId();
        const type = (req.body?.type || 'menu').toLowerCase() === 'deals' ? 'deals' : 'menu';
        const arrayKey = type === 'deals' ? 'deals_image_urls' : 'menu_image_urls';
        const singleKey = type === 'deals' ? 'deals_image_url' : 'menu_image_url';

        const newImages = req.body?.images;
        if (!Array.isArray(newImages)) {
            return res.status(400).json({ success: false, error: { message: 'Invalid images array' } });
        }

        const cleaned = newImages.filter(u => typeof u === 'string' && u.trim().length > 0);

        const targetRestIds = new Set([restaurantId]);
        if (defaultRestId) targetRestIds.add(defaultRestId);
        try {
            const allActiveRests = await prisma.restaurant.findMany({ select: { id: true } });
            allActiveRests.forEach(r => targetRestIds.add(r.id));
        } catch (_) {}

        for (const tId of targetRestIds) {
            await prisma.restaurantSetting.upsert({
                where: { restaurant_id_key: { restaurant_id: tId, key: arrayKey } },
                update: { value: JSON.stringify(cleaned) },
                create: { restaurant_id: tId, key: arrayKey, value: JSON.stringify(cleaned) },
            });
            await prisma.restaurantSetting.upsert({
                where: { restaurant_id_key: { restaurant_id: tId, key: singleKey } },
                update: { value: cleaned[0] || '' },
                create: { restaurant_id: tId, key: singleKey, value: cleaned[0] || '' },
            });
        }

        bumpSyncEpoch();
        await refreshCatalogCache().catch(() => {});

        return res.json({
            success: true,
            data: {
                type,
                images: cleaned,
                message: 'Cards reordered successfully',
            },
        });
    } catch (err) {
        console.error('[ADMIN] Reorder cards error:', err);
        return res.status(500).json({ success: false, error: { message: err.message } });
    }
});

/**
 * POST /api/admin/menu/cards/reset
 * Reset cards to default assets
 */
router.post('/cards/reset', async (req, res) => {
    try {
        const prisma = getDbClient();
        if (!prisma) return res.status(503).json({ success: false, error: { message: 'Database unavailable' } });

        const restaurantId = req.user?.restaurantId || (await getDefaultRestaurantId());
        const defaultRestId = await getDefaultRestaurantId();
        const type = (req.body?.type || 'menu').toLowerCase() === 'deals' ? 'deals' : 'menu';
        const arrayKey = type === 'deals' ? 'deals_image_urls' : 'menu_image_urls';
        const singleKey = type === 'deals' ? 'deals_image_url' : 'menu_image_url';

        const targetRestIds = new Set([restaurantId]);
        if (defaultRestId) targetRestIds.add(defaultRestId);
        try {
            const allActiveRests = await prisma.restaurant.findMany({ select: { id: true } });
            allActiveRests.forEach(r => targetRestIds.add(r.id));
        } catch (_) {}

        const defaultAsset = type === 'deals' ? 'assets/menu/cravey_crust_deals_menu.png' : 'assets/menu/cravey_crust_main_menu.png';

        for (const tId of targetRestIds) {
            await prisma.restaurantSetting.upsert({
                where: { restaurant_id_key: { restaurant_id: tId, key: arrayKey } },
                update: { value: JSON.stringify([defaultAsset]) },
                create: { restaurant_id: tId, key: arrayKey, value: JSON.stringify([defaultAsset]) },
            });
            await prisma.restaurantSetting.upsert({
                where: { restaurant_id_key: { restaurant_id: tId, key: singleKey } },
                update: { value: defaultAsset },
                create: { restaurant_id: tId, key: singleKey, value: defaultAsset },
            });
        }

        bumpSyncEpoch();
        await refreshCatalogCache().catch(() => {});

        return res.json({
            success: true,
            data: {
                type,
                images: [defaultAsset],
                message: `${type === 'deals' ? 'Deals' : 'Menu'} cards reset to default flyer.`,
            },
        });
    } catch (err) {
        console.error('[ADMIN] Reset cards error:', err);
        return res.status(500).json({ success: false, error: { message: err.message } });
    }
});

/**
 * GET /api/admin/menu/:id
 * Get single menu item with variants
 */
router.get('/:id', async (req, res) => {
    try {
        const prisma = getDbClient();
        if (prisma) {
            try {
                const restaurantId = req.user?.restaurantId;
                const item = await prisma.menuItem.findFirst({
                    where: {
                        id: req.params.id,
                        ...(restaurantId ? { restaurant_id: restaurantId } : {}),
                    },
                    include: {
                        category: { select: { id: true, name: true, slug: true } },
                        variants: {
                            orderBy: { sort_order: 'asc' },
                        },
                    },
                });

                if (item) {
                    const globalDiscount = await getGlobalDiscountSettings(restaurantId);
                    const itemDiscount = calculateDiscount(
                        item.base_price,
                        item.discount_percent,
                        item.discount_fixed,
                        globalDiscount
                    );

                    return res.json({
                        success: true,
                        data: {
                            ...item,
                            base_price: Number(item.base_price),
                            discount_percent: item.discount_percent !== null ? Number(item.discount_percent) : null,
                            discount_fixed: item.discount_fixed !== null ? Number(item.discount_fixed) : null,
                            discount_info: itemDiscount,
                            variants: (item.variants || []).map(v => ({
                                ...v,
                                price: Number(v.price),
                                discount_percent: v.discount_percent !== null ? Number(v.discount_percent) : null,
                                discount_fixed: v.discount_fixed !== null ? Number(v.discount_fixed) : null,
                                discount_info: calculateDiscount(
                                    v.price,
                                    v.discount_percent || item.discount_percent,
                                    v.discount_fixed || item.discount_fixed,
                                    globalDiscount
                                ),
                            })),
                        },
                    });
                }
            } catch (dbErr) {
                console.warn('[ADMIN] DB menu item lookup failed, using fallback:', dbErr.message);
            }
        }

        const fallbackItems = getFallbackMenuItems();
        const fallback = fallbackItems.find(it => it.id === req.params.id || it.slug === req.params.id);
        if (fallback) {
            return res.json({
                success: true,
                data: {
                    ...fallback,
                    base_price: Number(fallback.base_price),
                    discount_percent: null,
                    discount_fixed: null,
                    discount_info: null,
                    variants: (fallback.variants || []).map(v => ({
                        ...v,
                        price: Number(v.price),
                        discount_percent: null,
                        discount_fixed: null,
                        discount_info: null,
                    })),
                },
            });
        }

        return res.status(404).json({
            success: false,
            error: { code: 'MENU_ITEM_NOT_FOUND', message: 'Menu item not found' },
        });
    } catch (err) {
        const fallbackItems = getFallbackMenuItems();
        const fallback = fallbackItems.find(it => it.id === req.params.id || it.slug === req.params.id);
        if (fallback) {
            return res.json({
                success: true,
                data: fallback,
            });
        }
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message },
        });
    }
});

/**
 * POST /api/admin/menu
 * Create new menu item
 */
router.post('/', async (req, res) => {
    try {
        const parseResult = createMenuItemSchema.safeParse(req.body);
        if (!parseResult.success) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: parseResult.error.errors[0]?.message || 'Invalid menu item data',
                    details: parseResult.error.flatten(),
                },
            });
        }

        const prisma = getDbClient();
        let restaurantId = req.user?.restaurantId;
        if (!restaurantId) {
            try {
                const { getDefaultRestaurantId } = await import('../../src/services/restaurantService.js');
                restaurantId = await getDefaultRestaurantId();
            } catch (_) {}
        }

        const {
            name,
            category_id,
            description,
            base_price,
            image_url,
            spicy_level,
            is_available,
            is_active,
            discount_percent,
            discount_fixed,
        } = parseResult.data;

        // Verify category exists
        const category = await prisma.category.findFirst({
            where: {
                id: category_id,
                ...(restaurantId ? { restaurant_id: restaurantId } : {}),
            },
        });

        if (!category) {
            return res.status(400).json({
                success: false,
                error: { code: 'CATEGORY_NOT_FOUND', message: 'Specified category does not exist' },
            });
        }

        const baseSlug = slugify(name);
        if (!baseSlug) {
            return res.status(400).json({
                success: false,
                error: { code: 'INVALID_NAME', message: 'Item name must contain valid characters' },
            });
        }

        // Check duplicate name or slug in restaurant
        const existing = await prisma.menuItem.findFirst({
            where: {
                ...(restaurantId ? { restaurant_id: restaurantId } : {}),
                OR: [
                    { slug: baseSlug },
                    { name: { equals: name, mode: 'insensitive' } },
                ],
            },
        });

        if (existing) {
            return res.status(409).json({
                success: false,
                error: {
                    code: 'MENU_ITEM_ALREADY_EXISTS',
                    message: `A menu item named '${name}' or with slug '${baseSlug}' already exists`,
                },
            });
        }

        const created = await prisma.menuItem.create({
            data: {
                restaurant_id: restaurantId,
                category_id,
                name,
                slug: baseSlug,
                description: description || null,
                base_price,
                image_url: image_url || null,
                spicy_level,
                is_available,
                is_active,
                discount_percent: discount_percent !== undefined ? discount_percent : null,
                discount_fixed: discount_fixed !== undefined ? discount_fixed : null,
            },
            include: {
                category: { select: { id: true, name: true, slug: true } },
                variants: true,
            },
        });

        bumpSyncEpoch();
        notifyN8nSync('menu_item_created');

        const globalDiscount = await getGlobalDiscountSettings(restaurantId);
        const itemDiscount = calculateDiscount(
            created.base_price,
            created.discount_percent,
            created.discount_fixed,
            globalDiscount
        );

        return res.status(201).json({
            success: true,
            data: {
                ...created,
                base_price: Number(created.base_price),
                discount_percent: created.discount_percent !== null ? Number(created.discount_percent) : null,
                discount_fixed: created.discount_fixed !== null ? Number(created.discount_fixed) : null,
                discount_info: itemDiscount,
            },
        });
    } catch (err) {
        console.error('[ADMIN] Create menu item error:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message },
        });
    }
});

/**
 * PUT /api/admin/menu/:id
 * Update menu item
 */
router.put('/:id', async (req, res) => {
    try {
        const parseResult = updateMenuItemSchema.safeParse(req.body);
        if (!parseResult.success) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: parseResult.error.errors[0]?.message || 'Invalid menu item data',
                },
            });
        }

        const prisma = getDbClient();
        const restaurantId = req.user?.restaurantId;
        const itemId = req.params.id;

        const existing = await prisma.menuItem.findFirst({
            where: {
                id: itemId,
                ...(restaurantId ? { restaurant_id: restaurantId } : {}),
            },
        });

        if (!existing) {
            return res.status(404).json({
                success: false,
                error: { code: 'MENU_ITEM_NOT_FOUND', message: 'Menu item not found' },
            });
        }

        const updateData = {};
        const {
            name,
            category_id,
            description,
            base_price,
            image_url,
            spicy_level,
            is_available,
            is_active,
            discount_percent,
            discount_fixed,
        } = parseResult.data;

        if (category_id !== undefined && category_id !== existing.category_id) {
            const category = await prisma.category.findFirst({
                where: {
                    id: category_id,
                    ...(restaurantId ? { restaurant_id: restaurantId } : {}),
                },
            });
            if (!category) {
                return res.status(400).json({
                    success: false,
                    error: { code: 'CATEGORY_NOT_FOUND', message: 'Specified category does not exist' },
                });
            }
            updateData.category_id = category_id;
        }

        if (name !== undefined) {
            updateData.name = name;
            const newSlug = slugify(name);
            if (newSlug !== existing.slug) {
                const duplicate = await prisma.menuItem.findFirst({
                    where: {
                        restaurant_id: restaurantId,
                        slug: newSlug,
                        id: { not: itemId },
                    },
                });
                if (duplicate) {
                    return res.status(409).json({
                        success: false,
                        error: { code: 'MENU_ITEM_ALREADY_EXISTS', message: `Menu item '${name}' already exists` },
                    });
                }
                updateData.slug = newSlug;
            }
        }

        if (description !== undefined) updateData.description = description;
        if (base_price !== undefined) updateData.base_price = base_price;
        if (image_url !== undefined) updateData.image_url = (image_url && typeof image_url === 'string' && image_url.trim()) ? image_url.trim() : null;
        if (spicy_level !== undefined) updateData.spicy_level = spicy_level;
        if (is_available !== undefined) updateData.is_available = is_available;
        if (is_active !== undefined) updateData.is_active = is_active;
        if (discount_percent !== undefined) updateData.discount_percent = discount_percent;
        if (discount_fixed !== undefined) updateData.discount_fixed = discount_fixed;

        const updated = await prisma.menuItem.update({
            where: { id: itemId },
            data: updateData,
            include: {
                category: { select: { id: true, name: true, slug: true } },
                variants: true,
            },
        });

        bumpSyncEpoch();
        notifyN8nSync('menu_item_updated');

        const globalDiscount = await getGlobalDiscountSettings(restaurantId);
        const itemDiscount = calculateDiscount(
            updated.base_price,
            updated.discount_percent,
            updated.discount_fixed,
            globalDiscount
        );

        return res.json({
            success: true,
            data: {
                ...updated,
                base_price: Number(updated.base_price),
                discount_percent: updated.discount_percent !== null ? Number(updated.discount_percent) : null,
                discount_fixed: updated.discount_fixed !== null ? Number(updated.discount_fixed) : null,
                discount_info: itemDiscount,
            },
        });
    } catch (err) {
        console.error('[ADMIN] Update menu item error:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message },
        });
    }
});

/**
 * PATCH /api/admin/menu/:id/availability
 * Quick toggle availability
 */
router.patch('/:id/availability', async (req, res) => {
    try {
        const prisma = getDbClient();
        const restaurantId = req.user?.restaurantId;
        const itemId = req.params.id;

        const item = await prisma.menuItem.findFirst({
            where: {
                id: itemId,
                ...(restaurantId ? { restaurant_id: restaurantId } : {}),
            },
        });

        if (!item) {
            return res.status(404).json({
                success: false,
                error: { code: 'MENU_ITEM_NOT_FOUND', message: 'Menu item not found' },
            });
        }

        const newAvailability = typeof req.body.is_available === 'boolean'
            ? req.body.is_available
            : !item.is_available;

        const updated = await prisma.menuItem.update({
            where: { id: itemId },
            data: { is_available: newAvailability },
        });

        bumpSyncEpoch();
        notifyN8nSync('menu_item_availability_changed');

        return res.json({
            success: true,
            data: {
                id: updated.id,
                name: updated.name,
                is_available: updated.is_available,
            },
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message },
        });
    }
});

/**
 * POST /api/admin/menu/delete-all
 * DELETE /api/admin/menu/delete-all
 * Delete all menu items, variants, cart items, and deal item links
 */
const handleDeleteAllMenuItems = async (req, res) => {
    try {
        const prisma = getDbClient();
        if (!prisma) {
            return res.status(503).json({ success: false, error: { code: 'DB_UNAVAILABLE', message: 'Database not available' } });
        }
        const { getDefaultRestaurantId } = await import('../../src/services/restaurantService.js');
        const restaurantId = req.user?.restaurantId || await getDefaultRestaurantId();

        await prisma.cartItem.deleteMany({
            where: { cart: { restaurant_id: restaurantId } },
        });
        await prisma.dealItem.deleteMany({
            where: { deal: { restaurant_id: restaurantId } },
        });
        await prisma.menuVariant.deleteMany({
            where: { menu_item: { restaurant_id: restaurantId } },
        });
        const result = await prisma.menuItem.deleteMany({
            where: { restaurant_id: restaurantId },
        });

        bumpSyncEpoch();
        const { refreshCatalogCache } = await import('../../src/services/catalogCacheService.js');
        await refreshCatalogCache();

        return res.json({
            success: true,
            count: result.count,
            message: `Successfully deleted all ${result.count} menu items`,
        });
    } catch (err) {
        console.error('[ADMIN] Failed to delete all menu items:', err);
        return res.status(500).json({ success: false, error: { code: 'DELETE_ALL_ERROR', message: err.message } });
    }
};

router.post('/delete-all', handleDeleteAllMenuItems);
router.delete('/delete-all', handleDeleteAllMenuItems);


/**
 * DELETE /api/admin/menu/:id
 * Delete menu item and associated variants
 */
router.delete('/:id', async (req, res) => {
    try {
        const prisma = getDbClient();
        const restaurantId = req.user?.restaurantId;
        const itemId = req.params.id;

        const item = await prisma.menuItem.findFirst({
            where: {
                id: itemId,
                ...(restaurantId ? { restaurant_id: restaurantId } : {}),
            },
        });

        if (!item) {
            return res.status(404).json({
                success: false,
                error: { code: 'MENU_ITEM_NOT_FOUND', message: 'Menu item not found' },
            });
        }

        await prisma.menuItem.delete({
            where: { id: itemId },
        });

        bumpSyncEpoch();
        notifyN8nSync('menu_item_deleted');

        return res.json({
            success: true,
            data: { message: `Menu item '${item.name}' deleted successfully` },
        });
    } catch (err) {
        console.error('[ADMIN] Delete menu item error:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message },
        });
    }
});

/**
 * POST /api/admin/menu/bulk-discount
 * Apply or clear discount across all menu items
 */
router.post('/bulk-discount', async (req, res) => {
    try {
        const prisma = getDbClient();
        if (!prisma) {
            return res.status(503).json({
                success: false,
                error: { code: 'DB_UNAVAILABLE', message: 'Database not available' },
            });
        }

        const restaurantId = req.user?.restaurantId;
        const discount_percent = req.body.discount_percent !== undefined ? req.body.discount_percent : req.body.discountPercent;
        const discount_fixed = req.body.discount_fixed !== undefined ? req.body.discount_fixed : req.body.discountFixed;
        const category_id = req.body.category_id !== undefined ? req.body.category_id : req.body.categoryId;

        const count = await bulkApplyDiscountToAllItems(restaurantId, {
            discountPercent: (discount_percent !== undefined && discount_percent !== '' && discount_percent !== null)
                ? Number(discount_percent)
                : null,
            discountFixed: (discount_fixed !== undefined && discount_fixed !== '' && discount_fixed !== null)
                ? Number(discount_fixed)
                : null,
            categoryId: category_id || null,
        });

        bumpSyncEpoch();
        notifyN8nSync('menu_items_bulk_discount');

        return res.json({
            success: true,
            data: {
                message: `Discount successfully applied to ${count} menu items`,
                updatedCount: count,
            },
        });
    } catch (err) {
        console.error('[ADMIN] Bulk discount error:', err);
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: err.message },
        });
    }
});

export default router;
