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
                CategoryTable(
                    homeId = o.optString("homeId").ifEmpty { null },
                    userId = o.optString("userId").ifEmpty { null },
                    userEmail = o.optString("userEmail").ifEmpty { null },
                    firebase = fb,
                    history = history,
                    builtin = builtin,
                    categories = categories,
                )
            } catch (_: Exception) {
                EMPTY
            }
        }
    }
}

/** Where a category came from. Only [HISTORY] and [BUILTIN] may save on their own. */
enum class CategorySource(val wire: String) { HISTORY("history"), BUILTIN("builtin"), NANO("nano") }

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

    fun decide(table: CategoryTable, sms: ParsedSms): Decision {
        val placement = place(table, sms)
        val confident = placement != null && sms.definite && sms.amount != null && table.canWrite
        return if (confident) Decision.AutoAdd(placement!!) else Decision.Review(placement)
    }
}
