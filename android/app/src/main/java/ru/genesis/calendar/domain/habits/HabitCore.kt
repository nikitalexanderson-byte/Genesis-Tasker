package ru.genesis.calendar.domain.habits

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID
import kotlin.math.floor
import ru.genesis.calendar.domain.GenesisCalendar
import ru.genesis.calendar.domain.RecurrenceConfig
import ru.genesis.calendar.domain.RecurrenceEngine
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.StoicheionRestorationSnapshot

internal fun jsRound(value: Double): Int = if (value.isFinite()) floor(value + 0.5).toInt() else 0
internal fun safeCount(value: Double): Int = jsRound(value).coerceAtLeast(0)

data class TrackerEntity(val id: String, val createdAt: String, val updatedAt: String,
    val version: Int = 1, val syncState: String = "local") {
    fun changed(timestamp: String) = copy(updatedAt=timestamp,version=version+1,syncState="pending")
    companion object {
        fun create(prefix: String, timestamp: String = Instant.now().toString(), id: String = "$prefix-${UUID.randomUUID()}") =
            TrackerEntity(id,timestamp,timestamp)
    }
}

data class TrackerSchedule(val startDate: LocalDate, val endDate: LocalDate? = null,
    val timezone: String, val recurrence: RecurrenceConfig)
data class HabitReminder(val enabled: Boolean = false, val time: String = "09:00",
    val syncToGoogleTasks: Boolean = false, val showInGoogleCalendar: Boolean = false,
    val googleTaskId: String? = null, val googleEventId: String? = null,
    val timing: String = "habit", val minutesBefore: Int = 0, val allowDuringQuietHours: Boolean = false)
data class Habit(
    val entity: TrackerEntity, val title: String, val createdDate: LocalDate, val schedule: TrackerSchedule,
    val description: String = "", val emoji: String = "✨", val priority: Int = 5,
    val isKeyHabit: Boolean = false, val ritualId: String = "none", val ritualName: String = "",
    val color: String = "#bb8f4a", val active: Boolean = true,
    val sourceTemplateId: String? = null, val sacredPracticeId: String? = null,
    val sacredSectorId: String? = null, val preferredTime: String = "",
    val scoringMode: String = "binary", val qualityScale: String = "none", val reminder: HabitReminder = HabitReminder(),
    val intervalSchedule: HabitIntervalSchedule? = null,
    val measurement: HabitMeasurement? = null, val ruleHistory: List<HabitRuleVersion> = emptyList(),
    val periodGoal: HabitPeriodGoal? = null,
    val lifecycleHistory: List<HabitLifecycleEvent> = emptyList(),
    val stoicheionRestoration: StoicheionRestorationSnapshot? = null,
    val practiceGoal: HabitPracticeGoal? = null,
    val timerEnabled: Boolean = true,
    val autoDeletePolicy: HabitAutoDeletePolicy? = null,
    val timerPreferences: HabitTimerPreferences? = null,
) {
    init { require(periodGoal?.metric != "sum" || measurement != null) { "HABIT_PERIOD_MEASUREMENT_REQUIRED" } }
    val id: String get() = entity.id
}

