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
import { getActivePromptTemplate } from '../config/systemPrompt.js';
import { RESPONSE_TEMPLATES } from './responseTemplates.js';

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

    // Conversational & Persona
    GREETING: 'GREETING',
    ACKNOWLEDGEMENT: 'ACKNOWLEDGEMENT',
    CLARIFICATION_RESPONSE: 'CLARIFICATION_RESPONSE',
    CORRECTION: 'CORRECTION',
    REFER_TO_PREVIOUS_INFORMATION: 'REFER_TO_PREVIOUS_INFORMATION',
    GENERAL_CONVERSATION: 'GENERAL_CONVERSATION',
    CUSTOM_DEAL_REQUEST: 'CUSTOM_DEAL_REQUEST',
    CHEAPEST_DEALS_QUERY: 'CHEAPEST_DEALS_QUERY',
    CHEAPEST_ITEMS_QUERY: 'CHEAPEST_ITEMS_QUERY',
    PERSONA_QUERY: 'PERSONA_QUERY',
    CLARIFICATION_QUERY: 'CLARIFICATION_QUERY',
    DECLINE_ORDERING: 'DECLINE_ORDERING',

    // Unknown
    UNKNOWN_INTENT: 'UNKNOWN_INTENT',
    AMBIGUOUS_INTENT: 'AMBIGUOUS_INTENT',
};

