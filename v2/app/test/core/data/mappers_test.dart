import 'package:cloud_firestore/cloud_firestore.dart' show Timestamp;
import 'package:flutter_test/flutter_test.dart';
import 'package:track_expense/core/data/agent.dart';
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

  test('AI thread summaries carry usage and preview; need a timestamp', () {
    final t = threadSummaryFromDoc('th1', {
      'title': 'Why was October high?',
      'createdBy': 'u1',
      'createdAt': Timestamp.fromDate(DateTime(2026, 11, 1, 9)),
      'updatedAt': Timestamp.fromDate(DateTime(2026, 11, 2, 9)),
      'lastMessagePreview': 'Groceries were up.',
      'lastModel': 'vertexai/gemini-3.8-flash',
      'usage': {'questions': 6, 'inputTokens': 47000, 'outputTokens': 1200, 'modelCalls': 14},
    })!;
    expect(t.updatedAt, DateTime(2026, 11, 2, 9));
    expect(t.lastMessagePreview, 'Groceries were up.');
    expect(t.usage.questions, 6);
    expect(t.usage.tokens, 48200);
    expect(t.usage.modelCalls, 14);
    expect(t.lastModel, 'vertexai/gemini-3.8-flash');

    // Older threads have no usage or preview yet.
    final old = threadSummaryFromDoc('th0', {'title': '', 'createdAt': Timestamp.fromDate(DateTime(2026, 10, 1))})!;
    expect(old.title, 'Conversation');
    expect(old.updatedAt, DateTime(2026, 10, 1));
    expect(old.usage.questions, 0);
    expect(old.lastMessagePreview, '');
    expect(agentUsageFrom({'questions': -2, 'inputTokens': 'x', 'outputTokens': 3.6}).outputTokens, 4);
    expect(agentUsageFrom({'questions': -2}).questions, 0);
    expect(threadSummaryFromDoc('x', {'title': 'pending'}), isNull);
  });

  test('stored messages reuse the block parser and drop unusable docs', () {
    final m = storedMessageFromDoc({
      'role': 'assistant',
      'blocks': [
        {'type': 'stat', 'label': 'Spent', 'value': '₹1,000'},
        {'type': 'hologram'},
        {'type': 'proposal', 'proposalId': 'p1', 'action': 'set_budget', 'summary': 'Set it'},
      ],
      'usage': {'inputTokens': 10, 'outputTokens': 5, 'modelCalls': 1, 'model': 'm', 'latencyMs': 900},
      'createdAt': Timestamp.fromDate(DateTime(2026, 11, 1)),
    })!;
    expect(m.fromUser, isFalse);
    expect(m.blocks.map((b) => b.runtimeType), [StatBlock, ProposalBlock]);
    expect(storedMessageFromDoc({'role': 'user', 'blocks': [{'type': 'text', 'text': 'hi'}]})!.fromUser, isTrue);
    expect(storedMessageFromDoc({'role': 'assistant', 'blocks': 'nope'}), isNull);
    expect(proposalStatusFrom('applied'), ProposalStatus.applied);
    expect(proposalStatusFrom('rejected'), ProposalStatus.rejected);
    expect(proposalStatusFrom('pending'), ProposalStatus.pending);
    expect(proposalStatusFrom(null), ProposalStatus.pending);
  });

  test('switchMap follows only the latest inner stream', () async {
    final out = await switchMap<int, String>(
      Stream.fromIterable([1, 2]),
      (i) => Stream.value('v$i'),
    ).toList();
    expect(out.last, 'v2');
  });
}
