/**
 * ╔══════════════════════════════════════════╗
 * ║  Sender Identity — utils/senderIdentity.js ║
 * ║  Safe resolution of WhatsApp sender JIDs ║
 * ║  including @lid ↔ phone-number mapping.  ║
 * ╚══════════════════════════════════════════╝
 *
 * Rules:
 *  - NEVER convert an @lid value into a phone number
 *  - If phone cannot be safely verified, phone = "" and phoneVerified = false
 *  - Never throw — always return a safe fallback identity object
 *  - ESM compatible, zero external dependencies
 *
 * Baileys v6.7.21 sets the following fields on msg.key (when available from WA):
 *   msg.key.senderLid       — @lid JID of the sender (private chats)
 *   msg.key.senderPn        — @s.whatsapp.net phone JID of the sender
 *   msg.key.participant     — sender JID in group messages
 *   msg.key.participantPn   — @s.whatsapp.net phone JID for group participant
 *   msg.key.participantLid  — @lid for group participant
 *
 * These come from WhatsApp stanza attrs: sender_lid, sender_pn, participant_pn, participant_lid
 * and are decoded inside Baileys' decodeMessageNode() without any mapping API needed.
 */

// ─── JID Type Guards ──────────────────────────────────────

/**
 * Returns true ONLY when jid is a verified phone-number JID.
 * The only safe phone-number JID format in Baileys is @s.whatsapp.net.
 *
 * @param {string|undefined|null} jid
 * @returns {boolean}
 */
export function isPhoneJid(jid) {
    if (typeof jid !== 'string' || !jid) return false;
    return jid.endsWith('@s.whatsapp.net');
}

/**
 * Returns true when jid is a Linked-ID (LID) JID.
 * A LID must NEVER be converted directly to a phone number.
 *
 * @param {string|undefined|null} jid
 * @returns {boolean}
 */
export function isLidJid(jid) {
    if (typeof jid !== 'string' || !jid) return false;
    return jid.endsWith('@lid');
}

/**
 * Clean Pakistani phone number:
 * - 92XXXXXXXXXX (12 digits) → 03XXXXXXXXXX (local 11 digits)
 * - Strip @lid, device suffix, non-digits
 * - If @lid, return empty string (NEVER convert LID to phone)
 *
 * @param {string|undefined|null} rawPhone
 * @returns {string}
 */
export function cleanWhatsAppPhone(rawPhone) {
    if (!rawPhone || typeof rawPhone !== 'string') return '';
    let phone = rawPhone.trim();

    // Never convert @lid
    if (phone.includes('@lid')) return '';

    // Strip @s.whatsapp.net and device suffix (:1 etc.)
    phone = phone.replace(/@s\.whatsapp\.net.*/, '').replace(/:.*$/, '');

    // Only digits
    phone = phone.replace(/\D/g, '');

    // 923XXXXXXXXX (12 digits) → 03XXXXXXXXX (11 digits)
    if (phone.startsWith('92') && phone.length === 12) {
        phone = '0' + phone.slice(2);
    }

    return phone;
}


/**
 * Extract a clean numeric phone string from a verified @s.whatsapp.net JID.
 * Returns "" if the JID is not a safe phone-number JID.
 *
 * @param {string|undefined|null} jid
 * @returns {string}
 */
export function normalizePhoneFromJid(jid) {
    if (!isPhoneJid(jid)) return '';
    const user = jid.split('@')[0].split(':')[0];
    const digits = user.replace(/\D/g, '');
    return digits;
}

// ─── Main Identity Resolver ───────────────────────────────

/**
 * Resolve the verified sender identity from a Baileys message.
 *
 * Priority order for phone-number JID resolution:
 *   1. msg.key.senderPn        — WhatsApp-provided PN JID for private chats
 *   2. msg.key.participantPn   — WhatsApp-provided PN JID for group participants
 *   3. msg.key.participant     — if it is a @s.whatsapp.net JID
 *   4. msg.key.remoteJid       — if it is a @s.whatsapp.net JID
 *
 * LID candidates (for senderLid output field only):
 *   msg.key.senderLid, msg.key.participantLid, or msg.key.remoteJid if @lid
 *
 * NEVER uses raw LID digits as a phone number.
 *
 * @param {object} sock     Baileys socket (reserved for future use — not called currently)
 * @param {object} msg      Raw Baileys message object
 * @param {object} session  WhatsAppSession instance (reserved for future use)
 * @returns {{
 *   phone: string,
 *   whatsappPhone: string,
 *   phoneVerified: boolean,
 *   phoneSource: string,
 *   senderJid: string,
 *   senderLid: string,
 *   rawRemoteJid: string,
 *   rawParticipant: string
 * }}
 */
