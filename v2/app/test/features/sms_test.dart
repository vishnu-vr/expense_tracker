import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/harness.dart';

/// A fake of the Android side of `track_expense/sms` with auto-add on.
class _FakeSms {
  _FakeSms(this.tester, {List<Map<String, Object?>>? queue}) : queue = queue ?? [] {
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('track_expense/sms'),
      (call) async {
        calls.add(call.method);
        final args = call.arguments is Map ? call.arguments as Map : const {};
        switch (call.method) {
          case 'setEnabled':
            state = {...state, 'enabled': args['enabled'] as bool};
          case 'setAutoAdd':
            state = {...state, 'autoAdd': args['enabled'] as bool};
          case 'pushCategoryTable':
            table = args['table'] as String?;
            return null;
          case 'reviewQueue' || 'suggestCategories':
            return this.queue;
          case 'removeFromQueue':
            removed.add(args['id'] as String);
            this.queue.removeWhere((e) => e['id'] == args['id']);
            return this.queue;
          case 'nanoStatus':
            return 'unavailable';
        }
        return state;
      },
    );
  }

  final WidgetTester tester;
  final List<Map<String, Object?>> queue;
  final calls = <String>[];
  final removed = <String>[];
  String? table;
  var state = <String, Object?>{
    'enabled': true,
    'autoAdd': false,
    'smsGranted': true,
    'notificationsGranted': true,
  };
}

Map<String, Object?> _item(String id, String? merchant, double amount, {String? category}) => {
      'id': id,
      'amount': amount,
      'type': 'expense',
      'merchant': merchant,
      'account': 'HDFC XX1234',
      'receivedAt': DateTime(2026, 11, 10, 20).millisecondsSinceEpoch,
      'categoryId': ?category,
      'categorySource': category == null ? null : 'builtin',
    };

