import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:track_expense/core/data/sms_detection.dart';
import 'package:track_expense/core/domain/default_categories.dart';
import 'package:track_expense/core/domain/merchant_dictionary.dart';
import 'package:track_expense/core/domain/models.dart';
import 'package:track_expense/core/domain/sms_categories.dart';

Transaction _tx(String note, String category, {TransactionType type = TransactionType.expense}) =>
    Transaction(
      id: note,
      amount: 100,
      categoryId: category,
      date: DateTime(2026, 11, 1),
      type: type,
      note: note,
    );

void main() {
  test('merchantKey matches the vectors shared with Kotlin', () {
    final file = File('test/fixtures/merchant_key_vectors.json');
    final vectors = (jsonDecode(file.readAsStringSync()) as Map)['vectors'] as List;
    expect(vectors.length, greaterThanOrEqualTo(10));
    for (final v in vectors.cast<List>()) {
      expect(merchantKey(v[0] as String), v[1], reason: 'vector ${v[0]}');
    }
    expect(merchantKey(null), isNull);
  });

  group('buildCategoryTable', () {
    test('needs two entries and an 80% share to know a merchant', () {
      final t = buildCategoryTable([
        _tx('Chai Point', 'food'), // one entry only: not known
        _tx('Ramesh Stores', 'grocery'),
        _tx('Ramesh Stores · HDFC XX1234', 'grocery'), // SMS note: merchant part counts
        for (var i = 0; i < 4; i++) _tx('Croma', 'electronics'),
        _tx('Croma', 'home'), // 4 of 5 = 80%: still known
        for (var i = 0; i < 3; i++) _tx('Big Bazaar', 'grocery'),
        _tx('Big Bazaar', 'shopping'), // 3 of 5 = 60%: not known
        _tx('Big Bazaar', 'home'),
      ], defaultCategories);
      expect(t.history.containsKey('expense:chai point'), isFalse);
      expect(t.history['expense:ramesh stores'], 'grocery');
      expect(t.history['expense:croma'], 'electronics');
      expect(t.history.containsKey('expense:big bazaar'), isFalse);
    });

    test('a note naming a dictionary merchant teaches the canonical merchant', () {
      final t = buildCategoryTable([
        _tx('Swiggy dinner', 'shopping'),
        _tx('swiggy lunch', 'shopping'),
      ], defaultCategories);
      expect(t.history['expense:swiggy'], 'shopping');
    });

    test('directions are kept apart and unknown or mismatched categories are ignored', () {
      final t = buildCategoryTable([
        _tx('ACME CORP-SALARY', 'salary', type: TransactionType.income),
        _tx('Acme Corp Salary', 'salary', type: TransactionType.income),
        _tx('Ghost', 'no_such_category'),
        _tx('Ghost', 'no_such_category'),
        _tx('Odd', 'salary'), // an income category on an expense
        _tx('Odd', 'salary'),
      ], defaultCategories);
      expect(t.history['income:acme corp salary'], 'salary');
      expect(t.history.containsKey('expense:acme corp salary'), isFalse);
      expect(t.history.containsKey('expense:ghost'), isFalse);
      expect(t.history.containsKey('expense:odd'), isFalse);
    });

    test('built-in map covers dictionary merchants with categories the household has', () {
      final t = buildCategoryTable(const [], defaultCategories);
      expect(t.builtin.length, merchantDictionary.length);
      final swiggy = t.builtin.firstWhere((b) => b.key == 'swiggy');
      expect(swiggy.categoryId, 'food');
      expect(RegExp(swiggy.pattern).hasMatch('swiggy instamart'), isTrue);
      expect(t.builtin.firstWhere((b) => b.key == 'paytm').categoryId, isNull);
      expect(t.builtin.firstWhere((b) => b.key == 'prime video').categoryId, 'entertainment');
      // Every default category in the map exists among the built-in categories.
      final ids = {for (final c in defaultCategories) c.id};
      expect(builtinMerchantCategories.values.every(ids.contains), isTrue);
      // A household without that category gets no default.
      final noFood = buildCategoryTable(
          const [], defaultCategories.where((c) => c.id != 'food').toList());
      expect(noFood.builtin.firstWhere((b) => b.key == 'swiggy').categoryId, isNull);
    });

    test('toJson carries what Kotlin reads, and no amounts or whole notes', () {
      final json = buildCategoryTable([_tx('Croma', 'electronics'), _tx('Croma', 'electronics')],
              defaultCategories)
          .toJson(homeId: 'h1', userId: 'u1', userEmail: 'a@example.com', firebase: {'apiKey': 'k'});
      expect(json['homeId'], 'h1');
      expect((json['history'] as Map)['expense:croma'], 'electronics');
      final builtin = (json['builtin'] as List).cast<Map>();
      expect(builtin.first.keys, containsAll(['p', 'm']));
      expect((json['categories'] as List).first, {'id': 'salary', 'name': 'Salary', 'type': 'income'});
      // Only the fixed band edges are amounts; entry amounts (100 here) are not exported.
      expect(json['bands'], smsAmountBands);
      expect(jsonEncode({...json}..remove('bands')).contains('100'), isFalse);
      expect(json.keys, containsAll(['words', 'keywords', 'parts', 'suggest', 'top']));
      expect(json['version'], 2);
    });
  });

  test('DetectedEntry reads the queue item and builds the note', () {
    final e = DetectedEntry.fromMap({
      'id': 'r1',
      'amount': 1499.0,
      'type': 'expense',
      'merchant': 'Swiggy',
      'account': 'HDFC XX1234',
      'receivedAt': DateTime(2026, 11, 10, 20).millisecondsSinceEpoch,
      'categoryId': 'food',
      'categorySource': 'builtin',
    })!;
    expect(e.note, 'Swiggy · HDFC XX1234');
    expect(e.receivedAt, DateTime(2026, 11, 10, 20));
    expect(DetectedEntry.fromMap({'id': 'x'}), isNull);
    expect(DetectedEntry.fromMap('nope'), isNull);
    final bare = DetectedEntry.fromMap({'id': 'r2', 'receivedAt': 1, 'type': 'income'})!;
    expect(bare.note, isNull);
    expect(bare.type, TransactionType.income);
  });

  group('quick suggestions (D-030)', () {
    Transaction at(String category, double amount, int hour, {int day = 1}) => Transaction(
          id: '$category$amount$hour$day',
          amount: amount,
          categoryId: category,
          date: DateTime(2026, 11, day, hour),
          type: TransactionType.expense,
        );

    test('amount bands and day-parts', () {
      expect(smsAmountBand(50), 0);
      expect(smsAmountBand(100), 1);
      expect(smsAmountBand(299.99), 1);
      expect(smsAmountBand(2500), 3);
      expect(smsAmountBand(50000), 5);
      expect(smsDayPart(4), 3); // night wraps past midnight
      expect(smsDayPart(5), 0);
      expect(smsDayPart(12), 1);
      expect(smsDayPart(18), 2);
      expect(smsDayPart(23), 3);
    });

    test('similar amount and time of day win, then most used', () {
      final txs = [
        for (var d = 1; d <= 3; d++) at('transportation', 150, 9, day: d), // morning autos
        for (var d = 1; d <= 5; d++) at('grocery', 600, 18, day: d), // evening groceries
        at('food', 200, 20),
        at('health', 2000, 11),
      ];
      final t = buildCategoryTable(txs, defaultCategories);
      expect(t.quickSuggestions(TransactionType.expense, 140, DateTime(2026, 11, 9, 8)),
          ['transportation', 'food']);
      expect(t.quickSuggestions(TransactionType.expense, 550, DateTime(2026, 11, 9, 19)),
          ['grocery', 'food']);
      expect(t.quickSuggestions(TransactionType.expense, 550, DateTime(2026, 11, 9, 19), n: 3),
          ['grocery', 'food', 'transportation']);
      // No entries near ₹50,000: the most-used categories.
      expect(t.topCategories[TransactionType.expense]!.first, 'grocery');
      expect(t.quickSuggestions(TransactionType.expense, 50000, DateTime(2026, 11, 9, 3)),
          ['grocery', 'transportation']);
      expect(t.quickSuggestions(TransactionType.expense, null, DateTime(2026, 11, 9, 3)),
          ['grocery', 'transportation']);
    });

    test('a new household gets starter categories that exist', () {
      final t = buildCategoryTable(const [], defaultCategories);
      expect(t.topCategories[TransactionType.expense], ['food', 'grocery', 'transportation']);
      expect(t.topCategories[TransactionType.income], ['salary', 'gifts', 'business']);
      final none = buildCategoryTable(const [],
          defaultCategories.where((c) => c.id != 'food' && c.id != 'grocery').toList());
      expect(none.topCategories[TransactionType.expense], ['transportation']);
    });
  });

  group('reply words (D-030)', () {
    test('household words need two notes and an 80% share; stop words and digits are skipped', () {
      final words = buildWordCategories([
        _tx('auto to office', 'transportation'),
        _tx('Auto · Ramesh K · HDFC XX1234', 'transportation'),
        _tx('gift for amma', 'gift'),
        _tx('saree for amma', 'gift'),
        _tx('lunch with team', 'food'),
        _tx('paid 200 for the team', 'social'),
        _tx('salary', 'salary', type: TransactionType.income),
        _tx('November salary', 'salary', type: TransactionType.income),
      ], defaultCategories);
      expect(words['expense:auto'], 'transportation');
      expect(words['expense:amma'], 'gift');
      expect(words['income:salary'], 'salary');
      expect(words.containsKey('expense:team'), isFalse); // 1 food, 1 social
      expect(words.containsKey('expense:for'), isFalse); // stop word
      expect(words.keys.any((k) => k.contains('200') || k.contains('xx1234')), isFalse);
      expect(noteWords('Auto to Office 2x'), ['auto', 'office']);
    });

    test('built-in keywords are kept only for categories the household has', () {
      final t = buildCategoryTable(const [], defaultCategories);
      expect(t.keywords['lunch'], 'food');
      expect(t.keywords['auto'], 'transportation');
      final noHealth = buildCategoryTable(const [], defaultCategories.where((c) => c.id != 'health').toList());
      expect(noHealth.keywords.containsKey('medicine'), isFalse);
    });

    test('the note rule matches Kotlin', () {
      expect(smsNote(merchant: 'Ramesh K', account: 'HDFC XX1234'), 'Ramesh K · HDFC XX1234');
      expect(smsNote(words: 'auto to office', merchant: 'Ramesh K', account: 'HDFC XX1234'),
          'auto to office · Ramesh K');
      expect(smsNote(words: ' auto ', account: 'HDFC XX1234'), 'auto · HDFC XX1234');
      expect(smsNote(words: '  '), isNull);
      final e = DetectedEntry.fromMap({
        'id': 'r1',
        'type': 'expense',
        'merchant': 'UPI xxxxx3210',
        'account': 'HDFC XX1234',
        'receivedAt': 1,
        'words': 'gift for amma',
      })!;
      expect(e.note, 'gift for amma · UPI xxxxx3210');
    });
  });

  test('Nano status from the platform channel', () {
    var s = NanoState.fromWire({'status': 'aicore-update', 'code': 'AICore 0.9'});
    expect(s.status, NanoStatus.aicoreUpdate);
    expect(s.code, 'AICore 0.9');
    expect(s.status.hint, contains('Android AICore'));
    s = NanoState.fromWire({'status': 'waiting-for-wifi'});
    expect(s.status, NanoStatus.waitingForWifi);
    expect(s.code, isNull);
    expect(NanoState.fromWire('available').status, NanoStatus.available);
    expect(NanoState.fromWire('unavailable').status, NanoStatus.error);
    expect(NanoState.fromWire(null).code, 'no answer');
    for (final v in NanoStatus.values) {
      expect(v.hint, isNotEmpty);
    }
  });

  test('category suggestions: setting, AI entries and the on-device model state (D-032)', () {
    expect(CategoryAiMode.fromWire(null), CategoryAiMode.off);
    expect(CategoryAiMode.fromWire('gemma'), CategoryAiMode.gemma);
    expect(CategoryAiMode.fromWire('junk'), CategoryAiMode.off);

    final ai = DetectedEntry.fromMap({
      'id': 'r1',
      'type': 'expense',
      'receivedAt': 1,
      'merchant': 'BLUE TOKAI',
      'categoryId': 'food',
      'categorySource': 'ai',
      'aiModel': 'Gemini Flash-Lite',
    })!;
    expect(ai.isAiSuggestion, isTrue);
    expect(ai.aiModel, 'Gemini Flash-Lite');
    final nano = DetectedEntry.fromMap({'id': 'r2', 'receivedAt': 1, 'categoryId': 'food', 'categorySource': 'nano'})!;
    expect(nano.isAiSuggestion, isTrue);
    expect(nano.aiModel, 'Gemini Nano');
    expect(DetectedEntry.fromMap({'id': 'r3', 'receivedAt': 1, 'categoryId': 'food', 'categorySource': 'builtin'})!.isAiSuggestion,
        isFalse);
    expect(DetectedEntry.fromMap({'id': 'r4', 'receivedAt': 1, 'categorySource': 'ai'})!.isAiSuggestion, isFalse);

    final g = GemmaState.fromWire({'state': 'downloading', 'done': 292208640, 'total': 584417280});
    expect(g.status.busy, isTrue);
    expect(g.progress, 0.5);
    expect(g.hint, 'Downloading: 50% of 557 MB');
    expect(GemmaState.fromWire(null).status, GemmaStatus.notDownloaded);
    expect(GemmaState.fromWire({'state': 'not-available'}).hint, 'Model not available yet');
    expect(GemmaState.fromWire({'state': 'ready', 'total': 584417280}).status.busy, isFalse);
    for (final v in GemmaStatus.values) {
      expect(GemmaState(v, total: 1).hint, isNotEmpty);
    }
  });
}
