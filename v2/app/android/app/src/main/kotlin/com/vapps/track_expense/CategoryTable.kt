package com.vapps.track_expense

import org.json.JSONArray
import org.json.JSONObject

/** One category the household can use. */
data class CategoryOption(val id: String, val name: String, val type: String)

/** Firebase client ids for the native SDK (public values, as in `firebase_options.dart`). */
data class FirebaseConfig(
    val apiKey: String,
    val appId: String,
    val projectId: String,
    val messagingSenderId: String,
    val storageBucket: String?,
)

/**
 * The lookup table the Flutter app builds from the household's entries
 * (`buildCategoryTable` in `sms_categories.dart`) and pushes over the
 * `track_expense/sms` channel. Kotlin only looks things up; the confidence
 * rule is decided in Dart and only "known" merchants are exported.
 */
data class CategoryTable(
    val homeId: String?,
    val userId: String?,
    val userEmail: String?,
    /** Null in demo and emulator builds: nothing is written natively then. */
    val firebase: FirebaseConfig?,
    /** "expense:swiggy" → "food": merchants the household already files consistently. */
    val history: Map<String, String>,
    /** Built-in merchants: pattern on the merchant key, canonical key, default category. */
    val builtin: List<BuiltinMerchant>,
    val categories: List<CategoryOption>,
    /** "expense:auto" → "transportation": words the household's notes use consistently. */
    val words: Map<String, String> = emptyMap(),
    /** Built-in reply keywords ("lunch" → "food"), expense only. */
    val keywords: Map<String, String> = emptyMap(),
    /** Amount band edges and day-part start hours, as in `sms_categories.dart`. */
    val bands: List<Double> = emptyList(),
    val parts: List<Int> = emptyList(),
    /** Quick suggestions: type → "b<band>p<part>" → category ids, best first. */
    val suggest: Map<String, Map<String, List<String>>> = emptyMap(),
    /** Most-used categories per type, the fallback for [suggest]. */
    val top: Map<String, List<String>> = emptyMap(),
) {
    data class BuiltinMerchant(val pattern: Regex, val key: String, val categoryId: String?)

    /** True when entries can be written for a signed-in member of a household. */
    val canWrite: Boolean get() = homeId != null && userId != null && firebase != null

    fun category(id: String?): CategoryOption? = categories.firstOrNull { it.id == id }

    companion object {
        val EMPTY = CategoryTable(null, null, null, null, emptyMap(), emptyList(), emptyList())

        fun decode(json: String?): CategoryTable {
            if (json.isNullOrBlank()) return EMPTY
            return try {
                val o = JSONObject(json)
                val fb = o.optJSONObject("firebase")?.let {
                    FirebaseConfig(
                        apiKey = it.getString("apiKey"),
                        appId = it.getString("appId"),
                        projectId = it.getString("projectId"),
                        messagingSenderId = it.getString("messagingSenderId"),
                        storageBucket = it.optString("storageBucket").ifEmpty { null },
                    )
                }
                val history = buildMap {
                    o.optJSONObject("history")?.let { h ->
                        for (k in h.keys()) put(k, h.getString(k))
                    }
                }
                val builtin = buildList {
                    val arr = o.optJSONArray("builtin") ?: JSONArray()
                    for (i in 0 until arr.length()) {
                        val b = arr.getJSONObject(i)
                        val pattern = runCatching { Regex(b.getString("p")) }.getOrNull() ?: continue
                        add(BuiltinMerchant(pattern, b.getString("m"), b.optString("c").ifEmpty { null }))
                    }
                }
                val categories = buildList {
                    val arr = o.optJSONArray("categories") ?: JSONArray()
                    for (i in 0 until arr.length()) {
                        val c = arr.getJSONObject(i)
                        add(CategoryOption(c.getString("id"), c.optString("name", c.getString("id")), c.optString("type", "expense")))
                    }
                }
                fun strings(arr: JSONArray?) = buildList { if (arr != null) for (i in 0 until arr.length()) add(arr.getString(i)) }
                fun stringMap(obj: JSONObject?) = buildMap { obj?.let { m -> for (k in m.keys()) put(k, m.getString(k)) } }
                val bands = o.optJSONArray("bands")?.let { a -> (0 until a.length()).map { a.getDouble(it) } } ?: emptyList()
                val parts = o.optJSONArray("parts")?.let { a -> (0 until a.length()).map { a.getInt(it) } } ?: emptyList()
                val suggest = buildMap {
                    o.optJSONObject("suggest")?.let { byType ->
                        for (type in byType.keys()) {
                            val cells = byType.getJSONObject(type)
                            put(type, buildMap { for (c in cells.keys()) put(c, strings(cells.getJSONArray(c))) })
                        }
                    }
                }
                val top = buildMap {
                    o.optJSONObject("top")?.let { t -> for (k in t.keys()) put(k, strings(t.getJSONArray(k))) }
                }
                CategoryTable(
                    homeId = o.optString("homeId").ifEmpty { null },
                    userId = o.optString("userId").ifEmpty { null },
                    userEmail = o.optString("userEmail").ifEmpty { null },
                    firebase = fb,
                    history = history,
                    builtin = builtin,
                    categories = categories,
                    words = stringMap(o.optJSONObject("words")),
                    keywords = stringMap(o.optJSONObject("keywords")),
                    bands = bands,
                    parts = parts,
                    suggest = suggest,
                    top = top,
                )
            } catch (_: Exception) {
                EMPTY
            }
        }
    }
}

/** Where a category came from. Only [HISTORY], [BUILTIN] and [MEMORY] may save on their own. */
enum class CategorySource(val wire: String) { HISTORY("history"), BUILTIN("builtin"), MEMORY("memory"), NANO("nano") }

