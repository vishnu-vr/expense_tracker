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
import androidx.core.app.RemoteInput
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
    const val CATCH_UP = "sms_catch_up"
    private const val CATCH_UP_ID = 4203

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
                NotificationChannel(CATCH_UP, "Evening reminder", NotificationManager.IMPORTANCE_DEFAULT).apply {
                    description = "Once a day, when detected payments still need a description"
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

    /** "Added ₹1,499 expense · Swiggy → Food" with Undo and Change; replaces notification [id]. */
    fun added(context: Context, docId: String, amount: Double?, type: String, merchant: String?, categoryName: String, id: Int) {
        if (!canNotify(context)) return
        val manager = manager(context)
        val money = amount?.let(::money) ?: ""
        val what = listOfNotNull(merchant, categoryName.takeIf { it.isNotEmpty() }).joinToString(" → ")
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
                .setContentTitle("Added $money ${if (type == "income") "income" else "expense"}".replace("  ", " "))
                .setContentText(what.ifEmpty { "From a bank message" })
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setPublicVersion(publicVersion(context, AUTO_ADD, "Entry added from a bank message"))
                .setCategory(NotificationCompat.CATEGORY_STATUS)
                .setOnlyAlertOnce(true)
                .setAutoCancel(true)
                .setContentIntent(change)
                .addAction(0, "Undo", undo)
                .addAction(0, "Change", change)
                .build(),
        )
    }

    /** Title of the "what was this for?" notification (D-030). Pure. */
    fun askTitle(amount: Double?, type: String, merchant: String?, words: String?): String {
        if (words != null) return "Which category for '${words.take(40)}'?"
        val money = amount?.let(::money) ?: "A payment"
        val who = when {
            merchant == null -> if (type == "income") " received" else " payment"
            type == "income" -> " from $merchant"
            else -> " to $merchant"
        }
        return "$money$who — what was this for?"
    }

    /**
     * "₹150 to Ramesh K — what was this for?" with up to two category
     * buttons and Reply (D-030). After an unclear reply it becomes "Which
     * category for 'gift for amma'?". Private on the lock screen.
     */
    fun ask(context: Context, item: ReviewItem, buttons: List<String>) {
        if (!canNotify(context)) return
        val manager = manager(context)
        val id = notificationId(item.receivedAt)
        val table = SmsPrefs.table(context)
        val text = if (item.words == null) {
            listOfNotNull(item.account, "Tap a category or reply in a few words.").joinToString(" · ")
        } else {
            listOfNotNull(item.amount?.let(::money), item.merchant ?: item.account).joinToString(" · ")
        }
        val builder = NotificationCompat.Builder(context, SUGGESTIONS)
            .setSmallIcon(R.drawable.ic_stat_entry)
            .setContentTitle(askTitle(item.amount, item.type, item.merchant, item.words))
            .setContentText(text)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(publicVersion(context, SUGGESTIONS, "A payment to describe"))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_RECOMMENDATION)
            .setOnlyAlertOnce(true)
            .setAutoCancel(true)
            .setContentIntent(link(context, "/sms/review", id))
        buttons.forEachIndexed { i, categoryId ->
            val name = table.category(categoryId)?.name ?: return@forEachIndexed
            builder.addAction(0, name, action(context, SmsActionReceiver.PICK, item.id, id, i, categoryId, mutable = false))
        }
        val reply = RemoteInput.Builder(SmsActionReceiver.KEY_REPLY).setLabel("What was it for?").build()
        builder.addAction(
            NotificationCompat.Action.Builder(0, "Reply", action(context, SmsActionReceiver.REPLY, item.id, id, 9, null, mutable = true))
                .addRemoteInput(reply)
                .setAllowGeneratedReplies(false)
                .build(),
        )
        manager.notify(id, builder.build())
    }

    /** Title of an AI suggestion waiting for approval (D-032). Pure. */
    fun aiTitle(amount: Double?, type: String, merchant: String?, words: String?, categoryName: String): String {
        val money = amount?.let(::money) ?: "A payment"
        val who = when {
            merchant != null -> if (type == "income") " from $merchant" else " to $merchant"
            words != null -> " for '${words.take(40)}'"
            else -> if (type == "income") " received" else ""
        }
        return "$money$who — AI suggests $categoryName"
    }

    /** "Suggested by AI · Gemini Flash-Lite. Approve, change or reply." Pure. */
    fun aiText(model: String?, account: String?): String =
        listOfNotNull("Suggested by AI · ${model ?: "AI"}", account).joinToString(" · ") + ". Approve, change or reply."

    /**
     * The form prefilled with an item ([path] `/add`), as the review list's
     * "Other…" opens it; saving there removes the item and teaches payee memory.
     */
    fun formQuery(item: ReviewItem): Map<String, String> = buildMap {
        put("type", item.type)
        item.amount?.let { put("amount", it.toString()) }
        put(
            "date",
            java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.ROOT)
                .apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }
                .format(java.util.Date(item.receivedAt)),
        )
        item.note?.let { put("note", it) }
        item.categoryId?.let { put("category", it) }
        put("source", "sms")
        put("review", item.id)
    }

    /**
     * "₹420 to BLUE TOKAI — AI suggests Food" with Approve, Change and Reply
     * (D-032). Nothing is saved until the user taps Approve (a user-confirmed
     * save, no Auto marker). Private on the lock screen.
     */
    fun askAi(context: Context, item: ReviewItem) {
        if (!canNotify(context)) return
        val table = SmsPrefs.table(context)
        val category = table.category(item.categoryId) ?: return ask(context, item, SmsLabeller.buttons(table, item, emptyList(), SmsAutoAddWorker.hourOf(item.receivedAt)))
        val manager = manager(context)
        val id = notificationId(item.receivedAt)
        val change = link(context, "/add", id, formQuery(item))
        val reply = RemoteInput.Builder(SmsActionReceiver.KEY_REPLY).setLabel("What was it for?").build()
        val builder = NotificationCompat.Builder(context, SUGGESTIONS)
            .setSmallIcon(R.drawable.ic_stat_entry)
            .setContentTitle(aiTitle(item.amount, item.type, item.merchant, item.words, category.name))
            .setContentText(aiText(item.aiModel, item.account))
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(publicVersion(context, SUGGESTIONS, "A payment to approve"))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_RECOMMENDATION)
            .setOnlyAlertOnce(true)
            .setAutoCancel(true)
            .setContentIntent(link(context, "/sms/review", id))
            .addAction(0, "Approve", action(context, SmsActionReceiver.PICK, item.id, id, 0, category.id, mutable = false))
            .addAction(0, "Change", change)
            .addAction(
                NotificationCompat.Action.Builder(0, "Reply", action(context, SmsActionReceiver.REPLY, item.id, id, 9, null, mutable = true))
                    .addRemoteInput(reply)
                    .setAllowGeneratedReplies(false)
                    .build(),
            )
        manager.notify(id, builder.build())
    }

    private fun action(context: Context, kind: String, itemId: String, notification: Int, index: Int, categoryId: String?, mutable: Boolean): PendingIntent {
        val intent = Intent(context, SmsActionReceiver::class.java)
            .setAction(kind)
            // A distinct data URI keeps each button's PendingIntent separate.
            .setData(Uri.parse("trackexpense-action://$kind/$itemId/$index"))
            .putExtra(SmsActionReceiver.EXTRA_ITEM, itemId)
            .putExtra(SmsActionReceiver.EXTRA_NOTIFICATION, notification)
            .apply { categoryId?.let { putExtra(SmsActionReceiver.EXTRA_CATEGORY, it) } }
        // RemoteInput needs a mutable PendingIntent; the intent is explicit, so that is safe.
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or
            if (mutable && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE
            else if (mutable) 0 else PendingIntent.FLAG_IMMUTABLE
        return PendingIntent.getBroadcast(context, 31 * notification + index, intent, flags)
    }

    /** The save from a notification failed (offline and signed out, …): point at the review list. */
    fun couldNotSave(context: Context, id: Int) {
        if (!canNotify(context)) return
        manager(context).notify(
            id,
            NotificationCompat.Builder(context, SUGGESTIONS)
                .setSmallIcon(R.drawable.ic_stat_entry)
                .setContentTitle("Could not save the entry")
                .setContentText("It is waiting in the review list.")
                .setOnlyAlertOnce(true)
                .setAutoCancel(true)
                .setContentIntent(link(context, "/sms/review", id))
                .build(),
        )
    }

    /** Evening catch-up (D-030): "3 payments need a description". Pure title. */
    fun catchUpTitle(count: Int) = if (count == 1) "1 payment needs a description" else "$count payments need a description"

    fun catchUp(context: Context, count: Int) {
        if (!canNotify(context)) return
        manager(context).notify(
            CATCH_UP_ID,
            NotificationCompat.Builder(context, CATCH_UP)
                .setSmallIcon(R.drawable.ic_stat_entry)
                .setContentTitle(catchUpTitle(count))
                .setContentText("Tap to label them: a category or a few words each.")
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setAutoCancel(true)
                .setContentIntent(link(context, "/sms/review", CATCH_UP_ID))
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
