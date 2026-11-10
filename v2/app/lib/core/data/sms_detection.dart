import 'package:flutter/services.dart';

class SmsDetectionStatus {
  const SmsDetectionStatus({
    required this.enabled,
    required this.smsGranted,
    required this.notificationsGranted,
  });

  final bool enabled;
  final bool smsGranted;
  final bool notificationsGranted;

  /// Suggestions only appear when all three are true.
  bool get working => enabled && smsGranted && notificationsGranted;
}

/// Bank-message detection (Android only). The detection itself runs natively
/// in `SmsReceiver.kt` so it works while the app is closed.
class SmsDetection {
  const SmsDetection();

  static const _channel = MethodChannel('track_expense/sms');

  SmsDetectionStatus _parse(Object? raw) {
    final m = (raw as Map?) ?? const {};
    return SmsDetectionStatus(
      enabled: m['enabled'] == true,
      smsGranted: m['smsGranted'] == true,
      notificationsGranted: m['notificationsGranted'] == true,
    );
  }

  Future<SmsDetectionStatus> status() async => _parse(await _channel.invokeMethod('status'));

  Future<SmsDetectionStatus> setEnabled(bool enabled) async =>
      _parse(await _channel.invokeMethod('setEnabled', {'enabled': enabled}));

  /// Shows the system prompts for any permission not yet granted.
  Future<SmsDetectionStatus> requestPermissions() async =>
      _parse(await _channel.invokeMethod('requestPermissions'));

  Future<void> openAppSettings() => _channel.invokeMethod('openAppSettings');
}
