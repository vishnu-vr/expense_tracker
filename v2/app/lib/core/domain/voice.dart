/// Voice conversation with the assistant (D-028): languages, stop phrases,
/// what gets spoken, and the hands-free state machine. Pure Dart.
library;

// ---- languages ---------------------------------------------------------------

/// Languages the user can talk in. [key] is what `askAgent` receives as
/// `language` (must match `AGENT_LANGUAGES` in `backend/functions/src/config.ts`).
enum VoiceLanguage {
  en('en', 'en-IN', 'English (India)'),
  ml('ml', 'ml-IN', 'Malayalam');

  const VoiceLanguage(this.key, this.localeId, this.label);

  final String key;

  /// BCP-47 locale used for recognition and speech when the phone offers it.
  final String localeId;
  final String label;
}

const defaultVoiceLanguage = VoiceLanguage.en;

/// The language for a stored [key]; unknown or missing gives English.
VoiceLanguage voiceLanguageOf(String? key) =>
    VoiceLanguage.values.where((l) => l.key == key).firstOrNull ?? defaultVoiceLanguage;

/// Locales the phone reports. `null` means unknown (for example recognition
/// before the microphone permission is granted); unknown is treated as
/// available and checked again when listening starts.
class VoiceLocales {
  const VoiceLocales({this.recognition, this.speech});

  final Set<String>? recognition;
  final Set<String>? speech;
}

/// The language actually used, with the device locale ids to pass on.
class VoiceLanguageChoice {
  const VoiceLanguageChoice({
    required this.language,
    required this.recognitionLocale,
    required this.speechLocale,
    this.note,
  });

  final VoiceLanguage language;
  final String recognitionLocale;
  final String speechLocale;

  /// Set when the wanted language is not available and English is used.
  final String? note;
}

String _norm(String id) => id.toLowerCase().replaceAll('_', '-');

/// The device's id for [language]: the exact locale (en-IN), else any
/// regional variant (en-GB), else null. Unknown or empty sets give the default id.
String? _match(Set<String>? available, VoiceLanguage language) {
  if (available == null || available.isEmpty) return language.localeId;
  final want = _norm(language.localeId);
  for (final id in available) {
    if (_norm(id) == want) return id;
  }
  for (final id in available) {
    final n = _norm(id);
    if (n == language.key || n.startsWith('${language.key}-')) return id;
  }
  return null;
}

/// Picks the language to talk in. Malayalam needs both recognition and a
/// voice; otherwise English is used with a [VoiceLanguageChoice.note].
VoiceLanguageChoice resolveVoiceLanguage(VoiceLanguage wanted, VoiceLocales available) {
  final english = VoiceLanguageChoice(
    language: VoiceLanguage.en,
    recognitionLocale: _match(available.recognition, VoiceLanguage.en) ?? VoiceLanguage.en.localeId,
    speechLocale: _match(available.speech, VoiceLanguage.en) ?? VoiceLanguage.en.localeId,
  );
  if (wanted == VoiceLanguage.en) return english;
  final hear = _match(available.recognition, wanted);
  final say = _match(available.speech, wanted);
  if (hear != null && say != null) {
    return VoiceLanguageChoice(language: wanted, recognitionLocale: hear, speechLocale: say);
  }
  final missing = hear == null && say == null
      ? 'no ${wanted.label} speech support'
      : hear == null
          ? 'can\'t recognise ${wanted.label} speech'
          : 'has no ${wanted.label} voice';
  return VoiceLanguageChoice(
    language: VoiceLanguage.en,
    recognitionLocale: english.recognitionLocale,
    speechLocale: english.speechLocale,
    note: hear == null && say == null
        ? 'This phone has $missing, so English is used.'
        : 'This phone $missing, so English is used.',
  );
}

/// Note shown when recognition in [wanted] fails while talking.
String recognitionFallbackNote(VoiceLanguage wanted) =>
    'This phone can\'t recognise ${wanted.label} speech, so English is used.';

// ---- stop phrases ------------------------------------------------------------

