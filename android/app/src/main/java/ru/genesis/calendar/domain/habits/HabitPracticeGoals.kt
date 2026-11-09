package ru.genesis.calendar.domain.habits

import java.time.LocalDate
import java.time.Instant
import java.time.ZoneId
import ru.genesis.calendar.domain.GenesisCalendar

data class HabitPracticeGoal(val version: Int = 1, val requiredCompletions: Int = 1, val penaltyLaurels: Int = 10, val startDate: LocalDate? = null) {
    init { require(version == 1 && requiredCompletions in 1..366 && penaltyLaurels == 10) { "INVALID_PRACTICE_GOAL" } }
}
data class HabitPracticeProgress(val goal: HabitPracticeGoal, val deadline: LocalDate,
    val dates: List<LocalDate>, val completedDate: LocalDate?, val status: String)

/** Same finite-window projection as app/habit-practice-goal.ts; legacy habits have no policy. */
object HabitPracticeGoals {
    private fun scheduledWhenCompleted(habit: Habit, entry: HabitCompletion, engine: HabitEngine): Boolean {
        val dayState = HabitLifecycle.state(habit, entry.date)
        if (dayState.conflict || dayState.unknown) return false
        val markedAt = runCatching { Instant.parse(entry.entity.updatedAt) }.getOrNull() ?: return false
        // A later same-day pause must not erase work already completed. Replay only
        // availability known at the authoritative mark; marks made during a pause stay invalid.
        val history = habit.lifecycleHistory.filter { Instant.parse(it.at) <= markedAt }
        if (history.isEmpty() && habit.lifecycleHistory.filter { it.replaces.isEmpty() }
                .map { it.baselineActive }.distinct().size > 1) return false
        return engine.isScheduled(habit.copy(active = dayState.baselineActive, lifecycleHistory = history), entry.date)
    }

    fun progress(habit: Habit, entries: List<HabitCompletion>, date: LocalDate): HabitPracticeProgress? {
        if(habit.practiceGoal == null && habit.sacredPracticeId == null) return null
        val current = entries.filter { it.habitId == habit.id }.groupBy { it.date }.values.map { rows ->
            rows.maxWith(compareBy<HabitCompletion> { it.entity.version }.thenBy { it.entity.updatedAt }.thenBy { it.entity.id }) }
        val recurrence = habit.schedule.recurrence
        val legacyStart = habit.stoicheionRestoration?.startedDate?.let(LocalDate::parse) ?: habit.createdDate
        val legacyEnd = habit.stoicheionRestoration?.sourceDate?.let(LocalDate::parse)?.plusDays(1) ?: legacyStart
        val legacyFactory = habit.practiceGoal == null && habit.sacredPracticeId != null && habit.ruleHistory.isEmpty()
            && habit.measurement == null && habit.periodGoal == null && habit.intervalSchedule == null && habit.schedule.endDate == null
            && (!recurrence.enabled || habit.stoicheionRestoration != null && recurrence.interval == 1 && recurrence.months.isEmpty() && recurrence.pyatas.isEmpty()
                && (recurrence.pattern == "daily" || recurrence.pattern == "pyata-days" && (1..5).all { it in recurrence.days }
                    || recurrence.pattern == "lunar-days" && recurrence.days.size == 30))
        val legacyDone = legacyFactory && current.any { it.completed && it.date >= legacyStart && it.date <= legacyEnd && it.date <= date }
        val goal = habit.practiceGoal ?: if(legacyDone) HabitPracticeGoal(startDate=legacyStart) else return null
        val state = HabitRuleHistory.state(habit, date)
        val schedule = state.rule.schedule
        val start = goal.startDate ?: schedule.startDate
        val deadline = if(legacyDone) legacyEnd else schedule.endDate ?: schedule.recurrence.rangeEnd.takeIf { it.isNotBlank() }?.let(LocalDate::parse) ?: schedule.startDate
        val engine = HabitEngine(GenesisCalendar(ZoneId.of(schedule.timezone)))
        val dates = current.filter { it.completed && it.date >= start && it.date <= deadline && it.date <= date && scheduledWhenCompleted(habit, it, engine)
            && !(habit.stoicheionRestoration?.excludeStartDate == true && it.date.toString() == habit.stoicheionRestoration.startedDate) }
            .map { it.date }.sorted().take(goal.requiredCompletions)
        val completed = dates.lastOrNull().takeIf { dates.size >= goal.requiredCompletions }
        return HabitPracticeProgress(goal, deadline, dates, completed, when {
            state.conflicts.isNotEmpty() -> "conflict"
            completed != null -> "completed"
            date > deadline -> "missed"
            date < start -> "pending"
            else -> "open"
        })
    }
    fun allowsDate(habit: Habit, entries: List<HabitCompletion>, date: LocalDate): Boolean {
        if (entries.isEmpty()) return true
        if (habit.practiceGoal?.startDate?.let { date < it } == true) return true
        val progress = progress(habit, entries, date) ?: return true
        return progress.status !in setOf("conflict", "missed") && (progress.completedDate == null || date <= progress.completedDate)
    }
    fun xpEntries(habits: List<Habit>, entries: List<HabitCompletion>): List<HabitCompletion> {
        val goals = habits.mapNotNull { habit -> habit.practiceGoal?.let { habit.id to it } }.toMap()
        return entries.filter { it.habitId !in goals || goals[it.habitId]?.startDate?.let { start -> it.date < start } == true } + goals.flatMap { (id, goal) ->
            entries.filter { it.habitId == id && it.xpAwarded > 0 && (goal.startDate == null || it.date >= goal.startDate) }.groupBy { it.date }.values
                .map { day -> day.maxBy { it.xpAwarded } }.sortedBy { it.date }.take(goal.requiredCompletions)
        }
    }
    fun penalties(habits: List<Habit>, entries: List<HabitCompletion>, ledger: List<RewardTransaction>, date: LocalDate, now: java.time.Instant? = null): List<RewardTransaction> {
        val ids = habits.filter { it.practiceGoal != null }.map { it.id }.toSet()
        val result = Rewards.normalize(ledger).filter { row ->
            if(row.sourceId !in ids) true else if(row.reason=="practice-expired") false else if(row.reason!="habit-deleted-reset") true
            else habits.firstOrNull { it.id==row.sourceId }?.stoicheionRestoration?.let { attached ->
                runCatching { java.time.Instant.parse(row.createdAt)<java.time.Instant.parse(attached.startedAt) }.getOrDefault(true)
            } ?: false
        }.toMutableList()
        for (habit in habits) {
            if (habit.practiceGoal == null) continue
            val progress = progress(habit, entries, now?.atZone(ZoneId.of(habit.schedule.timezone))?.toLocalDate() ?: date) ?: continue
            if (progress.status != "missed") continue
            val at = java.time.format.DateTimeFormatterBuilder().appendInstant(3).toFormatter()
                .format(progress.deadline.plusDays(1).atStartOfDay(ZoneId.of(habit.schedule.timezone)).toInstant())
            result += Rewards.create(-progress.goal.penaltyLaurels.toDouble(), "practice-expired", habit.id, "practice-expired:self:${habit.id}", at)
        }
        return Rewards.normalize(result)
    }
}
