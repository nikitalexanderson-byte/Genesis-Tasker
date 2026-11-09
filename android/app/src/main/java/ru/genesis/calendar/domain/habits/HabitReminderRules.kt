package ru.genesis.calendar.domain.habits

import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime

fun habitReminderTime(habit: Habit): LocalTime? = runCatching {
    LocalTime.parse(if(habit.reminder.timing != "custom" && habit.intervalSchedule != null) habit.intervalSchedule.startTime
        else if (habit.reminder.timing != "custom" && habit.preferredTime.isNotBlank())
        habit.preferredTime else habit.reminder.time)
}.getOrNull()

fun habitReminderTimes(habit: Habit): List<LocalTime> = if(habit.reminder.timing != "custom" && habit.intervalSchedule != null)
    habit.intervalSchedule.times().map(LocalTime::parse) else listOfNotNull(habitReminderTime(habit))

fun habitReminderOccurrences(habit: Habit, date: LocalDate): List<Pair<LocalTime, ZonedDateTime>> =
    habitReminderTimes(habit).mapNotNull { time -> runCatching { time to date.atTime(time)
        .atZone(ZoneId.of(HabitMeasurements.rule(habit, date).schedule.timezone)).minusMinutes(habit.reminder.minutesBefore.coerceIn(0,1440).toLong()) }.getOrNull() }

fun habitReminderAt(habit: Habit, date: LocalDate): ZonedDateTime? = habitReminderTime(habit)?.let { time ->
    runCatching { date.atTime(time).atZone(ZoneId.of(HabitMeasurements.rule(habit, date).schedule.timezone))
        .minusMinutes(habit.reminder.minutesBefore.coerceIn(0, 1440).toLong()) }.getOrNull()
}
