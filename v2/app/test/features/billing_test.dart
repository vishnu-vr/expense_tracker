import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:track_expense/app/providers.dart';
import 'package:track_expense/app/router.dart';
import 'package:track_expense/core/data/admin.dart';
import 'package:track_expense/core/data/session.dart';

import '../support/harness.dart';

const _member = AppUser(id: 'u1', email: 'asha@example.com', name: 'Asha');

final _nonAdmin = sessionRepositoryProvider.overrideWithValue(
  DemoSessionRepository(initial: const Session(user: _member, homeId: 'demo')),
);

/// Fails the first [failures] calls, then serves demo data.
class _FlakyAdminRepository implements AdminRepository {
  _FlakyAdminRepository(this.failures);

  int failures;
  final _demo = DemoAdminRepository(testNow);

  @override
  Future<AdminDashboard> dashboard(String month) async {
    if (failures > 0) {
      failures--;
      throw const AdminFailure('Could not load billing data. Try again.');
    }
    return _demo.dashboard(month);
  }
}

class _FixedAdminRepository implements AdminRepository {
  _FixedAdminRepository(this.value);

  final AdminDashboard value;

  @override
  Future<AdminDashboard> dashboard(String month) async => value;
}

GoRouter _router(WidgetTester tester) =>
    ProviderScope.containerOf(tester.element(find.byType(MaterialApp))).read(routerProvider);

Future<void> _openBilling(WidgetTester tester) async {
  _router(tester).push('/admin/billing');
  await tester.pumpAndSettle();
}

/// Scrolls the screen top to bottom, failing on any layout exception.
Future<void> _scrollThrough(WidgetTester tester) async {
  for (var i = 0; i < 12; i++) {
    await tester.drag(find.byType(Scrollable).first, const Offset(0, -400));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  }
}

