/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║   AI Context Interpreter — src/services/aiContextInterpreter.js ║
 * ║   AI for Natural Language Understanding & Context ONLY      ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Core Principle:
 *   AI UNDERSTANDS.
 *   BACKEND THINKS AND DECIDES.
 *   BACKEND EXECUTES.
 *   BACKEND VALIDATES.
 *   BACKEND RESPONDS.
 *
 * The AI is NEVER given tools. It NEVER directly modifies the database,
 * alters carts, or generates customer-facing messages.
 * It ONLY outputs structured JSON representing customer intent, referenced
 * entities, operations, and conversational context.
 */

import { routeLLM } from './llmRouter.js';
import { classifyCustomerIntent, INTENTS } from './intentRouter.js';

// ── Strict Intent Categories (Section 4) ──────────────────────────────────
export const INTENT_CATEGORIES = {
    // Informational
    MENU_QUERY: 'MENU_QUERY',
    DEAL_QUERY: 'DEAL_QUERY',
    PRODUCT_QUERY: 'PRODUCT_QUERY',
    CART_QUERY: 'CART_QUERY',
    PRICE_QUERY: 'PRICE_QUERY',
    DELIVERY_QUERY: 'DELIVERY_QUERY',
    PAYMENT_QUERY: 'PAYMENT_QUERY',
    ORDER_STATUS_QUERY: 'ORDER_STATUS_QUERY',

    // Cart Operations
    ADD_ITEM: 'ADD_ITEM',
    REMOVE_ITEM: 'REMOVE_ITEM',
    UPDATE_ITEM: 'UPDATE_ITEM',
    PRESERVE_CURRENT_SELECTION: 'PRESERVE_CURRENT_SELECTION',

    // Customer Information
    PROVIDE_NAME: 'PROVIDE_NAME',
    PROVIDE_PHONE: 'PROVIDE_PHONE',
    PROVIDE_ADDRESS: 'PROVIDE_ADDRESS',
    UPDATE_CUSTOMER_DETAILS: 'UPDATE_CUSTOMER_DETAILS',

    // Order Operations
    FINISH_ITEM_SELECTION: 'FINISH_ITEM_SELECTION',
    CONFIRM_ORDER: 'CONFIRM_ORDER',
    CANCEL_ORDER: 'CANCEL_ORDER',
    REQUEST_ORDER_MODIFICATION: 'REQUEST_ORDER_MODIFICATION',

    // Conversational
    GREETING: 'GREETING',
    ACKNOWLEDGEMENT: 'ACKNOWLEDGEMENT',
    CLARIFICATION_RESPONSE: 'CLARIFICATION_RESPONSE',
    CORRECTION: 'CORRECTION',
    REFER_TO_PREVIOUS_INFORMATION: 'REFER_TO_PREVIOUS_INFORMATION',
    GENERAL_CONVERSATION: 'GENERAL_CONVERSATION',

    // Unknown
    UNKNOWN_INTENT: 'UNKNOWN_INTENT',
    AMBIGUOUS_INTENT: 'AMBIGUOUS_INTENT',
};

const SYSTEM_PROMPT = `You are the Roman Urdu Context & Intent Interpreter for Cravey Crust fast food ordering system.

Your SOLE task is to analyze the incoming customer message in Roman Urdu/Urdu/English and return a structured JSON object representing their intent, referenced entities, and context.

CRITICAL RULES:
1. Respond ONLY with valid raw JSON. No explanations, no markdown code blocks, no conversational text.
2. NEVER generate customer-facing messages or replies.
3. NEVER generate executable tool calls or function names.
4. Do NOT invent database IDs, prices, or customer details. Use null for unknown values.
5. Context Understanding Rules:
   - "Is mein drink included hai?" / "konsi drink hai": intent = "DEAL_QUERY", operation = "READ_ONLY", context_reference = "CURRENT_CART_ITEM".
   - "Aik aur drink kar do" / "extra drink add kr do": intent = "ADD_ITEM", operation = "ADD", entities.product_name = "Soft Drink".
   - "Wohi deal dobara add kar do": intent = "ADD_ITEM", operation = "ADD", context_reference = "PREVIOUS_INFO".
   - "Nahi yehi rahy ga" / "same rehne do": intent = "PRESERVE_CURRENT_SELECTION", operation = "NO_CHANGE".
   - "Bataya to tha" / "pehle bataya tha": intent = "REFER_TO_PREVIOUS_INFORMATION", operation = "READ_ONLY".
   - "Haan confirm kar do" / "haan kardo": intent = "CONFIRM_ORDER", customer_confirmation = true.
   - If customer shares an address or location: intent = "PROVIDE_ADDRESS", entities.address = "<extracted address>".
   - If customer states their name: intent = "PROVIDE_NAME", entities.customer_name = "<extracted name>".
   - If customer chooses payment ("Cash" / "COD" / "EasyPaisa"): intent = "PAYMENT_QUERY", entities.payment_method = "COD" | "EASYPAISA".

REQUIRED JSON SCHEMA:
{
  "intent": "<ONE_OF_INTENT_CATEGORIES>",
  "confidence": <number between 0.0 and 1.0>,
  "referenced_entity": {
    "type": "deal" | "item" | "none",
    "name": "<name of deal or item referenced or null>",
    "id": null
  },
  "entities": {
    "product_name": "<string or null>",
    "quantity": <number or null>,
    "size": "<string or null>",
    "flavour": "<string or null>",
    "customer_name": "<string or null>",
    "phone": "<string or null>",
    "address": "<string or null>",
    "payment_method": "<COD | EASYPAISA | null>"
  },
  "operation": "ADD" | "REMOVE" | "UPDATE" | "READ_ONLY" | "NO_CHANGE" | "CONFIRM",
  "context_reference": "CURRENT_CART_ITEM" | "PREVIOUS_INFO" | "NONE",
  "customer_confirmation": <true | false>,
  "ambiguity": <true | false>,
  "clarification_required": <true | false>,
  "clarification_reason": "<string or null>"
}`;

