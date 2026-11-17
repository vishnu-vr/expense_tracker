package com.vapps.track_expense

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class AutoAddLogicTest {
    // ------------------------------------------------------------ merchant key

    @Test
    fun merchantKeyMatchesSharedVectors() {
        // Same file as the Dart test: both sides must normalise alike.
        val file = File("../../test/fixtures/merchant_key_vectors.json")
        val vectors = JSONObject(file.readText()).getJSONArray("vectors")
        assertTrue(vectors.length() >= 10)
        for (i in 0 until vectors.length()) {
            val v = vectors.getJSONArray(i)
            val expected = if (v.isNull(1)) null else v.getString(1)
            assertEquals("vector ${v.getString(0)}", expected, MerchantKey.of(v.getString(0)))
        }
        assertNull(MerchantKey.of(null))
    }

    // ------------------------------------------------------------ table + rule

    private val tableJson = """
        {
          "homeId": "h1", "userId": "u1", "userEmail": "a@example.com",
          "firebase": {"apiKey": "k", "appId": "a", "projectId": "p", "messagingSenderId": "1", "storageBucket": "b"},
          "history": {"expense:chai point": "food", "expense:swiggy": "shopping", "income:acme corp salary": "salary"},
          "builtin": [
            {"p": "\\b(swiggy|swgy)\\b", "m": "swiggy", "c": "food"},
            {"p": "\\b(uber|ubr)\\b", "m": "uber", "c": "transportation"},
            {"p": "\\b(paytm)\\b", "m": "paytm"}
          ],
          "categories": [
            {"id": "food", "name": "Food", "type": "expense"},
            {"id": "shopping", "name": "Shopping", "type": "expense"},
            {"id": "transportation", "name": "Transportation", "type": "expense"},
            {"id": "salary", "name": "Salary", "type": "income"}
          ]
        }
    """.trimIndent()

    private fun sms(merchant: String?, type: String = "expense", amount: Double? = 100.0, definite: Boolean = true) =
        ParsedSms(amount, type, merchant, MerchantKey.of(merchant), "HDFC", "1234", null, definite)

    @Test
    fun historyWinsOverBuiltin() {
        val t = CategoryTable.decode(tableJson)
        assertTrue(t.canWrite)
        // The household files Swiggy under Shopping: that beats the built-in Food.
        assertEquals(Decision.AutoAdd(Placement("shopping", CategorySource.HISTORY)), SmsCategoriser.decide(t, sms("SWIGGY")))
        assertEquals(Decision.AutoAdd(Placement("food", CategorySource.HISTORY)), SmsCategoriser.decide(t, sms("Chai Point")))
        assertEquals(
            Decision.AutoAdd(Placement("salary", CategorySource.HISTORY)),
            SmsCategoriser.decide(t, sms("Acme Corp-Salary", type = "income")),
        )
    }

    @Test
    fun builtinCanonicalAndDefault() {
        val t = CategoryTable.decode(tableJson)
        // "swiggy instamart" has no history of its own; the canonical Swiggy's history applies.
        assertEquals(Placement("shopping", CategorySource.HISTORY), SmsCategoriser.place(t, sms("Swiggy Instamart")))
        assertEquals(Decision.AutoAdd(Placement("transportation", CategorySource.BUILTIN)), SmsCategoriser.decide(t, sms("UBER INDIA")))
    }

    @Test
    fun unsureGoesToReview() {
        val t = CategoryTable.decode(tableJson)
        assertEquals(Decision.Review(null), SmsCategoriser.decide(t, sms("Ramesh Stores")))
        assertEquals(Decision.Review(null), SmsCategoriser.decide(t, sms(null)))
        // A payment app has no default category.
        assertEquals(Decision.Review(null), SmsCategoriser.decide(t, sms("paytm")))
        // Wrong direction: Swiggy as income is not placed.
        assertEquals(Decision.Review(null), SmsCategoriser.decide(t, sms("Swiggy", type = "income")))
        // Not a definite transaction, or no amount: suggestion kept, still review.
        assertEquals(Decision.Review(Placement("transportation", CategorySource.BUILTIN)), SmsCategoriser.decide(t, sms("Uber", definite = false)))
        assertEquals(Decision.Review(Placement("transportation", CategorySource.BUILTIN)), SmsCategoriser.decide(t, sms("Uber", amount = null)))
    }

    @Test
    fun notSignedInMeansReview() {
        val demo = CategoryTable.decode(JSONObject(tableJson).apply { remove("firebase") }.toString())
        assertFalse(demo.canWrite)
        assertEquals(Decision.Review(Placement("transportation", CategorySource.BUILTIN)), SmsCategoriser.decide(demo, sms("Uber")))
        assertEquals(CategoryTable.EMPTY, CategoryTable.decode("not json"))
        assertEquals(CategoryTable.EMPTY, CategoryTable.decode(null))
    }

    // ------------------------------------------------------------ dedupe

    @Test
    fun seenLogDropsRepeatsForSevenDays() {
        val p = sms("Swiggy").copy(refHash = "abc")
        val t0 = 1_700_000_000_000L
        val keys = SeenLog.keysFor(p, t0)
        var (dup, log) = SeenLog.checkAndAdd(emptyMap(), keys, t0)
        assertFalse(dup)
        // Same UPI reference in a second message an hour later (e.g. bank + UPI app).
        val again = SeenLog.checkAndAdd(log, SeenLog.keysFor(p, t0 + 3_600_000), t0 + 3_600_000)
        assertTrue(again.first)
        log = again.second
        // After 7 days it is forgotten.
        val later = t0 + SeenLog.WINDOW_MS + 7_200_000
        assertFalse(SeenLog.checkAndAdd(log, SeenLog.keysFor(p, later), later).first)
        // Round trip through the stored string.
        assertEquals(log, SeenLog.decode(SeenLog.encode(log)))
        // No reference: the same SMS (same timestamp) is still caught by the fingerprint.
        val noRef = sms("Swiggy")
        val first = SeenLog.checkAndAdd(emptyMap(), SeenLog.keysFor(noRef, t0), t0)
        assertTrue(SeenLog.checkAndAdd(first.second, SeenLog.keysFor(noRef, t0), t0 + 5_000).first)
        dup = SeenLog.checkAndAdd(first.second, SeenLog.keysFor(noRef.copy(amount = 101.0), t0), t0 + 5_000).first
        assertFalse(dup)
    }

    @Test
    fun duplicateOfSavedEntry() {
        val t0 = 1_700_000_000_000L
        val p = sms("Swiggy", amount = 1499.0)
        val saved = listOf(SavedEntry("u1", "expense", 1499.0, t0 + 10 * 60_000))
        assertTrue(DuplicateCheck.isDuplicate(saved, "u1", p, t0))
        assertFalse(DuplicateCheck.isDuplicate(saved, "u2", p, t0)) // a housemate's entry
        assertFalse(DuplicateCheck.isDuplicate(saved, "u1", p.copy(type = "income"), t0))
        assertFalse(DuplicateCheck.isDuplicate(saved, "u1", p.copy(amount = 1500.0), t0))
        assertFalse(DuplicateCheck.isDuplicate(saved, "u1", p, t0 - 6 * 60_000)) // 16 minutes apart
        assertFalse(DuplicateCheck.isDuplicate(saved, "u1", p.copy(amount = null), t0))
    }

    // ------------------------------------------------------------ review queue

    @Test
    fun reviewQueueLimits() {
        val now = 1_700_000_000_000L
        val day = 24L * 60 * 60 * 1000
        var items = emptyList<ReviewItem>()
        for (i in 0 until 120) {
            items = ReviewQueueCodec.add(items, ReviewItem("r$i", 10.0 + i, "expense", "M$i", "HDFC XX1234", now - i * 60_000, null, null), now)
        }
        assertEquals(100, items.size)
        assertEquals("r0", items.first().id) // newest first
        val old = ReviewItem("old", 5.0, "expense", null, null, now - 31 * day, null, null)
        assertFalse(ReviewQueueCodec.add(items, old, now).any { it.id == "old" })

        val round = ReviewQueueCodec.decode(ReviewQueueCodec.encode(items.take(3)))
        assertEquals(items.take(3), round)
        assertEquals(2, ReviewQueueCodec.remove(round, "r1").size)
        val updated = ReviewQueueCodec.update(round, "r2", "food", "nano")
        assertEquals("food", updated.first { it.id == "r2" }.categoryId)
        assertEquals(emptyList<ReviewItem>(), ReviewQueueCodec.decode("garbage"))
    }

    @Test
    fun reviewItemKeepsParsedFieldsOnly() {
        val p = SmsParser.parseDetails("AD-HDFCBK", "Rs.1,499.00 debited from A/c XX1234 to VPA swiggy@icici (UPI Ref No 123456789012).")!!
        val json = ReviewItem.from(p, 1_700_000_000_000L, Placement("food", CategorySource.BUILTIN)).toJson().toString()
        assertFalse(json.contains("debited"))
        assertFalse(json.contains("123456789012"))
        assertTrue(json.contains("Swiggy"))
        assertTrue(json.contains("HDFC XX1234"))
    }

    // ------------------------------------------------------------ nano

    private val cats = listOf(
        CategoryOption("food", "Food", "expense"),
        CategoryOption("grocery", "Grocery", "expense"),
        CategoryOption("salary", "Salary", "income"),
    )

    @Test
    fun nanoPromptListsOnlyMatchingCategories() {
        val prompt = NanoPrompt.build("Ramesh Stores", "expense", cats)
        assertTrue(prompt.contains("food, grocery"))
        assertFalse(prompt.contains("salary"))
        assertTrue(prompt.contains("Ramesh Stores"))
    }

    @Test
    fun nanoAnswerMustBeAListedId() {
        assertEquals("grocery", NanoPrompt.parse(" Grocery.\n", "expense", cats))
        assertEquals("food", NanoPrompt.parse("\"food\"", "expense", cats))
        assertEquals("food", NanoPrompt.parse("Category: food", "expense", cats))
        assertNull(NanoPrompt.parse("none", "expense", cats))
        assertNull(NanoPrompt.parse("salary", "expense", cats)) // wrong direction
        assertNull(NanoPrompt.parse("I think it is food", "expense", cats))
        assertNull(NanoPrompt.parse(null, "expense", cats))
    }

    @Test
    fun unsupportedNanoNeverAnswers() = kotlinx.coroutines.runBlocking {
        assertEquals(NanoState(NanoStatusMapper.ANDROID_TOO_OLD), UnsupportedNano.status())
        assertNull(UnsupportedNano.categorise("Swiggy", "expense", cats))
    }

    @Test
    fun workerDataRoundTrip() {
        val p = SmsParser.parseDetails("AD-HDFCBK", "Rs.1,499.00 debited from A/c XX1234 to VPA swiggy@icici (UPI Ref No 123456789012).")!!
        val hashed = p.withHashedPayee("salt")
        val data = SmsAutoAddWorker.toData(hashed, 1_700_000_000_000L)
        assertEquals(hashed, SmsAutoAddWorker.fromData(data))
        // The payee travels only as its salted hash.
        assertNull(hashed.payeeKey)
        assertFalse(data.keyValueMap.values.any { it.toString().contains("swiggy@icici") })
        // Only parsed fields travel to the worker.
        assertFalse(data.keyValueMap.values.any { it.toString().contains("debited") })
    }
}
