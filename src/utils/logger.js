/**
 * ╔══════════════════════════════════════════╗
 * ║   Logger — src/utils/logger.js           ║
 * ║   Pino structured logger with            ║
 * ║   development pretty-print support.      ║
 * ╚══════════════════════════════════════════╝
 */

import pino from 'pino';

const isDev = (process.env.NODE_ENV || 'production') !== 'production';

export const logger = pino({
    level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
    // Pretty-print in development for readability
    ...(isDev ? {
        transport: {
            target: 'pino-pretty',
            options: {
                colorize: true,
                translateTime: 'SYS:HH:MM:ss',
                ignore: 'pid,hostname',
            },
        },
    } : {}),
    // Redact sensitive fields from all log output
    redact: {
        paths: [
            'password',
            'password_hash',
            'token',
            'secret',
            'N8N_BOT_SECRET',
            'DASHBOARD_PASS',
            'DATABASE_URL',
            'REDIS_URL',
            '*.password',
            '*.token',
            '*.secret',
        ],
        censor: '[REDACTED]',
    },
});

// Child loggers for named subsystems
export const dbLogger       = logger.child({ module: 'db' });
export const apiLogger      = logger.child({ module: 'api' });
export const botLogger      = logger.child({ module: 'bot' });
export const n8nLogger      = logger.child({ module: 'n8n' });
export const flagLogger     = logger.child({ module: 'flags' });

// ─── Token Tracking & Formatted Console Reports (Hissa 2) ─────────────────

let _totalAiCalls = 0;
let _zeroTokenReplies = 0;
let _grandTotalTokens = 0;

export function getTokenStats() {
    return {
        totalAiCalls: _totalAiCalls,
        zeroTokenReplies: _zeroTokenReplies,
        grandTotalTokens: _grandTotalTokens,
    };
}

const SEPARATOR = '--------------------------------------------------------------------------------';

/**
 * Log zero-token local command or cache reply.
 */
export function logZeroTokenReply({ whatsappPhone, message, routeName }) {
    _zeroTokenReplies += 1;
    const phone = whatsappPhone || 'unknown';
    const msg = (message || '').replace(/\r?\n/g, ' ').slice(0, 80);
    const route = routeName || 'Local Command/Cache';

    console.log(SEPARATOR);
    console.log(`[TOKEN LOG] Customer: ${phone} | Msg: "${msg}"`);
    console.log(`[TOKEN LOG] Status: ZERO TOKENS USED (0 Tokens) | Route: ${route}`);
    console.log(`[TOKEN METRICS (THIS MESSAGE)] promptTokens: 0 | completionTokens: 0 | totalTokens: 0`);
    console.log(`[TOKEN METRICS] promptTokens:0 | completionTokens:0 | totalTokens:0`);
    console.log(SEPARATOR);
}

/**
 * Log AI token consumption report for the specific message.
 */
export function logAiTokenReply({ whatsappPhone, message, provider, model, keyIndex, promptTokens = 0, replyTokens = 0, totalTokens = 0, toolsCalled }) {
    _totalAiCalls += 1;
    _grandTotalTokens += Number(totalTokens || 0);

    const phone = whatsappPhone || 'unknown';
    const msg = (message || '').replace(/\r?\n/g, ' ').slice(0, 80);
    const prov = (provider || 'AI').toUpperCase();
    const mdl = model || 'chat';
    const idx = keyIndex != null ? keyIndex : 0;
    const tools = (Array.isArray(toolsCalled) && toolsCalled.length > 0)
        ? toolsCalled.join(', ')
        : (toolsCalled && toolsCalled !== 'none' ? toolsCalled : null);

    console.log(SEPARATOR);
    console.log(`[TOKEN LOG] Customer: ${phone} | Msg: "${msg}"`);
    console.log(`[TOKEN LOG] Status: AI TOKENS USED | Provider: ${prov} (${mdl}) | Key Index: #${idx}`);
    console.log(`[TOKEN METRICS (THIS MESSAGE)] promptTokens: ${promptTokens} | completionTokens: ${replyTokens} | totalTokens: ${totalTokens}`);
    console.log(`[TOKEN METRICS] promptTokens:${promptTokens} | completionTokens:${replyTokens} | totalTokens:${totalTokens}`);
    if (tools) {
        console.log(`[TOKEN LOG] Tools Called: ${tools}`);
    }
    console.log(SEPARATOR);
}

export default logger;

