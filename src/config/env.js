/**
 * ╔══════════════════════════════════════════╗
 * ║   Env Config — src/config/env.js         ║
 * ║   Validates and exports typed env vars   ║
 * ╚══════════════════════════════════════════╝
 */

import { z } from 'zod';

const envSchema = z.object({
    PORT: z.string().default('3000'),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
    DASHBOARD_USER: z.string().default('admin'),
    DASHBOARD_PASS: z.string().default(''),
    SUPERADMIN_USER: z.string().default('superadmin'),
    SUPERADMIN_PASS: z.string().default(''),
    N8N_ENABLED: z.string().default('false'),
    N8N_WEBHOOK_URL: z.string().default(''),
    N8N_BOT_SECRET: z.string().default(''),
    N8N_TIMEOUT: z.string().default('10000'),
    DATABASE_URL: z.string().optional(),
    RESTAURANT_DB_ENABLED: z.string().default('false'),
    CORE_ORDER_ENGINE_ENABLED: z.string().default('false'),
    CUSTOM_AI_ENABLED: z.string().default('false'),
    REALTIME_DASHBOARD_ENABLED: z.string().default('false'),
    KNOWLEDGE_BASE_ENABLED: z.string().default('true'),
    WHATSAPP_ORDERING_ENABLED: z.string().default('true'),
    INTERNAL_API_SECRET: z.string().default(''),
    N8N_INTEGRATION_ENABLED: z.string().default('false'),
    AI_PRIMARY_PROVIDER: z.string().default('gemini'),
    AI_FALLBACK_PROVIDER: z.string().default('deepseek'),
    GEMINI_API_KEYS: z.string().default(''),
    GEMINI_MODEL: z.string().default('gemini-3.8-flash'),
    DEEPSEEK_API_KEYS: z.string().default(''),
    DEEPSEEK_BASE_URL: z.string().default('https://api.deepseek.com/v1'),
    DEEPSEEK_MODEL: z.string().default('deepseek-chat'),
    OPENAI_API_KEYS: z.string().default(''),
    OPENAI_BASE_URL: z.string().default('https://api.openai.com/v1'),
    OPENAI_MODEL: z.string().default('gpt-4o-mini'),
    AI_TEMPERATURE: z.string().default('0.0'),
    AI_MAX_TOKENS: z.string().default('1024'),
    STANDALONE_AI_ENABLED: z.string().default('true'),
});

let _env;

export function getEnv() {
    if (_env) return _env;
    const result = envSchema.safeParse(process.env);
    if (!result.success) {
        console.error('[ENV] Environment variable validation failed:');
        for (const issue of result.error.issues) {
            console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
        }
        _env = process.env;
        return _env;
    }
    _env = result.data;
    return _env;
}

export const env = getEnv();

if (env.RESTAURANT_DB_ENABLED === 'true' && !env.DATABASE_URL) {
    console.warn('[ENV] WARNING: RESTAURANT_DB_ENABLED=true but DATABASE_URL is not set.');
}

if (!env.DASHBOARD_PASS) {
    console.warn('[ENV] NOTICE: DASHBOARD_PASS is not set in environment variables.');
}
if (!env.SUPERADMIN_PASS) {
    console.warn('[ENV] NOTICE: SUPERADMIN_PASS is not set in environment variables.');
}

if (env.STANDALONE_AI_ENABLED === 'true') {
    const hasGemini = (env.GEMINI_API_KEYS || '').trim().length > 0;
    const hasDeepSeek = (env.DEEPSEEK_API_KEYS || '').trim().length > 0;
    const hasOpenAI = (env.OPENAI_API_KEYS || '').trim().length > 0;
    if (!hasGemini && !hasDeepSeek && !hasOpenAI) {
        console.warn('[ENV] WARNING: STANDALONE_AI_ENABLED=true but no AI API keys configured. Set GEMINI_API_KEYS / DEEPSEEK_API_KEYS / OPENAI_API_KEYS.');
    } else {
        console.log(`[ENV] Standalone AI Agent: PRIMARY=${env.AI_PRIMARY_PROVIDER}, FALLBACK=${env.AI_FALLBACK_PROVIDER}`);
    }
}
