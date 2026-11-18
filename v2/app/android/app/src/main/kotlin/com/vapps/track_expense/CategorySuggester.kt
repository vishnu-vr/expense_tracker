package com.vapps.track_expense

import android.content.Context
import com.google.android.gms.tasks.Tasks
import com.google.firebase.functions.FirebaseFunctions
import kotlinx.coroutines.withTimeoutOrNull
import java.util.concurrent.TimeUnit

/** "Category suggestions" in SMS settings (D-032). Off by default. */
enum class AiMode(val wire: String) {
    OFF("off"), CLOUD("cloud"), GEMMA("gemma"), NANO("nano");

    companion object {
        fun fromWire(raw: String?): AiMode = entries.firstOrNull { it.wire == raw } ?: OFF
    }
}

/** D-027 model keys for Cloud suggestions. The server maps keys to models. */
object CloudModel {
    const val DEFAULT = "flash-lite"
    private val labels = mapOf("flash-lite" to "Gemini Flash-Lite", "flash" to "Gemini Flash")

    fun clean(key: String?): String = key?.takeIf { it in labels } ?: DEFAULT

    fun label(key: String?): String = labels.getValue(clean(key))
}

/**
 * One thing to ask a model about: a payee name, or with [words] the user's
 * own reply ("auto to office"). Never the message text, at most 80 characters.
 */
data class SuggestItem(val text: String, val type: String, val words: Boolean) {
    companion object {
        const val MAX_TEXT = 80

        /**
         * What to ask about a review item: its reply words, else its payee.
         * Phone-number payees ("UPI xxxxx1234") say nothing about the
         * payment, so they are not sent anywhere.
         */
        fun of(item: ReviewItem): SuggestItem? {
            item.words?.trim()?.takeIf { it.isNotEmpty() }?.let { return SuggestItem(it.take(MAX_TEXT), item.type, words = true) }
            val payee = item.merchant?.trim()?.takeIf { it.isNotEmpty() && !it.startsWith("UPI xxxxx") } ?: return null
            return SuggestItem(payee.take(MAX_TEXT), item.type, words = false)
        }
    }
}

/**
 * A model that suggests categories (D-032). Its answers only ever preselect
 * a category that the user must approve; nothing it says is saved on its own.
 */
interface CategorySuggester {
    /** Shown as "Suggested by AI · <model>"; null when there is no model. */
    val model: String?

    /** One category id (of the item's type, from [categories]) or null per item. Never throws. */
    suspend fun suggest(items: List<SuggestItem>, categories: List<CategoryOption>): List<String?>
}

object NoSuggester : CategorySuggester {
    override val model: String? = null
    override suspend fun suggest(items: List<SuggestItem>, categories: List<CategoryOption>) = items.map { null }
}

/** Keeps only ids that exist and fit each item's type. Pure. */
object SuggestCheck {
    fun keep(ids: List<String?>, items: List<SuggestItem>, categories: List<CategoryOption>): List<String?> =
        items.mapIndexed { i, item ->
            ids.getOrNull(i)?.takeIf { id -> categories.any { it.id == id && it.type == item.type } }
        }
}

/** Gemini Nano (ML Kit, foreground only, D-029). */
class NanoSuggester(private val nano: NanoCategoriser) : CategorySuggester {
    override val model = "Gemini Nano"
    override suspend fun suggest(items: List<SuggestItem>, categories: List<CategoryOption>) =
        items.map { runCatching { nano.categorise(it.text, it.type, categories, it.words) }.getOrNull() }
}

/** Runs prompts on an on-device model; null when it cannot run. [OnDeviceLlm] in the app. */
fun interface PromptRunner {
    suspend fun ask(prompts: List<String>): List<String?>?
}

/** Gemma 3 1B on the phone (LiteRT-LM), once downloaded and verified. */
class GemmaSuggester(private val llm: PromptRunner) : CategorySuggester {
    override val model = GemmaModel.LABEL
    override suspend fun suggest(items: List<SuggestItem>, categories: List<CategoryOption>): List<String?> {
        val answers = llm.ask(items.map { NanoPrompt.build(it.text, it.type, categories, it.words) }) ?: return items.map { null }
        return items.mapIndexed { i, item -> NanoPrompt.parse(answers.getOrNull(i), item.type, categories) }
    }
}

/**
 * The `suggestSmsCategory` callable (asia-south1) through the native
 * Functions SDK, as the signed-in user. Sends only the payee name or the
 * reply words (D-032). Any failure (offline, limit, signed out) is no answer.
 */
