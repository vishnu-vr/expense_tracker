package com.vapps.track_expense

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** D-031: only fully automatic saves carry `autoAdded: true`. */
class AutoAddedMarkerTest {
    private val table = CategoryTable.decode(
        """
        {
          "homeId": "h1", "userId": "u1", "userEmail": "a@example.com",
          "firebase": {"apiKey": "k", "appId": "a", "projectId": "p", "messagingSenderId": "1"},
          "history": {}, "builtin": [],
          "categories": [{"id": "food", "name": "Food", "type": "expense"}]
        }
        """.trimIndent(),
    )

    private fun fields(save: SmsSave) =
        SmsEntryWriter.fields(table, 1499.0, "expense", "food", "Swiggy · HDFC XX1234", save)

    @Test
    fun autoAddMarksTheEntry() {
        val f = fields(SmsSave.AUTO_ADD)
        assertEquals(true, f["autoAdded"])
        assertEquals("sms", f["source"])
        assertEquals("u1", f["userId"])
        assertEquals("h1", f["homeId"])
        assertEquals(emptyList<String>(), f["tagIds"])
    }

    @Test
    fun notificationAnswersAreUserConfirmed() {
        val f = fields(SmsSave.NOTIFICATION_ANSWER)
        assertFalse(f.containsKey("autoAdded"))
        assertEquals("sms", f["source"])
    }

    @Test
    fun onlyAutoAddIsAutomatic() {
        assertTrue(SmsSave.AUTO_ADD.autoAdded)
        assertEquals(listOf(SmsSave.AUTO_ADD), SmsSave.entries.filter { it.autoAdded })
    }

    @Test
    fun timestampsAreLeftToTheWriter() {
        val f = fields(SmsSave.AUTO_ADD)
        assertFalse(f.containsKey("date"))
        assertFalse(f.containsKey("createdAt"))
    }
}
