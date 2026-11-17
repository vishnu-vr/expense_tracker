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

  /// Suggestions only appear when all three are true.
  bool get working => enabled && smsGranted && notificationsGranted;
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

  /// Asks on-device AI for categories of entries the rules could not place.
  /// Only works while the app is in the foreground.
  Future<List<DetectedEntry>> suggestCategories() async =>
      _entries(await _channel.invokeMethod('suggestCategories'));

  /// Starts the model download when possible on an unmetered network.
  Future<NanoState> nanoStatus() async => NanoState.fromWire(await _channel.invokeMethod('nanoStatus'));
}
