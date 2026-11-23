import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:track_expense/app/providers.dart';
import 'package:track_expense/app/router.dart';
import 'package:track_expense/core/data/agent.dart';
import 'package:track_expense/core/data/demo_repository.dart';
import 'package:track_expense/core/data/repositories.dart';
import 'package:track_expense/core/domain/report.dart';

import '../support/harness.dart';

GoRouter _router(WidgetTester tester) =>
    ProviderScope.containerOf(tester.element(find.byType(MaterialApp))).read(routerProvider);

String _location(WidgetTester tester) => _router(tester).state.uri.toString();

Future<void> _open(WidgetTester tester, String location) async {
  _router(tester).push(location);
  await tester.pumpAndSettle();
}

/// Records questions without answering from the demo data.
class _RecordingAgent implements AgentRepository {
  final asked = <String>[];

  @override
  Stream<AgentEvent> ask({String? threadId, required String message, String? model, String? reply, String? language}) async* {
    asked.add(message);
    yield const AgentDone(threadId: 't', blocks: [TextBlock('Here is what changed.')]);
  }

  @override
  Future<void> resolveProposal({required String threadId, required String proposalId, required bool accept}) async {}
}

/// A repository whose generate fails with a server message.
class _LimitedReports extends DemoReportsRepository {
  _LimitedReports(super.now);

  @override
  Future<String> generate({required DayRange period, required CompareMode compare, DayRange? customCompare, String? model}) async =>
      throw const ReportException('You can make 10 reports a day. Try again tomorrow.');
}

