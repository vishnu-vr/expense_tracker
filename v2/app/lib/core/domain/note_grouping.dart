/// Rule-based clustering of one category's transactions by what their
/// free-text note describes, for the "Breakdown by description" chart.
/// Ported from `src/app/core/utils/note-grouping.ts` (Pass A only; the
/// embedding-based semantic merge in `embedding-clustering.ts` is not ported).
///
/// Pipeline:
///   1. Normalise the note (fold diacritics, lowercase, collapse to `[a-z0-9 ]`).
///   2. Tag against the merchant dictionary (highest priority).
///   3. Detect frequent two-word phrases among the untagged notes.
///   4. Tokenise, drop stop-words / pure numbers / single letters, light stem.
///   5. Bucket each remaining note by its most frequent token.
///   6. Fuzzy-merge similar buckets (edit distance, phonetic key, prefix).
///   7. Pick a display name per bucket.
///   8. Keep the top [topN] buckets and roll the rest into "Other".
library;

import 'merchant_dictionary.dart';
import 'models.dart';

/// One group of transactions whose notes describe the same thing.
class NoteBucket {
  const NoteBucket({
    required this.key,
    required this.displayName,
    required this.total,
    required this.count,
    required this.percentage,
    required this.color,
    required this.transactions,
    required this.fromMerchantDictionary,
    required this.sampleRawNotes,
  });

  /// Stable internal key: `m:` merchant, `p:` phrase, `t:` token, `r:` raw
  /// fallback, or [noNoteKey] / [otherKey].
  final String key;

  /// What the legend shows.
  final String displayName;

  /// Sum of `amount` across [transactions].
  final double total;

  /// Number of transactions in the bucket.
  final int count;

  /// Share of the category total, 0-100 (unrounded).
  final double percentage;

  /// Hex colour string from [bucketPalette], or [otherColor] for "Other".
  final String color;

  /// The bucket's transactions, in the order the pipeline collected them
  /// (input order within a bucket, absorbed buckets appended after).
  final List<Transaction> transactions;

  /// True when the key came from the merchant dictionary.
  final bool fromMerchantDictionary;

  /// Up to three representative raw notes, most frequent first. Empty for the
  /// "Other" bucket and for buckets whose transactions have no note.
  final List<String> sampleRawNotes;

  /// IDs of [transactions], in the same order.
  List<String> get transactionIds => [for (final t in transactions) t.id];

  /// The rolled-up tail bucket produced by [applyTopNAndOther].
  bool get isOther => key == otherKey;

  /// The bucket for transactions with an empty (or symbol-only) note.
  bool get isNoNote => key == noNoteKey;

  @override
  String toString() =>
      'NoteBucket($key, "$displayName", total: $total, count: $count)';
}

/// Colours assigned by rank. "Other" always gets [otherColor].
const List<String> bucketPalette = [
  '#6366f1', // indigo
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#06b6d4', // cyan
];
const String otherColor = '#9ca3af';
const String noNoteKey = '__no_note__';
const String otherKey = '__other__';

/// Max number of named buckets shown before rolling the rest into "Other".
const int topN = 5;

const Set<String> _stopWords = {
  'to', 'from', 'for', 'at', 'in', 'on', 'of', 'with', 'and', 'or', 'by',
  'via', 'near', 'the', 'a', 'an', 'my', 'our', 'your', 'his', 'her',
  'am', 'pm', 'rs', 'rupees', 'inr',
};

// =============================================================================
// Public API
// =============================================================================

