import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:track_expense/app/providers.dart';
import 'package:track_expense/main.dart';
import 'package:track_expense/core/data/agent.dart';

import '../support/harness.dart';

class _SilentAgent implements AgentRepository {
  @override
  Stream<AgentEvent> ask({String? threadId, required String message}) async* {
    yield const AgentStatus('Thinking…');
  }

  @override
  Future<void> resolveProposal(
      {required String threadId, required String proposalId, required bool accept}) async {}
}

void main() {
  setUpAll(loadAppFonts);

  testWidgets('ask: a reply that never arrives shows an error, not silence', (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    SharedPreferences.setMockInitialValues({});
    final sp = await SharedPreferences.getInstance();
    await tester.pumpWidget(ProviderScope(
      overrides: [
        nowProvider.overrideWithValue(testNow),
        sharedPreferencesProvider.overrideWithValue(sp),
        agentRepositoryProvider.overrideWithValue(_SilentAgent()),
      ],
      child: const TrackExpenseApp(),
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Ask why'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Something went wrong while answering'), findsOneWidget);
  });

  testWidgets('ask: question, structured answer, and confirming a proposal', (tester) async {
    await pumpApp(tester);
    await tester.tap(find.text('Insights').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Ask'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Ask anything'), findsOneWidget);

    await tester.tap(find.text('Where can we cut back?'));
    await tester.pump();
    expect(find.text('Where can we cut back?'), findsOneWidget);
    await tester.pumpAndSettle();

    expect(find.text('OCTOBER VS SEPTEMBER'), findsOneWidget);
    expect(find.text('Biggest increases'), findsOneWidget);
    expect(find.text('SUGGESTED CHANGE'), findsOneWidget);
    await shot(tester, 'ask');

    await tapVisible(tester, find.text('Confirm'));
    expect(find.text('Done'), findsOneWidget);
    expect(find.text('Confirm'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  test('blocks parse from the backend shape and skip unknown ones', () {
    final blocks = [
      {'type': 'text', 'text': 'Hi'},
      {'type': 'stat', 'label': 'Spent', 'value': '₹1,000'},
      {
        'type': 'bars',
        'items': [
          {'label': 'Food', 'value': 4900, 'display': '+₹4,900'}
        ]
      },
      {
        'type': 'transactions',
        'items': [
          {
            'id': 't1',
            'note': 'Swiggy',
            'categoryName': 'Food',
            'amount': 480,
            'type': 'expense',
            'date': '2026-11-10T14:30:00.000Z'
          }
        ]
      },
      {'type': 'proposal', 'proposalId': 'p1', 'action': 'set_budget', 'summary': 'Set it'},
      {'type': 'hologram'},
      {'type': 'stat'},
    ].map(AgentBlock.fromJson).whereType<AgentBlock>().toList();

    expect(blocks, hasLength(5));
    expect((blocks[2] as BarsBlock).items.single.value, 4900);
    expect((blocks[3] as TransactionsBlock).items.single.isIncome, isFalse);
  });
}
