import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_app_check/firebase_app_check.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/misc.dart' show Override;

import '../core/data/firebase/firebase_session_repository.dart';
import '../core/data/firebase/firestore_household_repository.dart';
import '../core/data/firebase/functions_agent_repository.dart';
import '../core/data/firebase/push_service.dart';
import '../core/data/repositories.dart';
import '../firebase_options.dart';
import 'providers.dart';

/// Which backend the app talks to. Chosen at build time:
///
///   flutter run                                  (demo: in-memory sample data)
///   flutter run --dart-define=BACKEND=emulator   (local Firebase emulators)
///   flutter run --dart-define=BACKEND=firebase   (expense-tracker-v2-5c9fa)
const backendMode = String.fromEnvironment('BACKEND', defaultValue: 'demo');

/// Host of the Firebase emulators. The Android emulator reaches the Mac at
/// 10.0.2.2; override for a physical phone with `--dart-define=EMULATOR_HOST=`.
const _emulatorHostOverride = String.fromEnvironment('EMULATOR_HOST');

/// Must match REGION in v2/backend/functions/src/config.ts.
const _functionsRegion = 'asia-south1';

/// A household repository that fails loudly if used before sign-in. Screens
/// that need data are only reachable once the session is ready.
class _NoHousehold implements HouseholdRepository {
  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw StateError('No household: the user is not signed in yet');
}

/// Initialises Firebase when needed and returns the provider overrides for
/// the selected backend. Demo mode needs no overrides.
Future<List<Override>> backendOverrides({required String timeZone}) async {
  if (backendMode == 'demo') return const [];

  if (backendMode == 'emulator') {
    await Firebase.initializeApp(
      options: const FirebaseOptions(
        apiKey: 'demo-key',
        appId: '1:000000000000:android:0000000000000000',
        messagingSenderId: '000000000000',
        projectId: 'demo-track-expense',
      ),
    );
    final host = _emulatorHostOverride.isNotEmpty
        ? _emulatorHostOverride
        : (defaultTargetPlatform == TargetPlatform.android ? '10.0.2.2' : 'localhost');
    FirebaseFirestore.instance.useFirestoreEmulator(host, 8080);
    await FirebaseAuth.instance.useAuthEmulator(host, 9099);
    FirebaseFunctions.instanceFor(region: _functionsRegion).useFunctionsEmulator(host, 5001);
  } else {
    await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
    // Callable functions reject requests that do not come from this app.
    await FirebaseAppCheck.instance.activate(
      providerAndroid: kDebugMode
          ? const AndroidDebugProvider()
          : const AndroidPlayIntegrityProvider(),
      providerApple:
          kDebugMode ? const AppleDebugProvider() : const AppleAppAttestProvider(),
    );
  }

  final auth = FirebaseAuth.instance;
  final db = FirebaseFirestore.instance;
  final functions = FirebaseFunctions.instanceFor(region: _functionsRegion);

  return [
    sessionRepositoryProvider.overrideWithValue(
      FirebaseSessionRepository(auth: auth, firestore: db, functions: functions),
    ),
    householdRepositoryProvider.overrideWith((ref) {
      final session = ref.watch(sessionProvider).value;
      final user = session?.user;
      final homeId = session?.homeId;
      if (user == null || homeId == null) return _NoHousehold();
      return FirestoreHouseholdRepository(
        firestore: db,
        currentUserId: user.id,
        currentUserEmail: user.email,
        homeId: homeId,
      );
    }),
    agentRepositoryProvider.overrideWithValue(
      FunctionsAgentRepository(functions, timeZone: timeZone),
    ),
    // Push needs a real project; the emulators have no messaging service.
    if (backendMode == 'firebase')
      pushServiceProvider.overrideWithValue(PushService(FirebaseMessaging.instance, db)),
  ];
}