/// Groups [transactions] by their note. The caller is expected to pass one
/// category's expenses; no filtering happens here.
///
/// The result is sorted by `total` descending, ties keeping first-seen order.
/// Pass `applyTopN: false` for the full list without the "Other" roll-up.
List<NoteBucket> groupTransactionsByNoteRules(
  Iterable<Transaction> transactions, {
  bool applyTopN = true,
}) {
  final txns = transactions.toList(growable: false);
  if (txns.isEmpty) return [];

  // JS: `reduce(...) || 1` - zero and NaN both fall back to 1.
  final sum = txns.fold<double>(0, (s, t) => s + t.amount);
  final grandTotal = _orOne(sum);

  final working = <_Working>[];
  for (final t in txns) {
    final raw = t.note ?? '';
    final normalized = normalizeNote(raw);
    if (normalized.isEmpty) {
      working.add(_Working(raw, '')
        ..bucketKey = noNoteKey
        ..bucketDisplay = 'No description');
      continue;
    }
    // Step 2: merchant dictionary.
    final canonical = matchMerchant(normalized);
    if (canonical != null) {
      working.add(_Working(raw, normalized)
        ..bucketKey = 'm:${canonical.toLowerCase()}'
        ..bucketDisplay = canonical
        ..fromMerchantDictionary = true);
      continue;
    }
    working.add(_Working(raw, normalized));
  }

  // Steps 3-5 only run over notes the dictionary did not tag.
  final untagged = [
    for (final w in working)
      if (w.bucketKey.isEmpty) w,
  ];

  if (untagged.isNotEmpty) {
    final phraseSet =
        _detectBigramPhrases([for (final w in untagged) w.normalizedNote]);

    final tokensPerNote = [
      for (final w in untagged) _tokenizeAndStem(w.normalizedNote),
    ];
    // Document frequency: each token counts once per note.
    final tokenFreq = <String, int>{};
    for (final tokens in tokensPerNote) {
      for (final tok in tokens.toSet()) {
        tokenFreq[tok] = (tokenFreq[tok] ?? 0) + 1;
      }
    }

    for (var i = 0; i < untagged.length; i++) {
      final w = untagged[i];
      final tokens = tokensPerNote[i];

      // Step 3: a detected phrase wins.
      final phrase = _findContainingPhrase(tokens, phraseSet);
      if (phrase != null) {
        w.bucketKey = 'p:$phrase';
        w.bucketDisplay = _titleCase(phrase);
        continue;
      }

      // No surviving tokens: fall back to the normalised note itself.
      if (tokens.isEmpty) {
        w.bucketKey = 'r:${w.normalizedNote}';
        w.bucketDisplay = _titleCase(w.normalizedNote);
        continue;
      }

      // Step 5: most frequent token; ties go to the longer token, then to the
      // lexicographically smaller one.
      var best = tokens[0];
      var bestFreq = tokenFreq[best] ?? 0;
      for (final tok in tokens) {
        final f = tokenFreq[tok] ?? 0;
        if (f > bestFreq ||
            (f == bestFreq && tok.length > best.length) ||
            (f == bestFreq &&
                tok.length == best.length &&
                tok.compareTo(best) < 0)) {
          best = tok;
          bestFreq = f;
        }
      }
      w.bucketKey = 't:$best';
      w.bucketDisplay = _titleCase(best);
    }
  }

  // Aggregate. Dart map literals keep insertion order, like a JS Map.
  final buckets = <String, _Aggregated>{};
  for (var i = 0; i < txns.length; i++) {
    final t = txns[i];
    final w = working[i];
    final agg = buckets.putIfAbsent(
      w.bucketKey,
      () => _Aggregated(w.bucketKey, w.bucketDisplay, w.fromMerchantDictionary),
    );
    agg.total += t.amount;
    agg.count += 1;
    agg.transactions.add(t);
    if (w.rawNote.isNotEmpty) {
      agg.rawNoteCounts[w.rawNote] = (agg.rawNoteCounts[w.rawNote] ?? 0) + 1;
    }
  }

  var aggregated = _stableSortDesc(buckets.values.toList(), (a) => a.total);

  // Step 6: larger buckets absorb smaller similar ones.
  aggregated = _fuzzyMergeBuckets(aggregated);

  // Step 7: final display name. Merchant and no-note names are canonical.
  for (final agg in aggregated) {
    if (agg.fromMerchantDictionary || agg.key == noNoteKey) continue;
    agg.displayName =
        _pickDisplayName(agg.displayName, agg.rawNoteCounts, agg.count);
  }

  aggregated = _stableSortDesc(aggregated, (a) => a.total);

  final fullList = [
    for (var i = 0; i < aggregated.length; i++)
      _toBucket(aggregated[i], i, grandTotal),
  ];
  if (!applyTopN) return fullList;
  return applyTopNAndOther(fullList, grandTotalOverride: grandTotal);
}

