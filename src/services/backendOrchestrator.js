/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║   Backend Orchestrator — src/services/backendOrchestrator.js ║
 * ║   100% Business Logic, State Machine & Deterministic Exec   ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Architecture:
 *   Customer WhatsApp Message
 *     → 1. Rapid Duplicate Suppression
 *     → 2. Deterministic Routing (checkFastRoute — 0 TOKENS)
 *     → 3. Customer Details Extraction & State Machine Evaluation
 *     → 4. Confirmation Lock & Booking Gate (0 TOKENS)
 *     → 5. AI Context Interpreter (Only when contextual understanding needed — 1 LLM call, JSON only)
 *     → 6. Backend Manager Execution (Cart, Menu, Deal, Delivery, Order)
 *     → 7. Deterministic Response Templates (Pure Roman Urdu output)
 *     → WhatsApp
 */

import { getDefaultRestaurantId } from './restaurantService.js';
import { getCatalogCache, getSyncEpoch } from './catalogCacheService.js';
import { logZeroTokenReply, logAiTokenReply } from '../utils/logger.js';
import { cleanWhatsAppPhone } from '../../utils/senderIdentity.js';
import { extractLocationFromText } from '../../utils/location.js';
import {
    getCanonicalSessionKey,
    getSessionOrderDetails,
    updateSessionOrderDetails,
    getRememberedCustomerDetails,
    isValidCustomerName,
    appendSessionHistory,
    getSessionHistory,
} from './sessionService.js';
import {
    ORDER_STAGES,
    acquireConfirmationLock,
    releaseConfirmationLock,
    isConfirmationLocked,
    saveOrderSummarySnapshot,
    clearOrderSummarySnapshot,
} from './checkoutStateMachine.js';
import {
    checkFastRoute,
    cleanExtractedAddress,
    extractCustomerDetails,
    setLastDiscussedItem,
    getLastDiscussedItem,
    clearLastDiscussedItem,
} from './intentParser.js';
import {
    getActiveCart,
    addItemToCart,
    calculateCartTotals,
    removeCartItem,
    matchVariant,
} from './cartService.js';
import { resolveMenuItemOrDeal, getActiveDeals, getActiveMenu } from './menuService.js';
import { checkDeliveryAvailability } from './deliveryService.js';
import { createOrder, getLatestInMemoryOrder } from './orderService.js';
import { resolveCartItemForRemoval, executeCartItemRemoval } from './cartItemResolver.js';
import { isChatMuted } from './handoverService.js';
import { interpretCustomerContext } from './aiContextInterpreter.js';
import { RESPONSE_TEMPLATES } from './responseTemplates.js';
import {
    isPizzaDeal,
    getDealPizzaInfo,
    extractFlavoursFromText,
    formatDealFlavourPrompt,
    formatSingleFlavourConfirmationPrompt,
    setPendingDealFlavour,
    getPendingDealFlavour,
    clearPendingDealFlavour,
} from './dealFlavourService.js';

// In-flight message tracking & duplicate suppression
const _inFlightMessages = new Map();
const _lastProcessedMessages = new Map();

/**
 * Detect explicit confirmation intent
 */
export function detectConfirmIntent(text) {
    if (!text || typeof text !== 'string') return false;
    const t = text.trim().toLowerCase();
    const words = t.split(/\s+/).filter(Boolean);
    if (words.length < 1 || words.length > 8) return false;
    if (/\d/.test(t)) return false;

    const NEGATIONS = /\b(?:nahi|nahin|na|no|mat|cancel|rok|ruko|galat|wrong|hatao|nhi)\b/i;
    if (NEGATIONS.test(t)) return false;

    const MODIFICATION_INTENT = /\b(?:add|change|badal|update|hatao?|nikal|remove|wapas|aur|extra|fries|drink|pepsi|coke|7up|deal|item|burger|pizza|wings|roll|naya|doosra)\b/i;
    if (MODIFICATION_INTENT.test(t)) return false;

    const EXPLICIT_CONFIRM = /\b(?:co?n?f[iy]?r[mn]+|comfirm|konfirm|final(?:ize|ise)?|order\s*(?:final|co?n?f[iy]?r[mn]+|book|kar|kr)|proceed|bhej\s*do|book\s*(?:kar|kr)\s*d[aoeiu]+n?|order\s*(?:kar|kr)\s*d[aoeiu]+n?|kardo|krdo|krdu|kardu|yahi\s*(?:kr|kar)\s*d[aoeiu]+n?|(?:haan|han|g|ji|theek\s*hai)\s*(?:g\s*)?(?:kr|kar)\s*d[aoeiu]+n?)\b/i;
    if (EXPLICIT_CONFIRM.test(t)) return true;

    const AFFIRMATIVE = /^(?:g|jee?|ji|haan?|han|hn|yes|yep|ok|okay|theek(?:\s*(?:hai|hy))?|thk(?:\s*(?:hai|hy))?|bilkul|done|zaroor|zarur|(?:kr|kar)\s*d[aoeiu]+n?|bhai\s*(?:kr|kar)\s*d[aoeiu]+n?|haan\s*bhai|g\s*haan|g\s*kr\s*d[aoeiu]+n?|han\s*g(?:\s*(?:kr|kar)\s*d[aoeiu]+n?)?|haan\s*(?:g\s*)?(?:kr|kar)\s*d[aoeiu]+n?|han\s*(?:kr|kar)\s*d[aoeiu]+n?|jee\s*haan|theek\s*(?:hai|hy)\s*(?:kr|kar)\s*d[aoeiu]+n?)[\s!.?]*$/i;
    return AFFIRMATIVE.test(t);
}

/**
 * Clean and format output text
 */
