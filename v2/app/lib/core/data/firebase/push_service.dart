import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

/// Household push notifications: stores this device's token under
/// `users/{uid}/fcmTokens/{token}` and turns a tapped push into a route.
class PushService {
  PushService(this._messaging, this._db);

  final FirebaseMessaging _messaging;
  final FirebaseFirestore _db;
  StreamSubscription<String>? _refresh;
  StreamSubscription<RemoteMessage>? _opened;
  String? _uid;
  String? _token;

  DocumentReference<Map<String, dynamic>> _doc(String uid, String token) =>
      _db.collection('users').doc(uid).collection('fcmTokens').doc(token);

  Future<void> _save(String uid, String token) async {
    _token = token;
    await _doc(uid, token).set({
      'token': token,
      'platform': defaultTargetPlatform.name,
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  /// Asks for permission (once, by the OS) and registers the token for [uid].
  Future<void> register(String uid) async {
    if (_uid == uid) return;
    _uid = uid;
    try {
      final settings = await _messaging.requestPermission();
      if (settings.authorizationStatus == AuthorizationStatus.denied) return;
      // The token API is deprecated in favour of installation ids, but the
      // backend still sends to tokens; switch both sides together.
      // ignore: deprecated_member_use
      final token = await _messaging.getToken();
      if (token != null) await _save(uid, token);
      await _refresh?.cancel();
      // ignore: deprecated_member_use
      _refresh = _messaging.onTokenRefresh.listen((t) => _save(uid, t));
    } catch (_) {
      // Push is optional; the in-app activity list still works.
      _uid = null;
    }
  }

  /// Stops pushes to this device for the user who is signing out.
  Future<void> unregister() async {
    final uid = _uid, token = _token;
    _uid = null;
    _token = null;
    await _refresh?.cancel();
    if (uid == null || token == null) return;
    try {
      await _doc(uid, token).delete();
    } catch (_) {}
  }

  static String _routeFor(RemoteMessage m) {
    // A report is ready (D-033).
    final report = m.data['reportId'];
    if (report is String && report.isNotEmpty) return '/reports/$report';
    final id = m.data['transactionId'];
    if (id is String && id.isNotEmpty && m.data['type'] != 'transaction_deleted') {
      return '/edit/$id';
    }
    return '/notifications';
  }

  /// Calls [open] with a route when the user taps a push.
  Future<void> onOpen(void Function(String route) open) async {
    await _opened?.cancel();
    _opened = FirebaseMessaging.onMessageOpenedApp.listen((m) => open(_routeFor(m)));
    final initial = await _messaging.getInitialMessage();
    if (initial != null) open(_routeFor(initial));
  }
}
