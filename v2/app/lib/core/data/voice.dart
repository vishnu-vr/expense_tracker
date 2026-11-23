import 'dart:async';

import '../domain/voice.dart';
import 'agent.dart';

/// Something heard while listening.
sealed class VoiceHeard {
  const VoiceHeard();
}

/// Words so far; may still change.
class VoicePartial extends VoiceHeard {
  const VoicePartial(this.text);
  final String text;
}

/// The finished utterance. Empty when nothing was heard. Ends the stream.
class VoiceFinal extends VoiceHeard {
  const VoiceFinal(this.text);
  final String text;
}

enum VoiceErrorKind {
  /// Nothing recognisable was said (treated like an empty [VoiceFinal]).
  noSpeech,

  /// The microphone or speech permission was taken away.
  permission,

  /// The phone cannot recognise this language.
  language,

  /// Recognition needs a connection and there is none.
  network,
  other,
}

/// Listening failed. Ends the stream.
class VoiceError extends VoiceHeard {
  const VoiceError(this.kind);
  final VoiceErrorKind kind;
}

enum VoicePermission { granted, denied, unavailable }

/// The phone's speech recognition and text-to-speech (D-028). Screens use
/// this interface only; the device implementation wraps the plugins.
///
/// Transcripts and spoken text are never logged.
abstract class VoiceService {
  /// Asks for the microphone (and, on iOS, speech recognition) permission if
  /// needed. [VoicePermission.unavailable] means the phone has no recogniser.
  Future<VoicePermission> requestPermission();

  /// Locales for recognition and speech. Never shows a permission prompt, so
  /// recognition may be unknown (`null`) before the first conversation.
  Future<VoiceLocales> availableLocales();

  /// Listens once in [localeId]: partial results, then one [VoiceFinal] or
  /// [VoiceError], then the stream closes.
  Stream<VoiceHeard> listen(String localeId, {Duration pauseFor = talkPauseAfterSpeech});

  /// Speaks [text]; completes when finished or stopped.
  Future<void> speak(String text, String localeId);

  /// Stops listening and speaking immediately.
  Future<void> stop();

  /// A short repeating sound while the answer is being worked out.
  void thinking(bool on);

  /// Keeps the screen on while talking, so the phone does not lock mid-answer.
  void keepScreenOn(bool on);
}

/// The speech-relevant parts of reply blocks.
List<SpokenPart> spokenPartsOf(List<AgentBlock> blocks) => [
      for (final b in blocks)
        switch (b) {
          TextBlock(:final text) => SpokenText(text),
          StatBlock(:final label, :final value) => SpokenStat(label: label, value: value),
          BarsBlock() || TransactionsBlock() => const SpokenDetails(),
          ProposalBlock(:final summary) => SpokenProposal(summary),
        },
    ];

/// Scripted voice for demo mode and tests: each [listen] "hears" the next
/// utterance; when none are left it hears nothing (after [quietDelay]).
///
/// An utterance of the form `!error:<kind>` produces that [VoiceError].
class FakeVoiceService implements VoiceService {
  FakeVoiceService({
    List<String> utterances = const [],
    this.repeat = false,
    this.permission = VoicePermission.granted,
    this.locales = const VoiceLocales(
      recognition: {'en-IN', 'ml-IN'},
      speech: {'en-IN', 'ml-IN'},
    ),
    this.holdSpeech = false,
    this.delay = Duration.zero,
    this.quietDelay = const Duration(seconds: 3),
  })  : _script = List.of(utterances),
        _queue = List.of(utterances);

  /// The demo: one question, then "stop".
  factory FakeVoiceService.demo() => FakeVoiceService(
        utterances: const ['How much did we spend last month?', 'stop'],
        repeat: true,
        delay: const Duration(milliseconds: 900),
      );

  final List<String> _script;
  final List<String> _queue;
  final bool repeat;
  final VoicePermission permission;
  final VoiceLocales locales;

  /// When true, [speak] completes only on [stop] or [finishSpeaking].
  final bool holdSpeech;
  final Duration delay;
  final Duration quietDelay;

  final spoken = <String>[];
  final listenedIn = <String>[];
  final spokenIn = <String>[];
  var permissionRequests = 0;
  var stops = 0;
  var thinkingOn = false;
  var screenOn = false;
  Completer<void>? _speaking;

  bool get isSpeaking => _speaking != null && !_speaking!.isCompleted;

  /// Adds utterances to hear next.
  void say(List<String> utterances) => _queue.addAll(utterances);

  @override
  Future<VoicePermission> requestPermission() async {
    permissionRequests++;
    return permission;
  }

  @override
  Future<VoiceLocales> availableLocales() async => locales;

  @override
  Stream<VoiceHeard> listen(String localeId, {Duration pauseFor = talkPauseAfterSpeech}) async* {
    listenedIn.add(localeId);
    if (_queue.isEmpty && repeat) _queue.addAll(_script);
    if (_queue.isEmpty) {
      await Future<void>.delayed(quietDelay);
      yield const VoiceFinal('');
      return;
    }
    final u = _queue.removeAt(0);
    await Future<void>.delayed(delay);
    if (u.startsWith('!error:')) {
      final kind = VoiceErrorKind.values.byName(u.substring(7));
      yield VoiceError(kind);
      return;
    }
    final words = u.split(' ');
    if (words.length > 1) yield VoicePartial(words.take(words.length ~/ 2).join(' '));
    await Future<void>.delayed(delay);
    yield VoiceFinal(u);
  }

  @override
  Future<void> speak(String text, String localeId) async {
    spoken.add(text);
    spokenIn.add(localeId);
    if (holdSpeech) {
      _speaking = Completer<void>();
      await _speaking!.future;
    } else {
      await Future<void>.delayed(delay);
    }
  }

  /// Ends a held [speak] as if the phone finished talking.
  void finishSpeaking() => _speaking?.complete();

  @override
  Future<void> stop() async {
    stops++;
    if (isSpeaking) _speaking!.complete();
  }

  @override
  void thinking(bool on) => thinkingOn = on;

  @override
  void keepScreenOn(bool on) => screenOn = on;
}
