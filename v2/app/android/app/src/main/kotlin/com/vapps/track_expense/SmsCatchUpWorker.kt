package com.vapps.track_expense

import android.content.Context
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.TimeUnit

/**
 * The evening catch-up rule (D-030). Pure, for unit tests. Uses Calendar,
 * not java.time, because the app still runs on Android 7 (minSdk 24).
 */
object CatchUp {
    const val HOUR = 20
    const val MINUTE = 30

    /** Runs that start before 20:00 or at 23:00 or later (Doze, a dead battery) do not notify. */
    const val EARLIEST_HOUR = 20
    const val LATEST_HOUR = 23

    /** Only payments from the last week count, so old ignored items do not nag forever. */
    const val MAX_AGE_MS = 7L * 24 * 60 * 60 * 1000

    private fun calendar(ms: Long, zone: TimeZone) = Calendar.getInstance(zone, Locale.ROOT).apply { timeInMillis = ms }

    /** Next 20:30 strictly after [nowMs] in [zone]. */
    fun nextRun(nowMs: Long, zone: TimeZone): Long {
        val c = calendar(nowMs, zone).apply {
            set(Calendar.HOUR_OF_DAY, HOUR)
            set(Calendar.MINUTE, MINUTE)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }
        if (c.timeInMillis <= nowMs) c.add(Calendar.DAY_OF_MONTH, 1)
        return c.timeInMillis
    }

    /** "2026-11-17" for [ms] in [zone]. */
    fun day(ms: Long, zone: TimeZone): String {
        val c = calendar(ms, zone)
        return String.format(Locale.ROOT, "%04d-%02d-%02d", c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH))
    }

    /** The unique work name for one evening: scheduling the same evening twice keeps one job. */
    fun workName(runAtMs: Long, zone: TimeZone) = "sms-catch-up-${day(runAtMs, zone)}"

    /**
     * How many payments to mention, or 0 for no notification: detection,
     * auto-add and the reminder are on, it is evening, nothing was shown
     * today, and the review list has items from the last week with an amount.
     */
    fun count(
        enabled: Boolean,
        autoAdd: Boolean,
        evening: Boolean,
        items: List<ReviewItem>,
        nowMs: Long,
        zone: TimeZone,
        lastNotifiedDay: String?,
    ): Int {
        if (!enabled || !autoAdd || !evening) return 0
        val hour = calendar(nowMs, zone).get(Calendar.HOUR_OF_DAY)
        if (hour < EARLIEST_HOUR || hour >= LATEST_HOUR) return 0
        if (lastNotifiedDay == day(nowMs, zone)) return 0
        return items.count { it.amount != null && nowMs - it.receivedAt in 0 until MAX_AGE_MS }
    }
}

/** The daily evening job: one "3 payments need a description" notification at most. */
class SmsCatchUpWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        val context = applicationContext
        val now = System.currentTimeMillis()
        val zone = TimeZone.getDefault()
        val count = CatchUp.count(
            SmsPrefs.isEnabled(context), SmsPrefs.isAutoAdd(context), SmsPrefs.isEveningOn(context),
            SmsReviewQueue.all(context), now, zone, SmsPrefs.lastCatchUpDay(context),
        )
        if (count > 0) {
            SmsNotifications.catchUp(context, count)
            SmsPrefs.setLastCatchUpDay(context, CatchUp.day(now, zone))
        }
        // Tomorrow's run. Appended, so it is kept even when this run already
        // carries tomorrow's name (e.g. it was started early); a second run on
        // the same evening is silenced by the once-a-day check.
        schedule(context, now + 60_000, ExistingWorkPolicy.APPEND_OR_REPLACE)
        return Result.success()
    }

    companion object {
        private const val TAG = "sms-catch-up"

        /** Schedules the next evening run when the reminder applies, else cancels it. Safe to call often. */
        fun schedule(context: Context, nowMs: Long = System.currentTimeMillis(), policy: ExistingWorkPolicy = ExistingWorkPolicy.KEEP) {
            val wm = WorkManager.getInstance(context)
            if (!(SmsPrefs.isEnabled(context) && SmsPrefs.isAutoAdd(context) && SmsPrefs.isEveningOn(context))) {
                wm.cancelAllWorkByTag(TAG)
                return
            }
            val zone = TimeZone.getDefault()
            val next = CatchUp.nextRun(nowMs, zone)
            val request = OneTimeWorkRequestBuilder<SmsCatchUpWorker>()
                .setInitialDelay(next - System.currentTimeMillis(), TimeUnit.MILLISECONDS)
                .addTag(TAG)
                .build()
            wm.enqueueUniqueWork(CatchUp.workName(next, zone), policy, request)
        }
    }
}
