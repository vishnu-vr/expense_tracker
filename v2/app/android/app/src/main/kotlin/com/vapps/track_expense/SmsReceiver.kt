package com.vapps.track_expense

import android.Manifest
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.provider.Telephony
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import java.time.Instant

/**
 * Handles an incoming bank message. Message text is never logged or stored.
 *
 * - Auto-add off (default, D-005): a "tap to add" notification; the entry
 *   form opens prefilled and nothing is saved without the user.
 * - Auto-add on (D-029): the parsed fields (never the text) go to
 *   [SmsAutoAddWorker], which saves confident entries and queues the rest
 *   for review. Messages that are not completed transactions are dropped.
 */
class SmsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        if (!SmsPrefs.isEnabled(context)) return
        if (!granted(context, Manifest.permission.RECEIVE_SMS)) return

        val parts = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
        if (parts.isEmpty()) return
        val sender = parts[0].originatingAddress.orEmpty()
        val body = parts.joinToString("") { it.messageBody.orEmpty() }
        val receivedAt = parts[0].timestampMillis.takeIf { it > 0 } ?: System.currentTimeMillis()

        if (SmsPrefs.isAutoAdd(context)) {
            // The payee identity (it may be a phone number) is hashed with this
            // install's salt here, before anything is queued or stored (D-030).
            val sms = SmsParser.parseDetails(sender, body)?.withHashedPayee(PayeeMemory.salt(context)) ?: return
            if (sms.amount != null) {
                if (SmsPrefs.seenBefore(context, sms, receivedAt, System.currentTimeMillis())) return
                SmsAutoAddWorker.enqueue(context, sms, receivedAt)
                return
            }
            // No amount to save: fall back to the plain suggestion below.
        }

        val suggestion = SmsParser.parse(body) ?: return
        if (SmsPrefs.isDuplicate(context, sender, body, System.currentTimeMillis())) return
        notify(context, suggestion, receivedAt)
    }

    private fun granted(context: Context, permission: String) =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

    private fun notify(context: Context, suggestion: SmsSuggestion, receivedAt: Long) {
        if (!SmsNotifications.canNotify(context)) return
        val manager = SmsNotifications.manager(context)

        // Opens /add in the Flutter app with the detected values.
        val id = SmsNotifications.notificationId(receivedAt)
        val pending: PendingIntent = SmsNotifications.link(
            context, "/add", id,
            buildMap {
                put("type", suggestion.type)
                put("date", Instant.ofEpochMilli(receivedAt).toString())
                suggestion.amount?.let { put("amount", it.toString()) }
            },
        )

        val kind = if (suggestion.type == "income") "income" else "expense"
        val text = suggestion.amount?.let { "Looks like ${SmsNotifications.money(it)} $kind. Tap to add it." }
            ?: "Looks like a bank transaction. Tap to add it."

        manager.notify(
            id,
            NotificationCompat.Builder(context, SmsNotifications.SUGGESTIONS)
                .setSmallIcon(R.drawable.ic_stat_entry)
                .setContentTitle("Add this entry?")
                .setContentText(text)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_RECOMMENDATION)
                .setAutoCancel(true)
                .setContentIntent(pending)
                .build(),
        )
    }
}
