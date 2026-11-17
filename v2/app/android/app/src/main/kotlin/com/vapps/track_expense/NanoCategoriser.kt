package com.vapps.track_expense

import android.content.Context
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.os.Build
import androidx.annotation.RequiresApi
import com.google.mlkit.genai.common.DownloadStatus
import com.google.mlkit.genai.common.GenAiException
import com.google.mlkit.genai.prompt.Generation
import com.google.mlkit.genai.prompt.GenerativeModel
import com.google.mlkit.genai.prompt.TextPart
import com.google.mlkit.genai.prompt.generateContentRequest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Suggests a category for a payee the rules cannot place, with Gemini Nano on
 * the phone (ML Kit GenAI Prompt API). Its guess is never trusted to save an
 * entry by itself: it only preselects a category in the review list (D-029).
 *
 * AICore allows inference only while the app is the top foreground app, so
 * this runs when the review list is opened, not in the background worker.
 */
/**
 * Why Gemini Nano is or is not usable, for the SMS settings screen.
 * [status] is one of the [NanoStatusMapper] values; [code] is a short,
 * non-sensitive detail (an error code, the AICore version) or null.
 */
data class NanoState(val status: String, val code: String? = null) {
    fun toMap(): Map<String, Any?> = mapOf("status" to status, "code" to code)
}

interface NanoCategoriser {
    suspend fun status(): NanoState

    /** Starts the model download when it is downloadable and the network is unmetered. */
    suspend fun downloadIfUnmetered(): NanoState

    /** A category id from [categories], or null for no answer. Times out after 5 s. */
    suspend fun categorise(merchant: String, type: String, categories: List<CategoryOption>): String?
}

/** Phones below Android 8.0: the ML Kit GenAI library needs API 26. */
object UnsupportedNano : NanoCategoriser {
    override suspend fun status() = NanoState(NanoStatusMapper.ANDROID_TOO_OLD)
    override suspend fun downloadIfUnmetered() = status()
    override suspend fun categorise(merchant: String, type: String, categories: List<CategoryOption>): String? = null
}

/**
 * Maps ML Kit GenAI results to a precise status. Pure, for unit tests.
 * Values follow `FeatureStatus` and `GenAiException.ErrorCode` of
 * genai-common 1.0.0-beta5, and the AICore error codes the ML Kit
 * troubleshooting guide names (601 binding failure, 606 feature not found).
 */
object NanoStatusMapper {
    const val AVAILABLE = "available"
    const val DOWNLOADABLE = "downloadable"
    const val WAITING_FOR_WIFI = "waiting-for-wifi"
    const val DOWNLOADING = "downloading"
    const val UNSUPPORTED = "unsupported"
    const val AICORE_UPDATE = "aicore-update"
    const val PREPARING = "preparing"
    const val NO_SPACE = "no-space"
    const val BUSY = "busy"
    const val ANDROID_TOO_OLD = "android-too-old"
    const val ERROR = "error"

    // FeatureStatus
    const val FS_UNAVAILABLE = 0
    const val FS_DOWNLOADABLE = 1
    const val FS_DOWNLOADING = 2
    const val FS_AVAILABLE = 3

    // GenAiException.ErrorCode
    const val E_NOT_AVAILABLE = 8
    const val E_BUSY = 9
    const val E_NOT_SUPPORTED = 16
    const val E_QUOTA = 27
    const val E_BACKGROUND = 30
    const val E_NO_SPACE = 501
    const val E_NEEDS_SYSTEM_UPDATE = 604
    const val E_AICORE_INCOMPATIBLE = -101

    // AICore error codes inside a GenAiException
    const val AICORE_BINDING_FAILURE = 601
    const val AICORE_FEATURE_NOT_FOUND = 606

    /**
     * [aiCoreVersion] is the installed "Android AICore" app version, or null
     * when it is not installed. It is shown as the code for an unsupported
     * phone, which helps tell "not on the list" from "AICore too old".
     */
    fun fromFeatureStatus(status: Int, metered: Boolean, aiCoreVersion: String?): NanoState = when (status) {
        FS_AVAILABLE -> NanoState(AVAILABLE)
        FS_DOWNLOADABLE -> NanoState(if (metered) WAITING_FOR_WIFI else DOWNLOADABLE)
        FS_DOWNLOADING -> NanoState(DOWNLOADING)
        FS_UNAVAILABLE -> NanoState(UNSUPPORTED, aiCoreCode(aiCoreVersion))
        else -> NanoState(ERROR, "status $status")
    }

