package com.vapps.track_expense

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.google.android.gms.tasks.Tasks
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/**
 * "Undo" on an "Added from SMS" notification: deletes the new entry (owner
 * delete is already allowed by the rules). Not exported: only this app's own
 * notification can send it.
 */
class SmsActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != UNDO) return
        val docId = intent.getStringExtra(EXTRA_DOC) ?: return
        val notification = intent.getIntExtra(EXTRA_NOTIFICATION, 0)
        SmsNotifications.manager(context).cancel(notification)

        val pending = goAsync()
        thread {
            try {
                val firebase = NativeFirebase.forTable(context, SmsPrefs.table(context)) ?: return@thread
                val task = firebase.second.collection("transactions").document(docId).delete()
                // Offline the delete stays queued, like any other write.
                runCatching { Tasks.await(task, 8, TimeUnit.SECONDS) }
            } finally {
                pending.finish()
            }
        }
    }

    companion object {
        const val UNDO = "com.vapps.track_expense.SMS_UNDO"
        const val EXTRA_DOC = "docId"
        const val EXTRA_NOTIFICATION = "notificationId"
    }
}
