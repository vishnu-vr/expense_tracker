// Firebase client config for the v2 project (expense-tracker-v2-5c9fa).
// Generated from `firebase apps:sdkconfig`. These values identify the app to
// Firebase and are not secrets; access is controlled by security rules.
// ignore_for_file: lines_longer_than_80_chars
import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;
import 'package:flutter/foundation.dart' show TargetPlatform, defaultTargetPlatform;


class DefaultFirebaseOptions {
  static FirebaseOptions get currentPlatform => switch (defaultTargetPlatform) {
        TargetPlatform.android => android,
        TargetPlatform.iOS => ios,
        _ => throw UnsupportedError('Firebase is configured for Android and iOS only'),
      };

  static const android = FirebaseOptions(
    apiKey: 'AIzaSyAwjQgSeBCUPJoQk4cd5kBkn8nhMY6KOx4',
    appId: '1:117550011867:android:4d858566fa14bdfa91c3fe',
    messagingSenderId: '117550011867',
    projectId: 'expense-tracker-v2-5c9fa',
    storageBucket: 'expense-tracker-v2-5c9fa.firebasestorage.app',
  );

  static const ios = FirebaseOptions(
    apiKey: 'AIzaSyAWMBrdNAaZAlLNnDO5ssc6AgrtAVzRhhI',
    appId: '1:117550011867:ios:f95e6c4f75e8105d91c3fe',
    messagingSenderId: '117550011867',
    projectId: 'expense-tracker-v2-5c9fa',
    storageBucket: 'expense-tracker-v2-5c9fa.firebasestorage.app',
    iosBundleId: 'com.vapps.trackExpense',
    iosClientId: '117550011867-6bmfj6434cgci2m2ao7n0gejo5javbhq.apps.googleusercontent.com',
  );

  /// Web OAuth client of the Google sign-in provider. Android exchanges the
  /// Google account for an ID token addressed to this client.
  static const googleWebClientId =
      '117550011867-ep18b4r5dvb9nqnfcti7h96cja43hlql.apps.googleusercontent.com';

  /// iOS OAuth client (from GoogleService-Info.plist).
  static const googleIosClientId =
      '117550011867-6bmfj6434cgci2m2ao7n0gejo5javbhq.apps.googleusercontent.com';
}
