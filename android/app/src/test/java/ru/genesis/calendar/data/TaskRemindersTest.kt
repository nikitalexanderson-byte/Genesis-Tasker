package ru.genesis.calendar.data

import java.time.Instant
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.domain.RecurrenceConfig

class TaskRemindersTest {
    @Test fun relativeLabelsUseDaysHoursMinutesAndTheirCorrectPluralForms() {
        assertEquals("За 1 день до задачи", formatRelativeTaskReminder(1440))
        assertEquals("За 3 дня до задачи", formatRelativeTaskReminder(4320))
        assertEquals("За 5 дней до задачи", formatRelativeTaskReminder(7200))
        assertEquals("За 2 часа до задачи", formatRelativeTaskReminder(120))
        assertEquals("За 30 минут до задачи", formatRelativeTaskReminder(30))
        assertEquals("3 days before the task", formatRelativeTaskReminder(4320, "en"))
    }
    @Test fun importsFiveWebRemindersAndKeepsThemWhenEditingTitle() {
        val specs = JSONArray().put(JSONObject().put("kind", "relative").put("minutes", 10))
            .put(JSONObject().put("kind", "relative").put("minutes", 30))
            .put(JSONObject().put("kind", "relative").put("minutes", 60))
            .put(JSONObject().put("kind", "relative").put("minutes", 1440))
            .put(JSONObject().put("kind", "absolute").put("at", "2026-09-24T09:00:00Z"))
        val source = JSONObject().put("title", "До").put("dueDate", "2026-09-25")
            .put("time", "12:00").put("zoneId", "UTC").put("priority", 5)
            .put("reminders", specs).put("webOnly", "preserved")
        val task = LocalTask.from(TaskRecord("fixture", "one", "", 1, false), source.toString())
        assertEquals(5, task.reminders!!.size)
        val saved = JSONObject(task.copy(title = "После").json())
        assertEquals(5, saved.getJSONArray("reminders").length())
        assertEquals("preserved", saved.getString("webOnly"))
        assertEquals(10, saved.getInt("reminderMinutes"))
        assertEquals(Instant.parse("2026-09-24T09:00:00Z").toEpochMilli(), saved.getLong("reminderAt"))
        assertEquals(5, TaskReminderPlan.times(task).size)
    }

    @Test fun relativeRemindersFollowEachNonExcludedOccurrenceAndAbsoluteOnlyOriginal() {
        val task = LocalTask(title = "Серия", date = "2026-09-24", time = "12:00", zoneId = "UTC",
            recurrence = RecurrenceConfig(true, "classic", "daily", listOf(1), 1,
                "2026-09-24", "2026-09-26"), recurrenceExcludedDates = listOf("2026-09-25"),
            reminders = listOf(TaskReminder.relative(60), TaskReminder.absolute(
                Instant.parse("2026-09-24T09:00:00Z").toEpochMilli())))
        val rows = TaskReminderPlan.times(task)
        assertEquals(3, rows.size)
        assertEquals(listOf("2026-09-24:0", "2026-09-24:1", "2026-09-26:0"), rows.map { it.first })
        assertEquals(Instant.parse("2026-09-26T11:00:00Z").toEpochMilli(), rows.last().second)
    }

    @Test fun invalidAndDuplicateWebEntriesAreIgnored() {
        val source = JSONObject().put("reminders", JSONArray()
            .put(JSONObject().put("kind", "relative").put("minutes", 10))
            .put(JSONObject().put("kind", "relative").put("minutes", 10))
            .put(JSONObject().put("kind", "relative").put("minutes", 40_321))
            .put(JSONObject().put("kind", "absolute").put("at", "not-a-date")))
        assertEquals(listOf(TaskReminder.relative(10)), TaskReminder.from(source))
    }

    @Test fun undatedGoogleInboxTaskDoesNotAbortReminderImport() {
        val task = LocalTask(title = "Google inbox", date = "", reminders = listOf(TaskReminder.relative(30)))
        assertTrue(TaskReminderPlan.times(task).isEmpty())
    }
}
