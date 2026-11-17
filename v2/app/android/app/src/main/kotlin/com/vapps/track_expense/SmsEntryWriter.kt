package com.vapps.track_expense

import com.google.android.gms.tasks.Task
import com.google.android.gms.tasks.Tasks
import com.google.firebase.Timestamp
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.QuerySnapshot
import com.google.firebase.firestore.Source
import java.util.Date
import java.util.concurrent.TimeUnit

/**
 * Who decided the category of an entry saved from a bank message (D-031).
 * Only [AUTO_ADD] (rules, history or payee memory, nobody asked) marks the
 * entry `autoAdded: true` so the owner can check it later; an answer to a
 * notification question (category button or Reply) is user-confirmed.
 */
enum class SmsSave(val autoAdded: Boolean) {
    AUTO_ADD(true),
    NOTIFICATION_ANSWER(false),
}

/**
 * The one native write path for entries from bank messages (D-029, D-030):
 * the auto-add worker and the notification actions (one-tap category,
 * reply) both save through here, with the app's normal entry shape plus
 * `source: "sms"` and, for fully automatic saves, `autoAdded: true` (D-031).
 */
object SmsEntryWriter {
    /**
     * The plain fields of a new entry (no timestamps). Pure, so the
     * `autoAdded` marker is unit-tested; [write] adds `date`, `createdAt`
     * and `updatedAt`.
     */
    fun fields(
        table: CategoryTable,
        amount: Double,
        type: String,
        categoryId: String,
        note: String?,
        save: SmsSave,
    ): Map<String, Any?> = buildMap {
        put("amount", amount)
        put("categoryId", categoryId)
        put("note", note)
        put("type", type)
        put("tagIds", emptyList<String>())
        put("userId", table.userId)
        put("userEmail", table.userEmail)
        put("homeId", table.homeId)
        put("source", "sms")
        // Written only when true: confirmed entries carry no marker at all.
        if (save.autoAdded) put("autoAdded", true)
    }

    /** Same fields as the app's own `saveTransaction`, plus [fields]' extras. Returns the new id or null. */
    fun write(
        db: FirebaseFirestore,
        table: CategoryTable,
        amount: Double,
        type: String,
        categoryId: String,
        receivedAt: Long,
        note: String?,
        save: SmsSave,
        waitSeconds: Long = 10,
    ): String? = try {
        val ref = db.collection("transactions").document()
        val task = ref.set(
            HashMap(fields(table, amount, type, categoryId, note, save)).apply {
                put("date", Timestamp(Date(receivedAt)))
                put("createdAt", FieldValue.serverTimestamp())
                put("updatedAt", FieldValue.serverTimestamp())
            },
        )
        // Give it a moment to reach the server; offline it stays queued in
        // Firestore's local cache and syncs the next time the app runs.
        await(task, waitSeconds)
        if (task.isComplete && task.exception != null) null else ref.id
    } catch (_: Exception) {
        null
    }

    /** Same user, direction and amount within ±15 minutes already saved? */
    fun alreadySaved(db: FirebaseFirestore, table: CategoryTable, sms: ParsedSms, receivedAt: Long): Boolean {
        val query = db.collection("transactions")
            .whereEqualTo("homeId", table.homeId)
            .whereGreaterThanOrEqualTo("date", Timestamp(Date(receivedAt - DuplicateCheck.WINDOW_MS)))
            .whereLessThanOrEqualTo("date", Timestamp(Date(receivedAt + DuplicateCheck.WINDOW_MS)))
        val snapshot = await(query.get(), 8) ?: await(query.get(Source.CACHE), 3) ?: return false
        return DuplicateCheck.isDuplicate(saved(snapshot), table.userId!!, sms, receivedAt)
    }

    private fun saved(snapshot: QuerySnapshot) = snapshot.documents.map { d ->
        SavedEntry(
            userId = d.getString("userId"),
            type = d.getString("type"),
            amount = d.getDouble("amount"),
            dateMs = d.getTimestamp("date")?.toDate()?.time ?: 0L,
        )
    }

    fun <T> await(task: Task<T>, seconds: Long): T? = try {
        Tasks.await(task, seconds, TimeUnit.SECONDS)
    } catch (_: Exception) {
        null
    }
}
