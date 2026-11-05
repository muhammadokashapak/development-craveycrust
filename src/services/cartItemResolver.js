/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║   Cart Item Resolver — src/services/cartItemResolver.js      ║
 * ║   Intelligent Cart-Item Matching & Removal Architecture     ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import { removeCartItem, updateCartItem, getActiveCart } from './cartService.js';
import { calculatePricing } from './pricingService.js';

const NUM_MAP = {
    '1': 1, 'ak': 1, 'aik': 1, 'ek': 1, 'ik': 1, 'one': 1,
    '2': 2, 'do': 2, 'doo': 2, 'two': 2,
    '3': 3, 'teen': 3, 'tin': 3, 'three': 3,
    '4': 4, 'char': 4, 'chaar': 4, 'four': 4,
    '5': 5, 'paanch': 5, 'panch': 5, 'five': 5,
    '6': 6, 'che': 6, 'chey': 6, 'chay': 6, 'six': 6,
    '7': 7, 'saat': 7, 'sat': 7, 'seven': 7,
    '8': 8, 'aath': 8, 'ath': 8, 'eight': 8,
    '9': 9, 'nau': 9, 'no': 9, 'nine': 9,
    '10': 10, 'das': 10, 'dus': 10, 'ten': 10,
    '15': 15, 'pandrah': 15, 'fifteen': 15,
    '20': 20, 'bees': 20, 'twenty': 20,
};

/**
 * Normalizes text variations in spelling and plurals (Roman Urdu / English)
 */
function normalizeQuery(str) {
    return (str || '')
        .toLowerCase()
        .replace(/\bzeggy\b/g, 'zegy')
        .replace(/\bziggy\b/g, 'zegy')
        .replace(/\bburgers\b/g, 'burger')
        .replace(/\bdrinks\b/g, 'drink')
        .replace(/\bpizzas\b/g, 'pizza')
        .replace(/\bfries\b/g, 'fries')
        .replace(/\bwings\b/g, 'wing')
        .replace(/\bnuggets\b/g, 'nugget')
        .replace(/\brolls\b/g, 'roll');
}

/**
 * Detect explicit removal / deletion intent across Roman Urdu, Urdu and English
 */