/** The first tracking date and XP formula become immutable after the first save. */
fun preserveHabitCreationSettings(candidate: Habit, previous: Habit?, today: LocalDate,
    timestamp: String = Instant.now().toString()): Habit {
    if (previous == null) {
        require(candidate.schedule.startDate >= today) { "Начало привычки не может быть в прошлом." }
        val created=candidate.copy(createdDate = candidate.schedule.startDate,
            autoDeletePolicy = HabitAutoDelete.prepare(candidate.autoDeletePolicy, null, today),
            practiceGoal = candidate.practiceGoal?.copy(startDate = candidate.schedule.startDate))
        return if(created.lifecycleHistory.isNotEmpty()) created else HabitLifecycle.apply(created.copy(active=!created.active),
            HabitLifecycleCommand("habit-created:${created.id}",created.id,timestamp,if(created.active) "resume" else "pause",emptyList()))
    }
    val schedule = candidate.schedule.copy(startDate = previous.schedule.startDate,
        recurrence = candidate.schedule.recurrence.copy(rangeStart = previous.schedule.recurrence.rangeStart))
    if (previous.practiceGoal != null) require(schedule.endDate != null && schedule.endDate >= schedule.startDate
        && (previous.schedule.endDate == null || today <= previous.schedule.endDate || schedule == previous.schedule)) { "PRACTICE_CLOSED_OR_DEADLINE_REQUIRED" }
    require(candidate.periodGoal?.metric != "sum" || candidate.measurement != null) { "HABIT_PERIOD_MEASUREMENT_REQUIRED" }
    val heads=HabitRuleHistory.state(previous,LocalDate.MAX).frontier
    require(heads.size<=1) { "HABIT_RULE_CONFLICT" }
    val transitionGoal = HabitMeasurements.rule(previous,today).periodGoal ?: candidate.periodGoal
    val effective = transitionGoal?.let { HabitPeriodGoals.period(it,today).end } ?: if(previous.practiceGoal != null || candidate.practiceGoal != null) today else today.plusDays(1)
    val rules = if (candidate.measurement != previous.measurement || schedule != previous.schedule || candidate.periodGoal != previous.periodGoal) {
        (previous.ruleHistory.ifEmpty { listOf(HabitMeasurements.rule(previous, previous.createdDate)) }
            + HabitRuleVersion("rule:${UUID.randomUUID()}",
                effective, timestamp, candidate.measurement, schedule, candidate.periodGoal,
                (heads.ifEmpty { listOf(HabitMeasurements.rule(previous,previous.createdDate)) }).map { it.id }))
            .distinctBy { it.id }.sortedWith(compareBy<HabitRuleVersion> { it.effectiveDate }.thenBy { it.recordedAt }.thenBy { it.id })
    } else previous.ruleHistory
    return candidate.copy(
        autoDeletePolicy = HabitAutoDelete.prepare(candidate.autoDeletePolicy, previous.autoDeletePolicy, today),
        stoicheionRestoration = candidate.stoicheionRestoration ?: previous.stoicheionRestoration,
        practiceGoal = previous.practiceGoal ?: candidate.practiceGoal?.takeIf { previous.stoicheionRestoration == null && candidate.stoicheionRestoration != null },
        ruleHistory = rules,
        createdDate = previous.createdDate,
        scoringMode = previous.scoringMode,
        qualityScale = previous.qualityScale,
        lifecycleHistory = previous.lifecycleHistory,
        schedule = schedule,
    )
}
data class HabitCompletion(val entity: TrackerEntity, val habitId: String, val date: LocalDate,
    val completed: Boolean = false, val qualityValue: Double? = null, val score: Int = 0,
    val xpAwarded: Int = 0, val note: String = "", val qualityConfirmedAt: String? = null,
    val completedTimes: List<String> = emptyList(), val skippedAt: String? = null)

/** XP belongs to a habit/date, even when old clients produced multiple snapshot IDs. */
fun habitCompletionCredits(rows: List<HabitCompletion>): List<Int> = rows.groupBy { it.habitId to it.date }
    .values.map { day -> day.maxOf { it.xpAwarded } }

/** Direct port of scoreHabitFormula. XP is distinct from current score. */
fun scoreHabitFormula(mode: String, completed: Boolean, qualityValue: Double?): Int {
    if (!completed || mode == "none") return 0
    return when(mode) {
        "quality-ten" -> jsRound(qualityValue ?: 5.0).coerceIn(1,10)
        "quality-bipolar" -> (10 + 2 * jsRound(qualityValue ?: 0.0).coerceIn(-5,5)).coerceIn(0,20)
        else -> 10
    }
}

fun completionXpAward(previousAward: Double, completionScore: Double, maximum: Double = 20.0): Int =
    maxOf(safeCount(previousAward),safeCount(completionScore)).coerceAtMost(safeCount(maximum))

class HabitEngine(private val calendar: GenesisCalendar) {
    private val recurrence = RecurrenceEngine(calendar)