/// Caps [buckets] at [topN] named entries and rolls the rest into one grey
/// "Other" bucket. Lists of up to `topN + 1` buckets are returned whole, since
/// an "Other" holding a single bucket would hide more than it saves.
///
/// Percentages are recomputed against [grandTotalOverride], or against the sum
/// of the bucket totals when it is null.
List<NoteBucket> applyTopNAndOther(
  List<NoteBucket> buckets, {
  double? grandTotalOverride,
}) {
  if (buckets.isEmpty) return [];
  final grandTotal = grandTotalOverride ??
      _orOne(buckets.fold<double>(0, (s, b) => s + b.total));

  final sorted = _stableSortDesc(buckets, (b) => b.total);

  NoteBucket recolor(NoteBucket b, int rank) => NoteBucket(
        key: b.key,
        displayName: b.displayName,
        total: b.total,
        count: b.count,
        percentage: (b.total / grandTotal) * 100,
        color: b.fromMerchantDictionary || b.key == noNoteKey
            ? b.color
            : bucketPalette[rank % bucketPalette.length],
        transactions: b.transactions,
        fromMerchantDictionary: b.fromMerchantDictionary,
        sampleRawNotes: b.sampleRawNotes,
      );

  if (sorted.length <= topN + 1) {
    return [for (var i = 0; i < sorted.length; i++) recolor(sorted[i], i)];
  }

  final head = [for (var i = 0; i < topN; i++) recolor(sorted[i], i)];
  var restTotal = 0.0;
  var restCount = 0;
  final rest = <Transaction>[];
  for (final r in sorted.skip(topN)) {
    restTotal += r.total;
    restCount += r.count;
    rest.addAll(r.transactions);
  }
  head.add(NoteBucket(
    key: otherKey,
    displayName: 'Other',
    total: restTotal,
    count: restCount,
    percentage: (restTotal / grandTotal) * 100,
    color: otherColor,
    transactions: List.unmodifiable(rest),
    fromMerchantDictionary: false,
    sampleRawNotes: const [],
  ));
  return head;
}

// =============================================================================
// Step 1: normalisation
// =============================================================================

final _nonAlnum = RegExp(r'[^a-z0-9]+');
final _spaces = RegExp(r'\s+');

/// Lowercases, strips diacritics, collapses every run of characters outside
/// `[a-z0-9]` to a single space, and trims.
///
/// The TypeScript uses `raw.normalize('NFD')` and then deletes U+0300-U+036F.
/// Dart has no built-in Unicode normalisation, so [_foldDiacritics] does the
/// equivalent with an explicit table. The table is every code point whose NFD
/// form, once those marks are removed, is a single ASCII letter (generated from
/// the JS engine's own `normalize`, 490 entries, Latin only). Nothing else can
/// change the result: any other character ends up outside `[a-z0-9]` on both
/// sides and becomes a space either way.
String normalizeNote(String? raw) {
  if (raw == null || raw.isEmpty) return '';
  return _foldDiacritics(raw)
      .toLowerCase()
      .replaceAll(_nonAlnum, ' ')
      .trim()
      .replaceAll(_spaces, ' ');
}

/// Base letter -> every precomposed Latin letter (either case) that NFD
/// decomposes to that letter plus combining marks in U+0300-U+036F. Includes
/// U+212A KELVIN SIGN under `k` and U+0130 (dotted capital I) under `i`.
/// Letters with no canonical decomposition (ø, ß, æ, đ, ł, ...) are absent on
/// purpose: JS leaves them alone and they turn into spaces.
const Map<String, String> _foldGroups = {
  'a': 'ÀÁÂÃÄÅàáâãäåĀāĂăĄąǍǎǞǟǠǡǺǻȀȁȂȃȦȧḀḁẠạẢảẤấẦầẨẩẪẫẬậẮắẰằẲẳẴẵẶặÅ',
  'b': 'ḂḃḄḅḆḇ',
  'c': 'ÇçĆćĈĉĊċČčḈḉ',
  'd': 'ĎďḊḋḌḍḎḏḐḑḒḓ',
  'e': 'ÈÉÊËèéêëĒēĔĕĖėĘęĚěȄȅȆȇȨȩḔḕḖḗḘḙḚḛḜḝẸẹẺẻẼẽẾếỀềỂểỄễỆệ',
  'f': 'Ḟḟ',
  'g': 'ĜĝĞğĠġĢģǦǧǴǵḠḡ',
  'h': 'ĤĥȞȟḢḣḤḥḦḧḨḩḪḫẖ',
  'i': 'ÌÍÎÏìíîïĨĩĪīĬĭĮįİǏǐȈȉȊȋḬḭḮḯỈỉỊị',
  'j': 'Ĵĵǰ',
  'k': 'ĶķǨǩḰḱḲḳḴḵK',
  'l': 'ĹĺĻļĽľḶḷḸḹḺḻḼḽ',
  'm': 'ḾḿṀṁṂṃ',
  'n': 'ÑñŃńŅņŇňǸǹṄṅṆṇṈṉṊṋ',
  'o': 'ÒÓÔÕÖòóôõöŌōŎŏŐőƠơǑǒǪǫǬǭȌȍȎȏȪȫȬȭȮȯȰȱṌṍṎṏṐṑṒṓỌọỎỏỐốỒồỔổỖỗỘộỚớỜờỞởỠỡỢợ',
  'p': 'ṔṕṖṗ',
  'r': 'ŔŕŖŗŘřȐȑȒȓṘṙṚṛṜṝṞṟ',
  's': 'ŚśŜŝŞşŠšȘșṠṡṢṣṤṥṦṧṨṩ',
  't': 'ŢţŤťȚțṪṫṬṭṮṯṰṱẗ',
  'u': 'ÙÚÛÜùúûüŨũŪūŬŭŮůŰűŲųƯưǓǔǕǖǗǘǙǚǛǜȔȕȖȗṲṳṴṵṶṷṸṹṺṻỤụỦủỨứỪừỬửỮữỰự',
  'v': 'ṼṽṾṿ',
  'w': 'ŴŵẀẁẂẃẄẅẆẇẈẉẘ',
  'x': 'ẊẋẌẍ',
  'y': 'ÝýÿŶŷŸȲȳẎẏẙỲỳỴỵỶỷỸỹ',
  'z': 'ŹźŻżŽžẐẑẒẓẔẕ',
};

