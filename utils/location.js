/**
 * ╔══════════════════════════════════════════╗
 * ║     Location Helper — utils/location.js  ║
 * ║  Detects & extracts location data from   ║
 * ║  WhatsApp messages and plain text.       ║
 * ╚══════════════════════════════════════════╝
 *
 * Exported functions:
 *   extractLocation(msg)              → location object | null
 *   extractGoogleMapsUrl(text)        → URL string | null
 *   extractCoordinatesFromText(text)  → { latitude, longitude } | null
 *   buildGoogleMapsUrl(lat, lng)      → URL string
 */

// ─── Google Maps URL patterns ─────────────────────────────
// Matches shortened and full Google Maps URLs in plain text.
const GOOGLE_MAPS_REGEX =
    /https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|(?:www\.)?google\.com\/maps|maps\.google\.com)[^\s]*/i;

// Matches explicit coordinates in Google Maps URLs or text
const COORDS_REGEX = /(?:q=|@|ll=)(-?\d+\.\d+),\s*(-?\d+\.\d+)/i;

/**
 * Unwrap common Baileys message wrappers to reach the inner message object.
 * Handles viewOnce, ephemeral, edited, and nested protocol containers.
 *
 * @param {object} m  msg or msg.message
 * @returns {object}  innermost message object
 */
function unwrapMessage(m) {
    if (!m) return m;
    if (m.message) m = m.message;

    const WRAPPERS = [
        'ephemeralMessage',
        'viewOnceMessage',
        'viewOnceMessageV2',
        'viewOnceMessageV2Extension',
        'documentWithCaptionMessage',
        'editedMessage',
    ];

    for (let depth = 0; depth < 5; depth++) {
        let unwrapped = false;
        for (const w of WRAPPERS) {
            if (m && m[w]) {
                if (m[w].message) {
                    m = m[w].message;
                    unwrapped = true;
                    break;
                } else if (w === 'editedMessage' && m[w].protocolMessage?.editedMessage) {
                    m = m[w].protocolMessage.editedMessage;
                    unwrapped = true;
                    break;
                }
            }
        }
        if (m && m.protocolMessage?.editedMessage) {
            m = m.protocolMessage.editedMessage;
            unwrapped = true;
        }
        if (!unwrapped) break;
    }
    return m;
}

/**
 * Build a standard Google Maps URL from a coordinate pair.
 *
 * @param {number} latitude
 * @param {number} longitude
 * @returns {string}
 */
export function buildGoogleMapsUrl(latitude, longitude) {
    return `https://www.google.com/maps?q=${latitude},${longitude}`;
}

/**
 * Detect and extract a Google Maps URL from a plain-text message.
 *
 * @param {string} text
 * @returns {string|null}
 */
export function extractGoogleMapsUrl(text) {
    if (!text || typeof text !== 'string') return null;
    const match = text.match(GOOGLE_MAPS_REGEX);
    return match ? match[0] : null;
}

/**
 * Extract GPS coordinates from text or Google Maps URLs if present.
 *
 * @param {string} text
 * @returns {{ latitude: number, longitude: number }|null}
 */
export function extractCoordinatesFromText(text) {
    if (!text || typeof text !== 'string') return null;
    const match = text.match(COORDS_REGEX);
    if (match) {
        const lat = Number(match[1]);
        const lng = Number(match[2]);
        if (!isNaN(lat) && !isNaN(lng) && !(lat === 0 && lng === 0)) {
            return { latitude: lat, longitude: lng };
        }
    }
    return null;
}

/**
 * Extract location information from a raw Baileys message object.
 *
 * Handles:
 *   - locationMessage        (standard WhatsApp current location / pin)
 *   - liveLocationMessage    (WhatsApp live location share / refresh)
 *   - Messages wrapped in ephemeral / viewOnce / edited containers
 *
 * Returns null when no location is present — never guesses coordinates.
 *
 * @param {object} msg  Raw Baileys message object
 * @returns {{
 *   type: 'current_location'|'live_location',
 *   latitude: number,
 *   longitude: number,
 *   name: string,
 *   address: string,
 *   formattedAddress: string,
 *   mapUrl: string,
 *   originalUrl: string,
 *   accuracy?: number|null
 * }|null}
 */
export function extractLocation(msg) {
    if (!msg) return null;

    const m = unwrapMessage(msg);
    if (!m) return null;

    // ── Standard current location / GPS pin ───────────────────
    if (m.locationMessage) {
        const loc = m.locationMessage;
        const lat = Number(loc.degreesLatitude);
        const lng = Number(loc.degreesLongitude);
        if (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) return null;

        const name = (loc.name || '').trim();
        const address = (loc.address || '').trim();
        const mapUrl = buildGoogleMapsUrl(lat, lng);
        const formattedAddress = [name, address].filter(Boolean).join(', ') || `Shared Location Pin (${lat.toFixed(4)}, ${lng.toFixed(4)})`;

        return {
            type:             'current_location',
            latitude:         lat,
            longitude:        lng,
            locationLat:      lat,
            locationLng:      lng,
            name,
            locationName:     name,
            address:          address || name,
            locationAddress:  address || name || formattedAddress,
            formattedAddress,
            mapUrl,
            locationMapUrl:   mapUrl,
            originalUrl:      loc.url || mapUrl,
        };
    }

    // ── Live location ─────────────────────────────────────────
    if (m.liveLocationMessage) {
        const loc = m.liveLocationMessage;
        const lat = Number(loc.degreesLatitude);
        const lng = Number(loc.degreesLongitude);
        if (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) return null;

        const caption = (loc.caption || '').trim();
        const mapUrl = buildGoogleMapsUrl(lat, lng);
        const formattedAddress = caption ? `${caption} (Live Pin: ${mapUrl})` : `Live Location Pin (${lat.toFixed(4)}, ${lng.toFixed(4)})`;

        return {
            type:             'live_location',
            latitude:         lat,
            longitude:        lng,
            locationLat:      lat,
            locationLng:      lng,
            name:             caption,
            locationName:     caption,
            address:          caption,
            locationAddress:  caption || formattedAddress,
            formattedAddress,
            accuracy:         loc.accuracyInMeters || null,
            mapUrl,
            locationMapUrl:   mapUrl,
            originalUrl:      mapUrl,
        };
    }

    return null;
}

/**
 * Extract location data from plain text containing Google Maps link or coordinates.
 *
 * @param {string} text
 * @returns {object|null}
 */
export function extractLocationFromText(text) {
    if (!text || typeof text !== 'string') return null;
    const gmapsUrl = extractGoogleMapsUrl(text);
    const coords = extractCoordinatesFromText(text);

    if (!gmapsUrl && !coords) return null;

    const lat = coords ? coords.latitude : null;
    const lng = coords ? coords.longitude : null;
    const mapUrl = gmapsUrl || (lat != null && lng != null ? buildGoogleMapsUrl(lat, lng) : '');

    return {
        type:             'text_maps_url',
        latitude:         lat,
        longitude:        lng,
        locationLat:      lat,
        locationLng:      lng,
        name:             'Google Maps Location',
        locationName:     'Google Maps Location',
        address:          text.trim(),
        locationAddress:  text.trim(),
        formattedAddress: text.trim(),
        mapUrl,
        locationMapUrl:   mapUrl,
        originalUrl:      gmapsUrl || mapUrl,
    };
}

