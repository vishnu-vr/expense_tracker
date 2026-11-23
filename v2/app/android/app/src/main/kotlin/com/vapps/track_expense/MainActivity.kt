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
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : FlutterActivity() {
    private var pendingPermissionResult: MethodChannel.Result? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val nano: NanoCategoriser by lazy { Nano.create(this) }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "track_expense/sms")
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "status" -> {
                        SmsCatchUpWorker.schedule(this)
                        result.success(status())
                    }
                    "setEnabled" -> {
                        SmsPrefs.setEnabled(this, call.argument<Boolean>("enabled") == true)
                        SmsCatchUpWorker.schedule(this)
                        result.success(status())
                    }
                    "setAutoAdd" -> {
                        SmsPrefs.setAutoAdd(this, call.argument<Boolean>("enabled") == true)
                        SmsCatchUpWorker.schedule(this)
                        result.success(status())
                    }
                    // Evening catch-up reminder (D-030).
                    "setEveningReminder" -> {
                        SmsPrefs.setEveningOn(this, call.argument<Boolean>("enabled") == true)
                        SmsCatchUpWorker.schedule(this)
                        result.success(status())
                    }
                    // Payee memory (D-030).
                    "forgetPayees" -> {
                        PayeeMemory.forgetAll(this)
                        result.success(status())
                    }
                    // A review item was saved in the app (chip or form): remember its payee, then drop it.
                    "labelReviewItem" -> {
                        val id = call.argument<String>("id")
                        val categoryId = call.argument<String>("categoryId")
                        val item = id?.let { SmsReviewQueue.find(this, it) }
                        if (item != null && categoryId != null) {
                            val note = call.argument<String>("note")
                            val words = PayeeMemoryCodec.noteWords(note, item.merchant, item.account)
                            val docId = call.argument<String>("docId")
                            PayeeMemory.remember(this, item.payeeHash, categoryId, item.type, words, docId)
                            docId?.let { PayeeMemory.recordEntry(this, it, item.payeeHash, item.merchant, item.account) }
                        }
                        id?.let {
                            SmsReviewQueue.remove(this, it)
                            SmsNotifications.manager(this).cancel(item?.let { i -> SmsNotifications.notificationId(i.receivedAt) } ?: 0)
                        }
                        result.success(SmsReviewQueue.all(this).map { it.toMap() })
                    }
                    // An entry from a bank message was edited: its payee memory follows the change.
                    "entryEdited" -> {
                        val docId = call.argument<String>("docId")
                        val categoryId = call.argument<String>("categoryId")
                        val type = call.argument<String>("type") ?: "expense"
                        if (docId != null && categoryId != null) {
                            PayeeMemory.entryEdited(this, docId, categoryId, type, call.argument<String>("note"))
                        }
                        result.success(null)
                    }
                    // The category lookup table built by the app (D-029); null on sign-out.
                    "pushCategoryTable" -> {
                        SmsPrefs.setTable(this, call.argument<String>("table"))
                        result.success(null)
                    }
                    "reviewQueue" -> result.success(SmsReviewQueue.all(this).map { it.toMap() })
                    "removeFromQueue" -> {
                        call.argument<String>("id")?.let { SmsReviewQueue.remove(this, it) }
                        result.success(SmsReviewQueue.all(this).map { it.toMap() })
                    }
                    "suggestCategories" -> scope.launch { result.success(suggestWithAi()) }
                    // Category suggestions (D-032): Off, Cloud, Gemma on the phone or Gemini Nano.
                    "setAiMode" -> {
                        SmsPrefs.setAiMode(this, AiMode.fromWire(call.argument<String>("mode")))
                        result.success(status())
                    }
                    "setCloudModel" -> {
                        SmsPrefs.setCloudModel(this, call.argument<String>("model"))
                        result.success(status())
                    }
                    "gemmaStatus" -> scope.launch { result.success(gemma { }) }
                    "gemmaDownload" -> scope.launch { result.success(gemma { GemmaModel.download(this@MainActivity) }) }
                    "gemmaCancel" -> scope.launch { result.success(gemma { GemmaModel.cancel(this@MainActivity) }) }
                    "gemmaDelete" -> scope.launch { result.success(gemma { GemmaModel.delete(this@MainActivity) }) }
                    "nanoStatus" -> scope.launch { result.success(nano.downloadIfUnmetered().toMap()) }
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

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    /**
     * The review list is open: the chosen model (D-032; Gemini Nano only
     * runs in the foreground) suggests categories for up to 5 entries the
     * rules could not place or whose reply words were unclear. A suggestion
     * only preselects; the user approves it.
     */
    private suspend fun suggestWithAi(): List<Map<String, Any?>> = withContext(Dispatchers.IO) {
        val table = SmsPrefs.table(this@MainActivity)
        val open = AiSuggest.candidates(SmsReviewQueue.all(this@MainActivity))
        if (table.categories.isNotEmpty() && open.isNotEmpty()) {
            val suggester = Suggesters.create(this@MainActivity, table, foreground = true) { nano }
            for (item in AiSuggest.apply(open, table.categories, suggester)) {
                if (item.isAiSuggestion && open.none { it === item }) {
                    SmsReviewQueue.setSuggestion(this@MainActivity, item.id, item.categoryId, item.categorySource, item.aiModel)
                }
            }
        }
        SmsReviewQueue.all(this@MainActivity).map { it.toMap() }
    }

    /** Runs [action] off the main thread, then returns the on-device model's state. */
    private suspend fun gemma(action: () -> Unit): Map<String, Any?> = withContext(Dispatchers.IO) {
        action()
        GemmaModel.status(this@MainActivity)
    }

    private fun granted(permission: String) =
        ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

    private fun status(): Map<String, Any> = mapOf(
        "enabled" to SmsPrefs.isEnabled(this),
        "autoAdd" to SmsPrefs.isAutoAdd(this),
        "evening" to SmsPrefs.isEveningOn(this),
        "rememberedPayees" to PayeeMemory.count(this),
        "aiMode" to SmsPrefs.aiMode(this).wire,
        "cloudModel" to SmsPrefs.cloudModel(this),
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
