package com.vapps.track_expense

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Per-bank templates for [SmsParser.parseDetails]. The samples are written
 * from the common public formats of each bank (no real messages were
 * provided); numbers and names are made up.
 */
class SmsTemplatesTest {
    private data class Expect(
        val amount: Double,
        val type: String,
        val merchant: String?,
        val bank: String?,
        val last4: String?,
        val hasRef: Boolean,
    )

    private fun check(sender: String, body: String, e: Expect) {
        val p = SmsParser.parseDetails(sender, body)
        assertNotNull("not parsed: $body", p)
        p!!
        assertEquals("amount: $body", e.amount, p.amount!!, 0.001)
        assertEquals("type: $body", e.type, p.type)
        assertEquals("merchant: $body", e.merchant, p.merchant)
        assertEquals("bank: $body", e.bank, p.bank)
        assertEquals("last4: $body", e.last4, p.last4)
        assertEquals("ref: $body", e.hasRef, p.refHash != null)
        assertTrue("definite: $body", p.definite)
    }

    // ------------------------------------------------------------ HDFC

    @Test
    fun hdfcUpiSent() = check(
        "VM-HDFCBK",
        "Sent Rs.1499.00\nFrom HDFC Bank A/C *1234\nTo SWIGGY\nOn 10/11/26\nRef 123456789012\nNot You?\nCall 18002586161/SMS BLOCK UPI to 7308080808",
        Expect(1499.0, "expense", "Swiggy", "HDFC", "1234", true),
    )

    @Test
    fun hdfcDebitToVpa() = check(
        "AD-HDFCBK",
        "Rs.1,499.00 debited from A/c XX1234 on 10-11-26 to VPA swiggy@icici (UPI Ref No 123456789012). Not you? Call 18002586161",
        Expect(1499.0, "expense", "Swiggy", "HDFC", "1234", true),
    )

    @Test
    fun hdfcCardSpent() = check(
        "AX-HDFCBK",
        "Spent Rs.2,350 On HDFC Bank Card 5678 At AMAZON On 2026-11-10:12:30:11.Not You? To Block+Reissue Call 18002323232/SMS BLOCK CC 5678 to 7308080808",
        Expect(2350.0, "expense", "Amazon", "HDFC", "5678", false),
    )

    @Test
    fun hdfcSalaryNeft() = check(
        "VM-HDFCBK-S",
        "Update! INR 50,000.00 deposited in HDFC Bank A/c XX1234 on 01-NOV-26 for NEFT Cr-ACME CORP-SALARY. Avl bal INR 1,00,000.00",
        Expect(50000.0, "income", "Acme Corp-Salary", "HDFC", "1234", false),
    )

    @Test
    fun hdfcUpiCredit() = check(
        "JD-HDFCBK",
        "Credit Alert!\nRs.500.00 credited to HDFC Bank A/c XX1234 on 10-11-26 from VPA asha.k@okaxis (UPI 123456789012)",
        Expect(500.0, "income", "Asha K", "HDFC", "1234", true),
    )

    // ------------------------------------------------------------ ICICI

    @Test
    fun iciciUpiDebit() = check(
        "JM-ICICIB",
        "ICICI Bank Acct XX123 debited for Rs 1,499.00 on 10-Nov-26; SWIGGY credited. UPI:123456789012. Call 18002662 for dispute. SMS BLOCK 123 to 9215676766.",
        Expect(1499.0, "expense", "Swiggy", "ICICI", "123", true),
    )

    @Test
    fun iciciCard() = check(
        "VK-ICICIT",
        "INR 2,350.00 spent using ICICI Bank Card XX9012 on 10-Nov-26 on AMAZON PAY IN. Avl Limit: INR 1,00,000.00. If not you, call 1800 2662/SMS BLOCK 9012 to 9215676766",
        Expect(2350.0, "expense", "Amazon Pay In", "ICICI", "9012", false),
    )

    @Test
    fun iciciCredit() = check(
        "BZ-ICICIB",
        "Dear Customer, Acct XX123 is credited with Rs 500.00 on 10-Nov-26 from ASHA K. UPI:123456789012-ICICI Bank.",
        Expect(500.0, "income", "Asha K", "ICICI", "123", true),
    )

