// Tests for the port of `src/app/core/utils/note-grouping.ts`.
//
// The tables at the bottom of this file (`_paritySamples`, `_normalizeParity`,
// `_editDistanceParity`, `_phoneticParity`) were produced by running the
// ORIGINAL TypeScript under Node v24 on the same inputs, so the "parity"
// groups assert that the Dart port returns exactly what the TS returns,
// including bucket order, tie-breaks and unrounded doubles.
import 'package:flutter_test/flutter_test.dart';
import 'package:track_expense/core/domain/models.dart';
import 'package:track_expense/core/domain/note_grouping.dart';

typedef _Exp = ({
  String key,
  String name,
  double total,
  int count,
  double pct,
  String color,
  List<String> ids,
  bool merchant,
  List<String> samples,
});

typedef _Sample = ({
  String name,
  List<(String?, double)> txns,
  List<_Exp> capped,
  List<_Exp> full,
  List<_Exp> recapped,
});

/// Transactions with ids `t1..tn`, in the given order.
List<Transaction> _txns(List<(String?, double)> rows) => [
      for (var i = 0; i < rows.length; i++)
        Transaction(
          id: 't${i + 1}',
          amount: rows[i].$2,
          categoryId: 'cat',
          date: DateTime(2026, 4, 1 + i),
          type: TransactionType.expense,
          note: rows[i].$1,
        ),
    ];

List<NoteBucket> _group(List<(String?, double)> rows, {bool applyTopN = true}) =>
    groupTransactionsByNoteRules(_txns(rows), applyTopN: applyTopN);

NoteBucket _byKey(List<NoteBucket> buckets, String key) =>
    buckets.singleWhere((b) => b.key == key);

void _expectBuckets(List<NoteBucket> actual, List<_Exp> expected) {
  expect(
    [for (final b in actual) b.key],
    [for (final e in expected) e.key],
    reason: 'bucket keys / order',
  );
  for (var i = 0; i < expected.length; i++) {
    final a = actual[i];
    final e = expected[i];
    final where = 'bucket #$i (${e.key})';
    expect(a.displayName, e.name, reason: '$where displayName');
    expect(a.total, e.total, reason: '$where total');
    expect(a.count, e.count, reason: '$where count');
    expect(a.percentage, e.pct, reason: '$where percentage');
    expect(a.color, e.color, reason: '$where color');
    expect(a.transactionIds, e.ids, reason: '$where transactionIds');
    expect(a.fromMerchantDictionary, e.merchant, reason: '$where merchant');
    expect(a.sampleRawNotes, e.samples, reason: '$where sampleRawNotes');
  }
}

void main() {
  group('normalizeNote', () {
    test('empty and null give an empty string', () {
      expect(normalizeNote(null), '');
      expect(normalizeNote(''), '');
      expect(normalizeNote('   '), '');
      expect(normalizeNote('!!! ---'), '');
    });

    test('lowercases, collapses separators and trims', () {
      expect(normalizeNote('  UBER  to   Office '), 'uber to office');
      expect(normalizeNote('D-Mart #42'), 'd mart 42');
      expect(normalizeNote('rs.500/-'), 'rs 500');
      expect(normalizeNote('under_score'), 'under score');
      expect(normalizeNote('tab\there\nnewline'), 'tab here newline');
    });

    test('folds Latin diacritics to the base letter', () {
      expect(normalizeNote('Café Coffee Day'), 'cafe coffee day');
      expect(normalizeNote('Crème brûlée'), 'creme brulee');
      expect(normalizeNote('naïve jalapeño'), 'naive jalapeno');
      expect(normalizeNote('Tiếng Việt'), 'tieng viet');
      expect(normalizeNote('Ångström'), 'angstrom');
    });

    test('deletes standalone combining marks instead of spacing them', () {
      expect(normalizeNote('café'), 'cafe');
      expect(normalizeNote('à́̂b'), 'ab');
    });

    test('handles the two characters whose lowercase form is not one letter',
        () {
      expect(normalizeNote('İstanbul'), 'istanbul'); // dotted capital I
      expect(normalizeNote('Kelvin'), 'kelvin'); // Kelvin sign
    });

    test('letters without a canonical decomposition become separators', () {
      expect(normalizeNote('Straße'), 'stra e');
      expect(normalizeNote('smørrebrød'), 'sm rrebr d');
      expect(normalizeNote('Łódź'), 'odz');
    });

    test('emoji and non-Latin scripts become separators', () {
      expect(normalizeNote('🍕 Pizza 🍕'), 'pizza');
      expect(normalizeNote('दूध milk'), 'milk');
      expect(normalizeNote('🍕'), '');
    });

    test('parity with the TypeScript on ${_normalizeParity.length} strings',
        () {
      for (final (input, expected) in _normalizeParity) {
        expect(normalizeNote(input), expected,
            reason: 'input code units: ${input.codeUnits}');
      }
    });
  });

  group('damerauLevenshtein', () {
    test('basic distances', () {
      expect(damerauLevenshtein('uber', 'uber'), 0);
      expect(damerauLevenshtein('', 'abc'), 3);
      expect(damerauLevenshtein('abc', ''), 3);
      expect(damerauLevenshtein('uber', 'ubr'), 1); // deletion
      expect(damerauLevenshtein('swiggy', 'swiggi'), 1); // substitution
      expect(damerauLevenshtein('zomato', 'zomatto'), 1); // insertion
      expect(damerauLevenshtein('uber', 'ubre'), 1); // transposition
      expect(damerauLevenshtein('kitten', 'sitting'), 3);
    });

    test('returns cap + 1 once the cap is exceeded', () {
      expect(damerauLevenshtein('uber', 'uber123', cap: 2), 3);
      expect(damerauLevenshtein('kitten', 'sitting', cap: 2), 3);
      expect(damerauLevenshtein('abcdef', 'ghijkl', cap: 2), 3);
      expect(damerauLevenshtein('a', 'b', cap: 0), 1);
    });

    test('parity with the TypeScript', () {
      for (final (a, b, cap, expected) in _editDistanceParity) {
        expect(damerauLevenshtein(a, b, cap: cap), expected,
            reason: '"$a" vs "$b" cap $cap');
      }
      for (final (a, b, expected) in _editDistanceDefaultCap) {
        expect(damerauLevenshtein(a, b), expected, reason: '"$a" vs "$b"');
      }
    });
  });

  group('phoneticKey', () {
    test('drops vowels, y/h/w and spaces, collapses repeats', () {
      expect(phoneticKey(''), '');
      expect(phoneticKey('uber'), 'br');
      expect(phoneticKey('oober'), 'br');
      expect(phoneticKey('rider'), 'rdr');
      expect(phoneticKey('rydr'), 'rdr');
      expect(phoneticKey('llama'), 'lm');
      expect(phoneticKey('why'), '');
      expect(phoneticKey('ice cream'), 'crm');
    });

    test('parity with the TypeScript', () {
      for (final (word, expected) in _phoneticParity) {
        expect(phoneticKey(word), expected, reason: '"$word"');
      }
    });
  });

  group('groupTransactionsByNoteRules', () {
    test('empty input gives no buckets', () {
      expect(groupTransactionsByNoteRules(const []), isEmpty);
      expect(groupTransactionsByNoteRules(const [], applyTopN: false), isEmpty);
    });

    test('single transaction gives one bucket holding it', () {
      final txns = _txns([('Chai', 20)]);
      final buckets = groupTransactionsByNoteRules(txns);
      expect(buckets, hasLength(1));
      final b = buckets.single;
      expect(b.key, 't:chai');
      expect(b.displayName, 'Chai');
      expect(b.total, 20);
      expect(b.count, 1);
      expect(b.percentage, 100);
      expect(b.color, bucketPalette[0]);
      expect(b.transactions, [same(txns.single)]);
      expect(b.transactionIds, ['t1']);
      expect(b.fromMerchantDictionary, isFalse);
      expect(b.isOther, isFalse);
      expect(b.isNoNote, isFalse);
      expect(b.sampleRawNotes, ['Chai']);
    });

    test('accepts any iterable and does not filter by type', () {
      final txns = _txns([('Chai', 20), ('chai', 5)]);
      final buckets = groupTransactionsByNoteRules(txns.reversed);
      expect(buckets.single.transactionIds, ['t2', 't1']);
    });

    test('no-note bucket collects null, blank, symbol-only and emoji notes',
        () {
      final buckets =
          _group([('', 10), (null, 20), ('   ', 30), ('!!!', 40), ('🍕', 50)]);
      final b = buckets.single;
      expect(b.key, noNoteKey);
      expect(b.isNoNote, isTrue);
      expect(b.displayName, 'No description');
      expect(b.total, 150);
      expect(b.count, 5);
      expect(b.fromMerchantDictionary, isFalse);
      // "!!!" and the emoji are the only raw notes that survive trimming.
      expect(b.sampleRawNotes, ['!!!', '🍕']);
    });

    test('merchant rule: variants map to the canonical brand', () {
      final buckets =
          _group([('Uber', 100), ('uber', 200), ('Uber to office', 300), ('Ubr', 50)]);
      final b = buckets.single;
      expect(b.key, 'm:uber');
      expect(b.displayName, 'Uber');
      expect(b.fromMerchantDictionary, isTrue);
      expect(b.total, 650);
      expect(b.count, 4);
    });

    test('merchant display name ignores the dominant raw note', () {
      final b = _group([('uber ride', 1), ('uber ride', 1), ('uber ride', 1)]).single;
      expect(b.displayName, 'Uber');
      expect(b.sampleRawNotes, ['uber ride']);
    });

    test('phrase rule: a repeated two-word phrase becomes the key', () {
      final buckets = _group([
        ('Milk packet', 28),
        ('milk packet 2', 56),
        ('Milk Packet morning', 28),
        ('milk packet', 28),
        ('Curd', 35),
      ]);
      final b = _byKey(buckets, 'p:milk packet');
      expect(b.displayName, 'Milk Packet');
      expect(b.count, 4);
      expect(b.total, 140);
      expect(b.fromMerchantDictionary, isFalse);
    });

    test('phrase rule: no phrase when its words also appear apart', () {
      // "chai" appears without "sutta" and vice versa, so the bigram fails
      // the co-occurrence test and the most frequent token wins instead.
      final buckets = _group([
        ('chai sutta', 30),
        ('Chai Sutta break', 45),
        ('chai', 15),
        ('chai sutta', 30),
        ('sutta', 20),
        ('Chai biscuit', 25),
      ]);
      expect([for (final b in buckets) b.key], ['t:chai', 't:sutta']);
      expect(buckets[0].transactionIds, ['t1', 't2', 't3', 't4', 't6']);
    });

    test('stem rule: plural forms share a bucket', () {
      final buckets = _group([
        ('samosas', 40),
        ('Samosa', 20),
        ('berries', 150),
        ('berry', 60),
        ('boxes', 80),
        ('box', 40),
        ('glass', 300),
        ('gas', 10),
      ]);
      expect(_byKey(buckets, 't:samosa').count, 2);
      expect(_byKey(buckets, 't:berry').count, 2);
      expect(_byKey(buckets, 't:box').count, 2);
      // "ss" endings and short words are left alone.
      expect(_byKey(buckets, 't:glass').count, 1);
      expect(_byKey(buckets, 't:gas').count, 1);
    });

    test('stop-words, numbers and single letters are not tokens', () {
      final buckets =
          _group([('to the market', 10), ('market at 5 pm', 20), ('2 kg x', 5)]);
      expect(_byKey(buckets, 't:market').count, 2);
      expect(_byKey(buckets, 't:kg').count, 1);
    });

    test('notes with no surviving token fall back to the raw key', () {
      final buckets = _group([('Rs 500', 500), ('rs. 500/-', 500), ('To', 15)]);
      expect([for (final b in buckets) b.key], ['r:rs 500', 'r:to']);
      expect(buckets[0].displayName, 'Rs 500');
      expect(buckets[0].count, 2);
      expect(buckets[1].displayName, 'To');
    });

    test('token tie-break: frequency, then length, then alphabetical', () {
      // "bread" is in two notes, so it beats the longer "butter".
      expect(
        _group([('bread butter', 1), ('bread', 1)]).single.key,
        't:bread',
      );
      // Equal frequency: the longer token wins.
      expect(_group([('jam butter', 1)]).single.key, 't:butter');
      // Equal frequency and length: the alphabetically smaller token wins.
      expect(_group([('pear kiwi', 1)]).single.key, 't:kiwi');
    });

    test('edit-distance rule: one typo merges into the larger bucket', () {
      final buckets =
          _group([('Laundry', 200), ('Laundary', 180), ('luandry', 90)]);
      final b = buckets.single;
      expect(b.key, 't:laundry');
      expect(b.total, 470);
      expect(b.transactionIds, ['t1', 't2', 't3']);
    });

    test('phonetic rule: same consonant skeleton merges', () {
      // Distance 2, no shared prefix: only the phonetic key ("rdr") matches.
      final b = _group([('rider', 50), ('rydr', 20)]).single;
      expect(b.key, 't:rider');
      expect(b.count, 2);
    });

    test('prefix rule: a key of four or more letters absorbs its extensions',
        () {
      final buckets = _group([('medical', 800), ('medic', 100), ('park', 40), ('parking', 60)]);
      expect([for (final b in buckets) b.key], ['t:medical', 't:parking']);
      expect(buckets[1].transactionIds, ['t4', 't3']);
    });

    test('keys shorter than four characters never fuzzy-merge', () {
      final buckets = _group([('tea', 10), ('tee', 12), ('pan', 20), ('paan', 25)]);
      expect(buckets, hasLength(4));
    });

    test('a phrase absorbs a word only when the word is its first word', () {
      final buckets = _group([
        ('pani puri', 50),
        ('pani puri', 50),
        ('pani', 20), // breaks the phrase: "pani" now appears alone
      ]);
      expect(buckets.single.key, 't:pani');

      final phrases = _group([
        ('hot chocolate fudge', 220),
        ('hot chocolate fudge', 220),
        ('chocolate fudge', 90),
      ]);
      expect(phrases.single.key, 'p:chocolate fudge');
      expect(phrases.single.displayName, 'hot chocolate fudge');
    });

    test('a non-merchant bucket can be absorbed by a merchant bucket', () {
      final buckets = _group([('Uber', 400), ('uber123', 80), ('ubereats', 320)]);
      final b = buckets.single;
      expect(b.key, 'm:uber');
      expect(b.fromMerchantDictionary, isTrue);
      expect(b.total, 800);
      expect(b.transactionIds, ['t1', 't3', 't2']);
    });

    test('a merchant bucket is never absorbed, even by a larger look-alike',
        () {
      final buckets = _group([('train', 150), ('trains', 160)]);
      expect([for (final b in buckets) b.key], ['t:train', 'm:train']);
      expect(buckets[0].fromMerchantDictionary, isFalse);
      expect(buckets[1].fromMerchantDictionary, isTrue);
    });

    test('the no-note bucket never takes part in fuzzy merging', () {
      final buckets = _group([('', 5000), ('note', 10), ('notebook', 5)]);
      expect([for (final b in buckets) b.key], [noNoteKey, 't:note']);
    });

    test('display name: dominant raw note (>= 60%) wins, else title-cased key',
        () {
      final buckets = _group([
        ('Dinner with friends', 900),
        ('Dinner with friends', 750),
        ('Dinner with friends', 820),
        ('dinner at home', 200),
        ('dinner at home', 150),
        ('Lunch', 120),
        ('lunch box', 80),
        ('LUNCH', 95),
        ('Lunch', 110),
        ('lunch thali', 130),
      ]);
      expect(buckets[0].displayName, 'Dinner with friends'); // 3 of 5
      expect(buckets[1].displayName, 'Lunch'); // 2 of 5: title-cased key
      expect(buckets[0].sampleRawNotes,
          ['Dinner with friends', 'dinner at home']);
      expect(buckets[1].sampleRawNotes, ['Lunch', 'lunch box', 'LUNCH']);
    });

    test('display name is trimmed like JS trim (keeps U+0085)', () {
      expect(_group([('  Chai \n', 10)]).single.displayName, 'Chai');
      expect(_group([('\u0085Chai', 10)]).single.displayName, '\u0085Chai');
    });

    test('ordering: total descending, ties keep first-seen order', () {
      final buckets = _group([
        ('Zebra', 100),
        ('Apple', 100),
        ('Mango', 300),
        ('Banana', 100),
        ('', 100),
      ]);
      expect(
        [for (final b in buckets) b.displayName],
        ['Mango', 'Zebra', 'Apple', 'Banana', 'No description'],
      );
    });

    test('colours follow rank and percentages are shares of the total', () {
      final buckets = _group([('Gym', 500), ('Books', 300), ('Toys', 200)]);
      expect([for (final b in buckets) b.color], bucketPalette.take(3));
      expect([for (final b in buckets) b.percentage], [50, 30, 20]);
    });

    test('a zero category total falls back to a divisor of 1', () {
      final buckets = _group([('Refund', -500), ('Shoes', 500)]);
      expect([for (final b in buckets) b.percentage], [50000, -50000]);
    });

    test('top-N: six buckets are shown whole, with no Other', () {
      final rows = [
        ('Haircut', 300.0),
        ('Books', 850.0),
        ('Gym', 1500.0),
        ('Toys', 420.0),
        ('Flowers', 150.0),
        ('Gift', 999.0),
      ];
      final buckets = _group(rows);
      expect(buckets, hasLength(6));
      expect(buckets.any((b) => b.isOther), isFalse);
      expect(buckets.last.color, bucketPalette[5]);
    });

    test('top-N: seven or more buckets keep five and roll the rest into Other',
        () {
      final rows = [
        ('Haircut', 300.0),
        ('Books', 850.0),
        ('Gym', 1500.0),
        ('Toys', 420.0),
        ('Flowers', 150.0),
        ('Gift', 999.0),
        ('Stationery', 75.0),
        ('Tailor', 600.0),
        ('Cobbler', 50.0),
        ('Books', 150.0),
      ];
      final txns = _txns(rows);
      final buckets = groupTransactionsByNoteRules(txns);
      expect(
        [for (final b in buckets) b.displayName],
        ['Gym', 'Books', 'Gift', 'Tailor', 'Toys', 'Other'],
      );
      final other = buckets.last;
      expect(other.key, otherKey);
      expect(other.isOther, isTrue);
      expect(other.color, otherColor);
      expect(other.total, 575);
      expect(other.count, 4);
      expect(other.transactionIds, ['t1', 't5', 't7', 't9']);
      expect(other.transactions, [txns[0], txns[4], txns[6], txns[8]]);
      expect(other.fromMerchantDictionary, isFalse);
      expect(other.sampleRawNotes, isEmpty);
      expect(other.percentage, closeTo(575 / 5094 * 100, 1e-12));
      // Nothing is lost.
      expect(buckets.fold<int>(0, (s, b) => s + b.count), txns.length);
      expect(buckets.fold<double>(0, (s, b) => s + b.total), 5094);

      final full = groupTransactionsByNoteRules(txns, applyTopN: false);
      expect(full, hasLength(9));
      expect(full.any((b) => b.isOther), isFalse);
    });

    test('result lists of transactions and samples are unmodifiable', () {
      final b = _group([('Chai', 20)]).single;
      expect(() => b.transactions.clear(), throwsUnsupportedError);
      expect(() => b.sampleRawNotes.clear(), throwsUnsupportedError);
    });

    test('does not mutate or reorder the input', () {
      final txns = _txns([('b', 1), ('Chai', 20), ('a', 3)]);
      final copy = [...txns];
      groupTransactionsByNoteRules(txns);
      expect(txns, copy);
    });
  });

  group('applyTopNAndOther', () {
    test('empty list', () {
      expect(applyTopNAndOther(const []), isEmpty);
    });

    test('without an override, percentages use the sum of bucket totals', () {
      final full = _group(
        [('Gym', 500), ('Books', 300), ('Toys', 200)],
        applyTopN: false,
      );
      final capped = applyTopNAndOther(full.reversed.toList());
      expect([for (final b in capped) b.key], ['t:gym', 't:book', 't:toy']);
      expect([for (final b in capped) b.percentage], [50, 30, 20]);

      final halved = applyTopNAndOther(full, grandTotalOverride: 2000);
      expect([for (final b in halved) b.percentage], [25, 15, 10]);
    });

    test('merchant and no-note buckets keep their colour, others are re-ranked',
        () {
      NoteBucket bucket(String key, double total, String color,
              {bool merchant = false}) =>
          NoteBucket(
            key: key,
            displayName: key,
            total: total,
            count: 1,
            percentage: 0,
            color: color,
            transactions: const [],
            fromMerchantDictionary: merchant,
            sampleRawNotes: const [],
          );
      final out = applyTopNAndOther([
        bucket('t:low', 10, '#000000'),
        bucket('m:uber', 30, '#111111', merchant: true),
        bucket(noNoteKey, 20, '#222222'),
        bucket('t:high', 40, '#333333'),
      ]);
      expect([for (final b in out) b.key],
          ['t:high', 'm:uber', noNoteKey, 't:low']);
      expect([for (final b in out) b.color],
          [bucketPalette[0], '#111111', '#222222', bucketPalette[3]]);
    });
  });

  group('parity with the original TypeScript', () {
    test('covers at least 25 samples', () {
      expect(_paritySamples.length, greaterThanOrEqualTo(25));
    });

    for (final sample in _paritySamples) {
      test(sample.name, () {
        final txns = _txns(sample.txns);
        _expectBuckets(groupTransactionsByNoteRules(txns), sample.capped);
        final full = groupTransactionsByNoteRules(txns, applyTopN: false);
        _expectBuckets(full, sample.full);
        // applyTopNAndOther on its own, with no grand-total override.
        _expectBuckets(applyTopNAndOther(full), sample.recapped);
      });
    }
  });
}

