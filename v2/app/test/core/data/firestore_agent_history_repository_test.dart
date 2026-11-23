import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:track_expense/core/data/agent.dart';
import 'package:track_expense/core/data/firebase/firestore_agent_history_repository.dart';

void main() {
  late FakeFirebaseFirestore db;
  late FirestoreAgentHistoryRepository repo;
  Timestamp at(int day) => Timestamp.fromDate(DateTime(2026, 11, day, 9));

  setUp(() async {
    db = FakeFirebaseFirestore();
    final threads = db.collection('homes').doc('h1').collection('aiThreads');
    await threads.doc('old').set({'title': 'Old', 'createdBy': 'u1', 'createdAt': at(1), 'updatedAt': at(2)});
    await threads.doc('new').set({
      'title': 'New',
      'createdBy': 'u1',
      'createdAt': at(3),
      'updatedAt': at(8),
      'lastMessagePreview': 'Groceries were up.',
      'usage': {'questions': 2, 'inputTokens': 1000, 'outputTokens': 50, 'modelCalls': 3},
    });
    await threads.doc('rohans').set({'title': 'Rohan', 'createdBy': 'u2', 'createdAt': at(9), 'updatedAt': at(9)});
    final msgs = threads.doc('new').collection('messages');
    await msgs.doc('m2').set({
      'role': 'assistant',
      'blocks': [
        {'type': 'text', 'text': 'Groceries were up.'},
        {'type': 'proposal', 'proposalId': 'p1', 'action': 'set_budget', 'summary': 'Set it'},
        {'type': 'proposal', 'proposalId': 'p2', 'action': 'set_budget', 'summary': 'Set that'},
      ],
      'createdAt': at(4),
    });
    await msgs.doc('m1').set({'role': 'user', 'blocks': [{'type': 'text', 'text': 'Why?'}], 'createdAt': at(3)});
    await threads.doc('new').collection('proposals').doc('p1').set({'status': 'applied', 'createdBy': 'u1'});
    await threads.doc('new').collection('proposals').doc('p2').set({'status': 'pending', 'createdBy': 'u1'});
    repo = FirestoreAgentHistoryRepository(firestore: db, homeId: 'h1', currentUserId: 'u1');
  });

  test('lists only my threads, most recently updated first', () async {
    final list = await repo.watchThreads().first;
    expect(list.map((t) => t.id), ['new', 'old']);
    expect(list.first.usage.questions, 2);
    expect(list.first.lastMessagePreview, 'Groceries were up.');
  });

  test('loads a thread with messages in order and proposal statuses', () async {
    final t = (await repo.loadThread('new'))!;
    expect(t.summary.title, 'New');
    expect(t.messages.map((m) => m.fromUser), [true, false]);
    expect((t.messages.first.blocks.single as TextBlock).text, 'Why?');
    expect(t.proposalStatus, {'p1': ProposalStatus.applied, 'p2': ProposalStatus.pending});
  });

  test("someone else's or a missing thread is null", () async {
    expect(await repo.loadThread('rohans'), isNull);
    expect(await repo.loadThread('nope'), isNull);
  });
}
