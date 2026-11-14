import 'package:cloud_firestore/cloud_firestore.dart' hide Transaction;
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:track_expense/core/data/firebase/firestore_household_repository.dart';
import 'package:track_expense/core/domain/models.dart';

/// Lets queued (un-awaited) Firestore writes land before reading back.
Future<void> settle() => Future<void>.delayed(Duration.zero);

void main() {
  late FakeFirebaseFirestore db;
  late FirestoreHouseholdRepository repo;

  setUp(() async {
    db = FakeFirebaseFirestore();
    await db.collection('homes').doc('h1').set({
      'name': 'Sharma household',
      'displayId': 'ABC234',
      'ownerId': 'u1',
      'memberIds': ['u1', 'u2'],
    });
    await db.collection('users').doc('u1').set({'name': 'Asha', 'email': 'a@x.in', 'homeId': 'h1'});
    await db.collection('users').doc('u2').set({'name': '', 'email': 'rohan@x.in', 'homeId': 'h1'});
    await db.collection('users').doc('u3').set({'name': 'Stranger', 'homeId': 'other'});
    repo = FirestoreHouseholdRepository(
      firestore: db,
      currentUserId: 'u1',
      currentUserEmail: 'a@x.in',
      homeId: 'h1',
    );
  });

  test('home and members are scoped to the household', () async {
    final home = await repo.watchHome().first;
    expect(home!.displayId, 'ABC234');
    final members = await repo.watchMembers().first;
    expect(members.map((m) => m.id), unorderedEquals(['u1', 'u2']));
  });

  test('new entries get ownership fields, a Timestamp date and no accountId', () async {
    final id = await repo.saveTransaction(Transaction(
      id: '',
      amount: 480,
      categoryId: 'food',
      date: DateTime(2026, 11, 10, 20),
      type: TransactionType.expense,
      note: ' Swiggy ',
    ));
    await settle();
    final data = (await db.collection('transactions').doc(id).get()).data()!;
    expect(data['userId'], 'u1');
    expect(data['userEmail'], 'a@x.in');
    expect(data['homeId'], 'h1');
    expect(data['date'], isA<Timestamp>());
    expect(data['note'], 'Swiggy');
    expect(data['tagIds'], isEmpty);
    expect(data.containsKey('accountId'), isFalse);
    expect(data.containsKey('createdAt'), isTrue);
  });

  test('only this household\'s entries are listed; updates keep the owner', () async {
    await db.collection('transactions').doc('mine').set({
      'amount': 100, 'categoryId': 'food', 'type': 'expense', 'userId': 'u1', 'homeId': 'h1',
      'tagIds': <String>[], 'date': Timestamp.fromDate(DateTime(2026, 11, 1)),
    });
    await db.collection('transactions').doc('theirs').set({
      'amount': 999, 'categoryId': 'food', 'type': 'expense', 'userId': 'u3', 'homeId': 'other',
      'tagIds': <String>[], 'date': Timestamp.fromDate(DateTime(2026, 11, 1)),
    });
    final txs = await repo.watchTransactions().first;
    expect(txs.map((t) => t.id), ['mine']);

    await repo.saveTransaction(txs.single.copyWith(amount: 150));
    await settle();
    final data = (await db.collection('transactions').doc('mine').get()).data()!;
    expect(data['amount'], 150);
    expect(data['userId'], 'u1');
  });

  test('budgets: zero removes, legacy per-month docs are ignored', () async {
    await repo.setBudget('food', 12000);
    await db.collection('homes/h1/categoryBudgets').doc('old').set({'amount': 5, 'year': 2025, 'month': 1});
    await settle();
    expect((await repo.watchBudgets().first).map((b) => b.categoryId), ['food']);

    await repo.setBudget('food', 0);
    await settle();
    expect(await repo.watchBudgets().first, isEmpty);
  });

  test('categories and tags round trip under the home', () async {
    await repo.saveCategory(const Category(
        id: 'pets', name: 'Pets', icon: 'pets', color: '#0B6E4F', type: TransactionType.expense));
    final tagId = await repo.saveTag(const Tag(id: '', name: 'Goa trip', color: '#1D4ED8'));
    await settle();
    expect((await repo.watchCustomCategories().first).single.name, 'Pets');
    final tag = (await repo.watchTags().first).single;
    expect(tag.id, tagId);
    expect(tag.createdBy, 'u1');

    await repo.deleteTag(tagId);
    await repo.deleteCategory('pets');
    await settle();
    expect(await repo.watchTags().first, isEmpty);
    expect(await repo.watchCustomCategories().first, isEmpty);
  });

  test('notifications: newest first, mark read adds only my uid', () async {
    for (final (id, at) in [('n1', DateTime(2026, 11, 1)), ('n2', DateTime(2026, 11, 2))]) {
      await db.collection('notifications').doc(id).set({
        'type': 'transaction_added', 'message': 'Rohan added ₹1', 'createdBy': 'u2',
        'homeId': 'h1', 'createdAt': Timestamp.fromDate(at), 'readBy': <String>[],
      });
    }
    final list = await repo.watchNotifications().first;
    expect(list.map((n) => n.id), ['n2', 'n1']);

    await repo.markNotificationsRead(['n1']);
    expect((await db.collection('notifications').doc('n1').get()).data()!['readBy'], ['u1']);
  });

  test('insights hide cards I dismissed', () async {
    await db.collection('homes/h1/insights').doc('i1').set({
      'kind': 'bill_missing', 'title': 'Electricity not logged', 'body': '',
      'createdAt': Timestamp.fromDate(DateTime(2026, 11, 3)), 'dismissedBy': <String>[],
    });
    expect((await repo.watchInsights().first).single.id, 'i1');
    await repo.dismissInsight('i1');
    await settle();
    expect(await repo.watchInsights().first, isEmpty);
  });
}