// ignore_for_file: lines_longer_than_80_chars

// GENERATED by running the original note-grouping.ts under Node v24.
const List<_Sample> _paritySamples = [
  (
    name: 'doc worked example',
    txns: [('Uber', 100.0), ('uber', 200.0), ('Uber to office', 300.0), ('Ubr', 50.0), ('uber123', 80.0), ('Petrol pump', 150.0), ('Petrol pump', 180.0), ('petrol HP', 120.0), ('Movie', 50.0), ('Cinema', 70.0), ('', 40.0)],
    capped: [
      (key: 'm:uber', name: 'Uber', total: 730.0, count: 5, pct: 54.47761194029851, color: '#6366f1', ids: ['t1', 't2', 't3', 't4', 't5'], merchant: true, samples: ['Uber', 'uber', 'Uber to office']),
      (key: 'm:petrol', name: 'Petrol', total: 450.0, count: 3, pct: 33.582089552238806, color: '#10b981', ids: ['t6', 't7', 't8'], merchant: true, samples: ['Petrol pump', 'petrol HP']),
      (key: 't:cinema', name: 'Cinema', total: 70.0, count: 1, pct: 5.223880597014925, color: '#f59e0b', ids: ['t10'], merchant: false, samples: ['Cinema']),
      (key: 't:movie', name: 'Movie', total: 50.0, count: 1, pct: 3.731343283582089, color: '#ef4444', ids: ['t9'], merchant: false, samples: ['Movie']),
      (key: '__no_note__', name: 'No description', total: 40.0, count: 1, pct: 2.9850746268656714, color: '#8b5cf6', ids: ['t11'], merchant: false, samples: []),
    ],
    full: [
      (key: 'm:uber', name: 'Uber', total: 730.0, count: 5, pct: 54.47761194029851, color: '#6366f1', ids: ['t1', 't2', 't3', 't4', 't5'], merchant: true, samples: ['Uber', 'uber', 'Uber to office']),
      (key: 'm:petrol', name: 'Petrol', total: 450.0, count: 3, pct: 33.582089552238806, color: '#10b981', ids: ['t6', 't7', 't8'], merchant: true, samples: ['Petrol pump', 'petrol HP']),
      (key: 't:cinema', name: 'Cinema', total: 70.0, count: 1, pct: 5.223880597014925, color: '#f59e0b', ids: ['t10'], merchant: false, samples: ['Cinema']),
      (key: 't:movie', name: 'Movie', total: 50.0, count: 1, pct: 3.731343283582089, color: '#ef4444', ids: ['t9'], merchant: false, samples: ['Movie']),
      (key: '__no_note__', name: 'No description', total: 40.0, count: 1, pct: 2.9850746268656714, color: '#8b5cf6', ids: ['t11'], merchant: false, samples: []),
    ],
    recapped: [
      (key: 'm:uber', name: 'Uber', total: 730.0, count: 5, pct: 54.47761194029851, color: '#6366f1', ids: ['t1', 't2', 't3', 't4', 't5'], merchant: true, samples: ['Uber', 'uber', 'Uber to office']),
      (key: 'm:petrol', name: 'Petrol', total: 450.0, count: 3, pct: 33.582089552238806, color: '#10b981', ids: ['t6', 't7', 't8'], merchant: true, samples: ['Petrol pump', 'petrol HP']),
      (key: 't:cinema', name: 'Cinema', total: 70.0, count: 1, pct: 5.223880597014925, color: '#f59e0b', ids: ['t10'], merchant: false, samples: ['Cinema']),
      (key: 't:movie', name: 'Movie', total: 50.0, count: 1, pct: 3.731343283582089, color: '#ef4444', ids: ['t9'], merchant: false, samples: ['Movie']),
      (key: '__no_note__', name: 'No description', total: 40.0, count: 1, pct: 2.9850746268656714, color: '#8b5cf6', ids: ['t11'], merchant: false, samples: []),
    ],
  ),
  (
    name: 'empty input',
    txns: [],
    capped: [
    ],
    full: [
    ],
    recapped: [
    ],
  ),
  (
    name: 'single noted transaction',
    txns: [('Chai', 20.0)],
    capped: [
      (key: 't:chai', name: 'Chai', total: 20.0, count: 1, pct: 100.0, color: '#6366f1', ids: ['t1'], merchant: false, samples: ['Chai']),
    ],
    full: [
      (key: 't:chai', name: 'Chai', total: 20.0, count: 1, pct: 100.0, color: '#6366f1', ids: ['t1'], merchant: false, samples: ['Chai']),
    ],
    recapped: [
      (key: 't:chai', name: 'Chai', total: 20.0, count: 1, pct: 100.0, color: '#6366f1', ids: ['t1'], merchant: false, samples: ['Chai']),
    ],
  ),
  (
    name: 'single null note',
    txns: [(null, 75.5)],
    capped: [
      (key: '__no_note__', name: 'No description', total: 75.5, count: 1, pct: 100.0, color: '#6366f1', ids: ['t1'], merchant: false, samples: []),
    ],
    full: [
      (key: '__no_note__', name: 'No description', total: 75.5, count: 1, pct: 100.0, color: '#6366f1', ids: ['t1'], merchant: false, samples: []),
    ],
    recapped: [
      (key: '__no_note__', name: 'No description', total: 75.5, count: 1, pct: 100.0, color: '#6366f1', ids: ['t1'], merchant: false, samples: []),
    ],
  ),
  (
    name: 'only blank, symbol and emoji notes',
    txns: [('', 10.0), (null, 20.0), ('   ', 30.0), ('!!!', 40.0), ('\u{1f355}\u{1f355}', 50.0), ('\u{2014}', 5.0)],
    capped: [
      (key: '__no_note__', name: 'No description', total: 155.0, count: 6, pct: 100.0, color: '#6366f1', ids: ['t1', 't2', 't3', 't4', 't5', 't6'], merchant: false, samples: ['!!!', '\u{1f355}\u{1f355}']),
    ],
    full: [
      (key: '__no_note__', name: 'No description', total: 155.0, count: 6, pct: 100.0, color: '#6366f1', ids: ['t1', 't2', 't3', 't4', 't5', 't6'], merchant: false, samples: ['!!!', '\u{1f355}\u{1f355}']),
    ],
    recapped: [
      (key: '__no_note__', name: 'No description', total: 155.0, count: 6, pct: 100.0, color: '#6366f1', ids: ['t1', 't2', 't3', 't4', 't5', 't6'], merchant: false, samples: ['!!!', '\u{1f355}\u{1f355}']),
    ],
  ),
  (
    name: 'food delivery typos',
    txns: [('Swiggy', 349.0), ('swgy dinner', 410.5), ('SWIGGY!!', 120.0), ('Swiggi', 99.0), ('swiggy123', 60.0), ('Zomato', 275.0), ('zomto', 180.0), ('Zomatto lunch', 220.0), ('zomato-gold', 149.0), ('Eat Fit', 199.0)],
    capped: [
      (key: 'm:swiggy', name: 'Swiggy', total: 1038.5, count: 5, pct: 50.37593984962406, color: '#6366f1', ids: ['t1', 't2', 't3', 't4', 't5'], merchant: true, samples: ['Swiggy', 'swgy dinner', 'SWIGGY!!']),
      (key: 'm:zomato', name: 'Zomato', total: 824.0, count: 4, pct: 39.97089497938394, color: '#10b981', ids: ['t6', 't9', 't8', 't7'], merchant: true, samples: ['Zomato', 'zomato-gold', 'Zomatto lunch']),
      (key: 'm:eatfit', name: 'Eatfit', total: 199.0, count: 1, pct: 9.653165170991997, color: '#f59e0b', ids: ['t10'], merchant: true, samples: ['Eat Fit']),
    ],
    full: [
      (key: 'm:swiggy', name: 'Swiggy', total: 1038.5, count: 5, pct: 50.37593984962406, color: '#6366f1', ids: ['t1', 't2', 't3', 't4', 't5'], merchant: true, samples: ['Swiggy', 'swgy dinner', 'SWIGGY!!']),
      (key: 'm:zomato', name: 'Zomato', total: 824.0, count: 4, pct: 39.97089497938394, color: '#10b981', ids: ['t6', 't9', 't8', 't7'], merchant: true, samples: ['Zomato', 'zomato-gold', 'Zomatto lunch']),
      (key: 'm:eatfit', name: 'Eatfit', total: 199.0, count: 1, pct: 9.653165170991997, color: '#f59e0b', ids: ['t10'], merchant: true, samples: ['Eat Fit']),
    ],
    recapped: [
      (key: 'm:swiggy', name: 'Swiggy', total: 1038.5, count: 5, pct: 50.37593984962406, color: '#6366f1', ids: ['t1', 't2', 't3', 't4', 't5'], merchant: true, samples: ['Swiggy', 'swgy dinner', 'SWIGGY!!']),
      (key: 'm:zomato', name: 'Zomato', total: 824.0, count: 4, pct: 39.97089497938394, color: '#10b981', ids: ['t6', 't9', 't8', 't7'], merchant: true, samples: ['Zomato', 'zomato-gold', 'Zomatto lunch']),
      (key: 'm:eatfit', name: 'Eatfit', total: 199.0, count: 1, pct: 9.653165170991997, color: '#f59e0b', ids: ['t10'], merchant: true, samples: ['Eat Fit']),
    ],
  ),
  (
    name: 'two-word phrases',
    txns: [('Milk packet', 28.0), ('milk packet 2', 56.0), ('Milk Packet morning', 28.0), ('Curd', 35.0), ('vegetables', 120.0), ('Vegetable market', 90.0), ('milk packet', 28.0), ('Bread', 45.0)],
    capped: [
      (key: 't:vegetabl', name: 'Vegetabl', total: 210.0, count: 2, pct: 48.837209302325576, color: '#6366f1', ids: ['t5', 't6'], merchant: false, samples: ['vegetables', 'Vegetable market']),
      (key: 'p:milk packet', name: 'Milk Packet', total: 140.0, count: 4, pct: 32.55813953488372, color: '#10b981', ids: ['t1', 't2', 't3', 't7'], merchant: false, samples: ['Milk packet', 'milk packet 2', 'Milk Packet morning']),
      (key: 't:bread', name: 'Bread', total: 45.0, count: 1, pct: 10.465116279069768, color: '#f59e0b', ids: ['t8'], merchant: false, samples: ['Bread']),
      (key: 't:curd', name: 'Curd', total: 35.0, count: 1, pct: 8.13953488372093, color: '#ef4444', ids: ['t4'], merchant: false, samples: ['Curd']),
    ],
    full: [
      (key: 't:vegetabl', name: 'Vegetabl', total: 210.0, count: 2, pct: 48.837209302325576, color: '#6366f1', ids: ['t5', 't6'], merchant: false, samples: ['vegetables', 'Vegetable market']),
      (key: 'p:milk packet', name: 'Milk Packet', total: 140.0, count: 4, pct: 32.55813953488372, color: '#10b981', ids: ['t1', 't2', 't3', 't7'], merchant: false, samples: ['Milk packet', 'milk packet 2', 'Milk Packet morning']),
      (key: 't:bread', name: 'Bread', total: 45.0, count: 1, pct: 10.465116279069768, color: '#f59e0b', ids: ['t8'], merchant: false, samples: ['Bread']),
      (key: 't:curd', name: 'Curd', total: 35.0, count: 1, pct: 8.13953488372093, color: '#ef4444', ids: ['t4'], merchant: false, samples: ['Curd']),
    ],
    recapped: [
      (key: 't:vegetabl', name: 'Vegetabl', total: 210.0, count: 2, pct: 48.837209302325576, color: '#6366f1', ids: ['t5', 't6'], merchant: false, samples: ['vegetables', 'Vegetable market']),
      (key: 'p:milk packet', name: 'Milk Packet', total: 140.0, count: 4, pct: 32.55813953488372, color: '#10b981', ids: ['t1', 't2', 't3', 't7'], merchant: false, samples: ['Milk packet', 'milk packet 2', 'Milk Packet morning']),
      (key: 't:bread', name: 'Bread', total: 45.0, count: 1, pct: 10.465116279069768, color: '#f59e0b', ids: ['t8'], merchant: false, samples: ['Bread']),
      (key: 't:curd', name: 'Curd', total: 35.0, count: 1, pct: 8.13953488372093, color: '#ef4444', ids: ['t4'], merchant: false, samples: ['Curd']),
    ],
  ),
  (
    name: 'phrase versus head word',
    txns: [('chai sutta', 30.0), ('Chai Sutta break', 45.0), ('chai', 15.0), ('chai sutta', 30.0), ('sutta', 20.0), ('Chai biscuit', 25.0)],
    capped: [
      (key: 't:chai', name: 'Chai', total: 145.0, count: 5, pct: 87.87878787878788, color: '#6366f1', ids: ['t1', 't2', 't3', 't4', 't6'], merchant: false, samples: ['chai sutta', 'Chai Sutta break', 'chai']),
      (key: 't:sutta', name: 'sutta', total: 20.0, count: 1, pct: 12.121212121212121, color: '#10b981', ids: ['t5'], merchant: false, samples: ['sutta']),
    ],
    full: [
      (key: 't:chai', name: 'Chai', total: 145.0, count: 5, pct: 87.87878787878788, color: '#6366f1', ids: ['t1', 't2', 't3', 't4', 't6'], merchant: false, samples: ['chai sutta', 'Chai Sutta break', 'chai']),
      (key: 't:sutta', name: 'sutta', total: 20.0, count: 1, pct: 12.121212121212121, color: '#10b981', ids: ['t5'], merchant: false, samples: ['sutta']),
    ],
    recapped: [
      (key: 't:chai', name: 'Chai', total: 145.0, count: 5, pct: 87.87878787878788, color: '#6366f1', ids: ['t1', 't2', 't3', 't4', 't6'], merchant: false, samples: ['chai sutta', 'Chai Sutta break', 'chai']),
      (key: 't:sutta', name: 'sutta', total: 20.0, count: 1, pct: 12.121212121212121, color: '#10b981', ids: ['t5'], merchant: false, samples: ['sutta']),
    ],
  ),
  (
    name: 'plural stemming',
    txns: [('samosas', 40.0), ('Samosa', 20.0), ('berries', 150.0), ('berry', 60.0), ('glasses', 900.0), ('glass', 300.0), ('boxes', 80.0), ('box', 40.0), ('dress', 1200.0), ('dresses', 2400.0), ('gas', 10.0), ('news', 5.0)],
    capped: [
      (key: 't:dress', name: 'Dress', total: 3600.0, count: 2, pct: 69.164265129683, color: '#6366f1', ids: ['t9', 't10'], merchant: false, samples: ['dress', 'dresses']),
      (key: 't:glass', name: 'Glass', total: 1200.0, count: 2, pct: 23.054755043227665, color: '#10b981', ids: ['t5', 't6'], merchant: false, samples: ['glasses', 'glass']),
      (key: 't:berry', name: 'Berry', total: 210.0, count: 2, pct: 4.034582132564841, color: '#f59e0b', ids: ['t3', 't4'], merchant: false, samples: ['berries', 'berry']),
      (key: 't:box', name: 'Box', total: 120.0, count: 2, pct: 2.3054755043227666, color: '#ef4444', ids: ['t7', 't8'], merchant: false, samples: ['boxes', 'box']),
      (key: 't:samosa', name: 'Samosa', total: 60.0, count: 2, pct: 1.1527377521613833, color: '#8b5cf6', ids: ['t1', 't2'], merchant: false, samples: ['samosas', 'Samosa']),
      (key: '__other__', name: 'Other', total: 15.0, count: 2, pct: 0.2881844380403458, color: '#9ca3af', ids: ['t11', 't12'], merchant: false, samples: []),
    ],
    full: [
      (key: 't:dress', name: 'Dress', total: 3600.0, count: 2, pct: 69.164265129683, color: '#6366f1', ids: ['t9', 't10'], merchant: false, samples: ['dress', 'dresses']),
      (key: 't:glass', name: 'Glass', total: 1200.0, count: 2, pct: 23.054755043227665, color: '#10b981', ids: ['t5', 't6'], merchant: false, samples: ['glasses', 'glass']),
      (key: 't:berry', name: 'Berry', total: 210.0, count: 2, pct: 4.034582132564841, color: '#f59e0b', ids: ['t3', 't4'], merchant: false, samples: ['berries', 'berry']),
      (key: 't:box', name: 'Box', total: 120.0, count: 2, pct: 2.3054755043227666, color: '#ef4444', ids: ['t7', 't8'], merchant: false, samples: ['boxes', 'box']),
      (key: 't:samosa', name: 'Samosa', total: 60.0, count: 2, pct: 1.1527377521613833, color: '#8b5cf6', ids: ['t1', 't2'], merchant: false, samples: ['samosas', 'Samosa']),
      (key: 't:gas', name: 'gas', total: 10.0, count: 1, pct: 0.19212295869356388, color: '#06b6d4', ids: ['t11'], merchant: false, samples: ['gas']),
      (key: 't:new', name: 'news', total: 5.0, count: 1, pct: 0.09606147934678194, color: '#6366f1', ids: ['t12'], merchant: false, samples: ['news']),
    ],
    recapped: [
      (key: 't:dress', name: 'Dress', total: 3600.0, count: 2, pct: 69.164265129683, color: '#6366f1', ids: ['t9', 't10'], merchant: false, samples: ['dress', 'dresses']),
      (key: 't:glass', name: 'Glass', total: 1200.0, count: 2, pct: 23.054755043227665, color: '#10b981', ids: ['t5', 't6'], merchant: false, samples: ['glasses', 'glass']),
      (key: 't:berry', name: 'Berry', total: 210.0, count: 2, pct: 4.034582132564841, color: '#f59e0b', ids: ['t3', 't4'], merchant: false, samples: ['berries', 'berry']),
      (key: 't:box', name: 'Box', total: 120.0, count: 2, pct: 2.3054755043227666, color: '#ef4444', ids: ['t7', 't8'], merchant: false, samples: ['boxes', 'box']),
      (key: 't:samosa', name: 'Samosa', total: 60.0, count: 2, pct: 1.1527377521613833, color: '#8b5cf6', ids: ['t1', 't2'], merchant: false, samples: ['samosas', 'Samosa']),
      (key: '__other__', name: 'Other', total: 15.0, count: 2, pct: 0.2881844380403458, color: '#9ca3af', ids: ['t11', 't12'], merchant: false, samples: []),
    ],
  ),
  (
    name: 'edit distance and transposition',
    txns: [('Laundry', 200.0), ('Laundary', 180.0), ('luandry', 90.0), ('Maid', 3000.0), ('Mald', 3000.0), ('maids', 100.0), ('Rent', 15000.0), ('Tent', 900.0), ('salon', 400.0), ('saloon', 450.0)],
    capped: [
      (key: 't:rent', name: 'Rent', total: 15900.0, count: 2, pct: 68.18181818181817, color: '#6366f1', ids: ['t7', 't8'], merchant: false, samples: ['Rent', 'Tent']),
      (key: 't:maid', name: 'Maid', total: 6100.0, count: 3, pct: 26.157804459691253, color: '#10b981', ids: ['t4', 't6', 't5'], merchant: false, samples: ['Maid', 'maids', 'Mald']),
      (key: 't:saloon', name: 'Saloon', total: 850.0, count: 2, pct: 3.6449399656946824, color: '#f59e0b', ids: ['t10', 't9'], merchant: false, samples: ['saloon', 'salon']),
      (key: 't:laundry', name: 'Laundry', total: 470.0, count: 3, pct: 2.0154373927958833, color: '#ef4444', ids: ['t1', 't2', 't3'], merchant: false, samples: ['Laundry', 'Laundary', 'luandry']),
    ],
    full: [
      (key: 't:rent', name: 'Rent', total: 15900.0, count: 2, pct: 68.18181818181817, color: '#6366f1', ids: ['t7', 't8'], merchant: false, samples: ['Rent', 'Tent']),
      (key: 't:maid', name: 'Maid', total: 6100.0, count: 3, pct: 26.157804459691253, color: '#10b981', ids: ['t4', 't6', 't5'], merchant: false, samples: ['Maid', 'maids', 'Mald']),
      (key: 't:saloon', name: 'Saloon', total: 850.0, count: 2, pct: 3.6449399656946824, color: '#f59e0b', ids: ['t10', 't9'], merchant: false, samples: ['saloon', 'salon']),
      (key: 't:laundry', name: 'Laundry', total: 470.0, count: 3, pct: 2.0154373927958833, color: '#ef4444', ids: ['t1', 't2', 't3'], merchant: false, samples: ['Laundry', 'Laundary', 'luandry']),
    ],
    recapped: [
      (key: 't:rent', name: 'Rent', total: 15900.0, count: 2, pct: 68.18181818181817, color: '#6366f1', ids: ['t7', 't8'], merchant: false, samples: ['Rent', 'Tent']),
      (key: 't:maid', name: 'Maid', total: 6100.0, count: 3, pct: 26.157804459691253, color: '#10b981', ids: ['t4', 't6', 't5'], merchant: false, samples: ['Maid', 'maids', 'Mald']),
      (key: 't:saloon', name: 'Saloon', total: 850.0, count: 2, pct: 3.6449399656946824, color: '#f59e0b', ids: ['t10', 't9'], merchant: false, samples: ['saloon', 'salon']),
      (key: 't:laundry', name: 'Laundry', total: 470.0, count: 3, pct: 2.0154373927958833, color: '#ef4444', ids: ['t1', 't2', 't3'], merchant: false, samples: ['Laundry', 'Laundary', 'luandry']),
    ],
  ),
  (
    name: 'phonetic merges',
    txns: [('kirana', 500.0), ('kiraana', 300.0), ('krana', 120.0), ('Rider tip', 50.0), ('rydr', 20.0), ('doodh', 60.0), ('dudh', 64.0), ('dhobi', 150.0), ('dobi', 140.0)],
    capped: [
      (key: 't:kirana', name: 'Kirana', total: 920.0, count: 3, pct: 65.52706552706553, color: '#6366f1', ids: ['t1', 't2', 't3'], merchant: false, samples: ['kirana', 'kiraana', 'krana']),
      (key: 't:dhobi', name: 'Dhobi', total: 290.0, count: 2, pct: 20.655270655270655, color: '#10b981', ids: ['t8', 't9'], merchant: false, samples: ['dhobi', 'dobi']),
      (key: 't:rider', name: 'Rider', total: 70.0, count: 2, pct: 4.985754985754986, color: '#f59e0b', ids: ['t4', 't5'], merchant: false, samples: ['Rider tip', 'rydr']),
      (key: 't:dudh', name: 'dudh', total: 64.0, count: 1, pct: 4.5584045584045585, color: '#ef4444', ids: ['t7'], merchant: false, samples: ['dudh']),
      (key: 't:doodh', name: 'doodh', total: 60.0, count: 1, pct: 4.273504273504273, color: '#8b5cf6', ids: ['t6'], merchant: false, samples: ['doodh']),
    ],
    full: [
      (key: 't:kirana', name: 'Kirana', total: 920.0, count: 3, pct: 65.52706552706553, color: '#6366f1', ids: ['t1', 't2', 't3'], merchant: false, samples: ['kirana', 'kiraana', 'krana']),
      (key: 't:dhobi', name: 'Dhobi', total: 290.0, count: 2, pct: 20.655270655270655, color: '#10b981', ids: ['t8', 't9'], merchant: false, samples: ['dhobi', 'dobi']),
      (key: 't:rider', name: 'Rider', total: 70.0, count: 2, pct: 4.985754985754986, color: '#f59e0b', ids: ['t4', 't5'], merchant: false, samples: ['Rider tip', 'rydr']),
      (key: 't:dudh', name: 'dudh', total: 64.0, count: 1, pct: 4.5584045584045585, color: '#ef4444', ids: ['t7'], merchant: false, samples: ['dudh']),
      (key: 't:doodh', name: 'doodh', total: 60.0, count: 1, pct: 4.273504273504273, color: '#8b5cf6', ids: ['t6'], merchant: false, samples: ['doodh']),
    ],
    recapped: [
      (key: 't:kirana', name: 'Kirana', total: 920.0, count: 3, pct: 65.52706552706553, color: '#6366f1', ids: ['t1', 't2', 't3'], merchant: false, samples: ['kirana', 'kiraana', 'krana']),
      (key: 't:dhobi', name: 'Dhobi', total: 290.0, count: 2, pct: 20.655270655270655, color: '#10b981', ids: ['t8', 't9'], merchant: false, samples: ['dhobi', 'dobi']),
      (key: 't:rider', name: 'Rider', total: 70.0, count: 2, pct: 4.985754985754986, color: '#f59e0b', ids: ['t4', 't5'], merchant: false, samples: ['Rider tip', 'rydr']),
      (key: 't:dudh', name: 'dudh', total: 64.0, count: 1, pct: 4.5584045584045585, color: '#ef4444', ids: ['t7'], merchant: false, samples: ['dudh']),
      (key: 't:doodh', name: 'doodh', total: 60.0, count: 1, pct: 4.273504273504273, color: '#8b5cf6', ids: ['t6'], merchant: false, samples: ['doodh']),
    ],
  ),
  (
    name: 'prefix merges',
    txns: [('medical', 800.0), ('medic', 100.0), ('medicine', 350.0), ('medicines', 90.0), ('park', 40.0), ('parking', 60.0), ('parking fee', 30.0), ('par', 10.0)],
    capped: [
      (key: 't:medical', name: 'Medical', total: 900.0, count: 2, pct: 60.810810810810814, color: '#6366f1', ids: ['t1', 't2'], merchant: false, samples: ['medical', 'medic']),
      (key: 't:medicine', name: 'Medicine', total: 440.0, count: 2, pct: 29.72972972972973, color: '#10b981', ids: ['t3', 't4'], merchant: false, samples: ['medicine', 'medicines']),
      (key: 't:parking', name: 'Parking', total: 130.0, count: 3, pct: 8.783783783783784, color: '#f59e0b', ids: ['t6', 't7', 't5'], merchant: false, samples: ['parking', 'parking fee', 'park']),
      (key: 't:par', name: 'par', total: 10.0, count: 1, pct: 0.6756756756756757, color: '#ef4444', ids: ['t8'], merchant: false, samples: ['par']),
    ],
    full: [
      (key: 't:medical', name: 'Medical', total: 900.0, count: 2, pct: 60.810810810810814, color: '#6366f1', ids: ['t1', 't2'], merchant: false, samples: ['medical', 'medic']),
      (key: 't:medicine', name: 'Medicine', total: 440.0, count: 2, pct: 29.72972972972973, color: '#10b981', ids: ['t3', 't4'], merchant: false, samples: ['medicine', 'medicines']),
      (key: 't:parking', name: 'Parking', total: 130.0, count: 3, pct: 8.783783783783784, color: '#f59e0b', ids: ['t6', 't7', 't5'], merchant: false, samples: ['parking', 'parking fee', 'park']),
      (key: 't:par', name: 'par', total: 10.0, count: 1, pct: 0.6756756756756757, color: '#ef4444', ids: ['t8'], merchant: false, samples: ['par']),
    ],
    recapped: [
      (key: 't:medical', name: 'Medical', total: 900.0, count: 2, pct: 60.810810810810814, color: '#6366f1', ids: ['t1', 't2'], merchant: false, samples: ['medical', 'medic']),
      (key: 't:medicine', name: 'Medicine', total: 440.0, count: 2, pct: 29.72972972972973, color: '#10b981', ids: ['t3', 't4'], merchant: false, samples: ['medicine', 'medicines']),
      (key: 't:parking', name: 'Parking', total: 130.0, count: 3, pct: 8.783783783783784, color: '#f59e0b', ids: ['t6', 't7', 't5'], merchant: false, samples: ['parking', 'parking fee', 'park']),
      (key: 't:par', name: 'par', total: 10.0, count: 1, pct: 0.6756756756756757, color: '#ef4444', ids: ['t8'], merchant: false, samples: ['par']),
    ],
  ),
  (
    name: 'short keys never fuzzy merge',
    txns: [('tea', 10.0), ('tee', 12.0), ('te', 5.0), ('pan', 20.0), ('paan', 25.0), ('pen', 15.0), ('xy', 1.0)],
    capped: [
      (key: 't:paan', name: 'paan', total: 25.0, count: 1, pct: 28.40909090909091, color: '#6366f1', ids: ['t5'], merchant: false, samples: ['paan']),
      (key: 't:pan', name: 'pan', total: 20.0, count: 1, pct: 22.727272727272727, color: '#10b981', ids: ['t4'], merchant: false, samples: ['pan']),
      (key: 't:pen', name: 'pen', total: 15.0, count: 1, pct: 17.045454545454543, color: '#f59e0b', ids: ['t6'], merchant: false, samples: ['pen']),
      (key: 't:tee', name: 'tee', total: 12.0, count: 1, pct: 13.636363636363635, color: '#ef4444', ids: ['t2'], merchant: false, samples: ['tee']),
      (key: 't:tea', name: 'tea', total: 10.0, count: 1, pct: 11.363636363636363, color: '#8b5cf6', ids: ['t1'], merchant: false, samples: ['tea']),
      (key: '__other__', name: 'Other', total: 6.0, count: 2, pct: 6.8181818181818175, color: '#9ca3af', ids: ['t3', 't7'], merchant: false, samples: []),
    ],
    full: [
      (key: 't:paan', name: 'paan', total: 25.0, count: 1, pct: 28.40909090909091, color: '#6366f1', ids: ['t5'], merchant: false, samples: ['paan']),
      (key: 't:pan', name: 'pan', total: 20.0, count: 1, pct: 22.727272727272727, color: '#10b981', ids: ['t4'], merchant: false, samples: ['pan']),
      (key: 't:pen', name: 'pen', total: 15.0, count: 1, pct: 17.045454545454543, color: '#f59e0b', ids: ['t6'], merchant: false, samples: ['pen']),
      (key: 't:tee', name: 'tee', total: 12.0, count: 1, pct: 13.636363636363635, color: '#ef4444', ids: ['t2'], merchant: false, samples: ['tee']),
      (key: 't:tea', name: 'tea', total: 10.0, count: 1, pct: 11.363636363636363, color: '#8b5cf6', ids: ['t1'], merchant: false, samples: ['tea']),
      (key: 't:te', name: 'te', total: 5.0, count: 1, pct: 5.681818181818182, color: '#06b6d4', ids: ['t3'], merchant: false, samples: ['te']),
      (key: 't:xy', name: 'xy', total: 1.0, count: 1, pct: 1.1363636363636365, color: '#6366f1', ids: ['t7'], merchant: false, samples: ['xy']),
    ],
    recapped: [
      (key: 't:paan', name: 'paan', total: 25.0, count: 1, pct: 28.40909090909091, color: '#6366f1', ids: ['t5'], merchant: false, samples: ['paan']),
      (key: 't:pan', name: 'pan', total: 20.0, count: 1, pct: 22.727272727272727, color: '#10b981', ids: ['t4'], merchant: false, samples: ['pan']),
      (key: 't:pen', name: 'pen', total: 15.0, count: 1, pct: 17.045454545454543, color: '#f59e0b', ids: ['t6'], merchant: false, samples: ['pen']),
      (key: 't:tee', name: 'tee', total: 12.0, count: 1, pct: 13.636363636363635, color: '#ef4444', ids: ['t2'], merchant: false, samples: ['tee']),
      (key: 't:tea', name: 'tea', total: 10.0, count: 1, pct: 11.363636363636363, color: '#8b5cf6', ids: ['t1'], merchant: false, samples: ['tea']),
      (key: '__other__', name: 'Other', total: 6.0, count: 2, pct: 6.8181818181818175, color: '#9ca3af', ids: ['t3', 't7'], merchant: false, samples: []),
    ],
  ),
  (
    name: 'more than six buckets rolls into Other',
    txns: [('Haircut', 300.0), ('Books', 850.0), ('Gym', 1500.0), ('Toys', 420.0), ('Flowers', 150.0), ('Gift', 999.0), ('Stationery', 75.0), ('Tailor', 600.0), ('Cobbler', 50.0), ('Books', 150.0)],
    capped: [
      (key: 't:gym', name: 'Gym', total: 1500.0, count: 1, pct: 29.44640753828033, color: '#6366f1', ids: ['t3'], merchant: false, samples: ['Gym']),
      (key: 't:book', name: 'Books', total: 1000.0, count: 2, pct: 19.63093835885355, color: '#10b981', ids: ['t2', 't10'], merchant: false, samples: ['Books']),
      (key: 't:gift', name: 'Gift', total: 999.0, count: 1, pct: 19.6113074204947, color: '#f59e0b', ids: ['t6'], merchant: false, samples: ['Gift']),
      (key: 't:tailor', name: 'Tailor', total: 600.0, count: 1, pct: 11.778563015312132, color: '#ef4444', ids: ['t8'], merchant: false, samples: ['Tailor']),
      (key: 't:toy', name: 'Toys', total: 420.0, count: 1, pct: 8.244994110718492, color: '#8b5cf6', ids: ['t4'], merchant: false, samples: ['Toys']),
      (key: '__other__', name: 'Other', total: 575.0, count: 4, pct: 11.287789556340794, color: '#9ca3af', ids: ['t1', 't5', 't7', 't9'], merchant: false, samples: []),
    ],
    full: [
      (key: 't:gym', name: 'Gym', total: 1500.0, count: 1, pct: 29.44640753828033, color: '#6366f1', ids: ['t3'], merchant: false, samples: ['Gym']),
      (key: 't:book', name: 'Books', total: 1000.0, count: 2, pct: 19.63093835885355, color: '#10b981', ids: ['t2', 't10'], merchant: false, samples: ['Books']),
      (key: 't:gift', name: 'Gift', total: 999.0, count: 1, pct: 19.6113074204947, color: '#f59e0b', ids: ['t6'], merchant: false, samples: ['Gift']),
      (key: 't:tailor', name: 'Tailor', total: 600.0, count: 1, pct: 11.778563015312132, color: '#ef4444', ids: ['t8'], merchant: false, samples: ['Tailor']),
      (key: 't:toy', name: 'Toys', total: 420.0, count: 1, pct: 8.244994110718492, color: '#8b5cf6', ids: ['t4'], merchant: false, samples: ['Toys']),
      (key: 't:haircut', name: 'Haircut', total: 300.0, count: 1, pct: 5.889281507656066, color: '#06b6d4', ids: ['t1'], merchant: false, samples: ['Haircut']),
      (key: 't:flower', name: 'Flowers', total: 150.0, count: 1, pct: 2.944640753828033, color: '#6366f1', ids: ['t5'], merchant: false, samples: ['Flowers']),
      (key: 't:stationery', name: 'Stationery', total: 75.0, count: 1, pct: 1.4723203769140165, color: '#10b981', ids: ['t7'], merchant: false, samples: ['Stationery']),
      (key: 't:cobbler', name: 'Cobbler', total: 50.0, count: 1, pct: 0.9815469179426776, color: '#f59e0b', ids: ['t9'], merchant: false, samples: ['Cobbler']),
    ],
    recapped: [
      (key: 't:gym', name: 'Gym', total: 1500.0, count: 1, pct: 29.44640753828033, color: '#6366f1', ids: ['t3'], merchant: false, samples: ['Gym']),
      (key: 't:book', name: 'Books', total: 1000.0, count: 2, pct: 19.63093835885355, color: '#10b981', ids: ['t2', 't10'], merchant: false, samples: ['Books']),
      (key: 't:gift', name: 'Gift', total: 999.0, count: 1, pct: 19.6113074204947, color: '#f59e0b', ids: ['t6'], merchant: false, samples: ['Gift']),
      (key: 't:tailor', name: 'Tailor', total: 600.0, count: 1, pct: 11.778563015312132, color: '#ef4444', ids: ['t8'], merchant: false, samples: ['Tailor']),
      (key: 't:toy', name: 'Toys', total: 420.0, count: 1, pct: 8.244994110718492, color: '#8b5cf6', ids: ['t4'], merchant: false, samples: ['Toys']),
      (key: '__other__', name: 'Other', total: 575.0, count: 4, pct: 11.287789556340794, color: '#9ca3af', ids: ['t1', 't5', 't7', 't9'], merchant: false, samples: []),
    ],
  ),
  (
    name: 'exactly six buckets',
    txns: [('Haircut', 300.0), ('Books', 850.0), ('Gym', 1500.0), ('Toys', 420.0), ('Flowers', 150.0), ('Gift', 999.0)],
    capped: [
      (key: 't:gym', name: 'Gym', total: 1500.0, count: 1, pct: 35.5534486845224, color: '#6366f1', ids: ['t3'], merchant: false, samples: ['Gym']),
      (key: 't:gift', name: 'Gift', total: 999.0, count: 1, pct: 23.67859682389192, color: '#10b981', ids: ['t6'], merchant: false, samples: ['Gift']),
      (key: 't:book', name: 'Books', total: 850.0, count: 1, pct: 20.146954254562694, color: '#f59e0b', ids: ['t2'], merchant: false, samples: ['Books']),
      (key: 't:toy', name: 'Toys', total: 420.0, count: 1, pct: 9.954965631666271, color: '#ef4444', ids: ['t4'], merchant: false, samples: ['Toys']),
      (key: 't:haircut', name: 'Haircut', total: 300.0, count: 1, pct: 7.1106897369044795, color: '#8b5cf6', ids: ['t1'], merchant: false, samples: ['Haircut']),
      (key: 't:flower', name: 'Flowers', total: 150.0, count: 1, pct: 3.5553448684522397, color: '#06b6d4', ids: ['t5'], merchant: false, samples: ['Flowers']),
    ],
    full: [
      (key: 't:gym', name: 'Gym', total: 1500.0, count: 1, pct: 35.5534486845224, color: '#6366f1', ids: ['t3'], merchant: false, samples: ['Gym']),
      (key: 't:gift', name: 'Gift', total: 999.0, count: 1, pct: 23.67859682389192, color: '#10b981', ids: ['t6'], merchant: false, samples: ['Gift']),
      (key: 't:book', name: 'Books', total: 850.0, count: 1, pct: 20.146954254562694, color: '#f59e0b', ids: ['t2'], merchant: false, samples: ['Books']),
      (key: 't:toy', name: 'Toys', total: 420.0, count: 1, pct: 9.954965631666271, color: '#ef4444', ids: ['t4'], merchant: false, samples: ['Toys']),
      (key: 't:haircut', name: 'Haircut', total: 300.0, count: 1, pct: 7.1106897369044795, color: '#8b5cf6', ids: ['t1'], merchant: false, samples: ['Haircut']),
      (key: 't:flower', name: 'Flowers', total: 150.0, count: 1, pct: 3.5553448684522397, color: '#06b6d4', ids: ['t5'], merchant: false, samples: ['Flowers']),
    ],
    recapped: [
      (key: 't:gym', name: 'Gym', total: 1500.0, count: 1, pct: 35.5534486845224, color: '#6366f1', ids: ['t3'], merchant: false, samples: ['Gym']),
      (key: 't:gift', name: 'Gift', total: 999.0, count: 1, pct: 23.67859682389192, color: '#10b981', ids: ['t6'], merchant: false, samples: ['Gift']),
      (key: 't:book', name: 'Books', total: 850.0, count: 1, pct: 20.146954254562694, color: '#f59e0b', ids: ['t2'], merchant: false, samples: ['Books']),
      (key: 't:toy', name: 'Toys', total: 420.0, count: 1, pct: 9.954965631666271, color: '#ef4444', ids: ['t4'], merchant: false, samples: ['Toys']),
      (key: 't:haircut', name: 'Haircut', total: 300.0, count: 1, pct: 7.1106897369044795, color: '#8b5cf6', ids: ['t1'], merchant: false, samples: ['Haircut']),
      (key: 't:flower', name: 'Flowers', total: 150.0, count: 1, pct: 3.5553448684522397, color: '#06b6d4', ids: ['t5'], merchant: false, samples: ['Flowers']),
    ],
  ),
  (
    name: 'exactly seven buckets',
    txns: [('Haircut', 300.0), ('Books', 850.0), ('Gym', 1500.0), ('Toys', 420.0), ('Flowers', 150.0), ('Gift', 999.0), ('Tailor', 600.0)],
    capped: [
      (key: 't:gym', name: 'Gym', total: 1500.0, count: 1, pct: 31.12678979041295, color: '#6366f1', ids: ['t3'], merchant: false, samples: ['Gym']),
      (key: 't:gift', name: 'Gift', total: 999.0, count: 1, pct: 20.73044200041502, color: '#10b981', ids: ['t6'], merchant: false, samples: ['Gift']),
      (key: 't:book', name: 'Books', total: 850.0, count: 1, pct: 17.638514214567337, color: '#f59e0b', ids: ['t2'], merchant: false, samples: ['Books']),
      (key: 't:tailor', name: 'Tailor', total: 600.0, count: 1, pct: 12.45071591616518, color: '#ef4444', ids: ['t7'], merchant: false, samples: ['Tailor']),
      (key: 't:toy', name: 'Toys', total: 420.0, count: 1, pct: 8.715501141315626, color: '#8b5cf6', ids: ['t4'], merchant: false, samples: ['Toys']),
      (key: '__other__', name: 'Other', total: 450.0, count: 2, pct: 9.338036937123885, color: '#9ca3af', ids: ['t1', 't5'], merchant: false, samples: []),
    ],
    full: [
      (key: 't:gym', name: 'Gym', total: 1500.0, count: 1, pct: 31.12678979041295, color: '#6366f1', ids: ['t3'], merchant: false, samples: ['Gym']),
      (key: 't:gift', name: 'Gift', total: 999.0, count: 1, pct: 20.73044200041502, color: '#10b981', ids: ['t6'], merchant: false, samples: ['Gift']),
      (key: 't:book', name: 'Books', total: 850.0, count: 1, pct: 17.638514214567337, color: '#f59e0b', ids: ['t2'], merchant: false, samples: ['Books']),
      (key: 't:tailor', name: 'Tailor', total: 600.0, count: 1, pct: 12.45071591616518, color: '#ef4444', ids: ['t7'], merchant: false, samples: ['Tailor']),
      (key: 't:toy', name: 'Toys', total: 420.0, count: 1, pct: 8.715501141315626, color: '#8b5cf6', ids: ['t4'], merchant: false, samples: ['Toys']),
      (key: 't:haircut', name: 'Haircut', total: 300.0, count: 1, pct: 6.22535795808259, color: '#06b6d4', ids: ['t1'], merchant: false, samples: ['Haircut']),
      (key: 't:flower', name: 'Flowers', total: 150.0, count: 1, pct: 3.112678979041295, color: '#6366f1', ids: ['t5'], merchant: false, samples: ['Flowers']),
    ],
    recapped: [
      (key: 't:gym', name: 'Gym', total: 1500.0, count: 1, pct: 31.12678979041295, color: '#6366f1', ids: ['t3'], merchant: false, samples: ['Gym']),
      (key: 't:gift', name: 'Gift', total: 999.0, count: 1, pct: 20.73044200041502, color: '#10b981', ids: ['t6'], merchant: false, samples: ['Gift']),
      (key: 't:book', name: 'Books', total: 850.0, count: 1, pct: 17.638514214567337, color: '#f59e0b', ids: ['t2'], merchant: false, samples: ['Books']),
      (key: 't:tailor', name: 'Tailor', total: 600.0, count: 1, pct: 12.45071591616518, color: '#ef4444', ids: ['t7'], merchant: false, samples: ['Tailor']),
      (key: 't:toy', name: 'Toys', total: 420.0, count: 1, pct: 8.715501141315626, color: '#8b5cf6', ids: ['t4'], merchant: false, samples: ['Toys']),
      (key: '__other__', name: 'Other', total: 450.0, count: 2, pct: 9.338036937123885, color: '#9ca3af', ids: ['t1', 't5'], merchant: false, samples: []),
    ],
  ),
  (
    name: 'equal totals keep first-seen order',
    txns: [('Zebra', 100.0), ('Apple', 100.0), ('Mango', 100.0), ('Banana', 100.0), ('Cherry', 100.0), ('Lychee', 100.0), ('Guava', 100.0), ('Papaya', 100.0), ('', 100.0)],
    capped: [
      (key: 't:zebra', name: 'Zebra', total: 100.0, count: 1, pct: 11.11111111111111, color: '#6366f1', ids: ['t1'], merchant: false, samples: ['Zebra']),
      (key: 't:apple', name: 'Apple', total: 100.0, count: 1, pct: 11.11111111111111, color: '#10b981', ids: ['t2'], merchant: false, samples: ['Apple']),
      (key: 't:mango', name: 'Mango', total: 100.0, count: 1, pct: 11.11111111111111, color: '#f59e0b', ids: ['t3'], merchant: false, samples: ['Mango']),
      (key: 't:banana', name: 'Banana', total: 100.0, count: 1, pct: 11.11111111111111, color: '#ef4444', ids: ['t4'], merchant: false, samples: ['Banana']),
      (key: 't:cherry', name: 'Cherry', total: 100.0, count: 1, pct: 11.11111111111111, color: '#8b5cf6', ids: ['t5'], merchant: false, samples: ['Cherry']),
      (key: '__other__', name: 'Other', total: 400.0, count: 4, pct: 44.44444444444444, color: '#9ca3af', ids: ['t6', 't7', 't8', 't9'], merchant: false, samples: []),
    ],
    full: [
      (key: 't:zebra', name: 'Zebra', total: 100.0, count: 1, pct: 11.11111111111111, color: '#6366f1', ids: ['t1'], merchant: false, samples: ['Zebra']),
      (key: 't:apple', name: 'Apple', total: 100.0, count: 1, pct: 11.11111111111111, color: '#10b981', ids: ['t2'], merchant: false, samples: ['Apple']),
      (key: 't:mango', name: 'Mango', total: 100.0, count: 1, pct: 11.11111111111111, color: '#f59e0b', ids: ['t3'], merchant: false, samples: ['Mango']),
      (key: 't:banana', name: 'Banana', total: 100.0, count: 1, pct: 11.11111111111111, color: '#ef4444', ids: ['t4'], merchant: false, samples: ['Banana']),
      (key: 't:cherry', name: 'Cherry', total: 100.0, count: 1, pct: 11.11111111111111, color: '#8b5cf6', ids: ['t5'], merchant: false, samples: ['Cherry']),
      (key: 't:lychee', name: 'Lychee', total: 100.0, count: 1, pct: 11.11111111111111, color: '#06b6d4', ids: ['t6'], merchant: false, samples: ['Lychee']),
      (key: 't:guava', name: 'Guava', total: 100.0, count: 1, pct: 11.11111111111111, color: '#6366f1', ids: ['t7'], merchant: false, samples: ['Guava']),
      (key: 't:papaya', name: 'Papaya', total: 100.0, count: 1, pct: 11.11111111111111, color: '#10b981', ids: ['t8'], merchant: false, samples: ['Papaya']),
      (key: '__no_note__', name: 'No description', total: 100.0, count: 1, pct: 11.11111111111111, color: '#f59e0b', ids: ['t9'], merchant: false, samples: []),
    ],
    recapped: [
      (key: 't:zebra', name: 'Zebra', total: 100.0, count: 1, pct: 11.11111111111111, color: '#6366f1', ids: ['t1'], merchant: false, samples: ['Zebra']),
      (key: 't:apple', name: 'Apple', total: 100.0, count: 1, pct: 11.11111111111111, color: '#10b981', ids: ['t2'], merchant: false, samples: ['Apple']),
      (key: 't:mango', name: 'Mango', total: 100.0, count: 1, pct: 11.11111111111111, color: '#f59e0b', ids: ['t3'], merchant: false, samples: ['Mango']),
      (key: 't:banana', name: 'Banana', total: 100.0, count: 1, pct: 11.11111111111111, color: '#ef4444', ids: ['t4'], merchant: false, samples: ['Banana']),
      (key: 't:cherry', name: 'Cherry', total: 100.0, count: 1, pct: 11.11111111111111, color: '#8b5cf6', ids: ['t5'], merchant: false, samples: ['Cherry']),
      (key: '__other__', name: 'Other', total: 400.0, count: 4, pct: 44.44444444444444, color: '#9ca3af', ids: ['t6', 't7', 't8', 't9'], merchant: false, samples: []),
    ],
  ),
  (
    name: 'diacritics',
    txns: [('Caf\u{e9} Coffee Day', 250.0), ('cafe coffee day', 180.0), ('CAF\u{c9}', 90.0), ('Cr\u{e8}me br\u{fb}l\u{e9}e', 320.0), ('creme brulee', 300.0), ('\u{130}stanbul kebab', 410.0), ('istanbul kebab', 200.0), ('\u{212a}elvin', 10.0), ('kelvin', 12.0), ('\u{c5}ngstr\u{f6}m', 5.0), ('na\u{ef}ve jalape\u{f1}o', 45.0), ('Stra\u{df}e', 70.0), ('sm\u{f8}rrebr\u{f8}d', 65.0), ('cafe\u{301}', 33.0), ('Ph\u{1edf}', 140.0), ('pho', 120.0), ('\u{141}\u{f3}d\u{17a}', 8.0)],
    capped: [
      (key: 'p:creme brulee', name: 'Creme Brulee', total: 620.0, count: 2, pct: 27.457927369353406, color: '#6366f1', ids: ['t4', 't5'], merchant: false, samples: ['Cr\u{e8}me br\u{fb}l\u{e9}e', 'creme brulee']),
      (key: 'p:istanbul kebab', name: 'Istanbul Kebab', total: 610.0, count: 2, pct: 27.015057573073513, color: '#10b981', ids: ['t6', 't7'], merchant: false, samples: ['\u{130}stanbul kebab', 'istanbul kebab']),
      (key: 'p:coffee day', name: 'Coffee Day', total: 430.0, count: 2, pct: 19.04340124003543, color: '#f59e0b', ids: ['t1', 't2'], merchant: false, samples: ['Caf\u{e9} Coffee Day', 'cafe coffee day']),
      (key: 't:pho', name: 'Pho', total: 260.0, count: 2, pct: 11.514614703277235, color: '#ef4444', ids: ['t15', 't16'], merchant: false, samples: ['Ph\u{1edf}', 'pho']),
      (key: 't:cafe', name: 'Cafe', total: 123.0, count: 2, pct: 5.447298494242692, color: '#8b5cf6', ids: ['t3', 't14'], merchant: false, samples: ['CAF\u{c9}', 'cafe\u{301}']),
      (key: '__other__', name: 'Other', total: 215.0, count: 7, pct: 9.521700620017715, color: '#9ca3af', ids: ['t12', 't13', 't11', 't8', 't9', 't17', 't10'], merchant: false, samples: []),
    ],
    full: [
      (key: 'p:creme brulee', name: 'Creme Brulee', total: 620.0, count: 2, pct: 27.457927369353406, color: '#6366f1', ids: ['t4', 't5'], merchant: false, samples: ['Cr\u{e8}me br\u{fb}l\u{e9}e', 'creme brulee']),
      (key: 'p:istanbul kebab', name: 'Istanbul Kebab', total: 610.0, count: 2, pct: 27.015057573073513, color: '#10b981', ids: ['t6', 't7'], merchant: false, samples: ['\u{130}stanbul kebab', 'istanbul kebab']),
      (key: 'p:coffee day', name: 'Coffee Day', total: 430.0, count: 2, pct: 19.04340124003543, color: '#f59e0b', ids: ['t1', 't2'], merchant: false, samples: ['Caf\u{e9} Coffee Day', 'cafe coffee day']),
      (key: 't:pho', name: 'Pho', total: 260.0, count: 2, pct: 11.514614703277235, color: '#ef4444', ids: ['t15', 't16'], merchant: false, samples: ['Ph\u{1edf}', 'pho']),
      (key: 't:cafe', name: 'Cafe', total: 123.0, count: 2, pct: 5.447298494242692, color: '#8b5cf6', ids: ['t3', 't14'], merchant: false, samples: ['CAF\u{c9}', 'cafe\u{301}']),
      (key: 't:stra', name: 'Stra\u{df}e', total: 70.0, count: 1, pct: 3.100088573959256, color: '#06b6d4', ids: ['t12'], merchant: false, samples: ['Stra\u{df}e']),
      (key: 't:rrebr', name: 'sm\u{f8}rrebr\u{f8}d', total: 65.0, count: 1, pct: 2.878653675819309, color: '#6366f1', ids: ['t13'], merchant: false, samples: ['sm\u{f8}rrebr\u{f8}d']),
      (key: 't:jalapeno', name: 'na\u{ef}ve jalape\u{f1}o', total: 45.0, count: 1, pct: 1.9929140832595216, color: '#10b981', ids: ['t11'], merchant: false, samples: ['na\u{ef}ve jalape\u{f1}o']),
      (key: 't:kelvin', name: 'Kelvin', total: 22.0, count: 2, pct: 0.9743135518157661, color: '#f59e0b', ids: ['t8', 't9'], merchant: false, samples: ['\u{212a}elvin', 'kelvin']),
      (key: 't:odz', name: '\u{141}\u{f3}d\u{17a}', total: 8.0, count: 1, pct: 0.354295837023915, color: '#ef4444', ids: ['t17'], merchant: false, samples: ['\u{141}\u{f3}d\u{17a}']),
      (key: 't:angstrom', name: '\u{c5}ngstr\u{f6}m', total: 5.0, count: 1, pct: 0.22143489813994688, color: '#8b5cf6', ids: ['t10'], merchant: false, samples: ['\u{c5}ngstr\u{f6}m']),
    ],
    recapped: [
      (key: 'p:creme brulee', name: 'Creme Brulee', total: 620.0, count: 2, pct: 27.457927369353406, color: '#6366f1', ids: ['t4', 't5'], merchant: false, samples: ['Cr\u{e8}me br\u{fb}l\u{e9}e', 'creme brulee']),
      (key: 'p:istanbul kebab', name: 'Istanbul Kebab', total: 610.0, count: 2, pct: 27.015057573073513, color: '#10b981', ids: ['t6', 't7'], merchant: false, samples: ['\u{130}stanbul kebab', 'istanbul kebab']),
      (key: 'p:coffee day', name: 'Coffee Day', total: 430.0, count: 2, pct: 19.04340124003543, color: '#f59e0b', ids: ['t1', 't2'], merchant: false, samples: ['Caf\u{e9} Coffee Day', 'cafe coffee day']),
      (key: 't:pho', name: 'Pho', total: 260.0, count: 2, pct: 11.514614703277235, color: '#ef4444', ids: ['t15', 't16'], merchant: false, samples: ['Ph\u{1edf}', 'pho']),
      (key: 't:cafe', name: 'Cafe', total: 123.0, count: 2, pct: 5.447298494242692, color: '#8b5cf6', ids: ['t3', 't14'], merchant: false, samples: ['CAF\u{c9}', 'cafe\u{301}']),
      (key: '__other__', name: 'Other', total: 215.0, count: 7, pct: 9.521700620017715, color: '#9ca3af', ids: ['t12', 't13', 't11', 't8', 't9', 't17', 't10'], merchant: false, samples: []),
    ],
  ),
  (
    name: 'emoji and punctuation',
    txns: [('\u{1f355} Pizza', 499.0), ('pizza \u{1f355}\u{1f355}', 350.0), ('\u{1f355}', 100.0), ('Pizza!!!', 250.0), ('\u{2615}\u{fe0f} coffee', 120.0), ('Coffee\u{2615}', 80.0), ('coffee/snacks', 60.0), ('(snacks)', 40.0), ('snacks & coffee', 55.0)],
    capped: [
      (key: 't:pizza', name: 'Pizza', total: 1099.0, count: 3, pct: 70.72072072072072, color: '#6366f1', ids: ['t1', 't2', 't4'], merchant: false, samples: ['\u{1f355} Pizza', 'pizza \u{1f355}\u{1f355}', 'Pizza!!!']),
      (key: 't:coffee', name: 'Coffee', total: 315.0, count: 4, pct: 20.27027027027027, color: '#10b981', ids: ['t5', 't6', 't7', 't9'], merchant: false, samples: ['\u{2615}\u{fe0f} coffee', 'Coffee\u{2615}', 'coffee/snacks']),
      (key: '__no_note__', name: 'No description', total: 100.0, count: 1, pct: 6.435006435006435, color: '#f59e0b', ids: ['t3'], merchant: false, samples: ['\u{1f355}']),
      (key: 't:snack', name: '(snacks)', total: 40.0, count: 1, pct: 2.574002574002574, color: '#ef4444', ids: ['t8'], merchant: false, samples: ['(snacks)']),
    ],
    full: [
      (key: 't:pizza', name: 'Pizza', total: 1099.0, count: 3, pct: 70.72072072072072, color: '#6366f1', ids: ['t1', 't2', 't4'], merchant: false, samples: ['\u{1f355} Pizza', 'pizza \u{1f355}\u{1f355}', 'Pizza!!!']),
      (key: 't:coffee', name: 'Coffee', total: 315.0, count: 4, pct: 20.27027027027027, color: '#10b981', ids: ['t5', 't6', 't7', 't9'], merchant: false, samples: ['\u{2615}\u{fe0f} coffee', 'Coffee\u{2615}', 'coffee/snacks']),
      (key: '__no_note__', name: 'No description', total: 100.0, count: 1, pct: 6.435006435006435, color: '#f59e0b', ids: ['t3'], merchant: false, samples: ['\u{1f355}']),
      (key: 't:snack', name: '(snacks)', total: 40.0, count: 1, pct: 2.574002574002574, color: '#ef4444', ids: ['t8'], merchant: false, samples: ['(snacks)']),
    ],
    recapped: [
      (key: 't:pizza', name: 'Pizza', total: 1099.0, count: 3, pct: 70.72072072072072, color: '#6366f1', ids: ['t1', 't2', 't4'], merchant: false, samples: ['\u{1f355} Pizza', 'pizza \u{1f355}\u{1f355}', 'Pizza!!!']),
      (key: 't:coffee', name: 'Coffee', total: 315.0, count: 4, pct: 20.27027027027027, color: '#10b981', ids: ['t5', 't6', 't7', 't9'], merchant: false, samples: ['\u{2615}\u{fe0f} coffee', 'Coffee\u{2615}', 'coffee/snacks']),
      (key: '__no_note__', name: 'No description', total: 100.0, count: 1, pct: 6.435006435006435, color: '#f59e0b', ids: ['t3'], merchant: false, samples: ['\u{1f355}']),
      (key: 't:snack', name: '(snacks)', total: 40.0, count: 1, pct: 2.574002574002574, color: '#ef4444', ids: ['t8'], merchant: false, samples: ['(snacks)']),
    ],
  ),
  (
    name: 'numbers in notes',
    txns: [('500', 500.0), ('12 34', 46.0), ('room 302', 8000.0), ('Room 303', 8500.0), ('2 kg rice', 140.0), ('rice 5kg', 350.0), ('Rice 10 kg', 700.0), ('5kg', 10.0), ('24x7 store', 99.0), ('3', 3.0)],
    capped: [
      (key: 't:room', name: 'Room', total: 16500.0, count: 2, pct: 89.92805755395683, color: '#6366f1', ids: ['t3', 't4'], merchant: false, samples: ['room 302', 'Room 303']),
      (key: 't:rice', name: 'Rice', total: 1190.0, count: 3, pct: 6.485720514497493, color: '#10b981', ids: ['t5', 't6', 't7'], merchant: false, samples: ['2 kg rice', 'rice 5kg', 'Rice 10 kg']),
      (key: 'r:500', name: '500', total: 500.0, count: 1, pct: 2.725092653150207, color: '#f59e0b', ids: ['t1'], merchant: false, samples: ['500']),
      (key: 't:store', name: '24x7 store', total: 99.0, count: 1, pct: 0.539568345323741, color: '#ef4444', ids: ['t9'], merchant: false, samples: ['24x7 store']),
      (key: 'r:12 34', name: '12 34', total: 46.0, count: 1, pct: 0.25070852408981903, color: '#8b5cf6', ids: ['t2'], merchant: false, samples: ['12 34']),
      (key: '__other__', name: 'Other', total: 13.0, count: 2, pct: 0.07085240898190538, color: '#9ca3af', ids: ['t8', 't10'], merchant: false, samples: []),
    ],
    full: [
      (key: 't:room', name: 'Room', total: 16500.0, count: 2, pct: 89.92805755395683, color: '#6366f1', ids: ['t3', 't4'], merchant: false, samples: ['room 302', 'Room 303']),
      (key: 't:rice', name: 'Rice', total: 1190.0, count: 3, pct: 6.485720514497493, color: '#10b981', ids: ['t5', 't6', 't7'], merchant: false, samples: ['2 kg rice', 'rice 5kg', 'Rice 10 kg']),
      (key: 'r:500', name: '500', total: 500.0, count: 1, pct: 2.725092653150207, color: '#f59e0b', ids: ['t1'], merchant: false, samples: ['500']),
      (key: 't:store', name: '24x7 store', total: 99.0, count: 1, pct: 0.539568345323741, color: '#ef4444', ids: ['t9'], merchant: false, samples: ['24x7 store']),
      (key: 'r:12 34', name: '12 34', total: 46.0, count: 1, pct: 0.25070852408981903, color: '#8b5cf6', ids: ['t2'], merchant: false, samples: ['12 34']),
      (key: 't:5kg', name: '5kg', total: 10.0, count: 1, pct: 0.05450185306300414, color: '#06b6d4', ids: ['t8'], merchant: false, samples: ['5kg']),
      (key: 'r:3', name: '3', total: 3.0, count: 1, pct: 0.016350555918901243, color: '#6366f1', ids: ['t10'], merchant: false, samples: ['3']),
    ],
    recapped: [
      (key: 't:room', name: 'Room', total: 16500.0, count: 2, pct: 89.92805755395683, color: '#6366f1', ids: ['t3', 't4'], merchant: false, samples: ['room 302', 'Room 303']),
      (key: 't:rice', name: 'Rice', total: 1190.0, count: 3, pct: 6.485720514497493, color: '#10b981', ids: ['t5', 't6', 't7'], merchant: false, samples: ['2 kg rice', 'rice 5kg', 'Rice 10 kg']),
      (key: 'r:500', name: '500', total: 500.0, count: 1, pct: 2.725092653150207, color: '#f59e0b', ids: ['t1'], merchant: false, samples: ['500']),
      (key: 't:store', name: '24x7 store', total: 99.0, count: 1, pct: 0.539568345323741, color: '#ef4444', ids: ['t9'], merchant: false, samples: ['24x7 store']),
      (key: 'r:12 34', name: '12 34', total: 46.0, count: 1, pct: 0.25070852408981903, color: '#8b5cf6', ids: ['t2'], merchant: false, samples: ['12 34']),
      (key: '__other__', name: 'Other', total: 13.0, count: 2, pct: 0.07085240898190538, color: '#9ca3af', ids: ['t8', 't10'], merchant: false, samples: []),
    ],
  ),
  (
    name: 'stop words only',
    txns: [('to', 10.0), ('for the', 20.0), ('a', 30.0), ('at 5 pm', 40.0), ('Rs 500', 500.0), ('rs. 500/-', 500.0), ('To', 15.0), ('my', 5.0), ('x', 1.0)],
    capped: [
      (key: 'r:rs 500', name: 'Rs 500', total: 1000.0, count: 2, pct: 89.20606601248885, color: '#6366f1', ids: ['t5', 't6'], merchant: false, samples: ['Rs 500', 'rs. 500/-']),
      (key: 'r:at 5 pm', name: 'at 5 pm', total: 40.0, count: 1, pct: 3.568242640499554, color: '#10b981', ids: ['t4'], merchant: false, samples: ['at 5 pm']),
      (key: 'r:a', name: 'a', total: 30.0, count: 1, pct: 2.6761819803746656, color: '#f59e0b', ids: ['t3'], merchant: false, samples: ['a']),
      (key: 'r:to', name: 'To', total: 25.0, count: 2, pct: 2.230151650312221, color: '#ef4444', ids: ['t1', 't7'], merchant: false, samples: ['to', 'To']),
      (key: 'r:for the', name: 'for the', total: 20.0, count: 1, pct: 1.784121320249777, color: '#8b5cf6', ids: ['t2'], merchant: false, samples: ['for the']),
      (key: '__other__', name: 'Other', total: 6.0, count: 2, pct: 0.535236396074933, color: '#9ca3af', ids: ['t8', 't9'], merchant: false, samples: []),
    ],
    full: [
      (key: 'r:rs 500', name: 'Rs 500', total: 1000.0, count: 2, pct: 89.20606601248885, color: '#6366f1', ids: ['t5', 't6'], merchant: false, samples: ['Rs 500', 'rs. 500/-']),
      (key: 'r:at 5 pm', name: 'at 5 pm', total: 40.0, count: 1, pct: 3.568242640499554, color: '#10b981', ids: ['t4'], merchant: false, samples: ['at 5 pm']),
      (key: 'r:a', name: 'a', total: 30.0, count: 1, pct: 2.6761819803746656, color: '#f59e0b', ids: ['t3'], merchant: false, samples: ['a']),
      (key: 'r:to', name: 'To', total: 25.0, count: 2, pct: 2.230151650312221, color: '#ef4444', ids: ['t1', 't7'], merchant: false, samples: ['to', 'To']),
      (key: 'r:for the', name: 'for the', total: 20.0, count: 1, pct: 1.784121320249777, color: '#8b5cf6', ids: ['t2'], merchant: false, samples: ['for the']),
      (key: 'r:my', name: 'my', total: 5.0, count: 1, pct: 0.44603033006244425, color: '#06b6d4', ids: ['t8'], merchant: false, samples: ['my']),
      (key: 'r:x', name: 'x', total: 1.0, count: 1, pct: 0.08920606601248886, color: '#6366f1', ids: ['t9'], merchant: false, samples: ['x']),
    ],
    recapped: [
      (key: 'r:rs 500', name: 'Rs 500', total: 1000.0, count: 2, pct: 89.20606601248885, color: '#6366f1', ids: ['t5', 't6'], merchant: false, samples: ['Rs 500', 'rs. 500/-']),
      (key: 'r:at 5 pm', name: 'at 5 pm', total: 40.0, count: 1, pct: 3.568242640499554, color: '#10b981', ids: ['t4'], merchant: false, samples: ['at 5 pm']),
      (key: 'r:a', name: 'a', total: 30.0, count: 1, pct: 2.6761819803746656, color: '#f59e0b', ids: ['t3'], merchant: false, samples: ['a']),
      (key: 'r:to', name: 'To', total: 25.0, count: 2, pct: 2.230151650312221, color: '#ef4444', ids: ['t1', 't7'], merchant: false, samples: ['to', 'To']),
      (key: 'r:for the', name: 'for the', total: 20.0, count: 1, pct: 1.784121320249777, color: '#8b5cf6', ids: ['t2'], merchant: false, samples: ['for the']),
      (key: '__other__', name: 'Other', total: 6.0, count: 2, pct: 0.535236396074933, color: '#9ca3af', ids: ['t8', 't9'], merchant: false, samples: []),
    ],
  ),
  (
    name: 'zero-sum with refunds',
    txns: [('Refund', -500.0), ('Shoes', 500.0), ('shoe', 0.0), ('', 0.0)],
    capped: [
      (key: 't:sho', name: 'Shoes', total: 500.0, count: 1, pct: 50000.0, color: '#6366f1', ids: ['t2'], merchant: false, samples: ['Shoes']),
      (key: 't:shoe', name: 'shoe', total: 0.0, count: 1, pct: 0.0, color: '#10b981', ids: ['t3'], merchant: false, samples: ['shoe']),
      (key: '__no_note__', name: 'No description', total: 0.0, count: 1, pct: 0.0, color: '#f59e0b', ids: ['t4'], merchant: false, samples: []),
      (key: 't:refund', name: 'Refund', total: -500.0, count: 1, pct: -50000.0, color: '#ef4444', ids: ['t1'], merchant: false, samples: ['Refund']),
    ],
    full: [
      (key: 't:sho', name: 'Shoes', total: 500.0, count: 1, pct: 50000.0, color: '#6366f1', ids: ['t2'], merchant: false, samples: ['Shoes']),
      (key: 't:shoe', name: 'shoe', total: 0.0, count: 1, pct: 0.0, color: '#10b981', ids: ['t3'], merchant: false, samples: ['shoe']),
      (key: '__no_note__', name: 'No description', total: 0.0, count: 1, pct: 0.0, color: '#f59e0b', ids: ['t4'], merchant: false, samples: []),
      (key: 't:refund', name: 'Refund', total: -500.0, count: 1, pct: -50000.0, color: '#ef4444', ids: ['t1'], merchant: false, samples: ['Refund']),
    ],
    recapped: [
      (key: 't:sho', name: 'Shoes', total: 500.0, count: 1, pct: 50000.0, color: '#6366f1', ids: ['t2'], merchant: false, samples: ['Shoes']),
      (key: 't:shoe', name: 'shoe', total: 0.0, count: 1, pct: 0.0, color: '#10b981', ids: ['t3'], merchant: false, samples: ['shoe']),
      (key: '__no_note__', name: 'No description', total: 0.0, count: 1, pct: 0.0, color: '#f59e0b', ids: ['t4'], merchant: false, samples: []),
      (key: 't:refund', name: 'Refund', total: -500.0, count: 1, pct: -50000.0, color: '#ef4444', ids: ['t1'], merchant: false, samples: ['Refund']),
    ],
  ),
  (
    name: 'negative totals',
    txns: [('Cashback', -120.5), ('cash back', -30.0), ('Shirt', 799.0), ('shirts', -799.0), ('Belt', 0.0)],
    capped: [
      (key: 't:shirt', name: 'Shirt', total: 0.0, count: 2, pct: 0.0, color: '#6366f1', ids: ['t3', 't4'], merchant: false, samples: ['Shirt', 'shirts']),
      (key: 't:belt', name: 'Belt', total: 0.0, count: 1, pct: 0.0, color: '#10b981', ids: ['t5'], merchant: false, samples: ['Belt']),
      (key: 't:back', name: 'cash back', total: -30.0, count: 1, pct: 19.93355481727575, color: '#f59e0b', ids: ['t2'], merchant: false, samples: ['cash back']),
      (key: 't:cashback', name: 'Cashback', total: -120.5, count: 1, pct: 80.06644518272425, color: '#ef4444', ids: ['t1'], merchant: false, samples: ['Cashback']),
    ],
    full: [
      (key: 't:shirt', name: 'Shirt', total: 0.0, count: 2, pct: 0.0, color: '#6366f1', ids: ['t3', 't4'], merchant: false, samples: ['Shirt', 'shirts']),
      (key: 't:belt', name: 'Belt', total: 0.0, count: 1, pct: 0.0, color: '#10b981', ids: ['t5'], merchant: false, samples: ['Belt']),
      (key: 't:back', name: 'cash back', total: -30.0, count: 1, pct: 19.93355481727575, color: '#f59e0b', ids: ['t2'], merchant: false, samples: ['cash back']),
      (key: 't:cashback', name: 'Cashback', total: -120.5, count: 1, pct: 80.06644518272425, color: '#ef4444', ids: ['t1'], merchant: false, samples: ['Cashback']),
    ],
    recapped: [
      (key: 't:shirt', name: 'Shirt', total: 0.0, count: 2, pct: 0.0, color: '#6366f1', ids: ['t3', 't4'], merchant: false, samples: ['Shirt', 'shirts']),
      (key: 't:belt', name: 'Belt', total: 0.0, count: 1, pct: 0.0, color: '#10b981', ids: ['t5'], merchant: false, samples: ['Belt']),
      (key: 't:back', name: 'cash back', total: -30.0, count: 1, pct: 19.93355481727575, color: '#f59e0b', ids: ['t2'], merchant: false, samples: ['cash back']),
      (key: 't:cashback', name: 'Cashback', total: -120.5, count: 1, pct: 80.06644518272425, color: '#ef4444', ids: ['t1'], merchant: false, samples: ['Cashback']),
    ],
  ),
  (
    name: 'decimal amounts',
    txns: [('Chai', 0.1), ('chai', 0.2), ('Coffee', 0.3), ('Tea stall', 10.01), ('tea stall', 20.02), ('Tea stall', 30.03), ('Biscuit', 99.99), ('biscuits', 0.01), ('', 1e-7)],
    capped: [
      (key: 't:biscuit', name: 'Biscuit', total: 100.0, count: 2, pct: 62.24324656900085, color: '#6366f1', ids: ['t7', 't8'], merchant: false, samples: ['Biscuit', 'biscuits']),
      (key: 'p:tea stall', name: 'Tea stall', total: 60.06, count: 3, pct: 37.383293889341914, color: '#10b981', ids: ['t4', 't5', 't6'], merchant: false, samples: ['Tea stall', 'tea stall']),
      (key: 't:chai', name: 'Chai', total: 0.30000000000000004, count: 2, pct: 0.1867297397070026, color: '#f59e0b', ids: ['t1', 't2'], merchant: false, samples: ['Chai', 'chai']),
      (key: 't:coffee', name: 'Coffee', total: 0.3, count: 1, pct: 0.18672973970700257, color: '#ef4444', ids: ['t3'], merchant: false, samples: ['Coffee']),
      (key: '__no_note__', name: 'No description', total: 1e-7, count: 1, pct: 6.224324656900086e-8, color: '#8b5cf6', ids: ['t9'], merchant: false, samples: []),
    ],
    full: [
      (key: 't:biscuit', name: 'Biscuit', total: 100.0, count: 2, pct: 62.24324656900085, color: '#6366f1', ids: ['t7', 't8'], merchant: false, samples: ['Biscuit', 'biscuits']),
      (key: 'p:tea stall', name: 'Tea stall', total: 60.06, count: 3, pct: 37.383293889341914, color: '#10b981', ids: ['t4', 't5', 't6'], merchant: false, samples: ['Tea stall', 'tea stall']),
      (key: 't:chai', name: 'Chai', total: 0.30000000000000004, count: 2, pct: 0.1867297397070026, color: '#f59e0b', ids: ['t1', 't2'], merchant: false, samples: ['Chai', 'chai']),
      (key: 't:coffee', name: 'Coffee', total: 0.3, count: 1, pct: 0.18672973970700257, color: '#ef4444', ids: ['t3'], merchant: false, samples: ['Coffee']),
      (key: '__no_note__', name: 'No description', total: 1e-7, count: 1, pct: 6.224324656900086e-8, color: '#8b5cf6', ids: ['t9'], merchant: false, samples: []),
    ],
    recapped: [
      (key: 't:biscuit', name: 'Biscuit', total: 100.0, count: 2, pct: 62.24324656900083, color: '#6366f1', ids: ['t7', 't8'], merchant: false, samples: ['Biscuit', 'biscuits']),
      (key: 'p:tea stall', name: 'Tea stall', total: 60.06, count: 3, pct: 37.3832938893419, color: '#10b981', ids: ['t4', 't5', 't6'], merchant: false, samples: ['Tea stall', 'tea stall']),
      (key: 't:chai', name: 'Chai', total: 0.30000000000000004, count: 2, pct: 0.18672973970700252, color: '#f59e0b', ids: ['t1', 't2'], merchant: false, samples: ['Chai', 'chai']),
      (key: 't:coffee', name: 'Coffee', total: 0.3, count: 1, pct: 0.18672973970700252, color: '#ef4444', ids: ['t3'], merchant: false, samples: ['Coffee']),
      (key: '__no_note__', name: 'No description', total: 1e-7, count: 1, pct: 6.224324656900083e-8, color: '#8b5cf6', ids: ['t9'], merchant: false, samples: []),
    ],
  ),
  (
    name: 'display name sixty percent rule',
    txns: [('Dinner with friends', 900.0), ('Dinner with friends', 750.0), ('Dinner with friends', 820.0), ('dinner at home', 200.0), ('dinner at home', 150.0), ('Lunch', 120.0), ('lunch box', 80.0), ('LUNCH', 95.0), ('Lunch', 110.0), ('lunch thali', 130.0)],
    capped: [
      (key: 't:dinner', name: 'Dinner with friends', total: 2820.0, count: 5, pct: 84.05365126676601, color: '#6366f1', ids: ['t1', 't2', 't3', 't4', 't5'], merchant: false, samples: ['Dinner with friends', 'dinner at home']),
      (key: 't:lunch', name: 'Lunch', total: 535.0, count: 5, pct: 15.946348733233979, color: '#10b981', ids: ['t6', 't7', 't8', 't9', 't10'], merchant: false, samples: ['Lunch', 'lunch box', 'LUNCH']),
    ],
    full: [
      (key: 't:dinner', name: 'Dinner with friends', total: 2820.0, count: 5, pct: 84.05365126676601, color: '#6366f1', ids: ['t1', 't2', 't3', 't4', 't5'], merchant: false, samples: ['Dinner with friends', 'dinner at home']),
      (key: 't:lunch', name: 'Lunch', total: 535.0, count: 5, pct: 15.946348733233979, color: '#10b981', ids: ['t6', 't7', 't8', 't9', 't10'], merchant: false, samples: ['Lunch', 'lunch box', 'LUNCH']),
    ],
    recapped: [
      (key: 't:dinner', name: 'Dinner with friends', total: 2820.0, count: 5, pct: 84.05365126676601, color: '#6366f1', ids: ['t1', 't2', 't3', 't4', 't5'], merchant: false, samples: ['Dinner with friends', 'dinner at home']),
      (key: 't:lunch', name: 'Lunch', total: 535.0, count: 5, pct: 15.946348733233979, color: '#10b981', ids: ['t6', 't7', 't8', 't9', 't10'], merchant: false, samples: ['Lunch', 'lunch box', 'LUNCH']),
    ],
  ),
  (
    name: 'raw whitespace and case variants',
    txns: [('  Chai  ', 10.0), ('chai', 12.0), ('CHAI\u{a}', 11.0), ('\u{85}Chai\u{85}', 9.0), ('\u{a0}Chai\u{a0}', 8.0), ('\u{9}Samosa ', 20.0), ('Samosa', 22.0), (' samosa', 18.0), ('\u{85}', 1.0)],
    capped: [
      (key: 't:samosa', name: 'Samosa', total: 60.0, count: 3, pct: 54.054054054054056, color: '#6366f1', ids: ['t6', 't7', 't8'], merchant: false, samples: ['Samosa', 'Samosa', 'samosa']),
      (key: 't:chai', name: 'Chai', total: 50.0, count: 5, pct: 45.04504504504504, color: '#10b981', ids: ['t1', 't2', 't3', 't4', 't5'], merchant: false, samples: ['Chai', 'chai', 'CHAI']),
      (key: '__no_note__', name: 'No description', total: 1.0, count: 1, pct: 0.9009009009009009, color: '#f59e0b', ids: ['t9'], merchant: false, samples: ['\u{85}']),
    ],
    full: [
      (key: 't:samosa', name: 'Samosa', total: 60.0, count: 3, pct: 54.054054054054056, color: '#6366f1', ids: ['t6', 't7', 't8'], merchant: false, samples: ['Samosa', 'Samosa', 'samosa']),
      (key: 't:chai', name: 'Chai', total: 50.0, count: 5, pct: 45.04504504504504, color: '#10b981', ids: ['t1', 't2', 't3', 't4', 't5'], merchant: false, samples: ['Chai', 'chai', 'CHAI']),
      (key: '__no_note__', name: 'No description', total: 1.0, count: 1, pct: 0.9009009009009009, color: '#f59e0b', ids: ['t9'], merchant: false, samples: ['\u{85}']),
    ],
    recapped: [
      (key: 't:samosa', name: 'Samosa', total: 60.0, count: 3, pct: 54.054054054054056, color: '#6366f1', ids: ['t6', 't7', 't8'], merchant: false, samples: ['Samosa', 'Samosa', 'samosa']),
      (key: 't:chai', name: 'Chai', total: 50.0, count: 5, pct: 45.04504504504504, color: '#10b981', ids: ['t1', 't2', 't3', 't4', 't5'], merchant: false, samples: ['Chai', 'chai', 'CHAI']),
      (key: '__no_note__', name: 'No description', total: 1.0, count: 1, pct: 0.9009009009009009, color: '#f59e0b', ids: ['t9'], merchant: false, samples: ['\u{85}']),
    ],
  ),
  (
    name: 'indian merchants',
    txns: [('Ola cab to airport', 650.0), ('olacabs', 220.0), ('Rapido bike', 85.0), ('auto rickshaw', 60.0), ('Namma Metro', 45.0), ('HP Petrol', 2000.0), ('D-Mart groceries', 3400.0), ('Big Basket', 1250.0), ('bb now', 310.0), ('Google Pay', 100.0), ('G pay recharge', 299.0), ('Disney+ Hotstar', 1499.0), ('PVR INOX', 640.0), ('Vi postpaid', 399.0), ('IRCTC tatkal', 1820.0), ('Indigo flight', 5400.0), ('PhonePe', 50.0), ('amzn', 799.0), ('Amazon Pay', 1200.0), ('amazon prime', 1499.0), ('Prime Video', 179.0), ('Reliance Jio', 666.0), ('jio', 239.0), ('BESCOM', 1875.0), ('Indane', 1105.0), ('Redbus', 900.0), ('taxi', 350.0), ('Cab', 280.0)],
    capped: [
      (key: 'm:flight', name: 'Flight', total: 5400.0, count: 1, pct: 19.7664629012775, color: '#6366f1', ids: ['t16'], merchant: true, samples: ['Indigo flight']),
      (key: 'm:amazon', name: 'Amazon', total: 3498.0, count: 3, pct: 12.804275412716423, color: '#10b981', ids: ['t18', 't19', 't20'], merchant: true, samples: ['amzn', 'Amazon Pay', 'amazon prime']),
      (key: 'm:dmart', name: 'DMart', total: 3400.0, count: 1, pct: 12.445550715619166, color: '#f59e0b', ids: ['t7'], merchant: true, samples: ['D-Mart groceries']),
      (key: 'm:petrol', name: 'Petrol', total: 2000.0, count: 1, pct: 7.320912185658333, color: '#ef4444', ids: ['t6'], merchant: true, samples: ['HP Petrol']),
      (key: 'm:electricity', name: 'Electricity', total: 1875.0, count: 1, pct: 6.863355174054687, color: '#8b5cf6', ids: ['t24'], merchant: true, samples: ['BESCOM']),
      (key: '__other__', name: 'Other', total: 11146.0, count: 21, pct: 40.79944361067389, color: '#9ca3af', ids: ['t15', 't8', 't9', 't12', 't25', 't22', 't23', 't26', 't1', 't2', 't13', 't27', 't28', 't10', 't11', 't14', 't21', 't3', 't4', 't17', 't5'], merchant: false, samples: []),
    ],
    full: [
      (key: 'm:flight', name: 'Flight', total: 5400.0, count: 1, pct: 19.7664629012775, color: '#6366f1', ids: ['t16'], merchant: true, samples: ['Indigo flight']),
      (key: 'm:amazon', name: 'Amazon', total: 3498.0, count: 3, pct: 12.804275412716423, color: '#10b981', ids: ['t18', 't19', 't20'], merchant: true, samples: ['amzn', 'Amazon Pay', 'amazon prime']),
      (key: 'm:dmart', name: 'DMart', total: 3400.0, count: 1, pct: 12.445550715619166, color: '#f59e0b', ids: ['t7'], merchant: true, samples: ['D-Mart groceries']),
      (key: 'm:petrol', name: 'Petrol', total: 2000.0, count: 1, pct: 7.320912185658333, color: '#ef4444', ids: ['t6'], merchant: true, samples: ['HP Petrol']),
      (key: 'm:electricity', name: 'Electricity', total: 1875.0, count: 1, pct: 6.863355174054687, color: '#8b5cf6', ids: ['t24'], merchant: true, samples: ['BESCOM']),
      (key: 'm:train', name: 'Train', total: 1820.0, count: 1, pct: 6.662030088949083, color: '#06b6d4', ids: ['t15'], merchant: true, samples: ['IRCTC tatkal']),
      (key: 'm:bigbasket', name: 'BigBasket', total: 1560.0, count: 2, pct: 5.7103115048135, color: '#6366f1', ids: ['t8', 't9'], merchant: true, samples: ['Big Basket', 'bb now']),
      (key: 'm:hotstar', name: 'Hotstar', total: 1499.0, count: 1, pct: 5.4870236831509205, color: '#10b981', ids: ['t12'], merchant: true, samples: ['Disney+ Hotstar']),
      (key: 'm:gas', name: 'Gas', total: 1105.0, count: 1, pct: 4.044803982576229, color: '#f59e0b', ids: ['t25'], merchant: true, samples: ['Indane']),
      (key: 'm:jio', name: 'Jio', total: 905.0, count: 2, pct: 3.3127127640103957, color: '#ef4444', ids: ['t22', 't23'], merchant: true, samples: ['Reliance Jio', 'jio']),
      (key: 'm:bus', name: 'Bus', total: 900.0, count: 1, pct: 3.2944104835462498, color: '#8b5cf6', ids: ['t26'], merchant: true, samples: ['Redbus']),
      (key: 'm:ola', name: 'Ola', total: 870.0, count: 2, pct: 3.1845968007613745, color: '#06b6d4', ids: ['t1', 't2'], merchant: true, samples: ['Ola cab to airport', 'olacabs']),
      (key: 'm:pvr', name: 'PVR', total: 640.0, count: 1, pct: 2.3426918994106667, color: '#6366f1', ids: ['t13'], merchant: true, samples: ['PVR INOX']),
      (key: 'm:cab', name: 'Cab', total: 630.0, count: 2, pct: 2.306087338482375, color: '#10b981', ids: ['t27', 't28'], merchant: true, samples: ['taxi', 'Cab']),
      (key: 'm:gpay', name: 'GPay', total: 399.0, count: 2, pct: 1.4605219810388375, color: '#f59e0b', ids: ['t10', 't11'], merchant: true, samples: ['Google Pay', 'G pay recharge']),
      (key: 'm:vi', name: 'Vi', total: 399.0, count: 1, pct: 1.4605219810388375, color: '#ef4444', ids: ['t14'], merchant: true, samples: ['Vi postpaid']),
      (key: 'm:prime video', name: 'Prime Video', total: 179.0, count: 1, pct: 0.6552216406164207, color: '#8b5cf6', ids: ['t21'], merchant: true, samples: ['Prime Video']),
      (key: 'm:rapido', name: 'Rapido', total: 85.0, count: 1, pct: 0.3111387678904792, color: '#06b6d4', ids: ['t3'], merchant: true, samples: ['Rapido bike']),
      (key: 'm:auto', name: 'Auto', total: 60.0, count: 1, pct: 0.21962736556975002, color: '#6366f1', ids: ['t4'], merchant: true, samples: ['auto rickshaw']),
      (key: 'm:phonepe', name: 'PhonePe', total: 50.0, count: 1, pct: 0.18302280464145831, color: '#10b981', ids: ['t17'], merchant: true, samples: ['PhonePe']),
      (key: 'm:metro', name: 'Metro', total: 45.0, count: 1, pct: 0.16472052417731248, color: '#f59e0b', ids: ['t5'], merchant: true, samples: ['Namma Metro']),
    ],
    recapped: [
      (key: 'm:flight', name: 'Flight', total: 5400.0, count: 1, pct: 19.7664629012775, color: '#6366f1', ids: ['t16'], merchant: true, samples: ['Indigo flight']),
      (key: 'm:amazon', name: 'Amazon', total: 3498.0, count: 3, pct: 12.804275412716423, color: '#10b981', ids: ['t18', 't19', 't20'], merchant: true, samples: ['amzn', 'Amazon Pay', 'amazon prime']),
      (key: 'm:dmart', name: 'DMart', total: 3400.0, count: 1, pct: 12.445550715619166, color: '#f59e0b', ids: ['t7'], merchant: true, samples: ['D-Mart groceries']),
      (key: 'm:petrol', name: 'Petrol', total: 2000.0, count: 1, pct: 7.320912185658333, color: '#ef4444', ids: ['t6'], merchant: true, samples: ['HP Petrol']),
      (key: 'm:electricity', name: 'Electricity', total: 1875.0, count: 1, pct: 6.863355174054687, color: '#8b5cf6', ids: ['t24'], merchant: true, samples: ['BESCOM']),
      (key: '__other__', name: 'Other', total: 11146.0, count: 21, pct: 40.79944361067389, color: '#9ca3af', ids: ['t15', 't8', 't9', 't12', 't25', 't22', 't23', 't26', 't1', 't2', 't13', 't27', 't28', 't10', 't11', 't14', 't21', 't3', 't4', 't17', 't5'], merchant: false, samples: []),
    ],
  ),
  (
    name: 'non-merchant absorbed by merchant',
    txns: [('Uber', 400.0), ('ubereats', 320.0), ('uberx', 150.0), ('oober', 90.0), ('Flight', 6000.0), ('flights', 5500.0), ('flite', 100.0), ('Ola', 200.0), ('olaa', 50.0), ('Petrol', 1500.0), ('petrolium', 70.0), ('petrl', 60.0), ('Swiggy', 300.0), ('Swigy', 280.0), ('Zomato', 250.0), ('Zomatoo', 240.0)],
    capped: [
      (key: 'm:flight', name: 'Flight', total: 11500.0, count: 2, pct: 74.14571244358478, color: '#6366f1', ids: ['t5', 't6'], merchant: true, samples: ['Flight', 'flights']),
      (key: 'm:petrol', name: 'Petrol', total: 1630.0, count: 3, pct: 10.509348807221148, color: '#10b981', ids: ['t10', 't11', 't12'], merchant: true, samples: ['Petrol', 'petrolium', 'petrl']),
      (key: 'm:uber', name: 'Uber', total: 960.0, count: 4, pct: 6.189555125725339, color: '#f59e0b', ids: ['t1', 't2', 't3', 't4'], merchant: true, samples: ['Uber', 'ubereats', 'uberx']),
      (key: 'm:swiggy', name: 'Swiggy', total: 580.0, count: 2, pct: 3.7395228884590583, color: '#ef4444', ids: ['t13', 't14'], merchant: true, samples: ['Swiggy', 'Swigy']),
      (key: 'm:zomato', name: 'Zomato', total: 490.0, count: 2, pct: 3.1592520954223082, color: '#8b5cf6', ids: ['t15', 't16'], merchant: true, samples: ['Zomato', 'Zomatoo']),
      (key: '__other__', name: 'Other', total: 350.0, count: 3, pct: 2.256608639587363, color: '#9ca3af', ids: ['t8', 't7', 't9'], merchant: false, samples: []),
    ],
    full: [
      (key: 'm:flight', name: 'Flight', total: 11500.0, count: 2, pct: 74.14571244358478, color: '#6366f1', ids: ['t5', 't6'], merchant: true, samples: ['Flight', 'flights']),
      (key: 'm:petrol', name: 'Petrol', total: 1630.0, count: 3, pct: 10.509348807221148, color: '#10b981', ids: ['t10', 't11', 't12'], merchant: true, samples: ['Petrol', 'petrolium', 'petrl']),
      (key: 'm:uber', name: 'Uber', total: 960.0, count: 4, pct: 6.189555125725339, color: '#f59e0b', ids: ['t1', 't2', 't3', 't4'], merchant: true, samples: ['Uber', 'ubereats', 'uberx']),
      (key: 'm:swiggy', name: 'Swiggy', total: 580.0, count: 2, pct: 3.7395228884590583, color: '#ef4444', ids: ['t13', 't14'], merchant: true, samples: ['Swiggy', 'Swigy']),
      (key: 'm:zomato', name: 'Zomato', total: 490.0, count: 2, pct: 3.1592520954223082, color: '#8b5cf6', ids: ['t15', 't16'], merchant: true, samples: ['Zomato', 'Zomatoo']),
      (key: 'm:ola', name: 'Ola', total: 200.0, count: 1, pct: 1.2894906511927788, color: '#06b6d4', ids: ['t8'], merchant: true, samples: ['Ola']),
      (key: 't:flite', name: 'flite', total: 100.0, count: 1, pct: 0.6447453255963894, color: '#6366f1', ids: ['t7'], merchant: false, samples: ['flite']),
      (key: 't:olaa', name: 'olaa', total: 50.0, count: 1, pct: 0.3223726627981947, color: '#10b981', ids: ['t9'], merchant: false, samples: ['olaa']),
    ],
    recapped: [
      (key: 'm:flight', name: 'Flight', total: 11500.0, count: 2, pct: 74.14571244358478, color: '#6366f1', ids: ['t5', 't6'], merchant: true, samples: ['Flight', 'flights']),
      (key: 'm:petrol', name: 'Petrol', total: 1630.0, count: 3, pct: 10.509348807221148, color: '#10b981', ids: ['t10', 't11', 't12'], merchant: true, samples: ['Petrol', 'petrolium', 'petrl']),
      (key: 'm:uber', name: 'Uber', total: 960.0, count: 4, pct: 6.189555125725339, color: '#f59e0b', ids: ['t1', 't2', 't3', 't4'], merchant: true, samples: ['Uber', 'ubereats', 'uberx']),
      (key: 'm:swiggy', name: 'Swiggy', total: 580.0, count: 2, pct: 3.7395228884590583, color: '#ef4444', ids: ['t13', 't14'], merchant: true, samples: ['Swiggy', 'Swigy']),
      (key: 'm:zomato', name: 'Zomato', total: 490.0, count: 2, pct: 3.1592520954223082, color: '#8b5cf6', ids: ['t15', 't16'], merchant: true, samples: ['Zomato', 'Zomatoo']),
      (key: '__other__', name: 'Other', total: 350.0, count: 3, pct: 2.256608639587363, color: '#9ca3af', ids: ['t8', 't7', 't9'], merchant: false, samples: []),
    ],
  ),
  (
    name: 'merchants never merge into each other',
    txns: [('bus', 20.0), ('bus pass', 400.0), ('cab', 300.0), ('cabs', 100.0), ('train', 150.0), ('trains', 160.0), ('metro', 40.0), ('metros', 30.0), ('Auto', 50.0), ('autos', 45.0), ('automatic', 5.0)],
    capped: [
      (key: 'm:bus', name: 'Bus', total: 420.0, count: 2, pct: 32.30769230769231, color: '#6366f1', ids: ['t1', 't2'], merchant: true, samples: ['bus', 'bus pass']),
      (key: 'm:cab', name: 'Cab', total: 400.0, count: 2, pct: 30.76923076923077, color: '#10b981', ids: ['t3', 't4'], merchant: true, samples: ['cab', 'cabs']),
      (key: 't:train', name: 'trains', total: 160.0, count: 1, pct: 12.307692307692308, color: '#f59e0b', ids: ['t6'], merchant: false, samples: ['trains']),
      (key: 'm:train', name: 'Train', total: 150.0, count: 1, pct: 11.538461538461538, color: '#ef4444', ids: ['t5'], merchant: true, samples: ['train']),
      (key: 'm:auto', name: 'Auto', total: 100.0, count: 3, pct: 7.6923076923076925, color: '#8b5cf6', ids: ['t9', 't10', 't11'], merchant: true, samples: ['Auto', 'autos', 'automatic']),
      (key: 'm:metro', name: 'Metro', total: 70.0, count: 2, pct: 5.384615384615385, color: '#06b6d4', ids: ['t7', 't8'], merchant: true, samples: ['metro', 'metros']),
    ],
    full: [
      (key: 'm:bus', name: 'Bus', total: 420.0, count: 2, pct: 32.30769230769231, color: '#6366f1', ids: ['t1', 't2'], merchant: true, samples: ['bus', 'bus pass']),
      (key: 'm:cab', name: 'Cab', total: 400.0, count: 2, pct: 30.76923076923077, color: '#10b981', ids: ['t3', 't4'], merchant: true, samples: ['cab', 'cabs']),
      (key: 't:train', name: 'trains', total: 160.0, count: 1, pct: 12.307692307692308, color: '#f59e0b', ids: ['t6'], merchant: false, samples: ['trains']),
      (key: 'm:train', name: 'Train', total: 150.0, count: 1, pct: 11.538461538461538, color: '#ef4444', ids: ['t5'], merchant: true, samples: ['train']),
      (key: 'm:auto', name: 'Auto', total: 100.0, count: 3, pct: 7.6923076923076925, color: '#8b5cf6', ids: ['t9', 't10', 't11'], merchant: true, samples: ['Auto', 'autos', 'automatic']),
      (key: 'm:metro', name: 'Metro', total: 70.0, count: 2, pct: 5.384615384615385, color: '#06b6d4', ids: ['t7', 't8'], merchant: true, samples: ['metro', 'metros']),
    ],
    recapped: [
      (key: 'm:bus', name: 'Bus', total: 420.0, count: 2, pct: 32.30769230769231, color: '#6366f1', ids: ['t1', 't2'], merchant: true, samples: ['bus', 'bus pass']),
      (key: 'm:cab', name: 'Cab', total: 400.0, count: 2, pct: 30.76923076923077, color: '#10b981', ids: ['t3', 't4'], merchant: true, samples: ['cab', 'cabs']),
      (key: 't:train', name: 'trains', total: 160.0, count: 1, pct: 12.307692307692308, color: '#f59e0b', ids: ['t6'], merchant: false, samples: ['trains']),
      (key: 'm:train', name: 'Train', total: 150.0, count: 1, pct: 11.538461538461538, color: '#ef4444', ids: ['t5'], merchant: true, samples: ['train']),
      (key: 'm:auto', name: 'Auto', total: 100.0, count: 3, pct: 7.6923076923076925, color: '#8b5cf6', ids: ['t9', 't10', 't11'], merchant: true, samples: ['Auto', 'autos', 'automatic']),
      (key: 'm:metro', name: 'Metro', total: 70.0, count: 2, pct: 5.384615384615385, color: '#06b6d4', ids: ['t7', 't8'], merchant: true, samples: ['metro', 'metros']),
    ],
  ),
  (
    name: 'long mixed grocery month',
    txns: [('Milk', 56.0), ('milk', 56.0), ('Milk & bread', 98.0), ('Bread', 42.0), ('Eggs', 84.0), ('egg', 7.0), ('Eggs 12', 90.0), ('Vegetables', 230.0), ('veggies', 180.0), ('Vegetable', 75.0), ('Fruits', 320.0), ('fruit', 150.0), ('Onions', 60.0), ('onion 2kg', 70.0), ('Tomato', 40.0), ('tomatoes', 55.0), ('Atta', 410.0), ('aata', 395.0), ('Rice', 900.0), ('Dal', 240.0), ('dhal', 260.0), ('Oil', 720.0), ('Sunflower oil', 680.0), ('Zepto', 455.0), ('Blinkit order', 612.0), ('blnkit', 130.0), ('', 99.0), ('Maggi', 70.0), ('maggie', 84.0), ('Curd', 45.0)],
    capped: [
      (key: 't:oil', name: 'Oil', total: 1400.0, count: 2, pct: 20.855057351407716, color: '#6366f1', ids: ['t22', 't23'], merchant: false, samples: ['Oil', 'Sunflower oil']),
      (key: 't:rice', name: 'Rice', total: 900.0, count: 1, pct: 13.406822583047816, color: '#10b981', ids: ['t19'], merchant: false, samples: ['Rice']),
      (key: 't:atta', name: 'Atta', total: 805.0, count: 2, pct: 11.991657977059438, color: '#f59e0b', ids: ['t17', 't18'], merchant: false, samples: ['Atta', 'aata']),
      (key: 'm:blinkit', name: 'Blinkit', total: 742.0, count: 2, pct: 11.05318039624609, color: '#ef4444', ids: ['t25', 't26'], merchant: true, samples: ['Blinkit order', 'blnkit']),
      (key: 't:fruit', name: 'Fruit', total: 470.0, count: 2, pct: 7.001340682258304, color: '#8b5cf6', ids: ['t11', 't12'], merchant: false, samples: ['Fruits', 'fruit']),
      (key: '__other__', name: 'Other', total: 2396.0, count: 21, pct: 35.69194100998063, color: '#9ca3af', ids: ['t24', 't8', 't10', 't21', 't20', 't1', 't2', 't3', 't5', 't6', 't7', 't9', 't29', 't28', 't13', 't14', 't27', 't15', 't16', 't30', 't4'], merchant: false, samples: []),
    ],
    full: [
      (key: 't:oil', name: 'Oil', total: 1400.0, count: 2, pct: 20.855057351407716, color: '#6366f1', ids: ['t22', 't23'], merchant: false, samples: ['Oil', 'Sunflower oil']),
      (key: 't:rice', name: 'Rice', total: 900.0, count: 1, pct: 13.406822583047816, color: '#10b981', ids: ['t19'], merchant: false, samples: ['Rice']),
      (key: 't:atta', name: 'Atta', total: 805.0, count: 2, pct: 11.991657977059438, color: '#f59e0b', ids: ['t17', 't18'], merchant: false, samples: ['Atta', 'aata']),
      (key: 'm:blinkit', name: 'Blinkit', total: 742.0, count: 2, pct: 11.05318039624609, color: '#ef4444', ids: ['t25', 't26'], merchant: true, samples: ['Blinkit order', 'blnkit']),
      (key: 't:fruit', name: 'Fruit', total: 470.0, count: 2, pct: 7.001340682258304, color: '#8b5cf6', ids: ['t11', 't12'], merchant: false, samples: ['Fruits', 'fruit']),
      (key: 'm:zepto', name: 'Zepto', total: 455.0, count: 1, pct: 6.777893639207508, color: '#06b6d4', ids: ['t24'], merchant: true, samples: ['Zepto']),
      (key: 't:vegetabl', name: 'Vegetabl', total: 305.0, count: 2, pct: 4.543423208699538, color: '#6366f1', ids: ['t8', 't10'], merchant: false, samples: ['Vegetables', 'Vegetable']),
      (key: 't:dhal', name: 'dhal', total: 260.0, count: 1, pct: 3.8730820795471472, color: '#10b981', ids: ['t21'], merchant: false, samples: ['dhal']),
      (key: 't:dal', name: 'Dal', total: 240.0, count: 1, pct: 3.5751526888127514, color: '#f59e0b', ids: ['t20'], merchant: false, samples: ['Dal']),
      (key: 't:milk', name: 'Milk', total: 210.0, count: 3, pct: 3.1282586027111576, color: '#ef4444', ids: ['t1', 't2', 't3'], merchant: false, samples: ['Milk', 'milk', 'Milk & bread']),
      (key: 't:egg', name: 'Egg', total: 181.0, count: 3, pct: 2.6962609861462834, color: '#8b5cf6', ids: ['t5', 't6', 't7'], merchant: false, samples: ['Eggs', 'egg', 'Eggs 12']),
      (key: 't:veggy', name: 'veggies', total: 180.0, count: 1, pct: 2.6813645166095634, color: '#06b6d4', ids: ['t9'], merchant: false, samples: ['veggies']),
      (key: 't:maggie', name: 'Maggie', total: 154.0, count: 2, pct: 2.2940563086548487, color: '#6366f1', ids: ['t29', 't28'], merchant: false, samples: ['maggie', 'Maggi']),
      (key: 't:onion', name: 'Onion', total: 130.0, count: 2, pct: 1.9365410397735736, color: '#10b981', ids: ['t13', 't14'], merchant: false, samples: ['Onions', 'onion 2kg']),
      (key: '__no_note__', name: 'No description', total: 99.0, count: 1, pct: 1.47475048413526, color: '#f59e0b', ids: ['t27'], merchant: false, samples: []),
      (key: 't:tomato', name: 'Tomato', total: 95.0, count: 2, pct: 1.415164605988381, color: '#ef4444', ids: ['t15', 't16'], merchant: false, samples: ['Tomato', 'tomatoes']),
      (key: 't:curd', name: 'Curd', total: 45.0, count: 1, pct: 0.6703411291523909, color: '#8b5cf6', ids: ['t30'], merchant: false, samples: ['Curd']),
      (key: 't:bread', name: 'Bread', total: 42.0, count: 1, pct: 0.6256517205422315, color: '#06b6d4', ids: ['t4'], merchant: false, samples: ['Bread']),
    ],
    recapped: [
      (key: 't:oil', name: 'Oil', total: 1400.0, count: 2, pct: 20.855057351407716, color: '#6366f1', ids: ['t22', 't23'], merchant: false, samples: ['Oil', 'Sunflower oil']),
      (key: 't:rice', name: 'Rice', total: 900.0, count: 1, pct: 13.406822583047816, color: '#10b981', ids: ['t19'], merchant: false, samples: ['Rice']),
      (key: 't:atta', name: 'Atta', total: 805.0, count: 2, pct: 11.991657977059438, color: '#f59e0b', ids: ['t17', 't18'], merchant: false, samples: ['Atta', 'aata']),
      (key: 'm:blinkit', name: 'Blinkit', total: 742.0, count: 2, pct: 11.05318039624609, color: '#ef4444', ids: ['t25', 't26'], merchant: true, samples: ['Blinkit order', 'blnkit']),
      (key: 't:fruit', name: 'Fruit', total: 470.0, count: 2, pct: 7.001340682258304, color: '#8b5cf6', ids: ['t11', 't12'], merchant: false, samples: ['Fruits', 'fruit']),
      (key: '__other__', name: 'Other', total: 2396.0, count: 21, pct: 35.69194100998063, color: '#9ca3af', ids: ['t24', 't8', 't10', 't21', 't20', 't1', 't2', 't3', 't5', 't6', 't7', 't9', 't29', 't28', 't13', 't14', 't27', 't15', 't16', 't30', 't4'], merchant: false, samples: []),
    ],
  ),
  (
    name: 'overlapping phrases',
    txns: [('ice cream cone', 60.0), ('ice cream cone', 60.0), ('ice cream', 120.0), ('cream cone', 45.0), ('Ice Cream Sundae', 180.0), ('hot chocolate fudge', 220.0), ('hot chocolate fudge', 220.0), ('chocolate fudge', 90.0)],
    capped: [
      (key: 'p:chocolate fudge', name: 'hot chocolate fudge', total: 530.0, count: 3, pct: 53.266331658291456, color: '#6366f1', ids: ['t6', 't7', 't8'], merchant: false, samples: ['hot chocolate fudge', 'chocolate fudge']),
      (key: 't:cream', name: 'Cream', total: 465.0, count: 5, pct: 46.733668341708544, color: '#10b981', ids: ['t1', 't2', 't3', 't4', 't5'], merchant: false, samples: ['ice cream cone', 'ice cream', 'cream cone']),
    ],
    full: [
      (key: 'p:chocolate fudge', name: 'hot chocolate fudge', total: 530.0, count: 3, pct: 53.266331658291456, color: '#6366f1', ids: ['t6', 't7', 't8'], merchant: false, samples: ['hot chocolate fudge', 'chocolate fudge']),
      (key: 't:cream', name: 'Cream', total: 465.0, count: 5, pct: 46.733668341708544, color: '#10b981', ids: ['t1', 't2', 't3', 't4', 't5'], merchant: false, samples: ['ice cream cone', 'ice cream', 'cream cone']),
    ],
    recapped: [
      (key: 'p:chocolate fudge', name: 'hot chocolate fudge', total: 530.0, count: 3, pct: 53.266331658291456, color: '#6366f1', ids: ['t6', 't7', 't8'], merchant: false, samples: ['hot chocolate fudge', 'chocolate fudge']),
      (key: 't:cream', name: 'Cream', total: 465.0, count: 5, pct: 46.733668341708544, color: '#10b981', ids: ['t1', 't2', 't3', 't4', 't5'], merchant: false, samples: ['ice cream cone', 'ice cream', 'cream cone']),
    ],
  ),
  (
    name: 'no-note bucket dominates',
    txns: [('', 5000.0), (null, 2500.0), ('Notebook', 80.0), ('notebooks', 160.0), ('note', 10.0), ('Pens', 45.0), ('pencil', 12.0), ('pencils', 24.0)],
    capped: [
      (key: '__no_note__', name: 'No description', total: 7500.0, count: 2, pct: 95.77320904099093, color: '#6366f1', ids: ['t1', 't2'], merchant: false, samples: []),
      (key: 't:notebook', name: 'Notebook', total: 250.0, count: 3, pct: 3.1924403013663643, color: '#10b981', ids: ['t3', 't4', 't5'], merchant: false, samples: ['Notebook', 'notebooks', 'note']),
      (key: 't:pen', name: 'Pens', total: 45.0, count: 1, pct: 0.5746392542459456, color: '#f59e0b', ids: ['t6'], merchant: false, samples: ['Pens']),
      (key: 't:pencil', name: 'Pencil', total: 36.0, count: 2, pct: 0.45971140339675653, color: '#ef4444', ids: ['t7', 't8'], merchant: false, samples: ['pencil', 'pencils']),
    ],
    full: [
      (key: '__no_note__', name: 'No description', total: 7500.0, count: 2, pct: 95.77320904099093, color: '#6366f1', ids: ['t1', 't2'], merchant: false, samples: []),
      (key: 't:notebook', name: 'Notebook', total: 250.0, count: 3, pct: 3.1924403013663643, color: '#10b981', ids: ['t3', 't4', 't5'], merchant: false, samples: ['Notebook', 'notebooks', 'note']),
      (key: 't:pen', name: 'Pens', total: 45.0, count: 1, pct: 0.5746392542459456, color: '#f59e0b', ids: ['t6'], merchant: false, samples: ['Pens']),
      (key: 't:pencil', name: 'Pencil', total: 36.0, count: 2, pct: 0.45971140339675653, color: '#ef4444', ids: ['t7', 't8'], merchant: false, samples: ['pencil', 'pencils']),
    ],
    recapped: [
      (key: '__no_note__', name: 'No description', total: 7500.0, count: 2, pct: 95.77320904099093, color: '#6366f1', ids: ['t1', 't2'], merchant: false, samples: []),
      (key: 't:notebook', name: 'Notebook', total: 250.0, count: 3, pct: 3.1924403013663643, color: '#10b981', ids: ['t3', 't4', 't5'], merchant: false, samples: ['Notebook', 'notebooks', 'note']),
      (key: 't:pen', name: 'Pens', total: 45.0, count: 1, pct: 0.5746392542459456, color: '#f59e0b', ids: ['t6'], merchant: false, samples: ['Pens']),
      (key: 't:pencil', name: 'Pencil', total: 36.0, count: 2, pct: 0.45971140339675653, color: '#ef4444', ids: ['t7', 't8'], merchant: false, samples: ['pencil', 'pencils']),
    ],
  ),
  (
    name: 'non-latin scripts',
    txns: [('\u{926}\u{942}\u{927}', 60.0), ('\u{926}\u{942}\u{927} milk', 62.0), ('\u{baa}\u{bbe}\u{bb2}\u{bcd}', 55.0), ('\u{725b}\u{5976} milk', 70.0), ('milk \u{725b}\u{5976}', 68.0), ('\u{41c}\u{43e}\u{43b}\u{43e}\u{43a}\u{43e}', 40.0), ('\u{3bb}\u{3ac}\u{3b4}\u{3b9}', 33.0)],
    capped: [
      (key: 't:milk', name: 'Milk', total: 200.0, count: 3, pct: 51.546391752577314, color: '#6366f1', ids: ['t2', 't4', 't5'], merchant: false, samples: ['\u{926}\u{942}\u{927} milk', '\u{725b}\u{5976} milk', 'milk \u{725b}\u{5976}']),
      (key: '__no_note__', name: 'No description', total: 188.0, count: 4, pct: 48.45360824742268, color: '#10b981', ids: ['t1', 't3', 't6', 't7'], merchant: false, samples: ['\u{926}\u{942}\u{927}', '\u{baa}\u{bbe}\u{bb2}\u{bcd}', '\u{41c}\u{43e}\u{43b}\u{43e}\u{43a}\u{43e}']),
    ],
    full: [
      (key: 't:milk', name: 'Milk', total: 200.0, count: 3, pct: 51.546391752577314, color: '#6366f1', ids: ['t2', 't4', 't5'], merchant: false, samples: ['\u{926}\u{942}\u{927} milk', '\u{725b}\u{5976} milk', 'milk \u{725b}\u{5976}']),
      (key: '__no_note__', name: 'No description', total: 188.0, count: 4, pct: 48.45360824742268, color: '#10b981', ids: ['t1', 't3', 't6', 't7'], merchant: false, samples: ['\u{926}\u{942}\u{927}', '\u{baa}\u{bbe}\u{bb2}\u{bcd}', '\u{41c}\u{43e}\u{43b}\u{43e}\u{43a}\u{43e}']),
    ],
    recapped: [
      (key: 't:milk', name: 'Milk', total: 200.0, count: 3, pct: 51.546391752577314, color: '#6366f1', ids: ['t2', 't4', 't5'], merchant: false, samples: ['\u{926}\u{942}\u{927} milk', '\u{725b}\u{5976} milk', 'milk \u{725b}\u{5976}']),
      (key: '__no_note__', name: 'No description', total: 188.0, count: 4, pct: 48.45360824742268, color: '#10b981', ids: ['t1', 't3', 't6', 't7'], merchant: false, samples: ['\u{926}\u{942}\u{927}', '\u{baa}\u{bbe}\u{bb2}\u{bcd}', '\u{41c}\u{43e}\u{43b}\u{43e}\u{43a}\u{43e}']),
    ],
  ),
];

