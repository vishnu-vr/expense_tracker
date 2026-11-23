import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:track_expense/app/providers.dart';
import 'package:track_expense/core/data/session.dart';
import 'package:track_expense/main.dart';

import '../support/harness.dart';

/// Session repository whose state the test drives directly.
class _ScriptedSession extends DemoSessionRepository {
  final _states = StreamController<Session>.broadcast();
  Session _current = const Session.loading();

  void emit(Session s) {
    _current = s;
    _states.add(s);
  }

  @override
  Stream<Session> watch() => Stream.multi((c) {
        c.add(_current);
        final sub = _states.stream.listen(c.add);
        c.onCancel = sub.cancel;
      });
}

void main() {
  testWidgets('routes follow the session: loading, signed out, no home, ready', (tester) async {
    final session = _ScriptedSession();
    SharedPreferences.setMockInitialValues({});
    final sp = await SharedPreferences.getInstance();
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(ProviderScope(
      overrides: [
        nowProvider.overrideWithValue(testNow),
        sharedPreferencesProvider.overrideWithValue(sp),
        sessionRepositoryProvider.overrideWithValue(session),
      ],
      child: const TrackExpenseApp(),
    ));
    await tester.pump();
    expect(find.byType(CircularProgressIndicator), findsOneWidget);

    session.emit(const Session());
    await tester.pumpAndSettle();
    expect(find.text('Continue with Google'), findsOneWidget);

    const user = AppUser(id: 'u1', email: 'a@x.in', name: 'Asha');
    session.emit(const Session(user: user));
    await tester.pumpAndSettle();
    expect(find.text('Set up your household'), findsOneWidget);

    session.emit(const Session(user: user, homeId: 'demo'));
    await tester.pumpAndSettle();
    expect(find.text('NET THIS MONTH'), findsOneWidget);

    // Deep links to gated screens bounce back once signed out.
    session.emit(const Session());
    await tester.pumpAndSettle();
    expect(find.text('NET THIS MONTH'), findsNothing);
    expect(find.text('Continue with Google'), findsOneWidget);
  });
}
