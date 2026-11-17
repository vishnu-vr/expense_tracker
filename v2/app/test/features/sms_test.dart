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
          case 'labelReviewItem':
            removed.add(args['id'] as String);
            labels.add(Map<String, Object?>.from(args));
            this.queue.removeWhere((e) => e['id'] == args['id']);
            return this.queue;
          case 'entryEdited':
            edits.add(Map<String, Object?>.from(args));
            return null;
          case 'setEveningReminder':
            state = {...state, 'evening': args['enabled'] as bool};
          case 'forgetPayees':
            state = {...state, 'rememberedPayees': 0};
          case 'nanoStatus':
            return nano.length > 1 ? nano.removeAt(0) : nano.first;
          case 'setAiMode':
            state = {...state, 'aiMode': args['mode'] as String};
          case 'setCloudModel':
            state = {...state, 'cloudModel': args['model'] as String};
          case 'gemmaStatus':
            return gemma.length > 1 ? gemma.removeAt(0) : gemma.first;
          case 'gemmaDownload':
            gemma = [...gemmaAfterDownload];
            return gemma.length > 1 ? gemma.removeAt(0) : gemma.first;
          case 'gemmaCancel' || 'gemmaDelete':
            if (call.method == 'gemmaDelete' && state['aiMode'] == 'gemma') state = {...state, 'aiMode': 'off'};
            gemma = [
              {'state': 'not-downloaded', 'total': 584417280},
            ];
            return gemma.first;
        }
        return state;
      },
    );
  }

  final WidgetTester tester;
  final List<Map<String, Object?>> queue;
  final calls = <String>[];
  final removed = <String>[];
  final labels = <Map<String, Object?>>[];
  final edits = <Map<String, Object?>>[];

  /// Answers to `nanoStatus`, in order; the last one repeats.
  List<Object?> nano = [
    {'status': 'unsupported', 'code': 'AICore not installed'},
  ];
  /// Answers to `gemmaStatus`, in order; the last one repeats.
  List<Object?> gemma = [
    {'state': 'not-downloaded', 'total': 584417280},
  ];

  /// What `gemmaStatus` answers after `gemmaDownload`.
  List<Object?> gemmaAfterDownload = [
    {'state': 'downloading', 'done': 245500000, 'total': 584417280},
    {'state': 'ready', 'done': 584417280, 'total': 584417280},
  ];
  String? table;
  var state = <String, Object?>{
    'enabled': true,
    'autoAdd': false,
    'smsGranted': true,
    'notificationsGranted': true,
  };
}

Map<String, Object?> _aiItem(String id, String merchant, double amount, String category, {String model = 'Gemini Flash-Lite'}) => {
      ..._item(id, merchant, amount),
      'categoryId': category,
      'categorySource': 'ai',
      'aiModel': model,
    };

