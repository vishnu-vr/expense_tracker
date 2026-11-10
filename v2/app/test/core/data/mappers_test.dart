import 'package:cloud_firestore/cloud_firestore.dart' show Timestamp;
import 'package:flutter_test/flutter_test.dart';
import 'package:track_expense/core/data/firebase/firestore_household_repository.dart';
import 'package:track_expense/core/data/firebase/mappers.dart';
import 'package:track_expense/core/domain/models.dart';

void main() {
  test('transaction round trip uses a Timestamp and trims the note', () {
    final tx = Transaction(
      id: '',
      amount: 480,
      categoryId: 'food',
      date: DateTime(2026, 11, 10, 20, 15),
      type: TransactionType.expense,
      note: '  Swiggy dinner ',
      tagIds: const ['goa'],
    );
    final doc = transactionToDoc(tx);
    expect(doc['date'], isA<Timestamp>());
    expect(doc['note'], 'Swiggy dinner');
    expect(doc.containsKey('userId'), isFalse);

    final back = transactionFromDoc('t1', {...doc, 'userId': 'u1', 'homeId': 'h1'})!;
    expect(back.id, 't1');
    expect(back.amount, 480);
    expect(back.date, DateTime(2026, 11, 10, 20, 15));
    expect(back.tagIds, ['goa']);
    expect(back.userId, 'u1');
  });

  test('reads v1 ISO-string dates and rejects broken documents', () {
    final t = transactionFromDoc('a', {
      'amount': 12.5,
      'categoryId': 'food',
      'date': '2026-03-01T10:00:00.000Z',
      'type': 'income',
    })!;
    expect(t.type, TransactionType.income);
    expect(t.date.toUtc(), DateTime.utc(2026, 3, 1, 10));
    expect(transactionFromDoc('b', {'amount': 'x', 'date': '2026-03-01'}), isNull);
    expect(transactionFromDoc('c', {'amount': 5}), isNull);
  });

  test('budgets ignore legacy per-month documents and zero amounts', () {
    expect(budgetFromDoc('food', {'amount': 12000})!.categoryId, 'food');
    expect(budgetFromDoc('food', {'amount': 12000, 'year': 2025, 'month': 3}), isNull);
    expect(budgetFromDoc('food', {'amount': 0}), isNull);
  });

  test('notifications map types and need a timestamp', () {
    final n = notificationFromDoc('n', {
      'type': 'transaction_deleted',
      'message': 'Rohan deleted an entry',
      'createdBy': 'u2',
      'createdAt': Timestamp.fromDate(DateTime(2026, 11, 1)),
      'readBy': ['u1', 3],
    })!;
    expect(n.type, HouseholdNotificationType.transactionDeleted);
    expect(n.readBy, ['u1']);
    expect(notificationFromDoc('n', {'type': 'x'}), isNull);
  });

  test('switchMap follows only the latest inner stream', () async {
    final out = await switchMap<int, String>(
      Stream.fromIterable([1, 2]),
      (i) => Stream.value('v$i'),
    ).toList();
    expect(out.last, 'v2');
  });
}
