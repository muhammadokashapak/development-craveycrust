/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║   Geocoding Service — src/services/geocodingService.js       ║
 * ║   OpenStreetMap Nominatim Geocoding with In-Memory Caching  ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Responsibilities:
 *   - Converts text addresses (e.g. "Khanna Pul", "F-10 Markaz", "Ghauri Town")
 *     into exact GPS coordinates (lat, lng) when a pin is not shared.
 *   - Fast LRU in-memory cache to ensure instant (0ms) repeated lookups.
 *   - Context bias: automatically enhances query with city/country if omitted.
 *   - Uses Haversine distance formula to calculate distance from restaurant.
 */

import { calculateHaversineDistance, RESTAURANT_CENTER } from './deliveryService.js';
import { logger } from '../utils/logger.js';

// In-memory cache: normalized query -> geocoded result
const geocodeCache = new Map();
const MAX_CACHE_SIZE = 500;

// Noise words in Pakistani Roman Urdu & English to strip from address query
const NOISE_WORDS = [
    /\b(deliver|delivery)\s*(karo|karein|karwao|karwana|karwana\s*hai|krwao|krwana|krwana\s*ha|krna|karna|chahiye)?\b/gi,
    /\b(krwaana|krwana|karwana|karwaana)\s*(ha|hai|h)?\b/gi,
    /\b(krna|karna)\s*(ha|hai|h)?\b/gi,
    /\b(bhej\s*(do|dein|karo|dena)?)\b/gi,
    /\b(mein|me|mai|pe|par|per)\b/gi,
    /\b(chahiye|mangwana|order)\b/gi,
    /\b(please|plz|shukriya|thanks)\b/gi,
    /\b(ye|yeh|is|iss|yahan|idhar)\b/gi,
    /\b(address|pata|location|loc)\b/gi,
];

// Common Pakistani spelling transliterations to map to official OpenStreetMap nomenclature
const SPELLING_NORMALIZATIONS = [
    { pattern: /\bkhana\s*pul{1,2}\b/gi, replacement: 'Khanna Pul' },
    { pattern: /\bkhanna\s*pull\b/gi, replacement: 'Khanna Pul' },
    { pattern: /\bghori\s*town\b/gi, replacement: 'Ghauri Town' },
    { pattern: /\btarmani\b/gi, replacement: 'Taramari' },
    { pattern: /\bshakrial\b/gi, replacement: 'Shakral' },
];

/**
 * Clean and extract core landmark/area name from conversational text
 * @param {string} rawText
 * @returns {string}
 */
export function cleanAddressQuery(rawText) {
    if (!rawText || typeof rawText !== 'string') return '';
    let cleaned = rawText.trim();

    // Strip Google Maps URL if present and extract raw text
    cleaned = cleaned.replace(/https?:\/\/[^\s]+/g, '');

    for (const pattern of NOISE_WORDS) {
        cleaned = cleaned.replace(pattern, ' ');
    }

    for (const { pattern, replacement } of SPELLING_NORMALIZATIONS) {
        cleaned = cleaned.replace(pattern, replacement);
    }

    // Collapse punctuation and whitespace
    cleaned = cleaned.replace(/[,;:/.-]+/g, ' ').replace(/\s+/g, ' ').trim();
    return cleaned;
}

/**
 * Geocode text address into coordinates (lat, lng) using OpenStreetMap Nominatim
 *
 * @param {string} addressText
 * @param {Object} [options]
 * @param {number} [options.centerLat] - Restaurant latitude
 * @param {number} [options.centerLng] - Restaurant longitude
 * @param {string} [options.defaultCity] - Default fallback city (e.g. "Islamabad")
 * @param {string} [options.defaultCountry] - Default fallback country (e.g. "Pakistan")
 * @returns {Promise<{success: boolean, latitude?: number, longitude?: number, displayName?: string, formattedAddress?: string, distanceKm?: number, googleMapsUrl?: string, error?: string}>}
 */
export async function geocodeAddress(addressText, options = {}) {
    const query = cleanAddressQuery(addressText);
    if (!query || query.length < 3) {
        return { success: false, error: 'QUERY_TOO_SHORT' };
    }

    const centerLat = options.centerLat ?? RESTAURANT_CENTER.lat;
    const centerLng = options.centerLng ?? RESTAURANT_CENTER.lng;
    const defaultCity = options.defaultCity || 'Islamabad';
    const defaultCountry = options.defaultCountry || 'Pakistan';

    const normalizedKey = query.toLowerCase();

    // 1. In-memory Cache Check (0ms response)
    if (geocodeCache.has(normalizedKey)) {
        const cached = geocodeCache.get(normalizedKey);
        const distanceKm = calculateHaversineDistance(cached.latitude, cached.longitude, centerLat, centerLng);
        return { ...cached, distanceKm };
    }

    // 2. Build Search Queries (with and without city context)
    const candidates = [query];
    if (!query.toLowerCase().includes(defaultCity.toLowerCase())) {
        candidates.push(`${query}, ${defaultCity}`);
        candidates.push(`${query}, ${defaultCity}, ${defaultCountry}`);
    } else if (!query.toLowerCase().includes(defaultCountry.toLowerCase())) {
        candidates.push(`${query}, ${defaultCountry}`);
    }

    for (const searchQuery of candidates) {
        try {
            const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(searchQuery)}&format=json&limit=1&addressdetails=1`;
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3500);

            const res = await fetch(url, {
                headers: {
                    'User-Agent': 'CraveyDeliveryBot/2.0 (Restaurant Delivery Automation)',
                    'Accept-Language': 'en,ur',
                },
                signal: controller.signal,
            });
            clearTimeout(timeoutId);

            if (!res.ok) continue;

            const data = await res.json();
            if (Array.isArray(data) && data.length > 0) {
                const item = data[0];
                const lat = parseFloat(item.lat);
                const lng = parseFloat(item.lon);

                if (!isNaN(lat) && !isNaN(lng)) {
                    const distanceKm = calculateHaversineDistance(lat, lng, centerLat, centerLng);
                    const googleMapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;
                    const displayName = item.name || query;
                    const formattedAddress = item.display_name || searchQuery;

                    const result = {
                        success: true,
                        latitude: lat,
                        longitude: lng,
                        displayName,
                        formattedAddress,
                        distanceKm,
                        googleMapsUrl,
                    };

                    // Cache result
                    if (geocodeCache.size >= MAX_CACHE_SIZE) {
                        const firstKey = geocodeCache.keys().next().value;
                        geocodeCache.delete(firstKey);
                    }
                    geocodeCache.set(normalizedKey, result);

                    logger.info({ query, searchQuery, lat, lng, distanceKm: distanceKm.toFixed(2) }, '[GEOCODE] Address resolved via OpenStreetMap');
                    return result;
                }
            }
        } catch (err) {
            // Non-blocking timeout/abort or network hiccup, try next candidate
            logger.warn({ query: searchQuery, err: err.message }, '[GEOCODE] Lookup attempt failed');
        }
    }

    return { success: false, error: 'GEOCODE_NOT_FOUND', query };
}
