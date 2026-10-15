import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const router = express.Router();

const UPLOADS_DIR = path.join(process.cwd(), 'uploads', 'menu');

// Ensure upload directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Multer storage configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOADS_DIR);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const safeExt = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? ext : '.jpg';
        const uniqueName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${safeExt}`;
        cb(null, uniqueName);
    },
});

// File filter for safety
const fileFilter = (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('INVALID_FILE_TYPE: Only JPEG, PNG, and WebP images are allowed'));
    }
};

const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
        files: 1,
    },
});

/**
 * POST /api/admin/upload/image
 * Upload a menu item image
 */
router.post('/image', (req, res) => {
    upload.single('image')(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({
                    success: false,
                    error: { code: 'FILE_TOO_LARGE', message: 'Image must be under 5MB' },
                });
            }
            return res.status(400).json({
                success: false,
                error: { code: 'UPLOAD_ERROR', message: err.message },
            });
        } else if (err) {
            return res.status(400).json({
                success: false,
                error: { code: 'INVALID_FILE', message: err.message },
            });
        }

        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: { code: 'NO_FILE', message: 'No image file uploaded' },
            });
        }

        const relativeUrl = `/uploads/menu/${req.file.filename}`;
        return res.json({
            success: true,
            data: {
                filename: req.file.filename,
                url: relativeUrl,
                size: req.file.size,
                mimetype: req.file.mimetype,
            },
        });
    });
});

export default router;
