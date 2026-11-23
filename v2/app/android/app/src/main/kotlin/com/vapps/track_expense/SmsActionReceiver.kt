package com.vapps.track_expense

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.RemoteInput
import com.google.android.gms.tasks.Tasks
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/**
 * Actions on this app's SMS notifications. Not exported: only this app's own
 * notifications can send them.
 *
 * - Undo on "Added …": deletes the new entry (owner delete is already allowed
 *   by the rules) and drops the payee memory that entry created.
 * - A category button on "what was this for?": saves the entry (D-030).
 * - Reply: the typed words become the note; the category is guessed from
 *   them, or the notification asks again. The words are never logged.
 */
class SmsActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            UNDO -> undo(context, intent)
            PICK, REPLY -> label(context, intent)
        }
    }

    private fun undo(context: Context, intent: Intent) {
        val docId = intent.getStringExtra(EXTRA_DOC) ?: return
        val notification = intent.getIntExtra(EXTRA_NOTIFICATION, 0)
        SmsNotifications.manager(context).cancel(notification)

        val pending = goAsync()
        thread {
            try {
                PayeeMemory.undo(context, docId)
                val firebase = NativeFirebase.forTable(context, SmsPrefs.table(context)) ?: return@thread
                val task = firebase.second.collection("transactions").document(docId).delete()
                // Offline the delete stays queued, like any other write.
                runCatching { Tasks.await(task, 8, TimeUnit.SECONDS) }
            } finally {
                pending.finish()
            }
        }
    }

    private fun label(context: Context, intent: Intent) {
        val itemId = intent.getStringExtra(EXTRA_ITEM) ?: return
        val notification = intent.getIntExtra(EXTRA_NOTIFICATION, 0)
        val pick = if (intent.action == PICK) intent.getStringExtra(EXTRA_CATEGORY) ?: return else null
        val reply = if (intent.action == REPLY) {
            RemoteInput.getResultsFromIntent(intent)?.getCharSequence(KEY_REPLY)?.toString() ?: return
        } else {
            null
        }
        val pending = goAsync()
        thread {
            try {
                SmsLabeller.handle(context, itemId, notification, pick, reply)
            } catch (_: Exception) {
                // Nothing is lost: the item stays in the review list.
            } finally {
                pending.finish()
            }
        }
    }

    companion object {
        const val UNDO = "com.vapps.track_expense.SMS_UNDO"
        const val PICK = "com.vapps.track_expense.SMS_PICK"
        const val REPLY = "com.vapps.track_expense.SMS_REPLY"
        const val EXTRA_DOC = "docId"
        const val EXTRA_ITEM = "itemId"
        const val EXTRA_CATEGORY = "categoryId"
        const val EXTRA_NOTIFICATION = "notificationId"
        const val KEY_REPLY = "note"
    }
}
