package com.vapps.track_expense

import android.content.Context
import org.json.JSONObject
import java.security.MessageDigest
import java.security.SecureRandom

/** What the phone remembers about one payee (D-030). */
data class RememberedPayee(
    val categoryId: String,
    val type: String,
    /** The last words the user gave for this payee ("auto to office"), if any. */
    val words: String?,
    val at: Long,
    /** The entry that set it, so Undo on that entry can take it back. */
    val docId: String?,
)

/** An entry saved from a bank message, as far as later edits need it. */
data class SmsEntryRef(val payeeHash: String, val merchant: String?, val account: String?, val at: Long)

/**
 * Payee memory, pure (D-030). Keys are salted SHA-256 hashes of the
 * normalised payee identity ([ParsedSms.payeeKey]); the salt is random per
 * install, so the same phone number gives a different key on every phone and
 * the number itself is never stored.
 */
object PayeeMemoryCodec {
    const val MAX_PAYEES = 500
    const val MAX_ENTRIES = 300
    const val ENTRY_AGE_MS = 90L * 24 * 60 * 60 * 1000

    fun newSalt(random: SecureRandom = SecureRandom()): String =
        ByteArray(16).also(random::nextBytes).joinToString("") { "%02x".format(it) }

    /** 32 hex characters of SHA-256(salt | key). */
    fun hash(salt: String, key: String): String =
        MessageDigest.getInstance("SHA-256").digest("$salt|$key".toByteArray())
            .joinToString("") { "%02x".format(it) }.take(32)

    fun decode(json: String?): Map<String, RememberedPayee> {
        if (json.isNullOrBlank()) return emptyMap()
        return try {
            val o = JSONObject(json)
            buildMap {
                for (k in o.keys()) {
                    val v = o.optJSONObject(k) ?: continue
                    val c = v.optString("c").ifEmpty { null } ?: continue
                    put(
                        k,
                        RememberedPayee(
                            categoryId = c,
                            type = v.optString("t", "expense"),
                            words = v.optString("w").ifEmpty { null },
                            at = v.optLong("at"),
                            docId = v.optString("d").ifEmpty { null },
                        ),
                    )
                }
            }
        } catch (_: Exception) {
            emptyMap()
        }
    }

    fun encode(memory: Map<String, RememberedPayee>): String = JSONObject().apply {
        memory.forEach { (k, v) ->
            put(
                k,
                JSONObject().apply {
                    put("c", v.categoryId)
                    put("t", v.type)
                    v.words?.let { put("w", it) }
                    put("at", v.at)
                    v.docId?.let { put("d", it) }
                },
            )
        }
    }.toString()

    /** Adds or replaces [hash]; keeps the [MAX_PAYEES] most recent. */
    fun remember(memory: Map<String, RememberedPayee>, hash: String, value: RememberedPayee): Map<String, RememberedPayee> =
        (memory + (hash to value)).entries.sortedByDescending { it.value.at }
            .take(MAX_PAYEES).associate { it.key to it.value }

    /** Drops the memory an undone entry created; other memories stay. */
    fun undo(memory: Map<String, RememberedPayee>, docId: String): Map<String, RememberedPayee> =
        memory.filterValues { it.docId != docId }

    fun decodeEntries(json: String?): Map<String, SmsEntryRef> {
        if (json.isNullOrBlank()) return emptyMap()
        return try {
            val o = JSONObject(json)
            buildMap {
                for (k in o.keys()) {
                    val v = o.optJSONObject(k) ?: continue
                    val h = v.optString("h").ifEmpty { null } ?: continue
                    put(k, SmsEntryRef(h, v.optString("m").ifEmpty { null }, v.optString("a").ifEmpty { null }, v.optLong("at")))
                }
            }
        } catch (_: Exception) {
            emptyMap()
        }
    }

