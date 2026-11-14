import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:track_expense/app/providers.dart';
import 'package:track_expense/main.dart';

/// Fixed clock for tests: Tuesday 10 November 2026, 9 pm.
final testNow = DateTime(2026, 11, 10, 21);

/// Pumps the whole app on a phone-sized surface with the demo household.
Future<void> pumpApp(
  WidgetTester tester, {
  Size size = const Size(390, 844),
  Map<String, Object> prefs = const {},
  double pixelRatio = 1,
  double textScale = 1,
  List<Override> overrides = const [],
}) async {
  tester.view.physicalSize = size * pixelRatio;
  tester.view.devicePixelRatio = pixelRatio;
  addTearDown(tester.view.reset);
  if (textScale != 1) {
    tester.platformDispatcher.textScaleFactorTestValue = textScale;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
  }
  SharedPreferences.setMockInitialValues(prefs);
  final sp = await SharedPreferences.getInstance();
  await tester.pumpWidget(ProviderScope(
    overrides: [
      nowProvider.overrideWithValue(testNow),
      sharedPreferencesProvider.overrideWithValue(sp),
      ...overrides,
    ],
    child: const TrackExpenseApp(),
  ));
  await tester.pumpAndSettle();
}

Future<void> _font(String family, String path) async {
  final loader = FontLoader(family)
    ..addFont(Future.value(ByteData.view(File(path).readAsBytesSync().buffer)));
  await loader.load();
}

/// Loads the real fonts so rendered screenshots look like the app.
Future<void> loadAppFonts() async {
  await _font('Inter', 'assets/fonts/Inter.ttf');
  await _font('SpaceGrotesk', 'assets/fonts/SpaceGrotesk.ttf');
  final root = Platform.environment['FLUTTER_ROOT'] ?? '/opt/homebrew/share/flutter';
  final icons = '$root/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf';
  if (File(icons).existsSync()) await _font('MaterialIcons', icons);
}

/// Writes a PNG of the current screen when SHOTS_DIR is set; otherwise a no-op.
Future<void> shot(WidgetTester tester, String name) async {
  final dir = Platform.environment['SHOTS_DIR'];
  if (dir == null) return;
  await expectLater(find.byType(MaterialApp), matchesGoldenFile('$dir/$name.png'));
}

/// Scrolls [finder] into view (building it first if the list is lazy), then taps it.
Future<void> tapVisible(WidgetTester tester, Finder finder) async {
  if (finder.evaluate().isEmpty) {
    await tester.scrollUntilVisible(finder, 250,
        scrollable: find.byType(Scrollable).first);
  }
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

/// Waits for the current toast to time out so it no longer covers the screen.
Future<void> toastGone(WidgetTester tester) async {
  await tester.pump(const Duration(seconds: 5));
  await tester.pumpAndSettle();
}
