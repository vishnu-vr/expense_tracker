/// Category lookup for bank SMS auto-add (D-029). Pure Dart.
///
/// The app turns the household's entries into a small table and pushes it to
/// the Android side, which only looks things up when a message arrives. The
/// confidence rule lives here, so it is unit-tested in one place.
library;

import 'merchant_dictionary.dart';
import 'models.dart';

/// Normalised merchant name. Must match `MerchantKey.kt`; both are tested
/// against `test/fixtures/merchant_key_vectors.json`.
///
/// Lowercase; for a UPI address only the part before `@`; every
/// non-alphanumeric character becomes a space; digit-only tokens are dropped;
/// spaces collapse. Null when nothing is left.
String? merchantKey(String? raw) {
  if (raw == null) return null;
  var s = raw.toLowerCase();
  final at = s.indexOf('@');
  if (at >= 0) s = s.substring(0, at);
  final key = s
      .replaceAll(RegExp(r'[^a-z0-9]+'), ' ')
      .split(' ')
      .where((t) => t.isNotEmpty && !RegExp(r'^[0-9]+$').hasMatch(t))
      .join(' ');
  return key.isEmpty ? null : key;
}

/// Default category for a canonical merchant of [merchantDictionary]. Payment
/// apps (Paytm, PhonePe, GPay) say nothing about what was bought, so they
/// have none.
const Map<String, String> builtinMerchantCategories = {
  'Uber': 'transportation',
  'Ola': 'transportation',
  'Rapido': 'transportation',
  'Auto': 'transportation',
  'Metro': 'transportation',
  'Bus': 'transportation',
  'Train': 'transportation',
  'Flight': 'transportation',
  'Cab': 'transportation',
  'Petrol': 'car',
  'Swiggy': 'food',
  'Zomato': 'food',
  'Eatfit': 'food',
  'Blinkit': 'grocery',
  'Zepto': 'grocery',
  'Dunzo': 'grocery',
  'BigBasket': 'grocery',
  'DMart': 'grocery',
  'More': 'grocery',
  'Amazon': 'shopping',
  'Flipkart': 'shopping',
  'Meesho': 'shopping',
  'Myntra': 'clothing',
  'Ajio': 'clothing',
  'Netflix': 'entertainment',
  'Prime Video': 'entertainment',
  'Hotstar': 'entertainment',
  'Spotify': 'entertainment',
  'YouTube': 'entertainment',
  'PVR': 'entertainment',
  'Jio': 'telephone',
  'Airtel': 'telephone',
  'Vi': 'telephone',
  'Electricity': 'bills',
  'Gas': 'bills',
};

/// A merchant needs this many past entries before its history counts...
const smsHistoryMinEntries = 2;

/// ...and this share of them in one category.
const smsHistoryMinShare = 0.8;

/// The merchant part of a note: SMS notes are "Swiggy · HDFC XX1234".
String _noteHead(String note) => note.split(' · ').first;

// ------------------------------------------------------------ quick suggestions

/// Amount bands for quick category suggestions: below 100, 100–300, 300–1k,
/// 1k–3k, 3k–10k, 10k and above. Exported in the table so Kotlin uses the
/// same edges.
const smsAmountBands = <double>[100, 300, 1000, 3000, 10000];

/// Start hours of the day-parts: morning 5–11, afternoon 11–16, evening
/// 16–21, night 21–5 (the last part wraps past midnight).
const smsDayParts = <int>[5, 11, 16, 21];

/// How many quick suggestions are kept per cell.
const smsQuickSuggestionCount = 3;

/// Categories offered when the household has no history yet.
const _starterCategories = {
  TransactionType.expense: ['food', 'grocery', 'transportation'],
  TransactionType.income: ['salary', 'gifts', 'business'],
};

int smsAmountBand(double amount) => smsAmountBands.where((edge) => amount >= edge).length;

/// Hours before the first start belong to the last part (night).
int smsDayPart(int hour) {
  var part = smsDayParts.length - 1;
  for (var i = 0; i < smsDayParts.length; i++) {
    if (hour >= smsDayParts[i]) part = i;
  }
  return part;
}

String smsSuggestCell(int band, int part) => 'b${band}p$part';