final Map<int, int> _foldTable = {
  for (final e in _foldGroups.entries)
    for (final unit in e.value.codeUnits) unit: e.key.codeUnitAt(0),
};

String _foldDiacritics(String s) {
  final out = StringBuffer();
  var changed = false;
  for (final unit in s.codeUnits) {
    // Standalone combining diacritical marks are deleted, not spaced.
    if (unit >= 0x0300 && unit <= 0x036f) {
      changed = true;
      continue;
    }
    final folded = _foldTable[unit];
    if (folded != null) {
      changed = true;
      out.writeCharCode(folded);
    } else {
      out.writeCharCode(unit);
    }
  }
  return changed ? out.toString() : s;
}

// =============================================================================
// Steps 3-5: tokens and phrases
// =============================================================================

final _allDigits = RegExp(r'^[0-9]+$');

/// Drops stop-words, pure numbers and single-character tokens; light stem.
List<String> _tokenizeAndStem(String normalized) {
  if (normalized.isEmpty) return [];
  final out = <String>[];
  for (final tok in normalized.split(' ')) {
    if (tok.length < 2) continue;
    if (_stopWords.contains(tok)) continue;
    if (_allDigits.hasMatch(tok)) continue;
    out.add(_stem(tok));
  }
  return out;
}

/// Trailing ies / es / s only.
String _stem(String token) {
  final n = token.length;
  if (n > 4 && token.endsWith('ies')) return '${token.substring(0, n - 3)}y';
  if (n > 4 && token.endsWith('es')) return token.substring(0, n - 2);
  if (n > 3 && token.endsWith('s') && !token.endsWith('ss')) {
    return token.substring(0, n - 1);
  }
  return token;
}

/// Bigrams found in at least two notes whose two words never appear apart.
Set<String> _detectBigramPhrases(List<String> normalizedNotes) {
  final wordCounts = <String, int>{};
  final bigramCounts = <String, int>{};

  for (final note in normalizedNotes) {
    final tokens = _tokenizeAndStem(note);
    final bigrams = <String>{
      for (var i = 0; i < tokens.length - 1; i++) '${tokens[i]} ${tokens[i + 1]}',
    };
    for (final w in tokens.toSet()) {
      wordCounts[w] = (wordCounts[w] ?? 0) + 1;
    }
    for (final bg in bigrams) {
      bigramCounts[bg] = (bigramCounts[bg] ?? 0) + 1;
    }
  }

  final phrases = <String>{};
  bigramCounts.forEach((bg, c) {
    if (c < 2) return;
    final parts = bg.split(' ');
    final c1 = wordCounts[parts[0]] ?? 0;
    final c2 = wordCounts[parts[1]] ?? 0;
    if (c >= c1 && c >= c2) phrases.add(bg);
  });
  return phrases;
}

/// Longest detected phrase inside [tokens]; the earliest wins a length tie.
String? _findContainingPhrase(List<String> tokens, Set<String> phrases) {
  if (phrases.isEmpty || tokens.length < 2) return null;
  String? best;
  for (var i = 0; i < tokens.length - 1; i++) {
    final bg = '${tokens[i]} ${tokens[i + 1]}';
    if (phrases.contains(bg) && (best == null || bg.length > best.length)) {
      best = bg;
    }
  }
  return best;
}