    // ------------------------------------------------------------ SBI

    @Test
    fun sbiUpiDebitWithoutCurrency() = check(
        "AD-SBIUPI",
        "Dear UPI user A/C X1234 debited by 1499.0 on date 10Nov26 trf to SWIGGY Refno 123456789012. If not u? call 1800111109. -SBI",
        Expect(1499.0, "expense", "Swiggy", "SBI", "1234", true),
    )

    @Test
    fun sbiUpiCredit() = check(
        "VM-SBIUPI",
        "Dear SBI UPI User, ur A/cX1234 credited by Rs500 on 10Nov26 by (Ref no 123456789012)",
        Expect(500.0, "income", null, "SBI", "1234", true),
    )

    @Test
    fun sbiTransferDebit() = check(
        "BZ-SBIINB",
        "Your A/C XXXXX1234 has a debit by transfer of Rs 1,499.00 on 10/11/26. Avl Bal Rs 10,000.00.-SBI",
        Expect(1499.0, "expense", null, "SBI", "1234", false),
    )

    @Test
    fun sbiCard() = check(
        "AD-SBICRD",
        "Rs.2,350.00 spent on your SBI Credit Card ending 4321 at AMAZON on 10/11/26. Trxn. not done by you? Report at https://sbicard.com/Dispute",
        Expect(2350.0, "expense", "Amazon", "SBI", "4321", false),
    )

    // ------------------------------------------------------------ Axis

    @Test
    fun axisUpiMerchant() = check(
        "AX-AXISBK",
        "INR 1499.00 debited\nA/c no. XX1234\n10-11-26, 12:30:11\nUPI/P2M/123456789012/SWIGGY\nNot you? SMS BLOCKUPI Cust ID to 919951860002\nAxis Bank",
        Expect(1499.0, "expense", "Swiggy", "Axis", "1234", true),
    )

    @Test
    fun axisCard() = check(
        "VM-AXISBK",
        "Spent\nCard no. XX5678\nINR 2350\n10-11-26 12:30:11\nAMAZON\nAvl Lmt INR 100000\nSMS BLOCK 5678 to 919951860002, if not you - Axis Bank",
        Expect(2350.0, "expense", "Amazon", "Axis", "5678", false),
    )

    @Test
    fun axisUpiCredit() = check(
        "JD-AXISBK",
        "INR 500.00 credited\nA/c no. XX1234\n10-11-26, 12:30:11 IST\nUPI/P2A/123456789012/ASHA K\nNot you? SMS BLOCKUPI Cust ID to 919951860002\nAxis Bank",
        Expect(500.0, "income", "Asha K", "Axis", "1234", true),
    )

    // ------------------------------------------------------------ Kotak

    @Test
    fun kotakUpiSent() = check(
        "AD-KOTAKB",
        "Sent Rs.1499.00 from Kotak Bank AC X1234 to swiggy@icici on 10-11-26.UPI Ref 123456789012. Not you, https://kotak.com/KBANKT/Fraud",
        Expect(1499.0, "expense", "Swiggy", "Kotak", "1234", true),
    )

    @Test
    fun kotakUpiReceived() = check(
        "VM-KOTAKB",
        "Received Rs.500.00 in your Kotak Bank AC X1234 from asha@okaxis on 10-11-26.UPI Ref:123456789012.",
        Expect(500.0, "income", "Asha", "Kotak", "1234", true),
    )

    @Test
    fun kotakCard() = check(
        "JM-KOTAKB",
        "Rs.2350.00 spent on Kotak Credit Card x9876 at ZOMATO on 10/11/2026. Avl limit Rs 50000",
        Expect(2350.0, "expense", "Zomato", "Kotak", "9876", false),
    )

    // ------------------------------------------------------------ generic UPI

    @Test
    fun genericPaidVia() = check(
        "AD-PAYTMB",
        "You have paid Rs.149 to Netflix via UPI. UPI Ref No 123456789012",
        Expect(149.0, "expense", "Netflix", "Paytm", null, true),
    )

