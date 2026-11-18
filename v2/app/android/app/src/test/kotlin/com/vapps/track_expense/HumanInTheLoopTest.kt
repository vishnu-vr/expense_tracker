package com.vapps.track_expense

import com.google.mlkit.genai.common.FeatureStatus
import com.google.mlkit.genai.common.GenAiException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Calendar
import java.util.TimeZone

/** D-030: notification questions, reply guesses, payee memory, evening catch-up, Nano status. */
class HumanInTheLoopTest {
    private val tableJson = """
        {
          "homeId": "h1", "userId": "u1", "userEmail": "a@example.com",
          "firebase": {"apiKey": "k", "appId": "a", "projectId": "p", "messagingSenderId": "1"},
          "history": {"expense:swiggy": "food"},
          "builtin": [
            {"p": "\\b(swiggy|swgy)\\b", "m": "swiggy", "c": "food"},
            {"p": "\\b(auto|rickshaw)\\b", "m": "auto", "c": "transportation"}
          ],
          "categories": [
            {"id": "food", "name": "Food", "type": "expense"},
            {"id": "grocery", "name": "Grocery", "type": "expense"},
            {"id": "transportation", "name": "Transportation", "type": "expense"},
            {"id": "gift", "name": "Gift", "type": "expense"},
            {"id": "health", "name": "Health", "type": "expense"},
            {"id": "salary", "name": "Salary", "type": "income"}
          ],
          "words": {"expense:office": "transportation", "expense:amma": "gift", "expense:vegetables": "grocery"},
          "keywords": {"lunch": "food", "medicine": "health", "auto": "transportation", "gift": "gift"},
          "bands": [100, 300, 1000, 3000, 10000],
          "parts": [5, 11, 16, 21],
          "suggest": {"expense": {"b1p0": ["transportation", "food", "grocery"], "b2p2": ["grocery", "food"]}},
          "top": {"expense": ["food", "grocery", "transportation"], "income": ["salary"]}
        }
    """.trimIndent()
    private val table = CategoryTable.decode(tableJson)

    private fun item(merchant: String? = "Ramesh K", words: String? = null, categoryId: String? = null, amount: Double? = 150.0) =
        ReviewItem("r1", amount, "expense", merchant, "HDFC XX1234", 1_000L, categoryId, null, "hash1", words)

    // ------------------------------------------------------------ quick suggestions

    @Test
    fun quickSuggestionsUseAmountBandAndDayPart() {
        assertEquals(1, QuickSuggest.band(table, 150.0))
        assertEquals(0, QuickSuggest.band(table, 99.0))
        assertEquals(5, QuickSuggest.band(table, 25_000.0))
        assertEquals(0, QuickSuggest.part(table, 8))
        assertEquals(2, QuickSuggest.part(table, 20))
        assertEquals(3, QuickSuggest.part(table, 23))
        assertEquals(3, QuickSuggest.part(table, 2)) // night wraps past midnight
        // ₹150 in the morning → band 1, part 0.
        assertEquals(listOf("transportation", "food"), QuickSuggest.top(table, "expense", 150.0, 8))
        assertEquals(listOf("grocery", "food"), QuickSuggest.top(table, "expense", 500.0, 18))
    }

    @Test
    fun quickSuggestionsFallBackToMostUsed() {
        assertEquals(listOf("food", "grocery"), QuickSuggest.top(table, "expense", 50_000.0, 3))
        assertEquals(listOf("food", "grocery"), QuickSuggest.top(table, "expense", null, 12))
        assertEquals(listOf("salary"), QuickSuggest.top(table, "income", 1000.0, 9))
        assertEquals(emptyList<String>(), QuickSuggest.top(CategoryTable.EMPTY, "expense", 10.0, 9))
    }

    @Test
    fun buttonsPutTheWordsAndTheItemsOwnGuessFirst() {
        assertEquals(listOf("transportation", "food"), SmsLabeller.buttons(table, item(), emptyList(), 8))
        assertEquals(listOf("health", "transportation"), SmsLabeller.buttons(table, item(categoryId = "health"), emptyList(), 8))
        assertEquals(listOf("gift", "food"), SmsLabeller.buttons(table, item(), listOf("gift", "food"), 8))
        // A category of the wrong direction is never offered.
        assertEquals(listOf("transportation", "food"), SmsLabeller.buttons(table, item(), listOf("salary"), 8))
    }

