/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║   LLM Router — src/services/llmRouter.js                     ║
 * ║   Multi-provider AI router with key rotation & fallback      ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Priority: Primary provider keys (round-robin) → Fallback provider keys → Tertiary
 * On quota/rate-limit (429 / 503 / specific error codes), auto-shifts to next key/provider.
 */

import axios from 'axios';
import { env } from '../config/env.js';

// ─── Key Pool Manager ─────────────────────────────────────────────────────

class KeyPool {
    constructor(keysStr) {
        this._keys = (keysStr || '')
            .split(',')
            .map(k => k.trim())
            .filter(k => k && !/^(key\d*|your_.*_key)$/i.test(k));
        this._index = 0; // round-robin pointer
        // Per-key cooldown map: key → timestamp when usable again
        this._cooldown = new Map();
    }

    get size() { return this._keys.length; }

    /**
     * Get next available (not-cooled-down) key and its index, or null if all are in cooldown.
     * @returns {{ key: string, index: number }|null}
     */
    next() {
        if (this._keys.length === 0) return null;
        const now = Date.now();
        for (let i = 0; i < this._keys.length; i++) {
            const idx = (this._index + i) % this._keys.length;
            const key = this._keys[idx];
            const coolUntil = this._cooldown.get(key) || 0;
            if (now >= coolUntil) {
                this._index = (idx + 1) % this._keys.length;
                return { key, index: idx };
            }
        }
        // If single key and cooled down, release cooldown early to allow retries
        if (this._keys.length === 1) {
            return { key: this._keys[0], index: 0 };
        }
        return null; // all keys currently in cooldown
    }

    /**
     * Mark a key as temporarily exhausted (default 90 s cooldown, or 3 s if single key).
     */
    cooldown(key, durationMs = 90_000) {
        const effectiveMs = this._keys.length === 1 ? Math.min(durationMs, 3_000) : durationMs;
        this._cooldown.set(key, Date.now() + effectiveMs);
        console.warn(`[LLM] Key cooled down for ${Math.round(effectiveMs / 1000)}s: ${key.slice(0, 8)}...`);
    }
}

// ─── Provider Implementations ─────────────────────────────────────────────

/**
 * Call Gemini via Google's native API endpoint with fallback to OpenAI-compatible endpoint.
 */
async function callGemini({ apiKey, model, messages, temperature, maxTokens }) {
    // Separate system messages from conversation turns
    const systemMessages = messages.filter(m => m.role === 'system');
    const conversationMessages = messages.filter(m => m.role !== 'system');

    const systemInstruction = systemMessages.length > 0 ? {
        parts: systemMessages.map(m => ({ text: m.content || '' }))
    } : undefined;

    const contents = conversationMessages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content || '' }]
    }));

    if (contents.length === 0) {
        contents.push({ role: 'user', parts: [{ text: 'Hello' }] });
    }

    const nativeUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    try {
        const resp = await axios.post(nativeUrl, {
            systemInstruction,
            contents,
            generationConfig: {
                temperature: temperature ?? 0.2,
                maxOutputTokens: maxTokens ?? 1024,
            }
        }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 30_000,
        });

        const cand = resp.data?.candidates?.[0];
        let content = '';
        if (cand?.content?.parts) {
            content = cand.content.parts.map(p => p.text || '').join('');
        }

        const usage = resp.data?.usageMetadata || {};
        const promptTokens = usage.promptTokenCount ?? 0;
        const replyTokens = usage.candidatesTokenCount ?? 0;
        const totalTokens = usage.totalTokenCount ?? (promptTokens + replyTokens);

        return {
            content,
            usage: { promptTokens, replyTokens, totalTokens },
        };
    } catch (nativeErr) {
        // If transient 503 (high demand) or 429, wait 1.5s and retry once
        if (nativeErr.response?.status === 503 || nativeErr.response?.status === 429) {
            console.warn(`[LLM] Gemini returned ${nativeErr.response?.status} — retrying after 1.5s delay...`);
            await new Promise(r => setTimeout(r, 1500));
            try {
                const retryResp = await axios.post(nativeUrl, {
                    systemInstruction,
                    contents,
                    generationConfig: {
                        temperature: temperature ?? 0.2,
                        maxOutputTokens: maxTokens ?? 1024,
                    }
                }, {
                    headers: { 'Content-Type': 'application/json' },
                    timeout: 30_000,
                });
                const cand = retryResp.data?.candidates?.[0];
                let content = '';
                if (cand?.content?.parts) {
                    content = cand.content.parts.map(p => p.text || '').join('');
                }
                const usage = retryResp.data?.usageMetadata || {};
                const promptTokens = usage.promptTokenCount ?? 0;
                const replyTokens = usage.candidatesTokenCount ?? 0;
                const totalTokens = usage.totalTokenCount ?? (promptTokens + replyTokens);
                return { content, usage: { promptTokens, replyTokens, totalTokens } };
            } catch (_) {}
        }

        // If 429 / 404 on current model, attempt fallback to gemini-2.5-flash
        if (model !== 'gemini-2.5-flash' && (nativeErr.response?.status === 429 || nativeErr.response?.status === 404)) {
            console.warn(`[LLM] Model ${model} gave ${nativeErr.response?.status} — auto-recovering with gemini-2.5-flash`);
            return callGemini({ apiKey, model: 'gemini-2.5-flash', messages, temperature, maxTokens });
        }

        // Fallback to OpenAI-compatible endpoint if native endpoint fails
        const url = `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`;
        const resp = await axios.post(url, {
            model,
            messages,
            temperature,
            max_tokens: maxTokens,
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            timeout: 30_000,
        });

        const content = resp.data?.choices?.[0]?.message?.content || '';
        const promptTokens = resp.data?.usage?.prompt_tokens ?? resp.data?.usageMetadata?.promptTokenCount ?? 0;
        const replyTokens = resp.data?.usage?.completion_tokens ?? resp.data?.usageMetadata?.candidatesTokenCount ?? 0;
        const totalTokens = resp.data?.usage?.total_tokens ?? resp.data?.usageMetadata?.totalTokenCount ?? (promptTokens + replyTokens);

        return {
            content,
            usage: { promptTokens, replyTokens, totalTokens },
        };
    }
}

