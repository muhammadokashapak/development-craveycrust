/**
 * ╔══════════════════════════════════════════╗
 * ║     WhatsApp Automation Bot v1.0.0       ║
 * ║     Powered by Baileys + Node.js         ║
 * ╚══════════════════════════════════════════╝
 */
import 'dotenv/config';
import express from 'express';
import QRCode from 'qrcode';
import qrcodeTerminal from 'qrcode-terminal';
import {
    default as makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    downloadMediaMessage,
    getContentType,
    fetchLatestBaileysVersion,
    fetchLatestWaWebVersion,
    makeCacheableSignalKeyStore,
    Browsers,
    proto,
    WAMessageStubType,
    downloadContentFromMessage,
} from '@whiskeysockets/baileys';

import pino from 'pino';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import crypto from 'crypto';

import MessageStore from './utils/messageStore.js';
import { cleanOldDownloads } from './utils/media.js';

// ─── n8n Bridge (kept for legacy HTTP route compat — message flow now uses AI Agent) ───
import { sendToN8n, buildN8nPayload, N8N_ENABLED, isN8nActive } from './utils/n8nBridge.js';
import n8nRouter, { injectSessions } from './routes/n8n.js';

// ─── Standalone AI Agent (n8n-free) ──────────────────────────────────────
import { processMessage as aiProcessMessage } from './src/services/aiAgentService.js';

// ─── Phase 1: Feature Flags + Health Route ────────────────
import { logFlags } from './src/config/flags.js';
import healthRouter, { injectSessionGetter } from './routes/health.js';

// ─── Phase 2: Restaurant Admin & Internal APIs ────────────
import { authenticateAdmin, verifyToken as verifyAuthToken } from './src/services/authService.js';
import { requireAdminAuth, requireInternalSecret } from './src/middleware/auth.js';
import adminDashboardRouter from './routes/admin/dashboard.js';
import adminCategoriesRouter from './routes/admin/categories.js';
import adminMenuRouter from './routes/admin/menu.js';
import adminVariantsRouter from './routes/admin/variants.js';
import adminSettingsRouter from './routes/admin/settings.js';
import adminPromptRouter from './routes/admin/prompt.js';
import adminUploadRouter from './routes/admin/upload.js';
import internalMenuRouter from './routes/internal/menu.js';

// ─── Phase 3: Deals, Promotions & Delivery Areas ──────────
import adminDealsRouter from './routes/admin/deals.js';
import adminDealItemsRouter from './routes/admin/dealItems.js';
import adminPromotionsRouter from './routes/admin/promotions.js';
import adminDeliveryAreasRouter from './routes/admin/deliveryAreas.js';
import internalDealsRouter from './routes/internal/deals.js';
import internalPromotionsRouter from './routes/internal/promotions.js';
import internalDeliveryRouter from './routes/internal/delivery.js';
import internalPricingRouter from './routes/internal/pricing.js';

// ─── Phase 4: Cart & Orders ───────────────────────────────
import internalCartRouter from './routes/internal/cart.js';
import internalOrdersRouter from './routes/internal/orders.js';
import adminOrdersRouter from './routes/admin/orders.js';
import adminCustomersRouter from './routes/admin/customers.js';
import adminSyncRouter from './routes/admin/sync.js';

// ─── Phase 4.5: FAQ & Knowledge Base ──────────────────────
import adminFaqCategoriesRouter from './routes/admin/faqCategories.js';
import adminFaqsRouter from './routes/admin/faqs.js';
import internalFaqsRouter from './routes/internal/faqs.js';
import internalFaqCategoriesRouter from './routes/internal/faqCategories.js';
import internalRestaurantRouter from './routes/internal/restaurant.js';
import internalHandoverRouter from './routes/internal/handover.js';
import { isChatMuted, unmuteChat } from './src/services/handoverService.js';

// ─── Phase 5: WhatsApp Ordering Orchestrator ──────────────
import { flags } from './src/config/flags.js';
import { handleIncomingOrderMessage } from './src/services/whatsappOrderOrchestrator.js';
import { registerSocketResolver } from './src/services/whatsappNotificationService.js';
import { resolveSenderIdentity } from './utils/senderIdentity.js';
import { extractLocation } from './utils/location.js';

// ─── ESM __dirname polyfill ──────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Configuration ────────────────────────────────────────
const PREFIX = process.env.PREFIX || '.';
const OWNER_NUMBER = process.env.OWNER_NUMBER || '';
const AUTO_REPLY = process.env.AUTO_REPLY !== 'false';
const PORT = process.env.PORT || 3000;
const DASHBOARD_USER = process.env.DASHBOARD_USER || 'admin';
const DASHBOARD_PASS = process.env.DASHBOARD_PASS || 'xortlogix';
const AUTH_SECRET = process.env.AUTH_SECRET || crypto.randomBytes(32).toString('hex');

// ─── Integration Mode Log ──────────────────────────────────
const _standaloneAI = (process.env.STANDALONE_AI_ENABLED || 'true').trim().toLowerCase() === 'true';
console.log(`[BOT] Mode: ${_standaloneAI ? 'STANDALONE AI AGENT (n8n bypassed)' : isN8nActive() ? 'n8n ENABLED | Webhook: ' + (process.env.N8N_WEBHOOK_URL || '(not set)') : 'NATIVE ORCHESTRATOR'}`);

// ─── Feature Flags (Phase 1) ──────────────────────────────
logFlags();

// ─── Multi-Session State & Management ─────────────────────
const sessionsBaseDir = path.join(__dirname, 'auth', 'sessions');
if (!fs.existsSync(sessionsBaseDir)) {
    fs.mkdirSync(sessionsBaseDir, { recursive: true });
}

class WhatsAppSession {
    constructor(id, name = 'WhatsApp Account') {
        this.id = id;
        this.name = name;
        this.sock = null;
        this.mode = 'restore';
        this.state = 'idle'; // 'idle' | 'starting' | 'pairing_code' | 'qr' | 'connected' | 'disconnected'
        this.pairingCode = null;
        this.qrDataUrl = null;
        this.user = null; // { name, id, number }
        this.startTime = Date.now();
        this.authDir = path.join(sessionsBaseDir, id);
        if (!fs.existsSync(this.authDir)) {
            fs.mkdirSync(this.authDir, { recursive: true });
        }
    }

    clearAuth() {
        if (fs.existsSync(this.authDir)) {
            try {
                const files = fs.readdirSync(this.authDir);
                for (const f of files) {
                    fs.rmSync(path.join(this.authDir, f), { recursive: true, force: true });
                }
                console.log(`🗑️ Auth cleared for session ${this.id}`);
            } catch (err) {
                console.error(`Error clearing auth for session ${this.id}:`, err.message);
            }
        }
    }

    async cleanup() {
        if (this.sock) {
            try {
                this.sock.ev.removeAllListeners();
                this.sock.end(new Error('Session stopped'));
            } catch (_) {}
            this.sock = null;
        }
    }

    toJSON() {
        return {
            id: this.id,
            name: this.user?.name || this.name,
            number: this.user?.number || null,
            state: this.state,
            pairingCode: this.pairingCode,
            qrDataUrl: this.qrDataUrl,
            user: this.user,
            prefix: PREFIX,
            commandsCount: commands.size,
            uptime: this.state === 'connected' ? Math.floor((Date.now() - this.startTime) / 1000) : 0
        };
    }
}

const activeSessions = new Map();
// Inject into n8n route so /api/n8n/send-message can resolve the correct socket
injectSessions(activeSessions);
registerSocketResolver(activeSessions);

function getPrimarySession() {
    if (activeSessions.size === 0) {
        const primary = new WhatsAppSession('primary', 'Primary Account');
        activeSessions.set('primary', primary);
        return primary;
    }
    return activeSessions.get('primary') || activeSessions.values().next().value;
}

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
    }
}));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ─── Health Route ─────────────────────────────────────────
// Mounted BEFORE auth middleware — publicly accessible, no token required.
// Used by load balancers, uptime monitors, and CI health checks.
// Inject session getter so health route can report connected session count.
injectSessionGetter(() => activeSessions);
app.use('/api/health', healthRouter);

