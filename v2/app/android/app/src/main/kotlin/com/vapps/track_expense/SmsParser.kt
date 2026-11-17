package com.vapps.track_expense

import java.security.MessageDigest
import java.util.Locale

/** What a bank message looks like it describes. [amount] is null when none was found. */
data class SmsSuggestion(val amount: Double?, val type: String)

/**
 * The parsed fields of a bank message: the only things auto-add keeps (D-005,
 * D-029). The message text itself is never kept. [refHash] is a one-way hash
 * of the UPI/reference number, used only to drop repeats.
 */
data class ParsedSms(
    val amount: Double?,
    val type: String,
    /** Display name, e.g. "Swiggy". Null when the message names no payee. */
    val merchant: String?,
    val merchantKey: String?,
    /** Short bank name, e.g. "HDFC". */
    val bank: String?,
    /** Last digits of the account or card (3 to 4). */
    val last4: String?,
    val refHash: String?,
    /** True when the message says money actually moved (debited, spent, sent…). */
    val definite: Boolean,
) {
    /** "HDFC XX1234", "A/c XX1234", "HDFC" or null. */
    val account: String?
        get() = when {
            last4 != null -> "${bank ?: "A/c"} XX$last4"
            else -> bank
        }

    /** The entry note: merchant and account, never the message. */
    val note: String?
        get() = listOfNotNull(merchant, account).joinToString(" · ").ifEmpty { null }
}

