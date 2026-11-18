package com.vapps.track_expense

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.google.android.gms.tasks.Tasks
import com.google.firebase.auth.FirebaseAuth
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

/** What the bucket says about the model file (`models/gemma3-1b-it-int4.json`). */
data class ModelManifest(val file: String, val size: Long, val sha256: String) {
    companion object {
        private val SHA = Regex("^[0-9a-f]{64}$")

        /** Null unless it names a file under `models/`, a size and a SHA-256. Pure. */
        fun parse(json: String?): ModelManifest? = try {
            val o = JSONObject(json ?: return null)
            val file = o.getString("file")
            val size = o.getLong("size")
            val sha = o.getString("sha256").lowercase()
            if (!file.startsWith("models/") || file.contains("..") || size <= 0 || !SHA.matches(sha)) null
            else ModelManifest(file, size, sha)
        } catch (_: Exception) {
            null
        }
    }
}

/**
 * Plain HTTP download with resume and SHA-256 check (D-032). No Android
 * types, so it is unit-tested against a local server.
 */
object ModelDownloader {
    class HttpStatus(val code: Int) : IOException("HTTP $code")

    private fun open(url: String, headers: Map<String, String>): HttpURLConnection =
        (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 20_000
            readTimeout = 30_000
            headers.forEach { (k, v) -> setRequestProperty(k, v) }
        }

    /** A small text file (the manifest); [HttpStatus] for anything but 200. */
    fun fetchText(url: String, headers: Map<String, String>, maxBytes: Int = 16_384): String {
        val c = open(url, headers)
        try {
            if (c.responseCode != 200) throw HttpStatus(c.responseCode)
            val out = java.io.ByteArrayOutputStream()
            c.inputStream.use { input ->
                val buffer = ByteArray(4096)
                while (out.size() < maxBytes) {
                    val n = input.read(buffer, 0, minOf(buffer.size, maxBytes - out.size()))
                    if (n < 0) break
                    out.write(buffer, 0, n)
                }
            }
            return out.toString("UTF-8")
        } finally {
            c.disconnect()
        }
    }

    /**
     * Downloads into [part], continuing from its current length with a Range
     * request when the server allows (206), else from the start. Returns the
     * file's length. [stopped] ends early (the partial file stays for later).
     */
    fun download(
        url: String,
        headers: Map<String, String>,
        part: File,
        expectedSize: Long,
        onProgress: (Long) -> Unit = {},
        stopped: () -> Boolean = { false },
    ): Long {
        part.parentFile?.mkdirs()
        if (part.length() > expectedSize) part.delete()
        var have = part.length()
        if (have == expectedSize) return have
        val c = open(url, if (have > 0) headers + ("Range" to "bytes=$have-") else headers)
        try {
            val code = c.responseCode
            when {
                code == 206 && have > 0 -> Unit
                code == 200 -> have = 0
                code == 416 -> { part.delete(); throw HttpStatus(code) }
                else -> throw HttpStatus(code)
            }
            RandomAccessFile(part, "rw").use { out ->
                out.setLength(have)
                out.seek(have)
                c.inputStream.use { input ->
                    val buffer = ByteArray(256 * 1024)
                    var lastReport = have
                    while (true) {
                        if (stopped()) break
                        val n = input.read(buffer)
                        if (n < 0) break
                        out.write(buffer, 0, n)
                        have += n
                        if (have > expectedSize) throw IOException("Too large")
                        if (have - lastReport >= 1_048_576) { onProgress(have); lastReport = have }
                    }
                }
            }
            onProgress(have)
            return have
        } finally {
            c.disconnect()
        }
    }

    fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        FileInputStream(file).use { input ->
            val buffer = ByteArray(1024 * 1024)
            while (true) {
                val n = input.read(buffer)
                if (n < 0) break
                digest.update(buffer, 0, n)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    /** Firebase Storage's download URL for [path] in [bucket] (the rules check the ID token). */
    fun storageUrl(bucket: String, path: String, base: String = "https://firebasestorage.googleapis.com"): String =
        "$base/v0/b/$bucket/o/${URLEncoder.encode(path, "UTF-8").replace("+", "%20")}?alt=media"
}

/** The on-device model's state for the settings screen. Pure. */
object GemmaStatus {
    const val NOT_DOWNLOADED = "not-downloaded"
    const val WAITING_FOR_WIFI = "waiting-for-wifi"
    const val QUEUED = "queued"
    const val DOWNLOADING = "downloading"
    const val VERIFYING = "verifying"
    const val READY = "ready"
    const val NOT_AVAILABLE = "not-available"
    const val NO_SPACE = "no-space"
    const val SIGN_IN = "sign-in"
    const val FAILED = "failed"

    /**
     * [stored] is what the download worker last wrote; [ready] means the file
     * is there and its hash was checked; [workActive] is whether the
     * download job is queued or running.
     */
    fun describe(stored: String?, ready: Boolean, workActive: Boolean, metered: Boolean): String = when {
        ready -> READY
        workActive && (stored == null || stored == QUEUED || stored == NOT_DOWNLOADED) -> if (metered) WAITING_FOR_WIFI else QUEUED
        workActive && stored == DOWNLOADING && metered -> WAITING_FOR_WIFI
        workActive -> stored ?: QUEUED
        stored == DOWNLOADING || stored == VERIFYING || stored == QUEUED || stored == READY || stored == null -> NOT_DOWNLOADED
        else -> stored
    }
}

/**
 * Gemma 3 1B (int4, LiteRT-LM) downloaded from the project's Storage bucket
 * on an unmetered network (D-032). Files live in app-private storage; the
 * state is in SharedPreferences `on_device_model`.
 */
object GemmaModel {
    const val LABEL = "Gemma 3 1B"
    const val MANIFEST = "models/gemma3-1b-it-int4.json"
    const val FILE_NAME = "gemma3-1b-it-int4.litertlm"
    /** For the screen before the manifest is read (the published int4 file). */
    const val APPROX_SIZE = 584_417_280L
    private const val WORK = "gemma-download"
    private const val PREFS = "on_device_model"
    private const val K_STATE = "state"
    private const val K_DONE = "done"
    private const val K_TOTAL = "total"
    private const val K_VERIFIED = "verified_sha"

    private fun prefs(context: Context) = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun dir(context: Context) = File(context.applicationContext.filesDir, "models")
    fun file(context: Context) = File(dir(context), FILE_NAME)
    fun part(context: Context) = File(dir(context), "$FILE_NAME.part")

    /** The file is there and passed the hash check after download. */
    fun isReady(context: Context): Boolean = file(context).isFile && prefs(context).getString(K_VERIFIED, null) != null

    internal fun setState(context: Context, state: String, done: Long? = null, total: Long? = null) {
        prefs(context).edit().putString(K_STATE, state)
            .apply { done?.let { putLong(K_DONE, it) }; total?.let { putLong(K_TOTAL, it) } }
            .apply()
    }

    internal fun markVerified(context: Context, sha: String) =
        prefs(context).edit().putString(K_VERIFIED, sha).putString(K_STATE, GemmaStatus.READY).apply()

    private fun workActive(context: Context): Boolean = try {
        WorkManager.getInstance(context).getWorkInfosForUniqueWork(WORK).get(2, TimeUnit.SECONDS)
            .any { !it.state.isFinished }
    } catch (_: Exception) {
        false
    }

    private fun metered(context: Context) =
        (context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager).isActiveNetworkMetered

    fun status(context: Context): Map<String, Any?> {
        val p = prefs(context)
        val ready = isReady(context)
        val state = GemmaStatus.describe(p.getString(K_STATE, null), ready, workActive(context), metered(context))
        val total = p.getLong(K_TOTAL, 0).takeIf { it > 0 } ?: APPROX_SIZE
        return mapOf(
            "state" to state,
            "done" to if (ready) total else part(context).length().coerceAtMost(total),
            "total" to total,
            "model" to LABEL,
        )
    }

    /** Queues the download; it starts on an unmetered network with enough storage. */
    fun download(context: Context) {
        if (isReady(context)) return
        setState(context, GemmaStatus.QUEUED)
        val request = OneTimeWorkRequestBuilder<GemmaDownloadWorker>()
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.UNMETERED)
                    .setRequiresStorageNotLow(true)
                    .build(),
            )
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(WORK, ExistingWorkPolicy.KEEP, request)
    }

    /** Stops a download and drops the partial file. */
    fun cancel(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(WORK)
        part(context).delete()
        setState(context, GemmaStatus.NOT_DOWNLOADED, done = 0)
    }

    /** Removes the model; the setting falls back to Off. */
    fun delete(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(WORK)
        file(context).delete()
        part(context).delete()
        prefs(context).edit().clear().apply()
        if (SmsPrefs.aiMode(context) == AiMode.GEMMA) SmsPrefs.setAiMode(context, AiMode.OFF)
    }
}

