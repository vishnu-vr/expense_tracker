package com.vapps.track_expense

import android.app.ActivityManager
import android.content.Context
import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.Content
import com.google.ai.edge.litertlm.ConversationConfig
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import com.google.ai.edge.litertlm.SamplerConfig
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull
import java.io.File

/** Whether the phone has room to load a ~0.6 GB model right now. Pure. */
object MemoryGate {
    const val MIN_TOTAL = 4L * 1024 * 1024 * 1024
    const val MIN_AVAILABLE = 1L * 1024 * 1024 * 1024

    fun enough(totalBytes: Long, availableBytes: Long, lowMemory: Boolean): Boolean =
        !lowMemory && totalBytes >= MIN_TOTAL && availableBytes >= MIN_AVAILABLE
}

/**
 * Runs a downloaded model with LiteRT-LM (D-032): loaded lazily for one
 * batch of prompts on the CPU, then freed. Prompts and answers are never
 * logged. Only one model is loaded at a time in the process.
 */
class OnDeviceLlm(
    private val context: Context,
    private val modelFile: File,
    private val loadTimeoutMs: Long = 45_000,
) : PromptRunner {
    /** One answer per prompt, or null when the model cannot run (memory, file, error, too slow). */
    override suspend fun ask(prompts: List<String>): List<String?>? {
        if (prompts.isEmpty() || !modelFile.isFile || !hasMemory()) return null
        // The native load cannot be interrupted: on a timeout the caller gets
        // nothing and the work finishes (and frees the model) on its own.
        val work = scope.async {
            lock.withLock { runCatching { run(prompts) }.getOrNull() }
        }
        return withTimeoutOrNull(loadTimeoutMs) { work.await() }
    }

    private fun run(prompts: List<String>): List<String?> {
        val config = EngineConfig(
            modelPath = modelFile.absolutePath,
            backend = Backend.CPU(),
            cacheDir = context.cacheDir.path,
        )
        Engine(config).use { engine ->
            engine.initialize()
            return prompts.map { prompt ->
                runCatching {
                    engine.createConversation(
                        ConversationConfig(samplerConfig = SamplerConfig(topK = 1, topP = 1.0, temperature = 1.0)),
                    ).use { conversation ->
                        conversation.sendMessage(prompt).contents.contents
                            .filterIsInstance<Content.Text>().joinToString("") { it.text }
                    }
                }.getOrNull()
            }
        }
    }

    private fun hasMemory(): Boolean {
        val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val info = ActivityManager.MemoryInfo().also(am::getMemoryInfo)
        return MemoryGate.enough(info.totalMem, info.availMem, info.lowMemory)
    }

    companion object {
        private val lock = Mutex()
        private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

        fun forGemma(context: Context) = OnDeviceLlm(context.applicationContext, GemmaModel.file(context))
    }
}