const _stopPhrases = {
  // English
  'stop', 'stop it', 'stop now', 'stop listening', 'stop talking',
  'that\'s all', 'thats all', 'that is all', 'that\'s it', 'thats it', 'that is it',
  'bye', 'bye bye', 'goodbye', 'good bye', 'end', 'end chat', 'end it',
  'i\'m done', 'im done', 'i am done', 'done', 'nothing else', 'no more',
  'cancel', 'exit', 'quit', 'thank you', 'thanks',
  // Malayalam
  'നിർത്തൂ', 'നിർത്തു', 'നിർത്ത്', 'നിർത്താം', 'നിർത്തിക്കോ', 'മതി', 'മതി നിർത്തൂ',
  'മതി നിർത്തു', 'ഇത്ര മതി', 'അത്ര മതി', 'ഇനി മതി', 'അത്രേ ഉള്ളൂ', 'അത്ര മാത്രം', 'ശരി മതി',
  'ബൈ', 'ടാറ്റാ', 'നന്ദി',
  // Malayalam as an English recogniser may write it
  'nirthu', 'nirthoo', 'mathi', 'mathi nirthu', 'athra mathi', 'ini mathi',
};

const _fillers = {'ok', 'okay', 'please', 'thanks', 'thank you', 'so', 'ശരി', 'നന്ദി', 'ok then'};

String _normalisePhrase(String text) {
  var t = text
      .toLowerCase()
      .replaceAll('ര്‍', 'ർ') // old-style chillu → atomic
      .replaceAll(RegExp('[‌‍]'), '')
      .replaceAll('’', '\'')
      .replaceAll(RegExp(r'''[.,!?;:"“”()\-]'''), ' ')
      .replaceAll(RegExp(r'\s+'), ' ')
      .trim();
  // Drop a leading or trailing filler ("okay stop", "stop please", "thanks bye").
  for (final f in _fillers) {
    if (t.startsWith('$f ') && _stopPhrases.contains(t.substring(f.length + 1))) {
      t = t.substring(f.length + 1);
    }
    if (t.endsWith(' $f') && _stopPhrases.contains(t.substring(0, t.length - f.length - 1))) {
      t = t.substring(0, t.length - f.length - 1);
    }
  }
  return t;
}

/// True when the whole utterance asks to end the conversation ("stop",
/// "that's all", "മതി"). A question that merely contains "stop" is not one.
/// Handled on the phone; never sent to the server.
bool isStopPhrase(String text) => _stopPhrases.contains(_normalisePhrase(text));

// ---- what gets spoken ----------------------------------------------------------

/// The parts of a reply that matter for speech (built from the reply blocks).
sealed class SpokenPart {
  const SpokenPart();
}

class SpokenText extends SpokenPart {
  const SpokenText(this.text);
  final String text;
}

class SpokenStat extends SpokenPart {
  const SpokenStat({required this.label, required this.value});
  final String label;
  final String value;
}

/// Bars and entry lists: never read out, only pointed to.
class SpokenDetails extends SpokenPart {
  const SpokenDetails();
}

class SpokenProposal extends SpokenPart {
  const SpokenProposal(this.summary);
  final String summary;
}

/// Fixed phrases, per language.
class TalkPhrases {
  const TalkPhrases._({
    required this.details,
    required this.hidden,
    required this.onScreen,
    required this.proposalPrefix,
    required this.proposalGeneric,
    required this.confirm,
    required this.failed,
  });

  final String details;
  final String hidden;
  final String onScreen;

  /// Followed by the proposal summary (English only).
  final String? proposalPrefix;
  final String proposalGeneric;
  final String confirm;
  final String failed;

  static const en = TalkPhrases._(
    details: 'The details are on screen.',
    hidden: 'Amounts are hidden, the answer is on screen.',
    onScreen: 'The answer is on screen.',
    proposalPrefix: 'I\'ve suggested: ',
    proposalGeneric: 'I\'ve suggested a change.',
    confirm: 'Tap Confirm on screen to apply it.',
    failed: 'Sorry, something went wrong. Please ask again.',
  );

  static const ml = TalkPhrases._(
    details: 'വിശദാംശങ്ങൾ സ്ക്രീനിൽ ഉണ്ട്.',
    hidden: 'തുകകൾ മറച്ചിരിക്കുന്നു, ഉത്തരം സ്ക്രീനിൽ ഉണ്ട്.',
    onScreen: 'ഉത്തരം സ്ക്രീനിൽ ഉണ്ട്.',
    proposalPrefix: null,
    proposalGeneric: 'ഞാൻ ഒരു മാറ്റം നിർദ്ദേശിച്ചിട്ടുണ്ട്.',
    confirm: 'അത് ചെയ്യാൻ സ്ക്രീനിലെ Confirm ടാപ്പ് ചെയ്യൂ.',
    failed: 'ക്ഷമിക്കണം, എന്തോ പ്രശ്നമുണ്ടായി. ദയവായി വീണ്ടും ചോദിക്കൂ.',
  );