    @Test
    fun genericTowards() = check(
        "VM-IDFCFB",
        "Acct XX1234 debited with INR 1,499.00 on 10-Nov-26 towards UBER INDIA. IMPS Ref 612345678901",
        Expect(1499.0, "expense", "Uber India", "IDFC", "1234", true),
    )

    @Test
    fun genericAccountToAccountHasNoPayee() = check(
        "BZ-PNBSMS",
        "Your a/c no. XXXXXXXX1234 is debited for Rs.1499.00 on 10-11-2026 and credited to a/c no. XXXXXXXX5678 (UPI Ref no 123456789012)",
        Expect(1499.0, "expense", null, "PNB", "1234", true),
    )

    @Test
    fun phoneNumberUpiHandleIsShownMaskedAndKeyedForMemoryOnly() {
        val p = SmsParser.parseDetails("AD-HDFCBK", "Rs.300.00 debited from A/c XX1234 to VPA 9876543210@ybl (UPI Ref No 123456789012)")!!
        // Shown masked; the number is only in the in-memory key, hashed before anything is stored (D-030).
        assertEquals("UPI xxxxx3210", p.merchant)
        assertEquals("tel:9876543210", p.payeeKey)
        val stored = p.withHashedPayee("s1")
        assertNull(stored.payeeKey)
        assertFalse(stored.toString().contains("9876543210"))
        assertFalse(stored.note!!.contains("9876543210"))
    }

    // ------------------------------------------------------------ rejected

    @Test
    fun rejectsOtpPromosRemindersAndRequests() {
        val rejected = listOf(
            "123456 is your OTP for txn of Rs.500 at AMAZON. Do not share.",
            "Get up to Rs.5000 cashback on your HDFC Credit Card. Click here to apply now!",
            "Congratulations! You are eligible for a pre-approved loan of Rs 2,00,000. Apply now",
            "Your HDFC Bank Credit Card statement: Total amt due Rs 12,345.00, Min amt due Rs 620. Due date 15-11-26",
            "ASHA has requested money from you Rs 500 on Google Pay. UPI collect request",
            "Rs 1,499 will be debited from your A/c XX1234 on 15-11-26 for NETFLIX autopay",
            "Txn of Rs 1,499.00 at SWIGGY on card XX1234 declined due to insufficient balance",
            "See you at 6, dinner is ready",
        )
        for (body in rejected) assertNull(body, SmsParser.parseDetails("AD-HDFCBK", body))
    }

    @Test
    fun definiteOnlyWhenMoneyMoved() {
        val p = SmsParser.parseDetails("AD-HDFCBK", "Txn alert. Amt: 75 on card XX11")!!
        assertFalse(p.definite)
    }

    // ------------------------------------------------------------ note & ref

    @Test
    fun noteIsMerchantAndAccountOnly() {
        val p = SmsParser.parseDetails("AD-HDFCBK", "Rs.1,499.00 debited from A/c XX1234 on 10-11-26 to VPA swiggy@icici (UPI Ref No 123456789012).")!!
        assertEquals("Swiggy · HDFC XX1234", p.note)
    }

    @Test
    fun refIsHashedNotKept() {
        val p = SmsParser.parseDetails("AD-HDFCBK", "Rs.1,499.00 debited from A/c XX1234 to VPA swiggy@icici (UPI Ref No 123456789012).")!!
        assertEquals(16, p.refHash!!.length)
        assertFalse(p.refHash!!.contains("123456789012"))
        assertEquals(SmsParser.hash("123456789012"), p.refHash)
    }

    @Test
    fun bankFromSenderThenBody() {
        assertEquals("HDFC", SmsParser.bankFrom("AD-HDFCBK", ""))
        assertEquals("Axis", SmsParser.bankFrom("VK-AXISBK-S", ""))
        assertEquals("SBI", SmsParser.bankFrom("+919876543210", "Rs 50 debited -SBI"))
        assertNull(SmsParser.bankFrom("+919876543210", "Rs 50 debited"))
    }
}
