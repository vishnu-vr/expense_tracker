import 'dart:convert';

import 'package:flutter/services.dart';

import '../domain/sms_categories.dart';

class SmsDetectionStatus {
  const SmsDetectionStatus({
    required this.enabled,
    required this.smsGranted,
    required this.notificationsGranted,
    this.autoAdd = false,
  });

  final bool enabled;
  final bool smsGranted;
  final bool notificationsGranted;

  /// Auto-add confident entries (D-029). Only acts while [enabled] is on too.
  final bool autoAdd;

  /// Suggestions only appear when all three are true.
  bool get working => enabled && smsGranted && notificationsGranted;
}

/// Gemini Nano on this phone, for suggesting categories in the review list.
enum NanoStatus { available, downloadable, downloading, unavailable }

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
    );
  }

  Future<SmsDetectionStatus> status() async => _parse(await _channel.invokeMethod('status'));

  Future<SmsDetectionStatus> setEnabled(bool enabled) async =>
      _parse(await _channel.invokeMethod('setEnabled', {'enabled': enabled}));

  Future<SmsDetectionStatus> setAutoAdd(bool enabled) async =>
      _parse(await _channel.invokeMethod('setAutoAdd', {'enabled': enabled}));

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

  /// Asks on-device AI for categories of entries the rules could not place.
  /// Only works while the app is in the foreground.
  Future<List<DetectedEntry>> suggestCategories() async =>
      _entries(await _channel.invokeMethod('suggestCategories'));

  /// Starts the model download when possible on an unmetered network.
  Future<NanoStatus> nanoStatus() async {
    final s = await _channel.invokeMethod<String>('nanoStatus');
    return NanoStatus.values.where((v) => v.name == s).firstOrNull ?? NanoStatus.unavailable;
  }
}
