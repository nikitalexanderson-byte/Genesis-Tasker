package ru.genesis.calendar.domain.habits

import java.time.LocalDate
import java.time.temporal.ChronoUnit
import kotlin.math.ceil

data class DailyGoalModeChange(val effectiveFrom: LocalDate, val mode: String, val updatedAt: String)
data class DailyGoalRecord(val date: LocalDate, val mode: String, val timezone: String,
    val scheduledCount: Int, val completedCount: Int, val targetCount: Int, val status: String, val updatedAt: String)
data class DailyGoalStreak(val currentStreak: Int, val longestStreak: Int, val lastQualifiedDate: LocalDate?)

object DailyGoals {
    val modes = setOf("easy","rhythm","perfect")
    val statuses = setOf("open","qualified","perfect","missed","protected","neutral","rest","timezone-shift")

    fun target(mode: String, scheduledCount: Double): Int {
        val scheduled = safeCount(scheduledCount)
        return when {
            scheduled == 0 -> 0
            mode == "easy" -> 1
            mode == "perfect" -> scheduled
            else -> maxOf(1,ceil(scheduled*0.6).toInt())
        }
    }

    fun normalizeModeChanges(changes: List<DailyGoalModeChange>): List<DailyGoalModeChange> {
        val result = linkedMapOf<LocalDate,DailyGoalModeChange>()
        changes.filter { it.mode in modes }.forEach { change ->
            if (result[change.effectiveFrom]?.let { change.updatedAt >= it.updatedAt } != false) result[change.effectiveFrom] = change
        }
        return result.values.sortedBy { it.effectiveFrom }
    }
    fun modeForDate(changes: List<DailyGoalModeChange>, date: LocalDate): String =
        changes.fold("rhythm") { mode, change -> if(change.effectiveFrom <= date) change.mode else mode }

    fun build(date: LocalDate, mode: String, timezone: String, scheduledCount: Double, completedCount: Double,
        today: LocalDate, updatedAt: String, isRestDay: Boolean = false, isTimezoneShift: Boolean = false,
        isStreakProtected: Boolean = false): DailyGoalRecord {
        require(mode in modes)
        val scheduled = safeCount(scheduledCount)
        val completed = safeCount(completedCount).coerceAtMost(scheduled)
        val target = target(mode,scheduled.toDouble())
        val status = when {
            isRestDay -> "rest"
            isTimezoneShift -> "timezone-shift"
            isStreakProtected -> "protected"
            scheduled == 0 -> "neutral"
            completed == scheduled -> "perfect"
            completed >= target -> "qualified"
            date < today -> "missed"
            else -> "open"
        }
        return DailyGoalRecord(date,mode,timezone.ifEmpty { "UTC" },scheduled,completed,target,status,updatedAt)
    }

    fun normalize(records: List<DailyGoalRecord>): List<DailyGoalRecord> {
        val result = linkedMapOf<LocalDate,DailyGoalRecord>()
        records.filter { it.mode in modes && it.status in statuses }.forEach { item ->
            val scheduled = item.scheduledCount.coerceAtLeast(0)
            val record = item.copy(timezone=item.timezone.ifEmpty { "UTC" },scheduledCount=scheduled,
                completedCount=item.completedCount.coerceIn(0,scheduled),targetCount=item.targetCount.coerceIn(0,scheduled))
            if (result[record.date]?.let { record.updatedAt >= it.updatedAt } != false) result[record.date] = record
        }
        return result.values.sortedBy { it.date }
    }

    fun streak(records: List<DailyGoalRecord>, today: LocalDate): DailyGoalStreak {
        var current = 0; var longest = 0; var last: LocalDate? = null
        normalize(records).filter { it.date <= today }.forEach { record ->
            when(record.status) {
                "qualified","perfect" -> { current++; longest = maxOf(longest,current); last=record.date }
                "missed" -> current=0
            }
        }
        return DailyGoalStreak(current,longest,last)
    }

    fun rhythmScore(records: List<DailyGoalRecord>, today: LocalDate, windowDays: Int = 28): Int {
        val days = (if(windowDays == 0) 28 else windowDays).coerceIn(7,90)
        val start = today.minusDays(days.toLong()-1)
        val eligible = normalize(records).filter { it.date >= start && it.date <= today && it.scheduledCount > 0 && it.status !in setOf("neutral","rest","timezone-shift") }
        var earned = 0.0; var possible = 0.0
        eligible.forEach { record ->
            val age = ChronoUnit.DAYS.between(record.date,today).coerceAtLeast(0)
            val weight = 1 + maxOf(0.0,1.0-age.toDouble()/days)*1.5
            earned += minOf(1.0,record.completedCount.toDouble()/record.scheduledCount)*weight
            possible += weight
        }
        return if(possible == 0.0) 0 else jsRound(earned/possible*100).coerceIn(0,100)
    }
}
