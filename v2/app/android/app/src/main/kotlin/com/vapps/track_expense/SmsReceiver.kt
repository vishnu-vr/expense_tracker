package com.vapps.track_expense

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Telephony
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import java.text.NumberFormat
import java.time.Instant
import java.util.Locale

/**
 * Turns an incoming bank message into a "tap to add" notification. The entry
 * form opens prefilled; nothing is saved without the user. Message text is
 * never logged or stored.
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

        val suggestion = SmsParser.parse(body) ?: return
        if (SmsPrefs.isDuplicate(context, sender, body, System.currentTimeMillis())) return
        notify(context, suggestion, receivedAt)
    }

    private fun granted(context: Context, permission: String) =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

    private fun notify(context: Context, suggestion: SmsSuggestion, receivedAt: Long) {
        if (Build.VERSION.SDK_INT >= 33 && !granted(context, Manifest.permission.POST_NOTIFICATIONS)) return

        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL, "Entry suggestions", NotificationManager.IMPORTANCE_HIGH).apply {
                    description = "Suggestions to add an entry when a bank message arrives"
                },
            )
        }

        // Opens /add in the Flutter app with the detected values.
        val link = Uri.Builder()
            .scheme("trackexpense").authority("app").path("/add")
            .appendQueryParameter("type", suggestion.type)
            .appendQueryParameter("date", Instant.ofEpochMilli(receivedAt).toString())
            .apply { suggestion.amount?.let { appendQueryParameter("amount", it.toString()) } }
            .build()
        val open = Intent(Intent.ACTION_VIEW, link, context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val id = (receivedAt % Int.MAX_VALUE).toInt()
        val pending = PendingIntent.getActivity(
            context, id, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val kind = if (suggestion.type == "income") "income" else "expense"
        val text = suggestion.amount?.let {
            val money = NumberFormat.getCurrencyInstance(Locale.Builder().setLanguage("en").setRegion("IN").build())
                .apply { maximumFractionDigits = if (it % 1.0 == 0.0) 0 else 2 }
                .format(it)
            "Looks like $money $kind. Tap to add it."
        } ?: "Looks like a bank transaction. Tap to add it."

        manager.notify(
            id,
            NotificationCompat.Builder(context, CHANNEL)
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

    private companion object {
        const val CHANNEL = "entry_suggestions"
    }
}
