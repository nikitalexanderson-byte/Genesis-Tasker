package ru.genesis.calendar.domain.habits

import java.time.LocalTime

data class HabitIntervalSchedule(val intervalMinutes: Int = 30, val startTime: String = "09:00",
    val endTime: String = "18:00", val completionMode: String = "each") {
    fun valid(): Boolean = intervalMinutes in 1..1440 && timePattern.matches(startTime) &&
        timePattern.matches(endTime) && endTime >= startTime && completionMode in setOf("each", "day")
    fun times(): List<String> {
        if (!valid()) return emptyList()
        val start = LocalTime.parse(startTime).toSecondOfDay() / 60
        val end = LocalTime.parse(endTime).toSecondOfDay() / 60
        return (start..end step intervalMinutes).map { "%02d:%02d".format(java.util.Locale.ROOT, it / 60, it % 60) }
    }
    companion object { private val timePattern = Regex("(?:[01]\\d|2[0-3]):[0-5]\\d") }
}

fun habitIntervalMarks(habit: Habit, entry: HabitCompletion?): List<String> {
    val times = habit.intervalSchedule?.times().orEmpty()
    return if (entry?.completed == true) times else entry?.completedTimes.orEmpty().distinct().filter { it in times }.sorted()
}