/// Ranks the household's categories for every amount band × day-part.
///
/// Each past entry of the direction scores for a cell: 3 when it is in the
/// same band and day-part, 2 for the same band only, 1 for the neighbouring
/// band at the same day-part. The top [smsQuickSuggestionCount] with a
/// score are kept, ties broken by overall use; the rest are filled from the
/// household's most-used categories ([top]).
({Map<TransactionType, Map<String, List<String>>> cells, Map<TransactionType, List<String>> top})
buildQuickSuggestions(List<Transaction> transactions, List<Category> categories) {
  final byId = {for (final c in categories) c.id: c};
  final cells = <TransactionType, Map<String, List<String>>>{};
  final top = <TransactionType, List<String>>{};
  for (final type in TransactionType.values) {
    final txs = [
      for (final t in transactions)
        if (t.type == type && byId[t.categoryId]?.type == type) t,
    ];
    final use = <String, int>{};
    for (final t in txs) {
      use[t.categoryId] = (use[t.categoryId] ?? 0) + 1;
    }
    final overall = use.keys.toList()
      ..sort(
        (a, b) => use[b]!.compareTo(use[a]!) != 0 ? use[b]!.compareTo(use[a]!) : a.compareTo(b),
      );
    final starters = [
      for (final id in _starterCategories[type]!)
        if (byId[id]?.type == type && !overall.contains(id)) id,
    ];
    final fallback = [...overall, ...starters].take(smsQuickSuggestionCount).toList();
    top[type] = fallback;

    final bands = [for (final t in txs) smsAmountBand(t.amount)];
    final parts = [for (final t in txs) smsDayPart(t.date.hour)];
    final byCell = <String, List<String>>{};
    for (var band = 0; band <= smsAmountBands.length; band++) {
      for (var part = 0; part < smsDayParts.length; part++) {
        final score = <String, int>{};
        for (var i = 0; i < txs.length; i++) {
          final w = bands[i] == band
              ? (parts[i] == part ? 3 : 2)
              : ((bands[i] - band).abs() == 1 && parts[i] == part ? 1 : 0);
          if (w > 0) score[txs[i].categoryId] = (score[txs[i].categoryId] ?? 0) + w;
        }
        final ranked = score.keys.toList()
          ..sort((a, b) {
            final s = score[b]!.compareTo(score[a]!);
            return s != 0 ? s : use[b]!.compareTo(use[a]!);
          });
        final list = [...ranked.take(smsQuickSuggestionCount)];
        for (final id in fallback) {
          if (list.length >= smsQuickSuggestionCount) break;
          if (!list.contains(id)) list.add(id);
        }
        if (list.isNotEmpty) byCell[smsSuggestCell(band, part)] = list;
      }
    }
    cells[type] = byCell;
  }
  return (cells: cells, top: top);
}

// ------------------------------------------------------------ note words

/// Words that say nothing about a category.
const _stopWords = {
  'the',
  'and',
  'for',
  'from',
  'with',
  'via',
  'paid',
  'payment',
  'sent',
  'upi',
  'bank',
  'hdfc',
  'icici',
  'sbi',
  'axis',
  'kotak',
  'this',
  'that',
  'some',
  'was',
  'our',
  'his',
  'her',
  'its',
};

/// Built-in keywords for typed replies ("auto to office", "lunch"), used
/// when the household's own notes say nothing about a word. Only kept for
/// categories the household has.
const builtinKeywordCategories = <String, String>{
  'auto': 'transportation',
  'rickshaw': 'transportation',
  'cab': 'transportation',
  'taxi': 'transportation',
  'bus': 'transportation',
  'train': 'transportation',
  'metro': 'transportation',
  'ticket': 'transportation',
  'parking': 'transportation',
  'toll': 'transportation',
  'petrol': 'car',
  'diesel': 'car',
  'fuel': 'car',
  'service': 'car',
  'lunch': 'food',
  'dinner': 'food',
  'breakfast': 'food',
  'tea': 'food',
  'chai': 'food',
  'coffee': 'food',
  'snacks': 'food',
  'snack': 'food',
  'food': 'food',
  'biryani': 'food',
  'juice': 'food',
  'hotel': 'food',
  'restaurant': 'food',
  'meals': 'food',
  'vegetables': 'grocery',
  'veggies': 'grocery',
  'vegetable': 'grocery',
  'milk': 'grocery',
  'grocery': 'grocery',
  'groceries': 'grocery',
  'fruits': 'grocery',
  'fruit': 'grocery',
  'fish': 'grocery',
  'meat': 'grocery',
  'chicken': 'grocery',
  'eggs': 'grocery',
  'rice': 'grocery',
  'provisions': 'grocery',
  'medicine': 'health',
  'medicines': 'health',
  'doctor': 'health',
  'hospital': 'health',
  'pharmacy': 'health',
  'clinic': 'health',
  'tablets': 'health',
  'electricity': 'bills',
  'water': 'bills',
  'bill': 'bills',
  'gas': 'bills',
  'maid': 'home',
  'rent': 'home',
  'plumber': 'home',
  'electrician': 'home',
  'repair': 'home',
  'recharge': 'telephone',
  'mobile': 'telephone',
  'internet': 'telephone',
  'wifi': 'telephone',
  'movie': 'entertainment',
  'cinema': 'entertainment',
  'haircut': 'beauty',
  'salon': 'beauty',
  'parlour': 'beauty',
  'shirt': 'clothing',
  'dress': 'clothing',
  'clothes': 'clothing',
  'saree': 'clothing',
  'tailor': 'clothing',
  'shoes': 'clothing',
  'school': 'education',
  'tuition': 'education',
  'fees': 'education',
  'books': 'education',
  'gift': 'gift',
  'donation': 'social',
  'temple': 'social',
  'church': 'social',
  'gym': 'sport',
};