void main() {
  testWidgets('sms: turning on asks for permission and reflects the result', (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    var state = {'enabled': false, 'smsGranted': false, 'notificationsGranted': false};
    final calls = <String>[];
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('track_expense/sms'),
      (call) async {
        calls.add(call.method);
        if (call.method == 'requestPermissions') {
          state = {...state, 'smsGranted': true};
        } else if (call.method == 'setEnabled') {
          state = {...state, 'enabled': call.arguments['enabled'] as bool};
        }
        return state;
      },
    );

    await pumpApp(tester);
    await tester.tap(find.byTooltip('Profile and settings'));
    await tester.pumpAndSettle();
    await tapVisible(tester, find.text('Bank SMS detection'));
    expect(find.text('Not allowed'), findsNWidgets(2));

    await tester.tap(find.text('Suggest entries from bank messages'));
    await tester.pumpAndSettle();
    expect(calls, containsAllInOrder(['status', 'requestPermissions', 'setEnabled']));
    expect(find.text('Allowed'), findsOneWidget);
    expect(find.textContaining('paused until both permissions'), findsOneWidget);

    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('a suggestion link opens the entry form prefilled', (tester) async {
    await pumpApp(tester);
    await tester.binding.defaultBinaryMessenger.handlePlatformMessage(
      'flutter/navigation',
      const JSONMethodCodec().encodeMethodCall(const MethodCall('pushRouteInformation', {
        'location': 'trackexpense://app/add?type=income&amount=1499.5&date=2026-11-09T08:30:00Z',
      })),
      (_) {},
    );
    await tester.pumpAndSettle();
    expect(find.text('Add entry'), findsOneWidget);
    expect(find.text('1499.50'), findsOneWidget);
    expect(find.bySemanticsLabel('Salary'), findsOneWidget);
    expect(find.textContaining('9 Nov'), findsOneWidget);

    // Nothing to go back to, so Close returns to Home.
    await tester.tap(find.byTooltip('Close'));
    await tester.pumpAndSettle();
    expect(find.text('NET THIS MONTH'), findsOneWidget);
  });

  testWidgets('sms: auto-add toggle and on-device AI status', (tester) async {
    final fake = _FakeSms(tester);
    await pumpApp(tester);
    await tester.tap(find.byTooltip('Profile and settings'));
    await tester.pumpAndSettle();
    await tapVisible(tester, find.text('Bank SMS detection'));
    expect(find.text('On-device AI'), findsNothing);

    await tester.tap(find.text('Auto-add confident entries'));
    await tester.pumpAndSettle();
    expect(fake.calls, containsAllInOrder(['setAutoAdd', 'nanoStatus']));
    expect(find.text('Not available on this phone'), findsOneWidget);
    expect(find.text('Review detected entries'), findsOneWidget);
    expect(find.textContaining('adds the entry when it is sure'), findsOneWidget);
  });

  testWidgets('sms: auto-add cannot be turned on while detection is off', (tester) async {
    final fake = _FakeSms(tester);
    fake.state = {...fake.state, 'enabled': false};
    await pumpApp(tester);
    await tester.tap(find.byTooltip('Profile and settings'));
    await tester.pumpAndSettle();
    await tapVisible(tester, find.text('Bank SMS detection'));
    await tester.tap(find.text('Auto-add confident entries'));
    await tester.pumpAndSettle();
    expect(fake.calls, isNot(contains('setAutoAdd')));
  });

  testWidgets('the app pushes the category table to Android', (tester) async {
    final fake = _FakeSms(tester);
    await pumpApp(tester);
    await tester.pump(const Duration(seconds: 3));
    expect(fake.table, isNotNull);
    expect(fake.table, contains('"homeId":"demo"'));
    expect(fake.table, contains('"firebase":null')); // demo mode: nothing written natively
  });

  testWidgets('review: banner on Home, Add saves with an SMS badge, dismiss removes', (tester) async {
    final fake = _FakeSms(tester, queue: [
      _item('r1', 'Swiggy', 1499, category: 'food'),
      _item('r2', 'Ramesh Stores', 320),
    ]);
    await pumpApp(tester);
    expect(find.text('2 detected entries to review'), findsOneWidget);

    await tester.tap(find.text('2 detected entries to review'));
    await tester.pumpAndSettle();
    expect(find.text('Review detected entries'), findsOneWidget);
    expect(find.text('Food · suggested'), findsOneWidget);
    expect(find.text('Tap to pick a category'), findsOneWidget);
    expect(fake.calls, contains('suggestCategories'));

    // No category yet: Add is disabled for Ramesh Stores.
    final addButtons = find.widgetWithText(TextButton, 'Add');
    expect(tester.widget<TextButton>(addButtons.last).onPressed, isNull);

    await tester.tap(addButtons.first);
    await tester.pumpAndSettle();
    expect(fake.removed, ['r1']);
    expect(find.text('Entry added'), findsOneWidget);
    await toastGone(tester);

    await tester.drag(find.text('Ramesh Stores'), const Offset(-500, 0));
    await tester.pumpAndSettle();
    expect(fake.removed, ['r1', 'r2']);
    expect(find.text('Nothing to review.'), findsOneWidget);

    await tester.pageBack();
    await tester.pumpAndSettle();
    expect(find.textContaining('detected entr'), findsNothing);
    await tester.tap(find.text('Ledger'));
    await tester.pumpAndSettle();
    expect(find.text('SMS'), findsOneWidget);
    expect(find.textContaining('Swiggy · HDFC XX1234'), findsOneWidget);

    // The entry screen says where it came from.
    await tester.tap(find.textContaining('Swiggy · HDFC XX1234'));
    await tester.pumpAndSettle();
    expect(find.text('Added from a bank message'), findsOneWidget);
  });

  testWidgets('review: tapping a row opens the form prefilled and saving clears it', (tester) async {
    final fake = _FakeSms(tester, queue: [_item('r2', 'Ramesh Stores', 320)]);
    await pumpApp(tester);
    await tester.tap(find.text('1 detected entry to review'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Ramesh Stores'));
    await tester.pumpAndSettle();
    expect(find.text('Add entry'), findsOneWidget);
    expect(find.text('320'), findsOneWidget);
    expect(find.text('Ramesh Stores · HDFC XX1234'), findsOneWidget);
    expect(find.text('Added from a bank message'), findsOneWidget);

    await tester.tap(find.bySemanticsLabel('Grocery'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Save entry'));
    await tester.pumpAndSettle();
    expect(fake.removed, ['r2']);
    expect(find.text('Nothing to review.'), findsOneWidget);
  });

  testWidgets('review: the notification link opens the list with a Close button', (tester) async {
    _FakeSms(tester, queue: [_item('r1', 'Swiggy', 1499, category: 'food')]);
    await pumpApp(tester);
    await tester.binding.defaultBinaryMessenger.handlePlatformMessage(
      'flutter/navigation',
      const JSONMethodCodec().encodeMethodCall(const MethodCall('pushRouteInformation', {
        'location': 'trackexpense://app/sms/review',
      })),
      (_) {},
    );
    await tester.pumpAndSettle();
    expect(find.text('Swiggy'), findsOneWidget);
    await tester.tap(find.byTooltip('Close'));
    await tester.pumpAndSettle();
    expect(find.text('1 detected entry to review'), findsOneWidget);
  });
}
