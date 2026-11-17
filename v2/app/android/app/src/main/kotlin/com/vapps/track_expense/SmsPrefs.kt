package com.vapps.track_expense

import android.content.Context

/**
 * Keys of messages already handled in the last 7 days, so the same SMS (or a
 * second SMS about the same UPI reference) is never added twice. Keys are
 * hashes of parsed fields, never message text. Pure, for unit tests.
 */
object SeenLog {
    const val WINDOW_MS = 7L * 24 * 60 * 60 * 1000
    private const val MAX = 500

    fun decode(raw: String?): Map<String, Long> =
        raw.orEmpty().split(';').mapNotNull { entry ->
            val i = entry.lastIndexOf('=')
            if (i <= 0) null else entry.substring(i + 1).toLongOrNull()?.let { entry.substring(0, i) to it }
        }.toMap()

    fun encode(seen: Map<String, Long>): String = seen.entries.joinToString(";") { "${it.key}=${it.value}" }

    /** Returns whether any of [keys] was seen inside the window, and the updated log. */
    fun checkAndAdd(seen: Map<String, Long>, keys: List<String>, now: Long): Pair<Boolean, Map<String, Long>> {
        val fresh = seen.filterValues { now - it < WINDOW_MS }
        val duplicate = keys.any { fresh.containsKey(it) }
        val next = (fresh + keys.associateWith { now }).entries
            .sortedByDescending { it.value }.take(MAX).associate { it.key to it.value }
        return duplicate to next
    }

    /**
     * Keys for one parsed message: the reference hash when there is one, and
     * a fingerprint of bank, account, amount, direction and the minute it was
     * received (the same SMS delivered twice has the same timestamp).
     */
    fun keysFor(sms: ParsedSms, receivedAt: Long): List<String> = listOfNotNull(
        sms.refHash?.let { "ref:$it" },
        "fp:" + SmsParser.hash("${sms.bank}|${sms.last4}|${sms.amount}|${sms.type}|${receivedAt / 60_000}"),
    )
}

/** Settings shared between the app UI, the SMS receiver and the auto-add worker. */
object SmsPrefs {
    const val FILE = "sms_detection"
    private const val ENABLED = "enabled"
    private const val AUTO_ADD = "auto_add"
    private const val TABLE = "category_table"
    private const val SEEN = "seen"
    private const val EVENING = "evening_catch_up"
    private const val LAST_CATCH_UP = "last_catch_up_day"
    private const val AI_MODE = "ai_mode"
    private const val CLOUD_MODEL = "ai_cloud_model"
    private const val LAST_HASH = "last_hash"
    private const val LAST_AT = "last_at"
    private const val DEDUPE_WINDOW_MS = 30_000L

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    /** Off until the user turns it on. */
    fun isEnabled(context: Context) = prefs(context).getBoolean(ENABLED, false)

    fun setEnabled(context: Context, enabled: Boolean) =
        prefs(context).edit().putBoolean(ENABLED, enabled).apply()

    /** Auto-add confident entries (D-029). Off by default; needs detection on too. */
    fun isAutoAdd(context: Context) = prefs(context).getBoolean(AUTO_ADD, false)

    fun setAutoAdd(context: Context, on: Boolean) = prefs(context).edit().putBoolean(AUTO_ADD, on).apply()

    /** Evening catch-up reminder (D-030). On by default; only acts while auto-add is on. */
    fun isEveningOn(context: Context) = prefs(context).getBoolean(EVENING, true)

    fun setEveningOn(context: Context, on: Boolean) = prefs(context).edit().putBoolean(EVENING, on).apply()

    /** The day ("2026-11-17") the catch-up last notified, so it shows at most once a day. */
    fun lastCatchUpDay(context: Context): String? = prefs(context).getString(LAST_CATCH_UP, null)

    fun setLastCatchUpDay(context: Context, day: String) = prefs(context).edit().putString(LAST_CATCH_UP, day).apply()

    /** "Category suggestions" (D-032): off (default), cloud, gemma or nano. */
    fun aiMode(context: Context): AiMode = AiMode.fromWire(prefs(context).getString(AI_MODE, null))

    fun setAiMode(context: Context, mode: AiMode) = prefs(context).edit().putString(AI_MODE, mode.wire).apply()

    /** The D-027 model key for Cloud suggestions; Flash-Lite unless the user picked Flash. */
    fun cloudModel(context: Context): String = CloudModel.clean(prefs(context).getString(CLOUD_MODEL, null))

    fun setCloudModel(context: Context, key: String?) = prefs(context).edit().putString(CLOUD_MODEL, CloudModel.clean(key)).apply()

    fun table(context: Context): CategoryTable = CategoryTable.decode(prefs(context).getString(TABLE, null))

    fun setTable(context: Context, json: String?) = prefs(context).edit().putString(TABLE, json).apply()

    /** True when the same message was already handled within the last 30 seconds. */
    fun isDuplicate(context: Context, sender: String, body: String, now: Long): Boolean {
        val hash = "$sender|${body.trim().lowercase()}".hashCode()
        val p = prefs(context)
        val duplicate = p.getInt(LAST_HASH, 0) == hash && now - p.getLong(LAST_AT, 0) < DEDUPE_WINDOW_MS
        p.edit().putInt(LAST_HASH, hash).putLong(LAST_AT, now).apply()
        return duplicate
    }

    /** True when this transaction was already handled in the last 7 days. Records it either way. */
    @Synchronized
    fun seenBefore(context: Context, sms: ParsedSms, receivedAt: Long, now: Long): Boolean {
        val p = prefs(context)
        val (duplicate, next) = SeenLog.checkAndAdd(SeenLog.decode(p.getString(SEEN, null)), SeenLog.keysFor(sms, receivedAt), now)
        p.edit().putString(SEEN, SeenLog.encode(next)).commit()
        return duplicate
    }
}