class CloudSuggester(
    private val context: Context,
    private val table: CategoryTable,
    private val modelKey: String,
) : CategorySuggester {
    override var model: String? = CloudModel.label(modelKey)
        private set

    override suspend fun suggest(items: List<SuggestItem>, categories: List<CategoryOption>): List<String?> {
        if (items.isEmpty()) return emptyList()
        val app = NativeFirebase.appFor(context, table) ?: return items.map { null }
        return try {
            val request = mapOf(
                "items" to items.take(MAX_ITEMS).map { mapOf("text" to it.text, "type" to it.type, "kind" to if (it.words) "words" else "payee") },
                "model" to modelKey,
            )
            val task = FirebaseFunctions.getInstance(app, REGION).getHttpsCallable("suggestSmsCategory").call(request)
            val data = Tasks.await(task, TIMEOUT_S, TimeUnit.SECONDS).getData() as? Map<*, *> ?: return items.map { null }
            (data["model"] as? String)?.takeIf { it.isNotBlank() }?.let { model = it.take(40) }
            val ids = (data["suggestions"] as? List<*>)?.map { it as? String } ?: emptyList()
            SuggestCheck.keep(ids, items, categories)
        } catch (_: Exception) {
            items.map { null }
        }
    }

    companion object {
        const val REGION = "asia-south1"
        const val MAX_ITEMS = 5
        const val TIMEOUT_S = 12L
    }
}

/** Which suggester the setting gives, in the background worker or the open app. */
object Suggesters {
    /**
     * The mode that can actually run now. Pure. Nano runs only while the app
     * is in the foreground (AICore blocks background use); Gemma only once
     * its file is downloaded and verified; Cloud only when signed in to the
     * real project.
     */
    fun effective(mode: AiMode, foreground: Boolean, canCloud: Boolean, gemmaReady: Boolean): AiMode = when (mode) {
        AiMode.CLOUD -> if (canCloud) AiMode.CLOUD else AiMode.OFF
        AiMode.GEMMA -> if (gemmaReady) AiMode.GEMMA else AiMode.OFF
        AiMode.NANO -> if (foreground) AiMode.NANO else AiMode.OFF
        AiMode.OFF -> AiMode.OFF
    }

    fun create(context: Context, table: CategoryTable, foreground: Boolean, nano: () -> NanoCategoriser = { Nano.create(context) }): CategorySuggester {
        val mode = effective(SmsPrefs.aiMode(context), foreground, table.canWrite, GemmaModel.isReady(context))
        return when (mode) {
            AiMode.CLOUD -> CloudSuggester(context, table, SmsPrefs.cloudModel(context))
            AiMode.GEMMA -> GemmaSuggester(OnDeviceLlm.forGemma(context))
            AiMode.NANO -> NanoSuggester(nano())
            AiMode.OFF -> NoSuggester
        }
    }
}

/**
 * Asks the chosen model about review items (D-032) and marks what it found
 * as an AI suggestion ("ai" + the model's name). Never saves anything.
 */
object AiSuggest {
    const val MAX_ITEMS = 5

    /** Items worth asking about: reply words with no clear category, or a payee the rules could not place. Pure. */
    fun candidates(items: List<ReviewItem>): List<ReviewItem> =
        items.filter { (it.categoryId == null || it.words != null && !it.isAiSuggestion) && SuggestItem.of(it) != null }.take(MAX_ITEMS)

    /** The items with an AI suggestion added where the model answered. Pure apart from [suggester]. */
    suspend fun apply(items: List<ReviewItem>, categories: List<CategoryOption>, suggester: CategorySuggester): List<ReviewItem> {
        if (suggester.model == null || categories.isEmpty()) return items
        val asked = items.mapNotNull { item -> SuggestItem.of(item)?.let { item to it } }
        if (asked.isEmpty()) return items
        val ids = suggester.suggest(asked.map { it.second }, categories)
        val byId = asked.mapIndexedNotNull { i, (item, _) ->
            ids.getOrNull(i)?.let { item.id to item.copy(categoryId = it, categorySource = ReviewItem.AI_SOURCE, aiModel = suggester.model) }
        }.toMap()
        return items.map { byId[it.id] ?: it }
    }

    /** One item, for the background paths; null when the model had nothing (or took too long). */
    suspend fun one(context: Context, table: CategoryTable, item: ReviewItem, timeoutMs: Long = 40_000): ReviewItem? {
        if (SuggestItem.of(item) == null) return null
        val suggester = Suggesters.create(context, table, foreground = false)
        if (suggester.model == null) return null
        val updated = withTimeoutOrNull(timeoutMs) { apply(listOf(item), table.categories, suggester).first() } ?: return null
        return updated.takeIf { it.isAiSuggestion && it !== item }
    }
}
