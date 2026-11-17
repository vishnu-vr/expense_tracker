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
 * The one native write path for entries from bank messages (D-029, D-030):
 * the auto-add worker and the notification actions (one-tap category,
 * reply) both save through here, with the app's normal entry shape plus
 * `source: "sms"`.
 */
object SmsEntryWriter {
    /** Same fields as the app's own `saveTransaction`, plus `source: "sms"`. Returns the new id or null. */
    fun write(
        db: FirebaseFirestore,
        table: CategoryTable,
        amount: Double,
        type: String,
        categoryId: String,
        receivedAt: Long,
        note: String?,
        waitSeconds: Long = 10,
    ): String? = try {
        val ref = db.collection("transactions").document()
        val task = ref.set(
            hashMapOf(
                "amount" to amount,
                "categoryId" to categoryId,
                "date" to Timestamp(Date(receivedAt)),
                "note" to note,
                "type" to type,
                "tagIds" to emptyList<String>(),
                "userId" to table.userId,
                "userEmail" to table.userEmail,
                "homeId" to table.homeId,
                "source" to "sms",
                "createdAt" to FieldValue.serverTimestamp(),
                "updatedAt" to FieldValue.serverTimestamp(),
            ),
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