    fun defaultSchedule(date: LocalDate, mode: CalendarMode): TrackerSchedule {
        val recurrenceMode=when(mode) { CalendarMode.PROFANE -> "classic"; CalendarMode.SACRED -> "genesis"; CalendarMode.LUNAR -> "lunar" }
        val pattern=when(mode) { CalendarMode.PROFANE -> "daily"; CalendarMode.SACRED -> "pyata-days"; CalendarMode.LUNAR -> "lunar-days" }
        val day=when(mode) { CalendarMode.PROFANE -> date.dayOfWeek.value; CalendarMode.SACRED -> (calendar.sacredDate(date).day-1)%5+1; CalendarMode.LUNAR -> calendar.lunarDate(date).day }
        return TrackerSchedule(date,timezone=calendar.zoneId.id,recurrence=RecurrenceConfig(true,recurrenceMode,pattern,listOf(day),rangeStart=date.toString(),calendarContext=ru.genesis.calendar.domain.CalendarContext(timeZone=calendar.zoneId.id)))
    }

    fun normalizeSchedule(schedule: TrackerSchedule): TrackerSchedule {
        val end=schedule.endDate?.takeIf { it >= schedule.startDate }
        return schedule.copy(endDate=end,timezone=schedule.timezone.ifEmpty { calendar.zoneId.id },
            recurrence=recurrence.normalize(schedule.recurrence).copy(calendarContext=schedule.recurrence.calendarContext ?: ru.genesis.calendar.domain.CalendarContext(version=1,timeZone=schedule.timezone.ifEmpty { calendar.zoneId.id }),rangeStart=schedule.startDate.toString(),rangeEnd=end?.toString() ?: ""))
    }

    /** Saved schedule owns its mode. The account display calendar is intentionally absent. */
    fun isScheduled(habit: Habit, date: LocalDate, completions: List<HabitCompletion> = emptyList()): Boolean {
        if (!HabitPracticeGoals.allowsDate(habit, completions, date)) return false
        if(HabitRuleHistory.state(habit,date).conflicts.isNotEmpty()) return false
        val schedule = HabitMeasurements.rule(habit, date).schedule
        val availability = HabitLifecycle.state(habit.id, habit.active, habit.lifecycleHistory, date)
        if (availability.status != "active" || availability.conflict || date < schedule.startDate || schedule.endDate?.let { date > it } == true) return false
        return recurrence.matches(schedule.startDate.toString(),schedule.recurrence.copy(
            calendarContext=schedule.recurrence.calendarContext ?: ru.genesis.calendar.domain.CalendarContext(version=1,timeZone=schedule.timezone.ifEmpty { calendar.zoneId.id }),
            rangeStart=schedule.startDate.toString(),rangeEnd=schedule.endDate?.toString() ?: ""),
            date.toString(),ignoreRangeEnd=schedule.endDate == null)
    }

    fun score(habit: Habit, entry: HabitCompletion?, date: LocalDate): Int =
        if (entry == null || !isScheduled(habit,date)) 0 else scoreHabitFormula(habit.scoringMode,entry.completed,entry.qualityValue)

    /** Pure operation matching updateHabitCompletion's guarded write, deduplication,
     * version increment and monotonic XP. The caller persists the returned list atomically.
     * Only user-editable fields are accepted, never identity or another habit's ownership.
     */
    fun updateCompletion(entries: List<HabitCompletion>, habit: Habit, date: LocalDate, today: LocalDate,
        completed: Boolean, qualityValue: Double?, note: String,
        timestamp: String = Instant.now().toString(), newId: String = "habit-completion-${UUID.randomUUID()}",
        completedTimes: List<String>? = null, measurementCompleted: Boolean? = null,
        measurementRewardEligible: Boolean = false): List<HabitCompletion> {
        if (date != today || date < habit.createdDate || habit.practiceGoal != null && !isScheduled(habit,date,entries)) return entries
        val current = entries.firstOrNull { it.habitId == habit.id && it.date == date }
        val measured = HabitMeasurements.effective(HabitMeasurements.rule(habit, date)) != null
        val base = current ?: HabitCompletion(TrackerEntity.create("habit-completion",timestamp,
            "habit-completion:${habit.id}:$date"),habit.id,date)
        val preservedQuality = if (base.qualityConfirmedAt != null) base.qualityValue else qualityValue
        val confirmedAt = base.qualityConfirmedAt ?: if(measured && qualityValue != null) timestamp else null
        val actual = if(measured) measurementCompleted == true && (habit.qualityScale == "none" || confirmedAt != null) else completed
        val score = scoreHabitFormula(habit.scoringMode,actual,preservedQuality)
        val next = base.copy(entity=base.entity.changed(timestamp),completed=actual,qualityValue=preservedQuality,qualityConfirmedAt=confirmedAt,
            note=note,score=score,skippedAt=if(completed) null else base.skippedAt,xpAwarded=if(!measured || measurementRewardEligible)
                completionXpAward(base.xpAwarded.toDouble(),score.toDouble()) else base.xpAwarded,
            completedTimes=completedTimes ?: if(habit.intervalSchedule?.completionMode=="each")
                if(completed) habit.intervalSchedule.times() else emptyList() else base.completedTimes)
        return entries.filterNot { it.habitId == habit.id && it.date == date } + next
    }