    fun fromException(errorCode: Int, aiCoreErrorCode: Int, aiCoreVersion: String?): NanoState = when {
        errorCode == E_NEEDS_SYSTEM_UPDATE || errorCode == E_AICORE_INCOMPATIBLE ||
            aiCoreErrorCode == AICORE_BINDING_FAILURE -> NanoState(AICORE_UPDATE, aiCoreCode(aiCoreVersion))
        aiCoreErrorCode == AICORE_FEATURE_NOT_FOUND -> NanoState(PREPARING, "AICore 606")
        errorCode == E_NOT_AVAILABLE || errorCode == E_NOT_SUPPORTED -> NanoState(UNSUPPORTED, aiCoreCode(aiCoreVersion))
        errorCode == E_NO_SPACE -> NanoState(NO_SPACE)
        errorCode == E_BUSY || errorCode == E_QUOTA || errorCode == E_BACKGROUND -> NanoState(BUSY, "code $errorCode")
        else -> NanoState(ERROR, if (aiCoreErrorCode != 0) "code $errorCode/$aiCoreErrorCode" else "code $errorCode")
    }

    /** Any other exception: only its class name, never its message. */
    fun fromThrowable(t: Throwable): NanoState = NanoState(ERROR, t.javaClass.simpleName.take(40).ifEmpty { "exception" })

    private fun aiCoreCode(version: String?) = if (version == null) "AICore not installed" else "AICore $version"
}

/** The prompt and the answer check. Pure, for unit tests. */
object NanoPrompt {
    fun build(merchant: String, type: String, categories: List<CategoryOption>): String {
        val ids = categories.filter { it.type == type }.joinToString(", ") { it.id }
        return "Classify a bank payment for a household expense tracker.\n" +
            "Payee: ${merchant.take(60)}\n" +
            "Direction: $type\n" +
            "Categories: $ids\n" +
            "Answer with exactly one category id from the list and nothing else. " +
            "If unsure, answer none."
    }

    /** The answer is accepted only when it is one of the listed ids of the right type. */
    fun parse(answer: String?, type: String, categories: List<CategoryOption>): String? {
        val cleaned = answer?.trim()?.lowercase()?.trim('.', '"', '\'', '`', ' ', '\n')
            ?.removePrefix("category:")?.trim() ?: return null
        return categories.firstOrNull { it.type == type && it.id.lowercase() == cleaned }?.id
    }
}

object Nano {
    fun create(context: Context): NanoCategoriser =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) MlKitNano(context.applicationContext) else UnsupportedNano
}

@RequiresApi(Build.VERSION_CODES.O)
private class MlKitNano(private val context: Context) : NanoCategoriser {
    private val model: GenerativeModel by lazy { Generation.getClient() }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private fun metered(): Boolean =
        (context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager).isActiveNetworkMetered

    /** Version of the "Android AICore" system app, or null when it is not installed. */
    private fun aiCoreVersion(): String? = try {
        @Suppress("DEPRECATION")
        context.packageManager.getPackageInfo(AICORE_PACKAGE, 0).versionName ?: "?"
    } catch (_: PackageManager.NameNotFoundException) {
        null
    } catch (_: Exception) {
        "?"
    }

    override suspend fun status(): NanoState = try {
        NanoStatusMapper.fromFeatureStatus(model.checkStatus(), metered(), aiCoreVersion())
    } catch (e: GenAiException) {
        NanoStatusMapper.fromException(e.errorCode, e.aiCoreErrorCode, aiCoreVersion())
    } catch (t: Throwable) {
        NanoStatusMapper.fromThrowable(t)
    }

    override suspend fun downloadIfUnmetered(): NanoState {
        val s = status()
        if (s.status != NanoStatusMapper.DOWNLOADABLE) return s
        scope.launch {
            try {
                model.download().collect { st -> if (st is DownloadStatus.DownloadFailed) return@collect }
            } catch (_: Throwable) {
                // The status row shows the state again on "Check again".
            }
        }
        return NanoState(NanoStatusMapper.DOWNLOADING)
    }

    override suspend fun categorise(merchant: String, type: String, categories: List<CategoryOption>): String? {
        if (status().status != NanoStatusMapper.AVAILABLE) return null
        return try {
            withTimeoutOrNull(5_000) {
                val response = model.generateContent(
                    generateContentRequest(TextPart(NanoPrompt.build(merchant, type, categories))) {
                        temperature = 0f
                        topK = 1
                    },
                )
                NanoPrompt.parse(response.candidates.firstOrNull()?.text, type, categories)
            }
        } catch (_: Throwable) {
            null
        }
    }

    private companion object {
        const val AICORE_PACKAGE = "com.google.android.aicore"
    }
}
