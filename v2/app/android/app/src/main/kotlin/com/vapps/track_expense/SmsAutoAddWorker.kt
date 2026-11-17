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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
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
        val memory = PayeeMemory.lookup(context, sms.payeeHash)

        when (val decision = SmsCategoriser.decide(table, sms, memory)) {
            is Decision.Review -> toReview(context, table, sms, receivedAt, decision.suggestion)
            is Decision.AutoAdd -> {
                val firebase = NativeFirebase.forTable(context, table)
                if (firebase == null) {
                    toReview(context, table, sms, receivedAt, decision.placement)
                } else {
                    val db = firebase.second
                    if (!SmsEntryWriter.alreadySaved(db, table, sms, receivedAt)) {
                        // A remembered payee brings its last words too: "auto to office · Ramesh K".
                        val words = memory?.words?.takeIf { decision.placement.source == CategorySource.MEMORY }
                        val note = SmsNote.compose(words, sms.merchant, sms.account)
                        val id = SmsEntryWriter.write(db, table, sms.amount!!, sms.type, decision.placement.categoryId, receivedAt, note)
                        if (id == null) {
                            toReview(context, table, sms, receivedAt, decision.placement)
                        } else {
                            PayeeMemory.recordEntry(context, id, sms.payeeHash, sms.merchant, sms.account)
                            val name = table.category(decision.placement.categoryId)?.name ?: ""
                            SmsNotifications.added(context, id, sms.amount, sms.type, sms.merchant, name, SmsNotifications.notificationId(receivedAt))
                        }
                    }
                }
            }
        }
        Result.success()
    }

    /**
     * Into the review list. When the phone can save on its own, the
     * notification asks what the payment was for, with category buttons and
     * Reply (D-030); otherwise it just links to the list.
     */
    private fun toReview(context: Context, table: CategoryTable, sms: ParsedSms, receivedAt: Long, suggestion: Placement?) {
        val item = ReviewItem.from(sms, receivedAt, suggestion)
        SmsReviewQueue.add(context, item)
        if (table.canWrite && sms.amount != null) {
            SmsNotifications.ask(context, item, SmsLabeller.buttons(table, item, emptyList(), hourOf(receivedAt)))
        } else {
            SmsNotifications.review(context, sms, receivedAt)
        }
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
        private const val K_PAYEE = "payeeHash"
        private const val K_AT = "receivedAt"

        fun hourOf(ms: Long): Int = java.util.Calendar.getInstance().apply { timeInMillis = ms }.get(java.util.Calendar.HOUR_OF_DAY)

        /** Parsed fields only; the payee only as its salted hash, never [ParsedSms.payeeKey]. */
        fun toData(sms: ParsedSms, receivedAt: Long): Data = workDataOf(
            K_AMOUNT to (sms.amount ?: -1.0),
            K_TYPE to sms.type,
            K_MERCHANT to sms.merchant,
            K_BANK to sms.bank,
            K_LAST4 to sms.last4,
            K_REF to sms.refHash,
            K_DEFINITE to sms.definite,
            K_PAYEE to sms.payeeHash,
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
                payeeHash = data.getString(K_PAYEE),
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
