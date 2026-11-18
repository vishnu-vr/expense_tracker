package com.vapps.track_expense

import android.content.Context

/** What to do after the user answered "what was this for?" in a notification. */
sealed class LabelOutcome {
    /** Save with [categoryId]; [words] are the user's own words, if any. */
    data class Save(val categoryId: String, val words: String?, val note: String?) : LabelOutcome()

    /** Still not sure: keep the item (with [words]) and ask "Which category for '…'?". */
    data class Ask(val words: String?, val candidates: List<String>) : LabelOutcome()

    /** The item is gone or the answer makes no sense: nothing to do. */
    object Ignore : LabelOutcome()
}

/**
 * The human-in-the-loop step for payments the rules could not place (D-030).
 * Pure decisions here; [SmsLabeller.handle] does the saving.
 */
object LabelLogic {
    const val MAX_WORDS = 80

    /** One line, trimmed, at most [MAX_WORDS] characters. */
    fun cleanWords(text: String?): String? =
        text?.replace(Regex("\\s+"), " ")?.trim()?.take(MAX_WORDS)?.trim()?.ifEmpty { null }

    fun decide(table: CategoryTable, item: ReviewItem?, pick: String?, reply: String?): LabelOutcome {
        item ?: return LabelOutcome.Ignore
        if (pick != null) {
            if (table.category(pick)?.type != item.type) return LabelOutcome.Ignore
            return LabelOutcome.Save(pick, item.words, SmsNote.compose(item.words, item.merchant, item.account))
        }
        val words = cleanWords(reply) ?: return LabelOutcome.Ask(item.words, emptyList())
        val guess = ReplyCategoriser.guess(table, words, item.type)
        val id = guess.categoryId ?: return LabelOutcome.Ask(words, guess.candidates)
        return LabelOutcome.Save(id, words, SmsNote.compose(words, item.merchant, item.account))
    }
}

object SmsLabeller {
    /** Up to two category buttons: what the words pointed at, the item's own guess, then quick suggestions. */
    fun buttons(table: CategoryTable, item: ReviewItem, candidates: List<String>, hour: Int): List<String> =
        (candidates + listOfNotNull(item.categoryId) + QuickSuggest.top(table, item.type, item.amount, hour, n = 3))
            .filter { table.category(it)?.type == item.type }
            .distinct().take(2)

    /** Runs off the main thread (from [SmsActionReceiver]). */
    fun handle(context: Context, itemId: String, notification: Int, pick: String?, reply: String?) {
        val table = SmsPrefs.table(context)
        val item = SmsReviewQueue.find(context, itemId)
        when (val outcome = LabelLogic.decide(table, item, pick, reply)) {
            // Already handled (e.g. saved in the app): just clear the notification.
            LabelOutcome.Ignore -> SmsNotifications.manager(context).cancel(notification)
            is LabelOutcome.Ask -> {
                item!!
                SmsReviewQueue.setWords(context, item.id, outcome.words)
                val updated = item.copy(words = outcome.words)
                val buttons = buttons(table, updated, outcome.candidates, SmsAutoAddWorker.hourOf(item.receivedAt))
                SmsNotifications.ask(context, updated, buttons)
                // Unclear words: the chosen model may suggest a category in the
                // background (D-032); it then asks "AI suggests …" with Approve.
                if (outcome.words != null && SmsPrefs.aiMode(context) != AiMode.OFF) SmsSuggestWorker.enqueue(context, item.id)
            }
            is LabelOutcome.Save -> {
                item!!
                val firebase = NativeFirebase.forTable(context, table)
                val id = firebase?.let {
                    SmsEntryWriter.write(it.second, table, item.amount ?: return@let null, item.type, outcome.categoryId, item.receivedAt, outcome.note, SmsSave.NOTIFICATION_ANSWER, waitSeconds = 5)
                }
                if (id == null) {
                    // Keep it (with the words) for the review list.
                    SmsReviewQueue.setWords(context, item.id, outcome.words)
                    SmsNotifications.couldNotSave(context, notification)
                    return
                }
                SmsReviewQueue.remove(context, item.id)
                PayeeMemory.remember(context, item.payeeHash, outcome.categoryId, item.type, outcome.words, id)
                PayeeMemory.recordEntry(context, id, item.payeeHash, item.merchant, item.account)
                val name = table.category(outcome.categoryId)?.name ?: ""
                SmsNotifications.added(context, id, item.amount!!, item.type, item.merchant, name, notification)
            }
        }
    }
}

/**
 * Asks the chosen model about one review item's reply words, off the
 * notification receiver's short time budget (D-032). On an answer the item
 * becomes an AI suggestion and the notification offers Approve / Change /
 * Reply; otherwise nothing changes.
 */
class SmsSuggestWorker(context: android.content.Context, params: androidx.work.WorkerParameters) :
    androidx.work.CoroutineWorker(context, params) {

    override suspend fun getForegroundInfo(): androidx.work.ForegroundInfo =
        androidx.work.ForegroundInfo(4205, SmsNotifications.working(applicationContext))

    override suspend fun doWork(): Result {
        val context = applicationContext
        val id = inputData.getString(K_ITEM) ?: return Result.success()
        val item = SmsReviewQueue.find(context, id) ?: return Result.success()
        val table = SmsPrefs.table(context)
        val suggested = AiSuggest.one(context, table, item) ?: return Result.success()
        // The user may have answered meanwhile: only update an item that is still waiting, with the same words.
        val now = SmsReviewQueue.find(context, id) ?: return Result.success()
        if (now.words != item.words) return Result.success()
        SmsReviewQueue.setSuggestion(context, id, suggested.categoryId, suggested.categorySource, suggested.aiModel)
        if (table.canWrite && now.amount != null) SmsNotifications.askAi(context, now.copy(categoryId = suggested.categoryId, categorySource = suggested.categorySource, aiModel = suggested.aiModel))
        return Result.success()
    }

    companion object {
        private const val K_ITEM = "itemId"

        fun enqueue(context: android.content.Context, itemId: String) {
            val request = androidx.work.OneTimeWorkRequestBuilder<SmsSuggestWorker>()
                .setExpedited(androidx.work.OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
                .setInputData(androidx.work.workDataOf(K_ITEM to itemId))
                .build()
            androidx.work.WorkManager.getInstance(context)
                .enqueueUniqueWork("sms-suggest-$itemId", androidx.work.ExistingWorkPolicy.REPLACE, request)
        }
    }
}