    fun encodeEntries(entries: Map<String, SmsEntryRef>): String = JSONObject().apply {
        entries.forEach { (k, v) ->
            put(
                k,
                JSONObject().apply {
                    put("h", v.payeeHash)
                    v.merchant?.let { put("m", it) }
                    v.account?.let { put("a", it) }
                    put("at", v.at)
                },
            )
        }
    }.toString()

    fun addEntry(entries: Map<String, SmsEntryRef>, docId: String, ref: SmsEntryRef, now: Long): Map<String, SmsEntryRef> =
        (entries + (docId to ref)).filterValues { now - it.at < ENTRY_AGE_MS }
            .entries.sortedByDescending { it.value.at }.take(MAX_ENTRIES).associate { it.key to it.value }

    /**
     * The user's own words in an entry note: the parts that are not the
     * payee or the account. "auto to office · Ramesh K" → "auto to office";
     * "Ramesh K · HDFC XX1234" → null.
     */
    fun noteWords(note: String?, merchant: String?, account: String?): String? =
        note.orEmpty().split(" · ").map { it.trim() }
            .filter { it.isNotEmpty() && it != merchant && it != account }
            .joinToString(" · ").take(80).ifEmpty { null }
}

/** Payee memory in SharedPreferences `sms_detection`. */
object PayeeMemory {
    private const val SALT = "payee_salt"
    private const val MEMORY = "payee_memory"
    private const val ENTRIES = "sms_entries"

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(SmsPrefs.FILE, Context.MODE_PRIVATE)

    /** Generated once per install. */
    @Synchronized
    fun salt(context: Context): String {
        val p = prefs(context)
        p.getString(SALT, null)?.let { return it }
        val salt = PayeeMemoryCodec.newSalt()
        p.edit().putString(SALT, salt).commit()
        return salt
    }

    @Synchronized
    fun all(context: Context): Map<String, RememberedPayee> = PayeeMemoryCodec.decode(prefs(context).getString(MEMORY, null))

    fun lookup(context: Context, hash: String?): RememberedPayee? = hash?.let { all(context)[it] }

    fun count(context: Context) = all(context).size

    @Synchronized
    fun remember(context: Context, hash: String?, categoryId: String, type: String, words: String?, docId: String?, now: Long = System.currentTimeMillis()) {
        if (hash == null) return
        val next = PayeeMemoryCodec.remember(all(context), hash, RememberedPayee(categoryId, type, words, now, docId))
        prefs(context).edit().putString(MEMORY, PayeeMemoryCodec.encode(next)).apply()
    }

    /** Remembers which payee an entry saved from a bank message was for. */
    @Synchronized
    fun recordEntry(context: Context, docId: String, hash: String?, merchant: String?, account: String?, now: Long = System.currentTimeMillis()) {
        if (hash == null) return
        val p = prefs(context)
        val next = PayeeMemoryCodec.addEntry(
            PayeeMemoryCodec.decodeEntries(p.getString(ENTRIES, null)), docId, SmsEntryRef(hash, merchant, account, now), now,
        )
        p.edit().putString(ENTRIES, PayeeMemoryCodec.encodeEntries(next)).apply()
    }

    /** An SMS entry was edited in the app: its payee now gets the new category and words. */
    @Synchronized
    fun entryEdited(context: Context, docId: String, categoryId: String, type: String, note: String?) {
        val ref = PayeeMemoryCodec.decodeEntries(prefs(context).getString(ENTRIES, null))[docId] ?: return
        remember(context, ref.payeeHash, categoryId, type, PayeeMemoryCodec.noteWords(note, ref.merchant, ref.account), docId)
    }

    @Synchronized
    fun undo(context: Context, docId: String) {
        val next = PayeeMemoryCodec.undo(all(context), docId)
        prefs(context).edit().putString(MEMORY, PayeeMemoryCodec.encode(next)).apply()
    }

    /** "Forget remembered payees". The salt stays; nothing refers to it any more. */
    @Synchronized
    fun forgetAll(context: Context) {
        prefs(context).edit().remove(MEMORY).remove(ENTRIES).apply()
    }
}
