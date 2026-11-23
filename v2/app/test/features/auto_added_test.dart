import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:track_expense/app/providers.dart';
import 'package:track_expense/core/data/demo_repository.dart';
import 'package:track_expense/core/domain/models.dart';

import '../support/harness.dart';

/// D-031: entries the phone saved from bank messages without asking. The demo
/// household has two of Asha's (Decathlon, "auto to office"), one of Rohan's
/// (Ramesh Stores) and one confirmed SMS entry (Chaayos).
void main() {
  setUpAll(loadAppFonts);

  late DemoHouseholdRepository repo;
  late WidgetTester t;
  Future<void> pump(WidgetTester tester) async {
    t = tester;
    repo = DemoHouseholdRepository(testNow);
    await pumpApp(tester, overrides: [householdRepositoryProvider.overrideWithValue(repo)]);
  }

  Transaction entry(String notePart) => ProviderScope.containerOf(t.element(find.byType(MaterialApp)))
      .read(transactionsProvider)
      .value!
      .firstWhere((tx) => tx.note?.contains(notePart) ?? false);

  Future<void> openLedger(WidgetTester tester) async {
    await tester.tap(find.text('Ledger'));
    await tester.pumpAndSettle();
  }

  Finder pillIn(String note, String pill) => find.descendant(
        of: find.ancestor(of: find.textContaining(note), matching: find.byType(InkWell)).first,
        matching: find.text(pill),
      );

  testWidgets('pills: Auto for unchecked auto-added entries, SMS for confirmed ones', (tester) async {
    await pump(tester);
    await openLedger(tester);
    expect(pillIn('auto to office', 'Auto'), findsOneWidget);
    expect(pillIn('Ramesh Stores', 'Auto'), findsOneWidget); // housemates see it too
    expect(pillIn('auto to office', 'SMS'), findsNothing);
    await tester.scrollUntilVisible(find.textContaining('Chaayos'), 250,
        scrollable: find.byType(Scrollable).first);
    expect(pillIn('Chaayos', 'SMS'), findsOneWidget);
    expect(pillIn('Chaayos', 'Auto'), findsNothing);
    expect(pillIn('Decathlon', 'Auto'), findsOneWidget);
  });

  testWidgets('ledger filter shows only my unchecked auto-added entries, with an empty state',
      (tester) async {
    await pump(tester);
    await openLedger(tester);
    await tester.tap(find.text('Auto-added · 2'));
    await tester.pumpAndSettle();
    expect(find.textContaining('auto to office'), findsOneWidget);
    expect(find.textContaining('Decathlon'), findsOneWidget);
    expect(find.textContaining('Ramesh Stores'), findsNothing); // Rohan's
    expect(find.textContaining('Chaayos'), findsNothing); // confirmed
    expect(find.textContaining('Swiggy'), findsNothing);
    await shot(tester, 'ledger_auto_added');

    await tester.tap(find.byTooltip('Previous'));
    await tester.pumpAndSettle();
    expect(find.text('No auto-added entries to check in this period.'), findsOneWidget);
    await tester.tap(find.text('Show November 2026'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Decathlon'), findsOneWidget);

    // Off again: everything is back.
    await tester.tap(find.text('Auto-added · 2'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Ramesh Stores'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Looks right clears the marker, for the owner only', (tester) async {
    await pump(tester);
    await openLedger(tester);

    // Rohan's entry: Asha sees the note but cannot clear it.
    await tester.tap(find.textContaining('Ramesh Stores'));
    await tester.pumpAndSettle();
    expect(find.text('View entry'), findsOneWidget);
    expect(find.text('Saved automatically from a bank message. Not checked yet.'), findsOneWidget);
    expect(find.text('Looks right'), findsNothing);
    await tester.pageBack();
    await tester.pumpAndSettle();

    await tester.tap(find.textContaining('auto to office'));
    await tester.pumpAndSettle();
    expect(find.text('Looks right'), findsOneWidget);
    await shot(tester, 'entry_auto_added');
    await tester.tap(find.text('Looks right'));
    await tester.pumpAndSettle();
    expect(find.text('Marked as checked'), findsOneWidget);
    expect(entry('auto to office').autoAdded, isFalse);
    expect(entry('auto to office').fromSms, isTrue);
    expect(pillIn('auto to office', 'SMS'), findsOneWidget);
    expect(pillIn('auto to office', 'Auto'), findsNothing);
    expect(find.text('Auto-added · 1'), findsOneWidget);
  });

  testWidgets('saving an edit clears the marker', (tester) async {
    await pump(tester);
    await openLedger(tester);
    await tester.tap(find.textContaining('auto to office'));
    await tester.pumpAndSettle();
    await tapVisible(tester, find.text('Update entry'));
    expect(find.text('Entry updated'), findsOneWidget);
    expect(entry('auto to office').autoAdded, isFalse);
    expect(entry('Decathlon').autoAdded, isTrue);
  });

  testWidgets('Home banner counts my entries and opens the filtered Ledger', (tester) async {
    await pump(tester);
    expect(find.text('2 auto-added entries to check'), findsOneWidget);
    await shot(tester, 'home_auto_added');

    await repo.markChecked(entry('Decathlon').id);
    await tester.pumpAndSettle();
    expect(find.text('1 auto-added entry to check'), findsOneWidget);

    await tester.tap(find.text('1 auto-added entry to check'));
    await tester.pumpAndSettle();
    expect(find.text('Ledger'), findsWidgets);
    expect(find.text('Auto-added · 1'), findsOneWidget);
    expect(find.textContaining('auto to office'), findsOneWidget);
    expect(find.textContaining('Ramesh Stores'), findsNothing);
    expect(find.textContaining('Decathlon'), findsNothing);

    await repo.markChecked(entry('auto to office').id);
    await tester.pumpAndSettle();
    expect(find.text('No auto-added entries to check in this period.'), findsOneWidget);
    expect(find.text('Show all entries'), findsOneWidget);
    await tester.tap(find.text('Home'));
    await tester.pumpAndSettle();
    expect(find.textContaining('auto-added entr'), findsNothing);
  });
}
