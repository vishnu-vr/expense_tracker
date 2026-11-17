import 'package:flutter_test/flutter_test.dart';
import 'package:track_expense/core/domain/auto_added.dart';
import 'package:track_expense/core/domain/models.dart';

void main() {
  final now = DateTime(2026, 11, 17, 21);
  Transaction tx(String id, DateTime date, {String user = 'u1', bool auto = true}) => Transaction(
        id: id,
        amount: 100,
        categoryId: 'food',
        date: date,
        type: TransactionType.expense,
        userId: user,
        source: 'sms',
        autoAdded: auto,
      );

  test('only my unchecked auto-added entries, newest first', () {
    final txs = [
      tx('old', DateTime(2026, 11, 1)),
      tx('new', DateTime(2026, 11, 16)),
      tx('checked', DateTime(2026, 11, 15), auto: false),
      tx('theirs', DateTime(2026, 11, 15), user: 'u2'),
    ];
    expect(autoAddedToCheck(txs, 'u1').map((t) => t.id), ['new', 'old']);
  });

  test('Home counts the last 30 days', () {
    final txs = [
      tx('in', now.subtract(const Duration(days: 29))),
      tx('edge', now.subtract(const Duration(days: 30))),
      tx('out', now.subtract(const Duration(days: 31))),
    ];
    expect(autoAddedToCheck(txs, 'u1', now: now).map((t) => t.id), ['in', 'edge']);
  });

  test('label has a singular form', () {
    expect(autoAddedToCheckLabel(1), '1 auto-added entry to check');
    expect(autoAddedToCheckLabel(5), '5 auto-added entries to check');
  });
}
