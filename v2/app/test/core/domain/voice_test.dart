import 'package:flutter_test/flutter_test.dart';
import 'package:track_expense/core/domain/voice.dart';

void main() {
  group('isStopPhrase', () {
    test('English stop phrases, with punctuation, case and fillers', () {
      for (final s in [
        'stop', 'Stop.', 'STOP!', 'that\'s all', 'That’s all', 'that is all', 'bye', 'Bye bye',
        'goodbye', 'okay stop', 'stop please', 'thanks, bye', 'thank you', 'I\'m done', 'nothing else',
      ]) {
        expect(isStopPhrase(s), isTrue, reason: s);
      }
    });

    test('Malayalam stop phrases, including old-style chillu and transliteration', () {
      for (final s in ['നിർത്തൂ', 'നിര്‍ത്തൂ', 'മതി', 'മതി.', 'അത്ര മതി', 'ശരി മതി', 'ബൈ', 'നന്ദി', 'mathi', 'nirthu']) {
        expect(isStopPhrase(s), isTrue, reason: s);
      }
    });

    test('questions that merely contain a stop word are not stop phrases', () {
      for (final s in [
        'How much did we spend at the bus stop?',
        'stop the Netflix subscription?',
        'When did the gym membership end?',
        'മതിയായ ബജറ്റ് ഉണ്ടോ?',
        'Is that all we spent on food?',
        '',
      ]) {
        expect(isStopPhrase(s), isFalse, reason: s);
      }
    });
  });

  group('resolveVoiceLanguage', () {
    const both = VoiceLocales(recognition: {'en_IN', 'en_US', 'ml_IN'}, speech: {'en-IN', 'ml-IN'});

    test('uses the device ids for the chosen language', () {
      final ml = resolveVoiceLanguage(VoiceLanguage.ml, both);
      expect(ml.language, VoiceLanguage.ml);
      expect(ml.recognitionLocale, 'ml_IN');
      expect(ml.speechLocale, 'ml-IN');
      expect(ml.note, isNull);
      final en = resolveVoiceLanguage(VoiceLanguage.en, both);
      expect((en.language, en.recognitionLocale, en.speechLocale), (VoiceLanguage.en, 'en_IN', 'en-IN'));
    });

    test('falls back to English with a note when Malayalam recognition or voice is missing', () {
      final noHear = resolveVoiceLanguage(
          VoiceLanguage.ml, const VoiceLocales(recognition: {'en-IN'}, speech: {'en-IN', 'ml-IN'}));
      expect(noHear.language, VoiceLanguage.en);
      expect(noHear.recognitionLocale, 'en-IN');
      expect(noHear.note, 'This phone can\'t recognise Malayalam speech, so English is used.');

      final noVoice = resolveVoiceLanguage(
          VoiceLanguage.ml, const VoiceLocales(recognition: {'ml-IN'}, speech: {'en-US'}));
      expect(noVoice.language, VoiceLanguage.en);
      expect(noVoice.speechLocale, 'en-US');
      expect(noVoice.note, 'This phone has no Malayalam voice, so English is used.');

      final neither = resolveVoiceLanguage(
          VoiceLanguage.ml, const VoiceLocales(recognition: {'en-IN'}, speech: {'en-IN'}));
      expect(neither.note, 'This phone has no Malayalam speech support, so English is used.');
    });

    test('unknown support is treated as available (checked again while listening)', () {
      final ml = resolveVoiceLanguage(VoiceLanguage.ml, const VoiceLocales());
      expect((ml.language, ml.recognitionLocale, ml.speechLocale, ml.note),
          (VoiceLanguage.ml, 'ml-IN', 'ml-IN', null));
    });

    test('stored keys', () {
      expect(voiceLanguageOf('ml'), VoiceLanguage.ml);
      expect(voiceLanguageOf(null), VoiceLanguage.en);
      expect(voiceLanguageOf('ta'), VoiceLanguage.en);
      expect(VoiceLanguage.values.map((l) => l.key), ['en', 'ml']); // = AGENT_LANGUAGES on the server
    });
  });

  group('spokenReply', () {
    String say(List<SpokenPart> parts, {VoiceLanguage lang = VoiceLanguage.en, bool hide = false}) =>
        spokenReply(parts, lang, hideAmounts: hide);

    test('reads the spoken answer (first text block) and points to the details', () {
      expect(
        say(const [
          SpokenText('You spent ₹84,151.25 in October. That is more than September.'),
          SpokenStat(label: 'Spent in October', value: '₹84,151.25'),
          SpokenDetails(),
          SpokenText('Food was the biggest part.'),
        ]),
        'You spent ₹84,151.25 in October. That is more than September. The details are on screen.',
      );
    });

    test('a text-only answer of up to two sentences is read in full', () {
      expect(say(const [SpokenText('You spent ₹1,518.44 on Uber.')]), 'You spent ₹1,518.44 on Uber.');
      expect(say(const [SpokenText('One. Two. Three.')]), 'One. Two. The details are on screen.');
      expect(say(const [SpokenText('**Food** is up')]), 'Food is up.');
    });

    test('without text, the first stat is read', () {
      expect(say(const [SpokenStat(label: 'Spent in October', value: '₹84,151.25'), SpokenDetails()]),
          'Spent in October: ₹84,151.25. The details are on screen.');
      expect(say(const [SpokenDetails()]), 'The details are on screen.');
      expect(say(const []), 'The answer is on screen.');
    });

    test('proposals are described and confirmed only by tapping', () {
      expect(
        say(const [
          SpokenText('I can change the food budget for you.'),
          SpokenProposal('Change the monthly Food budget from ₹12,000 to ₹14,000'),
        ]),
        'I can change the food budget for you. '
        'I\'ve suggested: Change the monthly Food budget from ₹12,000 to ₹14,000. '
        'Tap Confirm on screen to apply it.',
      );
    });

    test('Hide amounts: no figures are ever spoken', () {
      final hidden = say(const [
        SpokenText('You spent ₹84,151.25 in October. Food was the biggest category.'),
        SpokenStat(label: 'Spent', value: '₹84,151.25'),
        SpokenProposal('Change the monthly Food budget from ₹12,000 to ₹14,000'),
      ], hide: true);
      expect(hidden,
          'Food was the biggest category. I\'ve suggested a change. Tap Confirm on screen to apply it. '
          'Amounts are hidden, the answer is on screen.');
      expect(RegExp(r'\d').hasMatch(hidden), isFalse);

      for (final text in [
        'You spent Rs. 5,107 on Swiggy.',
        'That came to 5107 rupees.',
        'Total 1,71,518 this year.',
        'It was 742.50 each.',
        'INR 500 went on tea.',
      ]) {
        expect(say([SpokenText(text)], hide: true), 'Amounts are hidden, the answer is on screen.', reason: text);
      }
      expect(say(const [SpokenStat(label: 'Spent', value: '₹500')], hide: true),
          'Amounts are hidden, the answer is on screen.');
      // Without amounts nothing is withheld.
      expect(say(const [SpokenText('Food was the biggest category.')], hide: true), 'Food was the biggest category.');
    });

    test('Malayalam phrases; amounts stay as digits', () {
      expect(
        say(const [SpokenText('കഴിഞ്ഞ മാസം ₹84,151.25 ചെലവായി.'), SpokenDetails()], lang: VoiceLanguage.ml),
        'കഴിഞ്ഞ മാസം ₹84,151.25 ചെലവായി. വിശദാംശങ്ങൾ സ്ക്രീനിൽ ഉണ്ട്.',
      );
      expect(
        say(const [SpokenText('കഴിഞ്ഞ മാസം 84,151 രൂപ ചെലവായി.')], lang: VoiceLanguage.ml, hide: true),
        'തുകകൾ മറച്ചിരിക്കുന്നു, ഉത്തരം സ്ക്രീനിൽ ഉണ്ട്.',
      );
      expect(
        say(const [SpokenProposal('Change the monthly Food budget to ₹14,000')], lang: VoiceLanguage.ml),
        'ഞാൻ ഒരു മാറ്റം നിർദ്ദേശിച്ചിട്ടുണ്ട്. അത് ചെയ്യാൻ സ്ക്രീനിലെ Confirm ടാപ്പ് ചെയ്യൂ.',
      );
    });
  });

  group('TalkMachine', () {
    test('listen → think → speak → listen again', () {
      final m = TalkMachine();
      expect(m.start().single, isA<ListenCommand>().having((c) => c.fresh, 'fresh', true));
      expect(m.phase, TalkPhase.listening);
      expect(m.heardPartial('how much'), isEmpty);
      expect(m.transcript, 'how much');
      final send = m.heardFinal('how much did we spend', quietFor: const Duration(seconds: 2));
      expect(send.single, isA<SendCommand>().having((c) => c.text, 'text', 'how much did we spend'));
      expect(m.phase, TalkPhase.thinking);
      expect(m.answered('You spent ₹5.').single, isA<SpeakCommand>());
      expect(m.phase, TalkPhase.speaking);
      expect(m.spoken().single, isA<ListenCommand>().having((c) => c.fresh, 'fresh', true));
      expect(m.phase, TalkPhase.listening);
      expect(m.transcript, '');
    });

    test('a stop phrase ends it without sending', () {
      final m = TalkMachine()..start();
      final c = m.heardFinal('That\'s all', quietFor: Duration.zero);
      expect(c.whereType<SendCommand>(), isEmpty);
      expect(c.last, isA<FinishCommand>().having((f) => f.reason, 'reason', TalkEnd.stopPhrase));
      expect(m.phase, TalkPhase.ended);
    });

    test('silence: listens again until the limit, then ends', () {
      final m = TalkMachine()..start();
      expect(m.heardFinal('', quietFor: const Duration(seconds: 4)).single,
          isA<ListenCommand>().having((c) => c.fresh, 'fresh', false));
      final c = m.heardFinal('  ', quietFor: const Duration(seconds: 8));
      expect(c.last, isA<FinishCommand>().having((f) => f.reason, 'reason', TalkEnd.silence));
    });

    test('a tap interrupts speaking and listens; a tap while listening pauses for editing', () {
      final m = TalkMachine()..start();
      m.heardFinal('q', quietFor: Duration.zero);
      m.answered('a');
      final c = m.tap();
      expect(c.first, isA<StopAudioCommand>());
      expect(c.last, isA<ListenCommand>());
      expect(m.phase, TalkPhase.listening);

      m.heardPartial('how much did we spnd');
      expect(m.tap().single, isA<StopAudioCommand>());
      expect(m.phase, TalkPhase.paused);
      expect(m.transcript, 'how much did we spnd');
      // A late result after pausing is ignored.
      expect(m.heardFinal('late', quietFor: Duration.zero), isEmpty);
      expect(m.sendEdited('how much did we spend').single,
          isA<SendCommand>().having((s) => s.text, 'text', 'how much did we spend'));

      final m2 = TalkMachine()..start();
      m2.tap();
      expect(m2.resume().single, isA<ListenCommand>());
      expect(m2.phase, TalkPhase.listening);
    });

    test('taps while thinking are ignored; end works from any phase once', () {
      final m = TalkMachine()..start();
      m.heardFinal('q', quietFor: Duration.zero);
      expect(m.tap(), isEmpty);
      expect(m.phase, TalkPhase.thinking);
      final c = m.end(TalkEnd.endButton);
      expect(c.first, isA<StopAudioCommand>());
      expect(m.endedBy, TalkEnd.endButton);
      expect(m.end(TalkEnd.backgrounded), isEmpty);
      // The answer arriving after End is dropped.
      expect(m.answered('late'), isEmpty);
      expect(TalkMachine().end(TalkEnd.permissionDenied).last,
          isA<FinishCommand>().having((f) => f.reason, 'reason', TalkEnd.permissionDenied));
    });
  });
}