    fun updateIntervalCompletion(entries: List<HabitCompletion>, habit: Habit, date: LocalDate,
        today: LocalDate, time: String, completed: Boolean): List<HabitCompletion> {
        val schedule = habit.intervalSchedule?.takeIf { it.completionMode == "each" } ?: return entries
        val times = schedule.times()
        if (time !in times) return entries
        val current = entries.firstOrNull { it.habitId == habit.id && it.date == date }
        val marks = habitIntervalMarks(habit, current).toMutableSet()
        if (completed) marks.add(time) else marks.remove(time)
        return updateCompletion(entries, habit, date, today, times.all { it in marks } &&
            (!habit.scoringMode.startsWith("quality") || current?.qualityValue != null), current?.qualityValue,
            current?.note.orEmpty(), completedTimes = marks.sorted())
    }

    fun dailyCounts(habits: List<Habit>, entries: List<HabitCompletion>, date: LocalDate,
        measurements: List<HabitMeasurementEvent> = emptyList(), today: LocalDate = LocalDate.now(), rewardsOnly: Boolean = false): Pair<Int,Int> {
        var scheduled = 0; var completed = 0
        habits.filter { it.active }.forEach { habit ->
            val practice = HabitPracticeGoals.progress(habit, entries, today)
            if (practice != null && date >= (habit.practiceGoal?.startDate ?: habit.schedule.startDate)) {
                if (practice.status != "conflict" && (practice.completedDate == date || practice.completedDate == null && practice.deadline == date)) {
                    scheduled++; if (practice.completedDate != null) completed++
                }
                return@forEach
            }
            val goal = HabitMeasurements.rule(habit,date).periodGoal
            if(goal != null) {
                val now = today.atTime(12,0).atZone(ZoneId.of(goal.context.timeZone)).toInstant()
                val settlement = HabitPeriodGoals.settlement(habit,date,measurements,entries,now) ?: return@forEach
                scheduled++
                if(settlement.completed && (!rewardsOnly || settlement.rewardEligible)) completed++
            } else if(isScheduled(habit,date)) {
                scheduled++
                if(entries.any { it.habitId==habit.id && it.date==date && it.completed }) completed++
            }
        }
        return scheduled to completed
    }

    fun dailyGoalForDate(habits: List<Habit>, entries: List<HabitCompletion>, records: List<DailyGoalRecord>,
        modeChanges: List<DailyGoalModeChange>, restDays: Set<LocalDate>, date: LocalDate, today: LocalDate,
        timestamp: String, measurements: List<HabitMeasurementEvent> = emptyList(), rewardsOnly: Boolean = false): DailyGoalRecord {
        val existing=records.firstOrNull { it.date == date }
        val mode=if(existing != null && date < today) existing.mode else DailyGoals.modeForDate(modeChanges,date)
        val (scheduled,completed)=dailyCounts(habits,entries,date,measurements,today,rewardsOnly)
        val next=DailyGoals.build(date,mode,existing?.timezone ?: calendar.zoneId.id,scheduled.toDouble(),completed.toDouble(),
            today,timestamp,isRestDay=date in restDays,isStreakProtected=existing?.status == "protected")
        return if(existing != null && existing.copy(updatedAt=timestamp) == next) existing else next
    }
}
