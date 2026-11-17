import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_timezone/flutter_timezone.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'app/backend.dart';
import 'app/providers.dart';
import 'app/router.dart';
import 'core/theme/ledger_theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final prefs = await SharedPreferences.getInstance();
  final backend = await backendOverrides(timeZone: await _timeZone());
  runApp(ProviderScope(
    overrides: [sharedPreferencesProvider.overrideWithValue(prefs), ...backend],
    child: const TrackExpenseApp(),
  ));
}

/// IANA name of the phone's time zone, for "this month" on the server.
Future<String> _timeZone() async {
  try {
    return (await FlutterTimezone.getLocalTimezone()).identifier;
  } catch (_) {
    return 'Asia/Kolkata';
  }
}

class TrackExpenseApp extends ConsumerStatefulWidget {
  const TrackExpenseApp({super.key});

  @override
  ConsumerState<TrackExpenseApp> createState() => _TrackExpenseAppState();
}

class _TrackExpenseAppState extends ConsumerState<TrackExpenseApp> with WidgetsBindingObserver {
  Timer? _smsTablePush;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    if (defaultTargetPlatform == TargetPlatform.android) {
      // Keep the SMS auto-add lookup table in step with the entries (D-029),
      // at most once every 2 seconds while entries are changing.
      ref.listenManual(smsCategoryTableProvider, fireImmediately: true, (_, table) {
        // Clear it only on a real sign-out, not while the session is loading.
        final session = ref.read(sessionProvider).value;
        if (table == null && (session == null || session.loading || session.ready)) return;
        _smsTablePush?.cancel();
        _smsTablePush = Timer(const Duration(seconds: 2), () {
          ref.read(smsDetectionProvider).pushCategoryTable(table).catchError((_) {});
        });
      });
    }
    final push = ref.read(pushServiceProvider);
    if (push == null) return;
    // Register this device once the user is in a household.
    ref.listenManual(sessionProvider, fireImmediately: true, (_, next) {
      final session = next.value;
      if (session != null && session.ready) push.register(session.user!.id);
    });
    push.onOpen((route) => ref.read(routerProvider).push(route));
  }

  @override
  void dispose() {
    _smsTablePush?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  // Entries may have been detected while the app was in the background.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) ref.invalidate(smsReviewQueueProvider);
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'Track Expense',
      debugShowCheckedModeBanner: false,
      theme: buildLedgerTheme(Brightness.light),
      darkTheme: buildLedgerTheme(Brightness.dark),
      themeMode: ref.watch(themeModeProvider),
      routerConfig: ref.watch(routerProvider),
    );
  }
}
