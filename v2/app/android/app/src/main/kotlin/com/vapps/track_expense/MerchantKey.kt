package com.vapps.track_expense

import java.util.Locale

/**
 * Normalised merchant name used to look up categories. Must match
 * `merchantKey()` in `app/lib/core/domain/sms_categories.dart`; both sides are
 * tested against `app/test/fixtures/merchant_key_vectors.json`.
 *
 * Lowercase; for a UPI address keep only the part before `@`; every
 * non-alphanumeric character becomes a space; tokens made only of digits are
 * dropped; spaces collapse. Null when nothing is left.
 */
object MerchantKey {
    private val nonAlnum = Regex("[^a-z0-9]+")
    private val digitsOnly = Regex("^[0-9]+$")

    fun of(raw: String?): String? {
        if (raw == null) return null
        var s = raw.lowercase(Locale.ROOT)
        val at = s.indexOf('@')
        if (at >= 0) s = s.substring(0, at)
        val key = s.replace(nonAlnum, " ")
            .split(' ')
            .filter { it.isNotEmpty() && !digitsOnly.matches(it) }
            .joinToString(" ")
        return key.ifEmpty { null }
    }
}
