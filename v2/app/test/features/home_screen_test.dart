import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/harness.dart';

void main() {
  testWidgets('home shows the month summary from household data', (tester) async {
    await pumpApp(tester);

    expect(find.text('Sharma household'), findsOneWidget);
    expect(find.text('November'), findsOneWidget);
    expect(find.text('NET THIS MONTH'), findsOneWidget);
    expect(find.textContaining('In '), findsOneWidget);
    expect(find.text('Daily burn'), findsOneWidget);
    expect(find.text('Budget used'), findsOneWidget);
    expect(find.text('WORTH KNOWING'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('no overflow on a small phone with large text', (tester) async {
    tester.platformDispatcher.textScaleFactorTestValue = 1.3;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    await pumpApp(tester, size: const Size(320, 568));
    expect(tester.takeException(), isNull);
  });

  testWidgets('hide amounts masks every figure and persists', (tester) async {
    await pumpApp(tester);
    expect(find.textContaining('₹'), findsWidgets);

    await tester.tap(find.byTooltip('Hide amounts'));
    await tester.pumpAndSettle();
    expect(find.textContaining('₹'), findsNothing);
    expect(find.textContaining('••••'), findsWidgets);
    expect(find.byTooltip('Show amounts'), findsOneWidget);
  });

  testWidgets('tabs switch and the add button opens the entry form', (tester) async {
    await pumpApp(tester);

    await tester.tap(find.text('Budgets'));
    await tester.pumpAndSettle();
    expect(find.text('SPENT OF BUDGET'), findsOneWidget);

    await tester.tap(find.bySemanticsLabel('Add entry'));
    await tester.pumpAndSettle();
    expect(find.text('Add entry'), findsOneWidget);
    expect(find.text('Save entry'), findsOneWidget);
    expect(find.byType(BackButton), findsOneWidget);
  });

  testWidgets('server insight cards show on Home and can be dismissed', (tester) async {
    await pumpApp(tester);
    await tester.scrollUntilVisible(find.text('Netflix may have gone up'), 200,
        scrollable: find.byType(Scrollable).first);
    expect(find.text('For you'), findsOneWidget);

    await tester.tap(find.byTooltip('Dismiss').first);
    await tester.pumpAndSettle();
    expect(find.text('Netflix may have gone up'), findsNothing);
    expect(find.text('Electricity not logged yet'), findsOneWidget);
  });
}