/**
 * Downloads the model as a foreground job with a progress notification:
 * manifest first (404 means "not available yet"), then the file with resume,
 * then the SHA-256 check. Network errors retry with the partial file kept.
 */
class GemmaDownloadWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun getForegroundInfo(): ForegroundInfo = foreground(0, 0)

    private fun foreground(done: Long, total: Long): ForegroundInfo {
        val manager = applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(NotificationChannel(CHANNEL, "On-device model download", NotificationManager.IMPORTANCE_LOW))
        }
        val percent = if (total > 0) (done * 100 / total).toInt() else 0
        val notification: Notification = NotificationCompat.Builder(applicationContext, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_entry)
            .setContentTitle("Downloading ${GemmaModel.LABEL}")
            .setContentText(if (total > 0) "$percent%" else "Starting…")
            .setProgress(100, percent, total <= 0)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build()
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ForegroundInfo(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            ForegroundInfo(NOTIFICATION_ID, notification)
        }
    }

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val context = applicationContext
        val table = SmsPrefs.table(context)
        val bucket = table.firebase?.storageBucket
            ?: return@withContext done(GemmaStatus.NOT_AVAILABLE) // demo and emulator builds
        val app = NativeFirebase.appFor(context, table) ?: return@withContext done(GemmaStatus.SIGN_IN)
        val token = runCatching {
            Tasks.await(FirebaseAuth.getInstance(app).currentUser!!.getIdToken(false), 20, TimeUnit.SECONDS).token
        }.getOrNull() ?: return@withContext retryOr(GemmaStatus.FAILED)
        val headers = mapOf("Authorization" to "Firebase $token")

        val manifest = try {
            ModelManifest.parse(ModelDownloader.fetchText(ModelDownloader.storageUrl(bucket, GemmaModel.MANIFEST), headers))
        } catch (e: ModelDownloader.HttpStatus) {
            if (e.code == 404 || e.code == 403) return@withContext done(GemmaStatus.NOT_AVAILABLE)
            return@withContext retryOr(GemmaStatus.FAILED)
        } catch (_: IOException) {
            return@withContext retryOr(GemmaStatus.FAILED)
        } ?: return@withContext done(GemmaStatus.NOT_AVAILABLE)

        val part = GemmaModel.part(context)
        GemmaModel.dir(context).mkdirs()
        if (GemmaModel.dir(context).usableSpace < manifest.size - part.length() + SPACE_MARGIN) {
            return@withContext done(GemmaStatus.NO_SPACE)
        }
        GemmaModel.setState(context, GemmaStatus.DOWNLOADING, done = part.length(), total = manifest.size)
        runCatching { setForeground(foreground(part.length(), manifest.size)) }
        try {
            var lastShown = 0L
            ModelDownloader.download(
                ModelDownloader.storageUrl(bucket, manifest.file), headers, part, manifest.size,
                onProgress = { done ->
                    if (done - lastShown >= 8L * 1_048_576) {
                        lastShown = done
                        runCatching { setForegroundAsync(foreground(done, manifest.size)) }
                    }
                },
                stopped = { isStopped },
            )
        } catch (e: ModelDownloader.HttpStatus) {
            if (e.code == 404 || e.code == 403) return@withContext done(GemmaStatus.NOT_AVAILABLE)
            return@withContext retryOr(GemmaStatus.FAILED)
        } catch (_: IOException) {
            return@withContext retryOr(GemmaStatus.FAILED)
        }
        if (isStopped) return@withContext Result.retry()
        if (part.length() != manifest.size) return@withContext retryOr(GemmaStatus.FAILED)

        GemmaModel.setState(context, GemmaStatus.VERIFYING)
        if (ModelDownloader.sha256(part) != manifest.sha256) {
            part.delete()
            return@withContext done(GemmaStatus.FAILED)
        }
        val target = GemmaModel.file(context)
        target.delete()
        if (!part.renameTo(target)) return@withContext done(GemmaStatus.FAILED)
        GemmaModel.markVerified(context, manifest.sha256)
        Result.success()
    }

    private fun done(state: String): Result {
        GemmaModel.setState(applicationContext, state)
        return Result.success()
    }

    private fun retryOr(state: String): Result =
        if (runAttemptCount < MAX_ATTEMPTS) Result.retry() else done(state)

    private companion object {
        const val CHANNEL = "model_download"
        const val NOTIFICATION_ID = 4204
        const val MAX_ATTEMPTS = 5
        const val SPACE_MARGIN = 100L * 1024 * 1024
    }
}