    // ------------------------------------------------------------ reply guess

    @Test
    fun replyGuessUsesHouseholdWordsKeywordsAndMerchants() {
        assertEquals("transportation", ReplyCategoriser.guess(table, "auto to office", "expense").categoryId)
        assertEquals("food", ReplyCategoriser.guess(table, "Lunch", "expense").categoryId)
        assertEquals("food", ReplyCategoriser.guess(table, "swiggy order", "expense").categoryId)
        assertEquals("grocery", ReplyCategoriser.guess(table, "vegetables 2kg", "expense").categoryId)
        assertEquals("health", ReplyCategoriser.guess(table, "medicine", "expense").categoryId)
        // Two clues for the same category are still confident.
        assertEquals("gift", ReplyCategoriser.guess(table, "gift for amma", "expense").categoryId)
    }

    @Test
    fun replyGuessIsUnsureWhenCluesDisagreeOrAreMissing() {
        // "medicine" says health, "amma" says gift: ask.
        val mixed = ReplyCategoriser.guess(table, "medicine amma", "expense")
        assertNull(mixed.categoryId)
        assertEquals(setOf("health", "gift"), mixed.candidates.toSet())
        val none = ReplyCategoriser.guess(table, "for ramu", "expense")
        assertNull(none.categoryId)
        assertTrue(none.candidates.isEmpty())
        // Keywords are for expenses only.
        assertNull(ReplyCategoriser.guess(table, "lunch", "income").categoryId)
    }

    @Test
    fun labelLogicSavesOrAsks() {
        assertEquals(
            LabelOutcome.Save("transportation", "auto to office", "auto to office · Ramesh K"),
            LabelLogic.decide(table, item(), null, "  auto   to office \n"),
        )
        assertEquals(LabelOutcome.Ask("for ramu", emptyList()), LabelLogic.decide(table, item(), null, "for ramu"))
        assertEquals(
            LabelOutcome.Ask("medicine amma", listOf("health", "gift")),
            LabelLogic.decide(table, item(), null, "medicine amma"),
        )
        // One-tap keeps the words of an earlier unclear reply.
        assertEquals(
            LabelOutcome.Save("gift", "for ramu", "for ramu · Ramesh K"),
            LabelLogic.decide(table, item(words = "for ramu"), "gift", null),
        )
        assertEquals(
            LabelOutcome.Save("food", null, "Ramesh K · HDFC XX1234"),
            LabelLogic.decide(table, item(), "food", null),
        )
        assertEquals(LabelOutcome.Ignore, LabelLogic.decide(table, null, "food", null))
        assertEquals(LabelOutcome.Ignore, LabelLogic.decide(table, item(), "salary", null))
        assertEquals(LabelOutcome.Ask(null, emptyList()), LabelLogic.decide(table, item(), null, "   "))
        assertEquals(80, LabelLogic.cleanWords("x".repeat(200))!!.length)
    }

    @Test
    fun noteRuleMatchesDart() {
        assertEquals("Ramesh K · HDFC XX1234", SmsNote.compose(null, "Ramesh K", "HDFC XX1234"))
        assertEquals("auto to office · Ramesh K", SmsNote.compose("auto to office", "Ramesh K", "HDFC XX1234"))
        assertEquals("auto · HDFC XX1234", SmsNote.compose(" auto ", null, "HDFC XX1234"))
        assertNull(SmsNote.compose("", null, null))
    }

    @Test
    fun notificationWording() {
        assertEquals("₹150 to Ramesh K — what was this for?", SmsNotifications.askTitle(150.0, "expense", "Ramesh K", null))
        assertEquals("₹1,499.50 from Acme — what was this for?", SmsNotifications.askTitle(1499.5, "income", "Acme", null))
        assertEquals("₹150 payment — what was this for?", SmsNotifications.askTitle(150.0, "expense", null, null))
        assertEquals("Which category for 'gift for amma'?", SmsNotifications.askTitle(150.0, "expense", "Ramesh K", "gift for amma"))
        assertEquals("1 payment needs a description", SmsNotifications.catchUpTitle(1))
        assertEquals("3 payments need a description", SmsNotifications.catchUpTitle(3))
    }

    // ------------------------------------------------------------ payee memory