void main() {
  setUpAll(loadAppFonts);

  testWidgets('Insights › Reports lists monthly reports first, then on-demand ones', (tester) async {
    await pumpApp(tester);
    await tester.tap(find.text('Insights').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Reports'));
    await tester.pumpAndSettle();

    expect(_location(tester), '/reports');
    expect(find.text('Monthly'), findsOneWidget);
    expect(find.text('On demand'), findsOneWidget);
    final monthly = find.text('October 2026');
    final custom = find.text('Last week');
    expect(monthly, findsOneWidget);
    expect(custom, findsOneWidget);
    expect(tester.getTopLeft(monthly).dy, lessThan(tester.getTopLeft(custom).dy));
    expect(find.text('vs September 2026 · Made 1 Nov'), findsOneWidget);
    await shot(tester, 'reports_list');
    expect(tester.takeException(), isNull);
  });

  testWidgets('a report shows its figures, narrative and sections, and its entries open', (tester) async {
    await pumpApp(tester);
    await _open(tester, '/reports/monthly_2026-10');

    expect(find.text('MONTHLY REPORT · VS SEPTEMBER 2026'), findsOneWidget);
    expect(find.text('Made on 1 Nov, 7:00 am · Written by Gemini Flash'), findsOneWidget);
    expect(find.text('₹62,480'), findsOneWidget);
    expect(find.text('+₹7,770 · +14.2%'), findsOneWidget);
    expect(find.text('-5.4 pts'), findsOneWidget);
    expect(find.text('Food delivery pushed spending up 14.2% on September 2026'), findsOneWidget);
    expect(find.text('WHAT CHANGED'), findsOneWidget);
    await shot(tester, 'report_top');

    await tester.scrollUntilVisible(find.text('Categories'), 100, scrollable: find.byType(Scrollable).first);
    // Health is new this month.
    await tester.scrollUntilVisible(find.text('New'), 100, scrollable: find.byType(Scrollable).first);
    expect(find.text('New'), findsOneWidget);
    for (final title in ['Who spent', 'Rhythm', 'Biggest day: 3 Oct 2026', 'Top merchants', 'Worth a look', 'Bills', 'Netflix price went up', 'Budgets · October 2026', 'Tags']) {
      await tester.scrollUntilVisible(find.text(title), 100, scrollable: find.byType(Scrollable).first);
      expect(find.text(title), findsOneWidget);
    }
    expect(tester.takeException(), isNull);

    await tapVisible(tester, find.text('House rent').first);
    expect(_location(tester), '/edit/demo-rent');
  });

  testWidgets('hide amounts masks the report', (tester) async {
    await pumpApp(tester, prefs: {'hideAmounts': true});
    await _open(tester, '/reports/monthly_2026-10');
    expect(find.text('₹62,480'), findsNothing);
    expect(find.textContaining('₹'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Refresh rebuilds with my assistant model; Ask about this report asks for the same periods', (tester) async {
    final reports = DemoReportsRepository(testNow);
    final agent = _RecordingAgent();
    await pumpApp(tester, prefs: {'agentModel': 'flash-lite'}, overrides: [
      reportsRepositoryProvider.overrideWithValue(reports),
      agentRepositoryProvider.overrideWithValue(agent),
    ]);
    await _open(tester, '/reports/monthly_2026-10');

    await tester.tap(find.byTooltip('Refresh'));
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Updating this report. This usually takes under 15 seconds.'), findsOneWidget);
    await tester.pumpAndSettle();
    expect(reports.refreshed.single, (id: 'monthly_2026-10', model: 'flash-lite'));
    expect(find.text('Report updated'), findsOneWidget);
    await toastGone(tester);

    await tapVisible(tester, find.text('Ask about this report'));
    expect(agent.asked.single, 'Compare my spending from 2026-10-01 to 2026-10-31 with 2026-09-01 to 2026-09-30. What changed and why?');
  });

  testWidgets('New report: presets and comparisons show resolved dates, Generate opens the report', (tester) async {
    final reports = DemoReportsRepository(testNow);
    await pumpApp(tester, overrides: [reportsRepositoryProvider.overrideWithValue(reports)]);
    await _open(tester, '/reports');
    await tester.tap(find.text('New report').first);
    await tester.pumpAndSettle();

    // Defaults: last month against the month before.
    expect(find.text('October 2026 · 31 days'), findsOneWidget);
    expect(find.text('vs September 2026'), findsOneWidget);
    expect(find.text('vs October 2025'), findsOneWidget);
    expect(find.text('vs a typical month (Jul–Sep 2026)'), findsOneWidget);
    await shot(tester, 'new_report_sheet');

    // Month to date compares with the same days of last month.
    await tester.tap(find.text('This month so far'));
    await tester.pumpAndSettle();
    expect(find.text('1–10 Nov 2026 · 10 days'), findsOneWidget);
    expect(find.text('vs 1–10 Oct 2026'), findsOneWidget);
    expect(find.text('vs the same days in Aug–Oct 2026, averaged'), findsOneWidget);

    await tester.tap(find.text('Same time last year'));
    await tester.pumpAndSettle();
    await tapVisible(tester, find.text('Generate'));
    expect(reports.requests.single.period.label, '1–10 Nov 2026');
    expect(reports.requests.single.compare, CompareMode.lastYear);
    expect(reports.requests.single.model, 'flash');

    expect(_location(tester), '/reports/demo-1');
    expect(find.text('REPORT · VS 1–10 NOV 2025'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('New report shows progress, and a server refusal as a message', (tester) async {
    await pumpApp(tester, overrides: [reportsRepositoryProvider.overrideWithValue(_LimitedReports(testNow))]);
    await _open(tester, '/reports');
    await tester.tap(find.text('New report').first);
    await tester.pumpAndSettle();
    await tapVisible(tester, find.text('Generate'));
    expect(find.text('You can make 10 reports a day. Try again tomorrow.'), findsOneWidget);
    expect(find.text('Generate'), findsOneWidget); // still on the sheet
    expect(_location(tester), '/reports');
  });

  testWidgets('progress while the report is written', (tester) async {
    await pumpApp(tester);
    await _open(tester, '/reports');
    await tester.tap(find.text('New report').first);
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Generate'));
    await tester.tap(find.text('Generate'));
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Writing your report. This usually takes 10–30 seconds.'), findsOneWidget);
    expect(find.text('0 s'), findsOneWidget);
    await tester.pumpAndSettle();
    expect(_location(tester), startsWith('/reports/demo-'));
  });

  testWidgets('the month review card on Home opens the report', (tester) async {
    await pumpApp(tester);
    await tapVisible(tester, find.text('Last month in review'));
    expect(_location(tester), '/reports/monthly_2026-10');
    expect(find.text('October 2026'), findsWidgets);
  });

  testWidgets('a missing report says so', (tester) async {
    await pumpApp(tester);
    await _open(tester, '/reports/nope');
    expect(find.text('This report is not available.'), findsOneWidget);
  });
}
