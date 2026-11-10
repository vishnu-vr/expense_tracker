package com.vapps.track_expense

import android.content.Context

/** Settings shared between the app UI and the SMS receiver. */
object SmsPrefs {
    private const val FILE = "sms_detection"
    private const val ENABLED = "enabled"
    private const val LAST_HASH = "last_hash"
    private const val LAST_AT = "last_at"
    private const val DEDUPE_WINDOW_MS = 30_000L

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    /** Off until the user turns it on. */
    fun isEnabled(context: Context) = prefs(context).getBoolean(ENABLED, false)

    fun setEnabled(context: Context, enabled: Boolean) =
        prefs(context).edit().putBoolean(ENABLED, enabled).apply()

    /** True when the same message was already handled within the last 30 seconds. */
    fun isDuplicate(context: Context, sender: String, body: String, now: Long): Boolean {
        val hash = "$sender|${body.trim().lowercase()}".hashCode()
        val p = prefs(context)
        val duplicate = p.getInt(LAST_HASH, 0) == hash && now - p.getLong(LAST_AT, 0) < DEDUPE_WINDOW_MS
        p.edit().putInt(LAST_HASH, hash).putLong(LAST_AT, now).apply()
        return duplicate
    }
}
