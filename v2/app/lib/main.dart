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

class _TrackExpenseAppState extends ConsumerState<TrackExpenseApp> {
  @override
  void initState() {
    super.initState();
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