data class Placement(val categoryId: String, val source: CategorySource)

/** What to do with a parsed message. */
sealed class Decision {
    data class AutoAdd(val placement: Placement) : Decision()
    data class Review(val suggestion: Placement?) : Decision()
}

/**
 * The confidence rule (D-029). A message is saved on its own only when all
 * hold: it says money actually moved, it has an amount, a payee, and the
 * payee's category comes from the household's history or the built-in map
 * (with a category of the right type), and the app is signed in to a real
 * household. Everything else goes to the review list.
 */
object SmsCategoriser {
    fun place(table: CategoryTable, sms: ParsedSms): Placement? {
        val key = sms.merchantKey ?: return null
        fun ok(id: String?) = id != null && table.category(id)?.type == sms.type

        table.history["${sms.type}:$key"]?.takeIf(::ok)?.let { return Placement(it, CategorySource.HISTORY) }
        val known = table.builtin.firstOrNull { it.pattern.containsMatchIn(key) } ?: return null
        table.history["${sms.type}:${known.key}"]?.takeIf(::ok)?.let { return Placement(it, CategorySource.HISTORY) }
        return known.categoryId?.takeIf(::ok)?.let { Placement(it, CategorySource.BUILTIN) }
    }

    /**
     * A remembered payee (D-030) comes first: the user labelled this exact
     * payee before, so it counts as confident like the household's history.
     */
    fun decide(table: CategoryTable, sms: ParsedSms, memory: RememberedPayee? = null): Decision {
        val remembered = memory?.categoryId?.takeIf { memory.type == sms.type && table.category(it)?.type == sms.type }
        val placement = remembered?.let { Placement(it, CategorySource.MEMORY) } ?: place(table, sms)
        val confident = placement != null && sms.definite && sms.amount != null && table.canWrite
        return if (confident) Decision.AutoAdd(placement!!) else Decision.Review(placement)
    }
}

/** The entry note. Same rule as `smsNote` in `sms_categories.dart`. */
object SmsNote {
    /** "auto to office · Ramesh K" with words; "Ramesh K · HDFC XX1234" without. */
    fun compose(words: String?, merchant: String?, account: String?): String? {
        val w = words?.trim().orEmpty()
        val parts = if (w.isEmpty()) listOfNotNull(merchant, account) else listOfNotNull(w, merchant ?: account)
        return parts.joinToString(" · ").ifEmpty { null }
    }
}

/**
 * Quick category suggestions for a payment the rules could not place
 * (D-030), from the cells Dart computed (`buildQuickSuggestions`): the
 * household's categories for a similar amount and time of day, else its
 * most-used ones.
 */
object QuickSuggest {
    fun band(table: CategoryTable, amount: Double) = table.bands.count { amount >= it }

    fun part(table: CategoryTable, hour: Int): Int {
        if (table.parts.isEmpty()) return 0
        var part = table.parts.size - 1
        table.parts.forEachIndexed { i, start -> if (hour >= start) part = i }
        return part
    }

    fun top(table: CategoryTable, type: String, amount: Double?, hour: Int, n: Int = 2): List<String> {
        val cell = amount?.let { table.suggest[type]?.get("b${band(table, it)}p${part(table, hour)}") }
        return (cell ?: table.top[type].orEmpty())
            .filter { table.category(it)?.type == type }
            .distinct().take(n)
    }
}

/** What a typed reply says about the category. */
data class ReplyGuess(
    /** Set only when every clue points at one category. */
    val categoryId: String?,
    /** Categories the words pointed at, most clues first (for the buttons when unsure). */
    val candidates: List<String>,
)

/**
 * Guesses a category from the words typed in a notification reply ("auto to
 * office", "gift for amma"). Gemini Nano cannot run in the background, so
 * this uses only the table: each word votes through the household's own
 * note words, else the built-in keywords; the whole text also votes through
 * the merchant dictionary (with the household's history for that merchant).
 * Confident only when all votes agree. Words are never logged or stored here.
 */
object ReplyCategoriser {
    private val stopWords = setOf(
        "the", "and", "for", "from", "with", "via", "paid", "payment", "sent", "upi", "bank", "hdfc",
        "icici", "sbi", "axis", "kotak", "this", "that", "some", "was", "our", "his", "her", "its",
    )

    /** Same as `noteWords` in Dart: lowercase words of 3+ letters without digits. */
    fun words(text: String): List<String> =
        text.lowercase(java.util.Locale.ROOT).split(Regex("[^a-z0-9]+"))
            .filter { it.length >= 3 && it.none(Char::isDigit) && it !in stopWords }

    fun guess(table: CategoryTable, text: String, type: String): ReplyGuess {
        fun ok(id: String?) = id != null && table.category(id)?.type == type
        val votes = mutableListOf<String>()
        for (w in words(text).distinct()) {
            val id = table.words["$type:$w"]?.takeIf(::ok)
                ?: (if (type == "expense") table.keywords[w] else null)?.takeIf(::ok)
            if (id != null) votes += id
        }
        MerchantKey.of(text)?.let { key ->
            table.builtin.firstOrNull { it.pattern.containsMatchIn(key) }?.let { known ->
                (table.history["$type:${known.key}"]?.takeIf(::ok) ?: known.categoryId?.takeIf(::ok))?.let { votes += it }
            }
        }
        val ranked = votes.groupingBy { it }.eachCount().entries.sortedByDescending { it.value }.map { it.key }
        return ReplyGuess(ranked.singleOrNull(), ranked)
    }
}
