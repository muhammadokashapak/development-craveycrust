/**
 * Convert string to URL-safe slug.
 * Example: "Zinger Burger" -> "zinger-burger"
 *
 * @param {string} text
 * @returns {string}
 */
export function slugify(text) {
    if (!text || typeof text !== 'string') return '';
    return text
        .toString()
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '-')           // Replace spaces with -
        .replace(/[^\w\-]+/g, '')       // Remove all non-word chars
        .replace(/\-\-+/g, '-')         // Replace multiple - with single -
        .replace(/^-+/, '')             // Trim - from start
        .replace(/-+$/, '');            // Trim - from end
}
