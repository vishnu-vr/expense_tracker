import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/harness.dart';

Future<void> _openLedger(WidgetTester tester) async {
  await tester.tap(find.text('Ledger'));
  await tester.pumpAndSettle();
}

void main() {
  setUpAll(loadAppFonts);

  testWidgets('ledger shows the month, searches, and steps between periods',
      (tester) async {
    await pumpApp(tester);
    await _openLedger(tester);

    expect(find.text('November 2026'), findsOneWidget);
    expect(find.text('NET FOR PERIOD'), findsOneWidget);
    await shot(tester, 'ledger');

    await tester.enterText(find.byType(TextField), 'netflix');
    await tester.pumpAndSettle();
    expect(find.text('1 match in this period'), findsOneWidget);

    await tester.tap(find.byTooltip('Clear search'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Previous'));
    await tester.pumpAndSettle();
    expect(find.text('October 2026'), findsOneWidget);

    await tester.tap(find.text('Day'));
    await tester.pumpAndSettle();
    expect(find.text('10 Nov 2026, Tuesday'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('adding an entry validates, saves and shows up in the ledger',
      (tester) async {
    await pumpApp(tester);
    await tester.tap(find.bySemanticsLabel('Add entry'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Save entry'));
    await tester.pumpAndSettle();
    expect(find.text('Enter an amount'), findsOneWidget);
    expect(find.text('Pick a category'), findsOneWidget);

    await tester.enterText(find.byType(TextField).first, '275');
    await tapVisible(tester, find.bySemanticsLabel('Education'));
    await tester.enterText(find.byType(TextField).at(1), 'Dart course');
    await tester.pumpAndSettle();
    await shot(tester, 'entry');
    await tester.tap(find.text('Save entry'));
    await tester.pumpAndSettle();
    expect(find.text('Entry added'), findsOneWidget);

    await _openLedger(tester);
    await tester.enterText(find.byType(TextField), 'dart course');
    await tester.pumpAndSettle();
    expect(find.text('1 match in this period'), findsOneWidget);
    expect(find.text('−₹275'), findsOneWidget);
  });

  testWidgets('budget warning appears while drafting, and type switch clears category',
      (tester) async {
    await pumpApp(tester);
    await tester.tap(find.bySemanticsLabel('Add entry'));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField).first, '20000');
    await tapVisible(tester, find.bySemanticsLabel('Shopping'));
    await tester.pumpAndSettle();
    expect(find.text('Over monthly budget'), findsOneWidget);

    await tapVisible(tester, find.text('Income'));
    expect(find.text('Over monthly budget'), findsNothing);
    expect(find.bySemanticsLabel('Salary'), findsOneWidget);
    await tester.tap(find.text('Save entry'));
    await tester.pumpAndSettle();
    expect(find.text('Pick a category'), findsOneWidget);
  });

  testWidgets("someone else's entry opens read-only; own entry can be deleted",
      (tester) async {
    await pumpApp(tester);
    await _openLedger(tester);

    await tester.enterText(find.byType(TextField), 'netflix');
    await tester.pumpAndSettle();
    await tester.tap(find.text('Bills'));
    await tester.pumpAndSettle();
    expect(find.text('View entry'), findsOneWidget);
    expect(find.textContaining('Added by Rohan'), findsOneWidget);
    expect(find.text('Update entry'), findsNothing);
    expect(find.byTooltip('Delete entry'), findsNothing);
    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), 'house rent');
    await tester.pumpAndSettle();
    await tester.tap(find.text('Home').first);
    await tester.pumpAndSettle();
    expect(find.text('Edit entry'), findsOneWidget);
    await tester.tap(find.byTooltip('Delete entry'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Delete'));
    await tester.pumpAndSettle();
    expect(find.text('Entry deleted'), findsOneWidget);
    expect(find.text('No entries match "house rent".'), findsOneWidget);
  });
}