// ─── Public Brand Info Route (Login screen display) ───────
app.get('/api/public/brand', async (req, res) => {
    try {
        const { getDbClient } = await import('./src/db/client.js');
        const prisma = getDbClient();
        if (prisma) {
            const { getDefaultRestaurantId } = await import('./src/services/restaurantService.js');
            const restId = await getDefaultRestaurantId().catch(() => null);
            if (restId) {
                const rest = await prisma.restaurant.findUnique({
                    where: { id: restId },
                    select: { name: true, phone: true }
                });
                if (rest && rest.name) {
                    const cleanName = /cravey/i.test(rest.name) ? 'Store Admin' : rest.name;
                    return res.json({ success: true, data: { name: cleanName, phone: rest.phone || '' } });
                }
            }
        }
    } catch (_) {}
    return res.json({ success: true, data: { name: 'Store Admin', phone: '' } });
});

// ─── n8n Outbound Route ───────────────────────────────────
// Mounted BEFORE the dashboard auth middleware so it uses its own
// X-Bot-Secret validation instead of the dashboard token system.
// n8n calls this endpoint to deliver AI replies back to WhatsApp.
app.use('/api/n8n', n8nRouter);

// ─── Phase 2 & 3: Internal Bot APIs ───────────────────────
// ─── Phase 2, 3 & 4: Internal Bot APIs ───────────────────
// Protected by X-Internal-API-Secret header.
app.use('/api/internal/menu', requireInternalSecret, internalMenuRouter);
app.use('/api/internal/deals', requireInternalSecret, internalDealsRouter);
app.use('/api/internal/promotions', requireInternalSecret, internalPromotionsRouter);
app.use('/api/internal/delivery-areas', requireInternalSecret, internalDeliveryRouter);
app.use('/api/internal/delivery', requireInternalSecret, internalDeliveryRouter);
app.use('/api/internal/pricing', requireInternalSecret, internalPricingRouter);
app.use('/api/internal/cart', requireInternalSecret, internalCartRouter);
app.use('/api/internal/orders', requireInternalSecret, internalOrdersRouter);
app.use('/api/internal/faqs', requireInternalSecret, internalFaqsRouter);
app.use('/api/internal/faq-categories', requireInternalSecret, internalFaqCategoriesRouter);
app.use('/api/internal/restaurant', requireInternalSecret, internalRestaurantRouter);
app.use('/api/internal/store/info', requireInternalSecret, internalRestaurantRouter);
app.use('/api/internal/handover', requireInternalSecret, internalHandoverRouter);

// ─── Dashboard Authentication & Protection ────────────────
// Open auth endpoints supporting both DB AdminUser (bcrypt) and legacy .env credentials
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body || {};
    try {
        const authResult = await authenticateAdmin(username, password);
        if (authResult) {
            console.log(`🔐 Dashboard login successful for user '${authResult.user.username}'`);
            return res.json({ success: true, token: authResult.token, user: authResult.user });
        }
    } catch (err) {
        console.error('Login error:', err);
    }
    console.warn(`⚠️ Failed dashboard login attempt for user '${username}'`);
    return res.status(401).json({ success: false, error: 'Invalid username or password' });
});

app.get('/api/auth/verify', (req, res) => {
    const authHeader = req.headers['authorization'] || req.headers['x-auth-token'];
    const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
    const result = verifyAuthToken(token);
    if (result.valid) {
        return res.json({ authenticated: true, user: result.user });
    }
    return res.status(401).json({ authenticated: false, error: result.error });
});

// ─── Restaurant Admin APIs ────────────────────────────────
app.use('/api/admin/dashboard', requireAdminAuth, adminDashboardRouter);
app.use('/api/admin/categories', requireAdminAuth, adminCategoriesRouter);
app.use('/api/admin/menu', requireAdminAuth, adminMenuRouter);
app.use('/api/admin/variants', requireAdminAuth, adminVariantsRouter);
app.use('/api/admin/settings', requireAdminAuth, adminSettingsRouter);
app.use('/api/admin/prompt', requireAdminAuth, adminPromptRouter);
app.use('/api/admin/upload', requireAdminAuth, adminUploadRouter);
app.use('/api/admin/deals', requireAdminAuth, adminDealsRouter);
app.use('/api/admin/deal-items', requireAdminAuth, adminDealItemsRouter);
app.use('/api/admin/promotions', requireAdminAuth, adminPromotionsRouter);
app.use('/api/admin/delivery-areas', requireAdminAuth, adminDeliveryAreasRouter);
app.use('/api/admin/orders', requireAdminAuth, adminOrdersRouter);
app.use('/api/admin/customers', requireAdminAuth, adminCustomersRouter);
app.use('/api/admin/sync', requireAdminAuth, adminSyncRouter);
app.use('/api/admin/faq-categories', requireAdminAuth, adminFaqCategoriesRouter);
app.use('/api/admin/faqs', requireAdminAuth, adminFaqsRouter);

// Protect all other /api endpoints (WhatsApp multi-session APIs)
app.use('/api', (req, res, next) => {
    if (
        req.path === '/auth/login' ||
        req.path === '/auth/verify' ||
        req.path.startsWith('/health') ||
        req.path.startsWith('/n8n') ||
        req.path.startsWith('/internal') ||
        req.path.startsWith('/admin')
    ) {
        return next();
    }
    const authHeader = req.headers['authorization'] || req.headers['x-auth-token'];
    const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
    const result = verifyAuthToken(token);
    if (result.valid) {
        req.user = result.user;
        return next();
    }
    return res.status(401).json({ error: 'Unauthorized', requireLogin: true });
});

// ─── Multi-Session API Endpoints ──────────────────────────

// List all sessions
app.get('/api/sessions', (req, res) => {
    const list = Array.from(activeSessions.values()).map(s => s.toJSON());
    res.json({ sessions: list });
});

