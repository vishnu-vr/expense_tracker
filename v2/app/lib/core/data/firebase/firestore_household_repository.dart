import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart' hide Transaction;

import '../../domain/models.dart';
import '../repositories.dart';
import 'mappers.dart';

/// Emits the latest inner stream for each outer event.
Stream<R> switchMap<T, R>(Stream<T> source, Stream<R> Function(T) mapper) {
  return Stream.multi((controller) {
    StreamSubscription<R>? inner;
    final outer = source.listen(
      (value) {
        inner?.cancel();
        inner = mapper(value).listen(controller.add, onError: controller.addError);
      },
      onError: controller.addError,
      onDone: controller.close,
    );
    controller.onCancel = () async {
      await inner?.cancel();
      await outer.cancel();
    };
  });
}

/// Household data in Firestore (schema v2).
class FirestoreHouseholdRepository implements HouseholdRepository {
  FirestoreHouseholdRepository({
    required FirebaseFirestore firestore,
    required this.currentUserId,
    required this.homeId,
    this.currentUserEmail,
  }) : _db = firestore;

  final FirebaseFirestore _db;
  final String homeId;
  final String? currentUserEmail;

  @override
  final String currentUserId;

  DocumentReference<Map<String, dynamic>> get _home => _db.collection('homes').doc(homeId);
  CollectionReference<Map<String, dynamic>> get _transactions => _db.collection('transactions');

  @override
  Stream<Home?> watchHome() =>
      _home.snapshots().map((s) => s.exists ? homeFromDoc(s.id, s.data()!) : null);

  // Filtering on homeId is what lets the security rules allow this query.
  @override
  Stream<List<Member>> watchMembers() => _db
      .collection('users')
      .where('homeId', isEqualTo: homeId)
      .snapshots()
      .map((s) => [for (final d in s.docs) memberFromDoc(d.id, d.data())]);

  @override
  Stream<List<Transaction>> watchTransactions() =>
      _transactions.where('homeId', isEqualTo: homeId).snapshots().map((s) => [
            for (final d in s.docs)
              ?transactionFromDoc(d.id, d.data()),
          ]);

  @override
  Stream<List<Category>> watchCustomCategories() => _home
      .collection('categories')
      .snapshots()
      .map((s) => [for (final d in s.docs) categoryFromDoc(d.id, d.data())]);

  @override
  Stream<List<CategoryBudget>> watchBudgets() =>
      _home.collection('categoryBudgets').snapshots().map((s) => [
            for (final d in s.docs)
              ?budgetFromDoc(d.id, d.data()),
          ]);

  @override
  Stream<List<Tag>> watchTags() => _home.collection('tags').snapshots().map((s) =>
      [for (final d in s.docs) tagFromDoc(d.id, d.data())]
        ..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase())));

  @override
  Stream<List<HouseholdNotification>> watchNotifications() => _db
      .collection('notifications')
      .where('homeId', isEqualTo: homeId)
      .orderBy('createdAt', descending: true)
      .limit(50)
      .snapshots()
      .map((s) => [
            for (final d in s.docs)
              ?notificationFromDoc(d.id, d.data()),
          ]);

  @override
  Future<void> markNotificationsRead(List<String> ids) async {
    if (ids.isEmpty) return;
    final batch = _db.batch();
    for (final id in ids) {
      batch.update(_db.collection('notifications').doc(id), {
        'readBy': FieldValue.arrayUnion([currentUserId]),
      });
    }
    await batch.commit();
  }

  @override
  Stream<List<InsightCard>> watchInsights() => _home
      .collection('insights')
      .orderBy('createdAt', descending: true)
      .limit(20)
      .snapshots()
      .map((s) => [
            for (final d in s.docs) ?insightFromDoc(d.id, d.data(), currentUserId),
          ]);

  @override
  Future<void> dismissInsight(String id) async =>
      unawaited(_home.collection('insights').doc(id).update({
        'dismissedBy': FieldValue.arrayUnion([currentUserId]),
      }));

  // Writes are queued locally and synced by Firestore, so they are not
  // awaited to completion: offline saves must not hang the UI.
  @override
  Future<String> saveTransaction(Transaction tx) async {
    final data = transactionToDoc(tx);
    if (tx.id.isEmpty) {
      final ref = _transactions.doc();
      unawaited(ref.set({
        ...data,
        'userId': currentUserId,
        'userEmail': currentUserEmail,
        'homeId': homeId,
        'createdAt': FieldValue.serverTimestamp(),
        'updatedAt': FieldValue.serverTimestamp(),
      }));
      return ref.id;
    }
    unawaited(_transactions.doc(tx.id).update({
      ...data,
      'updatedAt': FieldValue.serverTimestamp(),
    }));
    return tx.id;
  }

  @override
  Future<void> deleteTransaction(String id) async => unawaited(_transactions.doc(id).delete());

  @override
  Future<void> saveCategory(Category category) async => unawaited(
      _home.collection('categories').doc(category.id).set(categoryToDoc(category)));

  @override
  Future<void> deleteCategory(String id) async =>
      unawaited(_home.collection('categories').doc(id).delete());

  @override
  Future<String> saveTag(Tag tag) async {
    final tags = _home.collection('tags');
    final ref = tag.id.isEmpty ? tags.doc() : tags.doc(tag.id);
    unawaited(ref.set({
      'name': tag.name,
      'color': tag.color,
      'note': tag.note,
      'createdBy': tag.createdBy ?? currentUserId,
      'createdAt': tag.createdAt == null
          ? FieldValue.serverTimestamp()
          : Timestamp.fromDate(tag.createdAt!),
    }));
    return ref.id;
  }

  @override
  Future<void> deleteTag(String id) async => unawaited(_home.collection('tags').doc(id).delete());

  @override
  Future<void> setBudget(String categoryId, double amount) async {
    final ref = _home.collection('categoryBudgets').doc(categoryId);
    unawaited(amount > 0
        ? ref.set({
            'categoryId': categoryId,
            'amount': amount,
            'updatedAt': FieldValue.serverTimestamp(),
          })
        : ref.delete());
  }
}
