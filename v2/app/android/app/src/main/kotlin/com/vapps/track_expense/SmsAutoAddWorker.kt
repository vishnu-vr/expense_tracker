package com.vapps.track_expense

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.google.android.gms.tasks.Task
import com.google.android.gms.tasks.Tasks
import com.google.firebase.Timestamp
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.QuerySnapshot
import com.google.firebase.firestore.Source
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.Date
import java.util.concurrent.TimeUnit
import kotlin.math.abs

/** An entry already saved, as far as the duplicate check needs it. */
data class SavedEntry(val userId: String?, val type: String?, val amount: Double?, val dateMs: Long)

/** Same user, direction and amount within 15 minutes counts as the same entry. Pure. */
object DuplicateCheck {
    const val WINDOW_MS = 15L * 60 * 1000

    fun isDuplicate(saved: List<SavedEntry>, userId: String, sms: ParsedSms, receivedAt: Long): Boolean {
        val amount = sms.amount ?: return false
        return saved.any {
            it.userId == userId && it.type == sms.type && it.amount != null &&
                abs(it.amount - amount) < 0.005 && abs(it.dateMs - receivedAt) <= WINDOW_MS
        }
    }
}

/**
 * Handles one parsed bank message with auto-add on (D-029): decide the
 * category, check it is not already saved, then either write the entry with
 * the native Firestore SDK (queued offline like the app's own writes) and
 * post "Added … · Undo · Change", or put it in the review list.
 *
 * Input is parsed fields only; the message text never reaches the worker.
 */
class SmsAutoAddWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    // Expedited work runs as a short foreground service only on Android 11
    // and older; newer versions use expedited jobs and never call this.
    override suspend fun getForegroundInfo(): ForegroundInfo =
        ForegroundInfo(FOREGROUND_ID, SmsNotifications.working(applicationContext))

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val sms = fromData(inputData) ?: return@withContext Result.success()
        val receivedAt = inputData.getLong(K_AT, System.currentTimeMillis())
        val context = applicationContext
        val table = SmsPrefs.table(context)

        when (val decision = SmsCategoriser.decide(table, sms)) {
            is Decision.Review -> toReview(context, sms, receivedAt, decision.suggestion)
            is Decision.AutoAdd -> {
                val firebase = NativeFirebase.forTable(context, table)
                if (firebase == null) {
                    toReview(context, sms, receivedAt, decision.placement)
                } else {
                    val db = firebase.second
                    if (!alreadySaved(db, table, sms, receivedAt)) {
                        val id = write(db, table, sms, receivedAt, decision.placement)
                        if (id == null) {
                            toReview(context, sms, receivedAt, decision.placement)
                        } else {
                            val name = table.category(decision.placement.categoryId)?.name ?: ""
                            SmsNotifications.added(context, id, sms, name, receivedAt)
                        }
                    }
                }
            }
        }
        Result.success()
    }

    private fun toReview(context: Context, sms: ParsedSms, receivedAt: Long, suggestion: Placement?) {
        SmsReviewQueue.add(context, ReviewItem.from(sms, receivedAt, suggestion))
        SmsNotifications.review(context, sms, receivedAt)
    }

    private fun alreadySaved(db: FirebaseFirestore, table: CategoryTable, sms: ParsedSms, receivedAt: Long): Boolean {
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

    /** Same fields as the app's own `saveTransaction`, plus `source: "sms"`. */
    private fun write(db: FirebaseFirestore, table: CategoryTable, sms: ParsedSms, receivedAt: Long, placement: Placement): String? =
        try {
            val ref = db.collection("transactions").document()
            val task = ref.set(
                hashMapOf(
                    "amount" to sms.amount,
                    "categoryId" to placement.categoryId,
                    "date" to Timestamp(Date(receivedAt)),
                    "note" to sms.note,
                    "type" to sms.type,
                    "tagIds" to emptyList<String>(),
                    "userId" to table.userId,
                    "userEmail" to table.userEmail,
                    "homeId" to table.homeId,
                    "source" to "sms",
                    "createdAt" to FieldValue.serverTimestamp(),
                    "updatedAt" to FieldValue.serverTimestamp(),
                ),
            )
            // Give it a moment to reach the server; offline it stays queued
            // in Firestore's local cache and syncs the next time it runs.
            await(task, 10)
            if (task.isComplete && task.exception != null) null else ref.id
        } catch (_: Exception) {
            null
        }

    private fun <T> await(task: Task<T>, seconds: Long): T? = try {
        Tasks.await(task, seconds, TimeUnit.SECONDS)
    } catch (_: Exception) {
        null
    }

    companion object {
        private const val FOREGROUND_ID = 4202
        private const val K_AMOUNT = "amount"
        private const val K_TYPE = "type"
        private const val K_MERCHANT = "merchant"
        private const val K_BANK = "bank"
        private const val K_LAST4 = "last4"
        private const val K_REF = "refHash"
        private const val K_DEFINITE = "definite"
        private const val K_AT = "receivedAt"

        /** Parsed fields only. */
        fun toData(sms: ParsedSms, receivedAt: Long): Data = workDataOf(
            K_AMOUNT to (sms.amount ?: -1.0),
            K_TYPE to sms.type,
            K_MERCHANT to sms.merchant,
            K_BANK to sms.bank,
            K_LAST4 to sms.last4,
            K_REF to sms.refHash,
            K_DEFINITE to sms.definite,
            K_AT to receivedAt,
        )

        fun fromData(data: Data): ParsedSms? {
            val type = data.getString(K_TYPE) ?: return null
            val merchant = data.getString(K_MERCHANT)
            return ParsedSms(
                amount = data.getDouble(K_AMOUNT, -1.0).takeIf { it > 0 },
                type = type,
                merchant = merchant,
                merchantKey = MerchantKey.of(merchant),
                bank = data.getString(K_BANK),
                last4 = data.getString(K_LAST4),
                refHash = data.getString(K_REF),
                definite = data.getBoolean(K_DEFINITE, false),
            )
        }

        fun enqueue(context: Context, sms: ParsedSms, receivedAt: Long) {
            val request = OneTimeWorkRequestBuilder<SmsAutoAddWorker>()
                .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
                .setInputData(toData(sms, receivedAt))
                .build()
            WorkManager.getInstance(context)
                .enqueueUniqueWork("sms-$receivedAt-${sms.amount}", ExistingWorkPolicy.KEEP, request)
        }
    }
}