  static TalkPhrases of(VoiceLanguage language) => language == VoiceLanguage.ml ? ml : en;
}

/// A money figure: ₹/Rs/INR amounts, "500 rupees"/"500 രൂപ", grouped numbers
/// (1,71,518) and paise (518.44). Used to keep figures out of speech when
/// Hide amounts is on.
final _amount = RegExp(
  r'(?:₹|\bRs\.?|\bINR)\s?\d[\d,]*(?:\.\d+)?'
  r'|\d[\d,]*(?:\.\d+)?\s?(?:rupees?|രൂപ)'
  r'|\d{1,3}(?:,\d{2,3})+(?:\.\d+)?'
  r'|\d+\.\d{2}\b',
  caseSensitive: false,
);

bool containsAmount(String text) => _amount.hasMatch(text);

/// Sentences of [text]; a "." inside a figure (₹1,518.44) or after "Rs" does
/// not end one.
List<String> _sentences(String text) => [
      for (final m in RegExp(r'.+?(?:(?<!\bRs)[.!?।]+(?=\s|$)|$)', dotAll: true, caseSensitive: false)
          .allMatches(text))
        if (m.group(0)!.trim().isNotEmpty) m.group(0)!.trim(),
    ];

String _clean(String text) => text
    .replaceAll(RegExp(r'[*#`_•|]'), ' ')
    .replaceAll(RegExp(r'\s+'), ' ')
    .trim();

String _endSentence(String s) => RegExp(r'[.!?।]$').hasMatch(s) ? s : '$s.';

/// Maximum sentences read from the answer; the rest stays on screen.
const spokenSentenceLimit = 2;

/// What the phone says for a reply.
///
/// - The first text block is the spoken answer (the voice prompt asks for
///   1–2 sentences); at most [spokenSentenceLimit] sentences are read.
///   Without a text block the first stat is read instead.
/// - Bars, entries, further text and stats are pointed to ("The details are
///   on screen.").
/// - A proposal is described and the user is told to tap Confirm; it is
///   never confirmed by voice.
/// - With [hideAmounts], no sentence with a figure is read; the user hears
///   "Amounts are hidden, the answer is on screen." instead.
String spokenReply(List<SpokenPart> parts, VoiceLanguage language, {required bool hideAmounts}) {
  final say = TalkPhrases.of(language);
  final out = <String>[];
  var withheld = false;
  var more = false;

  final texts = parts.whereType<SpokenText>().where((t) => _clean(t.text).isNotEmpty).toList();
  final stats = parts.whereType<SpokenStat>().toList();
  if (texts.isNotEmpty) {
    final sentences = _sentences(_clean(texts.first.text));
    if (sentences.length > spokenSentenceLimit || texts.length > 1) more = true;
    for (final s in sentences.take(spokenSentenceLimit)) {
      if (hideAmounts && containsAmount(s)) {
        withheld = true;
      } else {
        out.add(_endSentence(s));
      }
    }
    if (stats.isNotEmpty) more = true;
  } else if (stats.isNotEmpty) {
    final s = stats.first;
    if (hideAmounts) {
      withheld = true;
    } else {
      out.add(_endSentence('${_clean(s.label)}: ${_clean(s.value)}'));
    }
    if (stats.length > 1) more = true;
  }
  if (parts.any((p) => p is SpokenDetails)) more = true;

  for (final p in parts.whereType<SpokenProposal>()) {
    final summary = _clean(p.summary);
    if (say.proposalPrefix != null && summary.isNotEmpty && !(hideAmounts && containsAmount(summary))) {
      out.add(_endSentence('${say.proposalPrefix}$summary'));
    } else {
      out.add(say.proposalGeneric);
    }
    out.add(say.confirm);
  }

  if (withheld) {
    out.add(say.hidden);
  } else if (more) {
    out.add(say.details);
  }
  if (out.isEmpty) out.add(say.onScreen);
  return out.join(' ');
}

// ---- conversation state machine ----------------------------------------------

enum TalkPhase { idle, listening, thinking, speaking, paused, ended }