// =============================================================================
// Step 6: fuzzy merge
// =============================================================================

class _Working {
  _Working(this.rawNote, this.normalizedNote);

  final String rawNote;
  final String normalizedNote;
  String bucketKey = '';
  String bucketDisplay = '';
  bool fromMerchantDictionary = false;
}

class _Aggregated {
  _Aggregated(this.key, this.displayName, this.fromMerchantDictionary);

  final String key;
  String displayName;
  final bool fromMerchantDictionary;
  double total = 0;
  int count = 0;
  final List<Transaction> transactions = [];
  final Map<String, int> rawNoteCounts = {};
}

List<_Aggregated> _fuzzyMergeBuckets(List<_Aggregated> buckets) {
  if (buckets.length < 2) return buckets;
  final sorted = _stableSortDesc(buckets, (a) => a.total);
  final result = <_Aggregated>[];

  for (final candidate in sorted) {
    final candKey = _stripPrefix(candidate.key);
    _Aggregated? mergedInto;
    // The no-note bucket never takes part, and a merchant bucket is never
    // absorbed. A non-merchant bucket may be absorbed by a merchant one
    // ("uber123" -> "Uber").
    if (candidate.key != noNoteKey && !candidate.fromMerchantDictionary) {
      for (final target in result) {
        if (target.key == noNoteKey) continue;
        if (_areKeysSimilar(_stripPrefix(target.key), candKey)) {
          mergedInto = target;
          break;
        }
      }
    }

    if (mergedInto != null) {
      mergedInto.total += candidate.total;
      mergedInto.count += candidate.count;
      mergedInto.transactions.addAll(candidate.transactions);
      final counts = mergedInto.rawNoteCounts;
      for (final e in candidate.rawNoteCounts.entries) {
        counts[e.key] = (counts[e.key] ?? 0) + e.value;
      }
    } else {
      result.add(candidate);
    }
  }
  return result;
}

/// Strips the `m:` / `p:` / `t:` / `r:` namespace prefix.
String _stripPrefix(String key) =>
    key.length > 2 && key[1] == ':' ? key.substring(2) : key;

/// Similar when equal, or when both are at least four characters and any of:
/// Damerau-Levenshtein distance <= 1, same phonetic key (of length >= 2), or
/// one is a prefix of the other. A phrase and a single word only match when
/// the word is the phrase's first word.
bool _areKeysSimilar(String a, String b) {
  if (a == b) return true;
  if (a.length < 4 || b.length < 4) return false;

  final aHasSpace = a.contains(' ');
  final bHasSpace = b.contains(' ');
  if (aHasSpace != bHasSpace) {
    final phrase = aHasSpace ? a : b;
    final word = aHasSpace ? b : a;
    return phrase.startsWith('$word ');
  }

  if (damerauLevenshtein(a, b, cap: 2) <= 1) return true;

  final pa = phoneticKey(a);
  if (pa.length >= 2 && pa == phoneticKey(b)) return true;

  final shorter = a.length <= b.length ? a : b;
  final longer = a.length <= b.length ? b : a;
  return longer.startsWith(shorter);
}