export function isRemovalIntent(text) {
    if (!text || typeof text !== 'string') return false;
    const lower = text.trim().toLowerCase();

    // Direct removal verbs in Roman Urdu / English
    const hasRemovalWord = /\b(?:remove|remov|delete|delet|hata|hatao|hatado|hata\s*d[aoeiu]+n?|nikal|nikalo|nikaldo|nikal\s*d[aoeiu]+n?|minus|kam\s*(?:kr|kar|karo|kardo|krdo|karein)|chhor\s*do|rehne\s*do|rehn\s*do|cancel\s*(?:kr|kar)?)\b/i.test(lower);

    // Negative desire / English removal
    const hasNegativeDesire = /\b(?:nahi\s*chahiye|mat\s*dena|mat\s*bhejna|nahi\s*lena|nahi\s*mangwana|nhi\s*chahiye|nahi\s*chaiye)\b/i.test(lower) ||
        /\b(?:take\s*(?:the\s*)?(?:[a-z0-9.]+\s*)*(?:out|off)|take\s*out|take\s*off|drop|omit|leave\s*out|without)\b/i.test(lower) ||
        /\b(?:don'?t\s*want|do\s*not\s*want|remove\s+from\s+(?:the\s+)?order)\b/i.test(lower);

    // Keep deal but remove component
    const hasDealKeepExclusion = /\b(?:sirf\s*([a-z0-9\s]+)\s*rehne\s*do|deal\s*rehne\s*do\s*drink\s*hata\s*do|keep\s*the\s*deal\s*but\s*remove)\b/i.test(lower);

    // Quantity correction (e.g. "maine to sirf 1 bola tha")
    const isQtyCorrection = /\b(?:mny|maine|mene|me\s*ne)\s+(?:to\s+)?(?:sirf\s+)?(?:deal\s*#?\s*\d+|[a-z]+)\s*(?:sirf\s+)?(?:\d+|ak|aik|ek|ik|one)\s*(?:ki\s*thi|kahi\s*thi|boli\s*thi|mangwayi\s*thi|order\s*ki\s*thi)\b/i.test(lower) ||
        /\b(?:deal\s*#?\s*\d+|[a-z]+)\s*(?:sirf\s+)?(?:\d+|ak|aik|ek|ik|one)\s*(?:ki\s*thi|kahi\s*thi|boli\s*thi|chahiye\s*thi)\b/i.test(lower) ||
        /\b(?:sirf\s+(?:\d+|ak|aik|ek|ik|one)\s*(?:deal\s*#?\s*\d+|[a-z]+)\s*(?:chahiye|rakho|rakhein|kr\s*do|kar\s*do))\b/i.test(lower);

    return hasRemovalWord || hasNegativeDesire || hasDealKeepExclusion || isQtyCorrection;
}

/**
 * Check if the input represents a cancellation of the pending clarification (e.g. "nahi rehne do", "cancel")
 */
export function isPendingActionCancellation(text) {
    if (!text || typeof text !== 'string') return false;
    const lower = text.trim().toLowerCase();
    return /^(?:nahi|nahin|na|no|nope|cancel|rehne\s*do|rehn\s*do|chhor\s*do|choro|kuch\s*nahi|mat\s*hatao|mat\s*nikalo)[\s.!?]*$/i.test(lower) ||
        /\b(?:nahi\s*rehne\s*do|rehne\s*do\s*kuch\s*mat\s*hatao|kuch\s*nahi\s*hatana)\b/i.test(lower);
}

/**
 * Resolves the target item from cart for removal
 * @param {object} params
 * @param {object} params.cart Cart object with items
 * @param {string} params.text User message
 * @param {object} [params.pendingAction] Active pending action if any
 * @returns {object} Resolution result
 */
export function resolveCartItemForRemoval({ cart, text, pendingAction = null }) {
    if (!cart?.items || cart.items.length === 0) {
        return { status: 'EMPTY_CART' };
    }

    const rawLower = (text || '').trim().toLowerCase();
    const lower = normalizeQuery(rawLower);

    // ── 1. Check for Deal Component Restriction (e.g. "deal ki drink remove kr do") ──
    const isDealComponentTarget = /\b(?:deal|deal\s*#?\d+|package|combo)\s*(?:ki|k|wali|mai\s*se|se)?\s*(?:drink|pepsi|coke|burger|fries|wings)\b/i.test(lower) ||
        /\b(?:drink|pepsi|coke|burger|fries|wings)\s*(?:from|se|ki)\s*(?:deal|deal\s*#?\d+)\b/i.test(lower);

    if (isDealComponentTarget) {
        const dealItem = cart.items.find(i => Boolean(i.deal || i.deal_id));
        const dealName = dealItem?.deal ? dealItem.deal.name : 'Deal';
        return {
            status: 'DEAL_COMPONENT_RESTRICTION',
            dealName,
            component: 'Drink',
            message: `Soft Drink *${dealName}* ka lazmi hissa hai aur deal se alag remove nahi ki ja sakti. Agar aap pura deal change ya remove karna chahein to batayein! 😊`,
        };
    }

    // ── 2. Extract Requested Quantity ──
    let qtyToRemove = null;
    const qtyMatch = lower.match(/\b(\d+|ak|aik|ek|ik|one|two|teen|tin|char|chaar|four|paanch|panch|five|che|chey|six|saat|sat|seven|aath|ath|eight|nau|no|nine|das|dus|ten|pandrah|fifteen|bees|twenty)\s*(?:x\s+)?/i);
    if (qtyMatch) {
        qtyToRemove = NUM_MAP[qtyMatch[1].toLowerCase()] || parseInt(qtyMatch[1], 10) || null;
    } else {
        const postQty = lower.match(/\b(?:remove|hata|nikal|delete)\s*(?:kr\s*do|kardo)?\s*(\d+|ak|aik|ek|ik|one|two|teen|tin|char|chaar|four|paanch|panch|five)\b/i);
        if (postQty) {
            qtyToRemove = NUM_MAP[postQty[1].toLowerCase()] || parseInt(postQty[1], 10) || null;
        }
    }

    // ── 3. Check if answering a pending REMOVE_ITEM clarification ──
    if (pendingAction && pendingAction.action === 'REMOVE_ITEM') {
        const candidates = pendingAction.candidateIds
            ? cart.items.filter(i => pendingAction.candidateIds.includes(i.id))
            : cart.items;

        if (candidates.length > 0) {
            // Check if user answered with a size / variant (e.g. "1.5 liter", "1 liter", "regular", "can")
            const variantQueryMatch = lower.match(/\b(1\.5\s*liter|1\.5l|1\s*liter|1l|regular|reg|large|bari|can|cans|tin|tins|small|medium|party)\b/i);
            if (variantQueryMatch) {
                let vQuery = variantQueryMatch[1].replace(/\s+/g, ' ');
                if (vQuery === '1.5l') vQuery = '1.5 liter';
                if (vQuery === '1l') vQuery = '1 liter';
                if (vQuery === 'reg') vQuery = 'regular';
                if (vQuery === 'bari') vQuery = 'large';
                if (vQuery === 'cans') vQuery = 'can';
                if (vQuery === 'tins') vQuery = 'tin';
                const matchedByVariant = candidates.filter(i => {
                    const vName = (i.menu_variant?.name || '').toLowerCase();
                    const notes = (i.notes || '').toLowerCase();
                    const itName = (i.menu_item?.name || '').toLowerCase();
                    return vName.includes(vQuery) || notes.includes(vQuery) || itName.includes(vQuery);
                });
                if (matchedByVariant.length > 0) {
                    return {
                        status: 'MATCH_FOUND',
                        item: matchedByVariant[0],
                        qtyToRemove: qtyToRemove || null,
                    };
                }
            }

            // Check if user named product directly (e.g. "5 zeggy burgers", "zegy burger", "soft drink")
            const cleanClarification = lower
                .replace(/\b(?:acha|achha|accha|theek|thek|sahi|ok|okay|ab|aur|bas|sirf|plz|please|bhai|yaar|yar|ji|jee|janab|sunen|suno|meherbani|shukriya)\b/gi, '')
                .replace(/\b(?:remove|hata|hatayein|hatao|hatado|nikal|nikalo|nikalein|nikaldo|delete|khatam|cancel|rehne\s*do|mat\s*bhejo)\b/gi, '')
                .replace(/\b(?:kr\s*d[aou]+n?|kar\s*d[aou]+n?|kardo|krdo|krdu|kardu|karein|kar\s*dein|kr\s*dein|kar\s*dain|kr\s*dain|karden)\b/gi, '')
                .replace(/\b(?:cart\s*se|order\s*se|se|main\s*se|mein\s*se|bhi|to|mera|meri|mujhe|mujay|apne|wal[aie]|wali)\b/gi, '')
                .replace(/\b(?:\d+|ak|aik|ek|ik|one|two|teen|tin|char|chaar|four|paanch|panch|five|che|chey|six|saat|sat|seven|aath|ath|eight|nau|no|nine|das|dus|ten|pandrah|fifteen|bees|twenty)\s*(?:x\s+)?/gi, '')
                .replace(/\s+/g, ' ')
                .trim();

            const matchedDirectly = candidates.filter(i => {
                const itName = normalizeQuery(i.menu_item?.name || i.deal?.name || '');
                const itSlug = normalizeQuery(i.menu_item?.slug || i.deal?.slug || '');
                const itNotes = normalizeQuery(i.notes || '');
                const combined = `${itName} ${itSlug} ${itNotes}`;
                if (cleanClarification && (combined.includes(cleanClarification) || cleanClarification.includes(itName))) {
                    return true;
                }
                if (cleanClarification.includes('drink') && (itName.includes('drink') || itName.includes('pepsi') || itName.includes('coke'))) {
                    return true;
                }
                if (cleanClarification.includes('burger') && (itName.includes('burger') || itName.includes('zinger') || itName.includes('zegy'))) {
                    return true;
                }
                return false;
            });

            if (matchedDirectly.length === 1) {
                return {
                    status: 'MATCH_FOUND',
                    item: matchedDirectly[0],
                    qtyToRemove: qtyToRemove || null,
                };
            } else if (matchedDirectly.length > 1) {
                return {
                    status: 'AMBIGUOUS',
                    candidates: matchedDirectly,
                    clarificationMessage: `Aap ke cart mein multiple matching items hain. Baraye meherbani batayein ke aap ko kaunsa item hatana hai?`,
                };
            }
        }
    }

    // ── 4. Target Specific Deal Removal (e.g. "deal 4 remove kr do", "deal 3 hata do") ──
    const dealMatch = lower.match(/\bdeal\s*#?\s*(\d+)\b/i) || lower.match(/\b(\d+)\s*deal\b/i);
    const targetDealNum = dealMatch ? parseInt(dealMatch[1], 10) : null;
    if (targetDealNum) {
        const matchingDeals = cart.items.filter(i => {
            const dName = (i.deal?.name || '').toLowerCase();
            const dSlug = (i.deal?.slug || '').toLowerCase();
            const dId = (i.deal?.id || i.deal_id || '').toLowerCase();
            return dName.includes(`deal ${targetDealNum}`) ||
                   dName.includes(`deal #${targetDealNum}`) ||
                   dSlug.includes(`deal-${targetDealNum}`) ||
                   dSlug.includes(`deal${targetDealNum}`) ||
                   dId === `deal-${targetDealNum}` ||
                   dId === `deal${targetDealNum}`;
        });

        if (matchingDeals.length > 0) {
            return {
                status: 'MATCH_FOUND',
                item: matchingDeals[0],
                qtyToRemove: qtyToRemove || null,
            };
        }
        return {
            status: 'NOT_FOUND',
            searchedName: `Deal ${targetDealNum}`,
        };
    }

    // ── 4b. Direct Item / Flavor Matching against items currently in Cart ──
    // e.g. "acha 5x zeggy burgers remove kr do", "behari kebab remove kr dain", "chicken tikka hata do"
    const cleanItemQuery = lower
        .replace(/\b(?:acha|achha|accha|theek|thek|sahi|ok|okay|ab|aur|bas|sirf|plz|please|bhai|yaar|yar|ji|jee|janab|sunen|suno|meherbani|shukriya)\b/gi, '')
        .replace(/\b(?:remove|hata|hatayein|hatao|hatado|nikal|nikalo|nikalein|nikaldo|delete|khatam|cancel|rehne\s*do|mat\s*bhejo)\b/gi, '')
        .replace(/\b(?:kr\s*d[aou]+n?|kar\s*d[aou]+n?|kardo|krdo|krdu|kardu|karein|kar\s*dein|kr\s*dein|kar\s*dain|kr\s*dain|karden)\b/gi, '')
        .replace(/\b(?:cart\s*se|order\s*se|se|main\s*se|mein\s*se|bhi|to|mera|meri|mujhe|mujay|apne|wal[aie]|wali)\b/gi, '')
        .replace(/\b(?:\d+|ak|aik|ek|ik|one|two|teen|tin|char|chaar|four|paanch|panch|five|che|chey|six|saat|sat|seven|aath|ath|eight|nau|no|nine|das|dus|ten|pandrah|fifteen|bees|twenty)\s*(?:x\s+)?/gi, '')
        .replace(/\s+/g, ' ')
        .trim();

    if (cleanItemQuery.length >= 3) {
        const directMatches = cart.items.filter(i => {
            const iName = normalizeQuery(i.menu_item?.name || i.deal?.name || '');
            const vName = normalizeQuery(i.menu_variant?.name || '');
            const notes = normalizeQuery(i.notes || '');
            const slug = normalizeQuery(i.menu_item?.slug || i.deal?.slug || '');
            const combined = `${iName} ${vName} ${notes} ${slug}`.toLowerCase();

            // 1. Direct substring in item name or notes
            if (combined.includes(cleanItemQuery) || cleanItemQuery.includes(iName)) {
                return true;
            }

            // 2. All words in cleanItemQuery match combined text
            const qWords = cleanItemQuery.split(/\s+/).filter(w => w.length >= 3);
            if (qWords.length > 0 && qWords.every(w => combined.includes(w))) {
                return true;
            }

            return false;
        });

        if (directMatches.length === 1) {
            return {
                status: 'MATCH_FOUND',
                item: directMatches[0],
                qtyToRemove: qtyToRemove || null,
            };
        } else if (directMatches.length > 1) {
            // Check if one item has a closer/more specific match
            const exactNameMatch = directMatches.filter(i => {
                const iName = normalizeQuery(i.menu_item?.name || i.deal?.name || '');
                return iName.includes(cleanItemQuery);
            });
            if (exactNameMatch.length === 1) {
                return {
                    status: 'MATCH_FOUND',
                    item: exactNameMatch[0],
                    qtyToRemove: qtyToRemove || null,
                };
            }
            const listText = directMatches.map(it => {
                const n = it.deal ? it.deal.name : (it.menu_item?.name || 'Item');
                const v = it.menu_variant?.name ? ` (${it.menu_variant.name})` : '';
                return `• ${it.quantity}x ${n}${v}`;
            }).join('\n');
            return {
                status: 'AMBIGUOUS',
                candidates: directMatches,
                clarificationMessage: `Aap ke cart mein multiple matching items hain:\n${listText}\n\nBaraye meherbani batayein ke aap ko kaunsa item remove karna hai?`,
            };
        }
    }

    // ── 5. Standalone Product Matching (Separate from Deals) ──
    // Standalone items in cart (NOT bundled inside deals)
    const standaloneItems = cart.items.filter(i => !i.deal && !i.deal_id);

    // Detect Drink Keyword
    const isDrinkQuery = /\b(drinks?|soft\s*drinks?|cold\s*drinks?|pepsi|coke|next\s*cola|7up|dew|sprite|fanta|mirinda|water|tins?|cans?)\b/i.test(lower);
    const isBurgerQuery = /\b(burgers?|zingers?|ziggy|zegy|zeggy|chicken\s*burgers?|crispy\s*burgers?)\b/i.test(lower);
    const isFriesQuery = /\b(fries?|loaded\s*fries?)\b/i.test(lower);
    const isPizzaQuery = /\b(pizzas?)\b/i.test(lower);
    const isWingsQuery = /\b(wings?|hot\s*wings?|oven\s*baked)\b/i.test(lower);
    const isRollQuery = /\b(rolls?|behari\s*rolls?)\b/i.test(lower);
    const isPastaQuery = /\b(pastas?|alfredo)\b/i.test(lower);
    const isNuggetsQuery = /\b(nuggets?)\b/i.test(lower);
    const isSnackboxQuery = /\b(snackbox(es)?|snack\s*box(es)?|half\s*box(es)?|platters?|box(es)?)\b/i.test(lower);

    let matchingStandalone = [];

    if (isDrinkQuery) {
        matchingStandalone = standaloneItems.filter(i => {
            const n = (i.menu_item?.name || i.notes || '').toLowerCase();
            const slug = (i.menu_item?.slug || '').toLowerCase();
            return n.includes('drink') || n.includes('pepsi') || n.includes('coke') ||
                   slug.includes('drink') || slug.includes('pepsi') || slug.includes('coke') ||
                   /beverage|tin|can|liter/i.test(n);
        });
    } else if (isBurgerQuery) {
        matchingStandalone = standaloneItems.filter(i => {
            const n = (i.menu_item?.name || i.notes || '').toLowerCase();
            return n.includes('burger') || n.includes('zinger') || n.includes('ziggy') || n.includes('zegy') || n.includes('zeggy');
        });
    } else if (isFriesQuery) {
        matchingStandalone = standaloneItems.filter(i => {
            const n = (i.menu_item?.name || i.notes || '').toLowerCase();
            return n.includes('fries');
        });
    } else if (isPizzaQuery) {
        matchingStandalone = standaloneItems.filter(i => {
            const n = (i.menu_item?.name || i.notes || '').toLowerCase();
            return n.includes('pizza');
        });
    } else if (isWingsQuery) {
        matchingStandalone = standaloneItems.filter(i => {
            const n = (i.menu_item?.name || i.notes || '').toLowerCase();
            return n.includes('wings');
        });
    } else if (isRollQuery) {
        matchingStandalone = standaloneItems.filter(i => {
            const n = (i.menu_item?.name || i.notes || '').toLowerCase();
            return n.includes('roll');
        });
    } else if (isPastaQuery) {
        matchingStandalone = standaloneItems.filter(i => {
            const n = (i.menu_item?.name || i.notes || '').toLowerCase();
            return n.includes('pasta') || n.includes('alfredo');
        });
    } else if (isNuggetsQuery) {
        matchingStandalone = standaloneItems.filter(i => {
            const n = (i.menu_item?.name || i.notes || '').toLowerCase();
            return n.includes('nugget');
        });
    } else if (isSnackboxQuery) {
        matchingStandalone = standaloneItems.filter(i => {
            const n = (i.menu_item?.name || i.notes || '').toLowerCase();
            return n.includes('snack') || n.includes('box') || n.includes('platter');
        });
    }

    // If a variant/size was mentioned (e.g. "1.5 liter", "regular", "large"), refine filter
    const variantMatch = lower.match(/\b(1\.5\s*liter|1\.5l|1\s*liter|1l|regular|reg|large|bari|can|cans|tin|tins|small|medium|party)\b/i);
    if (variantMatch && matchingStandalone.length > 0) {
        let vQuery = variantMatch[1].replace(/\s+/g, ' ');
        if (vQuery === '1.5l') vQuery = '1.5 liter';
        if (vQuery === '1l') vQuery = '1 liter';
        if (vQuery === 'reg') vQuery = 'regular';
        if (vQuery === 'bari') vQuery = 'large';
        if (vQuery === 'cans') vQuery = 'can';
        if (vQuery === 'tins') vQuery = 'tin';
        const vFiltered = matchingStandalone.filter(i => {
            const vName = (i.menu_variant?.name || '').toLowerCase();
            const notes = (i.notes || '').toLowerCase();
            const itName = (i.menu_item?.name || '').toLowerCase();
            return vName.includes(vQuery) || notes.includes(vQuery) || itName.includes(vQuery);
        });
        if (vFiltered.length > 0) {
            matchingStandalone = vFiltered;
        }
    }

    // ── Case A: Exactly ONE matching standalone item exists ──
    if (matchingStandalone.length === 1) {
        return {
            status: 'MATCH_FOUND',
            item: matchingStandalone[0],
            qtyToRemove: qtyToRemove || null,
        };
    }

    // ── Case B: Multiple matching standalone items exist ──
    if (matchingStandalone.length > 1) {
        const categoryLabel = isDrinkQuery ? 'drinks' : 'items';
        const listText = matchingStandalone.map((it, idx) => {
            const n = it.menu_item?.name || 'Item';
            const v = it.menu_variant?.name ? ` (${it.menu_variant.name})` : '';
            return `• ${it.quantity}x ${n}${v}`;
        }).join('\n');
        return {
            status: 'AMBIGUOUS',
            categoryLabel,
            candidates: matchingStandalone,
            clarificationMessage: `Aap ke cart mein multiple ${categoryLabel} hain:\n${listText}\n\nBaraye meherbani batayein ke aap ko kaunsa item remove karna hai?`,
        };
    }

    // ── Case C: No matching standalone item, but product exists inside a deal ──
    if (matchingStandalone.length === 0 && (isDrinkQuery || isBurgerQuery || isFriesQuery)) {
        const dealWithComponent = cart.items.find(i => Boolean(i.deal || i.deal_id));
        if (dealWithComponent) {
            const dName = dealWithComponent.deal ? dealWithComponent.deal.name : 'Deal';
            const compName = isDrinkQuery ? 'Soft Drink' : (isBurgerQuery ? 'Burger' : 'Fries');
            return {
                status: 'DEAL_COMPONENT_RESTRICTION',
                dealName: dName,
                component: compName,
                message: `${compName} *${dName}* ka lazmi hissa hai aur deal se alag remove nahi ki ja sakti. Agar aap pura deal change ya remove karna chahein to batayein! 😊`,
            };
        }
    }

    // ── Case D: Customer asked to remove item not in cart ──
    if (isDrinkQuery || isBurgerQuery || isFriesQuery || isPizzaQuery || isWingsQuery || isRollQuery) {
        const itemType = isDrinkQuery ? 'Soft Drink' : (isBurgerQuery ? 'Burger' : (isFriesQuery ? 'Fries' : (isPizzaQuery ? 'Pizza' : 'Item')));
        return {
            status: 'NOT_FOUND',
            searchedName: itemType,
            message: `Aap ke cart mein koi standalone *${itemType}* shamil nahi hai.`,
        };
    }

    // ── Case E: Contextual Pronoun ("isko hata do", "ye wala nikal do") ──
    const isContextual = /\b(?:wo|woh|ye|yeh|isko|isay|isey|usko|usay|usey|meri|mera|last|aakhri|this)\b/i.test(lower);
    if (isContextual || cart.items.length === 1) {
        const latest = cart.items[cart.items.length - 1];
        return {
            status: 'MATCH_FOUND',
            item: latest,
            qtyToRemove: qtyToRemove || null,
        };
    }

    // ── Case F: Completely ambiguous (e.g. customer just said "remove kr do" or "hata do") ──
    const allSummary = cart.items.map(i => `• ${i.quantity}x ${i.deal ? i.deal.name : (i.menu_item?.name || 'Item')}${i.menu_variant?.name ? ' (' + i.menu_variant.name + ')' : ''}`).join('\n');
    return {
        status: 'AMBIGUOUS',
        candidates: cart.items,
        clarificationMessage: `Aap kaunsa item remove karna chahenge? Aap ke cart mein yeh items shamil hain:\n${allSummary}\n\nBaraye meherbani batayein ke aap ko kaunsa item hatana hai?`,
    };
}

/**
 * Execute removal atomically and recalculate pricing
 */
export async function executeCartItemRemoval({ sessionKey, restaurantId, resolution, cart }) {
    const targetItem = resolution.item;
    const currentQty = targetItem.quantity || 1;
    const qtySpecified = resolution.qtyToRemove != null && !isNaN(resolution.qtyToRemove);
    const qtyToRemove = qtySpecified ? Number(resolution.qtyToRemove) : currentQty;

    const baseName = targetItem.deal ? targetItem.deal.name : (targetItem.menu_item?.name || 'Item');
    const varName = targetItem.menu_variant?.name ? ` (${targetItem.menu_variant.name})` : '';
    const fullItemName = `${baseName}${varName}`;

    let removedQtyText = '';

    if (qtySpecified && qtyToRemove < currentQty) {
        const newQty = currentQty - qtyToRemove;
        removedQtyText = qtyToRemove > 1 ? `${qtyToRemove}x ` : '';
        await updateCartItem({
            sessionKey,
            cartItemId: targetItem.id,
            quantity: newQty,
        });
    } else {
        removedQtyText = currentQty > 1 ? `${currentQty}x ` : '';
        await removeCartItem({
            sessionKey,
            cartItemId: targetItem.id,
        });
    }

    // Retrieve fresh cart after modification
    const updatedCart = await getActiveCart({ sessionKey, restaurantId });

    // Recalculate authoritative pricing
    const itemsForPricing = (updatedCart.items || []).filter(i => !i.deal_id && !i.deal).map(i => ({
        menuItemId: i.menu_item_id || i.menu_item?.id || i.menu_item?.slug,
        variantId: i.menu_variant_id || i.menu_variant?.id,
        quantity: i.quantity,
    }));
    const dealsForPricing = (updatedCart.items || []).filter(i => i.deal_id || i.deal).map(i => ({
        dealId: i.deal_id || i.deal?.id || i.deal?.slug,
        quantity: i.quantity,
        notes: i.notes,
    }));

    const pricing = await calculatePricing({
        restaurantId,
        items: itemsForPricing,
        deals: dealsForPricing,
    }).catch(() => ({
        subtotal: (updatedCart.items || []).reduce((s, it) => s + (Number(it.deal?.deal_price ?? it.menu_variant?.price ?? it.menu_item?.base_price ?? 0) * it.quantity), 0),
        deliveryFee: 0,
        discountTotal: 0,
        total: (updatedCart.items || []).reduce((s, it) => s + (Number(it.deal?.deal_price ?? it.menu_variant?.price ?? it.menu_item?.base_price ?? 0) * it.quantity), 0),
    }));

    return {
        success: true,
        removedItemName: fullItemName,
        removedQtyText,
        updatedCart,
        pricing,
    };
}

