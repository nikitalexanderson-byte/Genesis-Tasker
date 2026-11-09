package ru.genesis.calendar.domain.habits

data class HabitTimerPreferences(val modes: List<String> = listOf("stopwatch", "pomodoro"),
    val workMinutes: Int = 25, val breakMinutes: Int = 5, val progress: String = "duration") {
    init {
        require(modes.isNotEmpty() && modes.distinct().size == modes.size && modes.all { it in setOf("stopwatch", "pomodoro") }
            && workMinutes in 1..180 && breakMinutes in 0..120 && progress in setOf("duration", "time-only")) { "INVALID_HABIT_TIMER_PREFERENCES" }
    }
}
