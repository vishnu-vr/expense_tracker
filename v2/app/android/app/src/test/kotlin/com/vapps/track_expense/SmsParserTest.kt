package com.vapps.track_expense

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SmsParserTest {
    @Test
    fun debitWithRsPrefix() {
        val s = SmsParser.parse("Rs.1,499.00 debited from A/c XX1234 on 10-11-26 to SWIGGY. UPI Ref 123456789012")
        assertEquals(1499.0, s!!.amount!!, 0.0)
        assertEquals("expense", s.type)
    }

    @Test
    fun creditWithInr() {
        val s = SmsParser.parse("INR 1,20,000.00 credited to your account XX9876. Info: SALARY")
        assertEquals(120000.0, s!!.amount!!, 0.0)
        assertEquals("income", s.type)
    }

    @Test
    fun rupeeSymbolAndTrailingCurrency() {
        assertEquals(149.0, SmsParser.parse("You paid ₹149 to Netflix via UPI")!!.amount!!, 0.0)
        assertEquals(250.5, SmsParser.parse("Payment of 250.50 INR received from Asha")!!.amount!!, 0.0)
    }

    @Test
    fun amountKeyword() {
        assertEquals(75.0, SmsParser.parse("Txn alert. Amt: 75 spent on card XX11")!!.amount!!, 0.0)
    }

    @Test
    fun refundIsIncome() {
        assertEquals("income", SmsParser.parse("Refund of Rs 300 processed to your card")!!.type)
    }

    @Test
    fun transactionalWithoutAmountStillSuggests() {
        val s = SmsParser.parse("Your transaction at AMAZON was successful")
        assertNull(s!!.amount)
        assertEquals("expense", s.type)
    }

    @Test
    fun ignoresOtpAndUnrelatedMessages() {
        assertNull(SmsParser.parse("123456 is your OTP for txn of Rs.500 at AMAZON. Do not share."))
        assertNull(SmsParser.parse("Your verification code for account login is 889900"))
        assertNull(SmsParser.parse("See you at 6, dinner is ready"))
        assertNull(SmsParser.parse(""))
        assertNull(SmsParser.parse(null))
    }

    @Test
    fun currencyTokenMustStartAWord() {
        // "hours 2" must not be read as "rs 2".
        val s = SmsParser.parse("Your payment is due in 3 hours 2 minutes")
        assertNull(s!!.amount)
    }
}
