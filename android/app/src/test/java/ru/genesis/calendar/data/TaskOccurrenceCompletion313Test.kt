package ru.genesis.calendar.data

import java.time.LocalDate
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.domain.RecurrenceConfig

class TaskOccurrenceCompletion313Test {
    private val date = LocalDate.of(2026, 10, 30)
    private fun series(source: JSONObject) = LocalTask(id = "series313", title = "Серия",
        date = date.toString(), revision = 7, sourceFieldsJson = source.toString(),
        recurrence = RecurrenceConfig(enabled = true, mode = "classic", pattern = "daily",
            rangeStart = date.toString(), rangeEnd = date.plusDays(2).toString()))

    @Test fun missingAndMalformedImportedEndDatesProduceOneDayOccurrences() {
        listOf(JSONObject(), JSONObject().put("endDate", JSONObject.NULL),
            JSONObject().put("endDate", "not-a-date"),
            JSONObject().put("endDate", date.minusDays(1).toString())).forEach { source ->
            val draft = TaskOccurrences.standaloneDraft(series(source), date.plusDays(1).toString())
            assertEquals(date.plusDays(1).toString(), JSONObject(draft.sourceFieldsJson).getString("endDate"))
            assertEquals(date.plusDays(1).toString(), JSONObject(draft.json()).getString("endDate"))
            assertFalse(draft.recurrence.enabled)
            assertEquals(7, JSONObject(draft.sourceFieldsJson).getInt("mindmapOccurrenceParentRevision"))
        }
    }

    @Test fun aValidDurationAndUnknownMetadataSurviveOccurrenceExtraction() {
        val source = JSONObject().put("endDate", date.plusDays(3).toString())
            .put("importedMetadata", JSONObject().put("keep", true))
            .put("googleEventId", "remote-event").put("googleTaskId", "remote-task")
            .put("googleLinks", JSONObject().put("remote", "link"))
        val draft = TaskOccurrences.standaloneDraft(series(source), date.plusDays(1).toString())
        val json = JSONObject(draft.sourceFieldsJson)
        assertEquals(date.plusDays(4).toString(), json.getString("endDate"))
        assertEquals(date.plusDays(4).toString(), JSONObject(draft.json()).getString("endDate"))
        assertTrue(json.getJSONObject("importedMetadata").getBoolean("keep"))
        assertFalse(json.has("googleEventId"))
        assertFalse(json.has("googleTaskId"))
        assertEquals(0, json.getJSONObject("googleLinks").length())
    }

    @Test fun theOccurrenceIdentifierIsStableAcrossRetry() {
        val task = series(JSONObject())
        assertEquals(TaskOccurrences.standaloneDraft(task, date.toString()).id,
            TaskOccurrences.standaloneDraft(task, date.toString()).id)
        assertNotEquals(TaskOccurrences.standaloneDraft(task, date.toString()).id,
            TaskOccurrences.standaloneDraft(task, date.plusDays(1).toString()).id)
    }
}