/**
 * Call DeepSeek via OpenAI-compatible endpoint.
 */
async function callDeepSeek({ apiKey, model, baseUrl, messages, temperature, maxTokens }) {
    const url = `${(baseUrl || 'https://api.deepseek.com/v1').replace(/\/+$/, '')}/chat/completions`;
    const resp = await axios.post(url, {
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
    }, {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        timeout: 30_000,
    });

    const content = resp.data?.choices?.[0]?.message?.content || '';
    const promptTokens = resp.data?.usage?.prompt_tokens ?? 0;
    const replyTokens = resp.data?.usage?.completion_tokens ?? 0;
    const totalTokens = resp.data?.usage?.total_tokens ?? (promptTokens + replyTokens);

    return {
        content,
        usage: { promptTokens, replyTokens, totalTokens },
    };
}

/**
 * Call OpenAI via official chat completions endpoint.
 */
async function callOpenAI({ apiKey, model, baseUrl, messages, temperature, maxTokens }) {
    const url = `${(baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')}/chat/completions`;
    const resp = await axios.post(url, {
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
    }, {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        timeout: 30_000,
    });

    const content = resp.data?.choices?.[0]?.message?.content || '';
    const promptTokens = resp.data?.usage?.prompt_tokens ?? 0;
    const replyTokens = resp.data?.usage?.completion_tokens ?? 0;
    const totalTokens = resp.data?.usage?.total_tokens ?? (promptTokens + replyTokens);

    return {
        content,
        usage: { promptTokens, replyTokens, totalTokens },
    };
}

// ─── Rate-limit / Quota error detector ───────────────────────────────────

function isQuotaOrServerError(err) {
    const status = err?.response?.status;
    // 429 = rate limit, 503 = overloaded, 500/502 = server error
    if ([429, 500, 502, 503, 504].includes(status)) return true;
    const msg = (err?.response?.data?.error?.message || err?.message || '').toLowerCase();
    return msg.includes('quota') || msg.includes('rate limit') || msg.includes('resource_exhausted') || msg.includes('overloaded');
}

// ─── Key Pools (lazy-initialised once) ───────────────────────────────────

let _geminiPool = null;
let _deepSeekPool = null;
let _openAiPool  = null;

export function getGeminiPool()   { return (_geminiPool   ||= new KeyPool(env.GEMINI_API_KEYS)); }
export function getDeepSeekPool() { return (_deepSeekPool ||= new KeyPool(env.DEEPSEEK_API_KEYS)); }
export function getOpenAiPool()   { return (_openAiPool   ||= new KeyPool(env.OPENAI_API_KEYS)); }

// ─── Provider caller ─────────────────────────────────────────────────────

