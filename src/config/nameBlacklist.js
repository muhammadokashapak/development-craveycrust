/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║   Customer Name Blacklist & Validation Guard                 ║
 * ║   src/config/nameBlacklist.js                                ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Prevents food items, flavors, menu categories, bot commands,
 * affirmative/negative words, locations, and chat conversational words
 * from ever being accepted or stored as customer names.
 */

// ─── 1. Complete Blacklist Word Array ──────────────────────────────────────────
export const CUSTOMER_NAME_BLACKLIST = [
    // Food items & categories
    'pasta', 'pastas', 'crispy', 'macaroni', 'lasagna', 'lasagne', 'alfredo', 'spaghetti',
    'broast', 'sandwich', 'sandwiches', 'burger', 'burgers', 'pizza', 'pizzas', 'piza', 'pizaa',
    'fries', 'fry', 'fris', 'nugget', 'nuggets', 'wing', 'wings', 'roll', 'rolls', 'rollz',
    'wrap', 'wraps', 'shawarma', 'shwarma', 'shavarma', 'paratha', 'parathas', 'platter',
    'box', 'combo', 'deal', 'deals', 'side', 'sides', 'sauce', 'dip', 'dips',
    'drink', 'drinks', 'beverage', 'beverages', 'pepsi', 'coke', 'sprite', 'fanta', 'dew',
    'water', 'juice', 'sift', 'suft', 'sofe', 'tin', 'can', 'liter', 'litre', 'ltr',
    '1.5l', '1l', '500ml', 'calzone', 'pie', 'slice',

    // Flavors, ingredients & toppings
    'tikka', 'tika', 'tikkaa', 'fajita', 'faita', 'fejita', 'fajeeta', 'fajeta',
    'tandori', 'tandoori', 'behari', 'bihari', 'behri', 'malai', 'boti', 'ranch',
    'cream', 'creamy', 'pepperoni', 'peperoni', 'veggie', 'vegetable', 'onion', 'olive',
    'olives', 'mushroom', 'mushrooms', 'jalapeno', 'jalapenos', 'bbq', 'zinger', 'zegy',
    'zeggy', 'ziggy', 'chicken', 'chickn', 'beef', 'cheese', 'cheesy', 'extreme', 'extrme',
    'supreme', 'lover', 'lovers', 'crown', 'crust', 'stuffed', 'spicy', 'loaded', 'peri',
    'kabab', 'kebab', 'kababs', 'kebabs', 'garlic', 'mayo', 'chilli', 'chili', 'bbq',

    // Sizes, portions & quantities
    'small', 'medium', 'medum', 'large', 'larg', 'party', 'regular', 'reg',
    'piece', 'pieces', 'pc', 'pcs', 'half', 'full', 'quarter', 'choti', 'chota',
    'bari', 'bara', 'darmiyan', 'darmiyani', 'aik', 'do', 'teen', 'char', 'panch',
    'chay', 'chey', 'saat', 'aath', 'nau', 'dus', 'one', 'two', 'three', 'four', 'five',

    // Ordering, checkout, bot commands & action verbs
    'order', 'orders', 'ordering', 'booking', 'book', 'checkout', 'proceed', 'continue',
    'next', 'final', 'finalize', 'confirm', 'comfirm', 'konfirm', 'condrim', 'confrim',
    'confrm', 'cnfrm', 'cfrm', 'cancel', 'cancle', 'kansil', 'hatao', 'nikal', 'remove',
    'delete', 'change', 'badal', 'update', 'replace', 'bill', 'billing', 'total', 'subtotal',
    'discount', 'discounts', 'riayat', 'deliver', 'delivery', 'menu', 'manu', 'manue',
    'menue', 'meny', 'mainu', 'mainue', 'mny', 'catalog', 'catlog', 'rate', 'list',
    'dikhao', 'dijhao', 'dikaho', 'dekhao', 'dikhayein', 'dikhana', 'dikha', 'btao',
    'batao', 'bhejo', 'bhejna', 'send', 'mangwao', 'mangwana', 'pack', 'parcel',
    'add', 'extra', 'kardo', 'krdo', 'karo', 'kro', 'kar', 'kr', 'karna', 'krna',
    'karein', 'chahiye', 'chahye', 'chaiye', 'chahie', 'chahey', 'rakh', 'rakho',
    'rakhdo', 'likh', 'likho', 'likhdo', 'daal', 'daaldo', 'dedo', 'dein', 'do',
    'lo', 'le', 'banao', 'bana', 'bhej', 'parcel',
    'krny', 'karny', 'kaha', 'keha', 'bola', 'boli', 'bole', 'boly', 'kahy', 'kahn', 'bolna', 'kehna', 'badalna', 'rakhna', 'likhna', 'tha', 'thi', 'the',

    // Affirmatives, negatives, greetings & conversational fillers
    'theek', 'thk', 'thek', 'done', 'ok', 'okk', 'okay', 'sure', 'yes', 'yup', 'yep',
    'haan', 'han', 'hn', 'ha', 'hau', 'haun', 'hawn', 'g', 'ji', 'jee', 'no', 'nahi',
    'nahii', 'nhi', 'nh', 'nai', 'na', 'mat', 'none', 'hlo', 'hlw', 'hy', 'helo',
    'hellow', 'hi', 'hii', 'hiii', 'hello', 'hey', 'heyy', 'salam', 'slam', 'assalam',
    'aoa', 'assalamualaikum', 'suno', 'oye', 'yo', 'bhai', 'bhaiya', 'bhae', 'bro',
    'sir', 'madam', 'good', 'great', 'nice', 'fine', 'best', 'cool', 'super', 'bad',
    'poor', 'awesome', 'perfect', 'welldone', 'well', 'wese', 'waise', 'chalo', 'chal',
    'yar', 'yaar', 'sahih', 'sahi', 'shai', 'acha', 'achha', 'accha', 'shukriya',
    'thanks', 'thank', 'thx', 'ty', 'plz', 'pls', 'please', 'smile', 'smileee',

    // Payment methods & address terms
    'cod', 'cash', 'easypaisa', 'easy', 'paisa', 'online', 'payment', 'pata', 'address',
    'location', 'loc', 'pin', 'map', 'maps', 'live', 'gps', 'coordinates',

    // Pronouns, dummy names & system words
    'customer', 'user', 'guest', 'anonymous', 'client', 'mera', 'meara', 'mere', 'meri',
    'apna', 'apne', 'apni', 'my', 'mine', 'name', 'naam', 'nam', 'is', 'am', 'are',
    'hai', 'ha', 'h', 'he', 'hy', 'had', 'tha', 'thi', 'hoga', 'hogi', 'same', 'wahi',
    'yahi', 'yehi', 'yehe', 'yhe', 'isi', 'wala', 'wali', 'wale', 'number', 'numbr',
    'num', 'contact', 'whatsapp', 'phone', 'rabta', 'call', 'calls', 'dsml', 'invoke',
    'burger raja', 'kashii', 'kashi',

    // Localities, towns & landmarks
    'islamabad', 'rawalpindi', 'pindi', 'ghauri', 'ghori', 'tarlai', 'khanna', 'khana',
    'sohan', 'korang', 'burma', 'shakral', 'shakrial', 'zia', 'bilal', 'madina',
    'sarfraz', 'sharifabad', 'malik', 'marwa', 'basit', 'albadar', 'dakhana', 'rehman',
    'gulberg', 'gulzar', 'town', 'phase', 'sector', 'street', 'gali', 'house', 'makan',
    'flat', 'block', 'road', 'chowk', 'chok', 'pul', 'pull', 'colony', 'scheme',
    'market', 'plaza', 'stop', 'mor',

    // Abusive words / profanities
    'bdsk', 'bhosdike', 'bhosdiki', 'bhosdika', 'bhosdi', 'bhosdk', 'bc', 'mc',
    'chutiya', 'chutiye', 'chutya', 'gandu', 'lodu', 'laude', 'lauda', 'loda',
    'kutta', 'kutte', 'kutti', 'harami', 'haramzada', 'kameena', 'kameene',
    'salay', 'saale', 'madarchod', 'behenchod', 'bhenchod', 'fuck', 'shit',
    'bitch', 'bastard', 'asshole', 'dick',
];

