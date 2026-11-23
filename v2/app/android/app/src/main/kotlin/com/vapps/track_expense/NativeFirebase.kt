package com.vapps.track_expense

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore

/**
 * The native Firebase SDK, used by the auto-add worker while the Flutter app
 * may be closed (D-029). It uses the same default app as FlutterFire: when
 * the app process starts for an SMS, the default app is created here with the
 * options the Flutter app pushed (same api key and bucket, so FlutterFire
 * reuses it later). The signed-in user and the offline cache are shared.
 *
 * Firestore is used with default settings and none are ever set here:
 * FlutterFire applies its own (also default) settings when the Flutter app
 * starts, and Firestore only accepts that once started if they are equal.
 */
object NativeFirebase {
    @Synchronized
    fun app(context: Context, config: FirebaseConfig): FirebaseApp? {
        FirebaseApp.getApps(context).firstOrNull { it.name == FirebaseApp.DEFAULT_APP_NAME }?.let { existing ->
            return existing.takeIf { it.options.projectId == config.projectId }
        }
        val options = FirebaseOptions.Builder()
            .setApiKey(config.apiKey)
            .setApplicationId(config.appId)
            .setProjectId(config.projectId)
            .setGcmSenderId(config.messagingSenderId)
            .apply { config.storageBucket?.let(::setStorageBucket) }
            .build()
        return try {
            FirebaseApp.initializeApp(context.applicationContext, options)
        } catch (_: IllegalStateException) {
            FirebaseApp.getInstance()
        }
    }

    /** The default app when it is signed in as [table]'s user (for Functions and Storage, D-032), else null. */
    fun appFor(context: Context, table: CategoryTable): FirebaseApp? {
        val config = table.firebase ?: return null
        val app = app(context, config) ?: return null
        return app.takeIf { FirebaseAuth.getInstance(it).currentUser?.uid == table.userId }
    }

    /** Auth and Firestore for [table]'s user, or null when the phone is signed in as someone else. */
    fun forTable(context: Context, table: CategoryTable): Pair<FirebaseAuth, FirebaseFirestore>? {
        val config = table.firebase ?: return null
        val app = app(context, config) ?: return null
        val auth = FirebaseAuth.getInstance(app)
        if (auth.currentUser?.uid != table.userId) return null
        return auth to FirebaseFirestore.getInstance(app)
    }
}