export function getSystemPrompt(storeName = 'Cravey Crust') {
    const customPrompt = getActivePromptTemplate().replace(/\{\{storeName\}\}|\$\{storeName\}/g, storeName || 'Cravey Crust');

    return `${customPrompt}

══════════════════════════════════════════════════════════════
STRUCTURED ACTION PLANNING & TOOL CALLING ENGINE
══════════════════════════════════════════════════════════════
Your task is to analyze the complete incoming customer message in Roman Urdu / Urdu / English, understand all intents, and output a structured JSON Action Plan.

AVAILABLE BACKEND TOOLS (select 1 or more actions in the "actions" array):
1. "get_menu" — args: { "category"?: string } (when customer wants to see menu)
2. "get_deals" — args: { "dealType"?: "all" | "burger" | "pizza" } (when customer wants to see deals)
3. "get_deal_details" — args: { "dealName": string } (when customer asks what is included in a specific deal, e.g. "Deal 3 mein drink included hai?")
4. "get_product_details" — args: { "queryType": "cheapest" | "best" | "zinger" | "burger" | "pizza", "query"?: string }
5. "add_to_cart" — args: { "itemName": string, "quantity"?: number, "size"?: string }
6. "update_cart_item" — args: { "itemName"?: string, "newSize"?: string, "newQuantity"?: number } (when customer modifies or corrects an item in cart, e.g. "large mein krdo", "quantity 2 krdo")
7. "remove_from_cart" — args: { "itemName": string, "quantity"?: number }
8. "get_cart" — args: {} (when customer asks what is in their cart or total bill)
9. "update_customer_details" — args: { "name"?: string, "phone"?: string, "address"?: string, "paymentMethod"?: "COD" | "EASYPAISA" }
10. "validate_delivery_location" — args: { "address": string }
11. "confirm_order" — args: {} (when customer explicitly confirms: "haan", "confirm", "theek hai order book kr do")
12. "get_order_status" — args: { "orderNumber"?: string } (when customer asks "order show kro" or "mera order kahan hai")
13. "request_order_cancellation" — args: {} (when customer wants to cancel an existing order)

CRITICAL SENTENCE UNDERSTANDING & DISAMBIGUATION RULES:
1. Multi-Intent Handling:
   - "Deals or menu dikhao" / "deals aur menu dono bhejo" / "dono bhejo": Customer wants BOTH catalogs! Return TWO actions:
     "actions": [{ "tool": "get_menu", "args": {} }, { "tool": "get_deals", "args": {} }], "intent": "VIEW_BOTH"
   - "Deals bhejo" / "deals dikhao" / "deals": Customer wants deals catalog:
     "actions": [{ "tool": "get_deals", "args": {} }], "intent": "VIEW_DEALS"
   - "Menu bhejo" / "menu dikhao" / "menu": Customer wants menu catalog:
     "actions": [{ "tool": "get_menu", "args": {} }], "intent": "VIEW_MENU"
2. Product Reference Disambiguation (Rule A):
   - Never identify a product using only one word or number when the complete customer message contains additional information!
   - Cravey Deals Catalog Reference:
     • Deal 1 = 2 Small Pizzas + 2 Reg Drinks
     • Deal 2 = 2 Medium Pizzas + 1L Drink
     • Deal 3 = 2 Large Pizzas + 1L/1.5L Drink (Pizza Deal 3)
     • Deal 4 = 4 Zegy Burgers
     • Deal 5 / Zinger Deal 3 = 3 Zinger Burgers + 1L Drink
   - "zinger meal for 3" / "3 zinger deal" / "zinger deal 3" / "3 zinger burger wali deal" refers to the 3-Zinger deal (Zinger Deal 3 / Deal 5). Call "add_to_cart" with "itemName": "Zinger Deal 3", NEVER Pizza Deal 3, and NEVER 1 single Zinger Burger!
   - "4 zeggy burgers" / "4 zeggy burger" / "4 zegy burger" / "4 zeggy burgers kr dain" / "4 zeggy burgers deal":
     Customer is ordering 4 Zegy Burgers! Call "add_to_cart" with "itemName": "Zegy Burger", "quantity": 4 (or "itemName": "Deal 4"). Cravey Crust Deal 4 is strictly 4 Zegy Burgers (Rs. 999), NEVER a pizza deal!
   - "Deal 3" / "Pizza deal 3" refers to Deal 3 (2 Large Pizzas). Call "add_to_cart" with "itemName": "Deal 3".
   - If customer orders both ("aik kam kro aik deal 3 kr do aur aik zinger meal for 3 kr do"), output TWO actions:
     "actions": [
       { "tool": "add_to_cart", "args": { "itemName": "Deal 3", "quantity": 1 } },
       { "tool": "add_to_cart", "args": { "itemName": "Zinger Deal 3", "quantity": 1 } }
     ]
3. Category-Level vs Unavailable Product Requests (Rule B):
   - When a customer says "Pizza add kro", "Burger dikhao", "Fries mangwani hain", "Cold drink bhi add krdo":
     A general category name is NOT an unavailable product. Call "add_to_cart" with "itemName": "Pizza" (or the requested category). The backend tool will retrieve actual available choices and guide the customer.
   - When a customer specifically asks for an unsupported or unavailable food item (e.g. "Anda burger", "Anda wala burger", "Egg burger", "Biryani", "Daal", "Fish", "Karahi"):
     Call "add_to_cart" with "itemName": "<exact item requested, e.g. 'Anda burger'>". The backend tool will authoritatively report that this item is not available in Cravey Crust's menu.
4. Mandatory Product Variations (Rule C):
   - Never assume product size without explicit rule. For pizzas, size is required (Small, Medium, Large). If a customer says "Chicken Tandori pizza add kro", call "add_to_cart" with "itemName": "Chicken Tandori pizza"; the backend will prompt for size before modifying the cart.
5. Correction and Modification Understanding (Rule D):
   - "Large mein krdo small nahi" / "Medium chahiye" / "Isko large krdo" / "Size change krdo" / "Quantity 2 krdo":
     Customer wants to MODIFY an existing item in cart! Do NOT call add_to_cart (which adds duplicates).
     Return "actions": [{ "tool": "update_cart_item", "args": { "newSize": "Large" } }], "intent": "UPDATE_ITEM"
6. Informational Questions vs. Adding Items:
   - "Deal 3 mein drink included hai ya nahi?" / "is deal mein kya kya hai": Customer is ASKING INFORMATION, NOT ordering!
     "actions": [{ "tool": "get_deal_details", "args": { "dealName": "Deal 3" } }], "intent": "DEAL_QUERY"
   - "Fries konsi hain" / "Good fries b hain" / "kon kon se burgers hain" / "zinger options": Customer is asking for options in a food category, NOT whole menu flyer!
     "actions": [{ "tool": "get_product_details", "args": { "query": "fries" } }], "intent": "PRODUCT_QUERY"
   - NEVER call add_to_cart for questions about a deal or item!
7. Greetings and Small Talk:
   - When the customer says "Hello", "Hi", "Salam", "AOA", "Burger Raja", "Kashii", "Kaise ho":
     Return "actions": [], "intent": "GREETING", "conversational_reply": "Assalam-o-Alaikum! Main Burger Raja, Cravey Crust ka AI assistant hoon. 😊 Cravey Crust mein aap ko Khush Aamdeed!\n\nAaj kya order karna chahenge?\n• Deals dekhne ke liye *\"deals\"* likhein.\n• Menu dekhne ke liye *\"menu\"* likhein."
   - STRICT VOCABULARY RULE: In Pakistani Roman Urdu, NEVER use Hindi words like "swagat", "namaste", or "dhanyawad". ALWAYS use Urdu words: use "Khush Aamdeed" for welcome, "Shukriya" for thanks, "Assalam-o-Alaikum" for greeting.
8. Delivery Address Update:
   - "location change kr do Xortlogix, Ghauri VIP Block" / "address update kardo street 5" / "pata badal do":
     Extract the updated address without resetting other customer details:
     "actions": [{ "tool": "update_customer_details", "args": { "address": "Xortlogix, Ghauri VIP Block" } }], "intent": "UPDATE_CUSTOMER_DETAILS"
9. Cart Item Removal (Direct Execution):
   - When customer says "Behari kebab remove kr dain" / "Zinger burger hata do" / "Deal 3 nikal do" / "Cold drink remove krdo":
     Customer is requesting removal of an item from cart!
     Call "remove_from_cart" with "itemName": "<item name requested, e.g. 'Behari Kebab Pizza' or 'Behari kebab'>".
     Never ask what they want to remove when they already named the item!
10. Follow-up Size Specification for Drinks / Items:
   - When the assistant previously asked for drink size (e.g. "Soft Drink ka kaunsa size add karun — Regular, Can, 1 Liter, ya 1.5 Liter?")
     and customer replies "Can kr dain 10" / "Cans kr dain" / "10 cans" / "1.5 liter kr do":
     Customer is specifying the size and quantity for Soft Drink!
     Call "add_to_cart" with "itemName": "Soft Drink", "variant": "Can", "quantity": 10 (or parsed count).
     Do NOT ask for size again! Do NOT loop or argue! Add directly to cart.
11. Multi-Product Orders in a Single Message:
   - When a customer orders multiple products in one message (e.g. "20x zinger burger aur 30x cold drinks 1.5 liter wali kr do", "15x chicken tandoori Party Size 20x Zeggy Burgers 50x Cold drinks kr do 1.5 liter wali", "2 zeggy burger aur 1 large fajita pizza kr do", "2 zinger burger, 1 regular fries aur 2 cold drink can kr do"):
     Output an "add_to_cart" action for EVERY product requested:
     "actions": [
       { "tool": "add_to_cart", "args": { "itemName": "Zinger Burger", "quantity": 20 } },
       { "tool": "add_to_cart", "args": { "itemName": "Soft Drink", "size": "1.5 Liter", "quantity": 30 } }
     ]
     NEVER drop, ignore, or skip any item requested by the customer!
12. Custom Deal Refusal (Strict Rule):
   - When a customer asks for a custom deal, e.g. "Apka kia mera liye custom deal bana skta ho?", "custom deal bana do", "apni marzi ki deal bana do", "deal customize ho sakti hai", "can you make a custom deal":
   - Custom deals are NOT supported. Do NOT call get_deals or get_menu, and do NOT send any flyers or images!
   - Return "actions": [], "intent": "CUSTOM_DEAL_REQUEST", "conversational_reply": "Maazrat! Cravey Crust mein custom deals banana possible nahi hai. 😔\\n\\nHamare paas sirf menu aur flyer mein mojood official fixed deals available hain.\\n\\n• Agar aap official deals dekhna chahte hain to *\"deals\"* likhein.\\n• Agar aap apni pasand ke items alag se mangwana chahein to bas un ke naam bata dein! 😊"
13. Cheapest Deals vs. Cheapest Items Queries (Pure Text Only, Zero Images):
   - When a customer asks for cheapest deals / sasti deal, e.g. "menue ma sa koi sastai deal batao", "sasti si deal batao", "koi sasti deal hai", "sab se sasti deal konsi hai":
   - Return "actions": [{ "tool": "get_product_details", "args": { "queryType": "cheapest_deals" } }], "intent": "CHEAPEST_DEALS_QUERY"
   - Do NOT send catalog flyers or images! Must be answered strictly in text with the cheapest deals list.
   - When a customer asks for cheapest items, e.g. "sasty items batao", "sab se sasta item kya hai":
   - Return "actions": [{ "tool": "get_product_details", "args": { "queryType": "cheapest" } }], "intent": "CHEAPEST_ITEMS_QUERY"
14. Persona Identity & Off-Topic Questions:
   - When a customer asks personal or out-of-scope questions, e.g. "What's your wife name", "biwi ka naam kya hai", "shaadi kab hui", "who are you", "tum kon ho", "aap kon ho", "robot ho ya insan":
   - Return "actions": [], "intent": "PERSONA_QUERY", "conversational_reply": "Main Cravey Crust ka AI ordering assistant Burger Raja hoon! 😊\\n\\nMera kaam aap ko Cravey Crust ke mazedaar pizzas, crispy burgers aur deals order karne mein madad karna hai. 🍕🍔\\n\\nAap aaj kya order karna chahenge?\\n• Deals dekhne ke liye *\"deals\"* likhein.\\n• Menu dekhne ke liye *\"menu\"* likhein."
   - When customer says standalone "What", "kya", "kia", "hein", "?":
   - Return "actions": [], "intent": "CLARIFICATION_QUERY", "conversational_reply": "Ji! Agar aap ko menu, deals ya kisi item ke bare mein maloomat chahiye ya order karna ho to bataein, main aap ki madad ke liye haazir hoon! 😊\\n\\n• Deals dekhne ke liye *\"deals\"* likhein.\\n• Menu dekhne ke liye *\"menu\"* likhein."

15. Customer Refusal / Decline / Cancellation:
   - When a customer says "Maazrat ma dobara order ni kar sakta", "nahi chahiye", "rehne do", "ab order nahi karna", "mood nahi hai", "cancel kar do cart":
   - The customer is explicitly declining or canceling their order attempt.
   - NEVER call get_menu, get_deals, or suggest ordering items!
   - Return "actions": [], "intent": "DECLINE_ORDERING", "conversational_reply": "Koi baat nahi! Agar aap ko kisi pareshani ka samna karna para to hum dil se maazrat-khwah hain. Agar aap ko kisi cheez mein madad chahiye ya human support se rabta karna ho to batayein. Cravey Crust aap ki khidmat ke liye hamesha haazir hai! 🙏"
16. Takeaway / Self-Pickup at Branch:
   - When customer says "Takeaway", "Self-pickup", "cravey crust per", "outlet se le loon ga", "counter se lena hai", "shop se le lenge":
   - The customer wants Takeaway / Self-Pickup at the Cravey Crust outlet.
   - Return "actions": [{ "tool": "update_customer_details", "args": { "address": "Takeaway / Self-Pickup (Outlet: Cravey Crust, Ghauri Town Phase 4B)" } }], "intent": "PROVIDE_ADDRESS", "entities": { "address": "Takeaway / Self-Pickup (Outlet: Cravey Crust, Ghauri Town Phase 4B)" }
17. Affirmative Phone Confirmation during Checkout:
   - When the assistant asked the customer to confirm their contact number (e.g. "Rabtay ke liye rider ko yahi WhatsApp number dein?"), and customer replies "Han", "Haan", "Ji", "G", "Theek hai", "Yes":
   - Customer is confirming their PHONE NUMBER, NOT placing the final order!
   - Return "actions": [{ "tool": "update_customer_details", "args": { "phone": "SAME_WHATSAPP" } }], "intent": "PROVIDE_PHONE"
   - NEVER call "confirm_order" until ALL details (Name, Phone, Delivery Address/Takeaway, Payment Method) are completed!
18. Full Sentence Reading & Negation Safety:
   - ALWAYS read the ENTIRE customer message. NEVER extract keywords out of context.
   - If there is a negation word ("ni", "nahi", "nahin", "nhi", "mat", "not", "ni kar sakta"), interpret the sentence as a negative intent or refusal!

OUTPUT FORMAT: Respond ONLY with valid raw JSON. No markdown code blocks, no explanation text:
{
  "reasoning": "<1 sentence explanation of customer intent>",
  "intent": "<ONE_OF_INTENT_CATEGORIES>",
  "confidence": <number 0.0 to 1.0>,
  "actions": [
    { "tool": "<tool_name>", "args": { ... } }
  ],
  "conversational_reply": "<direct conversational reply if greeting or chitchat, otherwise null>",
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
}

export const SYSTEM_PROMPT = getSystemPrompt();

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
            conversational_reply: typeof parsed.conversational_reply === 'string' ? parsed.conversational_reply.trim() : null,
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

    // 0. Check Customer Refusal / Decline / Cancellation
    const isRefusalOrDecline = /\b(?:dobara\s*order\s*(?:ni|nahi|nahin|nhi|mat)\s*(?:kr|kar)\s*sakta|order\s*(?:ni|nahi|nahin|nhi|mat)\s*(?:krna|karna|kar\s*sakta|kr\s*sakta)|nahi\s*chahiye|rehne\s*do|ab\s*nahi\s*mangwana|mood\s*nahi\s*hai|cancel\s*(?:kr|kar)\s*do|nahi\s*order\s*karna)\b/i.test(lower) ||
        (/^(?:nahi|nahin|na|no|never|cancel)[\s.!?]*$/i.test(lower) && (orderStage === 'AWAITING_CONFIRMATION' || orderStage === 'DELIVERY_VALIDATION'));
    if (isRefusalOrDecline) {
        return {
            reasoning: 'Fallback detected customer refusal or ordering cancellation',
            intent: 'DECLINE_ORDERING',
            confidence: 0.98,
            actions: [{ tool: 'clear_cart', args: {} }],
            conversational_reply: 'Koi baat nahi! Agar aap ko kisi pareshani ka samna karna para to hum dil se maazrat-khwah hain. Agar aap ko kisi cheez mein madad chahiye ya human support se rabta karna ho to batayein. Cravey Crust aap ki khidmat ke liye hamesha haazir hai! 🙏',
            referenced_entity: { type: 'none', name: null },
            entities: {},
            operation: 'READ_ONLY',
            customer_confirmation: false,
        };
    }

    // 0-takeaway: Check Takeaway / Self-Pickup Selection
    const isTakeaway = /\b(?:takeaway|take\s*away|self[-\s]*pickup|pickup|pick\s*up|outlet\s*(?:se|pe|par|per)?|cravey\s*crust\s*(?:per|par|pe|se)|shop\s*se|counter\s*se)\b/i.test(lower);
    if (isTakeaway) {
        const takeawayAddr = 'Takeaway / Self-Pickup (Cravey Crust Outlet - Ghauri Town Phase 4B)';
        return {
            reasoning: 'Fallback detected takeaway / self-pickup selection',
            intent: 'PROVIDE_ADDRESS',
            confidence: 0.95,
            actions: [{ tool: 'update_customer_details', args: { address: takeawayAddr } }],
            referenced_entity: { type: 'none', name: null },
            entities: {
                address: takeawayAddr,
                customer_name: sessionDetails?.name || null,
                phone: sessionDetails?.phone || null,
            },
            operation: 'READ_ONLY',
            customer_confirmation: false,
        };
    }

    // 0-phone: Check phone affirmative confirmation during customer details stage
    if (orderStage === 'CUSTOMER_DETAILS' && sessionDetails?.name && !sessionDetails?.phoneConfirmed && /^(?:han|haan|jee|ji|g|yes|ok|theek\s*hai)[\s.!?]*$/i.test(lower)) {
        return {
            reasoning: 'Fallback detected customer confirming their phone number',
            intent: 'PROVIDE_PHONE',
            confidence: 0.95,
            actions: [{ tool: 'update_customer_details', args: { phone: 'SAME_WHATSAPP' } }],
            referenced_entity: { type: 'none', name: null },
            entities: { phone: sessionDetails?.phone || 'SAME_WHATSAPP' },
            operation: 'READ_ONLY',
            customer_confirmation: false,
        };
    }

    // 0a. Check Custom Deal Refusal
    const isCustomDeal = (
        /\b(?:custom(?:\s*ized)?\s*deals?|deal\s*customi[sz]e|apni\s*(?:marzi|taraf)\s*ki\s*deal|deal\s*bana\s*(?:do|skte|saktay|sakty|dain|dein|skta|sakte|den)|deal\s*(?:change|badal)\s*(?:kr|kar|ho)\s*(?:skti|sakti|do|saktay|sakty)|deal\s*mein\s*.*(?:ki\s*jagah|badle))\b/i.test(lower) ||
        (/\b(?:custom|customize|customized)\b/i.test(lower) && /\b(?:deal|deals|package|combo)\b/i.test(lower)) ||
        (/\b(?:kia|kya|can\s*you)\b/i.test(lower) && /\b(?:deal|deals)\b/i.test(lower) && /\b(?:bana\s*(?:skta|saktay|sakty|sakte|do|dein|dain|den)|create|make)\b/i.test(lower))
    );
    if (isCustomDeal) {
        return {
            reasoning: 'Fallback detected custom deal request (not supported)',
            intent: 'CUSTOM_DEAL_REQUEST',
            confidence: 0.98,
            actions: [],
            conversational_reply: RESPONSE_TEMPLATES.customDealNotPossible(),
            referenced_entity: { type: 'none', name: null },
            entities: {},
            operation: 'READ_ONLY',
            customer_confirmation: false,
        };
    }

    // 0b. Check Persona / Off-topic / Clarification
    const isPersonalOrOffTopic = /\b(?:wife|biwi|shadi|shaadi|husband|shoher|gf|girlfriend|bf|boyfriend|children|bachay|bache|family|khala|chachi|age|umar|tum\s*kon\s*ho|aap\s*kon\s*ho|who\s*are\s*you|who\s*made\s*you|insan\s*ho|robot\s*ho|bot\s*ho|kahan\s*rehte\s*ho|where\s*do\s*you\s*live|tumhara\s*naam\s*kya\s*hai|apka\s*naam\s*kya\s*hai)\b/i.test(lower);
    if (isPersonalOrOffTopic) {
        return {
            reasoning: 'Fallback detected persona identity / off-topic inquiry',
            intent: 'PERSONA_QUERY',
            confidence: 0.98,
            actions: [],
            conversational_reply: RESPONSE_TEMPLATES.personaIdentity(),
            referenced_entity: { type: 'none', name: null },
            entities: {},
            operation: 'READ_ONLY',
            customer_confirmation: false,
        };
    }
    if (/^(?:what|kya|kia|wat|hein|hain|ji|\?)[\s.!?]*$/i.test(lower)) {
        return {
            reasoning: 'Fallback detected standalone clarification inquiry',
            intent: 'CLARIFICATION_QUERY',
            confidence: 0.95,
            actions: [],
            conversational_reply: RESPONSE_TEMPLATES.genericClarification(),
            referenced_entity: { type: 'none', name: null },
            entities: {},
            operation: 'READ_ONLY',
            customer_confirmation: false,
        };
    }

    // 0c. Check Budget / Cheapest Inquiries
    const isPriceOrBudget = /\b(?:lowest(?:\s*level)?(?:\s*price)?|cheapest|cheap|sasta|sasti|sastai|saste|sasty|sastay|kam\s*(?:rate|price|qeemat|pese|paise|peso|paiso)|low\s*(?:level|price|rate)|budget)\b/i.test(lower);
    if (isPriceOrBudget && /\b(?:deals?|offers?|combos?|packages?)\b/i.test(lower)) {
        return {
            reasoning: 'Fallback detected cheapest deals inquiry',
            intent: 'CHEAPEST_DEALS_QUERY',
            confidence: 0.95,
            actions: [{ tool: 'get_product_details', args: { queryType: 'cheapest_deals' } }],
            conversational_reply: RESPONSE_TEMPLATES.cheapestDealsList(),
            referenced_entity: { type: 'deal', name: null },
            entities: {},
            operation: 'READ_ONLY',
            customer_confirmation: false,
        };
    }
    if (isPriceOrBudget && /\b(?:item|items|cheez|cheezein|chezen|food|burger|pizza|khana|dish)\b/i.test(lower)) {
        return {
            reasoning: 'Fallback detected cheapest items inquiry',
            intent: 'CHEAPEST_ITEMS_QUERY',
            confidence: 0.95,
            actions: [{ tool: 'get_product_details', args: { queryType: 'cheapest' } }],
            conversational_reply: RESPONSE_TEMPLATES.cheapestItemsList(),
            referenced_entity: { type: 'item', name: null },
            entities: {},
            operation: 'READ_ONLY',
            customer_confirmation: false,
        };
    }

    // 1. Check for Both Menu & Deals
    const isBoth = !isPriceOrBudget && (
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
        { role: 'system', content: getSystemPrompt() },
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
