package ru.genesis.calendar.reminders

import java.time.*
import ru.genesis.calendar.data.LocalHabitWorkspace
import ru.genesis.calendar.domain.GenesisCalendar
import ru.genesis.calendar.domain.habits.HabitEngine
import ru.genesis.calendar.domain.habits.habitReminderOccurrences
import ru.genesis.calendar.domain.habits.habitIntervalMarks
import ru.genesis.calendar.domain.habits.HabitMeasurements
import ru.genesis.calendar.domain.habits.HabitPeriodGoals
import ru.genesis.calendar.domain.habits.HabitReminderTarget

internal data class PlannedHabitNotification(val date: LocalDate, val at: Instant, val kind: String,
    val habitId: String?, val title: String, val body: String, val target: HabitReminderTarget? = null,
    val primaryAction: String = "open") {
    val key get() = "$date/$kind/${habitId ?: "daily-goal"}/${at.toEpochMilli()}"
}

internal fun planHabitNotifications(workspace: LocalHabitWorkspace, today: LocalDate, now: Instant,
    zone: ZoneId, language: String, days: Int = 8, maxPerDay: Int = 128): List<PlannedHabitNotification> {
    val settings = workspace.settings.notifications
    if (!workspace.settings.enabled) return emptyList()
    val engine = HabitEngine(GenesisCalendar(zone))
    val goalSettings=habitReminderGoalSettings(workspace)
    val start = LocalTime.parse(settings.quietHoursStart)
    val end = LocalTime.parse(settings.quietHoursEnd)
    fun quiet(at: Instant): Boolean {
        val time = at.atZone(zone).toLocalTime()
        return if (start == end) false else if (start < end) time >= start && time < end else time >= start || time < end
    }
    val horizon=now.plusSeconds(days*86400L)
    return (-2 until days+2).flatMap { offset ->
        val date = today.plusDays(offset.toLong())
        val planned = workspace.habits.filter { runCatching { engine.isScheduled(it, date, workspace.completions) }.getOrDefault(false) }
        val completed = workspace.completions.filter { it.date == date && it.completed }.mapTo(hashSetOf()) { it.habitId }
        val candidates = planned.filter { it.reminder.enabled && it.id !in completed
            && !(it.reminder.syncToGoogleTasks && !it.reminder.googleTaskId.isNullOrBlank())
            && !(it.reminder.showInGoogleCalendar && !it.reminder.googleEventId.isNullOrBlank())
            && HabitPeriodGoals.progress(it, date, workspace.measurements, workspace.completions, now)?.completed != true }.flatMap { habit ->
            val marks = habitIntervalMarks(habit,workspace.completions.firstOrNull { it.habitId == habit.id && it.date == date })
            habitReminderOccurrences(habit,date).mapNotNull { (time, scheduled) ->
            val at = scheduled.toInstant()
            if (at <= now || at>=horizon || !habit.reminder.allowDuringQuietHours && quiet(at)
                || habit.reminder.timing != "custom" && habit.intervalSchedule?.completionMode == "each" && time.toString() in marks) return@mapNotNull null
            PlannedHabitNotification(date, at, "habit", habit.id, habit.title,
                habitNotificationBody(settings.tone, "habit", 1, language,
                    "$date:${habit.id}:${at.toEpochMilli()}", "«${habit.title}»"),
                HabitReminderTarget(habit.id, date, at, HabitMeasurements.rule(habit, date).id,
                    if (habit.reminder.timing != "custom" && habit.intervalSchedule?.completionMode == "each") time.toString() else null),
                if (HabitMeasurements.effective(HabitMeasurements.rule(habit, date)) != null || habit.qualityScale != "none"
                    || habit.intervalSchedule?.completionMode == "each" && habit.reminder.timing == "custom") "input" else "complete")
        } }.toMutableList()
        val goal=engine.dailyGoalForDate(workspace.habits,workspace.completions,workspace.goals,
            goalSettings.changes,goalSettings.rest,date,today,now.toString(),workspace.measurements)
        val remaining = (goal.targetCount-goal.completedCount).coerceAtLeast(0)
        val perfectRemaining = goal.scheduledCount-goal.completedCount
        if (settings.enabled && settings.motivational && goal.targetCount > 0 && goal.status !in setOf("rest","neutral","protected") && (remaining > 0 || perfectRemaining == 1)) {
            val at = date.atTime(LocalTime.parse(settings.dailyGoalTime)).atZone(zone).toInstant()
            if (at > now && at<horizon && !quiet(at)) candidates += PlannedHabitNotification(date, at, "goal", null,
                "GENESIS", habitNotificationBody(settings.tone, "goal", maxOf(remaining, perfectRemaining.takeIf { remaining == 0 } ?: 0),
                    language, "$date:goal"))
        }
        candidates
    }.groupBy { it.key }.values.map { same ->
        val first = same.first()
        if (same.map { it.target?.intervalTime }.distinct().size > 1)
            first.copy(target = first.target?.copy(intervalTime = null), primaryAction = "input") else first
    }.sortedBy { it.at }.groupBy { it.at.atZone(zone).toLocalDate() }.values
        .flatMap { it.take(maxPerDay.coerceIn(1, 128)) }.sortedBy { it.at }
}

internal fun planHabitNotifications(workspace: LocalHabitWorkspace, today: LocalDate, now: Instant,
    zone: ZoneId, english: Boolean, days: Int = 8): List<PlannedHabitNotification> =
    planHabitNotifications(workspace, today, now, zone, if (english) "en" else "ru", days)