/// Damerau-Levenshtein distance (optimal string alignment: adjacent
/// transposition counts as one edit), compared by UTF-16 code unit.
///
/// Returns `cap + 1` as soon as the distance is known to exceed [cap].
int damerauLevenshtein(String a, String b, {int cap = 99}) {
  if (a == b) return 0;
  final al = a.length;
  final bl = b.length;
  if ((al - bl).abs() > cap) return cap + 1;
  if (al == 0) return bl;
  if (bl == 0) return al;

  var prev2 = List<int>.filled(bl + 1, 0);
  var prev1 = List<int>.generate(bl + 1, (j) => j);
  var curr = List<int>.filled(bl + 1, 0);

  for (var i = 1; i <= al; i++) {
    curr[0] = i;
    var rowMin = i;
    for (var j = 1; j <= bl; j++) {
      final cost = a.codeUnitAt(i - 1) == b.codeUnitAt(j - 1) ? 0 : 1;
      var v = curr[j - 1] + 1; // insertion
      if (prev1[j] + 1 < v) v = prev1[j] + 1; // deletion
      if (prev1[j - 1] + cost < v) v = prev1[j - 1] + cost; // substitution
      if (i > 1 &&
          j > 1 &&
          a.codeUnitAt(i - 1) == b.codeUnitAt(j - 2) &&
          a.codeUnitAt(i - 2) == b.codeUnitAt(j - 1) &&
          prev2[j - 2] + 1 < v) {
        v = prev2[j - 2] + 1; // transposition
      }
      curr[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > cap) return cap + 1;
    final tmp = prev2;
    prev2 = prev1;
    prev1 = curr;
    curr = tmp;
  }
  return prev1[bl];
}

/// Cheap phonetic key: drops vowels, `y`, `h`, `w` and spaces, then collapses
/// consecutive duplicates. "uber" and "oober" both give "br".
String phoneticKey(String word) {
  final out = StringBuffer();
  int? last;
  // By code point, like JS `for...of` over a string.
  for (final rune in word.runes) {
    if (_phoneticSkip.contains(rune)) continue;
    if (rune == last) continue;
    out.writeCharCode(rune);
    last = rune;
  }
  return out.toString();
}

final Set<int> _phoneticSkip = 'aeiouyhw '.codeUnits.toSet();

// =============================================================================
// Steps 7-8: display name and bucket assembly
// =============================================================================

/// Uses the most common raw note when it accounts for at least 60% of the
/// bucket; otherwise keeps the title-cased key.
String _pickDisplayName(
  String currentDisplay,
  Map<String, int> rawNoteCounts,
  int totalCount,
) {
  if (totalCount == 0) return currentDisplay;
  String? bestRaw;
  var bestCount = 0;
  rawNoteCounts.forEach((raw, c) {
    if (c > bestCount) {
      bestRaw = raw;
      bestCount = c;
    }
  });
  final best = bestRaw;
  if (best != null && bestCount / totalCount >= 0.6) return _jsTrim(best);
  return currentDisplay;
}

String _titleCase(String s) => s
    .split(' ')
    .map((w) => w.isEmpty ? w : w[0].toUpperCase() + w.substring(1))
    .join(' ');

NoteBucket _toBucket(_Aggregated agg, int rank, double grandTotal) =>
    NoteBucket(
      key: agg.key,
      displayName: agg.displayName,
      total: agg.total,
      count: agg.count,
      percentage: (agg.total / grandTotal) * 100,
      color: bucketPalette[rank % bucketPalette.length],
      transactions: List.unmodifiable(agg.transactions),
      fromMerchantDictionary: agg.fromMerchantDictionary,
      sampleRawNotes: List.unmodifiable(_pickSampleRawNotes(agg.rawNoteCounts)),
    );

List<String> _pickSampleRawNotes(Map<String, int> rawNoteCounts) {
  if (rawNoteCounts.isEmpty) return const [];
  final entries =
      _stableSortDesc(rawNoteCounts.entries.toList(), (e) => e.value);
  return [
    for (final e in entries.take(3))
      if (_jsTrim(e.key).isNotEmpty) _jsTrim(e.key),
  ];
}

// =============================================================================
// JS-compatibility helpers
// =============================================================================

/// `x || 1` for a JS number: zero and NaN are falsy.
double _orOne(double x) => (x == 0 || x.isNaN) ? 1 : x;

/// Returns a copy of [items] sorted by [value] descending. `List.sort` is not
/// guaranteed stable, whereas JS `Array.prototype.sort` is, so ties (and NaN
/// comparisons, which JS treats as equal) are broken by original position.
List<T> _stableSortDesc<T>(List<T> items, num Function(T) value) {
  final indexed = [for (var i = 0; i < items.length; i++) (i, items[i])];
  indexed.sort((a, b) {
    final d = value(b.$2) - value(a.$2);
    if (d < 0) return -1;
    if (d > 0) return 1;
    return a.$1 - b.$1;
  });
  return [for (final e in indexed) e.$2];
}

/// `String.prototype.trim`. Dart's `trim` also removes U+0085, which JS keeps.
String _jsTrim(String s) {
  var start = 0;
  var end = s.length;
  while (start < end && _isJsWhitespace(s.codeUnitAt(start))) {
    start++;
  }
  while (end > start && _isJsWhitespace(s.codeUnitAt(end - 1))) {
    end--;
  }
  return s.substring(start, end);
}

bool _isJsWhitespace(int c) =>
    (c >= 0x09 && c <= 0x0d) ||
    c == 0x20 ||
    c == 0xa0 ||
    c == 0x1680 ||
    (c >= 0x2000 && c <= 0x200a) ||
    c == 0x2028 ||
    c == 0x2029 ||
    c == 0x202f ||
    c == 0x205f ||
    c == 0x3000 ||
    c == 0xfeff;