export function resolveSenderIdentity(sock, msg, session) {
    /** Safe fallback — always returned when an error occurs */
    const UNRESOLVED = {
        phone: '',
        whatsappPhone: '',
        phoneVerified: false,
        phoneSource: 'error',
        senderJid: '',
        senderLid: '',
        rawRemoteJid: '',
        rawParticipant: '',
    };

    try {
        if (!msg || !msg.key) return { ...UNRESOLVED, phoneSource: 'no_key' };

        const key = msg.key;
        const rawRemoteJid   = typeof key.remoteJid   === 'string' ? key.remoteJid   : '';
        const rawParticipant = typeof key.participant  === 'string' ? key.participant  : '';

        // ── Collect LID candidates ──────────────────────────
        let resolvedLid = '';
        if (isLidJid(rawRemoteJid))   resolvedLid = rawRemoteJid;
        if (!resolvedLid && isLidJid(typeof key.senderLid === 'string' ? key.senderLid : '')) {
            resolvedLid = key.senderLid;
        }
        if (!resolvedLid && isLidJid(typeof key.participantLid === 'string' ? key.participantLid : '')) {
            resolvedLid = key.participantLid;
        }

        // ── Priority 1: msg.key.senderPn ───────────────────
        if (isPhoneJid(key.senderPn)) {
            const rawPhone = normalizePhoneFromJid(key.senderPn);
            if (rawPhone) {
                return {
                    phone: rawPhone,
                    whatsappPhone: cleanWhatsAppPhone(rawPhone),
                    phoneVerified: true,
                    phoneSource: 'sender_pn',
                    senderJid: key.senderPn,
                    senderLid: resolvedLid,
                    rawRemoteJid,
                    rawParticipant,
                };
            }
        }

        // ── Priority 2: msg.key.participantPn ─────────────
        if (isPhoneJid(key.participantPn)) {
            const rawPhone = normalizePhoneFromJid(key.participantPn);
            if (rawPhone) {
                return {
                    phone: rawPhone,
                    whatsappPhone: cleanWhatsAppPhone(rawPhone),
                    phoneVerified: true,
                    phoneSource: 'participant_pn',
                    senderJid: key.participantPn,
                    senderLid: resolvedLid,
                    rawRemoteJid,
                    rawParticipant,
                };
            }
        }

        // ── Priority 3: msg.key.participant ────────────────
        if (isPhoneJid(rawParticipant)) {
            const rawPhone = normalizePhoneFromJid(rawParticipant);
            if (rawPhone) {
                return {
                    phone: rawPhone,
                    whatsappPhone: cleanWhatsAppPhone(rawPhone),
                    phoneVerified: true,
                    phoneSource: 'participant',
                    senderJid: rawParticipant,
                    senderLid: resolvedLid,
                    rawRemoteJid,
                    rawParticipant,
                };
            }
        }

        // ── Priority 4: msg.key.remoteJid ──────────────────
        if (isPhoneJid(rawRemoteJid)) {
            const rawPhone = normalizePhoneFromJid(rawRemoteJid);
            if (rawPhone) {
                return {
                    phone: rawPhone,
                    whatsappPhone: cleanWhatsAppPhone(rawPhone),
                    phoneVerified: true,
                    phoneSource: 'remote_jid',
                    senderJid: rawRemoteJid,
                    senderLid: resolvedLid,
                    rawRemoteJid,
                    rawParticipant,
                };
            }
        }


        // ── Unresolved — @lid with no PN available ─────────
        // ABSOLUTELY do NOT extract digits from an @lid value.
        if (resolvedLid) {
            return {
                phone: '',
                whatsappPhone: '',
                phoneVerified: false,
                phoneSource: 'unresolved_lid',
                senderJid: '',
                senderLid: resolvedLid,
                rawRemoteJid,
                rawParticipant,
            };
        }

        // ── Completely unknown structure ────────────────────
        return {
            phone: '',
            whatsappPhone: '',
            phoneVerified: false,
            phoneSource: 'unknown',
            senderJid: '',
            senderLid: '',
            rawRemoteJid,
            rawParticipant,
        };

    } catch (err) {
        // Never crash the bot — return safe unresolved identity
        return { ...UNRESOLVED, phoneSource: 'error' };
    }
}
