import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DOWNLOADS_DIR = path.join(__dirname, '..', 'downloads');

// Ensure downloads directory exists
if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

/**
 * Download media buffer from a URL
 */
export async function downloadFromUrl(url) {
    const response = await axios.get(url, {
        responseType: 'arraybuffer',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 60000,
    });
    return Buffer.from(response.data);
}

/**
 * Save buffer to downloads directory
 */
export function saveToDownloads(buffer, filename) {
    const filePath = path.join(DOWNLOADS_DIR, filename);
    fs.writeFileSync(filePath, buffer);
    return filePath;
}

/**
 * Generate a unique filename with timestamp
 */
export function generateFilename(prefix = 'file', ext = 'bin') {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `${prefix}_${timestamp}_${random}.${ext}`;
}

/**
 * Get MIME type extension mapping
 */
export function getExtFromMime(mimetype) {
    const map = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/gif': 'gif',
        'image/webp': 'webp',
        'video/mp4': 'mp4',
        'video/mpeg': 'mpeg',
        'video/quicktime': 'mov',
        'audio/mpeg': 'mp3',
        'audio/ogg': 'ogg',
        'audio/wav': 'wav',
        'audio/opus': 'opus',
        'application/pdf': 'pdf',
        'application/zip': 'zip',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    };
    return map[mimetype] || 'bin';
}

/**
 * Clean up old downloads (older than 24 hours)
 */
export function cleanOldDownloads() {
    try {
        const files = fs.readdirSync(DOWNLOADS_DIR);
        const now = Date.now();
        const maxAge = 24 * 60 * 60 * 1000;

        for (const file of files) {
            const filePath = path.join(DOWNLOADS_DIR, file);
            const stats = fs.statSync(filePath);
            if (now - stats.mtimeMs > maxAge) {
                fs.unlinkSync(filePath);
            }
        }
    } catch (err) {
        // Silently ignore cleanup errors
    }
}

/**
 * Safely send image(s) (local file or URL) or text message to a WhatsApp chat.
 * Supports both single `imageUrl` and multi-image `imageUrls` array.
 * Sends multiple pages in clean sequence with micro-delay between pages.
 */
export async function sendWhatsAppMediaOrText(sock, jid, { text, imageUrl, imageUrls }, options = {}) {
    if (!sock || !jid) return null;

    // Normalize images array
    const imagesList = Array.isArray(imageUrls) && imageUrls.length > 0
        ? imageUrls.filter(u => typeof u === 'string' && u.trim().length > 0)
        : (imageUrl && typeof imageUrl === 'string' && imageUrl.trim() ? [imageUrl.trim()] : []);

    if (imagesList.length > 0) {
        let lastResult = null;
        const total = imagesList.length;

        for (let i = 0; i < total; i++) {
            const singleImg = imagesList[i];
            const pageNum = i + 1;

            // Generate clean page caption
            let pageCaption = '';
            const cleanText = (text || '').trim();
            if (total === 1) {
                pageCaption = cleanText;
            } else if (cleanText) {
                pageCaption = i === 0 ? `${cleanText} (Page ${pageNum}/${total})` : `Page ${pageNum}/${total}`;
            }

            try {
                let imagePayload = null;
                const trimmed = singleImg.trim();

                if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
                    imagePayload = { url: trimmed };
                } else {
                    const relPath = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
                    let absPath = path.resolve(process.cwd(), relPath);
                    if (!fs.existsSync(absPath)) {
                        if (relPath.startsWith('uploads/')) {
                            const alt = path.resolve(process.cwd(), relPath.replace(/^uploads\//, 'assets/'));
                            if (fs.existsSync(alt)) absPath = alt;
                        } else if (relPath.startsWith('assets/')) {
                            const alt = path.resolve(process.cwd(), relPath.replace(/^assets\//, 'uploads/'));
                            if (fs.existsSync(alt)) absPath = alt;
                        }
                    }
                    if (fs.existsSync(absPath)) {
                        imagePayload = fs.readFileSync(absPath);
                    }
                }

                if (imagePayload) {
                    const isPdf = trimmed.toLowerCase().endsWith('.pdf') || (typeof singleImg === 'string' && singleImg.toLowerCase().includes('.pdf'));
                    const fileName = isPdf ? path.basename(trimmed) || 'Cravey_Crust_Menu.pdf' : undefined;
                    const sendPayload = isPdf
                        ? { document: imagePayload, mimetype: 'application/pdf', fileName }
                        : { image: imagePayload };
                    if (pageCaption && pageCaption.length <= 1000) {
                        sendPayload.caption = pageCaption;
                    }
                    const sendOptions = { ...options };
                    if (i > 0) {
                        sendOptions.skipPacing = true;
                    }
                    lastResult = await sock.sendMessage(jid, sendPayload, sendOptions);

                    // Micro-pause between multiple pages so delivery arrives in strict chronological order
                    if (i < total - 1) {
                        await new Promise(resolve => setTimeout(resolve, 350));
                    }
                }
            } catch (mediaErr) {
                console.error(`[MEDIA] Failed to send image ${pageNum}/${total} to ${jid}:`, mediaErr.message);
            }
        }

        if (lastResult) return lastResult;
    }

    // Fallback or plain text message
    if (text && text.trim()) {
        return await sock.sendMessage(jid, { text: text.trim() }, options);
    }
    return null;
}

