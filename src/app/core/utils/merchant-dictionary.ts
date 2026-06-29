/**
 * Curated dictionary of common merchants / brands that show up in transaction notes.
 *
 * Used by the rule-based note grouping pipeline (Pass A, Step 2) as the highest-priority
 * matcher: if a normalized note matches a regex below, the transaction is bucketed under
 * the canonical name and skips later heuristic steps.
 *
 * Buckets that come from this dictionary are also protected from the on-device semantic
 * merge (Pass B), so brand identity is never collapsed by similarity (e.g. Uber and Ola
 * stay separate even though they're semantically close).
 *
 * The list is ordered most-specific-first; the first regex to match a note wins. When
 * adding new entries, keep brand-name patterns above generic-category patterns.
 *
 * Note: regexes run against the *normalized* note (lowercase, no diacritics, non-alphanumerics
 * collapsed to single spaces, trimmed). So `\b...\b` boundaries work as expected.
 */

export interface MerchantEntry {
    canonical: string;
    match: RegExp;
}

export const MERCHANT_DICTIONARY: readonly MerchantEntry[] = [
    // Ride-hailing
    { canonical: 'Uber', match: /\b(uber|ubr|ubre)\b/ },
    { canonical: 'Ola', match: /\b(ola|olacabs|ola\s*cab|ola\s*cabs)\b/ },
    { canonical: 'Rapido', match: /\b(rapido|rpdo)\b/ },
    { canonical: 'Auto', match: /\b(auto|rickshaw|tuktuk|tuk\s*tuk)\b/ },
    { canonical: 'Metro', match: /\b(metro|dmrc|bmrcl|namma\s*metro)\b/ },

    // Fuel
    { canonical: 'Petrol', match: /\b(petrol|diesel|fuel|hp\s*petrol|iocl|bpcl|hpcl|reliance\s*petrol|nayara|essar)\b/ },

    // Food delivery
    { canonical: 'Swiggy', match: /\b(swiggy|swgy|swiggy\s*instamart)\b/ },
    { canonical: 'Zomato', match: /\b(zomato|zmt)\b/ },
    { canonical: 'Eatfit', match: /\b(eatfit|eat\s*fit)\b/ },

    // Quick commerce / grocery
    { canonical: 'Blinkit', match: /\b(blinkit|grofers|blnkit)\b/ },
    { canonical: 'Zepto', match: /\b(zepto|zpto)\b/ },
    { canonical: 'Dunzo', match: /\b(dunzo|dnzo)\b/ },
    { canonical: 'BigBasket', match: /\b(bigbasket|big\s*basket|bb\s*now)\b/ },
    { canonical: 'DMart', match: /\b(dmart|d\s*mart|d\s*\-\s*mart)\b/ },
    { canonical: 'More', match: /\b(more\s*supermarket|more\s*market)\b/ },

    // E-commerce
    { canonical: 'Amazon', match: /\b(amazon|amzn|amazn|amazon\s*pay)\b/ },
    { canonical: 'Flipkart', match: /\b(flipkart|flpkrt|fkart)\b/ },
    { canonical: 'Myntra', match: /\b(myntra|mntra)\b/ },
    { canonical: 'Meesho', match: /\b(meesho|msho)\b/ },
    { canonical: 'Ajio', match: /\b(ajio)\b/ },

    // Payments / wallets
    { canonical: 'Paytm', match: /\b(paytm|pytm)\b/ },
    { canonical: 'PhonePe', match: /\b(phonepe|phone\s*pe|ppe)\b/ },
    { canonical: 'GPay', match: /\b(gpay|google\s*pay|g\s*pay)\b/ },

    // Streaming / subscriptions
    { canonical: 'Netflix', match: /\b(netflix|nflx)\b/ },
    { canonical: 'Prime Video', match: /\b(prime\s*video|amazon\s*prime|prime\s*subscription)\b/ },
    { canonical: 'Hotstar', match: /\b(hotstar|disney\+|disney\s*hotstar)\b/ },
    { canonical: 'Spotify', match: /\b(spotify|sptfy)\b/ },
    { canonical: 'YouTube', match: /\b(youtube|yt\s*premium|youtube\s*premium)\b/ },

    // Cinema chains
    { canonical: 'PVR', match: /\b(pvr|inox|pvr\s*inox)\b/ },

    // Telecom / utilities
    { canonical: 'Jio', match: /\b(jio|reliance\s*jio)\b/ },
    { canonical: 'Airtel', match: /\b(airtel|atl)\b/ },
    { canonical: 'Vi', match: /\b(vodafone|vi\s*postpaid|vi\s*prepaid)\b/ },
    { canonical: 'Electricity', match: /\b(electricity|bescom|tneb|kseb|mseb|adani\s*electricity)\b/ },
    { canonical: 'Gas', match: /\b(indane|hp\s*gas|bharat\s*gas|lpg\s*cylinder)\b/ },

    // Generic transport fallbacks (run last among transport so brands above win)
    { canonical: 'Bus', match: /\b(bus|ksrtc|tsrtc|msrtc|redbus)\b/ },
    { canonical: 'Train', match: /\b(train|irctc|railway)\b/ },
    { canonical: 'Flight', match: /\b(flight|indigo|spicejet|vistara|air\s*india|akasa)\b/ },
    { canonical: 'Cab', match: /\b(cab|taxi)\b/ },
];

/**
 * Tag a normalized note string with a canonical merchant name.
 * Returns null if no entry matches, in which case the note proceeds to later pipeline steps.
 */
export function matchMerchant(normalizedNote: string): string | null {
    for (const entry of MERCHANT_DICTIONARY) {
        if (entry.match.test(normalizedNote)) {
            return entry.canonical;
        }
    }
    return null;
}

/** Set of canonical names produced by the dictionary, used by the semantic merge step
 *  to know which buckets to leave alone. */
export const MERCHANT_CANONICAL_NAMES: ReadonlySet<string> = new Set(
    MERCHANT_DICTIONARY.map((m) => m.canonical),
);
