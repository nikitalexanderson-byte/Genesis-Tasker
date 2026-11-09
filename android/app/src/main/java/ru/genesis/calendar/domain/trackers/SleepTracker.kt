package ru.genesis.calendar.domain.trackers

import java.time.*
import kotlin.math.abs
import ru.genesis.calendar.domain.habits.TrackerEntity
import ru.genesis.calendar.domain.habits.TrackerSchedule
import ru.genesis.calendar.domain.habits.jsRound

data class SleepRule(val id: String, val field: String, val operator: String, val threshold: LocalTime, val points: Double)
data class SleepPlan(val entity: TrackerEntity, val schedule: TrackerSchedule, val title: String = "Сон и пробуждение",
    val active: Boolean = true, val targetBedtime: LocalTime = LocalTime.of(23,0), val targetWakeTime: LocalTime = LocalTime.of(7,0),
    val qualityEnabled: Boolean = true, val scoringEnabled: Boolean = false, val rules: List<SleepRule> = emptyList(),
    val reminderEnabled: Boolean = false, val reminderMinutesBefore: Int = 15) {
    val id: String get() = entity.id
}
data class SleepEntry(val entity: TrackerEntity, val planId: String, val date: LocalDate,
    val fellAsleepAt: LocalTime?, val wokeAt: LocalTime?, val durationMinutes: Int?, val quality: Int?,
    val deviationMinutes: Int?, val note: String, val score: Double)

/** Exact existing tracker-math calculation, including its four offset iterations.
 * This describes saved observations; it is not a medical assessment or alarm-time policy.
 */
object SleepTracker {
    private fun minutes(time: LocalTime) = time.hour*60+time.minute
    private fun webZonedMillis(date: LocalDate,time: LocalTime,timeZone: String): Long {
        val desired=date.atTime(time.withSecond(0).withNano(0)).toInstant(ZoneOffset.UTC).toEpochMilli()
        val zone=runCatching { ZoneId.of(timeZone) }.getOrNull() ?: return desired
        var guess=desired
        repeat(4) { guess=desired-zone.rules.getOffset(Instant.ofEpochMilli(guess)).totalSeconds*1000L }
        return guess
    }
    /** Source helper returns 0 for missing endpoints; UI/store uses nullable entry duration. */
    fun durationMinutes(date: LocalDate,bedtime: LocalTime?,wake: LocalTime?,timeZone: String): Int {
        if(bedtime==null||wake==null)return 0
        val wakeDate=if(minutes(wake)<=minutes(bedtime))date.plusDays(1) else date
        return jsRound((webZonedMillis(wakeDate,wake,timeZone)-webZonedMillis(date,bedtime,timeZone))/60000.0).coerceAtLeast(0)
    }
    /** Duration difference, rather than the average of two clock-time offsets. */
    fun deviationMinutes(plan: SleepPlan,date: LocalDate,bedtime: LocalTime?,wake: LocalTime?): Int {
        if(bedtime==null||wake==null)return 0
        return abs(durationMinutes(date,bedtime,wake,plan.schedule.timezone)-
            durationMinutes(date,plan.targetBedtime,plan.targetWakeTime,plan.schedule.timezone))
    }
    fun score(plan: SleepPlan,bedtime: LocalTime?,wake: LocalTime?): Double {
        if(!plan.scoringEnabled)return 0.0
        return plan.rules.sumOf { rule ->
            val time=if(rule.field=="bedtime")bedtime else wake
            val matches=time!=null && if(rule.operator=="on-or-before")minutes(time)<=minutes(rule.threshold) else minutes(time)>minutes(rule.threshold)
            if(matches)rule.points else 0.0
        }
    }
    fun entry(entity: TrackerEntity,plan: SleepPlan,date: LocalDate,bedtime: LocalTime?,wake: LocalTime?,quality: Double?,note: String): SleepEntry =
        SleepEntry(entity,plan.id,date,bedtime,wake,
            if(bedtime!=null&&wake!=null)durationMinutes(date,bedtime,wake,plan.schedule.timezone) else null,
            quality?.let { require(it.isFinite()); jsRound(it).coerceIn(1,10) },
            if(bedtime!=null&&wake!=null)deviationMinutes(plan,date,bedtime,wake) else null,note,score(plan,bedtime,wake))

    /** Recalculate cached metrics without changing observation IDs, versions, notes or timestamps. */
    fun recalculate(entry: SleepEntry,plan: SleepPlan): SleepEntry = entry.copy(
        durationMinutes=if(entry.fellAsleepAt!=null&&entry.wokeAt!=null)
            durationMinutes(entry.date,entry.fellAsleepAt,entry.wokeAt,plan.schedule.timezone) else null,
        deviationMinutes=if(entry.fellAsleepAt!=null&&entry.wokeAt!=null)
            deviationMinutes(plan,entry.date,entry.fellAsleepAt,entry.wokeAt) else null)

    /** Show ambiguity/gap explicitly; source-compatible calculation is not precision proof. */
    fun hasAmbiguousLocalTime(date: LocalDate,bedtime: LocalTime,wake: LocalTime,zone: ZoneId): Boolean {
        val wakeDate=if(minutes(wake)<=minutes(bedtime))date.plusDays(1) else date
        return zone.rules.getValidOffsets(date.atTime(bedtime)).size!=1 || zone.rules.getValidOffsets(wakeDate.atTime(wake)).size!=1
    }
}
