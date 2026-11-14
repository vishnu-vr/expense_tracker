import 'dart:async';
import 'dart:math';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:google_sign_in/google_sign_in.dart';

import '../session.dart';
import 'firestore_household_repository.dart' show switchMap;

String _authMessage(FirebaseAuthException e) => switch (e.code) {
      'invalid-credential' ||
      'wrong-password' ||
      'user-not-found' ||
      'invalid-email' =>
        'Wrong email or password.',
      'user-disabled' => 'This account has been disabled.',
      'too-many-requests' => 'Too many attempts. Wait a little and try again.',
      'network-request-failed' => 'No connection. Check your internet and try again.',
      _ => 'Could not sign in. Try again.',
    };

/// Firebase Auth plus the `users/{uid}` and `homes/{id}` documents.
class FirebaseSessionRepository implements SessionRepository {
  FirebaseSessionRepository({
    required this._auth,
    required FirebaseFirestore firestore,
    required this._functions,
    this.googleServerClientId,
    this.googleIosClientId,
  }) : _db = firestore;

  /// Web OAuth client id the Google ID token is issued for (needed on Android).
  final String? googleServerClientId;

  /// iOS OAuth client id.
  final String? googleIosClientId;

  final FirebaseAuth _auth;
  final FirebaseFirestore _db;
  final FirebaseFunctions _functions;
  var _googleReady = false;

  DocumentReference<Map<String, dynamic>> _userDoc(String uid) =>
      _db.collection('users').doc(uid);

  @override
  Stream<Session> watch() => switchMap(_auth.authStateChanges(), (user) {
        if (user == null) return Stream.value(const Session());
        final appUser = AppUser(
          id: user.uid,
          email: user.email,
          name: user.displayName,
          photoUrl: user.photoURL,
        );
        unawaited(_ensureUserDoc(user));
        return _userDoc(user.uid).snapshots().map((snap) {
          // A cached miss says nothing yet; wait for the server before
          // deciding the user has no household.
          if (!snap.exists && snap.metadata.isFromCache) return const Session.loading();
          return Session(user: appUser, homeId: snap.data()?['homeId'] as String?);
        });
      });

  Future<void> _ensureUserDoc(User user) async {
    try {
      final ref = _userDoc(user.uid);
      final snap = await ref.get();
      final profile = {
        'email': user.email,
        'name': user.displayName ?? user.email?.split('@').first ?? '',
        'photoURL': user.photoURL,
      };
      if (!snap.exists) {
        await ref.set({...profile, 'createdAt': FieldValue.serverTimestamp()});
      } else if (snap.data()?['name'] != profile['name'] ||
          snap.data()?['photoURL'] != profile['photoURL']) {
        await ref.set(profile, SetOptions(merge: true));
      }
    } catch (_) {
      // Retried on the next sign-in; the session stream still works.
    }
  }

  @override
  Future<void> signInWithEmail(String email, String password) async {
    try {
      await _auth.signInWithEmailAndPassword(email: email, password: password);
    } on FirebaseAuthException catch (e) {
      throw SessionFailure(_authMessage(e));
    }
  }

  @override
  Future<void> signInWithGoogle() async {
    try {
      if (!_googleReady) {
        await GoogleSignIn.instance.initialize(
          clientId: defaultTargetPlatform == TargetPlatform.iOS ? googleIosClientId : null,
          serverClientId: googleServerClientId,
        );
        _googleReady = true;
      }
      final account = await GoogleSignIn.instance.authenticate();
      final idToken = account.authentication.idToken;
      if (idToken == null) throw const SessionFailure('Google sign-in did not complete.');
      await _auth.signInWithCredential(GoogleAuthProvider.credential(idToken: idToken));
    } on GoogleSignInException catch (e) {
      if (e.code == GoogleSignInExceptionCode.canceled) return;
      throw const SessionFailure('Google sign-in did not complete. Try again.');
    } on FirebaseAuthException catch (e) {
      throw SessionFailure(_authMessage(e));
    }
  }

  @override
  Future<void> signInWithApple() async {
    try {
      await _auth.signInWithProvider(AppleAuthProvider()
        ..addScope('email')
        ..addScope('name'));
    } on FirebaseAuthException catch (e) {
      if (e.code == 'canceled' || e.code == 'web-context-canceled') return;
      throw SessionFailure(_authMessage(e));
    }
  }

  @override
  Future<void> signOut() async {
    await _auth.signOut();
    if (_googleReady) {
      try {
        await GoogleSignIn.instance.signOut();
      } catch (_) {}
    }
  }

  String get _uid {
    final uid = _auth.currentUser?.uid;
    if (uid == null) throw const SessionFailure('You are signed out. Sign in and try again.');
    return uid;
  }

  static String _inviteCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
    final r = Random.secure();
    return [for (var i = 0; i < 6; i++) chars[r.nextInt(chars.length)]].join();
  }

  @override
  Future<void> createHome(String name) async {
    final uid = _uid;
    final home = _db.collection('homes').doc();
    final batch = _db.batch()
      ..set(home, {
        'name': name,
        'displayId': _inviteCode(),
        'ownerId': uid,
        'memberIds': [uid],
        'createdAt': FieldValue.serverTimestamp(),
      })
      ..set(_userDoc(uid), {'homeId': home.id}, SetOptions(merge: true));
    try {
      await batch.commit();
    } on FirebaseException {
      throw const SessionFailure('Could not create the household. Try again.');
    }
  }

  @override
  Future<void> joinHome(String code) async {
    try {
      await _functions.httpsCallable('joinHome').call({'displayId': code.toUpperCase()});
    } on FirebaseFunctionsException catch (e) {
      throw SessionFailure(switch (e.code) {
        'not-found' => 'No household found for that code.',
        'already-exists' => 'You are already in that household.',
        'unavailable' => 'No connection. Check your internet and try again.',
        _ => 'Could not join. Check the code and try again.',
      });
    }
  }

  // Server-side: only a home's owner may edit it directly, and ownership
  // moves to another member when the owner leaves.
  @override
  Future<void> leaveHome() async {
    try {
      await _functions.httpsCallable('leaveHome').call<Object?>({});
    } on FirebaseFunctionsException catch (e) {
      throw SessionFailure(e.code == 'unavailable'
          ? 'No connection. Check your internet and try again.'
          : 'Could not leave the household. Try again.');
    }
  }
}