/// Lowercase words of a note worth learning from: at least 3 letters, no
/// digits, not a stop word.
Iterable<String> noteWords(String text) => text
    .toLowerCase()
    .split(RegExp(r'[^a-z0-9]+'))
    .where((w) => w.length >= 3 && !RegExp(r'[0-9]').hasMatch(w) && !_stopWords.contains(w));

/// `"<type>:<word>"` → category for words the household uses consistently:
/// at least [smsHistoryMinEntries] notes and [smsHistoryMinShare] of them in
/// one category, at most [max] words (most used first).
Map<String, String> buildWordCategories(
  List<Transaction> transactions,
  List<Category> categories, {
  int max = 400,
}) {
  final byId = {for (final c in categories) c.id: c};
  final counts = <String, Map<String, int>>{};
  for (final t in transactions) {
    final note = t.note?.trim() ?? '';
    if (note.isEmpty || byId[t.categoryId]?.type != t.type) continue;
    for (final w in noteWords(note).toSet()) {
      final m = counts.putIfAbsent('${t.type.name}:$w', () => {});
      m[t.categoryId] = (m[t.categoryId] ?? 0) + 1;
    }
  }
  final known = <({String key, String id, int total})>[];
  counts.forEach((key, byCategory) {
    final total = byCategory.values.fold<int>(0, (a, b) => a + b);
    if (total < smsHistoryMinEntries) return;
    final top = byCategory.entries.reduce((a, b) => b.value > a.value ? b : a);
    if (top.value / total >= smsHistoryMinShare) known.add((key: key, id: top.key, total: total));
  });
  known.sort((a, b) => b.total.compareTo(a.total));
  return {for (final k in known.take(max)) k.key: k.id};
}

/// The entry note for a detected payment: the typed words first, then who
/// was paid ("auto to office · Ramesh K"); without words, payee and account
/// ("Ramesh K · HDFC XX1234"). Same rule as `SmsNote.compose` in Kotlin.
String? smsNote({String? words, String? merchant, String? account}) {
  final w = words?.trim() ?? '';
  final parts = w.isEmpty ? [?merchant, ?account] : [w, ?(merchant ?? account)];
  return parts.isEmpty ? null : parts.join(' · ');
}

/// Lookup table pushed to Android. Only "known" merchants are in [history].
class SmsCategoryTable {
  const SmsCategoryTable({
    required this.history,
    required this.builtin,
    required this.categories,
    this.words = const {},
    this.keywords = const {},
    this.suggestCells = const {},
    this.topCategories = const {},
  });

  /// `"<type>:<word>"` → category, from the household's notes.
  final Map<String, String> words;

  /// Built-in reply keywords for categories the household has: word → category.
  final Map<String, String> keywords;

  /// Quick suggestions per direction and cell ([smsSuggestCell]).
  final Map<TransactionType, Map<String, List<String>>> suggestCells;

  /// Most-used categories per direction, the fallback for suggestions.
  final Map<TransactionType, List<String>> topCategories;

  /// Up to [n] categories to offer for a payment of [amount] at [at].
  List<String> quickSuggestions(TransactionType type, double? amount, DateTime at, {int n = 2}) {
    final cell = amount == null
        ? null
        : suggestCells[type]?[smsSuggestCell(smsAmountBand(amount), smsDayPart(at.hour))];
    return (cell ?? topCategories[type] ?? const <String>[]).take(n).toList();
  }

  /// `"<type>:<merchant key>"` → category id.
  final Map<String, String> history;

  /// Built-in merchants in dictionary order: pattern, canonical key, default category.
  final List<({String pattern, String key, String? categoryId})> builtin;
  final List<Category> categories;

  Map<String, Object?> toJson({
    required String? homeId,
    required String? userId,
    required String? userEmail,
    Map<String, String>? firebase,
  }) => {
    'version': 2,
    'homeId': homeId,
    'userId': userId,
    'userEmail': userEmail,
    'firebase': firebase,
    'history': history,
    'builtin': [
      for (final b in builtin)
        {'p': b.pattern, 'm': b.key, if (b.categoryId != null) 'c': b.categoryId},
    ],
    'categories': [
      for (final c in categories) {'id': c.id, 'name': c.name, 'type': c.type.name},
    ],
    'words': words,
    'keywords': keywords,
    'bands': smsAmountBands,
    'parts': smsDayParts,
    'suggest': {for (final e in suggestCells.entries) e.key.name: e.value},
    'top': {for (final e in topCategories.entries) e.key.name: e.value},
  };
}

