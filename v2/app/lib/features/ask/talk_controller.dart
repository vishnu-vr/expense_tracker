import 'dart:async';

import 'package:clock/clock.dart';
import 'package:flutter/foundation.dart';

import '../../core/data/agent.dart';
import '../../core/data/voice.dart';
import '../../core/domain/voice.dart';

/// Asks one question in the open conversation and returns the reply blocks,
/// or null when it failed. The turn shows in the thread like a typed one.
typedef TalkAsk = Future<List<AgentBlock>?> Function(String text, VoiceLanguage language);

/// Runs a hands-free conversation (D-028): carries out the [TalkMachine]'s
/// commands with a [VoiceService] and the Ask screen's [ask].
class TalkController extends ChangeNotifier {
  TalkController({
    required this.voice,
    required this.language,
    required this.hideAmounts,
    required this.ask,
    required this.onEnded,
  });

  final VoiceService voice;

  /// The language chosen in Profile; [choice] is what is actually used.
  final VoiceLanguage language;
  final bool Function() hideAmounts;
  final TalkAsk ask;
  final void Function(TalkEnd reason) onEnded;

  final machine = TalkMachine();
  VoiceLanguageChoice? choice;

  /// Shown under the state when English is used instead of the chosen language.
  String? note;

  /// True while the permission prompt may be showing (the app is briefly
  /// inactive then; that must not end the conversation).
  var requestingPermission = false;

  StreamSubscription<VoiceHeard>? _listening;
  var _speech = 0;
  DateTime _quietSince = clock.now();
  var _disposed = false;

  TalkPhase get phase => machine.phase;
  String get transcript => machine.transcript;

  Future<void> start() async {
    voice.keepScreenOn(true);
    requestingPermission = true;
    final permission = await voice.requestPermission();
    requestingPermission = false;
    if (_disposed) return;
    if (permission != VoicePermission.granted) {
      _run(machine.end(permission == VoicePermission.denied
          ? TalkEnd.permissionDenied
          : TalkEnd.unavailable));
      return;
    }
    final locales = await voice.availableLocales();
    if (_disposed) return;
    choice = resolveVoiceLanguage(language, locales);
    note = choice!.note;
    _run(machine.start());
  }

  void tap() => _run(machine.tap());
  void resume() => _run(machine.resume());
  void sendEdited(String text) => _run(machine.sendEdited(text));
  void end(TalkEnd reason) => _run(machine.end(reason));

  void _run(List<TalkCommand> commands) {
    if (_disposed) return;
    for (final c in commands) {
      switch (c) {
        case ListenCommand(:final fresh):
          _listen(fresh: fresh);
        case SendCommand(:final text):
          _send(text);
        case SpeakCommand(:final text):
          _speak(text);
        case StopAudioCommand():
          _stopAudio();
        case FinishCommand(:final reason):
          voice.keepScreenOn(false);
          voice.thinking(false);
          onEnded(reason);
      }
      if (_disposed) return;
    }
    notifyListeners();
  }

  void _stopAudio() {
    _speech++;
    _listening?.cancel();
    _listening = null;
    voice.stop();
  }

  void _listen({required bool fresh}) {
    if (fresh) _quietSince = clock.now();
    _listening?.cancel();
    final locale = choice?.recognitionLocale ?? language.localeId;
    var finished = false;
    void heardFinal(String text) {
      finished = true;
      _run(machine.heardFinal(text, quietFor: clock.now().difference(_quietSince)));
    }

    late final StreamSubscription<VoiceHeard> sub;
    sub = voice.listen(locale).listen(
      (h) {
        if (!identical(_listening, sub)) return;
        switch (h) {
          case VoicePartial(:final text):
            _run(machine.heardPartial(text));
          case VoiceFinal(:final text):
            heardFinal(text);
          case VoiceError(:final kind):
            finished = true;
            _onError(kind);
        }
      },
      onDone: () {
        if (identical(_listening, sub) && !finished) heardFinal('');
      },
    );
    _listening = sub;
  }

  void _onError(VoiceErrorKind kind) {
    switch (kind) {
      case VoiceErrorKind.noSpeech:
        _run(machine.heardFinal('', quietFor: clock.now().difference(_quietSince)));
      case VoiceErrorKind.permission:
        end(TalkEnd.permissionDenied);
      case VoiceErrorKind.language when choice?.language != VoiceLanguage.en:
        // The phone said it supports the language but cannot recognise it.
        choice = VoiceLanguageChoice(
          language: VoiceLanguage.en,
          recognitionLocale: VoiceLanguage.en.localeId,
          speechLocale: VoiceLanguage.en.localeId,
          note: recognitionFallbackNote(choice!.language),
        );
        note = choice!.note;
        _listen(fresh: true);
        notifyListeners();
      case VoiceErrorKind.language || VoiceErrorKind.network || VoiceErrorKind.other:
        end(TalkEnd.error);
    }
  }

  Future<void> _send(String text) async {
    final lang = choice?.language ?? VoiceLanguage.en;
    voice.thinking(true);
    List<AgentBlock>? blocks;
    try {
      blocks = await ask(text, lang);
    } catch (_) {
      blocks = null;
    }
    voice.thinking(false);
    if (_disposed || machine.phase != TalkPhase.thinking) return;
    final spoken = blocks == null
        ? TalkPhrases.of(lang).failed
        : spokenReply(spokenPartsOf(blocks), lang, hideAmounts: hideAmounts());
    _run(machine.answered(spoken));
  }

  Future<void> _speak(String text) async {
    final id = ++_speech;
    final locale = choice?.speechLocale ?? language.localeId;
    try {
      await voice.speak(text, locale);
    } catch (_) {}
    if (_disposed || id != _speech) return;
    _run(machine.spoken());
  }

  @override
  void dispose() {
    if (machine.isActive) {
      _stopAudio();
      voice.keepScreenOn(false);
      voice.thinking(false);
    }
    _disposed = true;
    super.dispose();
  }
}
