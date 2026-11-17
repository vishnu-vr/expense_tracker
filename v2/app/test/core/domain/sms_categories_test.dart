import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
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

    test('toJson carries what Kotlin reads, and nothing about amounts or notes', () {
      final json = buildCategoryTable([_tx('Croma', 'electronics'), _tx('Croma', 'electronics')],
              defaultCategories)
          .toJson(homeId: 'h1', userId: 'u1', userEmail: 'a@example.com', firebase: {'apiKey': 'k'});
      expect(json['homeId'], 'h1');
      expect((json['history'] as Map)['expense:croma'], 'electronics');
      final builtin = (json['builtin'] as List).cast<Map>();
      expect(builtin.first.keys, containsAll(['p', 'm']));
      expect((json['categories'] as List).first, {'id': 'salary', 'name': 'Salary', 'type': 'income'});
      expect(jsonEncode(json).contains('100'), isFalse);
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
}
