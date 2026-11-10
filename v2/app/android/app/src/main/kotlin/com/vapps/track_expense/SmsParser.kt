package com.vapps.track_expense

import java.util.Locale

/** What a bank message looks like it describes. [amount] is null when none was found. */
data class SmsSuggestion(val amount: Double?, val type: String)

/**
 * Decides whether a text message looks like a bank transaction and pulls out
 * the amount and direction. Ported from the original app's SmsReceiver.java,
 * with two guards added: one-time-password messages are ignored, and a
 * currency token must start a word (so "hours 2" is not read as "rs 2").
 *
 * Indian banks only: INR / Rs / ₹ and UPI, IMPS, NEFT, RTGS rails.
 */
object SmsParser {
    private val transactionalWords = listOf(
        "debit", "credit", "spent", "received", "withdrawn", "upi", "imps", "neft", "rtgs",
        "a/c", "acct", "account", " card", "txn", "transaction", "transfer", "paid", "payment",
    )
    private val currencyHints = listOf("inr", "rs.", "rs ", "₹")
    private val otpWords = listOf("otp", "one time password", "one-time password", "verification code")
    private val creditWords = listOf("credited", "received", "deposited", "refund")

    private const val NUMBER = "([0-9][0-9,]*(?:\\.\\d{1,2})?)"
    private const val CURRENCY = "(?:(?<![a-z])rs\\.?|(?<![a-z])inr|₹)"
    private val amountPatterns = listOf(
        // "INR 149.00", "Rs. 149", "Rs.149", "₹149", "INR.149.00"
        Regex("$CURRENCY[\\s.:]*$NUMBER", RegexOption.IGNORE_CASE),
        // "149.00 INR", "149 Rs"
        Regex("$NUMBER[\\s.:]*$CURRENCY", RegexOption.IGNORE_CASE),
        // "amount: 149.00", "amt 149"
        Regex("(?:amount|amt)[\\s.:]+$CURRENCY?[\\s.:]*$NUMBER", RegexOption.IGNORE_CASE),
    )

    fun parse(body: String?): SmsSuggestion? {
        if (body.isNullOrBlank()) return null
        val text = body.lowercase(Locale.US)
        if (otpWords.any { text.contains(it) }) return null

        val transactional = transactionalWords.any { text.contains(it) }
        val hasCurrency = currencyHints.any { text.contains(it) }
        if (!transactional && !hasCurrency) return null

        val type = if (creditWords.any { text.contains(it) }) "income" else "expense"
        return SmsSuggestion(extractAmount(body), type)
    }

    fun extractAmount(body: String): Double? {
        for (pattern in amountPatterns) {
            val raw = pattern.find(body)?.groupValues?.get(1) ?: continue
            val value = raw.replace(",", "").toDoubleOrNull()
            if (value != null && value > 0) return value
        }
        return null
    }
}
