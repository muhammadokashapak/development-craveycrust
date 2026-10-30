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

// ─── Key Pool Manager (Quota-Aware & Load-Balanced) ──────────────────────

class KeyPool {
    constructor(keysStr, opts = {}) {
        this._keys = (keysStr || '')
            .split(',')
            .map(k => k.trim())
            .filter(k => k && !/^(key\d*|your_.*_key)$/i.test(k));

        // Gemini Free Tier Limits: 15 RPM (Requests Per Minute), 1500 RPD (Requests Per Day)
        this._rpmLimit = opts.rpmLimit ?? 15;
        this._rpmSafetyCap = opts.rpmSafetyCap ?? 10; // Safe threshold to prevent 429
        this._rpdLimit = opts.rpdLimit ?? 1500;
        this._rpdSafetyCap = opts.rpdSafetyCap ?? 1450; // Daily safe threshold

        this._stats = new Map();
        for (let i = 0; i < this._keys.length; i++) {
            this._getOrCreateStats(this._keys[i], i);
        }
    }

    get size() { return this._keys.length; }

    _getOrCreateStats(key, index = -1) {
        if (!this._stats.has(key)) {
            const idx = index >= 0 ? index : this._keys.indexOf(key);
            this._stats.set(key, {
                key,
                index: idx,
                requestTimestamps: [],
                dailyCount: 0,
                dayEpoch: new Date().toISOString().slice(0, 10),
                totalRequests: 0,
                consecutiveErrors: 0,
                coolUntil: 0,
                lastUsedAt: 0,
                lastResponseTimeMs: 0,
            });
        }
        return this._stats.get(key);
    }

    /**
     * Get the healthiest key with maximum remaining quota.
     * Prioritizes lowest RPM in last 60s, lowest daily count, and longest rest time.
     * @returns {{ key: string, index: number, stats?: object }|null}
     */
    next() {
        if (this._keys.length === 0) return null;
        const now = Date.now();
        const today = new Date().toISOString().slice(0, 10);

        // 1. Refresh stats (clean up requests older than 60s, reset daily counts if new day)
        for (const key of this._keys) {
            const s = this._getOrCreateStats(key);
            if (s.dayEpoch !== today) {
                s.dayEpoch = today;
                s.dailyCount = 0;
            }
            s.requestTimestamps = s.requestTimestamps.filter(t => (now - t) < 60_000);
        }

        // 2. Identify available candidates (not in cooldown, daily quota not exhausted)
        const candidates = [];
        for (let i = 0; i < this._keys.length; i++) {
            const key = this._keys[i];
            const s = this._stats.get(key);
            if (now < s.coolUntil) continue;
            if (s.dailyCount >= this._rpdSafetyCap) continue;
            candidates.push({ key, index: i, stats: s });
        }

        // If all keys in cooldown / single key fallback
        if (candidates.length === 0) {
            if (this._keys.length === 1) {
                const s = this._stats.get(this._keys[0]);
                return this._claimKey({ key: this._keys[0], index: 0, stats: s }, now);
            }
            // Release earliest cooled key early if needed to keep bot responsive
            const nonDailyKeys = this._keys
                .map((k, i) => ({ key: k, index: i, stats: this._stats.get(k) }))
                .filter(c => c.stats.dailyCount < this._rpdSafetyCap);
            if (nonDailyKeys.length > 0) {
                nonDailyKeys.sort((a, b) => a.stats.coolUntil - b.stats.coolUntil);
                const chosen = nonDailyKeys[0];
                chosen.stats.coolUntil = 0;
                return this._claimKey(chosen, now);
            }
            return null;
        }

        // 3. Prefer keys under safe RPM threshold (10 RPM)
        const underRpmLimit = candidates.filter(c => c.stats.requestTimestamps.length < this._rpmSafetyCap);
        const poolToPickFrom = underRpmLimit.length > 0 ? underRpmLimit : candidates;

        // 4. Sort candidates to pick the BEST key with MAX remaining quota:
        // - Lowest current RPM count (most available per-minute headroom)
        // - Lowest daily count (most remaining daily quota)
        // - Least recently used (longest rest time)
        // - Lowest consecutive errors
        poolToPickFrom.sort((a, b) => {
            const rpmDiff = a.stats.requestTimestamps.length - b.stats.requestTimestamps.length;
            if (rpmDiff !== 0) return rpmDiff;

            const dailyDiff = a.stats.dailyCount - b.stats.dailyCount;
            if (dailyDiff !== 0) return dailyDiff;

            const lruDiff = (a.stats.lastUsedAt || 0) - (b.stats.lastUsedAt || 0);
            if (lruDiff !== 0) return lruDiff;

            return a.stats.consecutiveErrors - b.stats.consecutiveErrors;
        });

        const chosen = poolToPickFrom[0];
        return this._claimKey(chosen, now);
    }

    _claimKey(chosen, now) {
        chosen.stats.requestTimestamps.push(now);
        chosen.stats.dailyCount++;
        chosen.stats.totalRequests++;
        chosen.stats.lastUsedAt = now;
        return {
            key: chosen.key,
            index: chosen.index,
            stats: {
                currentRpm: chosen.stats.requestTimestamps.length,
                dailyCount: chosen.stats.dailyCount,
                remainingRpmQuota: Math.max(0, this._rpmLimit - chosen.stats.requestTimestamps.length),
                remainingDailyQuota: Math.max(0, this._rpdLimit - chosen.stats.dailyCount),
            }
        };
    }