    @Test
    fun payeeKeysFromTheParser() {
        val tel = SmsParser.parseDetails("AD-HDFCBK", "Rs.150.00 debited from A/c XX1234 to VPA 919876543210@paytm (UPI Ref No 123456789012)")!!
        assertEquals("tel:9876543210", tel.payeeKey) // country code dropped: same person on any app
        assertEquals("UPI xxxxx3210", tel.merchant)
        val vpa = SmsParser.parseDetails("KOTAKB", "Sent Rs.320.00 from Kotak Bank AC X5678 to rameshstores@okhdfc on 17-11-26.UPI Ref 998877665544.")!!
        assertEquals("vpa:rameshstores@okhdfc", vpa.payeeKey)
        assertEquals("Rameshstores", vpa.merchant)
        val name = SmsParser.parseDetails("AD-HDFCBK", "Sent Rs.150.00 From HDFC Bank A/C *1234 To RAMESH K On 17/11/26 Ref 123456789012")!!
        assertEquals("name:ramesh k", name.payeeKey)
    }

    @Test
    fun hashIsSaltedAndNeverHoldsTheNumber() {
        val salt1 = PayeeMemoryCodec.newSalt()
        val salt2 = PayeeMemoryCodec.newSalt()
        assertEquals(32, salt1.length)
        assertNotEquals(salt1, salt2)
        val h1 = PayeeMemoryCodec.hash(salt1, "tel:9876543210")
        assertEquals(32, h1.length)
        assertEquals(h1, PayeeMemoryCodec.hash(salt1, "tel:9876543210"))
        assertNotEquals(h1, PayeeMemoryCodec.hash(salt2, "tel:9876543210"))
        assertFalse(h1.contains("9876543210"))

        val sms = SmsParser.parseDetails("AD-HDFCBK", "Rs.150.00 debited from A/c XX1234 to VPA 9876543210@ybl (UPI Ref No 123456789012)")!!
        val stored = sms.withHashedPayee(salt1)
        assertEquals(h1, stored.payeeHash)
        val item = ReviewItem.from(stored, 1_000L, null)
        val json = ReviewQueueCodec.encode(listOf(item))
        assertFalse(json.contains("9876543210"))
        assertTrue(json.contains(h1))
        val memory = PayeeMemoryCodec.encode(
            PayeeMemoryCodec.remember(emptyMap(), h1, RememberedPayee("transportation", "expense", "auto", 1L, "d1")),
        )
        assertFalse(memory.contains("9876543210"))
    }

    @Test
    fun rememberUpdateUndoAndForget() {
        var m = PayeeMemoryCodec.remember(emptyMap(), "h1", RememberedPayee("transportation", "expense", "auto to office", 1L, "d1"))
        m = PayeeMemoryCodec.remember(m, "h2", RememberedPayee("gift", "expense", null, 2L, "d2"))
        assertEquals(m, PayeeMemoryCodec.decode(PayeeMemoryCodec.encode(m)))
        // A change replaces the old memory.
        m = PayeeMemoryCodec.remember(m, "h1", RememberedPayee("food", "expense", "lunch", 3L, "d3"))
        assertEquals("food", m["h1"]!!.categoryId)
        assertEquals("lunch", m["h1"]!!.words)
        // Undo of d3 drops only what d3 set.
        assertEquals(setOf("h2"), PayeeMemoryCodec.undo(m, "d3").keys)
        assertEquals(m, PayeeMemoryCodec.undo(m, "zzz"))
        // Size limit keeps the newest.
        var big = emptyMap<String, RememberedPayee>()
        for (i in 0 until PayeeMemoryCodec.MAX_PAYEES + 5) big = PayeeMemoryCodec.remember(big, "h$i", RememberedPayee("food", "expense", null, i.toLong(), null))
        assertEquals(PayeeMemoryCodec.MAX_PAYEES, big.size)
        assertFalse(big.containsKey("h0"))
        assertTrue(PayeeMemoryCodec.decode("not json").isEmpty())
    }

