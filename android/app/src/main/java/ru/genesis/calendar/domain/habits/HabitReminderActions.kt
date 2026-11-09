package ru.genesis.calendar.domain.habits

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import ru.genesis.calendar.domain.GenesisCalendar

/** A notification always addresses its original practice day and rule, never an implicit "today". */
data class HabitReminderTarget(val habitId: String, val date: LocalDate, val at: Instant,
    val ruleId: String, val intervalTime: String? = null) {
    init {
        require(habitId.length in 1..256 && ruleId.length in 1..256)
        require(intervalTime == null || Regex("(?:[01]\\d|2[0-3]):[0-5]\\d").matches(intervalTime))
    }
    val operationKey get() = "habit-reminder:$habitId:$date:${at.toEpochMilli()}"
}

/** Evaluated again inside the durable repository transaction before a quick action can write. */
fun habitReminderAction(habit: Habit?, target: HabitReminderTarget, completions: List<HabitCompletion>,
    measurements: List<HabitMeasurementEvent>, now: Instant = Instant.now()): String {
    if (habit == null || habit.id != target.habitId || !habit.active) return "unavailable"
    val rule = HabitMeasurements.rule(habit, target.date)
    val today = now.atZone(ZoneId.of(rule.schedule.timezone)).toLocalDate()
    if (target.date != today || target.at > now.plusSeconds(1)) return "stale"
    val engine = HabitEngine(GenesisCalendar(ZoneId.of(rule.schedule.timezone)))
    if (rule.id != target.ruleId || HabitRuleHistory.state(habit, target.date).conflicts.isNotEmpty()
        || !engine.isScheduled(habit, target.date, completions)) return "stale"
    if (habitReminderOccurrences(habit, target.date).none { (time, at) -> at.toInstant() == target.at
            && (target.intervalTime == null || time.toString() == target.intervalTime) }) return "stale"
    val entry = completions.firstOrNull { it.habitId == habit.id && it.date == target.date }
    if (entry?.completed == true || HabitPeriodGoals.progress(habit, target.date, measurements, completions, now)?.completed == true)
        return "completed"
    if (HabitMeasurements.effective(rule) != null || habit.qualityScale != "none") return "input"
    if (habit.intervalSchedule?.completionMode == "each") {
        if (target.intervalTime == null || habit.reminder.timing == "custom"
            || target.intervalTime !in habit.intervalSchedule.times()) return "input"
        return if (target.intervalTime in habitIntervalMarks(habit, entry)) "completed" else "interval"
    }
    return "complete"
}
