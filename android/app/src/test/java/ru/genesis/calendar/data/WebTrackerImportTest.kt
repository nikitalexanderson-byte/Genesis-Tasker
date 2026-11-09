package ru.genesis.calendar.data

import java.time.LocalTime
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/** The web schema uses empty strings for optional sleep times, even at schema 16. */
class WebTrackerImportTest {
    private fun entry(id: String, bed: Any?, wake: Any?) = JSONObject()
        .put("id", id).put("createdAt", "2026-09-20T10:00:00Z").put("updatedAt", "2026-09-20T10:00:00Z")
        .put("version", 1).put("syncState", "synced").put("planId", "plan-1").put("date", "2026-09-20")
        .put("fellAsleepAt", bed).put("wokeAt", wake).put("durationMinutes", 0)
        .put("quality", 7).put("deviationMinutes", 0).put("note", "Preserve this note").put("score", 0)

    private fun document(rows: JSONArray) = JSONObject().put("localSchema", 1)
        .put("sleepPlans", JSONArray()).put("sleepEntries", rows).put("moodEntries", JSONArray()).toString()

    @Test fun acceptsWebEmptyNullMissingAndPartialSleepTimesWithoutLosingEntries() {
        val rows = JSONArray().put(entry("empty", "", ""))
            .put(entry("null", JSONObject.NULL, JSONObject.NULL)).put(entry("missing", null, null))
            .put(entry("bed-only", "23:15", "")).put(entry("wake-only", "", "07:30"))
            .put(entry("complete", "23:00", "07:00"))
        val decoded = TrackersDocument.decode(document(rows), 1_000_000_199)
        assertEquals(6, decoded.sleepEntries.size)
        decoded.sleepEntries.take(3).forEach {
            assertNull(it.fellAsleepAt)
            assertNull(it.wokeAt)
            assertEquals(7, it.quality)
            assertEquals("Preserve this note", it.note)
        }
        assertEquals(LocalTime.of(23, 15), decoded.sleepEntries[3].fellAsleepAt)
        assertNull(decoded.sleepEntries[3].wokeAt)
        assertEquals(LocalTime.of(7, 30), decoded.sleepEntries[4].wokeAt)
        val encoded = JSONObject(TrackersDocument.encode(decoded)).getJSONArray("sleepEntries")
        assertEquals("", encoded.getJSONObject(0).getString("fellAsleepAt"))
        assertEquals("", encoded.getJSONObject(0).getString("wokeAt"))
        assertEquals(decoded, TrackersDocument.decode(TrackersDocument.encode(decoded), decoded.revision))
    }

    @Test fun stillRejectsMalformedNonemptyTimeInsteadOfDiscardingTheRecord() {
        assertThrows(java.time.format.DateTimeParseException::class.java) {
            TrackersDocument.decode(document(JSONArray().put(entry("invalid", "25:99", ""))), 1)
        }
    }
}
