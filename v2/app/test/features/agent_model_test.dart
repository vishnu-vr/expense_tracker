import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:track_expense/app/providers.dart';
import 'package:track_expense/core/data/agent.dart';
import 'package:track_expense/core/data/firebase/functions_agent_repository.dart';
import 'package:track_expense/core/domain/agent_models.dart';

import '../support/harness.dart';

/// Records the model key each question was sent with.
class _RecordingAgent implements AgentRepository {
  final models = <String?>[];

  @override
  Stream<AgentEvent> ask({String? threadId, required String message, String? model, String? reply, String? language}) async* {
    models.add(model);
    yield const AgentDone(threadId: 't1', blocks: [TextBlock('ok')]);
  }

  @override
  Future<void> resolveProposal(
      {required String threadId, required String proposalId, required bool accept}) async {}
}

Future<void> _openAsk(WidgetTester tester) async {
  await tester.tap(find.text('Insights').last);
  await tester.pumpAndSettle();
  await tester.tap(find.text('Ask'));
  await tester.pumpAndSettle();
}

void main() {
  setUpAll(loadAppFonts);

  group('options', () {
    test('keys match the server allowlist and unknown keys fall back to the default', () {
      expect(agentModelOptions.map((o) => o.key), ['flash', 'flash-lite']);
      expect(agentModelOption('flash-lite').label, 'Gemini Flash-Lite');
      expect(agentModelOption(null).key, defaultAgentModelKey);
      expect(agentModelOption('retired-model').key, defaultAgentModelKey);
    });

    test('setting defaults to flash, persists, and ignores unknown stored keys', () async {
      SharedPreferences.setMockInitialValues({});
      final sp = await SharedPreferences.getInstance();
      final c = ProviderContainer(overrides: [sharedPreferencesProvider.overrideWithValue(sp)]);
      addTearDown(c.dispose);
      expect(c.read(agentModelProvider), 'flash');
      c.read(agentModelProvider.notifier).set('flash-lite');
      expect(c.read(agentModelProvider), 'flash-lite');
      expect(sp.getString('agentModel'), 'flash-lite');

      SharedPreferences.setMockInitialValues({'agentModel': 'gone'});
      final sp2 = await SharedPreferences.getInstance();
      final c2 = ProviderContainer(overrides: [sharedPreferencesProvider.overrideWithValue(sp2)]);
      addTearDown(c2.dispose);
      expect(c2.read(agentModelProvider), 'flash');
    });

    test('askAgent payload carries the model key only when set', () {
      expect(
        FunctionsAgentRepository.askPayload(
            threadId: 't1', message: 'hi', timeZone: 'Asia/Kolkata', model: 'flash-lite'),
        {'threadId': 't1', 'message': 'hi', 'timeZone': 'Asia/Kolkata', 'model': 'flash-lite'},
      );
      expect(
        FunctionsAgentRepository.askPayload(message: 'hi', timeZone: 'Asia/Kolkata'),
        {'message': 'hi', 'timeZone': 'Asia/Kolkata'},
      );
    });
  });

  testWidgets('profile: the Assistant sheet changes the model', (tester) async {
    await pumpApp(tester);
    await tester.tap(find.byTooltip('Profile and settings'));
    await tester.pumpAndSettle();

    await tapVisible(tester, find.text('Model'));
    await tester.pumpAndSettle();
    expect(find.text('Assistant model'), findsOneWidget);
    expect(find.text('Best answers'), findsOneWidget);
    expect(find.text('Cheaper, may miss harder questions'), findsOneWidget);

    await tester.tap(find.text('Gemini Flash-Lite'));
    await tester.pumpAndSettle();
    expect(find.text('Assistant model'), findsNothing);
    expect(find.text('Gemini Flash-Lite'), findsOneWidget); // the row's subtitle
    final sp = await SharedPreferences.getInstance();
    expect(sp.getString('agentModel'), 'flash-lite');
    expect(tester.takeException(), isNull);
  });

  testWidgets('ask: the caption names the chosen model and questions carry its key',
      (tester) async {
    final agent = _RecordingAgent();
    await pumpApp(tester,
        prefs: {'agentModel': 'flash-lite'},
        overrides: [agentRepositoryProvider.overrideWithValue(agent)]);
    await _openAsk(tester);
    expect(find.text('Using Gemini Flash-Lite'), findsOneWidget);

    await tester.tap(find.text('Where can we cut back?'));
    await tester.pumpAndSettle();
    expect(agent.models, ['flash-lite']);
    expect(tester.takeException(), isNull);
  });

  testWidgets('ask: the default model is Gemini Flash', (tester) async {
    await pumpApp(tester);
    await _openAsk(tester);
    expect(find.text('Using Gemini Flash'), findsOneWidget);
  });
}
