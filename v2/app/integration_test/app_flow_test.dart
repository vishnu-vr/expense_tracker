// On-device smoke test of the main flows, using the in-memory demo household.
// Run on a connected emulator or phone:
//   flutter test integration_test
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:track_expense/app/providers.dart';
import 'package:track_expense/main.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('add an entry, find it in the ledger, check every tab', (tester) async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    await tester.pumpWidget(ProviderScope(
      overrides: [sharedPreferencesProvider.overrideWithValue(prefs)],
      child: const TrackExpenseApp(),
    ));
    await tester.pumpAndSettle();
    expect(find.text('NET THIS MONTH'), findsOneWidget);

    await tester.tap(find.bySemanticsLabel('Add entry'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first, '321');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pumpAndSettle();
    final education = find.bySemanticsLabel('Education');
    await tester.ensureVisible(education);
    await tester.tap(education);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Save entry'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Ledger'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'education');
    await tester.pumpAndSettle();
    expect(find.text('−₹321'), findsOneWidget);

    for (final (tab, marker) in [
      ('Budgets', 'SPENT OF BUDGET'),
      ('Insights', 'SPENT'),
      ('Home', 'NET THIS MONTH'),
    ]) {
      await tester.tap(find.text(tab).last);
      await tester.pumpAndSettle();
      expect(find.text(marker), findsOneWidget, reason: tab);
    }
  });
}