async function tryProvider(providerName, pool, messages, temperature, maxTokens) {
    let lastErr = null;
    const attempts = pool.size || 1;

    for (let i = 0; i < attempts; i++) {
        const keyItem = pool.next();
        if (!keyItem) {
            console.warn(`[LLM] All ${providerName} keys are in cooldown.`);
            throw new Error(`ALL_KEYS_EXHAUSTED:${providerName}`);
        }
        const { key, index: keyIndex } = keyItem;

        try {
            let res = null;
            let modelUsed = '';

            if (providerName === 'gemini') {
                modelUsed = env.GEMINI_MODEL || 'gemini-2.5-flash';
                res = await callGemini({
                    apiKey: key,
                    model: modelUsed,
                    messages, temperature, maxTokens,
                });
            } else if (providerName === 'deepseek') {
                modelUsed = env.DEEPSEEK_MODEL || 'deepseek-chat';
                res = await callDeepSeek({
                    apiKey: key,
                    model: modelUsed,
                    baseUrl: env.DEEPSEEK_BASE_URL,
                    messages, temperature, maxTokens,
                });
            } else if (providerName === 'openai') {
                modelUsed = env.OPENAI_MODEL || 'gpt-4o-mini';
                res = await callOpenAI({
                    apiKey: key,
                    model: modelUsed,
                    baseUrl: env.OPENAI_BASE_URL,
                    messages, temperature, maxTokens,
                });
            }

            console.log(`[LLM] Success via ${providerName} (${modelUsed}) | promptTokens: ${res.usage?.promptTokens || 0} | completionTokens: ${res.usage?.replyTokens || 0} | totalTokens: ${res.usage?.totalTokens || 0}`);

            return {
                content: res.content,
                usage: res.usage,
                provider: providerName,
                model: modelUsed,
                keyIndex,
                toString() { return this.content; },
                valueOf() { return this.content; },
            };
        } catch (err) {
            lastErr = err;
            if (isQuotaOrServerError(err)) {
                pool.cooldown(key, 90_000); // 90 s cooldown
                console.warn(`[LLM] ${providerName} quota/rate-limit/error on key #${keyIndex} (${key.slice(0, 8)}...): ${err.message}. Trying next key.`);
            } else {
                // Non-quota error, cool down briefly and try next key
                pool.cooldown(key, 30_000);
                console.warn(`[LLM] ${providerName} error on key #${keyIndex}: ${err.message}. Trying next.`);
            }
        }
    }
    throw lastErr || new Error(`${providerName}: all keys failed`);
}

// ─── Main Export: routeLLM ────────────────────────────────────────────────

/**
 * Route a chat completion request through available AI providers.
 * Tries primary provider (with key rotation), then fallback, then tertiary.
 *
 * @param {Array<{role:string,content:string}>} messages  OpenAI-style message array
 * @param {Object} [opts]
 * @param {number} [opts.temperature]
 * @param {number} [opts.maxTokens]
 * @returns {Promise<{content: string, usage: {promptTokens: number, replyTokens: number, totalTokens: number}, provider: string, model: string, keyIndex: number}>}
 */
export async function routeLLM(messages, opts = {}) {
    const temperature = opts.temperature ?? parseFloat(env.AI_TEMPERATURE || '0.2');
    const maxTokens   = opts.maxTokens   ?? parseInt(env.AI_MAX_TOKENS   || '1024', 10);

    const primaryName  = (env.AI_PRIMARY_PROVIDER  || 'gemini').toLowerCase();
    const fallbackName = (env.AI_FALLBACK_PROVIDER || 'deepseek').toLowerCase();

    const providerOrder = [primaryName];
    if (!providerOrder.includes(fallbackName)) {
        providerOrder.push(fallbackName);
    }
    // Add openai as final tertiary if not already in list
    if (!providerOrder.includes('openai') && getOpenAiPool().size > 0) {
        providerOrder.push('openai');
    }

    const poolMap = {
        gemini:   getGeminiPool(),
        deepseek: getDeepSeekPool(),
        openai:   getOpenAiPool(),
    };

    let lastError = null;
    for (const providerName of providerOrder) {
        const pool = poolMap[providerName];
        if (!pool || pool.size === 0) {
            console.log(`[LLM] Provider '${providerName}' has no API keys configured — skipping.`);
            continue;
        }

        try {
            return await tryProvider(providerName, pool, messages, temperature, maxTokens);
        } catch (err) {
            lastError = err;
            console.warn(`[LLM] Provider '${providerName}' exhausted or failed: ${err.message} — trying fallback provider.`);
        }
    }

    throw lastError || new Error('[LLM] All AI providers exhausted. Unable to generate a response.');
}

export default routeLLM;
