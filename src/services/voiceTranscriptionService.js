/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║   Voice Transcription Service                               ║
 * ║   src/services/voiceTranscriptionService.js                 ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Converts WhatsApp voice notes (PTT / audio clips) into text
 * using Google Gemini 1.5 Flash (with key rotation & fallback).
 * High accuracy for Roman Urdu, Urdu, English & Punjabi food orders.
 *
 * Fallback to OpenAI Whisper if OpenAI keys are configured.
 */

import axios from 'axios';
import { env } from '../config/env.js';
import { getGeminiPool, getOpenAiPool } from './llmRouter.js';

const SYSTEM_TRANSCRIPTION_PROMPT = `You are an expert audio transcriber for a Pakistani restaurant WhatsApp ordering bot.
Your task is to transcribe the spoken voice note accurately into text.

Guidelines:
1. Return ONLY the spoken words as text. Do NOT add notes, explanations, timestamps, quotes, or conversational replies.
2. The user is usually speaking Roman Urdu (Urdu written in English script), Urdu, English, or Punjabi. Transcribe the speech naturally in Roman Urdu (e.g. "ek large fajita pizza aur do regular cold drink bhej dein", "bhai menu share karein", "mera order kahan tak pohncha").
3. If the user speaks in English, transcribe in English.
4. If the audio is completely silent, only background noise, or unintelligible gibberish, return an empty string.`;

/**
 * Clean MIME type for Google Gemini / OpenAI (strip charset and codecs)
 */
function normalizeAudioMimeType(rawMime) {
    if (!rawMime || typeof rawMime !== 'string') return 'audio/ogg';
    const base = rawMime.split(';')[0].trim().toLowerCase();
    if (base === 'audio/opus') return 'audio/ogg';
    if (base === 'audio/mp4' || base === 'audio/m4a') return 'audio/mp4';
    if (base === 'audio/mpeg' || base === 'audio/mp3') return 'audio/mp3';
    if (base === 'audio/wav' || base === 'audio/x-wav') return 'audio/wav';
    if (base === 'audio/aac') return 'audio/aac';
    return base || 'audio/ogg';
}

/**
 * Sanitize and clean transcribed output string
 */