    @Test
    fun entryRefsAndNoteWordsForEdits() {
        val now = 100L * 24 * 60 * 60 * 1000
        var e = PayeeMemoryCodec.addEntry(emptyMap(), "old", SmsEntryRef("h0", "A", null, 1L), now)
        e = PayeeMemoryCodec.addEntry(e, "d1", SmsEntryRef("h1", "Ramesh K", "HDFC XX1234", now), now)
        assertEquals(setOf("d1"), e.keys) // older than 90 days dropped
        assertEquals(e, PayeeMemoryCodec.decodeEntries(PayeeMemoryCodec.encodeEntries(e)))
        assertEquals("auto to office", PayeeMemoryCodec.noteWords("auto to office · Ramesh K", "Ramesh K", "HDFC XX1234"))
        assertNull(PayeeMemoryCodec.noteWords("Ramesh K · HDFC XX1234", "Ramesh K", "HDFC XX1234"))
        assertEquals("milk · extra", PayeeMemoryCodec.noteWords("milk · Ramesh K · extra", "Ramesh K", null))
    }

    @Test
    fun rememberedPayeeIsConfident() {
        val sms = ParsedSms(150.0, "expense", "UPI xxxxx3210", MerchantKey.of("UPI xxxxx3210"), "HDFC", "1234", null, true, payeeHash = "h1")
        assertEquals(Decision.Review(null), SmsCategoriser.decide(table, sms))
        val memory = RememberedPayee("transportation", "expense", "auto to office", 1L, null)
        assertEquals(Decision.AutoAdd(Placement("transportation", CategorySource.MEMORY)), SmsCategoriser.decide(table, sms, memory))
        // Memory beats the household's history for that payee.
        val swiggy = ParsedSms(150.0, "expense", "Swiggy", "swiggy", "HDFC", "1234", null, true)
        assertEquals(Decision.AutoAdd(Placement("gift", CategorySource.MEMORY)), SmsCategoriser.decide(table, swiggy, memory.copy(categoryId = "gift")))
        // Still needs money moved, a category that exists for the direction, and a signed-in phone.
        assertEquals(Decision.Review(Placement("transportation", CategorySource.MEMORY)), SmsCategoriser.decide(table, sms.copy(definite = false), memory))
        assertEquals(Decision.Review(null), SmsCategoriser.decide(table, sms, memory.copy(categoryId = "deleted")))
        assertEquals(Decision.Review(null), SmsCategoriser.decide(table, sms, memory.copy(type = "income")))
        val demo = CategoryTable.decode(tableJson.replace("\"firebase\"", "\"nofirebase\""))
        assertEquals(Decision.Review(Placement("transportation", CategorySource.MEMORY)), SmsCategoriser.decide(demo, sms, memory))
    }

    // ------------------------------------------------------------ evening catch-up

    private val ist: TimeZone = TimeZone.getTimeZone("Asia/Kolkata")

    private fun at(day: Int, hour: Int, minute: Int = 0): Long = Calendar.getInstance(ist).apply {
        clear()
        set(2026, Calendar.NOVEMBER, day, hour, minute)
    }.timeInMillis

    @Test
    fun catchUpRunsAt2030() {
        assertEquals(at(17, 20, 30), CatchUp.nextRun(at(17, 9), ist))
        assertEquals(at(18, 20, 30), CatchUp.nextRun(at(17, 20, 30), ist))
        assertEquals(at(18, 20, 30), CatchUp.nextRun(at(17, 22), ist))
        assertEquals("sms-catch-up-2026-11-17", CatchUp.workName(at(17, 20, 30), ist))
    }

    @Test
    fun catchUpDecision() {
        val now = at(17, 20, 31)
        val items = listOf(
            item().copy(id = "a", receivedAt = at(17, 9)),
            item().copy(id = "b", receivedAt = at(16, 13)),
            item(amount = null).copy(id = "c", receivedAt = at(17, 10)),
            item().copy(id = "d", receivedAt = at(5, 10)), // older than a week
        )
        assertEquals(2, CatchUp.count(true, true, true, items, now, ist, null))
        assertEquals(2, CatchUp.count(true, true, true, items, now, ist, "2026-11-16"))
        assertEquals(0, CatchUp.count(true, true, true, items, now, ist, "2026-11-17")) // once a day
        assertEquals(0, CatchUp.count(true, true, false, items, now, ist, null))
        assertEquals(0, CatchUp.count(true, false, true, items, now, ist, null))
        assertEquals(0, CatchUp.count(false, true, true, items, now, ist, null))
        assertEquals(0, CatchUp.count(true, true, true, emptyList(), now, ist, null))
        assertEquals(0, CatchUp.count(true, true, true, items, at(18, 2), ist, null)) // delayed to 2 am
        assertEquals(0, CatchUp.count(true, true, true, items, at(17, 19), ist, null))
    }