const List<(String, String)> _normalizeParity = [
  ('', ''),
  ('   ', ''),
  ('Uber', 'uber'),
  ('  UBER  to   Office ', 'uber to office'),
  ('Caf\u{e9} Coffee Day', 'cafe coffee day'),
  ('CAF\u{c9}', 'cafe'),
  ('cafe\u{301}', 'cafe'),
  ('Cr\u{e8}me br\u{fb}l\u{e9}e', 'creme brulee'),
  ('\u{130}stanbul', 'istanbul'),
  ('I\u{307}stanbul', 'istanbul'),
  ('\u{212a}elvin', 'kelvin'),
  ('\u{c5}ngstr\u{f6}m', 'angstrom'),
  ('\u{212b}ngstrom', 'angstrom'),
  ('na\u{ef}ve jalape\u{f1}o', 'naive jalapeno'),
  ('Stra\u{df}e', 'stra e'),
  ('sm\u{f8}rrebr\u{f8}d', 'sm rrebr d'),
  ('\u{141}\u{f3}d\u{17a}', 'odz'),
  ('\u{110}\u{e0} N\u{1eb5}ng ph\u{1edf}', 'a nang pho'),
  ('Ti\u{1ebf}ng Vi\u{1ec7}t', 'tieng viet'),
  ('\u{1c5} \u{1c6} \u{149} \u{fb01}', ''),
  ('\u{ff26}\u{ff55}\u{ff4c}\u{ff4c}\u{ff57}\u{ff49}\u{ff44}\u{ff54}\u{ff48}', ''),
  ('D-Mart #42', 'd mart 42'),
  ('rs.500/-', 'rs 500'),
  ('\u{20b9}1,299.00', '1 299 00'),
  ('a\u{300}\u{301}\u{302}b', 'ab'),
  ('a\u{338}b', 'ab'),
  ('a\u{1dc0}b', 'a b'),
  ('\u{301}', ''),
  ('x\u{340}y\u{344}z', 'xyz'),
  ('\u{3ac} \u{3ad}', ''),
  ('a\u{3ac}b', 'a b'),
  ('\u{2260} \u{226e}', ''),
  ('\u{1f355} Pizza \u{1f355}', 'pizza'),
  ('\u{1f468}\u{200d}\u{1f469}\u{200d}\u{1f467} family dinner', 'family dinner'),
  ('\u{926}\u{942}\u{927} milk', 'milk'),
  ('tab\u{9}here\u{a}newline\u{d}\u{a}', 'tab here newline'),
  ('a\u{a0}b\u{2003}c', 'a b c'),
  ('under_score', 'under score'),
  ('\u{c0}\u{c9}\u{ce}\u{d5}\u{dc} \u{e0}\u{e9}\u{ee}\u{f5}\u{fc} \u{c7} \u{e7} \u{d1} \u{f1} \u{dd} \u{ff} \u{17d} \u{17e} \u{1d7} \u{1d8} \u{1e68} \u{1e69} \u{1ef0} \u{1ef1}', 'aeiou aeiou c c n n y y z z u u s s u u'),
  ('\u{131} \u{133} \u{17f} \u{1e9b} \u{1e9e}', ''),
  ('\u{c6}sop \u{153}uvre \u{d8}l \u{fe}orn \u{f0}at', 'sop uvre l orn at'),
  ('\u{24d0} \u{b9}\u{b2}\u{b3} \u{bd} \u{2163}', ''),
  ('e\u{301}\u{85}x', 'e x'),
];