    /**
     * Mark a key as temporarily cooled down.
     */
    cooldown(key, durationMs = 60_000) {
        const effectiveMs = this._keys.length === 1 ? Math.min(durationMs, 3_000) : durationMs;
        const s = this._getOrCreateStats(key);
        s.coolUntil = Date.now() + effectiveMs;
        s.consecutiveErrors++;
        const idx = this._keys.indexOf(key);
        console.warn(`[LLM] Key #${idx >= 0 ? idx : '?'} cooled down for ${Math.round(effectiveMs / 1000)}s: ${key.slice(0, 8)}...`);
    }

    /**
     * Record a successful response on a key.
     */
    recordSuccess(key, latencyMs = 0) {
        const s = this._stats.get(key);
        if (s) {
            s.consecutiveErrors = 0;
            s.lastResponseTimeMs = latencyMs;
        }
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
            timeout: 10_000,
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
        const status = nativeErr.response?.status;
        const errCode = nativeErr.code;

        // If 429 / 404 / 503 / timeout on current model, attempt graceful fallback across modern Gemini flash tiers
        if (status === 429 || status === 404 || status === 503 || errCode === 'ECONNABORTED') {
            const fallbackChain = ['gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-1.5-flash'];
            const nextModel = fallbackChain.find(m => m !== model);
            if (nextModel) {
                console.warn(`[LLM] Model ${model} gave ${status || errCode} — auto-recovering with ${nextModel}`);
                return callGemini({ apiKey, model: nextModel, messages, temperature, maxTokens });
            }
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
            timeout: 10_000,
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
    const code = err?.code;
    // 429 = rate limit, 503 = overloaded, 500/502/504 = server error, ECONNABORTED/ETIMEDOUT = timeout
    if ([429, 500, 502, 503, 504].includes(status) || code === 'ECONNABORTED' || code === 'ETIMEDOUT') return true;
    const msg = (err?.response?.data?.error?.message || err?.message || '').toLowerCase();
    return msg.includes('quota') || msg.includes('rate limit') || msg.includes('resource_exhausted') || msg.includes('overloaded') || msg.includes('timeout');
}

// ─── Key Pools (lazy-initialised once) ───────────────────────────────────

let _geminiPool = null;
let _deepSeekPool = null;
let _openAiPool  = null;

export function getGeminiPool() {
    if (!_geminiPool) {
        const raw = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || env.GEMINI_API_KEYS || '';
        _geminiPool = new KeyPool(raw);
    }
    return _geminiPool;
}
export function getDeepSeekPool() {
    if (!_deepSeekPool) {
        const raw = process.env.DEEPSEEK_API_KEYS || process.env.DEEPSEEK_API_KEY || env.DEEPSEEK_API_KEYS || '';
        _deepSeekPool = new KeyPool(raw);
    }
    return _deepSeekPool;
}
export function getOpenAiPool() {
    if (!_openAiPool) {
        const raw = process.env.OPENAI_API_KEYS || process.env.OPENAI_API_KEY || env.OPENAI_API_KEYS || '';
        _openAiPool = new KeyPool(raw);
    }
    return _openAiPool;
}

// ─── Provider caller ─────────────────────────────────────────────────────

async function tryProvider(providerName, pool, messages, temperature, maxTokens) {
    let lastErr = null;
    const attempts = pool.size || 1;

    for (let i = 0; i < attempts; i++) {
        const keyItem = pool.next();
        if (!keyItem) {
            console.warn(`[LLM] All ${providerName} keys are currently exhausted or cooling down.`);
            throw new Error(`ALL_KEYS_EXHAUSTED:${providerName}`);
        }
        const { key, index: keyIndex } = keyItem;
        const curRpm = keyItem.stats?.currentRpm ?? 1;
        const remDaily = keyItem.stats?.remainingDailyQuota ?? pool._rpdLimit;

        const startMs = Date.now();
        try {
            let res = null;
            let modelUsed = '';

            if (providerName === 'gemini') {
                modelUsed = env.GEMINI_MODEL || 'gemini-3.5-flash';
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

            const latencyMs = Date.now() - startMs;
            pool.recordSuccess(key, latencyMs);

            console.log(`[LLM] Success via ${providerName} #${keyIndex} (${modelUsed}) in ${latencyMs}ms | RPM: ${curRpm}/${pool._rpmLimit} | Rem Daily: ${remDaily} | tokens: ${res.usage?.totalTokens || 0}`);

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
            const isDaily = (err?.message || '').toLowerCase().includes('daily') || (err?.response?.data?.error?.message || '').toLowerCase().includes('daily');
            if (isQuotaOrServerError(err)) {
                const cooldownMs = isDaily ? 3600_000 : 60_000;
                pool.cooldown(key, cooldownMs);
                console.warn(`[LLM] ${providerName} rate/quota limit on key #${keyIndex} (${key.slice(0, 8)}...): ${err.message}. Auto-switching to next key with highest quota.`);
            } else {
                pool.cooldown(key, 20_000);
                console.warn(`[LLM] ${providerName} error on key #${keyIndex}: ${err.message}. Trying next available key.`);
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
