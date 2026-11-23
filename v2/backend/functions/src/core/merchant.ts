/**
 * Curated merchant dictionary, mirrored from the v1 app
 * (`src/app/core/utils/merchant-dictionary.ts`) and the Dart port.
 * Ordered most-specific-first; the first regex to match wins.
 * Regexes run against the normalised note (see `normalizeNote`).
 */
export interface MerchantEntry {
  canonical: string;
  match: RegExp;
}

export const MERCHANT_DICTIONARY: readonly MerchantEntry[] = [
  // Ride-hailing
  { canonical: "Uber", match: /\b(uber|ubr|ubre)\b/ },
  { canonical: "Ola", match: /\b(ola|olacabs|ola\s*cab|ola\s*cabs)\b/ },
  { canonical: "Rapido", match: /\b(rapido|rpdo)\b/ },
  { canonical: "Auto", match: /\b(auto|rickshaw|tuktuk|tuk\s*tuk)\b/ },
  { canonical: "Metro", match: /\b(metro|dmrc|bmrcl|namma\s*metro)\b/ },

  // Fuel
  { canonical: "Petrol", match: /\b(petrol|diesel|fuel|hp\s*petrol|iocl|bpcl|hpcl|reliance\s*petrol|nayara|essar)\b/ },

  // Food delivery
  { canonical: "Swiggy", match: /\b(swiggy|swgy|swiggy\s*instamart)\b/ },
  { canonical: "Zomato", match: /\b(zomato|zmt)\b/ },
  { canonical: "Eatfit", match: /\b(eatfit|eat\s*fit)\b/ },

  // Quick commerce / grocery
  { canonical: "Blinkit", match: /\b(blinkit|grofers|blnkit)\b/ },
  { canonical: "Zepto", match: /\b(zepto|zpto)\b/ },
  { canonical: "Dunzo", match: /\b(dunzo|dnzo)\b/ },
  { canonical: "BigBasket", match: /\b(bigbasket|big\s*basket|bb\s*now)\b/ },
  { canonical: "DMart", match: /\b(dmart|d\s*mart|d\s*-\s*mart)\b/ },
  { canonical: "More", match: /\b(more\s*supermarket|more\s*market)\b/ },

  // E-commerce
  { canonical: "Amazon", match: /\b(amazon|amzn|amazn|amazon\s*pay)\b/ },
  { canonical: "Flipkart", match: /\b(flipkart|flpkrt|fkart)\b/ },
  { canonical: "Myntra", match: /\b(myntra|mntra)\b/ },
  { canonical: "Meesho", match: /\b(meesho|msho)\b/ },
  { canonical: "Ajio", match: /\b(ajio)\b/ },

  // Payments / wallets
  { canonical: "Paytm", match: /\b(paytm|pytm)\b/ },
  { canonical: "PhonePe", match: /\b(phonepe|phone\s*pe|ppe)\b/ },
  { canonical: "GPay", match: /\b(gpay|google\s*pay|g\s*pay)\b/ },

  // Streaming / subscriptions
  { canonical: "Netflix", match: /\b(netflix|nflx)\b/ },
  { canonical: "Prime Video", match: /\b(prime\s*video|amazon\s*prime|prime\s*subscription)\b/ },
  { canonical: "Hotstar", match: /\b(hotstar|disney\+|disney\s*hotstar)\b/ },
  { canonical: "Spotify", match: /\b(spotify|sptfy)\b/ },
  { canonical: "YouTube", match: /\b(youtube|yt\s*premium|youtube\s*premium)\b/ },

  // Cinema chains
  { canonical: "PVR", match: /\b(pvr|inox|pvr\s*inox)\b/ },

  // Telecom / utilities
  { canonical: "Jio", match: /\b(jio|reliance\s*jio)\b/ },
  { canonical: "Airtel", match: /\b(airtel|atl)\b/ },
  { canonical: "Vi", match: /\b(vodafone|vi\s*postpaid|vi\s*prepaid)\b/ },
  { canonical: "Electricity", match: /\b(electricity|bescom|tneb|kseb|mseb|adani\s*electricity)\b/ },
  { canonical: "Gas", match: /\b(indane|hp\s*gas|bharat\s*gas|lpg\s*cylinder)\b/ },

  // Generic transport fallbacks (last, so the brands above win)
  { canonical: "Bus", match: /\b(bus|ksrtc|tsrtc|msrtc|redbus)\b/ },
  { canonical: "Train", match: /\b(train|irctc|railway)\b/ },
  { canonical: "Flight", match: /\b(flight|indigo|spicejet|vistara|air\s*india|akasa)\b/ },
  { canonical: "Cab", match: /\b(cab|taxi)\b/ },
];

/** Lowercase, strip diacritics, collapse non-alphanumerics to single spaces, trim. */
export function normalizeNote(note: string | undefined | null): string {
  if (!note) return "";
  return note
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Canonical merchant for a raw note, or null. */
export function matchMerchant(note: string | undefined | null): string | null {
  const normalized = normalizeNote(note);
  if (!normalized) return null;
  for (const entry of MERCHANT_DICTIONARY) {
    if (entry.match.test(normalized)) return entry.canonical;
  }
  return null;
}

/**
 * Key used to group "the same kind of entry" for recurring detection:
 * digits and punctuation removed (so "Netflix 649" and "netflix" group together).
 * Mirrors `normalizeNote` in the v1 recurring-expenses.ts.
 */
export function recurringNoteKey(note: string | undefined | null): string {
  if (!note) return "";
  return note
    .toLowerCase()
    .replace(/\d+/g, " ")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function toTitleCase(text: string): string {
  return text
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
