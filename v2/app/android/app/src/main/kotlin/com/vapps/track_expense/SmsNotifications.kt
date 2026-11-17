package com.vapps.track_expense

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import java.text.NumberFormat
import java.util.Locale

/**
 * Notifications for bank messages. Everything that shows an amount or payee
 * is private on the lock screen; the public version says only what happened.
 */
object SmsNotifications {
    const val SUGGESTIONS = "entry_suggestions"
    const val AUTO_ADD = "sms_auto_add"
    const val WORKER = "sms_worker"

    fun money(amount: Double): String =
        NumberFormat.getCurrencyInstance(Locale.Builder().setLanguage("en").setRegion("IN").build())
            .apply { maximumFractionDigits = if (amount % 1.0 == 0.0) 0 else 2 }
            .format(amount)

    fun canNotify(context: Context) = Build.VERSION.SDK_INT < 33 ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
        PackageManager.PERMISSION_GRANTED

    fun manager(context: Context): NotificationManager {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(SUGGESTIONS, "Entry suggestions", NotificationManager.IMPORTANCE_HIGH).apply {
                    description = "Suggestions to add an entry when a bank message arrives"
                },
            )
            manager.createNotificationChannel(
                NotificationChannel(AUTO_ADD, "Entries added from SMS", NotificationManager.IMPORTANCE_DEFAULT).apply {
                    description = "Entries added on their own from bank messages, with Undo"
                    lockscreenVisibility = Notification.VISIBILITY_PRIVATE
                },
            )
            manager.createNotificationChannel(
                NotificationChannel(WORKER, "Reading bank messages", NotificationManager.IMPORTANCE_MIN),
            )
        }
        return manager
    }

    fun link(context: Context, path: String, requestCode: Int, query: Map<String, String> = emptyMap()): PendingIntent {
        val uri = Uri.Builder().scheme("trackexpense").authority("app").path(path)
            .apply { query.forEach { (k, v) -> appendQueryParameter(k, v) } }
            .build()
        val open = Intent(Intent.ACTION_VIEW, uri, context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        return PendingIntent.getActivity(
            context, requestCode, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun publicVersion(context: Context, channel: String, title: String) =
        NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_stat_entry)
            .setContentTitle(title)
            .build()

    /** "Added ₹1,499 · Swiggy → Food" with Undo and Change. */
    fun added(context: Context, docId: String, sms: ParsedSms, categoryName: String, receivedAt: Long) {
        if (!canNotify(context)) return
        val manager = manager(context)
        val id = notificationId(receivedAt)
        val amount = sms.amount?.let(::money) ?: ""
        val what = listOfNotNull(sms.merchant, categoryName.takeIf { it.isNotEmpty() }).joinToString(" → ")
        val undo = PendingIntent.getBroadcast(
            context, id,
            Intent(context, SmsActionReceiver::class.java)
                .setAction(SmsActionReceiver.UNDO)
                .putExtra(SmsActionReceiver.EXTRA_DOC, docId)
                .putExtra(SmsActionReceiver.EXTRA_NOTIFICATION, id),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val change = link(context, "/edit/$docId", id)
        manager.notify(
            id,
            NotificationCompat.Builder(context, AUTO_ADD)
                .setSmallIcon(R.drawable.ic_stat_entry)
                .setContentTitle("Added $amount ${if (sms.type == "income") "income" else "expense"}".replace("  ", " "))
                .setContentText(what.ifEmpty { "From a bank message" })
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setPublicVersion(publicVersion(context, AUTO_ADD, "Entry added from a bank message"))
                .setCategory(NotificationCompat.CATEGORY_STATUS)
                .setAutoCancel(true)
                .setContentIntent(change)
                .addAction(0, "Undo", undo)
                .addAction(0, "Change", change)
                .build(),
        )
    }

    /** "Review detected entry": opens the review list. */
    fun review(context: Context, sms: ParsedSms, receivedAt: Long) {
        if (!canNotify(context)) return
        val manager = manager(context)
        val id = notificationId(receivedAt)
        val text = listOfNotNull(sms.amount?.let(::money), sms.merchant, sms.account).joinToString(" · ")
        manager.notify(
            id,
            NotificationCompat.Builder(context, SUGGESTIONS)
                .setSmallIcon(R.drawable.ic_stat_entry)
                .setContentTitle("Review detected entry")
                .setContentText(if (text.isEmpty()) "Tap to review it." else "$text. Tap to review it.")
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setPublicVersion(publicVersion(context, SUGGESTIONS, "A bank message to review"))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_RECOMMENDATION)
                .setAutoCancel(true)
                .setContentIntent(link(context, "/sms/review", id))
                .build(),
        )
    }

    /** Shown only while an expedited job runs as a foreground service (Android 11 and older). */
    fun working(context: Context): Notification {
        manager(context)
        return NotificationCompat.Builder(context, WORKER)
            .setSmallIcon(R.drawable.ic_stat_entry)
            .setContentTitle("Reading a bank message")
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .build()
    }

    fun notificationId(receivedAt: Long) = (receivedAt % Int.MAX_VALUE).toInt()
}
