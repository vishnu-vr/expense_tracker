package com.vapps.track_expense

import android.content.Context
import android.net.ConnectivityManager
import android.os.Build
import androidx.annotation.RequiresApi
import com.google.mlkit.genai.common.DownloadStatus
import com.google.mlkit.genai.common.FeatureStatus
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
interface NanoCategoriser {
    /** "available", "downloadable", "downloading" or "unavailable". */
    suspend fun status(): String

    /** Starts the model download when it is downloadable and the network is unmetered. */
    suspend fun downloadIfUnmetered(): String

    /** A category id from [categories], or null for no answer. Times out after 5 s. */
    suspend fun categorise(merchant: String, type: String, categories: List<CategoryOption>): String?
}

/** Phones without Gemini Nano (or below Android 8.0). */
object UnsupportedNano : NanoCategoriser {
    override suspend fun status() = "unavailable"
    override suspend fun downloadIfUnmetered() = "unavailable"
    override suspend fun categorise(merchant: String, type: String, categories: List<CategoryOption>): String? = null
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

    override suspend fun status(): String = try {
        when (model.checkStatus()) {
            FeatureStatus.AVAILABLE -> "available"
            FeatureStatus.DOWNLOADABLE -> "downloadable"
            FeatureStatus.DOWNLOADING -> "downloading"
            else -> "unavailable"
        }
    } catch (_: Throwable) {
        "unavailable"
    }

    override suspend fun downloadIfUnmetered(): String {
        val s = status()
        if (s != "downloadable") return s
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        if (cm.isActiveNetworkMetered) return s
        scope.launch {
            try {
                model.download().collect { st -> if (st is DownloadStatus.DownloadFailed) return@collect }
            } catch (_: Throwable) {
                // The status row shows "downloadable" again; nothing else to do.
            }
        }
        return "downloading"
    }

    override suspend fun categorise(merchant: String, type: String, categories: List<CategoryOption>): String? {
        if (status() != "available") return null
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
}