export const CUSTOMER_NAME_BLACKLIST_SET = new Set(
    CUSTOMER_NAME_BLACKLIST.map(w => w.toLowerCase().trim())
);

// Words that must NEVER be present anywhere inside a customer name
export const FOOD_OR_COMMAND_WORDS_SET = new Set([
    'pasta', 'pastas', 'crispy', 'macaroni', 'lasagna', 'lasagne', 'alfredo', 'spaghetti',
    'broast', 'sandwich', 'sandwiches', 'burger', 'burgers', 'pizza', 'pizzas', 'piza', 'pizaa',
    'fries', 'fry', 'fris', 'nugget', 'nuggets', 'wing', 'wings', 'roll', 'rolls', 'rollz',
    'wrap', 'wraps', 'shawarma', 'shwarma', 'paratha', 'parathas', 'platter', 'box', 'combo',
    'deal', 'deals', 'sauce', 'dip', 'drink', 'drinks', 'pepsi', 'coke', 'sprite', 'fanta',
    'dew', 'water', 'tin', 'can', 'liter', 'litre', 'ltr', '1.5l', '1l', 'calzone',
    'tikka', 'fajita', 'tandori', 'tandoori', 'behari', 'bihari', 'malai', 'boti',
    'ranch', 'pepperoni', 'veggie', 'bbq', 'zinger', 'zegy', 'chicken', 'cheese', 'cheesy',
    'small', 'medium', 'large', 'party', 'regular', 'reg',
    'confirm', 'comfirm', 'konfirm', 'cnfrm', 'confrm', 'checkout', 'cancel',
    'cod', 'cash', 'easypaisa', 'menu', 'order', 'bill', 'discount',
    'delivery', 'address', 'location',
    'change', 'badal', 'badalna', 'update', 'kaha', 'bola', 'keha', 'krny', 'karny', 'karna', 'krna', 'rakhna', 'likhna', 'chahiye', 'tha', 'thi', 'the',
]);