    // ------------------------------------------------------------ Nano status

    @Test
    fun nanoConstantsMatchTheLibrary() {
        assertEquals(FeatureStatus.UNAVAILABLE, NanoStatusMapper.FS_UNAVAILABLE)
        assertEquals(FeatureStatus.DOWNLOADABLE, NanoStatusMapper.FS_DOWNLOADABLE)
        assertEquals(FeatureStatus.DOWNLOADING, NanoStatusMapper.FS_DOWNLOADING)
        assertEquals(FeatureStatus.AVAILABLE, NanoStatusMapper.FS_AVAILABLE)
        assertEquals(GenAiException.ErrorCode.NOT_AVAILABLE, NanoStatusMapper.E_NOT_AVAILABLE)
        assertEquals(GenAiException.ErrorCode.BUSY, NanoStatusMapper.E_BUSY)
        assertEquals(GenAiException.ErrorCode.NOT_SUPPORTED, NanoStatusMapper.E_NOT_SUPPORTED)
        assertEquals(GenAiException.ErrorCode.PER_APP_BATTERY_USE_QUOTA_EXCEEDED, NanoStatusMapper.E_QUOTA)
        assertEquals(GenAiException.ErrorCode.BACKGROUND_USE_BLOCKED, NanoStatusMapper.E_BACKGROUND)
        assertEquals(GenAiException.ErrorCode.NOT_ENOUGH_DISK_SPACE, NanoStatusMapper.E_NO_SPACE)
        assertEquals(GenAiException.ErrorCode.NEEDS_SYSTEM_UPDATE, NanoStatusMapper.E_NEEDS_SYSTEM_UPDATE)
        assertEquals(GenAiException.ErrorCode.AICORE_INCOMPATIBLE, NanoStatusMapper.E_AICORE_INCOMPATIBLE)
    }

    @Test
    fun nanoStatusMapping() {
        val m = NanoStatusMapper
        assertEquals(NanoState(m.AVAILABLE), m.fromFeatureStatus(3, metered = true, aiCoreVersion = "1.0"))
        assertEquals(NanoState(m.DOWNLOADABLE), m.fromFeatureStatus(1, metered = false, aiCoreVersion = "1.0"))
        assertEquals(NanoState(m.WAITING_FOR_WIFI), m.fromFeatureStatus(1, metered = true, aiCoreVersion = "1.0"))
        assertEquals(NanoState(m.DOWNLOADING), m.fromFeatureStatus(2, metered = false, aiCoreVersion = "1.0"))
        assertEquals(NanoState(m.UNSUPPORTED, "AICore 1.0.2"), m.fromFeatureStatus(0, false, "1.0.2"))
        assertEquals(NanoState(m.UNSUPPORTED, "AICore not installed"), m.fromFeatureStatus(0, false, null))
        assertEquals(m.ERROR, m.fromFeatureStatus(7, false, null).status)

        assertEquals(NanoState(m.AICORE_UPDATE, "AICore 0.9"), m.fromException(604, 0, "0.9"))
        assertEquals(m.AICORE_UPDATE, m.fromException(-101, 0, "0.9").status)
        assertEquals(m.AICORE_UPDATE, m.fromException(0, 601, "0.9").status)
        assertEquals(NanoState(m.PREPARING, "AICore 606"), m.fromException(0, 606, "1.0"))
        assertEquals(m.UNSUPPORTED, m.fromException(8, 0, null).status)
        assertEquals(m.UNSUPPORTED, m.fromException(16, 0, "1.0").status)
        assertEquals(NanoState(m.NO_SPACE), m.fromException(501, 0, "1.0"))
        assertEquals(NanoState(m.BUSY, "code 9"), m.fromException(9, 0, "1.0"))
        assertEquals(NanoState(m.ERROR, "code 4/12"), m.fromException(4, 12, "1.0"))
        assertEquals(NanoState(m.ERROR, "code 0"), m.fromException(0, 0, "1.0"))
        // Never the exception message: it could echo a prompt.
        assertEquals(NanoState(m.ERROR, "IllegalStateException"), m.fromThrowable(IllegalStateException("Payee: Ramesh")))
        assertEquals(mapOf("status" to "busy", "code" to "code 9"), NanoState(m.BUSY, "code 9").toMap())
    }
}
