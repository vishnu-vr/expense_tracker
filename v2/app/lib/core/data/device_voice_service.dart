import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:speech_to_text/speech_recognition_error.dart';
import 'package:speech_to_text/speech_recognition_result.dart';
import 'package:speech_to_text/speech_to_text.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

import '../domain/voice.dart';
import 'voice.dart';

/// [VoiceService] on the phone's own recogniser and voices (D-028).
///
/// Recognition prefers on-device for English; when the phone cannot do that
/// for a locale it quietly retries with the normal recogniser (which may send
/// audio to Google or Apple). Nothing heard or said is logged.
class DeviceVoiceService implements VoiceService {
  final _stt = SpeechToText();
  final _tts = FlutterTts();
  var _ready = false;
  var _ttsReady = false;

  StreamController<VoiceHeard>? _active;
  var _lastWords = '';
  String _locale = '';
  Duration _pauseFor = talkPauseAfterSpeech;
  var _onDevice = false;

  /// The recogniser reported "listening" for the current session; a late
  /// "done" from a cancelled session is ignored until then.
  var _sessionStarted = false;

  /// Locales where on-device recognition failed this session.
  final _noOnDevice = <String>{};
  Timer? _cue;

  Future<bool> _init() async {
    if (_ready) return true;
    _ready = await _stt.initialize(onError: _onError, onStatus: _onStatus);
    return _ready;
  }

  @override
  Future<VoicePermission> requestPermission() async {
    try {
      if (await _init()) return VoicePermission.granted;
      return await _stt.hasPermission ? VoicePermission.unavailable : VoicePermission.denied;
    } catch (_) {
      return VoicePermission.unavailable;
    }
  }

  @override
  Future<VoiceLocales> availableLocales() async {
    Set<String>? recognition;
    Set<String>? speech;
    try {
      if (_ready || await _stt.hasPermission) {
        if (await _init()) {
          recognition = {for (final l in await _stt.locales()) l.localeId};
        }
      }
    } catch (_) {
      recognition = null;
    }
    try {
      final langs = await _tts.getLanguages;
      if (langs is List) speech = {for (final l in langs) '$l'};
    } catch (_) {
      speech = null;
    }
    return VoiceLocales(recognition: recognition, speech: speech);
  }

  @override
  Stream<VoiceHeard> listen(String localeId, {Duration pauseFor = talkPauseAfterSpeech}) {
    _closeActive();
    final c = StreamController<VoiceHeard>();
    _active = c;
    _locale = localeId;
    _pauseFor = pauseFor;
    _start();
    return c.stream;
  }

  void _start() {
    final c = _active;
    if (c == null) return;
    _lastWords = '';
    _sessionStarted = false;
    _onDevice = _locale.toLowerCase().startsWith('en') && !_noOnDevice.contains(_locale);
    () async {
      try {
        await _stt.listen(
          onResult: _onResult,
          listenOptions: SpeechListenOptions(
            localeId: _locale,
            partialResults: true,
            onDevice: _onDevice,
            listenMode: ListenMode.dictation,
            cancelOnError: true,
            pauseFor: _pauseFor,
            listenFor: const Duration(minutes: 1),
          ),
        );
      } catch (_) {
        if (_onDevice) {
          _noOnDevice.add(_locale);
          _start();
        } else {
          _emit(const VoiceError(VoiceErrorKind.other));
        }
      }
    }();
  }

  void _emit(VoiceHeard heard) {
    final c = _active;
    if (c == null || c.isClosed) return;
    c.add(heard);
    if (heard is! VoicePartial) _closeActive();
  }

  void _closeActive() {
    final c = _active;
    _active = null;
    if (c != null && !c.isClosed) c.close();
  }

  void _onResult(SpeechRecognitionResult r) {
    if (r.recognizedWords.isNotEmpty) _lastWords = r.recognizedWords;
    _emit(r.finalResult ? VoiceFinal(r.recognizedWords) : VoicePartial(r.recognizedWords));
  }

  void _onStatus(String status) {
    // "done": all results delivered. If no final result came, use the last words.
    if (status == SpeechToText.listeningStatus) _sessionStarted = true;
    if (status == SpeechToText.doneStatus && _sessionStarted) _emit(VoiceFinal(_lastWords));
  }

  void _onError(SpeechRecognitionError e) {
    final kind = switch (e.errorMsg) {
      'error_no_match' || 'error_speech_timeout' || 'error_busy' => VoiceErrorKind.noSpeech,
      'error_permission' || 'error_insufficient_permissions' => VoiceErrorKind.permission,
      'error_language_not_supported' || 'error_language_unavailable' => VoiceErrorKind.language,
      'error_network' || 'error_network_timeout' || 'error_server' || 'error_server_disconnected' =>
        VoiceErrorKind.network,
      _ => VoiceErrorKind.other,
    };
    if (_onDevice && kind != VoiceErrorKind.noSpeech && kind != VoiceErrorKind.permission) {
      // On-device recognition is not available for this locale: retry normally.
      _noOnDevice.add(_locale);
      _start();
      return;
    }
    _emit(VoiceError(kind));
  }

  @override
  Future<void> speak(String text, String localeId) async {
    try {
      if (!_ttsReady) {
        await _tts.awaitSpeakCompletion(true);
        _ttsReady = true;
      }
      await _tts.setLanguage(localeId);
      await _tts.speak(text);
    } catch (_) {
      // A missing voice must not break the conversation; the answer is on screen.
    }
  }

  @override
  Future<void> stop() async {
    _closeActive();
    try {
      if (_stt.isListening) await _stt.cancel();
    } catch (_) {}
    try {
      await _tts.stop();
    } catch (_) {}
  }

  @override
  void thinking(bool on) {
    _cue?.cancel();
    _cue = null;
    if (!on) return;
    SystemSound.play(SystemSoundType.click);
    _cue = Timer.periodic(const Duration(seconds: 2), (_) => SystemSound.play(SystemSoundType.click));
  }

  @override
  void keepScreenOn(bool on) {
    WakelockPlus.toggle(enable: on).catchError((_) {});
  }
}
