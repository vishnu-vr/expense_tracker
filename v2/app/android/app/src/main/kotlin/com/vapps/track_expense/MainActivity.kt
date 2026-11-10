package com.vapps.track_expense

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private var pendingPermissionResult: MethodChannel.Result? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "track_expense/sms")
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "status" -> result.success(status())
                    "setEnabled" -> {
                        SmsPrefs.setEnabled(this, call.argument<Boolean>("enabled") == true)
                        result.success(status())
                    }
                    "requestPermissions" -> requestPermissions(result)
                    "openAppSettings" -> {
                        startActivity(
                            Intent(
                                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                                Uri.fromParts("package", packageName, null),
                            ),
                        )
                        result.success(null)
                    }
                    else -> result.notImplemented()
                }
            }
    }

    private fun granted(permission: String) =
        ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

    private fun status(): Map<String, Boolean> = mapOf(
        "enabled" to SmsPrefs.isEnabled(this),
        "smsGranted" to granted(Manifest.permission.RECEIVE_SMS),
        "notificationsGranted" to
            (Build.VERSION.SDK_INT < 33 || granted(Manifest.permission.POST_NOTIFICATIONS)),
    )

    private fun requestPermissions(result: MethodChannel.Result) {
        val wanted = buildList {
            if (!granted(Manifest.permission.RECEIVE_SMS)) add(Manifest.permission.RECEIVE_SMS)
            if (Build.VERSION.SDK_INT >= 33 && !granted(Manifest.permission.POST_NOTIFICATIONS)) {
                add(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
        if (wanted.isEmpty()) return result.success(status())
        pendingPermissionResult?.success(status())
        pendingPermissionResult = result
        ActivityCompat.requestPermissions(this, wanted.toTypedArray(), PERMISSION_REQUEST)
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == PERMISSION_REQUEST) {
            pendingPermissionResult?.success(status())
            pendingPermissionResult = null
        }
    }

    private companion object {
        const val PERMISSION_REQUEST = 4201
    }
}
