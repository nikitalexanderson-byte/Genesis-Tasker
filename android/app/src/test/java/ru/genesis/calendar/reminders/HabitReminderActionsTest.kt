package ru.genesis.calendar.reminders

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.data.*
import ru.genesis.calendar.domain.*
import ru.genesis.calendar.domain.habits.*

class HabitReminderActionsTest {
    private val zone = ZoneId.of("UTC")
    private val date = LocalDate.of(2026, 10, 17)
    private val before = Instant.parse("2026-10-17T08:00:00Z")
    private val now = Instant.parse("2026-10-17T09:01:00Z")
    private val engine = HabitEngine(GenesisCalendar(zone))
    private fun habit(id: String = "reading") = Habit(TrackerEntity.create("habit", id = id), "Synthetic habit", date.minusDays(1),
        engine.defaultSchedule(date.minusDays(1), CalendarMode.PROFANE), reminder = HabitReminder(true, "09:00"))
    private fun workspace(vararg habits: Habit) = LocalHabitWorkspace(habits = habits.toList(),
        settings = HabitSettings(notifications = HabitNotificationSettings(enabled = false, motivational = false)))
    private fun target(habit: Habit) = planHabitNotifications(workspace(habit), date, before, zone, "de", 1).first().target!!

    @Test fun exactDayAndRuleAreRequiredAndChangingDeviceTimeZoneCannotTurnYesterdayIntoToday() {
        val habit = habit(); val target = target(habit)
        assertEquals("complete", habitReminderAction(habit, target, emptyList(), emptyList(), now))
        assertEquals("stale", habitReminderAction(habit, target, emptyList(), emptyList(), now.plusSeconds(86400)))
        assertEquals("stale", habitReminderAction(habit, target, emptyList(), emptyList(), before))
        assertEquals("unavailable", habitReminderAction(habit.copy(active = false), target, emptyList(), emptyList(), now))
        val root = HabitMeasurements.rule(habit, date)
        val changed = habit.copy(ruleHistory = listOf(root, root.copy(id = "new-rule", effectiveDate = date,
            recordedAt = "2026-10-17T08:30:00Z", supersedes = listOf(root.id))))
        assertEquals("stale", habitReminderAction(changed, target, emptyList(), emptyList(), now))
        val originalZone = java.util.TimeZone.getDefault()
        try {
            java.util.TimeZone.setDefault(java.util.TimeZone.getTimeZone("Pacific/Honolulu"))
            assertEquals("complete", habitReminderAction(habit, target, emptyList(), emptyList(), now))
        } finally { java.util.TimeZone.setDefault(originalZone) }
    }

    @Test fun quantityDurationAndQualityRequireInputInsteadOfAnImplicitCompletion() {
        for (kind in listOf("quantity", "duration")) {
            val habit = habit().copy(measurement = HabitMeasurement(kind, if (kind == "duration") "min" else "pages", 10_000, 1000))
            val candidate = planHabitNotifications(workspace(habit), date, before, zone, "ja", 1).single()
            assertEquals("input", candidate.primaryAction)
            assertEquals("input", habitReminderAction(habit, candidate.target!!, emptyList(), emptyList(), now))
        }
        val quality = habit().copy(scoringMode = "quality-ten", qualityScale = "ten")
        assertEquals("input", habitReminderAction(quality, target(quality), emptyList(), emptyList(), now))
        val habit = habit(); val completed = engine.updateCompletion(emptyList(), habit, date, date, true, null, "")
        assertEquals("completed", habitReminderAction(habit, target(habit), completed, emptyList(), now))
    }

    @Test fun intervalActionsAddressOneSlotAndNeverCompleteAllOccurrences() {
        val habit = habit().copy(intervalSchedule = HabitIntervalSchedule(30, "09:00", "10:00", "each"))
        val target = target(habit)
        assertEquals("09:00", target.intervalTime)
        assertEquals("interval", habitReminderAction(habit, target, emptyList(), emptyList(), now))
        val marked = engine.updateIntervalCompletion(emptyList(), habit, date, date, "09:00", true)
        assertFalse(marked.single().completed)
        assertEquals("completed", habitReminderAction(habit, target, marked, emptyList(), now))
        val custom = habit.copy(reminder = habit.reminder.copy(timing = "custom"))
        assertEquals("input", habitReminderAction(custom, target(custom), emptyList(), emptyList(), now))
    }

    @Test fun completedPeriodAndGoogleMirrorsAreSuppressedAndDailyLimitKeepsIndividualRemindersIndependent() {
        val habit = habit()
        assertEquals(1, planHabitNotifications(workspace(habit), date, before, zone, "uk", 1).size)
        val google = habit.copy(reminder = habit.reminder.copy(syncToGoogleTasks = true, googleTaskId = "google-task"))
        assertTrue(planHabitNotifications(workspace(google), date, before, zone, "uk", 1).isEmpty())
        val periodic = habit.copy(measurement = HabitMeasurement("quantity", "pages", 1000, 1000),
            periodGoal = HabitPeriodGoal(period = "week", metric = "entries", target = 1, calendar = "profane",
                context = CalendarContext(timeZone = "UTC")))
        val events = HabitMeasurements.append(periodic, date, 1000, emptyList(), operationId = "reading-entry",
            timestamp = "2026-10-17T08:30:00Z")
        assertTrue(planHabitNotifications(workspace(periodic).copy(measurements = events), date, before, zone, "uk", 1).isEmpty())
        val many = workspace(*(0..7).map { habit("habit-$it") }.toTypedArray())
        assertEquals(4, planHabitNotifications(many, date, before, zone, "fr", 1, maxPerDay = 4).size)
    }
}