/**
 * Clean and parse LLM output into validated JSON
 */
function parseAndValidateJson(raw) {
    if (!raw || typeof raw !== 'string') return null;
    let cleaned = raw.trim();

    // Strip markdown code fences if present
    if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    }

    try {
        const parsed = JSON.parse(cleaned);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

        // Ensure basic schema fields exist
        return {
            intent: parsed.intent || 'GENERAL_CONVERSATION',
            confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.9,
            referenced_entity: {
                type: parsed.referenced_entity?.type || 'none',
                name: parsed.referenced_entity?.name || null,
                id: null,
            },
            entities: {
                product_name: parsed.entities?.product_name || null,
                quantity: parsed.entities?.quantity ? Number(parsed.entities.quantity) : 1,
                size: parsed.entities?.size || null,
                flavour: parsed.entities?.flavour || null,
                customer_name: parsed.entities?.customer_name || null,
                phone: parsed.entities?.phone || null,
                address: parsed.entities?.address || null,
                payment_method: parsed.entities?.payment_method || null,
            },
            operation: parsed.operation || 'READ_ONLY',
            context_reference: parsed.context_reference || 'NONE',
            customer_confirmation: Boolean(parsed.customer_confirmation),
            ambiguity: Boolean(parsed.ambiguity),
            clarification_required: Boolean(parsed.clarification_required),
            clarification_reason: parsed.clarification_reason || null,
        };
    } catch (_) {
        return null;
    }
}

/**
 * Fallback deterministic interpretation when LLM is unavailable or unparseable
 */
function fallbackDeterministicInterpretation(text, sessionDetails, orderStage) {
    const parsed = classifyCustomerIntent(text, { orderStage });
    return {
        intent: parsed.intent || 'GENERAL_CONVERSATION',
        confidence: 0.85,
        referenced_entity: {
            type: parsed.referencedTopic ? 'item' : 'none',
            name: parsed.referencedTopic || null,
            id: null,
        },
        entities: {
            product_name: parsed.referencedTopic || null,
            quantity: 1,
            size: null,
            flavour: null,
            customer_name: sessionDetails?.name || null,
            phone: sessionDetails?.phone || null,
            address: sessionDetails?.address || null,
            payment_method: sessionDetails?.paymentMethod || null,
        },
        operation: parsed.isModification ? 'ADD' : 'READ_ONLY',
        context_reference: parsed.referencedTopic ? 'CURRENT_CART_ITEM' : 'NONE',
        customer_confirmation: false,
        ambiguity: false,
        clarification_required: false,
        clarification_reason: null,
    };
}

/**
 * Interpret customer message using lightweight AI Context Understanding
 *
 * @param {Object} params
 * @param {string} params.text - Customer incoming message
 * @param {string} params.orderStage - Current checkout state machine stage
 * @param {Object} params.sessionDetails - Known customer details (name, phone, address, payment)
 * @param {string} params.activeCartSummary - Current cart text representation
 * @param {Array} params.recentHistory - Last 2-3 conversation turns
 * @returns {Promise<{ context: Object, tokenUsage: Object, providerInfo: Object }>}
 */
export async function interpretCustomerContext({
    text,
    orderStage = 'CART_BUILDING',
    sessionDetails = {},
    activeCartSummary = '',
    recentHistory = [],
}) {
    const compactContext = [
        `CURRENT ORDER STAGE: ${orderStage}`,
        `KNOWN CUSTOMER: Name=${sessionDetails.name || 'Unknown'}, Phone=${sessionDetails.phone || 'Unknown'}, Address=${sessionDetails.address || 'Unknown'}, Payment=${sessionDetails.paymentMethod || 'Unknown'}`,
        `ACTIVE CART / DEAL: ${activeCartSummary || 'Cart is empty'}`,
    ].join('\n');

    const historyMessages = (recentHistory || []).slice(-3).map(h => ({
        role: h.role === 'assistant' ? 'assistant' : 'user',
        content: String(h.content || '').slice(0, 200),
    }));

    const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...historyMessages,
        {
            role: 'user',
            content: `CONTEXT:\n${compactContext}\n\nCUSTOMER MESSAGE: "${text}"\n\nReturn structured JSON:`,
        },
    ];

    try {
        const response = await routeLLM(messages, {
            temperature: 0.0,
            maxTokens: 256,
        });

        const rawContent = response?.content || '';
        const validated = parseAndValidateJson(rawContent);

        if (validated) {
            return {
                context: validated,
                tokenUsage: response.usage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
                providerInfo: { provider: response.provider, model: response.model },
            };
        }
    } catch (err) {
        console.warn('[AI_INTERPRETER] AI Context Interpretation call failed:', err.message);
    }

    // Controlled fallback to deterministic rules without throwing
    const fallback = fallbackDeterministicInterpretation(text, sessionDetails, orderStage);
    return {
        context: fallback,
        tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        providerInfo: { provider: 'deterministic_fallback', model: 'native' },
    };
}
