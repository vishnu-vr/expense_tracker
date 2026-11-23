import 'package:cloud_firestore/cloud_firestore.dart' show Timestamp;
import 'package:flutter_test/flutter_test.dart';
import 'package:track_expense/core/data/agent.dart';
import 'package:track_expense/core/data/firebase/firestore_household_repository.dart';
import 'package:track_expense/core/data/firebase/mappers.dart';
import 'package:track_expense/core/domain/models.dart';
import 'package:track_expense/core/data/firebase/firebase_reports_repository.dart';
import 'package:track_expense/core/domain/report.dart';

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

  test('source "sms" round trips; other values and typed entries have none', () {
    final tx = Transaction(
      id: '',
      amount: 1499,
      categoryId: 'food',
      date: DateTime(2026, 11, 10, 20, 15),
      type: TransactionType.expense,
      note: 'Swiggy · HDFC XX1234',
      source: 'sms',
    );
    final doc = transactionToDoc(tx);
    expect(doc['source'], 'sms');
    expect(transactionFromDoc('t', doc)!.fromSms, isTrue);
    // Without a source the key is left out, so an update keeps the stored marker.
    final typed = Transaction(
        id: 't', amount: 1, categoryId: 'food', date: tx.date, type: TransactionType.expense);
    expect(transactionToDoc(typed).containsKey('source'), isFalse);
    expect(transactionFromDoc('t', {...doc, 'source': 'other'})!.source, isNull);
  });

  test('autoAdded round trips; written only when true, anything else reads false (D-031)', () {
    final tx = Transaction(
      id: '',
      amount: 1499,
      categoryId: 'shopping',
      date: DateTime(2026, 11, 9, 18),
      type: TransactionType.expense,
      source: 'sms',
      autoAdded: true,
    );
    final doc = transactionToDoc(tx);
    expect(doc['autoAdded'], isTrue);
    final back = transactionFromDoc('t', doc)!;
    expect(back.autoAdded, isTrue);
    expect(back.fromSms, isTrue);
    final checked = transactionToDoc(back.copyWith(autoAdded: false));
    expect(checked.containsKey('autoAdded'), isFalse);
    expect(transactionFromDoc('t', {...doc, 'autoAdded': 'yes'})!.autoAdded, isFalse);
    expect(transactionFromDoc('t', {...doc}..remove('autoAdded'))!.autoAdded, isFalse);
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

  group('reports (D-033)', () {
    test('a report document with Timestamps', () {
      final r = reportFromDoc('monthly_2026-10', {
        'kind': 'monthly',
        'period': {'from': '2026-10-01', 'to': '2026-10-31', 'label': 'October 2026', 'days': 31},
        'compare': {'mode': 'previous', 'label': 'September 2026', 'from': '2026-09-01', 'to': '2026-09-30'},
        'narrative': {'headline': 'h', 'summary': 's', 'changes': [], 'suggestions': []},
        'narrativeSource': 'model',
        'modelLabel': 'Gemini Flash-Lite',
        'createdAt': Timestamp.fromDate(DateTime(2026, 11, 1, 7)),
        'generatedAt': Timestamp.fromDate(DateTime(2026, 11, 3, 9)),
        'sections': {'headline': {'metrics': []}},
      })!;
      expect(r.summary.generatedAt, DateTime(2026, 11, 3, 9));
      expect(r.summary.compareLabel, 'September 2026');
      expect(r.writtenBy, 'Written by Gemini Flash-Lite');
      expect(reportFromDoc('bad', {'period': {'from': '2026-10-01', 'to': '2026-10-31'}}), isNull);
    });

    test('report_ready notifications and month review cards carry the report id', () {
      final n = notificationFromDoc('n1', {
        'type': 'report_ready', 'message': 'Your October 2026 report is ready.', 'reportId': 'monthly_2026-10',
        'recipientId': 'u2', 'homeId': 'h1', 'createdBy': 'system', 'createdAt': Timestamp.fromDate(DateTime(2026, 11, 1, 7)),
      })!;
      expect(n.type, HouseholdNotificationType.reportReady);
      expect(n.reportId, 'monthly_2026-10');
      expect(n.isFor('u2'), isTrue);
      expect(n.isFor('u1'), isFalse);
      final tx = notificationFromDoc('n2', {'type': 'transaction_added', 'createdAt': Timestamp.now()})!;
      expect(tx.isFor('anyone'), isTrue);
      expect(tx.reportId, isNull);

      final card = insightFromDoc('month_review_2026-10', {
        'kind': 'month_review', 'title': 'October 2026 in review', 'body': 'b',
        'data': {'month': '2026-10', 'reportId': 'monthly_2026-10'}, 'createdAt': Timestamp.now(),
      }, 'u1')!;
      expect(card.reportId, 'monthly_2026-10');
      expect(insightFromDoc('i', {'title': 't', 'data': {'month': '2026-10'}, 'createdAt': Timestamp.now()}, 'u1')!.reportId, isNull);
    });

    test('generateReport request body', () {
      final oct = DayRange(DateTime(2026, 10, 1), DateTime(2026, 10, 31));
      expect(
        FirebaseReportsRepository.generatePayload(period: oct, compare: CompareMode.lastYear, timeZone: 'Asia/Kolkata', model: 'flash-lite'),
        {'from': '2026-10-01', 'to': '2026-10-31', 'compare': {'mode': 'last_year'}, 'timeZone': 'Asia/Kolkata', 'model': 'flash-lite'},
      );
      expect(
        FirebaseReportsRepository.generatePayload(
          period: oct,
          compare: CompareMode.custom,
          customCompare: DayRange(DateTime(2026, 8, 1), DateTime(2026, 8, 15)),
          timeZone: 'Asia/Kolkata',
        ),
        {'from': '2026-10-01', 'to': '2026-10-31', 'compare': {'mode': 'custom', 'from': '2026-08-01', 'to': '2026-08-15'}, 'timeZone': 'Asia/Kolkata'},
      );
    });
  });
}