/// Builds the table from the household's [transactions].
///
/// The confidence rule (D-029): a merchant is "known" when at least
/// [smsHistoryMinEntries] past entries of one direction carry it and at least
/// [smsHistoryMinShare] of them share one category. An entry counts for the
/// merchant part of its note and, when the note names a dictionary merchant,
/// for that canonical merchant too (so "Swiggy dinner" teaches "swiggy").
/// Built-in defaults are kept only for categories the household has.
SmsCategoryTable buildCategoryTable(List<Transaction> transactions, List<Category> categories) {
  final byId = {for (final c in categories) c.id: c};
  final counts = <String, Map<String, int>>{};

  void count(String key, String categoryId) {
    final m = counts.putIfAbsent(key, () => {});
    m[categoryId] = (m[categoryId] ?? 0) + 1;
  }

  for (final t in transactions) {
    final note = t.note?.trim() ?? '';
    final category = byId[t.categoryId];
    if (note.isEmpty || category == null || category.type != t.type) continue;
    final keys = <String>{};
    final head = merchantKey(_noteHead(note));
    if (head != null) keys.add(head);
    final canonical = matchMerchant(merchantKey(note) ?? '');
    final canonicalKey = merchantKey(canonical);
    if (canonicalKey != null) keys.add(canonicalKey);
    for (final k in keys) {
      count('${t.type.name}:$k', t.categoryId);
    }
  }

  final history = <String, String>{};
  counts.forEach((key, byCategory) {
    final total = byCategory.values.fold<int>(0, (a, b) => a + b);
    if (total < smsHistoryMinEntries) return;
    final top = byCategory.entries.reduce((a, b) => b.value > a.value ? b : a);
    if (top.value / total >= smsHistoryMinShare) history[key] = top.key;
  });

  final quick = buildQuickSuggestions(transactions, categories);
  return SmsCategoryTable(
    history: history,
    words: buildWordCategories(transactions, categories),
    keywords: {
      for (final e in builtinKeywordCategories.entries)
        if (byId[e.value]?.type == TransactionType.expense) e.key: e.value,
    },
    suggestCells: quick.cells,
    topCategories: quick.top,
    builtin: [
      for (final e in merchantDictionary)
        (
          pattern: e.pattern,
          key: merchantKey(e.canonical)!,
          categoryId: switch (builtinMerchantCategories[e.canonical]) {
            final id? when byId[id]?.type == TransactionType.expense => id,
            _ => null,
          },
        ),
    ],
    categories: categories,
  );
}

/// A message waiting in "Review detected entries". Parsed fields only.
class DetectedEntry {
  const DetectedEntry({
    required this.id,
    required this.type,
    required this.receivedAt,
    this.amount,
    this.merchant,
    this.account,
    this.categoryId,
    this.categorySource,
    this.words,
    this.aiModel,
  });

  final String id;
  final double? amount;
  final TransactionType type;
  final String? merchant;
  final String? account;
  final DateTime receivedAt;

  /// Suggested category, if any.
  final String? categoryId;

  /// `history`, `builtin`, `memory`, or `ai` / `nano` (a model's suggestion, D-032).
  final String? categorySource;

  /// What the user typed in a notification reply, if anything.
  final String? words;

  /// The model behind an AI suggestion, e.g. "Gemini Flash-Lite".
  final String? aiModel;

  /// The category came from AI and waits for the user's approval (D-032).
  bool get isAiSuggestion => categoryId != null && (categorySource == 'ai' || categorySource == 'nano');

  /// "Swiggy · HDFC XX1234", or "auto to office · Ramesh K" with [words].
  String? get note => smsNote(words: words, merchant: merchant, account: account);

  static DetectedEntry? fromMap(Object? raw) {
    if (raw is! Map) return null;
    final id = raw['id'];
    final at = raw['receivedAt'];
    if (id is! String || at is! num) return null;
    final amount = raw['amount'];
    return DetectedEntry(
      id: id,
      amount: amount is num && amount > 0 ? amount.toDouble() : null,
      type: raw['type'] == 'income' ? TransactionType.income : TransactionType.expense,
      merchant: raw['merchant'] as String?,
      account: raw['account'] as String?,
      receivedAt: DateTime.fromMillisecondsSinceEpoch(at.toInt()),
      categoryId: raw['categoryId'] as String?,
      categorySource: raw['categorySource'] as String?,
      words: raw['words'] as String?,
      aiModel: raw['aiModel'] as String? ?? (raw['categorySource'] == 'nano' ? 'Gemini Nano' : null),
    );
  }
}
