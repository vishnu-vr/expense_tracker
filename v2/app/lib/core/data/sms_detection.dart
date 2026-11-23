import 'dart:convert';

import 'package:flutter/services.dart';

import '../domain/sms_categories.dart';

class SmsDetectionStatus {
  const SmsDetectionStatus({
    required this.enabled,
    required this.smsGranted,
    required this.notificationsGranted,
    this.autoAdd = false,
    this.evening = true,
    this.rememberedPayees = 0,
    this.aiMode = CategoryAiMode.off,
    this.cloudModel = 'flash-lite',
  });

  final bool enabled;
  final bool smsGranted;
  final bool notificationsGranted;

  /// Auto-add confident entries (D-029). Only acts while [enabled] is on too.
  final bool autoAdd;

  /// Evening catch-up reminder at about 20:30 (D-030). Only acts with auto-add on.
  final bool evening;

  /// How many payees this phone remembers a category for (D-030).
  final int rememberedPayees;

  /// "Category suggestions" (D-032). Off by default.
  final CategoryAiMode aiMode;

  /// D-027 model key for Cloud suggestions: `flash-lite` (default) or `flash`.
  final String cloudModel;

  /// Suggestions only appear when all three are true.
  bool get working => enabled && smsGranted && notificationsGranted;
}

/// Who suggests categories for payees the rules cannot place (D-032).
/// Mirrors `AiMode` in Kotlin.
enum CategoryAiMode {
  off('off'),
  cloud('cloud'),
  gemma('gemma'),
  nano('nano');

  const CategoryAiMode(this.wire);
  final String wire;

  static CategoryAiMode fromWire(Object? raw) =>
      values.where((v) => v.wire == raw).firstOrNull ?? off;
}

/// The downloadable on-device model (Gemma 3 1B). Mirrors `GemmaStatus` in Kotlin.
enum GemmaStatus {
  notDownloaded('not-downloaded'),
  waitingForWifi('waiting-for-wifi'),
  queued('queued'),
  downloading('downloading'),
  verifying('verifying'),
  ready('ready'),
  notAvailable('not-available'),
  noSpace('no-space'),
  signIn('sign-in'),
  failed('failed');

  const GemmaStatus(this.wire);
  final String wire;

  /// A download is queued or running: the screen keeps checking.
  bool get busy => this == waitingForWifi || this == queued || this == downloading || this == verifying;
}

class GemmaState {
  const GemmaState(this.status, {this.done = 0, this.total = 0, this.model = 'Gemma 3 1B'});

  final GemmaStatus status;
  final int done;
  final int total;
  final String model;

  /// 0–1 while downloading.
  double get progress => total > 0 ? (done / total).clamp(0, 1).toDouble() : 0;

  static GemmaState fromWire(Object? raw) {
    final m = raw is Map ? raw : const {};
    return GemmaState(
      GemmaStatus.values.where((v) => v.wire == m['state']).firstOrNull ?? GemmaStatus.notDownloaded,
      done: (m['done'] as num?)?.toInt() ?? 0,
      total: (m['total'] as num?)?.toInt() ?? 0,
      model: m['model'] is String ? m['model'] as String : 'Gemma 3 1B',
    );
  }

  /// "About 557 MB" for [bytes].
  static String size(int bytes) => '${(bytes / (1024 * 1024)).round()} MB';

  /// One line for the settings screen.
  String get hint => switch (status) {
        GemmaStatus.notDownloaded => 'Not downloaded. About ${size(total)}, on Wi-Fi.',
        GemmaStatus.waitingForWifi => 'Waiting for Wi-Fi to download',
        GemmaStatus.queued => 'Starting the download…',
        GemmaStatus.downloading => 'Downloading: ${(progress * 100).floor()}% of ${size(total)}',
        GemmaStatus.verifying => 'Checking the downloaded file…',
        GemmaStatus.ready => 'Ready on this phone (${size(total)})',
        GemmaStatus.notAvailable => 'Model not available yet',
        GemmaStatus.noSpace => 'Not enough free storage for the model',
        GemmaStatus.signIn => 'Sign in to download the model',
        GemmaStatus.failed => 'Download failed. Try again on Wi-Fi.',
      };
}

/// Gemini Nano on this phone, for suggesting categories in the review list.
/// Mirrors `NanoStatusMapper` in Kotlin.
enum NanoStatus {
  available('available'),
  downloadable('downloadable'),
  waitingForWifi('waiting-for-wifi'),
  downloading('downloading'),
  unsupported('unsupported'),
  aicoreUpdate('aicore-update'),
  preparing('preparing'),
  noSpace('no-space'),
  busy('busy'),
  androidTooOld('android-too-old'),
  error('error');

  const NanoStatus(this.wire);
  final String wire;

  /// One line for the settings screen: what it means and what to do.
  String get hint => switch (this) {
        available => 'Ready: suggests categories in the review list',
        downloadable => 'The model can be downloaded on Wi-Fi',
        waitingForWifi => 'Waiting for Wi-Fi to download the model',
        downloading => 'Downloading the model',
        unsupported => 'Not supported on this phone yet',
        aicoreUpdate => "Update 'Android AICore' in Play Store, then check again",
        preparing => 'Still setting up. Check again in a few minutes or restart the phone',
        noSpace => 'Not enough free storage for the model',
        busy => 'Busy right now. Check again later',
        androidTooOld => 'Needs Android 8.0 or newer',
        error => 'Could not check',
      };
}

/// [status] with a short non-sensitive detail, e.g. "AICore 1.0.2" or "code 4".
class NanoState {
  const NanoState(this.status, [this.code]);