// Create a new session slot (reuses existing idle if available)
app.post('/api/sessions/create', (req, res) => {
    try {
        // Reuse an existing idle account if one is already waiting for login
        const existingIdle = Array.from(activeSessions.values()).find(s => s.state === 'idle' && !s.user && s.id !== 'primary');
        if (existingIdle) {
            console.log(`ℹ️ Reusing existing idle session: ${existingIdle.id}`);
            return res.json({ success: true, session: existingIdle.toJSON(), reused: true });
        }

        const count = activeSessions.size + 1;
        const id = `account_${Date.now().toString(36)}`;
        const name = req.body.name || `Account ${count}`;
        const session = new WhatsAppSession(id, name);
        activeSessions.set(id, session);
        console.log(`➕ Created new session slot: ${id} (${name})`);
        res.json({ success: true, session: session.toJSON() });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get specific session status
app.get('/api/sessions/:id/status', (req, res) => {
    const session = activeSessions.get(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json(session.toJSON());
});

// Pairing code on specific session
app.post('/api/sessions/:id/auth/pairing-code', async (req, res) => {
    const session = activeSessions.get(req.params.id);
    if (!session) return res.status(404).json({ success: false, error: 'Session not found' });

    const { phoneNumber } = req.body;
    if (!phoneNumber) return res.status(400).json({ success: false, error: 'Phone number is required' });
    const cleanNumber = String(phoneNumber).replace(/[^0-9]/g, '');
    if (cleanNumber.length < 8) return res.status(400).json({ success: false, error: 'Please enter a valid phone number with country code.' });

    try {
        console.log(`\n📱 [${session.id}] Starting pairing code login for: ${cleanNumber}`);
        session.state = 'starting';
        session.pairingCode = null;
        session.qrDataUrl = null;

        await startSession(session, { mode: 'pairing', phoneNumber: cleanNumber });

        let wait = 0;
        while (!session.pairingCode && wait < 30 && session.state !== 'connected' && session.state !== 'idle') {
            await new Promise(r => setTimeout(r, 500));
            wait++;
        }

        if (session.pairingCode) {
            return res.json({ success: true, pairingCode: session.pairingCode });
        } else if (session.state === 'connected') {
            return res.json({ success: true, connected: true });
        } else {
            return res.status(500).json({ success: false, error: 'Timeout waiting for WhatsApp pairing code.' });
        }
    } catch (err) {
        session.state = 'idle';
        res.status(500).json({ success: false, error: err.message });
    }
});

// Start QR on specific session
app.post('/api/sessions/:id/auth/start-qr', async (req, res) => {
    const session = activeSessions.get(req.params.id);
    if (!session) return res.status(404).json({ success: false, error: 'Session not found' });

    try {
        console.log(`\n📱 [${session.id}] Starting QR code login flow...`);
        session.state = 'starting';
        session.pairingCode = null;
        session.qrDataUrl = null;

        await startSession(session, { mode: 'qr' });

        let wait = 0;
        while (!session.qrDataUrl && wait < 30 && session.state !== 'connected' && session.state !== 'idle') {
            await new Promise(r => setTimeout(r, 500));
            wait++;
        }

        if (session.qrDataUrl) {
            return res.json({ success: true, qrDataUrl: session.qrDataUrl });
        } else if (session.state === 'connected') {
            return res.json({ success: true, connected: true });
        } else {
            return res.status(500).json({ success: false, error: 'Timeout generating QR code.' });
        }
    } catch (err) {
        session.state = 'idle';
        res.status(500).json({ success: false, error: err.message });
    }
});

// Cancel auth on specific session
app.post('/api/sessions/:id/auth/cancel', async (req, res) => {
    const session = activeSessions.get(req.params.id);
    if (!session) return res.status(404).json({ success: false, error: 'Session not found' });

    try {
        await session.cleanup();
        session.clearAuth();
        session.state = 'idle';
        session.pairingCode = null;
        session.qrDataUrl = null;
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Logout specific session
app.post('/api/sessions/:id/logout', async (req, res) => {
    const session = activeSessions.get(req.params.id);
    if (!session) return res.status(404).json({ success: false, error: 'Session not found' });

    try {
        console.log(`🚪 [${session.id}] Logout requested...`);
        if (session.sock) {
            try { await session.sock.logout(); } catch (_) {
                try { session.sock.end(new Error('Manual logout')); } catch (_2) {}
            }
        }
        await session.cleanup();
        session.clearAuth();

        if (session.id !== 'primary') {
            try { fs.rmSync(session.authDir, { recursive: true, force: true }); } catch (_) {}
            activeSessions.delete(session.id);
        } else {
            session.state = 'idle';
            session.user = null;
            session.pairingCode = null;
            session.qrDataUrl = null;
        }

        res.json({ success: true, message: `Session ${session.id} logged out successfully` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Delete specific session (HTTP DELETE or POST)
async function deleteSessionHandler(req, res) {
    const session = activeSessions.get(req.params.id);
    if (!session) return res.status(404).json({ success: false, error: 'Session not found' });

    try {
        console.log(`🗑️ Deleting session: ${session.id}...`);
        if (session.sock) {
            try { await session.sock.logout(); } catch (_) {
                try { session.sock.end(new Error('Manual delete')); } catch (_2) {}
            }
        }
        await session.cleanup();
        session.clearAuth();

        if (session.id !== 'primary') {
            try { fs.rmSync(session.authDir, { recursive: true, force: true }); } catch (_) {}
            activeSessions.delete(session.id);
        } else {
            session.state = 'idle';
            session.user = null;
            session.pairingCode = null;
            session.qrDataUrl = null;
        }

        res.json({ success: true, message: `Session ${session.id} deleted successfully` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
}
app.delete('/api/sessions/:id', deleteSessionHandler);
app.post('/api/sessions/:id/delete', deleteSessionHandler);

// Clear all inactive/idle sessions (except connected accounts & primary)
app.post('/api/sessions/clear-inactive', async (req, res) => {
    try {
        let deleted = 0;
        for (const [id, session] of activeSessions.entries()) {
            if (id !== 'primary' && session.state !== 'connected') {
                await session.cleanup();
                session.clearAuth();
                try { fs.rmSync(session.authDir, { recursive: true, force: true }); } catch (_) {}
                activeSessions.delete(id);
                deleted++;
            }
        }
        console.log(`🧹 Cleaned up ${deleted} inactive session(s).`);
        res.json({ success: true, deletedCount: deleted });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── Backward Compatible Endpoints (Primary Session) ──────
app.get('/api/status', (req, res) => {
    const primary = getPrimarySession();
    res.json(primary.toJSON());
});

app.post('/api/auth/pairing-code', (req, res) => {
    req.params.id = getPrimarySession().id;
    return app._router.handle(req, res, () => {});
});

app.post('/api/auth/start-qr', (req, res) => {
    req.params.id = getPrimarySession().id;
    return app._router.handle(req, res, () => {});
});

app.post('/api/auth/cancel', (req, res) => {
    req.params.id = getPrimarySession().id;
    return app._router.handle(req, res, () => {});
});

app.post('/api/logout', (req, res) => {
    req.params.id = getPrimarySession().id;
    return app._router.handle(req, res, () => {});
});

// ─── In-Memory Terminal Log Stream ────────────────────────
const terminalLogs = [];
function addTerminalLog(type, text) {
    if (!text || typeof text !== 'string') return;
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0];
    const isQr = /[\u2580-\u2588]/.test(text) && text.includes('\n');
    terminalLogs.push({
        id: Date.now() + Math.random(),
        time: timeStr,
        type: isQr ? 'qr' : type, // 'qr' | 'info' | 'warn' | 'error' | 'command' | 'success'
        text: isQr ? text.replace(/[\r\n]+$/, '') : text.trim()
    });
    if (terminalLogs.length > 300) {
        terminalLogs.shift();
    }
}

// Hook console.log & console.error
const origConsoleLog = console.log;
const origConsoleError = console.error;
const origConsoleWarn = console.warn;

console.log = (...args) => {
    origConsoleLog(...args);
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    if (msg.trim()) addTerminalLog('info', msg);
};

console.error = (...args) => {
    origConsoleError(...args);
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    if (msg.trim()) addTerminalLog('error', msg);
};

console.warn = (...args) => {
    origConsoleWarn(...args);
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    if (msg.trim()) addTerminalLog('warn', msg);
};

// ─── API: Terminal Logs & Execution ──────────────────────
app.get('/api/terminal/logs', (req, res) => {
    res.json({ logs: terminalLogs });
});

app.post('/api/terminal/logs/clear', (req, res) => {
    terminalLogs.length = 0;
    res.json({ success: true, message: 'Logs cleared' });
});

app.post('/api/terminal/execute', async (req, res) => {
    const { command } = req.body;
    if (!command || !command.trim()) {
        return res.status(400).json({ error: 'Command is required' });
    }

    const trimmed = command.trim();
    addTerminalLog('command', `$ ${trimmed}`);
    const lower = trimmed.toLowerCase();

    if (lower === 'clear') {
        return res.json({ clear: true });
    }

    if (lower === 'help') {
        return res.json({
            output: [
                'WhatsApp Bot Terminal [Version 1.0.0]',
                'Available Terminal Commands:',
                '  help                 Show this help manual',
                '  status               View bot connection status and memory',
                '  uptime               View container uptime',
                '  commands             List all available bot commands',
                '  clear                Clear the terminal display',
                '  .ping                Test bot response latency',
                '  .menu                Show list of all WhatsApp bot tools',
                '  .ai <question>       Ask a question to AI',
                '  logout               Log out from WhatsApp account'
            ].join('\n')
        });
    }

    if (lower === 'status') {
        // Use the real primary session — botStatus was a legacy undefined reference
        const ps  = getPrimarySession();
        const mem = (process.memoryUsage().rss / (1024 * 1024)).toFixed(1);
        return res.json({
            output: [
                `State: ${(ps.state || 'idle').toUpperCase()}`,
                `User: ${ps.user?.name || 'None'} (+${ps.user?.number || 'Not connected'})`,
                `Prefix: ${PREFIX}`,
                `Commands: ${commands.size} active`,
                `Sessions: ${activeSessions.size} total`,
                `Uptime: ${Math.floor(process.uptime())}s`,
                `Memory RSS: ${mem} MB`
            ].join('\n')
        });
    }

    if (lower === 'uptime') {
        return res.json({
            output: `Bot Uptime: ${Math.floor(process.uptime())} seconds`
        });
    }

    if (lower === 'commands') {
        const list = Array.from(commands.values()).map(c => `  .${c.name.padEnd(12)} - ${c.description || ''}`);
        return res.json({
            output: `Registered WhatsApp Commands (${commands.size}):\n` + list.join('\n')
        });
    }

    if (lower === 'logout') {
        // Use the existing WhatsAppSession methods — clearAuthFolder/cleanupSocket were undefined
        const ps = getPrimarySession();
        try {
            if (ps.sock) {
                try { await ps.sock.logout(); } catch (_) {
                    try { ps.sock.end(new Error('Terminal logout')); } catch (_2) {}
                }
            }
        } catch (_) {}
        await ps.cleanup();   // removes socket listeners, nulls ps.sock
        ps.clearAuth();       // deletes auth/sessions/primary/* files
        ps.state      = 'idle';
        ps.user       = null;
        ps.pairingCode = null;
        ps.qrDataUrl  = null;
        console.log('🚪 Terminal: primary session logged out and auth cleared.');
        return res.json({
            output: 'Logged out successfully from WhatsApp. Auth data cleared. Return to the dashboard to reconnect.'
        });
    }

    if (lower === 'node bot.js' || lower === 'npm start' || lower === 'node bot') {
        // Use the real primary session — botStatus was a legacy undefined reference
        const ps = getPrimarySession();
        return res.json({
            output: `🟢 The WhatsApp bot server is ALREADY running and active (PID ${process.pid})!\n` +
                    `Current Connection State: ${(ps.state || 'idle').toUpperCase()}\n` +
                    (ps.state === 'idle'
                        ? '👉 To link your account: Enter your phone number in the card above or click "Scan with QR Code"!'
                        : `✅ Connected as: ${ps.user?.name || 'User'} (+${ps.user?.number})`)
        });
    }

    if (lower === 'scan' || lower === 'qr') {
        try {
            await startBot({ mode: 'qr' });
            return res.json({ output: '📱 Starting QR mode... QR Code is now generated on the screen above!' });
        } catch (err) {
            return res.json({ output: `Failed to start QR: ${err.message}` });
        }
    }

    if (trimmed.startsWith(PREFIX)) {
        const cmdName = trimmed.slice(PREFIX.length).trim().split(/\s+/)[0].toLowerCase();
        const cmd = commands.get(cmdName);
        if (cmd) {
            return res.json({
                output: `[COMMAND: .${cmdName}]\nCategory: ${cmd.category || 'General'}\nUsage: ${cmd.usage || 'N/A'}\nDescription: ${cmd.description || 'N/A'}`
            });
        } else {
            return res.json({
                output: `Command .${cmdName} not found. Type "commands" to view all loaded commands.`
            });
        }
    }

    // Execute real shell commands in Docker container
    exec(trimmed, { cwd: __dirname, timeout: 15000, maxBuffer: 1024 * 512 }, (err, stdout, stderr) => {
        let out = '';
        if (stdout) out += stdout;
        if (stderr) out += (out ? '\n' : '') + stderr;
        if (err && !out) out = `bash: ${err.message}`;
        if (!out.trim()) out = `(Command completed with exit code ${err ? err.code : 0})`;
        return res.json({ output: out.trim() });
    });
});

const server = app.listen(PORT, '0.0.0.0', () => {
    const displayHost = process.env.SERVER_IP || process.env.PUBLIC_IP || 'localhost';
    console.log(`🌐 Dashboard web server running at http://${displayHost}:${PORT}`);
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`\n❌ [PORT ERROR] Port ${PORT} pehle se kisi process mein use ho raha hai!`);
        console.error(`👉 Purani process ko band karne ke liye terminal mein yeh command chalayein:`);
        console.error(`   sudo fuser -k ${PORT}/tcp`);
        console.error(`   ya phir: sudo kill -9 $(sudo lsof -t -i:${PORT})\n`);
        process.exit(1);
    } else {
        console.error('Server error:', err);
        process.exit(1);
    }
});

// ─── Bounded Message ID Cache (duplicate-message protection) ────────────
// Replaces the unbounded Set that grew forever.
// Each message ID is stored with its arrival timestamp.
// Entries are considered stale after TTL_MS and are pruned by a periodic
// background interval so memory stays bounded.
class BoundedMessageCache {
    constructor(ttlMs = 10 * 60 * 1000, cleanupIntervalMs = 2 * 60 * 1000) {
        this._map     = new Map(); // id → arrivalTimestamp (ms)
        this._ttl     = ttlMs;
        // Unref so the interval never prevents process exit
        this._timer   = setInterval(() => this._evict(), cleanupIntervalMs).unref();
    }

    /** Returns true if the id was seen within the TTL window */
    has(id) {
        const ts = this._map.get(id);
        if (ts === undefined) return false;
        if (Date.now() - ts > this._ttl) {
            this._map.delete(id); // stale — treat as not seen
            return false;
        }
        return true;
    }

    /** Record a message id as seen right now */
    add(id) {
        this._map.set(id, Date.now());
    }

    /** Remove all entries older than TTL */
    _evict() {
        const cutoff = Date.now() - this._ttl;
        for (const [id, ts] of this._map) {
            if (ts < cutoff) this._map.delete(id);
        }
    }

    get size() { return this._map.size; }
}

// ─── Global State ─────────────────────────────────────────
global.messageCache = new MessageStore(10000);
// 10-minute TTL, cleanup every 2 minutes — bounded memory, strong deduplication
global.processedMessages = new BoundedMessageCache(10 * 60 * 1000, 2 * 60 * 1000);
global.antiDeleteEnabled = {};
global.antiLinkGroups = {};
global.welcomeGroups = {};

// ─── Load Commands (ESM dynamic import) ───────────────────
const commands = new Map();

async function loadCommands() {
    const commandsDir = path.join(__dirname, 'commands');
    if (!fs.existsSync(commandsDir)) {
        fs.mkdirSync(commandsDir, { recursive: true });
    }

    const commandFiles = fs.readdirSync(commandsDir).filter(f => f.endsWith('.js'));

    for (const file of commandFiles) {
        try {
            const filePath = path.join(commandsDir, file);
            // Use file:// URL for Windows compatibility with ESM dynamic import
            const fileUrl = new URL(`file:///${filePath.replace(/\\/g, '/')}`);
            // Cache-bust to support hot reload
            const moduleUrl = `${fileUrl.href}?t=${Date.now()}`;
            const mod = await import(moduleUrl);
            const cmd = mod.default;
            if (cmd && cmd.name) {
                commands.set(cmd.name, cmd);
            }
        } catch (err) {
            console.error(`  ❌ Failed to load command ${file}:`, err.message);
        }
    }
}

// ─── Auto-Reply Map ───────────────────────────────────────
const autoReplies = {
    'hello': 'Hello! How can I help you? 👋',
    'hi': 'Hey there! 👋 How can I help you?',
    'hey': 'Hey! What can I do for you? 😊',
    'assalam o alaikum': 'Wa Alaikum Assalam! 🤲',
    'assalamualaikum': 'Wa Alaikum Assalam! 🤲',
    'salam': 'Wa Alaikum Assalam! 🤲',
    'good morning': 'Good morning! ☀️ Have a great day!',
    'good night': 'Good night! 🌙 Sweet dreams!',
    'thank you': "You're welcome! 😊",
    'thanks': "You're welcome! 😊",
};

// ─── Start Specific Session ──────────────────────────────
async function startSession(session, options = {}) {
    const mode = options.mode || 'restore';
    const phoneNumber = options.phoneNumber || null;
    session.mode = mode;

    console.log('╔══════════════════════════════════════════╗');
    console.log(`║ Session: ${(session.id + ' (' + mode + ')').padEnd(32)}║`);
    console.log('╚══════════════════════════════════════════╝\n');

    await session.cleanup();

    // Ensure required directories exist
    const dirs = ['downloads'];
    dirs.forEach(dir => {
        const dirPath = path.join(__dirname, dir);
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
    });

    // ─── CRITICAL FIX: Fetch the latest WA Web version ────
    let waVersion;
    try {
        const webVersionResult = await fetchLatestWaWebVersion({});
        if (webVersionResult.isLatest) {
            waVersion = webVersionResult.version;
            console.log(`✅ [${session.id}] Got latest WA Web version: [${waVersion}]`);
        } else {
            throw new Error('Could not fetch WA Web version');
        }
    } catch (err) {
        try {
            const baileysVersionResult = await fetchLatestBaileysVersion();
            waVersion = baileysVersionResult.version;
        } catch (err2) {
            waVersion = [2, 3000, 1015901307];
        }
    }

    // Set up authentication for this specific session
    const { state, saveCreds } = await useMultiFileAuthState(session.authDir);
    const silentLogger = pino({ level: 'silent' });

    // Create socket connection
    const sock = makeWASocket({
        version: waVersion,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, silentLogger),
        },
        printQRInTerminal: false,
        logger: silentLogger,
        browser: Browsers.ubuntu('Chrome'),
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 25000,
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: true,
        syncFullHistory: false,
        getMessage: async (key) => {
            if (!key || !key.id) return undefined;
            const storeKey = `${key.remoteJid}_${key.id}`;
            const cached = global.messageCache.get(storeKey);
            if (cached && cached.message) return cached.message;
            return undefined;
        },
    });

    // Intercept sent messages to store in cache for retry decryption requests
    const origSendMessage = sock.sendMessage.bind(sock);
    sock.sendMessage = async (...args) => {
        const result = await origSendMessage(...args);
        if (result && result.key && result.message) {
            const storeKey = `${result.key.remoteJid}_${result.key.id}`;
            global.messageCache.set(storeKey, result);
        }
        return result;
    };

    session.sock = sock;

    // ─── Pairing Code Generation ──────────────────────────
    if (mode === 'pairing' && phoneNumber && !sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(phoneNumber);
                console.log(`\n🔑 [${session.id}] Pairing Code for ${phoneNumber}: ${code}\n`);
                session.pairingCode = code;
                session.state = 'pairing_code';
            } catch (err) {
                console.error(`[${session.id}] Failed to generate pairing code:`, err.message);
                session.state = 'idle';
                session.pairingCode = null;
            }
        }, 2000);
    }

    // ─── Connection Update Handler ────────────────────────
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr && session.mode === 'qr') {
            console.log(`\n📱 [${session.id}] Scan QR code with WhatsApp:`);
            qrcodeTerminal.generate(qr, { small: true });

            session.state = 'qr';
            try {
                session.qrDataUrl = await QRCode.toDataURL(qr, {
                    margin: 2,
                    scale: 8,
                    color: { dark: '#0b141a', light: '#ffffff' }
                });
            } catch (err) {
                console.error(`[${session.id}] QR generation failed:`, err.message);
            }
        }

        if (connection === 'open') {
            session.state = 'connected';
            session.qrDataUrl = null;
            session.pairingCode = null;
            session.startTime = Date.now();
            session.user = {
                name: sock.user?.name || 'WhatsApp User',
                id: sock.user?.id,
                number: sock.user?.id?.split(':')[0]?.split('@')[0]
            };

            console.log('╔══════════════════════════════════════════╗');
            console.log(`║  ✅ [${session.id}] CONNECTED: ${(session.user.name).padEnd(20)}║`);
            console.log('╚══════════════════════════════════════════╝');
            console.log(`📱 Number: ${session.user.number}`);
            console.log(`🔄 Session is now listening for messages...\n`);
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const reason = DisconnectReason;

            console.log(`⚠️ [${session.id}] Connection closed. Status code: ${statusCode}`);

            if (statusCode === reason.loggedOut) {
                console.log(`❌ [${session.id}] Session logged out. Clearing auth...`);
                session.clearAuth();
                await session.cleanup();
                session.state = 'idle';
                session.user = null;
                session.qrDataUrl = null;
                session.pairingCode = null;
                return;
            } else if (statusCode === 440) {
                if (session.state === 'connected') {
                    setTimeout(() => startSession(session, { mode: 'restore' }), 5000);
                }
            } else if (statusCode === reason.restartRequired) {
                startSession(session, { mode: session.mode, phoneNumber });
            } else if (statusCode === 405) {
                setTimeout(() => startSession(session, { mode: session.mode, phoneNumber }), 3000);
            } else {
                if (session.state === 'connected') {
                    session.state = 'disconnected';
                    const delay = statusCode === reason.timedOut ? 3000 : 5000;
                    setTimeout(() => startSession(session, { mode: 'restore' }), delay);
                }
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // ─── Message Handler ──────────────────────────────────
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            try {
                await handleMessage(sock, msg, session);
            } catch (err) {
                console.error(`[${session.id}] Message handler error:`, err);
            }
        }
    });

    // ─── Message Update Handler (Anti-Delete + Live Location) ─────────────
    sock.ev.on('messages.update', async (updates) => {
        for (const update of updates) {
            try {
                await handleMessageUpdate(sock, update, session);
            } catch (err) {
                console.error(`[${session.id}] Message update handler error:`, err);
            }
        }
    });

    // ─── Live Location Update Forwarding ──────────────────
    // Baileys delivers live location COORDINATE REFRESHES via messages.upsert
    // with type='append', which is filtered out above.  When a user's GPS
    // position changes while sharing a live location, WhatsApp sends the
    // updated coords as a new message.upsert append event OR as a
    // message.update — handle both by listening to the dedicated
    // location event emitted by Baileys v6 when coordinates are updated.
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        // We already handle 'notify' above. This block catches 'append'
        // which carries live location coordinate updates.
        if (type !== 'append') return;

        for (const msg of messages) {
            try {
                if (!msg.message || msg.key.remoteJid === 'status@broadcast') continue;
                if (msg.key.fromMe) continue; // never loop on own messages

                const jid    = msg.key.remoteJid;
                const isGroup = jid.endsWith('@g.us');
                if (isGroup) continue; // only private chats

                // Only process live location updates
                const rawMsg = msg.message || {};
                const hasLiveLoc = rawMsg.liveLocationMessage ||
                    rawMsg.ephemeralMessage?.message?.liveLocationMessage;
                if (!hasLiveLoc) continue;

                const botNumber = session?.user?.number || sock.user?.id?.split(':')[0]?.split('@')[0];
                const cfgOwner  = OWNER_NUMBER ? OWNER_NUMBER.replace(/\D/g, '') : null;
                const sender    = msg.key.participant || msg.key.remoteJid;
                const senderNum = sender.split(':')[0].replace('@s.whatsapp.net', '');
                const isOwnerMsg = senderNum === botNumber || (cfgOwner && senderNum === cfgOwner);
                if (isOwnerMsg) continue;

                const standaloneMode = (process.env.STANDALONE_AI_ENABLED || 'true').trim().toLowerCase() === 'true';
                if (standaloneMode) {
                    // Route live location to AI Agent via standard handleMessage path
                    console.log(`[AI] Live location update from ${senderNum}`);
                    setImmediate(() => handleMessage(sock, msg, session).catch(() => {}));
                } else if (isN8nActive()) {
                    // Legacy n8n forward
                    console.log(`[N8N] Live location update from ${senderNum}`);
                    setImmediate(() => sendToN8n(buildN8nPayload(sock, msg, session, '')));
                }
            } catch (err) {
                console.error(`[${session.id}] Live location update error:`, err.message);
            }
        }
    });

    // ─── Group Participants Update (Welcome/Goodbye) ──────
    sock.ev.on('group-participants.update', async (event) => {
        try {
            await handleGroupUpdate(sock, event, session);
        } catch (err) {
            console.error(`[${session.id}] Group update handler error:`, err);
        }
    });

    return sock;
}

// Fallback startBot for primary session
async function startBot(options = {}) {
    return startSession(getPrimarySession(), options);
}

// ─── Message Handler Logic ───────────────────────────────
async function handleMessage(sock, msg, session) {
    // Ignore status broadcasts and empty messages
    if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;

    const jid = msg.key.remoteJid;
    const messageId = msg.key.id;

    // Is this a REVOKE message? Handle Anti-Delete via ProtocolMessage
    if (msg.message.protocolMessage && msg.message.protocolMessage.type === proto.Message.ProtocolMessage.Type.REVOKE) {
        if (global.antiDeleteEnabled[jid]) {
            const revokedMsgId = msg.message.protocolMessage.key.id;
            const processedRevokeId = `revoke_${revokedMsgId}`;
            if (!global.processedMessages.has(processedRevokeId)) {
                global.processedMessages.add(processedRevokeId);
                await global.recoverDeletedMessage(sock, jid, revokedMsgId, session);
            }
        }
        return; // Don't process command logic for a revoke protocol message
    }

    // Prevent duplicate processing of the same message (fixes .vv sending twice)
    if (global.processedMessages.has(messageId)) return;
    global.processedMessages.add(messageId);

    // Store every message for anti-delete feature
    const storeKey = `${jid}_${messageId}`;
    global.messageCache.set(storeKey, msg);

    // Extract text from various message types
    const text = extractMessageText(msg);
    const isFromMe = msg.key.fromMe;
    const sender = msg.key.participant || msg.key.remoteJid;
    const isGroup = jid.endsWith('@g.us');

    // ── Check Human Handover Unmute Triggers (Restart/resume bot on human agent or customer command) ──
    const cleanText = (typeof text === 'string' ? text.trim().toLowerCase() : '');
    const isUnmuteCmd = !isGroup && (
        /^((\.)?unmute|(\.)?bot\s*(on|start|activate|resume|active|unmute|shuru|chalao)|start\s*bot|resume\s*bot|bot\s*shuru(\s*karo)?|bot\s*chalao|bot\s*active(\s*karo)?|unmute\s*karo)$/i.test(cleanText) ||
        cleanText === 'bot' || cleanText === '.bot'
    );

    if (isUnmuteCmd) {
        const senderNum = sender.split(':')[0].replace('@s.whatsapp.net', '');
        unmuteChat(jid);
        unmuteChat(sender);
        if (senderNum) unmuteChat(senderNum);
        console.log(`[HANDOVER] Chat ${jid} (${senderNum}) unmuted by command "${cleanText}" (isFromMe=${isFromMe}). Resuming bot.`);
        let dynamicWelcome = 'Walaikum Assalam! Khushamdeed! Bot ko dobara shuru kar diya gaya hai! Aaj aap kya order karna chahenge?';
        try {
            const { getDefaultRestaurantId } = await import('./src/services/restaurantService.js');
            const { getDbClient } = await import('./src/db/client.js');
            const prisma = getDbClient();
            if (prisma) {
                const restId = await getDefaultRestaurantId();
                const rest = await prisma.restaurant.findUnique({ where: { id: restId }, select: { name: true } });
                if (rest && rest.name && !/cravey/i.test(rest.name)) {
                    dynamicWelcome = `Walaikum Assalam! ${rest.name} mein khushamdeed! Bot ko dobara shuru kar diya gaya hai! Aaj aap kya order karna chahenge?`;
                }
            }
        } catch (_) {}
        await sock.sendMessage(jid, { text: dynamicWelcome }).catch(() => {});
        return;
    }

    // ─── Auto View-Once Saver ────────────────────────────────
    // Automatically intercept and save view-once messages to owner's private chat
    if (!isFromMe) {
        const isViewOnce = msg.message?.viewOnceMessage ||
                           msg.message?.viewOnceMessageV2 ||
                           msg.message?.viewOnceMessageV2Extension ||
                           msg.message?.ephemeralMessage?.message?.viewOnceMessage ||
                           msg.message?.ephemeralMessage?.message?.viewOnceMessageV2;

        if (isViewOnce) {
            try {
                const botNumber = session?.user?.number || sock.user?.id?.split('@')[0]?.split(':')[0];
                const configuredOwner = OWNER_NUMBER ? OWNER_NUMBER.replace(/\D/g, '') : null;
                const botOwnerJid = (configuredOwner ? `${configuredOwner}@s.whatsapp.net` : null) || (botNumber ? `${botNumber}@s.whatsapp.net` : null);
                const senderNum = sender.replace('@s.whatsapp.net', '').split(':')[0];
                const sourceInfo = isGroup ? `\n📍 *From group:* ${jid.replace('@g.us', '')}` : '';

                // Extract the media inside the view-once wrapper
                const innerMsg = isViewOnce.message || isViewOnce;
                const extracted = extractMediaMessage(msg.message);

                if (extracted) {
                    const { type, msg: mediaMsg } = extracted;

                    const stream = await downloadContentFromMessage(
                        mediaMsg,
                        type === 'document' ? 'document' : type
                    );

                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) {
                        buffer = Buffer.concat([buffer, chunk]);
                    }

                    const caption = `👁️ *Auto-Saved View-Once*\n👤 *From:* @${senderNum}${sourceInfo}`;

                    if (type === 'image') {
                        await sock.sendMessage(botOwnerJid, { image: buffer, caption });
                    } else if (type === 'video') {
                        await sock.sendMessage(botOwnerJid, { video: buffer, caption });
                    } else if (type === 'audio') {
                        await sock.sendMessage(botOwnerJid, {
                            audio: buffer,
                            mimetype: 'audio/mp4',
                            ptt: mediaMsg.ptt || false,
                        });
                    } else if (type === 'document') {
                        await sock.sendMessage(botOwnerJid, {
                            document: buffer,
                            mimetype: mediaMsg.mimetype || 'application/octet-stream',
                            fileName: mediaMsg.fileName || 'view_once_file',
                            caption,
                        });
                    }

                    console.log(`👁️ Auto-saved view-once from ${senderNum}`);
                }
            } catch (err) {
                console.error('Auto view-once save error:', err.message);
            }
        }
    }

    // ─── Anti-Link Check (groups) ─────────────────────────
    if (isGroup && global.antiLinkGroups[jid] && !isFromMe) {
        const hasLink = /(https?:\/\/[^\s]+|www\.[^\s]+|[a-z0-9]+\.(com|net|org|io|dev|me|info|xyz)[^\s]*)/gi.test(text);
        if (hasLink) {
            try {
                const metadata = await sock.groupMetadata(jid);
                const isAdmin = metadata.participants.some(p => {
                    return p.id.replace(/:\d+/, '') === sender.replace(/:\d+/, '') &&
                           (p.admin === 'admin' || p.admin === 'superadmin');
                });

                if (!isAdmin) {
                    await sock.sendMessage(jid, { delete: msg.key });
                    await sock.sendMessage(jid, {
                        text: `⚠️ @${sender.replace('@s.whatsapp.net', '')}, links are not allowed in this group!`,
                        mentions: [sender],
                    });
                    return;
                }
            } catch (err) {
                // Ignore error, continue processing
            }
        }
    }

    // ─── Auto-Reply (disabled for non-owners) ──────────────
    if (false) { // Auto-reply disabled: only owner can use bot
        const lowerText = text.toLowerCase().trim();
        if (autoReplies[lowerText]) {
            let shouldReply = true;
            if (isGroup) {
                // Check if bot is an admin in this group
                try {
                    const metadata = await sock.groupMetadata(jid);
                    const botIdPart = sock.user.id.split(':')[0]; // get base number
                    const botParticipant = metadata.participants.find(p => p.id.includes(botIdPart));
                    if (!botParticipant || (botParticipant.admin !== 'admin' && botParticipant.admin !== 'superadmin')) {
                        shouldReply = false; // Not admin, do not auto-reply
                    }
                } catch (e) {
                    shouldReply = false; // Error fetching metadata, safer to not reply
                }
            }

            if (shouldReply) {
                await sock.sendMessage(jid, {
                    text: autoReplies[lowerText],
                }, { quoted: msg });
            }
            return;
        }
    }

    // ─── Phase 5: Deterministic WhatsApp Ordering Flow ────────
    // Private customer messages are handled directly by the restaurant ordering orchestrator
    const hasText = typeof text === 'string' && text.trim().length > 0;
    const loc = extractLocation(msg);

    // ─── Standalone AI Agent Routing (n8n fully bypassed) ────────────────
    const standaloneAI = (process.env.STANDALONE_AI_ENABLED || 'true').trim().toLowerCase() === 'true';

    if (standaloneAI && !isFromMe && !isGroup) {
        const botNumber    = session?.user?.number || sock.user?.id?.split(':')[0]?.split('@')[0];
        const cfgOwner     = OWNER_NUMBER ? OWNER_NUMBER.replace(/\D/g, '') : null;
        const senderNum    = sender.split(':')[0].replace('@s.whatsapp.net', '');
        const isOwnerMsg   = senderNum === botNumber || isFromMe || (cfgOwner && senderNum === cfgOwner);
        const isOwnerCmd   = isOwnerMsg && typeof text === 'string' && text.startsWith(PREFIX);

        // Skip AI for explicit owner commands (e.g. .status, .uptime) — they go to command system
        if (!isOwnerCmd) {
            // ── Route to Standalone AI Agent (Fast routes + AI + Token logging) ──
            const identity = resolveSenderIdentity(sock, msg, session);
            console.log(`[AI] Processing message from ${senderNum} (${jid})`);
            try {
                const aiReply = await aiProcessMessage({
                    sock,
                    msg,
                    session,
                    text: text || '',
                    identity,
                    locationData: loc || null,
                });
                if (aiReply && aiReply.trim()) {
                    await sock.sendMessage(jid, { text: aiReply }).catch(err => {
                        console.error(`[AI] Failed to send reply to ${jid}:`, err.message);
                    });
                }
            } catch (agentErr) {
                console.error(`[AI] Agent error for ${jid}:`, agentErr.message);
                await sock.sendMessage(jid, {
                    text: 'Mafi chahta hoon, abhi kuch masla aa gaya. Thodi der baad dobara koshish karein.'
                }).catch(() => {});
            }
            return; // Handled by AI Agent
        }
        // Owner command: fall through to command system below
    }

    // ─── Legacy n8n Routing (only when STANDALONE_AI_ENABLED=false) ─────────
    if (!standaloneAI && isN8nActive() && !isFromMe && !isGroup) {
        const botNumber    = session?.user?.number || sock.user?.id?.split(':')[0]?.split('@')[0];
        const cfgOwner     = OWNER_NUMBER ? OWNER_NUMBER.replace(/\D/g, '') : null;
        const senderNum    = sender.split(':')[0].replace('@s.whatsapp.net', '');
        const isOwnerMsg   = senderNum === botNumber || isFromMe || (cfgOwner && senderNum === cfgOwner);
        const isOwnerCmd   = isOwnerMsg && typeof text === 'string' && text.startsWith(PREFIX);
        if (!isOwnerCmd) {
            const muteStatus = isChatMuted(jid) || isChatMuted(sender) || isChatMuted(senderNum);
            if (muteStatus?.isMuted) { return; }
            setImmediate(() => sendToN8n(buildN8nPayload(sock, msg, session, text)));
            return;
        }
    }

    const hasMedia = Boolean(msg.message?.imageMessage || msg.message?.videoMessage || msg.message?.audioMessage || msg.message?.documentMessage);
    const isCustomerOrderEligible = flags.WHATSAPP_ORDERING_ENABLED &&
                                    !isFromMe &&
                                    !msg.key.fromMe &&
                                    !isGroup &&
                                    (hasText || Boolean(loc) || hasMedia) &&
                                    (!text || !text.startsWith(PREFIX));

    if (isCustomerOrderEligible) {
        // Also suppress native order flow if muted for human handover
        const senderNum = sender.split(':')[0].replace('@s.whatsapp.net', '');
        const muteStatus = isChatMuted(jid) || isChatMuted(sender) || isChatMuted(senderNum);
        if (muteStatus?.isMuted) {
            console.log(`[HANDOVER] Chat ${jid} (${senderNum}) is muted for human support. Skipping native order orchestrator.`);
            return;
        }
        try {
            const identity = resolveSenderIdentity(sock, msg, session);
            const normalized = {
                sessionId: session.id,
                chatId: jid,
                messageId: msg.key.id,
                text: text || '',
                messageType: loc ? loc.type : (msg.message?.imageMessage ? 'image' : 'text'),
                verifiedPhone: identity.phone || '',
                phoneVerified: identity.phoneVerified === true,
                phoneSource: identity.phoneSource || 'unknown',
                pushName: msg.pushName || '',
                location: loc,
                isGroup: false,
            };

            const orderResponse = await handleIncomingOrderMessage({
                sock,
                session,
                normalizedMessage: normalized,
            });

            if (orderResponse && orderResponse.text) {
                await sock.sendMessage(jid, { text: orderResponse.text }, { quoted: msg });
                return; // Stop — handled by ordering orchestrator
            }
        } catch (orderErr) {
            console.error(`[${session.id}] WhatsApp ordering orchestrator error:`, orderErr);
        }
    }

    // ─── Command Processing ──────────────────────────────
    if (!text || !text.startsWith(PREFIX)) return;

    const fullCommand = text.slice(PREFIX.length).trim();
    const [commandName, ...args] = fullCommand.split(/\s+/);

    if (!commandName) return;

    // ─── Owner-Only Guard ─────────────────────────────────
    // Get the bot's own number (the number it's running as)
    const botNumber = session?.user?.number || sock.user?.id?.split(':')[0]?.split('@')[0];
    const configuredOwner = OWNER_NUMBER ? OWNER_NUMBER.replace(/\D/g, '') : null;
    const ownerJid = (configuredOwner ? `${configuredOwner}@s.whatsapp.net` : null) || (botNumber ? `${botNumber}@s.whatsapp.net` : null);
    // Get the sender's number (strip device suffix and @s.whatsapp.net)
    const senderNumber = sender.split(':')[0].replace('@s.whatsapp.net', '');

    // Allow the bot owner (the number the bot is running on, or configured OWNER_NUMBER) to use commands
    const isOwner = senderNumber === botNumber || isFromMe || (configuredOwner && senderNumber === configuredOwner);

    if (!isOwner) {
        console.log(`🚫 Command silently ignored from non-owner: ${senderNumber} (bot: ${botNumber})`);
        return; // Silently ignore — no reply, no indication bot exists
    }

    const command = commands.get(commandName.toLowerCase());

    if (!command) {
        console.log(`⚠️ Command not found: .${commandName}`);
        // If unknown command, notify owner privately and never expose in public/chat
        if (ownerJid && jid !== ownerJid) {
            await sock.sendMessage(ownerJid, {
                text: `⚠️ *Unknown Command Attempt*\n\n` +
                      `📌 *Typed:* \`${PREFIX}${commandName}\`\n` +
                      `💬 *Origin:* ${isGroup ? 'Group (' + jid + ')' : 'Private Chat'}\n` +
                      `👤 *Sender:* @${senderNumber}\n` +
                      `ℹ️ *Note:* Ignored in chat, reported to your private chat only.`,
                mentions: [sender]
            }).catch(() => {});
        }
        return;
    }

    console.log(`📩 Command: .${commandName} | From: ${sender} | Chat: ${jid}`);

    // Create a protected proxy socket for command execution:
    // ALL command outputs (results, menus, answers, downloads, stickers, errors)
    // will NEVER be sent to the other person's chat or group.
    // Everything is redirected to the bot owner's own private WhatsApp chat!
    const protectedSock = new Proxy(sock, {
        get(target, prop) {
            if (prop === 'sendMessage') {
                return async (targetJid, content, options) => {
                    // If targetJid is another person's chat or group (not owner's private chat):
                    // Route all output directly to ownerJid (except tagall which tags the group)
                    if (ownerJid && targetJid !== ownerJid && commandName !== 'tagall') {
                        // Suppress reactions in the other person's chat to remain completely stealthy
                        if (content?.react) {
                            return;
                        }

                        console.log(`🛡️ Redirecting .${commandName} output from ${targetJid} to owner ${ownerJid}`);

                        // Remove cross-chat quotation so WhatsApp renders cleanly in self-chat
                        const safeOptions = options ? { ...options } : {};
                        delete safeOptions.quoted;

                        return target.sendMessage(ownerJid, content, safeOptions);
                    }

                    return target.sendMessage(targetJid, content, options);
                };
            }
            return Reflect.get(target, prop);
        }
    });

    try {
        await command.execute(protectedSock, msg, args);
    } catch (err) {
        console.error(`Command error (.${commandName}):`, err);
        // Send error report ONLY to the bot owner's private chat, NEVER in public chat
        if (ownerJid) {
            await sock.sendMessage(ownerJid, {
                text: `❌ *Command Error Report*\n\n` +
                      `📌 *Command:* \`${PREFIX}${commandName}\`\n` +
                      `💬 *Origin:* ${isGroup ? 'Group (' + jid + ')' : 'Private Chat'}\n` +
                      `👤 *Sender:* @${senderNumber}\n` +
                      `❌ *Error:* ${err.message || err}`,
                mentions: [sender]
            }).catch(() => {});
        }
    }
}

// ─── Utility: Extract media from anywhere ───────────────
function extractMediaMessage(message) {
    if (!message) return null;
    const wrappers = [
        'ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2',
        'viewOnceMessageV2Extension', 'documentWithCaptionMessage', 'ptvMessage'
    ];
    for (const wrapper of wrappers) {
        if (message[wrapper] && message[wrapper].message) {
            const extracted = extractMediaMessage(message[wrapper].message);
            if (extracted) return extracted;
        }
    }
    if (message.imageMessage) return { type: 'image', msg: message.imageMessage };
    if (message.videoMessage) return { type: 'video', msg: message.videoMessage };
    if (message.audioMessage) return { type: 'audio', msg: message.audioMessage };
    if (message.documentMessage) return { type: 'document', msg: message.documentMessage };
    if (message.ptvMessage) return { type: 'video', msg: message.ptvMessage };
    return null;
}

// ─── Anti-Delete Handler ─────────────────────────────────
async function handleMessageUpdate(sock, update, session) {
    // A revoke message can come through messageStubType or protocolMessage
    const isRevoke = update.update?.messageStubType === WAMessageStubType.REVOKE || 
                     update.update?.message?.protocolMessage?.type === proto.Message.ProtocolMessage.Type.REVOKE;

    if (!isRevoke) return;

    const jid = update.key.remoteJid;

    if (!global.antiDeleteEnabled[jid]) return;

    // The ID of the revoked message is the update.key.id
    const revokedMsgId = update.key.id;
    if (!revokedMsgId) return;
    
    // Prevent duplicate anti-delete triggers handling the same revoke twice
    const processedRevokeId = `revoke_${revokedMsgId}`;
    if (global.processedMessages.has(processedRevokeId)) return;
    global.processedMessages.add(processedRevokeId);

    // Offload to a globally accessible function
    await global.recoverDeletedMessage(sock, jid, revokedMsgId, session);
}

// Ensure this is global so .vdeletemsg can trigger it on demand!
global.recoverDeletedMessage = async (sock, jid, revokedMsgId, session) => {
    const storeKey = `${jid}_${revokedMsgId}`;
    const originalMsg = global.messageCache.get(storeKey);

    if (!originalMsg) return false;

    const senderNumber = (originalMsg.key.participant || originalMsg.key.remoteJid)
        .replace('@s.whatsapp.net', '');

    // ─── Owner-Only: Send recovered message privately to bot owner ───
    const botNumber = session?.user?.number || sock.user?.id?.split('@')[0]?.split(':')[0];
    const configuredOwner = OWNER_NUMBER ? OWNER_NUMBER.replace(/\D/g, '') : null;
    const botOwnerJid = (configuredOwner ? `${configuredOwner}@s.whatsapp.net` : null) || (botNumber ? `${botNumber}@s.whatsapp.net` : null);
    if (!botOwnerJid) return false;

    try {
        const originalText = extractMessageText(originalMsg);

        let recoverText = `🗑️ *Anti-Delete: Message Recovered*\n`;
        recoverText += `━━━━━━━━━━━━━━━━━━━\n`;
        recoverText += `💬 *Chat:* ${jid}\n`;
        recoverText += `👤 *From:* @${senderNumber}\n`;

        if (originalText) {
            recoverText += `📝 *Message:* ${originalText}\n`;
        }

        recoverText += `━━━━━━━━━━━━━━━━━━━`;

        // Send ONLY to the bot owner's private chat, not in the group
        await sock.sendMessage(botOwnerJid, {
            text: recoverText,
            mentions: [`${senderNumber}@s.whatsapp.net`],
        });

        // Try to recover media if present
        const extractedMedia = extractMediaMessage(originalMsg.message);

        if (extractedMedia) {
            try {
                const { type, msg: mediaMsg } = extractedMedia;
                
                const stream = await downloadContentFromMessage(
                    mediaMsg,
                    type === 'document' ? 'document' : type
                );

                let buffer = Buffer.from([]);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }

                const caption = '🗑️ _Recovered deleted media_';

                if (type === 'image') {
                    await sock.sendMessage(botOwnerJid, { image: buffer, caption });
                } else if (type === 'video') {
                    await sock.sendMessage(botOwnerJid, { video: buffer, caption });
                } else if (type === 'audio') {
                    await sock.sendMessage(botOwnerJid, { 
                        audio: buffer, 
                        mimetype: 'audio/mp4',
                        ptt: mediaMsg.ptt || false 
                    });
                } else if (type === 'document') {
                    await sock.sendMessage(botOwnerJid, {
                        document: buffer,
                        mimetype: mediaMsg.mimetype || 'application/octet-stream',
                        fileName: mediaMsg.fileName || 'recovered_file',
                        caption,
                    });
                }
            } catch (mediaErr) {
                console.error('Failed to recover deleted media:', mediaErr.message);
            }
        }
        return true;
    } catch (err) {
        console.error('Anti-delete error:', err);
        return false;
    }
};

// ─── Group Update Handler (Welcome/Goodbye) ──────────────
async function handleGroupUpdate(sock, event, session) {
    const { id: groupJid, participants, action } = event;

    try {
        const metadata = await sock.groupMetadata(groupJid);
        const groupName = metadata.subject;

        for (const participant of participants) {
            const number = participant.replace('@s.whatsapp.net', '');

            if (action === 'add') {
                const welcomeMsg =
                    `╔══════════════════╗\n` +
                    `║   👋 *WELCOME!*    ║\n` +
                    `╚══════════════════╝\n\n` +
                    `Hello @${number}!\n` +
                    `Welcome to *${groupName}*! 🎉\n\n` +
                    `📋 Please read the group rules.\n` +
                    `💬 Feel free to introduce yourself!\n\n` +
                    `_You are member #${metadata.participants.length}_`;

                await sock.sendMessage(groupJid, {
                    text: welcomeMsg,
                    mentions: [participant],
                });
            }

            if (action === 'remove') {
                const goodbyeMsg = `👋 *Goodbye @${number}!*\nWe'll miss you in *${groupName}*.`;
                await sock.sendMessage(groupJid, {
                    text: goodbyeMsg,
                    mentions: [participant],
                });
            }
        }
    } catch (err) {
        console.error('Group welcome/goodbye error:', err);
    }
}

// ─── Utility: Extract text from any message type ─────────
function extractMessageText(msg) {
    let m = msg?.message;
    if (!m) return '';

    // Unwrap common message wrappers
    const wrappers = [
        'ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2',
        'viewOnceMessageV2Extension', 'documentWithCaptionMessage'
    ];
    for (let i = 0; i < 3; i++) { // allow nesting up to 3 levels
        let unwrapped = false;
        for (const w of wrappers) {
            if (m[w] && m[w].message) {
                m = m[w].message;
                unwrapped = true;
                break;
            }
        }
        if (!unwrapped) break;
    }

    return (
        m.conversation ||
        m.extendedTextMessage?.text ||
        m.imageMessage?.caption ||
        m.videoMessage?.caption ||
        m.documentMessage?.caption ||
        m.locationMessage?.name ||
        m.locationMessage?.address ||
        m.locationMessage?.comment ||
        m.liveLocationMessage?.caption ||
        m.buttonsResponseMessage?.selectedButtonId ||
        m.listResponseMessage?.singleSelectReply?.selectedRowId ||
        m.templateButtonReplyMessage?.selectedId ||
        ''
    );
}

// ─── Initialize All Sessions ──────────────────────────────
async function initAllSessions() {
    await loadCommands();

    // Auto-migrate legacy auth if exists directly in auth/
    const legacyCreds = path.join(__dirname, 'auth', 'creds.json');
    const primaryDir = path.join(sessionsBaseDir, 'primary');
    if (fs.existsSync(legacyCreds)) {
        console.log('🔄 Migrating legacy session to auth/sessions/primary...');
        if (!fs.existsSync(primaryDir)) fs.mkdirSync(primaryDir, { recursive: true });
        const legacyFiles = fs.readdirSync(path.join(__dirname, 'auth'));
        for (const f of legacyFiles) {
            if (f !== 'sessions') {
                const oldP = path.join(__dirname, 'auth', f);
                const newP = path.join(primaryDir, f);
                try {
                    if (fs.statSync(oldP).isFile()) {
                        fs.renameSync(oldP, newP);
                    }
                } catch (_) {}
            }
        }
    }

    const sessionFolders = fs.existsSync(sessionsBaseDir)
        ? fs.readdirSync(sessionsBaseDir).filter(f => {
            try { return fs.statSync(path.join(sessionsBaseDir, f)).isDirectory(); } catch (_) { return false; }
        })
        : [];

    if (sessionFolders.length === 0) {
        console.log(`📱 No saved sessions. Created 'primary' session in idle state.`);
        const primary = new WhatsAppSession('primary', 'Primary Account');
        activeSessions.set('primary', primary);
        return;
    }

    console.log(`🔄 Found ${sessionFolders.length} session(s). Booting in parallel...`);
    for (const folder of sessionFolders) {
        const sessionPath = path.join(sessionsBaseDir, folder);
        const credsPath = path.join(sessionPath, 'creds.json');
        const session = new WhatsAppSession(folder, folder === 'primary' ? 'Primary Account' : `Account (${folder})`);
        activeSessions.set(folder, session);

        if (fs.existsSync(credsPath)) {
            console.log(`🔄 Booting saved session '${folder}'...`);
            startSession(session, { mode: 'restore' }).catch(err => {
                console.error(`Failed to restore session '${folder}':`, err.message);
                session.state = 'idle';
            });
        } else {
            session.state = 'idle';
        }
    }
}

initAllSessions().catch(err => {
    console.error('Fatal error initializing sessions:', err);
});

// ─── Graceful Shutdown ───────────────────────────────────
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection:', reason);
});

process.on('SIGINT', () => {
    console.log('\n\n👋 Bot shutting down gracefully...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n\n👋 Bot received SIGTERM, shutting down...');
    process.exit(0);
});