Future<void> _openSmsSettings(WidgetTester tester) async {
  await tester.tap(find.byTooltip('Profile and settings'));
  await tester.pumpAndSettle();
  await tapVisible(tester, find.text('Bank SMS detection'));
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
    expect(find.text('Gemini Nano'), findsNothing);
    expect(find.text('CATEGORY SUGGESTIONS'), findsNothing);

    await tester.tap(find.text('Auto-add confident entries'));
    await tester.pumpAndSettle();
    expect(fake.calls, containsAllInOrder(['setAutoAdd', 'nanoStatus']));
    expect(find.text('Not supported on this phone yet'), findsOneWidget);
    expect(find.text('AICore not installed'), findsOneWidget);
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

  testWidgets('review: banner on Home, a chip saves with an SMS badge, dismiss removes', (tester) async {
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
    expect(find.text('What was it for?'), findsOneWidget);
    expect(fake.calls, contains('suggestCategories'));

    // Swiggy's own suggestion is its first chip; one tap saves it.
    await tester.tap(find.byTooltip('Add as Food').first);
    await tester.pumpAndSettle();
    expect(fake.removed, ['r1']);
    expect(fake.labels.single, containsPair('categoryId', 'food'));
    expect(fake.labels.single, containsPair('note', 'Swiggy · HDFC XX1234'));
    expect(fake.labels.single['docId'], isNotNull);
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

    // The entry screen says where it came from; changing it updates the payee memory.
    await tester.tap(find.textContaining('Swiggy · HDFC XX1234'));
    await tester.pumpAndSettle();
    expect(find.text('Added from a bank message'), findsOneWidget);
    await tester.tap(find.bySemanticsLabel('Grocery'));
    await tester.pumpAndSettle();
    await tapVisible(tester, find.text('Update entry'));
    expect(fake.edits.single, containsPair('categoryId', 'grocery'));
    expect(fake.edits.single, containsPair('docId', fake.labels.single['docId']));
  });

  testWidgets('review: quick chips follow amount and time, words become the note', (tester) async {
    final fake = _FakeSms(tester, queue: [
      {..._item('r3', 'UPI xxxxx3210', 150), 'words': 'gift for amma'},
    ]);
    await pumpApp(tester);
    await tester.tap(find.text('1 detected entry to review'));
    await tester.pumpAndSettle();
    // The words from a notification reply are prefilled.
    expect(find.widgetWithText(TextField, 'gift for amma'), findsOneWidget);
    // Up to three category chips plus Other….
    final chips = tester.widgetList<ActionChip>(find.byType(ActionChip)).toList();
    expect(chips.length, inInclusiveRange(2, 4));
    expect((chips.last.label as Text).data, 'Other…');

    await tester.enterText(find.byType(TextField), 'auto to office');
    final first = (chips.first.label as Text).data!;
    await tester.tap(find.byTooltip('Add as $first'));
    await tester.pumpAndSettle();
    expect(fake.labels.single['note'], 'auto to office · UPI xxxxx3210');
    expect(find.text('Nothing to review.'), findsOneWidget);
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
    // The form's save also teaches the phone this payee.
    expect(fake.labels.single, containsPair('categoryId', 'grocery'));
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

  testWidgets('sms settings: evening reminder, forget payees, AI status with Check again', (tester) async {
    final fake = _FakeSms(tester);
    fake.state = {...fake.state, 'autoAdd': true, 'evening': true, 'rememberedPayees': 3};
    fake.nano = [
      {'status': 'aicore-update', 'code': 'AICore 0.9'},
      {'status': 'waiting-for-wifi'},
    ];
    await pumpApp(tester);
    await tester.tap(find.byTooltip('Profile and settings'));
    await tester.pumpAndSettle();
    await tapVisible(tester, find.text('Bank SMS detection'));

    expect(find.text("Update 'Android AICore' in Play Store, then check again"), findsOneWidget);
    expect(find.text('AICore 0.9'), findsOneWidget);
    await tapVisible(tester, find.text('Check again'));
    // Now supported (only waiting for Wi-Fi): Nano becomes a choice (D-032).
    expect(find.textContaining('Waiting for Wi-Fi to download the model'), findsOneWidget);
    expect(find.text('AICore 0.9'), findsNothing);

    await tester.scrollUntilVisible(find.text('Evening reminder'), -250, scrollable: find.byType(Scrollable).first);
    await tapVisible(tester, find.text('Evening reminder'));
    expect(fake.calls, contains('setEveningReminder'));
    expect(fake.state['evening'], false);

    await tester.scrollUntilVisible(find.textContaining('3 payees are added on their own'), 250, scrollable: find.byType(Scrollable).first);
    expect(find.textContaining('3 payees are added on their own'), findsOneWidget);
    await tapVisible(tester, find.text('Forget remembered payees'));
    expect(find.text('Forget remembered payees?'), findsOneWidget);
    await tester.tap(find.text('Forget'));
    await tester.pumpAndSettle();
    expect(fake.calls, contains('forgetPayees'));
    expect(find.textContaining('None yet'), findsOneWidget);
  });

  testWidgets('category suggestions: Off by default, Cloud with Flash-Lite or Flash, Nano only where supported (D-032)',
      (tester) async {
    final fake = _FakeSms(tester);
    fake.state = {...fake.state, 'autoAdd': true};
    await pumpApp(tester);
    await _openSmsSettings(tester);

    await tester.scrollUntilVisible(find.text('CATEGORY SUGGESTIONS'), 250, scrollable: find.byType(Scrollable).first);
    expect(find.textContaining('never saved by itself'), findsOneWidget);
    expect(tester.getSemantics(find.text('Off')), isSemantics(isChecked: true, isInMutuallyExclusiveGroup: true));
    expect(tester.getSemantics(find.text('Cloud')), isSemantics(isChecked: false));
    // Nano is not supported on this phone: a status line with Check again, not a choice.
    expect(find.text('Not supported on this phone yet'), findsOneWidget);
    expect(find.byIcon(Icons.radio_button_unchecked), findsNWidgets(2)); // Cloud and Gemma

    await tapVisible(tester, find.text('Cloud'));
    expect(fake.state['aiMode'], 'cloud');
    expect(find.text('Sends only the payee name or your reply words, never the SMS.'), findsOneWidget);
    expect(tester.widget<ChoiceChip>(find.widgetWithText(ChoiceChip, 'Flash-Lite')).selected, isTrue);
    await tapVisible(tester, find.widgetWithText(ChoiceChip, 'Flash'));
    expect(fake.calls, contains('setCloudModel'));
    expect(fake.state['cloudModel'], 'flash');
    expect(tester.widget<ChoiceChip>(find.widgetWithText(ChoiceChip, 'Flash')).selected, isTrue);

    await tapVisible(tester, find.text('Off'));
    expect(fake.state['aiMode'], 'off');
    expect(find.byType(ChoiceChip), findsNothing);
  });

  testWidgets('category suggestions: Gemini Nano is a choice when the phone supports it', (tester) async {
    final fake = _FakeSms(tester);
    fake.state = {...fake.state, 'autoAdd': true};
    fake.nano = [
      {'status': 'available'},
    ];
    await pumpApp(tester);
    await _openSmsSettings(tester);
    await tapVisible(tester, find.text('Gemini Nano'));
    expect(fake.state['aiMode'], 'nano');
    expect(find.textContaining('while the review list is open'), findsOneWidget);
  });

  testWidgets('on-device Gemma: download on Wi-Fi with progress, ready, delete with confirmation, terms notice',
      (tester) async {
    final fake = _FakeSms(tester);
    fake.state = {...fake.state, 'autoAdd': true};
    await pumpApp(tester);
    await _openSmsSettings(tester);

    await tapVisible(tester, find.text('On-device: Gemma 3 1B'));
    expect(fake.state['aiMode'], 'gemma');
    expect(find.text('Nothing leaves the phone.'), findsOneWidget);
    expect(find.text('Not downloaded. About 557 MB, on Wi-Fi.'), findsOneWidget);
    expect(find.text('Suggestions start once the model is on the phone.'), findsOneWidget);
    expect(find.textContaining('Gemma Terms of Use found at ai.google.dev/gemma/terms'), findsOneWidget);

    await tapVisible(tester, find.text('Download on Wi-Fi'));
    expect(fake.calls, contains('gemmaDownload'));
    expect(find.text('Downloading: 42% of 557 MB'), findsOneWidget);
    expect(find.byType(LinearProgressIndicator), findsOneWidget);
    expect(find.text('Cancel download'), findsOneWidget);

    // The screen checks again while downloading.
    await tester.pump(const Duration(seconds: 3));
    await tester.pumpAndSettle();
    expect(find.text('Ready on this phone (557 MB)'), findsOneWidget);
    expect(find.text('Suggestions start once the model is on the phone.'), findsNothing);

    await tapVisible(tester, find.text('Delete'));
    expect(find.text('Delete the on-device model?'), findsOneWidget);
    await tester.tap(find.widgetWithText(TextButton, 'Delete').last);
    await tester.pumpAndSettle();
    expect(fake.calls, contains('gemmaDelete'));
    expect(fake.state['aiMode'], 'off');
    expect(find.text('Not downloaded. About 557 MB, on Wi-Fi.'), findsOneWidget);
  });

  testWidgets('on-device Gemma: "Model not available yet" offers no download', (tester) async {
    final fake = _FakeSms(tester);
    fake.state = {...fake.state, 'autoAdd': true, 'aiMode': 'gemma'};
    fake.gemma = [
      {'state': 'not-available', 'total': 584417280},
    ];
    await pumpApp(tester);
    await _openSmsSettings(tester);
    await tester.scrollUntilVisible(find.text('Model not available yet'), 250, scrollable: find.byType(Scrollable).first);
    expect(find.text('Download on Wi-Fi'), findsNothing);
  });

  testWidgets('review: AI suggestions are labelled, saved only on Approve, and Approve all confirms the count',
      (tester) async {
    final fake = _FakeSms(tester, queue: [
      _aiItem('r1', 'BLUE TOKAI COFFEE', 420, 'food'),
      _aiItem('r2', 'UBER INDIA', 310, 'transportation', model: 'Gemma 3 1B'),
      _aiItem('r3', 'CHAAYOS', 180, 'food'),
      _item('r4', 'Ramesh Stores', 320),
    ]);
    await pumpApp(tester, size: const Size(390, 1800));
    await tester.tap(find.text('4 detected entries to review'));
    await tester.pumpAndSettle();

    expect(find.text('Food · Suggested by AI · Gemini Flash-Lite'), findsNWidgets(2));
    expect(find.text('Transportation · Suggested by AI · Gemma 3 1B'), findsOneWidget);
    expect(find.text('What was it for?'), findsOneWidget);
    // Opening the list saves nothing by itself.
    expect(fake.labels, isEmpty);
    expect(find.widgetWithText(FilledButton, 'Approve'), findsNWidgets(3));

    // Approve one: a normal confirmed save that teaches payee memory.
    await tester.tap(find.widgetWithText(FilledButton, 'Approve').first);
    await tester.pumpAndSettle();
    expect(fake.labels.single, containsPair('id', 'r1'));
    expect(fake.labels.single, containsPair('categoryId', 'food'));
    await toastGone(tester);

    await tester.tap(find.text('Approve all AI suggestions (2)'));
    await tester.pumpAndSettle();
    expect(find.text('Approve 2 AI suggestions?'), findsOneWidget);
    await tester.tap(find.text('Approve 2'));
    await tester.pumpAndSettle();
    expect(fake.labels.map((l) => l['id']), ['r1', 'r2', 'r3']);
    expect(fake.labels.map((l) => l['categoryId']), ['food', 'transportation', 'food']);
    expect(find.text('2 entries added'), findsOneWidget);
    expect(find.text('Ramesh Stores'), findsOneWidget);
    expect(find.textContaining('Approve all'), findsNothing);
    await toastGone(tester);

    // Approved entries are the user's own: "SMS", never "Auto".
    await tester.pageBack();
    await tester.pumpAndSettle();
    await tester.tap(find.text('Ledger'));
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('BLUE TOKAI COFFEE · HDFC XX1234'));
    await tester.pumpAndSettle();
    expect(find.text('Added from a bank message'), findsOneWidget);
    expect(find.text('Looks right'), findsNothing);
    expect(find.textContaining('Not checked yet'), findsNothing);
  });
}
