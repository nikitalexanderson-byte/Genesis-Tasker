package ru.genesis.calendar.data

import java.time.LocalDate
import org.junit.Assert.*
import org.junit.Test
import org.json.JSONObject
import ru.genesis.calendar.domain.RecurrenceConfig

class TaskOccurrencesTest {
    @Test fun oneStoredTaskProjectsAcrossDatesAndHonorsExclusions() {
        val task = LocalTask(id = "series", title = "Ритм", date = "2026-09-24",
            recurrence = RecurrenceConfig(true, "classic", "daily", listOf(1), 1,
                "2026-09-24", "2026-09-26"), recurrenceExcludedDates = listOf("2026-09-25"))
        assertTrue(TaskOccurrences.occursOn(task, LocalDate.parse("2026-09-24")))
        assertFalse(TaskOccurrences.occursOn(task, LocalDate.parse("2026-09-25")))
        assertTrue(TaskOccurrences.occursOn(task, LocalDate.parse("2026-09-26")))
        val days = TaskOccurrences.byDate(listOf(task), LocalDate.parse("2026-09-24"), LocalDate.parse("2026-09-26"))
        assertEquals(listOf("2026-09-24", "2026-09-26"), days.keys.toList())
        assertEquals(2, TaskOccurrences.countInRange(listOf(task), LocalDate.parse("2026-09-24"), LocalDate.parse("2026-09-26")))
    }

    @Test fun disabledRecurrenceRemainsOneTaskRegardlessOfRuleFields() {
        val task = LocalTask(title = "Одна", date = "2026-09-24",
            recurrence = RecurrenceConfig(false, "classic", "daily", listOf(1), 1,
                "2026-09-24", "2026-09-26"))
        assertTrue(TaskOccurrences.occursOn(task, LocalDate.parse("2026-09-24")))
        assertFalse(TaskOccurrences.occursOn(task, LocalDate.parse("2026-09-25")))
    }

    @Test fun nativeEditsRetainUnknownWebTaskFieldsAndRecurrence() {
        val web = """{"id":"series","title":"Старая","dueDate":"2026-09-24","time":"", "zoneId":"Europe/Moscow", "priority":5,"reminderAt":null,"recurrenceMode":"classic","recurrencePattern":"daily","recurrenceDays":[1],"recurrenceInterval":1,"recurrenceStartDate":"2026-09-24","recurrenceEndDate":"2026-09-26","recurrenceExcludedDates":["2026-09-25"],"tags":["ритм"],"googleLinks":{"account":"fixture"},"futureField":{"keep":true}}"""
        val local = LocalTask.from(TaskRecord("local", "series", "ciphertext", 2, false), web)
        val saved = JSONObject(local.copy(title = "Новое").json())
        assertEquals("Новое", saved.getString("title"))
        assertEquals("classic", saved.getString("recurrenceMode"))
        assertEquals("2026-09-25", saved.getJSONArray("recurrenceExcludedDates").getString(0))
        assertEquals("ритм", saved.getJSONArray("tags").getString(0))
        assertEquals("fixture", saved.getJSONObject("googleLinks").getString("account"))
        assertTrue(saved.getJSONObject("futureField").getBoolean("keep"))
        val explicitlyDisabled = JSONObject(web).put("recurrenceMode", "none")
            .put("recurrence", "daily").toString()
        assertFalse(LocalTask.from(TaskRecord("local", "series", "ciphertext", 2, false),
            explicitlyDisabled).recurrence.enabled)
    }

    @Test fun excludingOneDayKeepsOtherOccurrencesAndMovesFirstAnchor() {
        val original = LocalTask(id = "series", title = "Три дня", date = "2026-09-24",
            reminderAt = 10_000L, recurrence = RecurrenceConfig(true, "classic", "daily", listOf(1), 1,
                "2026-09-24", "2026-09-26"))
        val middleRemoved = TaskOccurrences.withoutDate(original, "2026-09-25")!!
        assertEquals("2026-09-24", middleRemoved.date)
        assertFalse(TaskOccurrences.occursOn(middleRemoved, LocalDate.parse("2026-09-25")))
        assertTrue(TaskOccurrences.occursOn(middleRemoved, LocalDate.parse("2026-09-26")))
        val firstRemoved = TaskOccurrences.withoutDate(original, "2026-09-24")!!
        assertEquals("2026-09-25", firstRemoved.date)
        assertNull(firstRemoved.reminderAt)
        assertTrue(TaskOccurrences.occursOn(firstRemoved, LocalDate.parse("2026-09-26")))
        assertNull(TaskOccurrences.withoutDate(
            TaskOccurrences.withoutDate(firstRemoved, "2026-09-25")!!, "2026-09-26"))
    }
}