function cleanTranscriptionText(rawText) {
    if (!rawText || typeof rawText !== 'string') return '';
    let text = rawText.trim();

    // Strip markdown codeblocks e.g. ```text ... ```
    text = text.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/i, '').trim();

    // Strip common AI prefixes
    text = text.replace(/^(transcription|transcript|audio text|spoken text|message|customer|user):\s*/i, '').trim();

    // Strip surrounding quotes
    text = text.replace(/^["'“](.*)["'”]$/, '$1').trim();

    // Check if it's an AI refusal / empty announcement
    const emptyIndicators = [
        /^(inaudible|unintelligible|silent|silence|none|n\/a|no speech|background noise)$/i,
        /^(there is no audible speech|the audio is silent|no clear speech)/i,
    ];
    for (const pattern of emptyIndicators) {
        if (pattern.test(text)) return '';
    }

    return text;
}

/**
 * Transcribe audio using Google Gemini native API with base64 inline audio.
 */
async function transcribeWithGemini(audioBuffer, mimeType) {
    const geminiPool = getGeminiPool();
    if (!geminiPool || geminiPool.size === 0) {
        throw new Error('NO_GEMINI_KEYS');
    }

    const cleanMime = normalizeAudioMimeType(mimeType);
    const base64Audio = audioBuffer.toString('base64');
    const preferredModel = env.GEMINI_MODEL || 'gemini-1.5-flash';
    const candidateModels = [preferredModel, 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash-latest'];

    // Deduplicate candidate models
    const uniqueModels = [...new Set(candidateModels)];

    let lastError = null;
    const attempts = geminiPool.size || 1;

    for (let i = 0; i < attempts; i++) {
        const keyItem = geminiPool.next();
        if (!keyItem) break;
        const { key, index: keyIndex } = keyItem;

        for (const model of uniqueModels) {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
            try {
                const response = await axios.post(url, {
                    contents: [
                        {
                            role: 'user',
                            parts: [
                                {
                                    inlineData: {
                                        mimeType: cleanMime,
                                        data: base64Audio,
                                    }
                                },
                                {
                                    text: SYSTEM_TRANSCRIPTION_PROMPT,
                                }
                            ]
                        }
                    ],
                    generationConfig: {
                        temperature: 0.1,
                        maxOutputTokens: 500,
                    }
                }, {
                    headers: { 'Content-Type': 'application/json' },
                    timeout: 25_000,
                });

                const cand = response.data?.candidates?.[0];
                const rawContent = cand?.content?.parts?.map(p => p.text || '').join('') || '';
                const cleaned = cleanTranscriptionText(rawContent);

                console.log(`[VOICE] Gemini (${model}) transcription success on key #${keyIndex}: "${cleaned}"`);
                return {
                    text: cleaned,
                    provider: 'gemini',
                    model,
                    keyIndex,
                };
            } catch (err) {
                lastError = err;
                const status = err.response?.status;
                const errMsg = err.response?.data?.error?.message || err.message;

                // 404 or unsupported model for audio -> try next model in candidate list
                if (status === 404 || errMsg.toLowerCase().includes('not found') || errMsg.toLowerCase().includes('not supported')) {
                    console.warn(`[VOICE] Model ${model} not available or does not support audio (${status}): ${errMsg}. Trying next model.`);
                    continue;
                }

                // 429 or quota limit -> cool down key and break to next key
                if (status === 429 || status === 503 || errMsg.toLowerCase().includes('quota') || errMsg.toLowerCase().includes('resource_exhausted')) {
                    geminiPool.cooldown(key, 90_000);
                    console.warn(`[VOICE] Gemini key #${keyIndex} rate-limited/exhausted (${status}). Trying next key.`);
                    break; // try next key
                }

                console.warn(`[VOICE] Gemini error on key #${keyIndex} with model ${model}: ${errMsg}`);
                // If bad request (e.g. invalid audio format), don't loop endlessly across all keys
                if (status === 400) {
                    throw err;
                }
                break;
            }
        }
    }

    throw lastError || new Error('All Gemini keys failed for voice transcription.');
}

/**
 * Transcribe audio using OpenAI Whisper API (as secondary fallback)
 */
async function transcribeWithOpenAI(audioBuffer, mimeType) {
    const openAiPool = getOpenAiPool();
    if (!openAiPool || openAiPool.size === 0) {
        throw new Error('NO_OPENAI_KEYS');
    }

    const keyItem = openAiPool.next();
    if (!keyItem) throw new Error('ALL_OPENAI_KEYS_COOLDOWN');
    const { key, index: keyIndex } = keyItem;

    const cleanMime = normalizeAudioMimeType(mimeType);
    const ext = cleanMime.includes('mp4') || cleanMime.includes('m4a') ? 'm4a' : (cleanMime.includes('mp3') ? 'mp3' : 'ogg');

    const formData = new FormData();
    const fileBlob = new Blob([audioBuffer], { type: cleanMime });
    formData.append('file', fileBlob, `voice_note.${ext}`);
    formData.append('model', 'whisper-1');
    formData.append('prompt', 'Pakistani restaurant food order in Roman Urdu or English');

    const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, {
        headers: {
            'Authorization': `Bearer ${key}`,
        },
        timeout: 30_000,
    });

    const rawContent = response.data?.text || '';
    const cleaned = cleanTranscriptionText(rawContent);

    console.log(`[VOICE] OpenAI Whisper transcription success on key #${keyIndex}: "${cleaned}"`);
    return {
        text: cleaned,
        provider: 'openai',
        model: 'whisper-1',
        keyIndex,
    };
}

/**
 * Main export: Transcribe a WhatsApp audio buffer.
 *
 * @param {Buffer} audioBuffer
 * @param {string} [mimeType]
 * @returns {Promise<{success: boolean, text?: string, provider?: string, inaudible?: boolean, error?: string, userFriendlyError?: string}>}
 */
export async function transcribeVoiceNote(audioBuffer, mimeType) {
    if (!audioBuffer || audioBuffer.length === 0) {
        return {
            success: false,
            inaudible: true,
            error: 'EMPTY_AUDIO',
            userFriendlyError: 'Mafi chahta hoon, voice note khali thi. Baraye meharbani dobara bolein.',
        };
    }

    // Guard against excessively large audio files (> 15 MB)
    if (audioBuffer.length > 15 * 1024 * 1024) {
        return {
            success: false,
            error: 'AUDIO_TOO_LARGE',
            userFriendlyError: 'Mafi chahta hoon, yeh audio file bohat lambi hai. Baraye meharbani choti voice note bhejein.',
        };
    }

    // Try Gemini first
    try {
        const geminiRes = await transcribeWithGemini(audioBuffer, mimeType);
        if (geminiRes?.text) {
            return {
                success: true,
                text: geminiRes.text,
                provider: geminiRes.provider,
                model: geminiRes.model,
            };
        } else {
            // Audio was audible to API but returned empty text (silence or noise)
            return {
                success: false,
                inaudible: true,
                error: 'INAUDIBLE_SPEECH',
                userFriendlyError: 'Mafi chahta hoon, aapki voice note wazeh nahi thi. Baraye meharbani dobara bolein ya text likh kar bhej dein. 🙏',
            };
        }
    } catch (geminiErr) {
        console.warn(`[VOICE] Gemini transcription failed (${geminiErr.message}) — attempting OpenAI Whisper fallback...`);
    }

    // Fallback to OpenAI Whisper if configured
    try {
        const openAiRes = await transcribeWithOpenAI(audioBuffer, mimeType);
        if (openAiRes?.text) {
            return {
                success: true,
                text: openAiRes.text,
                provider: openAiRes.provider,
                model: openAiRes.model,
            };
        } else {
            return {
                success: false,
                inaudible: true,
                error: 'INAUDIBLE_SPEECH',
                userFriendlyError: 'Mafi chahta hoon, aapki voice note wazeh nahi thi. Baraye meharbani dobara bolein ya text likh kar bhej dein. 🙏',
            };
        }
    } catch (openAiErr) {
        console.warn(`[VOICE] OpenAI Whisper fallback also unavailable or failed: ${openAiErr.message}`);
    }

    // Both providers failed or no API keys configured
    const noKeys = (getGeminiPool().size === 0 && getOpenAiPool().size === 0);
    return {
        success: false,
        error: noKeys ? 'NO_API_KEYS_CONFIGURED' : 'TRANSCRIPTION_FAILED',
        userFriendlyError: noKeys
            ? 'Aap ki voice note mili hai! 🎙️ Baraye meharbani voice message ki bajaye text likh kar bhejein taake aap ka order foran process ho sake. 🙏\n(Aap "menu" ya "deals" likh kar dekh sakte hain)'
            : 'Mafi chahta hoon, voice note process karne mein masla hua. Baraye meharbani dobara bolein ya text likh kar bhej dein. 🙏',
    };
}

export default transcribeVoiceNote;