const List<(String, String, int, int)> _editDistanceParity = [
  ('', '', 99, 0),
  ('', 'abc', 99, 3),
  ('abc', '', 99, 3),
  ('uber', 'uber', 99, 0),
  ('uber', 'ubre', 99, 1),
  ('uber', 'ubr', 99, 1),
  ('uber', 'uber123', 99, 3),
  ('uber', 'uber123', 2, 3),
  ('kitten', 'sitting', 99, 3),
  ('kitten', 'sitting', 2, 3),
  ('kitten', 'sitting', 0, 1),
  ('laundry', 'luandry', 2, 1),
  ('laundry', 'laundary', 2, 1),
  ('ca', 'abc', 99, 3),
  ('abcd', 'badc', 99, 2),
  ('abcdef', 'ghijkl', 2, 3),
  ('abcdef', 'ghijkl', 99, 6),
  ('a', 'b', 0, 1),
  ('ab', 'ba', 0, 1),
  ('abc', 'abcdefgh', 3, 4),
  ('swiggy', 'swigy', 1, 1),
  ('zomato', 'zomatto', 1, 1),
  ('saturday', 'sunday', 99, 3),
  ('\u{1f355}a', '\u{1f355}b', 99, 1),
  ('abcdefghij', 'bacdfeghji', 2, 3),
];

// Default cap.
const List<(String, String, int)> _editDistanceDefaultCap = [
  ('kitten', 'sitting', 3),
  ('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '', 100),
  ('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbb', 100),
  ('flaw', 'lawn', 2),
];

const List<(String, String)> _phoneticParity = [
  ('', ''),
  ('uber', 'br'),
  ('oober', 'br'),
  ('rider', 'rdr'),
  ('rydr', 'rdr'),
  ('kirana', 'krn'),
  ('kiraana', 'krn'),
  ('hello world', 'lrld'),
  ('aeiou', ''),
  ('why', ''),
  ('bookkeeper', 'bkpr'),
  ('llama', 'lm'),
  ('ice cream', 'crm'),
  ('Uber', 'Ubr'),
  ('x1122', 'x12'),
  ('\u{1f355}\u{1f355}a\u{1f355}', '\u{1f355}'),
  ('mississippi', 'msp'),
  ('ab ba', 'b'),
  ('pp p', 'p'),
];
