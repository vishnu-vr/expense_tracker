/// Curated dictionary of common merchants and brands found in transaction notes.
/// Ported from `src/app/core/utils/merchant-dictionary.ts`.
///
/// Patterns run against the normalised note (lowercase, no diacritics,
/// non-alphanumerics collapsed to single spaces, trimmed). The list is ordered
/// most-specific-first and the first match wins, so keep brand names above
/// generic categories.
library;

class MerchantEntry {
  const MerchantEntry(this.canonical, this.pattern);

  final String canonical;
  final String pattern;
}

const List<MerchantEntry> merchantDictionary = [

  // Ride-hailing
  MerchantEntry('Uber', r'\b(uber|ubr|ubre)\b'),
  MerchantEntry('Ola', r'\b(ola|olacabs|ola\s*cab|ola\s*cabs)\b'),
  MerchantEntry('Rapido', r'\b(rapido|rpdo)\b'),
  MerchantEntry('Auto', r'\b(auto|rickshaw|tuktuk|tuk\s*tuk)\b'),
  MerchantEntry('Metro', r'\b(metro|dmrc|bmrcl|namma\s*metro)\b'),

  // Fuel
  MerchantEntry('Petrol', r'\b(petrol|diesel|fuel|hp\s*petrol|iocl|bpcl|hpcl|reliance\s*petrol|nayara|essar)\b'),

  // Food delivery
  MerchantEntry('Swiggy', r'\b(swiggy|swgy|swiggy\s*instamart)\b'),
  MerchantEntry('Zomato', r'\b(zomato|zmt)\b'),
  MerchantEntry('Eatfit', r'\b(eatfit|eat\s*fit)\b'),

  // Quick commerce / grocery
  MerchantEntry('Blinkit', r'\b(blinkit|grofers|blnkit)\b'),
  MerchantEntry('Zepto', r'\b(zepto|zpto)\b'),
  MerchantEntry('Dunzo', r'\b(dunzo|dnzo)\b'),
  MerchantEntry('BigBasket', r'\b(bigbasket|big\s*basket|bb\s*now)\b'),
  MerchantEntry('DMart', r'\b(dmart|d\s*mart|d\s*\-\s*mart)\b'),
  MerchantEntry('More', r'\b(more\s*supermarket|more\s*market)\b'),

  // E-commerce
  MerchantEntry('Amazon', r'\b(amazon|amzn|amazn|amazon\s*pay)\b'),
  MerchantEntry('Flipkart', r'\b(flipkart|flpkrt|fkart)\b'),
  MerchantEntry('Myntra', r'\b(myntra|mntra)\b'),
  MerchantEntry('Meesho', r'\b(meesho|msho)\b'),
  MerchantEntry('Ajio', r'\b(ajio)\b'),

  // Payments / wallets
  MerchantEntry('Paytm', r'\b(paytm|pytm)\b'),
  MerchantEntry('PhonePe', r'\b(phonepe|phone\s*pe|ppe)\b'),
  MerchantEntry('GPay', r'\b(gpay|google\s*pay|g\s*pay)\b'),

  // Streaming / subscriptions
  MerchantEntry('Netflix', r'\b(netflix|nflx)\b'),
  MerchantEntry('Prime Video', r'\b(prime\s*video|amazon\s*prime|prime\s*subscription)\b'),
  MerchantEntry('Hotstar', r'\b(hotstar|disney\+|disney\s*hotstar)\b'),
  MerchantEntry('Spotify', r'\b(spotify|sptfy)\b'),
  MerchantEntry('YouTube', r'\b(youtube|yt\s*premium|youtube\s*premium)\b'),

  // Cinema chains
  MerchantEntry('PVR', r'\b(pvr|inox|pvr\s*inox)\b'),

  // Telecom / utilities
  MerchantEntry('Jio', r'\b(jio|reliance\s*jio)\b'),
  MerchantEntry('Airtel', r'\b(airtel|atl)\b'),
  MerchantEntry('Vi', r'\b(vodafone|vi\s*postpaid|vi\s*prepaid)\b'),
  MerchantEntry('Electricity', r'\b(electricity|bescom|tneb|kseb|mseb|adani\s*electricity)\b'),
  MerchantEntry('Gas', r'\b(indane|hp\s*gas|bharat\s*gas|lpg\s*cylinder)\b'),

  // Generic transport fallbacks (run last among transport so brands above win)
  MerchantEntry('Bus', r'\b(bus|ksrtc|tsrtc|msrtc|redbus)\b'),
  MerchantEntry('Train', r'\b(train|irctc|railway)\b'),
  MerchantEntry('Flight', r'\b(flight|indigo|spicejet|vistara|air\s*india|akasa)\b'),
  MerchantEntry('Cab', r'\b(cab|taxi)\b'),
];

final List<({String canonical, RegExp regex})> _compiled = [
  for (final e in merchantDictionary)
    (canonical: e.canonical, regex: RegExp(e.pattern)),
];

/// Canonical merchant name for a normalised note, or null if nothing matches.
String? matchMerchant(String normalizedNote) {
  for (final entry in _compiled) {
    if (entry.regex.hasMatch(normalizedNote)) return entry.canonical;
  }
  return null;
}

/// Canonical names produced by the dictionary.
final Set<String> merchantCanonicalNames = {
  for (final e in merchantDictionary) e.canonical,
};
