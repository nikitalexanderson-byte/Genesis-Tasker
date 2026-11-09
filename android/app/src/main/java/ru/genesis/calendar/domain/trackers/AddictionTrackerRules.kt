package ru.genesis.calendar.domain.trackers

import java.time.LocalDate
import ru.genesis.calendar.domain.habits.TrackerEntity
import ru.genesis.calendar.domain.habits.TrackerSchedule
import ru.genesis.calendar.domain.habits.jsRound

data class AddictionTracker(val entity: TrackerEntity, val schedule: TrackerSchedule, val trackedBehavior: String = "",
    val description: String = "", val status: String = "active", val cleanDayPoints: Int = 10, val relapsePenalty: Int = 0,
    val reminderEnabled: Boolean = false, val reminderTime: String = "20:00") { val id: String get() = entity.id }
data class AddictionEntry(val entity: TrackerEntity, val trackerId: String, val date: LocalDate,
    val cleanDay: Boolean, val relapse: Boolean, val cravingIntensity: Int, val trigger: String, val note: String,
    val timestamp: String, val score: Int)

/** Mechanical source rules only. No diagnosis, medical advice, new penalties or rewards. */
object AddictionTrackerRules {
    fun score(cleanDayPoints: Double,relapsePenalty: Double,cleanDay: Boolean,relapse: Boolean): Int =
        if(relapse) -jsRound(relapsePenalty).coerceAtLeast(0) else if(cleanDay)jsRound(cleanDayPoints).coerceAtLeast(0) else 0
    fun entry(entity: TrackerEntity,tracker: AddictionTracker,date: LocalDate,cleanDay: Boolean,relapse: Boolean,
        cravingIntensity: Double,trigger: String,note: String,timestamp: String): AddictionEntry {
        val clean=!relapse&&cleanDay
        return AddictionEntry(entity,tracker.id,date,clean,relapse,jsRound(cravingIntensity).coerceIn(0,10),trigger,note,timestamp,
            score(tracker.cleanDayPoints.toDouble(),tracker.relapsePenalty.toDouble(),clean,relapse))
    }
    fun streak(entries: List<AddictionEntry>,trackerId: String,today: LocalDate): Int {
        val byDate=entries.filter { it.trackerId==trackerId }.associateBy { it.date }
        var cursor=today; var streak=0
        repeat(20_000) {
            val entry=byDate[cursor]
            if(entry==null||!entry.cleanDay||entry.relapse)return streak
            streak++;cursor=cursor.minusDays(1)
        }
        return streak
    }
}
