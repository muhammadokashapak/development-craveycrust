/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║   AI Context Interpreter & Action Planner                   ║
 * ║   src/services/aiContextInterpreter.js                       ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Core Principle:
 *   AI UNDERSTANDS FULL SENTENCES & MULTI-INTENTS.
 *   AI PLANS STRUCTURED ACTIONS (TOOL CALLS).
 *   BACKEND EXECUTES AUTHORITATIVELY AGAINST DATABASE.
 *   BACKEND RESPONDS GROUNDED IN TOOL RESULTS.
 */

import { routeLLM } from './llmRouter.js';
import { classifyCustomerIntent, INTENTS } from './intentRouter.js';

// ── Strict Intent Categories ──────────────────────────────────
export const INTENT_CATEGORIES = {
    // Informational & Catalogs
    VIEW_MENU: 'VIEW_MENU',
    VIEW_DEALS: 'VIEW_DEALS',
    VIEW_BOTH: 'VIEW_BOTH',
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

const SYSTEM_PROMPT = `You are the AI Understanding & Action Planning Engine for Cravey Crust fast food ordering system on WhatsApp.

Your task is to analyze the complete incoming customer message in Roman Urdu / Urdu / English, understand all intents, and output a structured JSON Action Plan.

AVAILABLE BACKEND TOOLS (select 1 or more actions in the "actions" array):
1. "get_menu" — args: { "category"?: string } (when customer wants to see menu)
2. "get_deals" — args: { "dealType"?: "all" | "burger" | "pizza" } (when customer wants to see deals)
3. "get_deal_details" — args: { "dealName": string } (when customer asks what is included in a specific deal, e.g. "Deal 3 mein drink included hai?")
4. "get_product_details" — args: { "queryType": "cheapest" | "best" | "zinger" | "burger" | "pizza", "query"?: string }
5. "add_to_cart" — args: { "itemName": string, "quantity"?: number, "size"?: string }
6. "remove_from_cart" — args: { "itemName": string, "quantity"?: number }
7. "get_cart" — args: {} (when customer asks what is in their cart or total bill)
8. "update_customer_details" — args: { "name"?: string, "phone"?: string, "address"?: string, "paymentMethod"?: "COD" | "EASYPAISA" }
9. "validate_delivery_location" — args: { "address": string }
10. "confirm_order" — args: {} (when customer explicitly confirms: "haan", "confirm", "theek hai order book kr do")
11. "get_order_status" — args: { "orderNumber"?: string } (when customer asks "order show kro" or "mera order kahan hai")
12. "request_order_cancellation" — args: {} (when customer wants to cancel an existing order)

CRITICAL SENTENCE UNDERSTANDING RULES:
1. Multi-Intent Handling:
   - "Deals or menu dikhao" / "deals aur menu dono bhejo" / "dono bhejo": Customer wants BOTH catalogs! Return TWO actions:
     "actions": [{ "tool": "get_menu", "args": {} }, { "tool": "get_deals", "args": {} }], "intent": "VIEW_BOTH"
   - "Deals bhejo" / "deals dikhao" / "deals": Customer wants deals catalog:
     "actions": [{ "tool": "get_deals", "args": {} }], "intent": "VIEW_DEALS"
   - "Menu bhejo" / "menu dikhao" / "menu": Customer wants menu catalog:
     "actions": [{ "tool": "get_menu", "args": {} }], "intent": "VIEW_MENU"
2. Informational Questions vs. Adding Items:
   - "Deal 3 mein drink included hai ya nahi?" / "is deal mein kya kya hai": Customer is ASKING INFORMATION, NOT ordering!
     "actions": [{ "tool": "get_deal_details", "args": { "dealName": "Deal 3" } }], "intent": "DEAL_QUERY"
   - NEVER call add_to_cart for questions about a deal or item!
3. Multiple Items in One Message:
   - "Aik deal 3 krdo aur aik burger meal for 3 bhi add krdo": Return TWO add_to_cart actions:
     "actions": [
       { "tool": "add_to_cart", "args": { "itemName": "Deal 3", "quantity": 1 } },
       { "tool": "add_to_cart", "args": { "itemName": "Burger Meal For 3", "quantity": 1 } }
     ]
4. Item Removal:
   - "drink ko remove kr do" / "remove 1 soft drink":
     "actions": [{ "tool": "remove_from_cart", "args": { "itemName": "drink", "quantity": 1 } }], "intent": "REMOVE_ITEM"
5. Menu Inquiries:
   - "sb sa low level price wla item bato" / "cheapest item": "actions": [{ "tool": "get_product_details", "args": { "queryType": "cheapest" } }]
   - "best item konsa hai" / "top item": "actions": [{ "tool": "get_product_details", "args": { "queryType": "best" } }]
   - "kon kon sa zinger hain": "actions": [{ "tool": "get_product_details", "args": { "queryType": "zinger" } }]
   - "kon kon sa burgers hain": "actions": [{ "tool": "get_product_details", "args": { "queryType": "burger" } }]
   - "pizza name batoo kon kon sa hain": "actions": [{ "tool": "get_product_details", "args": { "queryType": "pizza" } }]
6. Ordering Any Item (including unavailable/off-menu items):
   - When customer says "chahiye", "chiye", "mangwana", "bhej do", "kar do", "add" for ANY food item (e.g. "Anda wla burger chiye mujay", "biryani chahiye", "fish burger kar do"):
     ALWAYS return an "add_to_cart" action with the exact item requested:
     "actions": [{ "tool": "add_to_cart", "args": { "itemName": "Anda wla burger", "quantity": 1 } }], "intent": "ADD_ITEM"
     The backend tool will authoritatively check the menu and clearly report if it is not available.
7. Order Confirmation:
   - "haan" / "confirm" / "theek hai book kardo": "actions": [{ "tool": "confirm_order", "args": {} }], "intent": "CONFIRM_ORDER"
8. Delivery Address Update:
   - "location change kr do Xortlogix, Ghauri VIP Block" / "address update kardo street 5" / "pata badal do":
     Extract the updated address without resetting other customer details:
     "actions": [{ "tool": "update_customer_details", "args": { "address": "Xortlogix, Ghauri VIP Block" } }], "intent": "UPDATE_CUSTOMER_DETAILS"

OUTPUT FORMAT: Respond ONLY with valid raw JSON. No markdown code blocks, no explanation text:
{
  "reasoning": "<1 sentence explanation of customer intent>",
  "intent": "<ONE_OF_INTENT_CATEGORIES>",
  "confidence": <number 0.0 to 1.0>,
  "actions": [
    { "tool": "<tool_name>", "args": { ... } }
  ],
  "referenced_entity": {
    "type": "deal" | "item" | "none",
    "name": "<name of deal or item or null>"
  },
  "entities": {
    "product_name": "<string or null>",
    "quantity": <number or null>,
    "size": "<string or null>",
    "customer_name": "<string or null>",
    "phone": "<string or null>",
    "address": "<string or null>",
    "payment_method": "<COD | EASYPAISA | null>"
  },
  "customer_confirmation": <true | false>
}`;

/**
 * Clean and parse LLM output into validated JSON Action Plan
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

        const rawActions = Array.isArray(parsed.actions) ? parsed.actions : [];
        const actions = rawActions.map(a => {
            if (a && typeof a === 'object' && a.tool) {
                return {
                    tool: String(a.tool).trim(),
                    args: a.args && typeof a.args === 'object' ? a.args : {},
                };
            }
            return null;
        }).filter(Boolean);

        return {
            reasoning: parsed.reasoning || '',
            intent: parsed.intent || 'GENERAL_CONVERSATION',
            confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.9,
            actions,
            referenced_entity: {
                type: parsed.referenced_entity?.type || 'none',
                name: parsed.referenced_entity?.name || null,
                id: null,
            },
            entities: {
                product_name: parsed.entities?.product_name || null,
                quantity: parsed.entities?.quantity ? Number(parsed.entities.quantity) : 1,
                size: parsed.entities?.size || null,
                customer_name: parsed.entities?.customer_name || null,
                phone: parsed.entities?.phone || null,
                address: parsed.entities?.address || null,
                payment_method: parsed.entities?.payment_method || null,
            },
            operation: parsed.operation || 'READ_ONLY',
            customer_confirmation: Boolean(parsed.customer_confirmation),
        };
    } catch (_) {
        return null;
    }
}

/**
 * Fallback deterministic interpretation when LLM is offline
 */
function fallbackDeterministicInterpretation(text, sessionDetails, orderStage) {
    const lower = (text || '').toLowerCase().trim();

    // 1. Check for Both Menu & Deals
    const isBoth = (
        (/\b(?:menu|manu|card|catalog)\b/i.test(lower) && /\b(?:deals?|combos?)\b/i.test(lower)) ||
        /\b(?:menu\s*(?:aur|and|or|&|\+)\s*deals?|deals?\s*(?:aur|and|or|&|\+)\s*menu|dono)\b/i.test(lower)
    );
    if (isBoth) {
        return {
            reasoning: 'Fallback detected request for both menu and deals',
            intent: 'VIEW_BOTH',
            confidence: 0.95,
            actions: [
                { tool: 'get_menu', args: {} },
                { tool: 'get_deals', args: {} },
            ],
            referenced_entity: { type: 'none', name: null },
            entities: {},
            operation: 'READ_ONLY',
            customer_confirmation: false,
        };
    }

    // 2. Check for Deals
    if (/\b(?:deals?|combos?|packages?)\b/i.test(lower) && !/\b(?:add|order\s*\d|cart)\b/i.test(lower)) {
        return {
            reasoning: 'Fallback detected request for deals',
            intent: 'VIEW_DEALS',
            confidence: 0.95,
            actions: [{ tool: 'get_deals', args: {} }],
            referenced_entity: { type: 'deal', name: 'Deals' },
            entities: {},
            operation: 'READ_ONLY',
            customer_confirmation: false,
        };
    }

    // 3. Check for Menu
    if (/\b(?:menu|card|catalog)\b/i.test(lower) && !/\b(?:add|order\s*\d|cart)\b/i.test(lower)) {
        return {
            reasoning: 'Fallback detected request for menu',
            intent: 'VIEW_MENU',
            confidence: 0.95,
            actions: [{ tool: 'get_menu', args: {} }],
            referenced_entity: { type: 'none', name: null },
            entities: {},
            operation: 'READ_ONLY',
            customer_confirmation: false,
        };
    }

    // 4. Default intent classification
    const parsed = classifyCustomerIntent(text, { orderStage });
    const actions = [];

    if (parsed.intent === 'ADD_ITEM') {
        actions.push({
            tool: 'add_to_cart',
            args: { itemName: parsed.referencedTopic || text, quantity: 1 },
        });
    } else if (parsed.intent === 'REMOVE_ITEM') {
        actions.push({
            tool: 'remove_from_cart',
            args: { itemName: parsed.referencedTopic || text },
        });
    } else if (parsed.intent === 'CONFIRM_ORDER') {
        actions.push({ tool: 'confirm_order', args: {} });
    }

    return {
        reasoning: 'Fallback deterministic intent classification',
        intent: parsed.intent || 'GENERAL_CONVERSATION',
        confidence: 0.85,
        actions,
        referenced_entity: {
            type: parsed.referencedTopic ? 'item' : 'none',
            name: parsed.referencedTopic || null,
        },
        entities: {
            product_name: parsed.referencedTopic || null,
            quantity: 1,
            customer_name: sessionDetails?.name || null,
            phone: sessionDetails?.phone || null,
            address: sessionDetails?.address || null,
            payment_method: sessionDetails?.paymentMethod || null,
        },
        operation: parsed.isModification ? 'ADD' : 'READ_ONLY',
        customer_confirmation: parsed.intent === 'CONFIRM_ORDER',
    };
}

/**
 * Interpret customer message using lightweight AI Context Understanding & Action Planning
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
        `ACTIVE CART: ${activeCartSummary || 'Cart is empty'}`,
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
            content: `CONTEXT:\n${compactContext}\n\nCUSTOMER MESSAGE: "${text}"\n\nReturn structured JSON Action Plan:`,
        },
    ];

    try {
        const response = await routeLLM(messages, {
            temperature: 0.0,
            maxTokens: 512,
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
