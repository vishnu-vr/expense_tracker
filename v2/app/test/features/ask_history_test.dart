import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:track_expense/app/providers.dart';
import 'package:track_expense/app/router.dart';
import 'package:track_expense/core/data/agent.dart';

import '../support/harness.dart';

/// Records which thread each question continues.
class _RecordingAgent implements AgentRepository {
  final asked = <({String? threadId, String message})>[];

  @override
  Stream<AgentEvent> ask({String? threadId, required String message}) async* {
    asked.add((threadId: threadId, message: message));
    yield AgentDone(
      threadId: threadId ?? 'new-thread',
      blocks: const [TextBlock('Follow-up answer from the same thread.')],
    );
  }

  @override
  Future<void> resolveProposal(
      {required String threadId, required String proposalId, required bool accept}) async {}
}

GoRouter _router(WidgetTester tester) =>
    ProviderScope.containerOf(tester.element(find.byType(MaterialApp))).read(routerProvider);

Future<void> _openAsk(WidgetTester tester) async {
  _router(tester).push('/ask');
  await tester.pumpAndSettle();
}

Future<void> _openHistory(WidgetTester tester) async {
  await _openAsk(tester);
  await tester.tap(find.byTooltip('Past conversations'));
  await tester.pumpAndSettle();
}

/// Scrolls the first scrollable top to bottom, failing on any layout exception.
Future<void> _scrollThrough(WidgetTester tester) async {
  for (var i = 0; i < 8; i++) {
    await tester.drag(find.byType(Scrollable).first, const Offset(0, -300));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  }
}

void main() {
  setUpAll(loadAppFonts);

  testWidgets('history lists my threads newest first with preview and usage', (tester) async {
    await pumpApp(tester);
    await _openHistory(tester);

    expect(find.text('Past conversations'), findsOneWidget);
    expect(find.text('Only you can see your conversations.'), findsOneWidget);
    final dining = find.text('Why was October dining so high?');
    final bills = find.text('Which bills went up this year?');
    expect(dining, findsOneWidget);
    expect(bills, findsOneWidget);
    expect(tester.getTopLeft(dining).dy, lessThan(tester.getTopLeft(bills).dy));
    expect(find.text('Swiggy and Zomato orders made up most of the rise in October.'), findsOneWidget);
    expect(find.text('Yesterday · 2\u00a0questions · 14k\u00a0tokens'), findsOneWidget);
    expect(find.text('4 Nov · 1\u00a0question · 7k\u00a0tokens'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('opening a past thread renders stored blocks and continues the thread', (tester) async {
    final agent = _RecordingAgent();
    await pumpApp(tester, overrides: [agentRepositoryProvider.overrideWithValue(agent)]);
    await _openHistory(tester);
    await tester.tap(find.text('Why was October dining so high?'));
    await tester.pumpAndSettle();

    // Back on Ask with the stored conversation as native blocks.
    expect(find.text('Ask'), findsOneWidget);
    expect(find.text('This conversation · 2\u00a0questions · 14k\u00a0tokens'), findsOneWidget);
    expect(find.text('Why was October dining so high?'), findsOneWidget); // user bubble
    expect(find.text('FOOD IN OCTOBER'), findsOneWidget);
    expect(find.text('Where it went'), findsOneWidget);
    expect(find.text('Swiggy'), findsOneWidget);
    // The applied proposal is shown as done, with no active Confirm.
    await tester.scrollUntilVisible(find.text('SUGGESTED CHANGE'), 200, scrollable: find.byType(Scrollable).first);
    expect(find.text('Done'), findsOneWidget);
    expect(find.text('Confirm'), findsNothing);

    await tester.enterText(find.byType(TextField), 'And November so far?');
    await tester.tap(find.byTooltip('Send'));
    await tester.pumpAndSettle();
    expect(agent.asked.single, (threadId: 'demo-dining', message: 'And November so far?'));
    expect(find.text('Follow-up answer from the same thread.'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a pending stored proposal can still be confirmed', (tester) async {
    await pumpApp(tester);
    _router(tester).push('/ask?thread=demo-bills');
    await tester.pumpAndSettle();
    expect(find.text('Price changes'), findsOneWidget);
    await tapVisible(tester, find.text('Confirm'));
    expect(find.text('Done'), findsOneWidget);
  });

  testWidgets('usage details open from the caption', (tester) async {
    await pumpApp(tester);
    _router(tester).push('/ask?thread=demo-dining');
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('This conversation'));
    await tester.pumpAndSettle();
    expect(find.text('Conversation usage'), findsOneWidget);
    expect(find.text('13,240'), findsOneWidget);
    expect(find.text('430'), findsOneWidget);
    expect(find.text('gemini-3.8-flash'), findsOneWidget);
  });

  testWidgets('empty state when there are no past conversations', (tester) async {
    await pumpApp(tester, overrides: [
      agentHistoryRepositoryProvider.overrideWithValue(DemoAgentHistoryRepository(testNow, threads: const [])),
    ]);
    await _openHistory(tester);
    expect(find.textContaining('No past conversations yet'), findsOneWidget);
  });

  testWidgets('an unknown thread shows a toast and the welcome screen', (tester) async {
    await pumpApp(tester);
    _router(tester).push('/ask?thread=nope');
    await tester.pumpAndSettle();
    expect(find.text('Could not open that conversation.'), findsOneWidget);
    expect(find.textContaining('Ask anything'), findsOneWidget);
    await toastGone(tester);
  });

  testWidgets('history and an opened thread fit 320px with 1.3x text', (tester) async {
    await pumpApp(tester, size: const Size(320, 640), textScale: 1.3);
    await _openHistory(tester);
    expect(tester.takeException(), isNull);
    await tester.tap(find.text('Why was October dining so high?'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await tester.drag(find.byType(Scrollable).first, const Offset(0, -4000));
    await tester.pumpAndSettle();
    await _scrollThrough(tester);
  });

  test('token and question labels', () {
    expect(tokenCount(0), '0\u00a0tokens');
    expect(tokenCount(850), '850\u00a0tokens');
    expect(tokenCount(13670), '14k\u00a0tokens');
    expect(tokenCount(999499), '999k\u00a0tokens');
    expect(tokenCount(999500), '1M\u00a0tokens');
    expect(tokenCount(1240000), '1.2M\u00a0tokens');
    expect(tokenCount(12600000), '13M\u00a0tokens');
    expect(questionCount(1), '1\u00a0question');
    expect(questionCount(6), '6\u00a0questions');
    expect(const AgentUsage(questions: 6, inputTokens: 47000, outputTokens: 1200).label, '6\u00a0questions · 48k\u00a0tokens');
  });

  // SHOTS_DIR only.
  testWidgets('screenshots', (tester) async {
    await pumpApp(tester);
    await _openHistory(tester);
    await shot(tester, 'ask_history_390');
    await tester.tap(find.text('Why was October dining so high?'));
    await tester.pumpAndSettle();
    await tester.drag(find.byType(Scrollable).first, const Offset(0, -4000));
    await tester.pumpAndSettle();
    await shot(tester, 'ask_thread_390');
  });

  testWidgets('screenshots at 320px with 1.3x text', (tester) async {
    await pumpApp(tester, size: const Size(320, 900), textScale: 1.3);
    await _openHistory(tester);
    await shot(tester, 'ask_history_320_1.3x');
    await tester.tap(find.text('Why was October dining so high?'));
    await tester.pumpAndSettle();
    await tester.drag(find.byType(Scrollable).first, const Offset(0, -4000));
    await tester.pumpAndSettle();
    await shot(tester, 'ask_thread_320_1.3x');
  });
}
