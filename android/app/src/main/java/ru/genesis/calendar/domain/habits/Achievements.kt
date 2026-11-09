package ru.genesis.calendar.domain.habits

import java.time.LocalDate

data class AchievementUnlock(val achievementId: String, val unlockedAt: String)

/** Native local subset of app/achievements.ts; unlocks persist even if a later edit changes a metric. */
object Achievements {
    val ids = listOf("first-step", "three-day-rhythm", "seven-sunrises", "fortnight-rhythm",
        "perfect-day", "habit-thirty", "century", "iron-rhythm", "fifty-sunrises",
        "hundred-day-path", "perfect-week", "perfect-month", "half-year-circle",
        "full-revolution", "five-hundred-sunrises", "thousand-day-path", "comeback", "consistency")

    fun normalize(unlocks: List<AchievementUnlock>): List<AchievementUnlock> {
        val known = linkedMapOf<String, AchievementUnlock>()
        unlocks.forEach { unlock ->
            if (unlock.achievementId in ids && unlock.unlockedAt.isNotBlank() &&
                (known[unlock.achievementId]?.unlockedAt ?: "~") > unlock.unlockedAt) {
                known[unlock.achievementId] = unlock
            }
        }
        return ids.mapNotNull(known::get)
    }

    fun reconcile(existing: List<AchievementUnlock>, completions: List<HabitCompletion>,
        goals: List<DailyGoalRecord>, longestStreak: Int, rewards: List<RewardTransaction>,
        timestamp: String): List<AchievementUnlock> {
        val completed = completions.filter { it.completed }
        val bestHabit = completed.groupingBy { it.habitId }.eachCount().values.maxOrNull() ?: 0
        val perfectDates = goals.filter { it.status == "perfect" }.map { it.date }.distinct().sorted()
        var perfectRun = 0
        var currentRun = 0
        var previous: LocalDate? = null
        perfectDates.forEach { date ->
            currentRun = if (previous?.plusDays(1) == date) currentRun + 1 else 1
            perfectRun = maxOf(perfectRun, currentRun)
            previous = date
        }
        val qualified = ids.filter { id -> when (id) {
            "first-step" -> completed.isNotEmpty()
            "three-day-rhythm" -> longestStreak >= 3
            "seven-sunrises" -> longestStreak >= 7
            "fortnight-rhythm" -> longestStreak >= 14
            "perfect-day" -> perfectDates.isNotEmpty()
            "habit-thirty" -> bestHabit >= 30
            "century" -> bestHabit >= 100
            "iron-rhythm" -> longestStreak >= 30
            "fifty-sunrises" -> longestStreak >= 50
            "hundred-day-path" -> longestStreak >= 100
            "perfect-week" -> perfectRun >= 7
            "perfect-month" -> perfectRun >= 30
            "half-year-circle" -> longestStreak >= 180
            "full-revolution" -> longestStreak >= 365
            "five-hundred-sunrises" -> longestStreak >= 500
            "thousand-day-path" -> longestStreak >= 1000
            "comeback" -> rewards.any { it.reason == "comeback" }
            "consistency" -> completed.size >= 1000
            else -> false
        } }
        val unlocked = normalize(existing).associateBy { it.achievementId }
        return normalize(ids.mapNotNull { id -> unlocked[id] ?: if (id in qualified)
            AchievementUnlock(id, timestamp) else null })
    }
}
