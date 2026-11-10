import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/harness.dart';

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
}