/**
 * Decides whether a text message looks like a bank transaction and pulls out
 * the amount and direction. Ported from the original app's SmsReceiver.java,
 * with two guards added: one-time-password messages are ignored, and a
 * currency token must start a word (so "hours 2" is not read as "rs 2").
 *
 * [parseDetails] adds what auto-add needs (D-029): payee, bank, account
 * last digits and a reference hash, from templates for common HDFC, ICICI,
 * SBI, Axis and Kotak formats plus generic UPI wording. It also rejects
 * promotions, reminders and payment requests, which [parse] (the suggestion
 * path, unchanged from D-005) lets through.
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

    /** SBI UPI writes no currency: "debited by 1499.0", "credited by 500". Details only. */
    private val bareAmount =
        Regex("(?:debited|credited)\\s+(?:by|for|with)\\s+$CURRENCY?\\s*$NUMBER", RegexOption.IGNORE_CASE)

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

    // ------------------------------------------------------------ details

    /** Words that only appear in marketing, reminders or requests. */
    private val promoWords = listOf(
        "offer", "cashback of up", "get up to", "upto", "win ", "voucher", "pre-approved",
        "preapproved", "apply now", "click", "limit increase", "eligible", "congratulations",
        "loan of", "% off", "discount", "reward points", "hurry", "valid till",
    )
    private val notYetWords = listOf(
        "is due", "due on", "due date", "min amt due", "minimum amount due", "total amt due",
        "will be debited", "will be deducted", "has requested", "requested money", "collect request",
        "payment request", "auto-pay", "autopay scheduled", "mandate", "failed", "declined",
        "reversed", "could not be", "unsuccessful",
    )
    private val definiteWords = Regex(
        "\\b(debited|credited|spent|sent|paid|withdrawn|received|deposited|transferred|" +
            "debit by transfer|has a debit|refunded|purchase of)\\b",
        RegexOption.IGNORE_CASE,
    )

    /**
     * The full parse used by auto-add, or null when the message is not a
     * completed transaction. [sender] is the SMS sender id ("AD-HDFCBK").
     */
    fun parseDetails(sender: String?, body: String?): ParsedSms? {
        val basic = parse(body) ?: return null
        val text = body!!.lowercase(Locale.US)
        val definite = definiteWords.containsMatchIn(body)
        if (notYetWords.any { text.contains(it) }) return null
        if (!definite && promoWords.any { text.contains(it) }) return null
        if (promoWords.count { text.contains(it) } >= 2) return null

        // Whichever direction the message mentions first wins: "debited for Rs 1,499; SWIGGY
        // credited" is an expense, "credited to your a/c … from VPA" is income.
        val debitAt = firstIndex(text, listOf("debited", "debit by", "has a debit", "spent", "sent", "paid", "withdrawn", "purchase"))
        val creditAt = firstIndex(text, listOf("credited", "received", "deposited", "refund"))
        val type = when {
            debitAt == Int.MAX_VALUE -> basic.type
            debitAt < creditAt -> "expense"
            else -> "income"
        }
        val amount = basic.amount
            ?: bareAmount.find(body)?.groupValues?.get(1)?.replace(",", "")?.toDoubleOrNull()?.takeIf { it > 0 }
        val merchant = extractMerchant(body, type)
        return ParsedSms(
            amount = amount,
            type = type,
            merchant = merchant,
            merchantKey = MerchantKey.of(merchant),
            bank = bankFrom(sender, body),
            last4 = extractLast4(body),
            refHash = extractRef(body)?.let(::hash),
            definite = definite,
        )
    }

    /** Where the first of [words] starts as a whole word ("sent", not "consent"). */
    private fun firstIndex(text: String, words: List<String>): Int =
        Regex("\\b(" + words.joinToString("|") { Regex.escape(it) } + ")").find(text)?.range?.first
            ?: Int.MAX_VALUE

    // ------------------------------------------------------------ bank

    private val senderBanks = listOf(
        "HDFC" to "HDFC", "ICICI" to "ICICI", "SBI" to "SBI", "AXIS" to "Axis",
        "KOTAK" to "Kotak", "KMBL" to "Kotak", "YESB" to "Yes", "IDFC" to "IDFC",
        "INDUS" to "IndusInd", "PNB" to "PNB", "BOB" to "BoB", "CANBNK" to "Canara",
        "UNION" to "Union", "FEDBNK" to "Federal", "FEDERAL" to "Federal", "AUBANK" to "AU",
        "PAYTMB" to "Paytm", "IOB" to "IOB", "CENTBK" to "Central", "BOI" to "BOI",
    )
    private val bodyBanks = listOf(
        Regex("\\bhdfc\\b", RegexOption.IGNORE_CASE) to "HDFC",
        Regex("\\bicici\\b", RegexOption.IGNORE_CASE) to "ICICI",
        Regex("(\\bsbi\\b|state bank)", RegexOption.IGNORE_CASE) to "SBI",
        Regex("\\baxis\\b", RegexOption.IGNORE_CASE) to "Axis",
        Regex("\\bkotak\\b", RegexOption.IGNORE_CASE) to "Kotak",
        Regex("\\byes bank\\b", RegexOption.IGNORE_CASE) to "Yes",
        Regex("\\bidfc\\b", RegexOption.IGNORE_CASE) to "IDFC",
        Regex("\\bindusind\\b", RegexOption.IGNORE_CASE) to "IndusInd",
        Regex("\\bfederal bank\\b", RegexOption.IGNORE_CASE) to "Federal",
        Regex("\\bcanara\\b", RegexOption.IGNORE_CASE) to "Canara",
        Regex("\\bpnb\\b", RegexOption.IGNORE_CASE) to "PNB",
    )

    /** Short bank name from the sender id ("AD-HDFCBK" → HDFC), else from the text. */
    fun bankFrom(sender: String?, body: String): String? {
        val s = sender.orEmpty().uppercase(Locale.US)
        // Sender ids look like "AD-HDFCBK" or "VM-HDFCBK-S"; phone numbers carry no bank.
        if (s.any { it.isLetter() }) {
            senderBanks.firstOrNull { s.contains(it.first) }?.let { return it.second }
        }
        return bodyBanks.firstOrNull { it.first.containsMatchIn(body) }?.second
    }

    // ------------------------------------------------------------ account

    private val last4Patterns = listOf(
        // "card ending 1234", "Card ending with 1234", "card no. XX1234", "Card XX1234", "Card 1234"
        Regex("card(?:\\s+no\\.?)?\\s*(?:ending(?:\\s+with)?|ending in)?\\s*[:\\-]?\\s*[x*]*\\s*(\\d{3,6})(?!\\d)", RegexOption.IGNORE_CASE),
        // "A/c XX1234", "A/C *1234", "A/cX1234", "Acct XX123", "AC X1234", "a/c no. XXXXXXXX1234"
        Regex("(?:a/c|acct|account|\\bac)(?:\\s*no\\.?)?\\s*[:\\-]?\\s*[x*]+\\s*(\\d{3,6})(?!\\d)", RegexOption.IGNORE_CASE),
        Regex("(?:a/c|acct|account)(?:\\s*no\\.?)?\\s+(\\d{4})(?!\\d)", RegexOption.IGNORE_CASE),
    )

    fun extractLast4(body: String): String? {
        for (p in last4Patterns) {
            val digits = p.find(body)?.groupValues?.get(1) ?: continue
            return digits.takeLast(4)
        }
        return null
    }

    // ------------------------------------------------------------ reference

    private val refPatterns = listOf(
        Regex("UPI/P2[AMP]/(\\d{9,18})", RegexOption.IGNORE_CASE),
        Regex("(?:upi\\s*ref(?:erence)?|ref(?:erence)?|refno|utr|upi|txn\\s*id|imps\\s*ref)(?:\\s*no\\.?|\\s*number)?[\\s:.#\\-]*(\\d{9,18})(?!\\d)", RegexOption.IGNORE_CASE),
    )

    fun extractRef(body: String): String? =
        refPatterns.firstNotNullOfOrNull { it.find(body)?.groupValues?.get(1) }

    /** First 16 hex characters of SHA-256: enough to spot a repeat, useless to read back. */
    fun hash(value: String): String =
        MessageDigest.getInstance("SHA-256").digest(value.toByteArray())
            .joinToString("") { "%02x".format(it) }.take(16)

    // ------------------------------------------------------------ merchant

    private const val NAME = "([A-Za-z0-9][^\\n]*)"
    private val stop = Regex(
        "(?i)(\\s+(on|via|ref|refno|avl|avbl|upi|from|using|not\\s+you|if\\s+not|is|has|dated|at|for|with|by|txn|info|bal)\\b|" +
            "[(,;:]|\\.(?=\\s|$)|\\s-\\s|\\s{2,})",
    )
    private val expenseMerchant = listOf(
        // Axis: "UPI/P2M/123456789012/SWIGGY"
        Regex("UPI/P2[AMP]/\\d+/([^\\n/]+)", RegexOption.IGNORE_CASE),
        // ICICI: "debited for Rs 1,499.00 on 10-Nov-26; SWIGGY credited."
        Regex(";\\s*([A-Za-z0-9][A-Za-z0-9 .&'@_\\-]*?)\\s+credited", RegexOption.IGNORE_CASE),
        // ICICI card: "on 10-Nov-26 on AMAZON PAY IN. Avl Limit"
        Regex("\\bon\\s+\\d{1,2}[-/ ]?[A-Za-z0-9]{2,3}[-/ ]?\\d{2,4}\\s+on\\s+$NAME", RegexOption.IGNORE_CASE),
        // "at AMAZON", "At SWIGGY On 2026-11-10"
        Regex("\\bat\\s+$NAME", RegexOption.IGNORE_CASE),
        // "trf to SWIGGY", "to VPA swiggy@icici", "To SWIGGY\nOn", "paid Rs.149 to Netflix"
        Regex("\\b(?:trf\\s+)?to\\s+(?:vpa\\s+)?$NAME", RegexOption.IGNORE_CASE),
        Regex("\\btowards\\s+$NAME", RegexOption.IGNORE_CASE),
        Regex("\\binfo[:\\s]+$NAME", RegexOption.IGNORE_CASE),
    )
    private val incomeMerchant = listOf(
        Regex("UPI/P2[AMP]/\\d+/([^\\n/]+)", RegexOption.IGNORE_CASE),
        Regex("\\bfrom\\s+(?:vpa\\s+)?$NAME", RegexOption.IGNORE_CASE),
        Regex("\\bby\\s+(?!transfer)(?:vpa\\s+)?$NAME", RegexOption.IGNORE_CASE),
        // HDFC: "for NEFT Cr-ACME CORP-SALARY"
        Regex("(?:neft|imps|rtgs)\\s*cr-([^\\n]+)", RegexOption.IGNORE_CASE),
        Regex("\\binfo[:\\s]+$NAME", RegexOption.IGNORE_CASE),
    )
    /** Axis card alert: the payee is the line after the date/time line. */
    private val lineAfterTime =
        Regex("\\n\\d{2}[-/]\\d{2}[-/]\\d{2,4},?\\s+\\d{2}:\\d{2}(?::\\d{2})?(?:\\s*IST)?\\s*\\n([^\\n]+)\\n", RegexOption.IGNORE_CASE)

    /** Words that are never a payee: "to your a/c", "to HDFC Bank", "to block". */
    private val notPayee = Regex(
        "^(your|ur|you|a/?c|ac|acct|account|card|self|block|dispute|report|mobile|beneficiary|" +
            "the|this|bank|hdfc bank|icici bank|axis bank|kotak bank|sbi|avl|avbl|call|sms|rs|inr|" +
            "us|customer|dear|date|a\\s)\\b",
        RegexOption.IGNORE_CASE,
    )

    private val amountLike = Regex("^(rs\\.?|inr|₹)\\s*\\d", RegexOption.IGNORE_CASE)

    fun extractMerchant(body: String, type: String): String? {
        val patterns = if (type == "income") incomeMerchant else expenseMerchant
        for (p in patterns) {
            for (m in p.findAll(body)) {
                clean(m.groupValues[1])?.let { return it }
            }
        }
        if (type == "expense") lineAfterTime.find(body)?.groupValues?.get(1)?.let { line ->
            if (!line.trim().startsWith("avl", ignoreCase = true)) clean(line)?.let { return it }
        }
        return null
    }

    private fun clean(raw: String): String? {
        var s = raw.trim()
        stop.find(s)?.let { s = s.substring(0, it.range.first) }
        s = s.trim().trimEnd('.', '-', '*', '/').trim()
        if (s.length < 2 || s.length > 40) return null
        if (notPayee.containsMatchIn(s) || amountLike.containsMatchIn(s)) return null
        if (!s.any { it.isLetter() }) return null
        // A UPI address: keep the readable handle; drop numeric (phone) handles.
        if (s.contains('@')) {
            val handle = s.substringBefore('@')
            if (handle.count { it.isDigit() } >= 6) return null
            val words = handle.split(Regex("[^A-Za-z0-9]+")).filter { w -> w.isNotEmpty() && w.any { it.isLetter() } }
            if (words.isEmpty()) return null
            s = words.joinToString(" ")
        }
        if (s.count { it.isDigit() } >= 6) return null
        return titleCase(s)
    }

    /** "SWIGGY" → "Swiggy", "amazon pay in" → "Amazon Pay In"; mixed case is kept. */
    private fun titleCase(s: String): String {
        val letters = s.filter { it.isLetter() }
        if (letters.any { it.isUpperCase() } && letters.any { it.isLowerCase() }) return s
        return Regex("(^|[^a-z0-9])([a-z])").replace(s.lowercase(Locale.ROOT)) {
            it.groupValues[1] + it.groupValues[2].uppercase(Locale.ROOT)
        }
    }
}
