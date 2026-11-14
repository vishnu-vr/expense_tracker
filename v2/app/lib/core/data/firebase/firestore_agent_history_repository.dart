import 'package:cloud_firestore/cloud_firestore.dart';

import '../agent.dart';
import 'mappers.dart';

/// The signed-in user's past assistant conversations in Firestore. Threads
/// are personal (D-025): the rules only allow reading your own, so the list
/// query must filter on `createdBy`.
class FirestoreAgentHistoryRepository implements AgentHistoryRepository {
  FirestoreAgentHistoryRepository({
    required FirebaseFirestore firestore,
    required this.homeId,
    required this.currentUserId,
  }) : _db = firestore;

  final FirebaseFirestore _db;
  final String homeId;
  final String currentUserId;

  CollectionReference<Map<String, dynamic>> get _threads =>
      _db.collection('homes').doc(homeId).collection('aiThreads');

  // Composite index: aiThreads (createdBy ASC, updatedAt DESC).
  @override
  Stream<List<AgentThreadSummary>> watchThreads() => _threads
      .where('createdBy', isEqualTo: currentUserId)
      .orderBy('updatedAt', descending: true)
      .limit(50)
      .snapshots()
      .map((s) => [for (final d in s.docs) ?threadSummaryFromDoc(d.id, d.data())]);

  @override
  Future<AgentThread?> loadThread(String threadId) async {
    final ref = _threads.doc(threadId);
    final DocumentSnapshot<Map<String, dynamic>> doc;
    try {
      doc = await ref.get();
    } on FirebaseException catch (e) {
      // Someone else's thread reads as permission-denied: treat it as missing.
      if (e.code == 'permission-denied') return null;
      rethrow;
    }
    final data = doc.data();
    if (data == null || data['createdBy'] != currentUserId) return null;
    final summary = threadSummaryFromDoc(doc.id, data);
    if (summary == null) return null;
    final results = await Future.wait([
      ref.collection('messages').orderBy('createdAt').get(),
      ref.collection('proposals').get(),
    ]);
    return AgentThread(
      summary: summary,
      messages: [for (final m in results[0].docs) ?storedMessageFromDoc(m.data())],
      proposalStatus: {
        for (final p in results[1].docs) p.id: proposalStatusFrom(p.data()['status']),
      },
    );
  }
}