export function sanitizeOutput(text) {
    if (!text || typeof text !== 'string') return '';
    return text
        .replace(/<invoke\b[^>]*>[\s\S]*?<\/invoke>/gi, '')
        .replace(/<｜DSML｜[^>]*>[\s\S]*?<\/｜DSML｜[^>]*>/gi, '')
        .replace(/<[^>]+>/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/**
 * Centralized Backend Orchestration Handler
 */
export async function handleCustomerMessage({
    sock,
    msg,
    text,
    identity,
    locationData,
}) {
    const rawSender = identity?.whatsappPhone || identity?.phone || '';
    const whatsappPhone = cleanWhatsAppPhone(rawSender);
    const jid = msg?.key?.remoteJid || identity?.chatId || identity?.phone || 'default';
    const canonicalKey = getCanonicalSessionKey(jid, jid, whatsappPhone);
    const syncEpoch = getSyncEpoch();

    // ── 1. Rapid Duplicate Suppression ──
    const effectiveText = (text || '').trim();
    const normalizedText = effectiveText.toLowerCase();

    if (normalizedText) {
        const inFlight = _inFlightMessages.get(canonicalKey);
        if (inFlight && inFlight.normalizedText === normalizedText && (Date.now() - inFlight.timestamp < 10000)) {
            console.log(`[ORCHESTRATOR] Suppressing simultaneous in-flight duplicate "${effectiveText}" from ${canonicalKey}.`);
            return null;
        }

        const lastProcessed = _lastProcessedMessages.get(canonicalKey);
        if (lastProcessed && lastProcessed.normalizedText === normalizedText && (Date.now() - lastProcessed.timestamp < 6000)) {
            console.log(`[ORCHESTRATOR] Suppressing rapid duplicate message "${effectiveText}" from ${canonicalKey} (${Date.now() - lastProcessed.timestamp}ms ago).`);
            return null;
        }

        _inFlightMessages.set(canonicalKey, { normalizedText, timestamp: Date.now() });
    }

    try {
        // Location data extraction
        const activeLocation = locationData || extractLocationFromText(effectiveText);
        let resolvedText = effectiveText;
        if (!resolvedText && activeLocation) {
            resolvedText = activeLocation.latitude != null && activeLocation.longitude != null
                ? `https://www.google.com/maps?q=${activeLocation.latitude},${activeLocation.longitude}`
                : (activeLocation.address || 'Location Pin');
        }

        if (!resolvedText) return '';

        // Check Human Handover Mute
        const muteStatus = isChatMuted(jid) || isChatMuted(whatsappPhone) || isChatMuted(canonicalKey);
        if (muteStatus?.isMuted) {
            console.log(`[HANDOVER] Chat ${canonicalKey} is muted for human support. Skipping.`);
            return '';
        }

        // ── 2. Zero-Token Fast Route Interceptor ──
        try {
            const fastResult = await checkFastRoute({
                text: resolvedText,
                whatsappPhone,
                sessionKey: canonicalKey,
                chatId: jid,
                sock,
            });

            const hasFastContent = Boolean(
                (fastResult.reply && fastResult.reply.trim()) ||
                fastResult.imageUrl ||
                (Array.isArray(fastResult.imageUrls) && fastResult.imageUrls.length > 0)
            );

            if ((fastResult.handled || fastResult.reply) && hasFastContent) {
                const cleanReply = sanitizeOutput(fastResult.reply);
                logZeroTokenReply({
                    whatsappPhone,
                    message: resolvedText,
                    routeName: fastResult.routeName || 'Deterministic Fast Route',
                });

                appendSessionHistory(canonicalKey, 'user', resolvedText, syncEpoch);
                if (cleanReply) {
                    appendSessionHistory(canonicalKey, 'assistant', cleanReply, syncEpoch);
                }

                return {
                    text: cleanReply,
                    imageUrl: fastResult.imageUrl || (fastResult.imageUrls && fastResult.imageUrls[0]) || null,
                    imageUrls: fastResult.imageUrls || (fastResult.imageUrl ? [fastResult.imageUrl] : []),
                };
            }
        } catch (fastErr) {
            console.warn('[ORCHESTRATOR] Fast route error:', fastErr.message);
        }

        // ── 3. Load Live Context & State Data ──
        let restId;
        try {
            restId = await getDefaultRestaurantId();
        } catch (_) {
            return { text: 'Store database se rabta nahi ho pa raha. Thodi der baad dobara koshish karein.' };
        }

        const sessionDetails = getSessionOrderDetails(canonicalKey, whatsappPhone);
        const rememberedDetails = await getRememberedCustomerDetails(canonicalKey, whatsappPhone);

        // Populate remembered profile if not already set
        if (rememberedDetails?.name && !sessionDetails.name) {
            sessionDetails.name = rememberedDetails.name;
            sessionDetails.nameExplicit = true;
        }
        if (rememberedDetails?.address && !sessionDetails.address) {
            sessionDetails.address = rememberedDetails.address;
        }
        const cleanPhone = (whatsappPhone || '').replace(/\D/g, '');
        if (!sessionDetails.phone) {
            sessionDetails.phone = cleanPhone;
        }

        if (activeLocation) {
            updateSessionOrderDetails(canonicalKey, {
                address: activeLocation.formattedAddress || activeLocation.address || 'Google Maps Location Pin',
                location: activeLocation,
            }, whatsappPhone);
            sessionDetails.address = activeLocation.formattedAddress || activeLocation.address || 'Google Maps Location Pin';
        }

        // ── 3b. Extract & Update Customer Details from current message ──
        const isAwaitingName = !sessionDetails.name && !getLastDiscussedItem(canonicalKey, whatsappPhone) && !getPendingDealFlavour(canonicalKey);
        const extracted = extractCustomerDetails(resolvedText, { ...sessionDetails, isAwaitingName });
        const updatePayload = {};

        if (extracted.name) {
            if (!sessionDetails.name || !sessionDetails.nameExplicit) {
                updatePayload.name = extracted.name;
                updatePayload.nameExplicit = true;
                sessionDetails.nameExplicit = true;
                sessionDetails.name = extracted.name;
            } else if (extracted.nameExplicit) {
                const isExplicitRename = /\b(?:badal|change|update|ab\s+(?:mera\s+)?naam|mera\s+naam|my\s+name\s+is|name\s+is|naam\s+|name\s*[:=-])\b/i.test(resolvedText) ||
                                         /^(?:naam\s+|mera\s+naam\s+|my\s+name\s+is\s+|name\s+is\s+)?([A-Za-z]{2,20})\s+(?:kr\s*do|kar\s*do|kardo|krdo|ka\s*rdo|rakh\s*do|likh\s*do|dein|do)$/i.test(resolvedText.trim());
                if (isExplicitRename && extracted.name.toLowerCase() !== sessionDetails.name.toLowerCase()) {
                    updatePayload.name = extracted.name;
                    sessionDetails.name = extracted.name;
                }
            }
        }
        if (extracted.address && (!sessionDetails.address || extracted.address.toLowerCase() !== sessionDetails.address.toLowerCase())) {
            updatePayload.address = extracted.address;
            sessionDetails.address = extracted.address;
        }
        if (extracted.paymentMethod && (!sessionDetails.paymentMethod || extracted.paymentMethod !== sessionDetails.paymentMethod)) {
            updatePayload.paymentMethod = extracted.paymentMethod;
            sessionDetails.paymentMethod = extracted.paymentMethod;
        }
        if (extracted.phone && (!sessionDetails.phone || extracted.phone !== sessionDetails.phone || !sessionDetails.phoneConfirmed)) {
            updatePayload.phone = extracted.phone === 'SAME_WHATSAPP' ? cleanPhone : extracted.phone;
            updatePayload.phoneConfirmed = true;
            sessionDetails.phone = updatePayload.phone;
            sessionDetails.phoneConfirmed = true;
        }
        if (sessionDetails.name && !sessionDetails.phoneConfirmed && !updatePayload.phone) {
            const isAffirmativePhone = /^(?:(?:han|haan|ha|hn|g|ji|jee|gee|yes|ok|okay|theek\s*(?:hai|hy)?|sahi\s*(?:hai|hy)?)\s+)?(?:same|yahi|yehi|yehe|yhe|yeh|ye|wahi|isi\s*pe|isi\s*par|isi|yahi\s*hai|yehi\s*hai|yeh\s*hai|ye\s*hai|isi\s*number|yehi\s*number|yahi\s*number|yehe\s*number|yeh\s*number|ye\s*number|same\s*number|same\s*whatsapp|haan|han|hn|ji|jee|gee|g|yes|yep|yeah|theek\s*hai|theek\s*hy|thk\s*hai|thk\s*hy|sahi\s*hai|sahi\s*hy|bilkul|ji\s*bilkul|g\s*bilkul|ok|okay|done|confirm|acha|achha)(?:\s+(?:hi|bhi))?(?:\s*(?:number|no|whatsapp|contact))?(?:\s*(?:pe|par|per))?(?:\s*(?:hoga|hogi|rahyga|rahega|rhega|ryga|rahy\s*ga|rahe\s*ga|rakh\s*lo|rakh\s*do|rakho|rakhein|rehn\s*do|rehne\s*do|dedo|de\s*do|likh\s*do|likh\s*lo|daal\s*do|kar\s*do|kr\s*do|kardo|krdo|karo|kro|bhej\s*do|bhejo|rabta\s*karein|rabta|rider\s*ko\s*de\s*do|rider\s*ko\s*dedo|theek\s*(?:hai|hy)?|sahi\s*(?:hai|hy)?|hai|he|hy|ha|yar|yaar|bhai|jee|ji|gee))?[\s.!?]*$/i.test(resolvedText.trim()) ||
                /\b(?:same|yahi|yehi|yehe|yeh|ye|wahi|isi)\s*(?:hi\s*)?(?:number|no|whatsapp)?\s*(?:pe|par|per)?\s*(?:rahyga|rahega|rhega|ryga|rahy\s*ga|rahe\s*ga|hoga|rakh\s*lo|rakh\s*do|rakho|dedo|de\s*do|likh\s*do|likh\s*lo|bhej\s*do|ha|hai|he|hy)\b/i.test(resolvedText.trim()) ||
                /\b(?:btaya|bola|kaha)\s+to\s+h(?:ai|y)?.*(?:yehe|yehi|yeh|ye|same|isi)\s+number\b/i.test(resolvedText.trim()) ||
                /^(?:han|haan|g|ji|jee|gee)?\s*(?:yeh|ye|yahi|yehi|same|isi)\s*(?:hi\s*)?(?:number|no|whatsapp|contact)\s*(?:ha|hai|h|he)?[\s.!?]*$/i.test(resolvedText.trim());
            if (isAffirmativePhone) {
                updatePayload.phone = cleanPhone;
                updatePayload.phoneConfirmed = true;
                sessionDetails.phone = cleanPhone;
                sessionDetails.phoneConfirmed = true;
            }
        }
        const candidateAddress = cleanExtractedAddress(resolvedText);
        const hasChangeIntent = /\b(?:change|badal|update)\b/i.test(resolvedText);
        const shouldUpdateAddress = (!sessionDetails.address || extracted.address || hasChangeIntent) && candidateAddress && candidateAddress.length >= 3;
        if (sessionDetails.name && sessionDetails.phoneConfirmed && shouldUpdateAddress && !updatePayload.address && !activeLocation) {
            const isPureChangeCommand = /^(?:location|address|pata)\s*(?:change|badal|update|kardo|krdo|kar\s*do|kr\s*do)?$/i.test(resolvedText.trim());
            const isNotAddr = isPureChangeCommand || /^(?:menu|deals?|cancel|khatam|band|nahi|no|theek|ok|done|hi|hello|hey|suno|bhai|cod|easypaisa)[\s.!?]*$/i.test(resolvedText.trim()) ||
                /\b(?:number|phone|contact|whatsapp|yahi\s*number|yehi\s*number|yeh\s*number|same\s*number)\b/i.test(resolvedText);
            if (!isNotAddr && (!sessionDetails.address || candidateAddress.toLowerCase() !== sessionDetails.address.toLowerCase())) {
                updatePayload.address = candidateAddress;
                sessionDetails.address = candidateAddress;
                updatePayload.summaryShown = false;
                sessionDetails.summaryShown = false;
            }
        }
        if (/^(?:cod|cash|cash\s*on\s*delivery|1)[\s.!?]*$/i.test(resolvedText.trim()) || /\b(?:cod|cash\s*on\s*delivery)\b/i.test(resolvedText.toLowerCase())) {
            if (!sessionDetails.paymentMethod || sessionDetails.paymentMethod !== 'COD') {
                updatePayload.paymentMethod = 'COD';
                sessionDetails.paymentMethod = 'COD';
            }
        } else if (/^(?:easypaisa|easy\s*paisa|ep|2)[\s.!?]*$/i.test(resolvedText.trim()) || /\b(?:easypaisa|easy\s*paisa|ep)\b/i.test(resolvedText.toLowerCase())) {
            if (!sessionDetails.paymentMethod || sessionDetails.paymentMethod !== 'EASYPAISA') {
                updatePayload.paymentMethod = 'EASYPAISA';
                sessionDetails.paymentMethod = 'EASYPAISA';
            }
        }

        const isNoExtraItems = /^(?:nahi|nahin|na|no|nope|kuch\s*nahi|aur\s*kuch\s*nahi|aur\s*nahi|nahi\s*bhai|nahii+|bas|kuch\s*ni|nhi|nahi\s*chahiye|shukriya|sirf\s*yahi)[\s.!?]*$/i.test(resolvedText.trim()) ||
            /\b(?:kuch\s*aur\s*nahi|aur\s*nahi\s*chahiye|extra\s*kuch\s*nahi|nahi\s*bhai|nahi\s*kuch\s*nahi)\b/i.test(resolvedText);
        const isFinalConfirming = detectConfirmIntent(resolvedText);
        if (isNoExtraItems || isFinalConfirming) {
            updatePayload.extraItemsAnswered = true;
            updatePayload.extraItemsInquired = true;
            sessionDetails.extraItemsAnswered = true;
            sessionDetails.extraItemsInquired = true;
        }
        if (Object.keys(updatePayload).length > 0) {
            updateSessionOrderDetails(canonicalKey, updatePayload, whatsappPhone);
        }

        // Retrieve active cart
        const activeCart = await getActiveCart({
            sessionKey: canonicalKey,
            restaurantId: restId,
            chatId: jid,
            verifiedPhone: whatsappPhone,
        });
        const hasCartItems = Boolean(activeCart?.items && activeCart.items.length > 0);
        let cartTotals = null;
        if (hasCartItems) {
            cartTotals = await calculateCartTotals({ sessionKey: canonicalKey, restaurantId: restId }).catch(() => null);
        }

        // Build active cart text representation
        let activeCartSummary = '';
        let activeCartOnlyLines = '';
        if (hasCartItems && cartTotals?.items) {
            const lines = cartTotals.items.map(it => `• ${it.quantity}x ${it.name}${it.variantName ? ` (${it.variantName})` : ''} — Rs. ${Number(it.lineTotal).toLocaleString('en-PK')}`);
            (cartTotals.deals || []).forEach(d => {
                lines.push(`• ${d.quantity}x ${d.name}${d.notes ? ` (${d.notes})` : ''} — Rs. ${Number(d.lineTotal || d.totalPrice).toLocaleString('en-PK')}`);
            });
            activeCartOnlyLines = lines.join('\n');
            activeCartSummary = `${activeCartOnlyLines}\nSubtotal: Rs. ${Number(cartTotals.subtotal).toLocaleString('en-PK')}`;
        }

        // Determine current order stage
        const hasValidName = Boolean(sessionDetails.name && isValidCustomerName(sessionDetails.name));
        const hasValidPhone = Boolean(sessionDetails.phoneConfirmed || sessionDetails.phone);
        const hasValidAddress = Boolean(sessionDetails.address || activeLocation?.formattedAddress);
        const hasValidPayment = Boolean(sessionDetails.paymentMethod === 'COD' || sessionDetails.paymentMethod === 'EASYPAISA');
        const isStep5Done = Boolean(sessionDetails.extraItemsAnswered || sessionDetails.summaryShown);

        let currentStage = ORDER_STAGES.CART_BUILDING;
        if (hasCartItems) {
            if (!hasValidName) currentStage = ORDER_STAGES.CUSTOMER_DETAILS;
            else if (!hasValidPhone) currentStage = ORDER_STAGES.CUSTOMER_DETAILS;
            else if (!hasValidAddress) currentStage = ORDER_STAGES.DELIVERY_VALIDATION;
            else if (!hasValidPayment) currentStage = ORDER_STAGES.PAYMENT_SELECTION;
            else if (!isStep5Done) currentStage = ORDER_STAGES.FINAL_REVIEW;
            else if (!sessionDetails.orderConfirmed) currentStage = ORDER_STAGES.AWAITING_CONFIRMATION;
            else currentStage = ORDER_STAGES.ORDER_CONFIRMED;
        }

        const confirmIntent = detectConfirmIntent(resolvedText);

        // ── 4. SCENARIO A: Confirmation Lock & Direct Booking ──
        const isReadyForBooking = hasCartItems && hasValidName && hasValidPhone && hasValidAddress && hasValidPayment && isStep5Done;
        if (isReadyForBooking && confirmIntent) {
            if (isConfirmationLocked(canonicalKey)) {
                return { text: RESPONSE_TEMPLATES.orderProcessing() };
            }
            acquireConfirmationLock(canonicalKey);
            try {
                const bookingResult = await createOrder({
                    restaurantId: restId,
                    sessionKey: canonicalKey,
                    customerName: sessionDetails.name,
                    phone: sessionDetails.phone,
                    delivery: { address: sessionDetails.address },
                    paymentMethod: sessionDetails.paymentMethod,
                    sock,
                });

                if (bookingResult && bookingResult.success && bookingResult.order) {
                    updateSessionOrderDetails(canonicalKey, {
                        orderConfirmed: true,
                        orderStage: ORDER_STAGES.ORDER_CONFIRMED,
                        lastOrderNumber: bookingResult.order.orderNumber,
                        summaryShown: false,
                        extraItemsAnswered: false,
                    }, whatsappPhone);
                    clearOrderSummarySnapshot(canonicalKey);

                    const finalReply = RESPONSE_TEMPLATES.orderConfirmed({
                        name: sessionDetails.name,
                        orderNumber: bookingResult.order.orderNumber || bookingResult.order.order_number,
                        total: bookingResult.order.total ?? bookingResult.order.pricing?.total ?? 0,
                        paymentLabel: sessionDetails.paymentMethod === 'COD' ? 'Cash on Delivery (COD)' : 'EasyPaisa',
                        address: sessionDetails.address,
                    });

                    logZeroTokenReply({
                        whatsappPhone,
                        message: resolvedText,
                        routeName: 'deterministic_order_booking',
                    });

                    appendSessionHistory(canonicalKey, 'user', resolvedText, syncEpoch);
                    appendSessionHistory(canonicalKey, 'assistant', finalReply, syncEpoch);
                    return { text: finalReply };
                }
            } catch (bookingErr) {
                console.error('[ORCHESTRATOR] Deterministic booking error:', bookingErr.message);
            } finally {
                releaseConfirmationLock(canonicalKey);
            }
        }

        // ── 5. SCENARIO B: Present Authoritative Order Summary ──
        if (isReadyForBooking && !sessionDetails.summaryShown && !confirmIntent) {
            updateSessionOrderDetails(canonicalKey, {
                summaryShown: true,
                orderStage: ORDER_STAGES.AWAITING_CONFIRMATION,
            }, whatsappPhone);
            saveOrderSummarySnapshot(canonicalKey, { cart: activeCartSummary });

            const summaryReply = RESPONSE_TEMPLATES.finalReview({
                name: sessionDetails.name,
                cartSummary: activeCartSummary,
                address: sessionDetails.address,
                phone: sessionDetails.phone,
                paymentLabel: sessionDetails.paymentMethod === 'COD' ? 'Cash on Delivery (COD)' : 'EasyPaisa',
            });

            logZeroTokenReply({
                whatsappPhone,
                message: resolvedText,
                routeName: 'deterministic_final_summary',
            });

            appendSessionHistory(canonicalKey, 'user', resolvedText, syncEpoch);
            appendSessionHistory(canonicalKey, 'assistant', summaryReply, syncEpoch);
            return { text: summaryReply };
        }

        // ── 6. Context-Only AI Interpretation (Single Compact LLM Call) ──
        const rawHistory = getSessionHistory(canonicalKey, syncEpoch);
        const { context, tokenUsage, providerInfo } = await interpretCustomerContext({
            text: resolvedText,
            orderStage: currentStage,
            sessionDetails,
            activeCartSummary,
            recentHistory: rawHistory.slice(-4),
        });

        logAiTokenReply({
            whatsappPhone,
            message: resolvedText,
            promptTokens: tokenUsage.promptTokens || 0,
            completionTokens: tokenUsage.completionTokens || 0,
            totalTokens: tokenUsage.totalTokens || 0,
            provider: providerInfo.provider,
            model: providerInfo.model,
        });

        // ── 7. Execute AI Planned Actions (Tool Execution Engine) ──
        let backendReply = '';
        let backendImageUrl = null;
        let backendImageUrls = [];

        const toolContext = {
            sessionKey: canonicalKey,
            whatsappPhone,
            chatId: jid,
            sock,
            restId,
            locationData: activeLocation,
            effectiveText: resolvedText,
        };

        if (Array.isArray(context.actions) && context.actions.length > 0) {
            const isBothCatalogs = context.actions.some(a => a.tool === 'get_menu') && context.actions.some(a => a.tool === 'get_deals');
            if (isBothCatalogs) {
                const { get_menu, get_deals } = await import('./toolRegistry.js');
                const mRes = await get_menu({}, toolContext);
                const dRes = await get_deals({}, toolContext);

                if (sock && (jid || canonicalKey)) {
                    try {
                        const { sendWhatsAppMediaOrText } = await import('../utils/media.js');
                        await sendWhatsAppMediaOrText(sock, jid, {
                            imageUrls: mRes.imageUrls,
                            text: '📋 *Cravey Crust Menu:*',
                        });
                        await new Promise(r => setTimeout(r, 600));
                        await sendWhatsAppMediaOrText(sock, jid, {
                            imageUrls: dRes.imageUrls,
                            text: '🔥 *Cravey Crust Deals:*',
                        });
                    } catch (_) {}
                }

                backendReply = 'Cravey Crust ka mukammal Menu aur Deals haazir hain! 🍕🍔🔥\n\nPehle menu aur deals check kar lein. Aap ko in mein se kya order karna hai? Bas naam ya deal number bata dein! 😊';
                backendImageUrls = [...mRes.imageUrls, ...dRes.imageUrls];
                backendImageUrl = mRes.imageUrl;
            } else {
                const { executeRegisteredTool } = await import('./toolRegistry.js');
                const replies = [];
                for (const action of context.actions) {
                    const res = await executeRegisteredTool(action.tool, action.args, toolContext);
                    if (res?.reply) replies.push(res.reply);
                    else if (res?.caption) replies.push(res.caption);
                    if (res?.imageUrl && !backendImageUrl) backendImageUrl = res.imageUrl;
                    if (Array.isArray(res?.imageUrls) && res.imageUrls.length > 0) {
                        backendImageUrls.push(...res.imageUrls);
                    }
                }
                if (replies.length > 0) {
                    const addItemActions = (context.actions || []).filter(a => a.tool === 'add_to_cart' || a.tool === 'add_item');
                    if (addItemActions.length > 1) {
                        const lines = [];
                        for (const r of replies) {
                            const bulletMatch = r.match(/•\s*[^\n]+/g);
                            if (bulletMatch) lines.push(...bulletMatch);
                        }
                        if (lines.length > 0) {
                            const promptTail = '\n\nKya aap iske sath kuch aur order karna chahenge (jaise Fries ya Cold Drink), ya order finalize karein? 😊';
                            backendReply = `Zabardast! Aap ke items cart mein add kar diye gaye hain! 🎉\n${lines.join('\n')}${promptTail}`;
                        } else {
                            backendReply = replies.join('\n\n');
                        }
                    } else {
                        backendReply = replies.join('\n\n');
                    }
                }
            }
        }

        // ── 8. Intent Switch & State Machine Fallback ──
        const intent = context.intent;
        const entities = context.entities || {};

        if (!backendReply && context.conversational_reply && (intent === 'GREETING' || intent === 'GENERAL_CONVERSATION' || intent === 'ACKNOWLEDGEMENT')) {
            backendReply = context.conversational_reply;
        }

        if (!backendReply) switch (intent) {
            case 'CONFIRM_ORDER': {
                if (!hasCartItems) {
                    backendReply = RESPONSE_TEMPLATES.emptyCartConfirmGuard();
                } else if (!hasValidName) {
                    backendReply = RESPONSE_TEMPLATES.namePrompt();
                } else if (!hasValidPhone) {
                    backendReply = RESPONSE_TEMPLATES.phonePrompt({ name: sessionDetails.name, displayPhone: sessionDetails.phone });
                } else if (!hasValidAddress) {
                    backendReply = RESPONSE_TEMPLATES.addressPrompt({ name: sessionDetails.name });
                } else if (!hasValidPayment) {
                    backendReply = RESPONSE_TEMPLATES.paymentPrompt({ name: sessionDetails.name });
                } else if (!sessionDetails.extraItemsAnswered) {
                    backendReply = RESPONSE_TEMPLATES.extraItemsUpsell({ name: sessionDetails.name });
                } else {
                    backendReply = RESPONSE_TEMPLATES.orderProcessing();
                }
                break;
            }

            case 'UPDATE_ITEM': {
                const { update_cart_item } = await import('./toolRegistry.js');
                const updRes = await update_cart_item({
                    itemName: entities.product_name,
                    newSize: entities.size || resolvedText,
                    newQuantity: entities.quantity,
                }, toolContext);
                backendReply = updRes.reply;
                break;
            }

            case 'ADD_ITEM': {
                const { extractRequestedItems } = await import('./addonExtractionService.js');
                const extractedMulti = extractRequestedItems(resolvedText);
                if (extractedMulti.hasMultiple || (extractedMulti.items.length > 0 && extractedMulti.hasUnresolvedVariations)) {
                    const addedSummaries = [];
                    for (const it of extractedMulti.items) {
                        await addItemToCart({
                            sessionKey: canonicalKey,
                            restaurantId: restId,
                            chatId: jid,
                            verifiedPhone: whatsappPhone,
                            menuItemId: it.menuItemId || null,
                            variantId: it.variantId || null,
                            dealId: it.dealId || null,
                            quantity: it.quantity || 1,
                        });
                        addedSummaries.push(`• ${it.quantity}x ${it.canonicalName || it.itemName} — Rs. ${Number(it.lineTotal).toLocaleString('en-PK')}`);
                    }

                    if (extractedMulti.hasUnresolvedVariations && extractedMulti.unresolvedItems.length > 0) {
                        const unresolved = extractedMulti.unresolvedItems[0];
                        if (unresolved.itemType === 'drink') {
                            const drinkItem = unresolved.itemObj || {
                                id: 'item-34',
                                name: 'Soft Drink',
                                variants: [
                                    { id: 'v-34-1', name: 'Regular', price: 110 },
                                    { id: 'v-34-2', name: 'Can', price: 130 },
                                    { id: 'v-34-3', name: '1 Liter', price: 200 },
                                    { id: 'v-34-4', name: '1.5 Liter', price: 240 }
                                ]
                            };
                            setLastDiscussedItem(canonicalKey, drinkItem, null, whatsappPhone, unresolved.quantity);

                            let replyText = '';
                            if (addedSummaries.length > 0) {
                                replyText = `Zabardast! Aap ke items cart mein add kar diye gaye hain! 🎉\n${addedSummaries.join('\n')}\n\n`;
                                replyText += `Aur *${unresolved.quantity}x Cold Drinks* ke liye kaunsa size add karun — *Regular* (Rs. 110), *Can* (Rs. 130), *1 Liter* (Rs. 200), ya *1.5 Liter* (Rs. 240)? 🥤`;
                            } else {
                                replyText = `Zaroor! *${unresolved.quantity}x Cold Drinks* ke liye kaunsa size add karun — *Regular* (Rs. 110), *Can* (Rs. 130), *1 Liter* (Rs. 200), ya *1.5 Liter* (Rs. 240)? 🥤`;
                            }
                            backendReply = replyText;
                            break;
                        }
                    }

                    clearLastDiscussedItem(canonicalKey);
                    const nextPrompt = 'Kya aap iske sath kuch aur order karna chahenge (jaise Fries ya Cold Drink), ya order finalize karein? 😊';
                    backendReply = `Zabardast! Aap ke items cart mein add kar diye gaye hain! 🎉\n${addedSummaries.join('\n')}\n\n${nextPrompt}`;
                    break;
                }

                const query = entities.product_name || context.referenced_entity?.name || resolvedText;
                const resolved = await resolveMenuItemOrDeal(query, restId);

                if (resolved && resolved.status === 'CATEGORY_REQUESTED') {
                    const explicitSize = entities.size || (resolvedText.match(/\b(cans?|tin|1\.5\s*liter|1\s*liter|regular)\b/i)?.[1]);
                    if (explicitSize && resolved.categoryName === 'Drinks') {
                        const { FALLBACK_MENU_ITEMS } = await import('./fallbackCatalog.js');
                        const allItems = (await getActiveMenu(restId)).flatMap(c => c.menu_items || []);
                        const softDrink = allItems.find(i => i.slug === 'soft-drink' || /soft\s*drink/i.test(i.name)) ||
                            FALLBACK_MENU_ITEMS.find(i => i.slug === 'soft-drink');
                        if (softDrink) {
                            const matchedV = matchVariant(softDrink.variants, explicitSize);
                            if (matchedV) {
                                await addItemToCart({
                                    sessionKey: canonicalKey,
                                    restaurantId: restId,
                                    chatId: jid,
                                    verifiedPhone: whatsappPhone,
                                    menuItemId: softDrink.id,
                                    variantId: matchedV.id,
                                    quantity: entities.quantity || 1,
                                });
                                const nextPrompt = 'Kya aap iske sath kuch aur order karna chahenge (jaise Fries ya Cold Drink), ya order finalize karein? 😊';
                                backendReply = RESPONSE_TEMPLATES.itemAdded({
                                    itemName: `${softDrink.name} (${matchedV.name})`,
                                    quantity: entities.quantity || 1,
                                    price: matchedV.price,
                                    nextStepPrompt: nextPrompt,
                                });
                                break;
                            }
                        }
                    }
                    backendReply = resolved.reply;
                    break;
                }

                const isDeal = resolved && (resolved.type === 'DEAL' || resolved.type === 'deal' || Boolean(resolved.deal));
                const isItem = resolved && (resolved.type === 'ITEM' || resolved.type === 'item' || resolved.type === 'MENU_ITEM' || resolved.type === 'menu_item' || Boolean(resolved.item));

                if (isDeal) {
                    const dealObj = resolved.deal;
                    // Check pizza deal flavours
                    if (isPizzaDeal(dealObj)) {
                        const pizzaInfo = getDealPizzaInfo(dealObj);
                        const extractedFlavours = extractFlavoursFromText(resolvedText, pizzaInfo.pizzaCount)
                            .filter(f => typeof f === 'string' && f.trim() && !/^(?:undefined|null)$/i.test(f.trim()));
                        if (extractedFlavours.length < pizzaInfo.pizzaCount) {
                            const firstFlv = (extractedFlavours[0] && !/^(?:undefined|null)$/i.test(extractedFlavours[0])) ? extractedFlavours[0] : null;
                            setPendingDealFlavour(canonicalKey, {
                                deal: dealObj,
                                quantity: entities.quantity || 1,
                                pizzaInfo,
                                firstFlavour: firstFlv,
                            });
                            if (!firstFlv) {
                                backendReply = formatDealFlavourPrompt(dealObj, pizzaInfo);
                            } else {
                                backendReply = formatSingleFlavourConfirmationPrompt(firstFlv, { ...pizzaInfo, deal: dealObj });
                            }
                            break;
                        }
                    }
                    await addItemToCart({
                        sessionKey: canonicalKey,
                        restaurantId: restId,
                        chatId: jid,
                        verifiedPhone: whatsappPhone,
                        dealId: dealObj.id,
                        quantity: entities.quantity || 1,
                    });
                    const nextPrompt = 'Kya aap iske sath kuch aur order karna chahenge (jaise Fries ya Cold Drink), ya order finalize karein? 😊';
                    backendReply = RESPONSE_TEMPLATES.itemAdded({
                        itemName: dealObj.name,
                        quantity: entities.quantity || 1,
                        price: dealObj.deal_price,
                        nextStepPrompt: nextPrompt,
                    });
                } else if (isItem) {
                    const itemObj = resolved.item;
                    const variants = itemObj.variants || [];
                    const hasMultipleSizes = variants.length > 1 && variants.some(v => /small|medium|large|liter|litre|can/i.test(v.name));
                    const explicitSize = entities.size || resolved.extractedSize || (matchVariant(variants, resolvedText)?.name);

                    // Rule C: Mandatory Product Variations (e.g. "Chicken Tandori pizza add kro" -> ask "Small, Medium ya Large?")
                    if (hasMultipleSizes && !explicitSize) {
                        setLastDiscussedItem(canonicalKey, itemObj, null, whatsappPhone);
                        const sizeOptionsStr = variants.map(v => `*${v.name}*`).join(', ');
                        backendReply = `Zabardast choice! *${itemObj.name}* ke liye kaunsa size add karun — ${sizeOptionsStr}? 😊`;
                        break;
                    }

                    let chosenVariant = null;
                    if (variants.length > 0) {
                        chosenVariant = matchVariant(variants, explicitSize || entities.size || resolvedText) || variants[0];
                    }
                    await addItemToCart({
                        sessionKey: canonicalKey,
                        restaurantId: restId,
                        chatId: jid,
                        verifiedPhone: whatsappPhone,
                        menuItemId: itemObj.id,
                        variantId: chosenVariant?.id,
                        quantity: entities.quantity || 1,
                    });
                    setLastDiscussedItem(canonicalKey, itemObj, chosenVariant, whatsappPhone);

                    const nextPrompt = 'Kya aap iske sath kuch aur order karna chahenge (jaise Fries ya Cold Drink), ya order finalize karein? 😊';
                    backendReply = RESPONSE_TEMPLATES.itemAdded({
                        itemName: itemObj.name,
                        quantity: entities.quantity || 1,
                        size: chosenVariant?.name,
                        price: Number(chosenVariant?.price || itemObj.base_price),
                        nextStepPrompt: nextPrompt,
                    });
                } else {
                    let cleanItemName = (query || '').replace(/\b(?:chiye|chahiye|mangwana|daal\s*do|add|kardo|krdo|mujay|mujhe|me|kar\s*do|bhai|yar|please|plz)\b/gi, '').trim();
                    cleanItemName = cleanItemName.replace(/^(?:aik|ek|ik|1|2|3|4|5|one|two|do|teen)\s*(?:x\s+)?/i, '').trim();
                    if (!cleanItemName) cleanItemName = query;
                    backendReply = RESPONSE_TEMPLATES.itemNotInMenu({ itemName: cleanItemName });
                }
                break;
            }

            case 'VIEW_DEALS':
            case 'SHOW_DEALS': {
                const { get_deals } = await import('./toolRegistry.js');
                const dRes = await get_deals({}, toolContext);
                backendReply = dRes.caption;
                backendImageUrls = dRes.imageUrls;
                backendImageUrl = dRes.imageUrl;
                break;
            }

            case 'VIEW_MENU':
            case 'SHOW_MENU': {
                const { get_menu } = await import('./toolRegistry.js');
                const mRes = await get_menu({}, toolContext);
                backendReply = mRes.caption;
                backendImageUrls = mRes.imageUrls;
                backendImageUrl = mRes.imageUrl;
                break;
            }

            case 'VIEW_BOTH':
            case 'SHOW_BOTH': {
                const { get_menu, get_deals } = await import('./toolRegistry.js');
                const mRes = await get_menu({}, toolContext);
                const dRes = await get_deals({}, toolContext);

                if (sock && (jid || canonicalKey)) {
                    try {
                        const { sendWhatsAppMediaOrText } = await import('../utils/media.js');
                        await sendWhatsAppMediaOrText(sock, jid, {
                            imageUrls: mRes.imageUrls,
                            text: '📋 *Cravey Crust Menu:*',
                        });
                        await new Promise(r => setTimeout(r, 600));
                        await sendWhatsAppMediaOrText(sock, jid, {
                            imageUrls: dRes.imageUrls,
                            text: '🔥 *Cravey Crust Deals:*',
                        });
                    } catch (_) {}
                }

                backendReply = 'Cravey Crust ka mukammal Menu aur Deals haazir hain! 🍕🍔🔥\n\nPehle menu aur deals check kar lein. Aap ko in mein se kya order karna hai? Bas naam ya deal number bata dein! 😊';
                backendImageUrls = [...mRes.imageUrls, ...dRes.imageUrls];
                backendImageUrl = mRes.imageUrl;
                break;
            }

            case 'DEAL_QUERY': {
                const dealName = context.referenced_entity?.name || '';
                const isGeneralDealsAsk = !dealName || /^(?:deal|deals|sari\s*deals|all\s*deals)$/i.test(dealName);
                if (isGeneralDealsAsk && !/drink|cold\s*drink|pepsi|coke/i.test(resolvedText)) {
                    const { get_deals } = await import('./toolRegistry.js');
                    const dRes = await get_deals({}, toolContext);
                    backendReply = dRes.caption;
                    backendImageUrls = dRes.imageUrls;
                    backendImageUrl = dRes.imageUrl;
                } else {
                    const { get_deal_details } = await import('./toolRegistry.js');
                    const dDetailRes = await get_deal_details({ dealName: dealName || resolvedText }, { restId });
                    backendReply = dDetailRes.reply;
                }
                break;
            }

            case 'CART_QUERY': {
                if (!hasCartItems) {
                    backendReply = RESPONSE_TEMPLATES.emptyCartConfirmGuard();
                } else {
                    const freshTotals = await calculateCartTotals({ sessionKey: canonicalKey, restaurantId: restId });
                    backendReply = RESPONSE_TEMPLATES.cartSummary({
                        cartLines: activeCartOnlyLines || activeCartSummary,
                        subtotal: freshTotals.subtotal,
                        deliveryFee: freshTotals.deliveryFee,
                        total: freshTotals.total,
                    });
                }
                break;
            }

            case 'REMOVE_ITEM': {
                const itemToRemove = activeCart?.items?.[0];
                if (itemToRemove) {
                    await removeCartItem(itemToRemove.id, canonicalKey);
                    const freshTotals = await calculateCartTotals({ sessionKey: canonicalKey, restaurantId: restId });
                    backendReply = RESPONSE_TEMPLATES.itemRemoved({
                        itemName: itemToRemove.deal ? itemToRemove.deal.name : (itemToRemove.menu_item?.name || 'Item'),
                        updatedTotal: freshTotals.total,
                    });
                } else {
                    backendReply = RESPONSE_TEMPLATES.emptyCartConfirmGuard();
                }
                break;
            }

            case 'PROVIDE_NAME': {
                const name = entities.customer_name || resolvedText.trim();
                updateSessionOrderDetails(canonicalKey, { name, nameExplicit: true }, whatsappPhone);
                backendReply = RESPONSE_TEMPLATES.nameConfirmed({
                    name,
                    nextPrompt: RESPONSE_TEMPLATES.phonePrompt({ name, displayPhone: sessionDetails.phone }),
                });
                break;
            }

            case 'PROVIDE_PHONE': {
                const phone = entities.phone || cleanPhone;
                updateSessionOrderDetails(canonicalKey, { phone, phoneConfirmed: true }, whatsappPhone);
                backendReply = RESPONSE_TEMPLATES.phoneConfirmed({
                    name: sessionDetails.name || 'Customer',
                    phone,
                    nextPrompt: RESPONSE_TEMPLATES.addressPrompt({ name: sessionDetails.name || 'Customer' }),
                });
                break;
            }

            case 'PROVIDE_ADDRESS': {
                const rawAddr = entities.address || resolvedText;
                const cleaned = cleanExtractedAddress(rawAddr);
                const check = await checkDeliveryAvailability({ address: cleaned, restaurantId: restId });
                if (!check.available && check.code === 'ADDRESS_INCOMPLETE') {
                    backendReply = RESPONSE_TEMPLATES.addressIncomplete({ locality: check.areaName || cleaned });
                } else if (!check.available) {
                    backendReply = RESPONSE_TEMPLATES.addressOutOfRange({ maxRadiusKm: check.maxRadiusKm, distanceKm: check.distanceKm });
                } else {
                    updateSessionOrderDetails(canonicalKey, { address: cleaned }, whatsappPhone);
                    backendReply = RESPONSE_TEMPLATES.addressConfirmed({
                        name: sessionDetails.name || 'Customer',
                        address: cleaned,
                        distanceKm: check.distanceKm,
                        nextPrompt: RESPONSE_TEMPLATES.paymentPrompt({ name: sessionDetails.name || 'Customer' }),
                    });
                }
                break;
            }

            case 'CANCEL_ORDER': {
                const cache = await getCatalogCache();
                const { getAdminContact } = await import('./restaurantService.js');
                const adminContact = await getAdminContact(cache?.restId);
                const waLink = `${adminContact.whatsappLink}?text=${encodeURIComponent('Assalam-o-Alaikum Cravey Crust, mujhe apna order cancel / delete karwana hai.')}`;
                backendReply = RESPONSE_TEMPLATES.orderDeletionNotAllowed({
                    adminPhone: adminContact.displayPhone,
                    whatsappLink: waLink,
                });
                break;
            }

            case 'ORDER_STATUS_QUERY': {
                const { getDbClient } = await import('../db/client.js');
                const prisma = getDbClient();
                let activeOrders = [];
                if (prisma) {
                    try {
                        activeOrders = await prisma.order.findMany({
                            where: {
                                order_status: { in: ['CONFIRMED', 'PREPARING', 'READY', 'PENDING', 'OUT_FOR_DELIVERY'] },
                                OR: [
                                    { phone: cleanPhone },
                                    { whatsapp_phone: cleanPhone },
                                    { source_session_id: canonicalKey },
                                    { source_chat_id: canonicalKey },
                                ],
                            },
                            orderBy: { created_at: 'desc' },
                            include: { order_items: true },
                        });
                    } catch (_) {}
                }
                if (activeOrders && activeOrders.length > 0) {
                    backendReply = RESPONSE_TEMPLATES.existingOrdersList({ orders: activeOrders });
                } else {
                    backendReply = RESPONSE_TEMPLATES.noActiveOrders();
                }
                break;
            }

            case 'PAYMENT_QUERY': {
                const payment = /easy\s*paisa|ep/i.test(resolvedText) ? 'EASYPAISA' : 'COD';
                updateSessionOrderDetails(canonicalKey, { paymentMethod: payment }, whatsappPhone);
                backendReply = RESPONSE_TEMPLATES.paymentConfirmed({
                    name: sessionDetails.name || 'Customer',
                    paymentLabel: payment === 'COD' ? 'Cash on Delivery (COD)' : 'EasyPaisa',
                    nextPrompt: RESPONSE_TEMPLATES.extraItemsUpsell({ name: sessionDetails.name || 'Customer' }),
                });
                break;
            }

            case 'PRESERVE_CURRENT_SELECTION': {
                backendReply = RESPONSE_TEMPLATES.selectionPreserved();
                break;
            }

            case 'REFER_TO_PREVIOUS_INFORMATION': {
                const known = [];
                if (sessionDetails.name) known.push(`Naam: *${sessionDetails.name}*`);
                if (sessionDetails.phone) known.push(`Contact: *${sessionDetails.phone}*`);
                if (sessionDetails.address) known.push(`Address: *${sessionDetails.address}*`);
                backendReply = RESPONSE_TEMPLATES.contextRecalled({ knownDetails: known });
                break;
            }

            case 'MENU_QUERY':
            case 'PRODUCT_QUERY':
            case 'PRICE_QUERY': {
                const isCheapest = /\b(?:lowest(?:\s*level)?(?:\s*price)?|cheapest|cheap|sasta|sasti|kam\s*(?:rate|price|qeemat|pese|paise)|low\s*(?:level|price|rate))\b/i.test(resolvedText);
                const isBest = /\b(?:best|famous|mashhoor|top|special|top-selling|favorite|favourite|sab\s*se\s*acha|sb\s*se\s*acha|achi|achha|zabardast|recommend|recommendation)\b/i.test(resolvedText);
                const isZinger = /\b(?:zinger|zingr)\b/i.test(resolvedText);
                const isBurger = !isZinger && /\b(?:burger|burgers)\b/i.test(resolvedText);
                const isPizza = /\b(?:pi[z]+as?)\b/i.test(resolvedText);

                if (isCheapest) {
                    backendReply = RESPONSE_TEMPLATES.cheapestItemsList();
                } else if (isBest) {
                    backendReply = RESPONSE_TEMPLATES.bestItemsList();
                } else if (isZinger) {
                    backendReply = RESPONSE_TEMPLATES.zingerOptionsList();
                } else if (isBurger) {
                    backendReply = RESPONSE_TEMPLATES.burgerOptionsList();
                } else if (isPizza) {
                    backendReply = RESPONSE_TEMPLATES.pizzaFlavoursList();
                } else {
                    backendReply = RESPONSE_TEMPLATES.greeting({ storeName: 'Cravey Crust' });
                }
                break;
            }

            case 'GREETING': {
                backendReply = context.conversational_reply || RESPONSE_TEMPLATES.greeting({ storeName: 'Cravey Crust' });
                break;
            }

            default: {
                const isZinger = /\b(?:zinger|zingr)\b/i.test(resolvedText);
                const isBurger = !isZinger && /\b(?:burger|burgers)\b/i.test(resolvedText);
                const isPizza = /\b(?:pi[z]+as?)\b/i.test(resolvedText);
                const isCheapest = /\b(?:lowest(?:\s*level)?(?:\s*price)?|cheapest|cheap|sasta|sasti|kam\s*(?:rate|price|qeemat|pese|paise)|low\s*(?:level|price|rate))\b/i.test(resolvedText);
                const isBest = /\b(?:best|famous|mashhoor|top|special|top-selling|favorite|favourite|sab\s*se\s*acha|sb\s*se\s*acha|achi|achha|zabardast|recommend|recommendation)\b/i.test(resolvedText);
                const isAskingProductOrMenu = isZinger || isBurger || isPizza || isCheapest || isBest ||
                    /\b(?:wings|fries|deal|deals|menu|khana|item|items|price|rate|options|batao|btao|batoo|kon|konsa|konse)\b/i.test(resolvedText);

                if (isCheapest) {
                    backendReply = RESPONSE_TEMPLATES.cheapestItemsList();
                } else if (isBest) {
                    backendReply = RESPONSE_TEMPLATES.bestItemsList();
                } else if (isZinger) {
                    backendReply = RESPONSE_TEMPLATES.zingerOptionsList();
                } else if (isBurger) {
                    backendReply = RESPONSE_TEMPLATES.burgerOptionsList();
                } else if (isPizza) {
                    backendReply = RESPONSE_TEMPLATES.pizzaFlavoursList();
                } else if (hasCartItems && sessionDetails.awaitingFinalConfirmation && !sessionDetails.name) {
                    backendReply = RESPONSE_TEMPLATES.namePrompt();
                } else if (hasCartItems && !sessionDetails.name && !isAskingProductOrMenu) {
                    backendReply = 'Zabardast! Cart mein items shamil hain. Kya aap is order ko confirm/finalize karna chahte hain ya mazeed kuch add karoon? 😊';
                } else if (hasCartItems && !sessionDetails.phoneConfirmed) {
                    backendReply = RESPONSE_TEMPLATES.phonePrompt({ name: sessionDetails.name, displayPhone: sessionDetails.phone });
                } else if (hasCartItems && !sessionDetails.address) {
                    backendReply = RESPONSE_TEMPLATES.addressPrompt({ name: sessionDetails.name });
                } else {
                    backendReply = RESPONSE_TEMPLATES.greeting({ storeName: 'Cravey Crust' });
                }
                break;
            }
        }

        // ── Universal Safeguard: Ensure no requested items from multi-product orders were dropped ──
        try {
            const isOrderPlacement = /\b(?:kr\s*d[aou]+n?|kar\s*d[aou]+n?|kardo|krdo|krdu|kardu|karein|kar\s*dein|kr\s*dein|kar\s*dain|kr\s*dain|karden|order\s*(?:karo|kro|krna|karna|dein|dain|do)|chahiye|mangwao|bhejo|bhej\s*do|daal\s*do|add)\b/i.test(resolvedText);
            if (isOrderPlacement && !confirmIntent) {
                const { extractRequestedItems } = await import('./addonExtractionService.js');
                const extractedCheck = extractRequestedItems(resolvedText);
                if (extractedCheck?.items?.length > 0) {
                    const latestCart = await getActiveCart({ sessionKey: canonicalKey, restaurantId: restId, chatId: jid });
                    const missingItems = extractedCheck.items.filter(req => {
                        return !(latestCart?.items || []).some(ci => {
                            const cName = (ci.menu_item?.name || ci.deal?.name || ci.name || '').toLowerCase();
                            const rName = (req.itemName || req.canonicalName || '').toLowerCase();
                            const nameMatch = cName && rName && (cName.includes(rName) || rName.includes(cName));
                            const idMatch = req.menuItemId ? (ci.menu_item_id === req.menuItemId || ci.menu_item?.id === req.menuItemId) : false;
                            const dealMatch = req.dealId ? (ci.deal_id === req.dealId || ci.deal?.id === req.dealId) : false;
                            return idMatch || dealMatch || nameMatch;
                        });
                    });

                    if (missingItems.length > 0) {
                        for (const mItem of missingItems) {
                            await addItemToCart({
                                sessionKey: canonicalKey,
                                restaurantId: restId,
                                chatId: jid,
                                verifiedPhone: whatsappPhone,
                                menuItemId: mItem.menuItemId || null,
                                variantId: mItem.variantId || null,
                                dealId: mItem.dealId || null,
                                quantity: mItem.quantity || 1,
                            });
                        }
                    }
                }
            }
        } catch (safeguardErr) {
            console.error('[ORCHESTRATOR] Multi-item safeguard error:', safeguardErr.message);
        }

        const cleanFinalReply = sanitizeOutput(backendReply);
        appendSessionHistory(canonicalKey, 'user', resolvedText, syncEpoch);
        if (cleanFinalReply) {
            appendSessionHistory(canonicalKey, 'assistant', cleanFinalReply, syncEpoch);
        }

        return {
            text: cleanFinalReply,
            imageUrl: backendImageUrl || (backendImageUrls[0] || null),
            imageUrls: backendImageUrls,
        };
    } finally {
        _inFlightMessages.delete(canonicalKey);
        _lastProcessedMessages.set(canonicalKey, { normalizedText, timestamp: Date.now() });
    }
}