// ─── 2. Regex for Quick Pattern Matching ───────────────────────────────────────
export const FOOD_OR_FLAVOR_PATTERN = /\b(?:pasta|pastas|crispy|macaroni|lasagna|lasagne|alfredo|spaghetti|broast|sandwich|sandwiches|burger|burgers|pizza|pizzas|piza|fries|fris|loaded|nugget|nuggets|wing|wings|roll|rolls|rollz|wrap|wraps|shawarma|shwarma|paratha|parathas|platter|box|combo|deal|deals|sauce|dip|drink|drinks|pepsi|coke|sprite|fanta|dew|water|sift|suft|sofe|can|tin|liter|litre|ltr|1\.5l|1l|calzone|tikka|tika|fajita|faita|fejita|fajeeta|tandori|tandoori|behari|bihari|malai|boti|ranch|cream|creamy|pepperoni|veggie|onion|olive|mushroom|jalapeno|bbq|zinger|zegy|zeggy|chicken|beef|cheese|cheesy|extreme|extrme|supreme|lover|crown|crust|stuffed|spicy|peri|kabab|kebab|small|medium|medum|large|larg|party|regular|reg|piece|pieces|pc|pcs|choti|chota|bari|bara|darmiyan|darmiyani)\b/i;

/**
 * Check if a string contains any food item, flavor, topping, category or size word.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function isFoodOrFlavorWord(text) {
    if (!text || typeof text !== 'string') return false;
    const clean = text.toLowerCase().trim();
    if (FOOD_OR_FLAVOR_PATTERN.test(clean)) return true;
    const tokens = clean.split(/[\s,.-]+/).filter(Boolean);
    return tokens.some(t => FOOD_OR_COMMAND_WORDS_SET.has(t));
}

/**
 * Authoritative Customer Name Validator.
 * Rejects food words, flavors, categories, commands, greetings, locations,
 * numbers, single characters, and profanities.
 *
 * @param {string} name
 * @returns {boolean}
 */
export function isValidCustomerName(name) {
    if (!name || typeof name !== 'string') return false;
    const clean = name.trim();
    if (clean.length < 2 || clean.length > 50) return false;

    // Reject all-digit or digit-heavy inputs
    if (/^\d+$/.test(clean) || (clean.replace(/\D/g, '').length > 2)) return false;

    const lower = clean.toLowerCase();
    const words = lower.split(/[\s,.-]+/).filter(Boolean);
    if (words.length === 0) return false;

    // Any individual word matching food or bot command words invalidates the whole name!
    for (const w of words) {
        if (FOOD_OR_COMMAND_WORDS_SET.has(w)) {
            return false;
        }
    }

    // Reject if EVERY word in the phrase belongs to the general blacklist
    // (e.g. "Mera Name", "Theek Hai", "Cash On Delivery", "Ghauri Town")
    const allBlacklisted = words.every(w => CUSTOMER_NAME_BLACKLIST_SET.has(w));
    if (allBlacklisted) {
        return false;
    }

    // Food or flavor regex test
    if (FOOD_OR_FLAVOR_PATTERN.test(lower)) {
        return false;
    }

    return true;
}