  final NanoStatus status;
  final String? code;

  static NanoState fromWire(Object? raw) {
    // Older native code answered with a bare string.
    final m = raw is Map ? raw : {'status': raw};
    final s = m['status'];
    final code = m['code'];
    return NanoState(
      NanoStatus.values.where((v) => v.wire == s).firstOrNull ?? NanoStatus.error,
      code is String && code.isNotEmpty ? code : (s is String && s.isNotEmpty ? null : 'no answer'),
    );
  }
}

/// Bank-message detection (Android only). The detection itself runs natively
/// in `SmsReceiver.kt` so it works while the app is closed; auto-add runs in
/// `SmsAutoAddWorker.kt`.
class SmsDetection {
  const SmsDetection();

  static const _channel = MethodChannel('track_expense/sms');

  SmsDetectionStatus _parse(Object? raw) {
    final m = (raw as Map?) ?? const {};
    return SmsDetectionStatus(
      enabled: m['enabled'] == true,
      smsGranted: m['smsGranted'] == true,
      notificationsGranted: m['notificationsGranted'] == true,
      autoAdd: m['autoAdd'] == true,
      evening: m['evening'] != false,
      rememberedPayees: (m['rememberedPayees'] as num?)?.toInt() ?? 0,
      aiMode: CategoryAiMode.fromWire(m['aiMode']),
      cloudModel: m['cloudModel'] == 'flash' ? 'flash' : 'flash-lite',
    );
  }

  Future<SmsDetectionStatus> status() async => _parse(await _channel.invokeMethod('status'));

  Future<SmsDetectionStatus> setEnabled(bool enabled) async =>
      _parse(await _channel.invokeMethod('setEnabled', {'enabled': enabled}));

  Future<SmsDetectionStatus> setAutoAdd(bool enabled) async =>
      _parse(await _channel.invokeMethod('setAutoAdd', {'enabled': enabled}));

  Future<SmsDetectionStatus> setEveningReminder(bool enabled) async =>
      _parse(await _channel.invokeMethod('setEveningReminder', {'enabled': enabled}));

  /// Forgets every remembered payee on this phone (D-030).
  Future<SmsDetectionStatus> forgetPayees() async =>
      _parse(await _channel.invokeMethod('forgetPayees'));

  /// Shows the system prompts for any permission not yet granted.
  Future<SmsDetectionStatus> requestPermissions() async =>
      _parse(await _channel.invokeMethod('requestPermissions'));

  Future<void> openAppSettings() => _channel.invokeMethod('openAppSettings');

  /// The category lookup table for auto-add; null clears it (signed out).
  Future<void> pushCategoryTable(Map<String, Object?>? table) => _channel.invokeMethod(
      'pushCategoryTable', {'table': table == null ? null : jsonEncode(table)});

  List<DetectedEntry> _entries(Object? raw) => [
        if (raw is List)
          for (final e in raw) ?DetectedEntry.fromMap(e),
      ];

  /// Detected entries waiting for review, newest first.
  Future<List<DetectedEntry>> reviewQueue() async =>
      _entries(await _channel.invokeMethod('reviewQueue'));

  Future<List<DetectedEntry>> removeFromQueue(String id) async =>
      _entries(await _channel.invokeMethod('removeFromQueue', {'id': id}));

  /// A review item was saved as entry [docId]: the phone remembers its payee
  /// with [categoryId] and the user's words in [note], then drops the item.
  Future<List<DetectedEntry>> labelReviewItem(
    String id, {
    required String categoryId,
    String? note,
    String? docId,
  }) async =>
      _entries(await _channel.invokeMethod('labelReviewItem', {
        'id': id,
        'categoryId': categoryId,
        'note': note,
        'docId': docId,
      }));

  /// An entry from a bank message was edited; its payee memory follows.
  Future<void> entryEdited(String docId, {
    required String categoryId,
    required String type,
    String? note,
  }) =>
      _channel.invokeMethod('entryEdited', {
        'docId': docId,
        'categoryId': categoryId,
        'type': type,
        'note': note,
      });

  /// Category suggestions: Off, Cloud, on-device Gemma or Gemini Nano (D-032).
  Future<SmsDetectionStatus> setAiMode(CategoryAiMode mode) async =>
      _parse(await _channel.invokeMethod('setAiMode', {'mode': mode.wire}));

  /// The Cloud model key: `flash-lite` or `flash` (D-027 keys).
  Future<SmsDetectionStatus> setCloudModel(String key) async =>
      _parse(await _channel.invokeMethod('setCloudModel', {'model': key}));

  Future<GemmaState> gemmaStatus() async => GemmaState.fromWire(await _channel.invokeMethod('gemmaStatus'));

  /// Queues the download; it runs on Wi-Fi (unmetered) only.
  Future<GemmaState> gemmaDownload() async => GemmaState.fromWire(await _channel.invokeMethod('gemmaDownload'));

  Future<GemmaState> gemmaCancel() async => GemmaState.fromWire(await _channel.invokeMethod('gemmaCancel'));

  /// Deletes the model; the setting falls back to Off.
  Future<GemmaState> gemmaDelete() async => GemmaState.fromWire(await _channel.invokeMethod('gemmaDelete'));

  /// Asks the chosen model for categories of entries the rules could not
  /// place (or whose reply words were unclear). Suggestions wait for approval.
  Future<List<DetectedEntry>> suggestCategories() async =>
      _entries(await _channel.invokeMethod('suggestCategories'));

  /// Starts the model download when possible on an unmetered network.
  Future<NanoState> nanoStatus() async => NanoState.fromWire(await _channel.invokeMethod('nanoStatus'));
}