enum TalkEnd { stopPhrase, silence, endButton, backgrounded, permissionDenied, unavailable, error }

/// What the controller must do after an event.
sealed class TalkCommand {
  const TalkCommand();
}

/// Start listening. [fresh] starts a new quiet period (after start, an
/// answer, an interrupt or resume); a retry after a quiet listen keeps it.
class ListenCommand extends TalkCommand {
  const ListenCommand({required this.fresh});
  final bool fresh;
}

class SendCommand extends TalkCommand {
  const SendCommand(this.text);
  final String text;
}

class SpeakCommand extends TalkCommand {
  const SpeakCommand(this.text);
  final String text;
}

/// Stop any listening or speaking now.
class StopAudioCommand extends TalkCommand {
  const StopAudioCommand();
}

class FinishCommand extends TalkCommand {
  const FinishCommand(this.reason);
  final TalkEnd reason;
}

/// Seconds of quiet, while listening, after which the conversation ends.
const talkSilenceLimit = Duration(seconds: 8);

/// Pause after the last word before the recogniser finishes an utterance.
const talkPauseAfterSpeech = Duration(seconds: 3);

/// The hands-free loop: listen → think → speak → listen again.
///
/// Every method returns the commands to carry out; events that do not fit
/// the current phase (a late result after an interrupt) return nothing.
class TalkMachine {
  TalkMachine({this.silenceLimit = talkSilenceLimit});

  final Duration silenceLimit;
  TalkPhase phase = TalkPhase.idle;

  /// Live (partial or final) text of the current question.
  String transcript = '';
  TalkEnd? endedBy;

  bool get isActive => phase != TalkPhase.idle && phase != TalkPhase.ended;

  List<TalkCommand> start() {
    if (phase != TalkPhase.idle) return const [];
    return _listen();
  }

  List<TalkCommand> _listen({bool fresh = true}) {
    phase = TalkPhase.listening;
    if (fresh) transcript = '';
    return [ListenCommand(fresh: fresh)];
  }

  List<TalkCommand> heardPartial(String text) {
    if (phase != TalkPhase.listening) return const [];
    transcript = text;
    return const [];
  }

  /// The recogniser finished an utterance. Empty [text] means nothing was
  /// heard; [quietFor] is how long it has been listening without a question.
  List<TalkCommand> heardFinal(String text, {required Duration quietFor}) {
    if (phase != TalkPhase.listening) return const [];
    final t = text.trim();
    if (t.isEmpty) {
      if (quietFor >= silenceLimit) return end(TalkEnd.silence);
      return _listen(fresh: false);
    }
    transcript = t;
    if (isStopPhrase(t)) return end(TalkEnd.stopPhrase);
    phase = TalkPhase.thinking;
    return [SendCommand(t)];
  }

  List<TalkCommand> answered(String spoken) {
    if (phase != TalkPhase.thinking) return const [];
    phase = TalkPhase.speaking;
    return [SpeakCommand(spoken)];
  }

  /// Speaking finished on its own.
  List<TalkCommand> spoken() {
    if (phase != TalkPhase.speaking) return const [];
    return _listen();
  }

  /// A tap on the Talk panel: interrupts speaking (and listens again), or
  /// pauses listening so the transcript can be fixed.
  List<TalkCommand> tap() {
    switch (phase) {
      case TalkPhase.speaking:
        return [const StopAudioCommand(), ..._listen()];
      case TalkPhase.listening:
        phase = TalkPhase.paused;
        return const [StopAudioCommand()];
      default:
        return const [];
    }
  }

  List<TalkCommand> resume() {
    if (phase != TalkPhase.paused) return const [];
    return _listen();
  }

  /// Sends the (edited) transcript from the paused state.
  List<TalkCommand> sendEdited(String text) {
    if (phase != TalkPhase.paused) return const [];
    final t = text.trim();
    if (t.isEmpty) return const [];
    transcript = t;
    if (isStopPhrase(t)) return end(TalkEnd.stopPhrase);
    phase = TalkPhase.thinking;
    return [SendCommand(t)];
  }

  List<TalkCommand> end(TalkEnd reason) {
    if (!isActive && phase != TalkPhase.idle) return const [];
    phase = TalkPhase.ended;
    endedBy = reason;
    return [const StopAudioCommand(), FinishCommand(reason)];
  }
}
