import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/harness.dart';

Future<void> _tab(WidgetTester tester, String label) async {
  await tester.tap(find.text(label).last);
  await tester.pumpAndSettle();
}

Future<void> _openProfile(WidgetTester tester) async {
  await tester.tap(find.byTooltip('Profile and settings'));
  await tester.pumpAndSettle();
}

void main() {
  setUpAll(loadAppFonts);

  testWidgets('budgets: list, add, edit and remove', (tester) async {
    await pumpApp(tester);
    await _tab(tester, 'Budgets');
    expect(find.text('SPENT OF BUDGET'), findsOneWidget);
    expect(find.text('Shopping'), findsOneWidget);
    await shot(tester, 'budgets');

    await tester.tap(find.text('Add'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Save budget'));
    await tester.pumpAndSettle();
    expect(find.text('Pick a category'), findsOneWidget);
    await tester.tap(find.text('Health'));
    await tester.enterText(find.byType(TextField), '2500');
    await tester.tap(find.text('Save budget'));
    await tester.pumpAndSettle();
    expect(find.text('Budget saved'), findsOneWidget);
    expect(find.text('Health'), findsOneWidget);
    await toastGone(tester);

    await tester.tap(find.text('Health'));
    await tester.pumpAndSettle();
    expect(find.text('Health budget'), findsOneWidget);
    await tester.tap(find.text('Remove budget'));
    await tester.pumpAndSettle();
    expect(find.text('Budget removed'), findsOneWidget);
    expect(find.text('Health'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('insights: breakdown, trends, and drilling into a month', (tester) async {
    await pumpApp(tester);
    await _tab(tester, 'Insights');
    expect(find.text('SPENT'), findsOneWidget);
    expect(find.text('November 2026'), findsOneWidget);
    await shot(tester, 'insights_breakdown');

    await tester.tap(find.text('Rohan'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Everyone'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Trends'));
    await tester.pumpAndSettle();
    expect(find.text('AVERAGE A MONTH'), findsOneWidget);
    expect(find.text('By month'), findsOneWidget);
    await shot(tester, 'insights_trends');

    await tapVisible(tester, find.text('Oct 2026'));
    expect(find.text('October 2026'), findsOneWidget);
    expect(find.text('SPENT'), findsOneWidget);

    await tapVisible(tester, find.text('Entertainment'));
    expect(find.text('Scuba booking'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('categories: add custom, reject duplicates, delete', (tester) async {
    await pumpApp(tester);
    await _openProfile(tester);
    await tapVisible(tester, find.text('Categories'));

    await tester.tap(find.text('Add'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'food');
    await tapVisible(tester, find.text('Save category'));
    expect(find.text('A category with this name already exists'), findsOneWidget);

    await tester.enterText(find.byType(TextField), 'Pet care');
    await tapVisible(tester, find.text('Save category'));
    expect(find.text('Category added'), findsOneWidget);
    await toastGone(tester);
    await tester.scrollUntilVisible(find.text('Pet care'), 200,
        scrollable: find.byType(Scrollable).first);
    expect(find.text('Custom'), findsOneWidget);

    await tester.tap(find.byTooltip('Delete Pet care'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Delete'));
    await tester.pumpAndSettle();
    expect(find.text('Pet care'), findsNothing);
  });

  testWidgets('tags: list and detail', (tester) async {
    await pumpApp(tester);
    await _openProfile(tester);
    await tapVisible(tester, find.text('Tags'));
    expect(find.text('Goa trip'), findsOneWidget);
    expect(find.textContaining('2 entries'), findsOneWidget);

    await tester.tap(find.text('Goa trip'));
    await tester.pumpAndSettle();
    expect(find.text('NET FOR THIS TAG'), findsOneWidget);
    expect(find.text('By person'), findsOneWidget);
    expect(find.text('−₹13,600'), findsOneWidget);
    await shot(tester, 'tag_detail');
  });

  testWidgets('profile: dark theme, sign out, sign in, leave and rejoin', (tester) async {
    await pumpApp(tester);
    await _openProfile(tester);
    expect(find.text('DEMO42'), findsOneWidget);
    expect(find.text('Asha (you)'), findsOneWidget);
    await shot(tester, 'profile');

    await tester.tap(find.text('Dark'));
    await tester.pumpAndSettle();
    expect(Theme.of(tester.element(find.text('Profile'))).brightness, Brightness.dark);
    await shot(tester, 'profile_dark');

    await tapVisible(tester, find.text('Sign out'));
    expect(find.text('Continue with Google'), findsOneWidget);
    await shot(tester, 'login');

    await tester.tap(find.text('Sign in'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Enter your email'), findsOneWidget);
    await tester.enterText(find.byType(TextField).first, 'asha@example.com');
    await tester.enterText(find.byType(TextField).last, 'wrong');
    await tester.tap(find.text('Sign in'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).last, 'wrong1');
    await tester.tap(find.text('Sign in'));
    await tester.pumpAndSettle();
    expect(find.text('NET THIS MONTH'), findsOneWidget);

    await _openProfile(tester);
    await tapVisible(tester, find.text('Leave household'));
    await tester.tap(find.text('Leave'));
    await tester.pumpAndSettle();
    expect(find.text('Set up your household'), findsOneWidget);

    await tester.tap(find.text('Join with code'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'nope12');
    await tester.tap(find.text('Join household'));
    await tester.pumpAndSettle();
    expect(find.text('No household found for that code.'), findsOneWidget);
    await shot(tester, 'onboarding');
    await tester.enterText(find.byType(TextField), 'demo42');
    await tester.tap(find.text('Join household'));
    await tester.pumpAndSettle();
    expect(find.text('NET THIS MONTH'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('activity: unread badge clears when marked read', (tester) async {
    await pumpApp(tester);
    await tester.tap(find.byTooltip('Notifications'));
    await tester.pumpAndSettle();
    expect(find.text('Rohan added ₹649 in Bills'), findsOneWidget);
    await tester.tap(find.text('Mark all read'));
    await tester.pumpAndSettle();
    expect(find.text('Mark all read'), findsNothing);
  });
}