void main() {
  setUpAll(loadAppFonts);

  testWidgets('admin opens Billing & usage from Profile', (tester) async {
    await pumpApp(tester);
    await tester.tap(find.byTooltip('Profile and settings'));
    await tester.pumpAndSettle();
    await tapVisible(tester, find.text('Billing & usage'));

    expect(find.text('Billing & usage'), findsOneWidget);
    expect(find.text('Sample data'), findsOneWidget);
    expect(find.text('SPENT IN NOVEMBER'), findsOneWidget);
    expect(find.text('₹227.25'), findsOneWidget);
    expect(find.text('About ₹681.75 by month end'), findsOneWidget);
    expect(find.text('+₹363.60 vs last month (₹318.15)'), findsOneWidget);
    expect(find.text('Daily spend'), findsOneWidget);
    expect(find.text('Vertex AI'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('shows usage, expands SKUs, and hides amounts', (tester) async {
    await pumpApp(tester);
    await _openBilling(tester);

    await tapVisible(tester, find.text('Show 5'));
    expect(find.text('Gemini 3.8 Flash input tokens'), findsOneWidget);
    expect(find.text('Hide'), findsOneWidget);

    await tester.scrollUntilVisible(find.text('gemini-3.8-flash'), 300, scrollable: find.byType(Scrollable).first);
    expect(find.text('In 8,12,400 · out 41,200'), findsOneWidget);
    expect(find.text('Assistant questions'), findsOneWidget);
    await tester.scrollUntilVisible(find.text('askagent'), 300, scrollable: find.byType(Scrollable).first);
    expect(tester.takeException(), isNull);
  });

  testWidgets('assistant usage section: totals and households by tokens', (tester) async {
    await pumpApp(tester);
    await _openBilling(tester);
    await tester.scrollUntilVisible(find.text('BY HOUSEHOLD'), 300, scrollable: find.byType(Scrollable).first);
    expect(find.text('Assistant usage'), findsOneWidget);
    expect(find.text('Active households'), findsOneWidget);
    expect(find.text('2,78,400'), findsOneWidget);
    expect(find.text('97 model calls'), findsOneWidget);
    await tester.scrollUntilVisible(find.text('Flat 4B, Koramangala'), 200, scrollable: find.byType(Scrollable).first);
    final sharma = find.text('Sharma household');
    final iyer = find.text('Iyer family');
    expect(tester.getTopLeft(sharma).dy, lessThan(tester.getTopLeft(iyer).dy));
    expect(find.text('187k\u00a0tokens'), findsOneWidget);
    expect(find.text('27\u00a0questions · in\u00a01,81,000 · out\u00a05,700'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('assistant usage: no questions, and unavailable', (tester) async {
    await pumpApp(tester, overrides: [
      adminRepositoryProvider.overrideWithValue(_FixedAdminRepository(const AdminDashboard(
        month: '2026-11',
        billing: BillingSummary.missing(BillingGap.noData),
        usage: UsageSummary(),
        assistant: AssistantUsageSummary(available: true),
      ))),
    ]);
    await _openBilling(tester);
    await tester.scrollUntilVisible(find.text('No questions this month.'), 300, scrollable: find.byType(Scrollable).first);

    await pumpApp(tester, overrides: [
      adminRepositoryProvider.overrideWithValue(_FixedAdminRepository(const AdminDashboard(
        month: '2026-11',
        billing: BillingSummary.missing(BillingGap.noData),
        usage: UsageSummary(),
      ))),
    ]);
    await _openBilling(tester);
    await tester.scrollUntilVisible(find.text('Assistant usage is not available right now.'), 300,
        scrollable: find.byType(Scrollable).first);
  });

  testWidgets('hide amounts masks the billing figures', (tester) async {
    await pumpApp(tester, prefs: {'hideAmounts': true});
    await _openBilling(tester);
    expect(find.text('₹227.25'), findsNothing);
    expect(find.text(hiddenAmountForTest), findsWidgets);
  });

  testWidgets('switches months; no future months; old months need setup and have no usage', (tester) async {
    await pumpApp(tester);
    await _openBilling(tester);

    final next = tester.widget<IconButton>(find.widgetWithIcon(IconButton, Icons.chevron_right));
    expect(next.onPressed, isNull);

    await tester.tap(find.byTooltip('Previous'));
    await tester.pumpAndSettle();
    expect(find.text('October 2026'), findsOneWidget);
    expect(find.text('SPENT IN OCTOBER'), findsOneWidget);
    expect(find.text('₹318.15'), findsOneWidget);
    expect(find.textContaining('by month end'), findsNothing);

    await tester.tap(find.byTooltip('Previous'));
    await tester.pumpAndSettle();
    expect(find.text('September 2026'), findsOneWidget);
    expect(find.text('Billing export not set up'), findsOneWidget);
    expect(find.textContaining('billing_export'), findsOneWidget);
    await tester.scrollUntilVisible(find.textContaining('Usage not available'), 300,
        scrollable: find.byType(Scrollable).first);

    await tester.tap(find.byTooltip('Next'));
    await tester.pumpAndSettle();
    expect(find.text('SPENT IN OCTOBER'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('error state retries', (tester) async {
    await pumpApp(tester, overrides: [adminRepositoryProvider.overrideWithValue(_FlakyAdminRepository(1))]);
    await _openBilling(tester);
    expect(find.text('Could not load billing data. Try again.'), findsOneWidget);
    await tester.tap(find.text('Retry'));
    await tester.pumpAndSettle();
    expect(find.text('SPENT IN NOVEMBER'), findsOneWidget);
  });

  testWidgets('non-admins see no Admin section and are redirected', (tester) async {
    await pumpApp(tester, overrides: [_nonAdmin]);
    await tester.tap(find.byTooltip('Profile and settings'));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(find.text('Sign out'), 300, scrollable: find.byType(Scrollable).first);
    expect(find.text('Admin'), findsNothing);
    expect(find.text('Billing & usage'), findsNothing);

    _router(tester).go('/admin/billing');
    await tester.pumpAndSettle();
    expect(find.text('Billing & usage'), findsNothing);
    expect(_router(tester).routerDelegate.currentConfiguration.uri.path, '/home');
  });

  testWidgets('fits a 320px screen with 1.3x text', (tester) async {
    await pumpApp(tester, size: const Size(320, 640), textScale: 1.3);
    await _openBilling(tester);
    await tapVisible(tester, find.text('Show 5'));
    await _scrollThrough(tester);
    await tester.drag(find.byType(Scrollable).first, const Offset(0, 8000));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Previous'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Previous'));
    await tester.pumpAndSettle();
    expect(find.text('Billing export not set up'), findsOneWidget);
    await _scrollThrough(tester);
  });

  // Tall surfaces so one PNG shows the whole screen (SHOTS_DIR only).
  testWidgets('screenshots', (tester) async {
    await pumpApp(tester, size: const Size(390, 2300));
    await _openBilling(tester);
    await tester.tap(find.text('Show 5'));
    await tester.pumpAndSettle();
    await shot(tester, 'billing_390');

    await tester.tap(find.byTooltip('Previous'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Previous'));
    await tester.pumpAndSettle();
    await shot(tester, 'billing_not_set_up_390');
  });

  testWidgets('screenshots of the assistant usage section', (tester) async {
    await pumpApp(tester, size: const Size(390, 844));
    await _openBilling(tester);
    await tester.scrollUntilVisible(find.text('Flat 4B, Koramangala'), 300, scrollable: find.byType(Scrollable).first);
    await tester.drag(find.byType(Scrollable).first, const Offset(0, -200));
    await tester.pumpAndSettle();
    await shot(tester, 'billing_assistant_390');
  });

  testWidgets('screenshot of the assistant usage section at 320px with 1.3x text', (tester) async {
    await pumpApp(tester, size: const Size(320, 900), textScale: 1.3);
    await _openBilling(tester);
    await tester.scrollUntilVisible(find.text('Flat 4B, Koramangala'), 300, scrollable: find.byType(Scrollable).first);
    await tester.drag(find.byType(Scrollable).first, const Offset(0, -200));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await shot(tester, 'billing_assistant_320_1.3x');
  });

  testWidgets('screenshot at 320px with 1.3x text', (tester) async {
    await pumpApp(tester, size: const Size(320, 2900), textScale: 1.3);
    await _openBilling(tester);
    await tester.tap(find.text('Show 5'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await shot(tester, 'billing_320_1.3x');
  });
}

const hiddenAmountForTest = '••••';
