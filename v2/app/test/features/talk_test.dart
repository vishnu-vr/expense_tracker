import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:track_expense/app/providers.dart';
import 'package:track_expense/core/data/agent.dart';
import 'package:track_expense/core/data/firebase/functions_agent_repository.dart';
import 'package:track_expense/core/data/voice.dart';
import 'package:track_expense/core/domain/voice.dart';

import '../support/harness.dart';

typedef _Call = ({String message, String? reply, String? language, String? threadId});

/// Records each question and answers with a fixed reply.
class _VoiceAgent implements AgentRepository {
  _VoiceAgent([this.blocks = const [
    TextBlock('You spent ₹5,107 on Swiggy in October.'),
    StatBlock(label: 'Swiggy in October', value: '₹5,107', caption: '12 orders'),
  ]]);

  final List<AgentBlock> blocks;
  final calls = <_Call>[];

  @override
  Stream<AgentEvent> ask({
    String? threadId,
    required String message,
    String? model,
    String? reply,
    String? language,
  }) async* {
    calls.add((message: message, reply: reply, language: language, threadId: threadId));
    yield const AgentStatus('Thinking…');
    yield AgentDone(threadId: 't1', blocks: blocks);
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

Future<(_VoiceAgent, FakeVoiceService)> _pump(
  WidgetTester tester,
  FakeVoiceService voice, {
  _VoiceAgent? agent,
  Map<String, Object> prefs = const {},
}) async {
  final a = agent ?? _VoiceAgent();
  await pumpApp(tester, prefs: prefs, overrides: [
    agentRepositoryProvider.overrideWithValue(a),
    voiceServiceProvider.overrideWithValue(voice),
  ]);
  await _openAsk(tester);
  return (a, voice);
}

void main() {
  setUpAll(loadAppFonts);

  testWidgets('talk: the mic opens Talk; a question is sent as voice, answered aloud, '
      'then it listens again until "stop"', (tester) async {
    final (agent, voice) = await _pump(
        tester, FakeVoiceService(utterances: ['how much did we spend on Swiggy', 'how about Zomato', 'stop']));
    expect(find.byTooltip('Talk'), findsOneWidget);

    await tester.tap(find.byTooltip('Talk'));
    await tester.pumpAndSettle();

    expect(voice.permissionRequests, 1);
    expect(agent.calls.map((c) => c.message), ['how much did we spend on Swiggy', 'how about Zomato']);
    expect(agent.calls.every((c) => c.reply == 'voice' && c.language == 'en'), isTrue);
    expect(agent.calls.last.threadId, 't1'); // same conversation
    expect(voice.spoken, [
      'You spent ₹5,107 on Swiggy in October. The details are on screen.',
      'You spent ₹5,107 on Swiggy in October. The details are on screen.',
    ]);
    expect(voice.listenedIn, ['en-IN', 'en-IN', 'en-IN']);
    // "stop" ended it on the phone: never sent, panel gone, screen and cue released.
    expect(find.text('Listening'), findsNothing);
    expect(find.text('End'), findsNothing);
    expect(voice.screenOn, isFalse);
    expect(voice.thinkingOn, isFalse);
    // The turns are in the thread like typed ones.
    expect(find.text('how much did we spend on Swiggy'), findsOneWidget);
    expect(find.text('SWIGGY IN OCTOBER'), findsNWidgets(2));
    expect(tester.takeException(), isNull);
  });

  testWidgets('talk: a tap interrupts the answer and listens again; End closes it', (tester) async {
    final (agent, voice) = await _pump(
        tester, FakeVoiceService(utterances: ['how much on Swiggy'], holdSpeech: true));
    await tester.tap(find.byTooltip('Talk'));
    await tester.pumpAndSettle();
    expect(find.text('Speaking'), findsOneWidget);
    expect(find.text('Tap to interrupt.'), findsOneWidget);
    expect(voice.isSpeaking, isTrue);
    expect(voice.screenOn, isTrue);

    await tester.tap(find.text('Tap to interrupt.'));
    await tester.pump();
    expect(voice.isSpeaking, isFalse);
    expect(voice.stops, greaterThan(0));
    expect(find.text('Listening'), findsOneWidget);
    expect(voice.listenedIn, hasLength(2));

    await tester.tap(find.text('End'));
    await tester.pumpAndSettle();
    expect(find.text('Listening'), findsNothing);
    expect(find.byTooltip('Talk'), findsOneWidget);
    expect(agent.calls, hasLength(1));
    expect(voice.screenOn, isFalse);
    await tester.pump(const Duration(seconds: 5)); // let the fake's cancelled listen run out
    expect(tester.takeException(), isNull);
  });

  testWidgets('talk: about 8 s of silence ends the conversation', (tester) async {
    final (agent, voice) = await _pump(tester, FakeVoiceService());
    await tester.tap(find.byTooltip('Talk'));
    await tester.pump();
    expect(find.text('Listening'), findsOneWidget);
    await tester.pump(const Duration(seconds: 3));
    await tester.pump(const Duration(seconds: 3));
    expect(find.text('Listening'), findsOneWidget); // still listening after 6 s
    await tester.pump(const Duration(seconds: 3));
    await tester.pump();
    expect(find.text('Listening'), findsNothing);
    expect(find.text('Talk ended after a quiet spell.'), findsOneWidget);
    expect(voice.listenedIn, hasLength(3));
    expect(agent.calls, isEmpty);
    await toastGone(tester);
  });

  testWidgets('talk: a tap while listening pauses so the transcript can be fixed', (tester) async {
    final (agent, voice) = await _pump(tester,
        FakeVoiceService(utterances: ['how much did we spend on uber'], delay: const Duration(seconds: 1)));
    await tester.tap(find.byTooltip('Talk'));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('how much did'), findsOneWidget); // partial transcript
    await tester.tap(find.text('how much did'));
    await tester.pump();
    expect(find.text('Paused'), findsOneWidget);

    await tester.enterText(find.byType(TextField), 'how much did we spend on Uber');
    expect(find.byType(TextField), findsOneWidget);
    await tester.tap(find.text('Send'));
    await tester.pumpAndSettle();
    expect(agent.calls.single.message, 'how much did we spend on Uber');
    expect(agent.calls.single.reply, 'voice');
    expect(voice.spoken, hasLength(1));
    await tester.tap(find.text('End'));
    await tester.pumpAndSettle();
    await tester.pump(const Duration(seconds: 5)); // let the fake's cancelled listen run out
    expect(tester.takeException(), isNull);
  });

  testWidgets('talk: with Hide amounts on, no figures are spoken', (tester) async {
    final (_, voice) = await _pump(
      tester,
      FakeVoiceService(utterances: ['how much on Swiggy', 'stop']),
      prefs: {'hideAmounts': true},
      agent: _VoiceAgent(const [
        TextBlock('You spent ₹5,107 on Swiggy in October. That is 12 orders.'),
        StatBlock(label: 'Swiggy', value: '₹5,107'),
        ProposalBlock(proposalId: 'p1', action: 'set_budget', summary: 'Set the Food budget to ₹14,000'),
      ]),
    );
    await tester.tap(find.byTooltip('Talk'));
    await tester.pumpAndSettle();
    expect(voice.spoken.single,
        'That is 12 orders. I\'ve suggested a change. Tap Confirm on screen to apply it. '
        'Amounts are hidden, the answer is on screen.');
    expect(voice.spoken.single, isNot(contains('₹')));
    expect(voice.spoken.single, isNot(contains('5,107')));
    // The proposal still waits for a tap.
    expect(find.text('Confirm'), findsOneWidget);
  });

  testWidgets('talk: Malayalam is sent and spoken in ml-IN', (tester) async {
    final (agent, voice) = await _pump(
      tester,
      FakeVoiceService(utterances: ['കഴിഞ്ഞ മാസം എത്ര ചെലവായി', 'മതി']),
      prefs: {'voiceLanguage': 'ml'},
      agent: _VoiceAgent(const [TextBlock('കഴിഞ്ഞ മാസം ₹84,151.25 ചെലവായി.'), BarsBlock(items: [])]),
    );
    await tester.tap(find.byTooltip('Talk'));
    await tester.pumpAndSettle();
    expect(agent.calls.single.language, 'ml');
    expect(voice.listenedIn, ['ml-IN', 'ml-IN']);
    expect(voice.spokenIn, ['ml-IN']);
    expect(voice.spoken.single, 'കഴിഞ്ഞ മാസം ₹84,151.25 ചെലവായി. വിശദാംശങ്ങൾ സ്ക്രീനിൽ ഉണ്ട്.');
    expect(find.text('Listening'), findsNothing); // "മതി" ended it
  });

  testWidgets('talk: without Malayalam on the phone, English is used with a note', (tester) async {
    final (agent, voice) = await _pump(
      tester,
      FakeVoiceService(
        utterances: ['how much last month'],
        holdSpeech: true,
        locales: const VoiceLocales(recognition: {'en-IN'}, speech: {'en-IN', 'ml-IN'}),
      ),
      prefs: {'voiceLanguage': 'ml'},
    );
    await tester.tap(find.byTooltip('Talk'));
    await tester.pumpAndSettle();
    expect(find.text('This phone can\'t recognise Malayalam speech, so English is used.'), findsOneWidget);
    expect(agent.calls.single.language, 'en');
    expect(voice.listenedIn.first, 'en-IN');
    await tester.tap(find.text('End'));
    await tester.pumpAndSettle();
  });

  testWidgets('talk: recognition failing in Malayalam switches to English', (tester) async {
    final (agent, voice) = await _pump(
      tester,
      FakeVoiceService(utterances: ['!error:language', 'how much last month'], holdSpeech: true),
      prefs: {'voiceLanguage': 'ml'},
    );
    await tester.tap(find.byTooltip('Talk'));
    await tester.pumpAndSettle();
    expect(voice.listenedIn, ['ml-IN', 'en-IN']);
    expect(agent.calls.single.language, 'en');
    expect(find.text(recognitionFallbackNote(VoiceLanguage.ml)), findsOneWidget);
    await tester.tap(find.text('End'));
    await tester.pumpAndSettle();
  });

  testWidgets('talk: denied microphone permission is explained and nothing is sent', (tester) async {
    final (agent, voice) =
        await _pump(tester, FakeVoiceService(permission: VoicePermission.denied, utterances: ['hi']));
    await tester.tap(find.byTooltip('Talk'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Talking needs the microphone'), findsOneWidget);
    expect(find.text('Listening'), findsNothing);
    expect(voice.listenedIn, isEmpty);
    expect(agent.calls, isEmpty);
    expect(voice.screenOn, isFalse);
    await toastGone(tester);
  });

  testWidgets('profile: Voice language sheet saves Malayalam and notes missing support', (tester) async {
    await pumpApp(tester, overrides: [
      voiceServiceProvider.overrideWithValue(FakeVoiceService(
          locales: const VoiceLocales(recognition: {'en-IN'}, speech: {'en-IN'}))),
    ]);
    await tester.tap(find.byTooltip('Profile and settings'));
    await tester.pumpAndSettle();
    expect(find.text('English (India)'), findsOneWidget);

    await tapVisible(tester, find.text('Voice language'));
    expect(find.text('Malayalam'), findsOneWidget);
    await tester.tap(find.text('Malayalam'));
    await tester.pumpAndSettle();
    final sp = await SharedPreferences.getInstance();
    expect(sp.getString('voiceLanguage'), 'ml');
    expect(find.text('Malayalam · This phone has no Malayalam speech support, so English is used.'),
        findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  test('askAgent payload carries reply and language only when set', () {
    expect(
      FunctionsAgentRepository.askPayload(
          message: 'hi', timeZone: 'Asia/Kolkata', reply: 'voice', language: 'ml'),
      {'message': 'hi', 'timeZone': 'Asia/Kolkata', 'reply': 'voice', 'language': 'ml'},
    );
    expect(FunctionsAgentRepository.askPayload(message: 'hi', timeZone: 'Asia/Kolkata'),
        {'message': 'hi', 'timeZone': 'Asia/Kolkata'});
  });

  test('voice language setting persists and ignores unknown keys', () async {
    SharedPreferences.setMockInitialValues({'voiceLanguage': 'ta'});
    final sp = await SharedPreferences.getInstance();
    expect(voiceLanguageOf(sp.getString('voiceLanguage')), VoiceLanguage.en);
  });

  test('reply blocks map to spoken parts', () {
    final parts = spokenPartsOf([
      const TextBlock('t'),
      const StatBlock(label: 'l', value: 'v'),
      const BarsBlock(items: []),
      const TransactionsBlock([]),
      const ProposalBlock(proposalId: 'p', action: 'set_budget', summary: 's'),
    ]);
    expect(parts.map((p) => p.runtimeType.toString()),
        ['SpokenText', 'SpokenStat', 'SpokenDetails', 'SpokenDetails', 'SpokenProposal']);
  });
}
