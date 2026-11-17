package com.vapps.track_expense

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * A detected entry waiting for the user in "Review detected entries".
 * Parsed fields only: the message text is never kept (D-005, D-029).
 */
data class ReviewItem(
    val id: String,
    val amount: Double?,
    val type: String,
    val merchant: String?,
    val account: String?,
    val receivedAt: Long,
    val categoryId: String?,
    val categorySource: String?,
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        amount?.let { put("amount", it) }
        put("type", type)
        merchant?.let { put("merchant", it) }
        account?.let { put("account", it) }
        put("receivedAt", receivedAt)
        categoryId?.let { put("categoryId", it) }
        categorySource?.let { put("categorySource", it) }
    }

    fun toMap(): Map<String, Any?> = mapOf(
        "id" to id, "amount" to amount, "type" to type, "merchant" to merchant,
        "account" to account, "receivedAt" to receivedAt, "categoryId" to categoryId,
        "categorySource" to categorySource,
    )

    companion object {
        fun fromJson(o: JSONObject) = ReviewItem(
            id = o.getString("id"),
            amount = if (o.has("amount")) o.getDouble("amount") else null,
            type = o.optString("type", "expense"),
            merchant = o.optString("merchant").ifEmpty { null },
            account = o.optString("account").ifEmpty { null },
            receivedAt = o.getLong("receivedAt"),
            categoryId = o.optString("categoryId").ifEmpty { null },
            categorySource = o.optString("categorySource").ifEmpty { null },
        )

        fun from(sms: ParsedSms, receivedAt: Long, suggestion: Placement?) = ReviewItem(
            id = "r$receivedAt-${(sms.refHash ?: sms.hashCode().toString()).take(6)}",
            amount = sms.amount,
            type = sms.type,
            merchant = sms.merchant,
            account = sms.account,
            receivedAt = receivedAt,
            categoryId = suggestion?.categoryId,
            categorySource = suggestion?.source?.wire,
        )
    }
}

/** Pure list operations, so the limits are unit-tested without Android. */
object ReviewQueueCodec {
    const val MAX_ITEMS = 100
    const val MAX_AGE_MS = 30L * 24 * 60 * 60 * 1000

    fun decode(json: String?): List<ReviewItem> {
        if (json.isNullOrBlank()) return emptyList()
        return try {
            val arr = JSONArray(json)
            (0 until arr.length()).mapNotNull { runCatching { ReviewItem.fromJson(arr.getJSONObject(it)) }.getOrNull() }
        } catch (_: Exception) {
            emptyList()
        }
    }

    fun encode(items: List<ReviewItem>): String =
        JSONArray().apply { items.forEach { put(it.toJson()) } }.toString()

    /** Newest first, at most [MAX_ITEMS], nothing older than 30 days. */
    fun prune(items: List<ReviewItem>, now: Long): List<ReviewItem> =
        items.filter { now - it.receivedAt < MAX_AGE_MS }
            .sortedByDescending { it.receivedAt }
            .distinctBy { it.id }
            .take(MAX_ITEMS)

    fun add(items: List<ReviewItem>, item: ReviewItem, now: Long) = prune(items + item, now)

    fun remove(items: List<ReviewItem>, id: String) = items.filterNot { it.id == id }

    fun update(items: List<ReviewItem>, id: String, categoryId: String?, source: String?) =
        items.map { if (it.id == id) it.copy(categoryId = categoryId, categorySource = source) else it }
}

/** The queue in SharedPreferences `sms_detection`. */
object SmsReviewQueue {
    private const val KEY = "review_queue"

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(SmsPrefs.FILE, Context.MODE_PRIVATE)

    @Synchronized
    fun all(context: Context, now: Long = System.currentTimeMillis()): List<ReviewItem> =
        ReviewQueueCodec.prune(ReviewQueueCodec.decode(prefs(context).getString(KEY, null)), now)

    @Synchronized
    fun add(context: Context, item: ReviewItem, now: Long = System.currentTimeMillis()) =
        save(context, ReviewQueueCodec.add(all(context, now), item, now))

    @Synchronized
    fun remove(context: Context, id: String) = save(context, ReviewQueueCodec.remove(all(context), id))

    @Synchronized
    fun setSuggestion(context: Context, id: String, categoryId: String?, source: String?) =
        save(context, ReviewQueueCodec.update(all(context), id, categoryId, source))

    private fun save(context: Context, items: List<ReviewItem>) {
        prefs(context).edit().putString(KEY, ReviewQueueCodec.encode(items)).apply()
    }
}
