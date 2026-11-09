package ru.genesis.calendar.domain.habits

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.ChronoUnit
import ru.genesis.calendar.data.LocalHabitWorkspace
import ru.genesis.calendar.domain.CalendarContext
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.GenesisCalendar

data class HabitAnalysisDay(val date: LocalDate, val today: LocalDate, val scheduled: Boolean, val availabilityKnown: Boolean,
    val future: Boolean, val beforeCreation: Boolean, val availability: String, val activity: String,
    val volume: Long, val target: Long?, val unit: String?, val kind: String, val period: String?, val metric: String,
    val ruleId: String, val completed: Boolean, val hasRecord: Boolean, val completion: HabitCompletion?, val recordIds: List<String>, val periodKey: String?)
data class HabitGoalOpportunity(val key: String, val start: LocalDate, val end: LocalDate, val deadline: LocalDate?, val period: String,
    val metric: String, val value: Long, val target: Long, val completed: Boolean, val closed: Boolean, val eligible: Boolean,
    val qualityPending: Boolean, val conflict: Boolean, val partial: Boolean, val availabilityKnown: Boolean, val ruleId: String)
data class HabitVolumeAnalysis(val kind: String, val unit: String, val plan: String, var actual: Long = 0, var target: Long = 0,
    var openActual: Long = 0, var extraActual: Long = 0, var unknownActual: Long = 0, var hasPlan: Boolean = false, var conflicts: Int = 0) {
    val percent: Double? get() = if (hasPlan && target > 0 && conflicts == 0) actual.toDouble() / target * 100 else null
}
data class HabitRangeAnalysis(val habitId: String, val range: HabitGoalPeriod, val days: List<HabitAnalysisDay>,
    val opportunities: List<HabitGoalOpportunity>, val closedCount: Int, val completedCount: Int, val unresolvedCount: Int,
    val unknownDays: Int, val volumes: List<HabitVolumeAnalysis>) {
    val completionPercent: Double? get() = if (closedCount > 0 && unresolvedCount == 0) completedCount.toDouble() / closedCount * 100 else null
    val open get() = opportunities.filter { !it.closed && !it.conflict }
}
data class HabitComparisonPart(val completed: Int, val planned: Int, val unknown: Int, val conflicts: Int) {
    val percent: Double? get() = if (planned > 0 && conflicts == 0) completed.toDouble() / planned * 100 else null
}
data class HabitGoalComparison(val current: HabitComparisonPart, val previous: HabitComparisonPart, val elapsed: Int,
    val start: LocalDate, val previousStart: LocalDate, val previousEnd: LocalDate?, val open: Int) {
    val absoluteChange get() = current.completed - previous.completed
    val changePercent: Double? get() = if (current.planned > 0 && previous.planned > 0 && previous.completed > 0 && current.conflicts == 0 && previous.conflicts == 0)
        absoluteChange.toDouble() / previous.completed * 100 else null
}

/** Read-only parity with the web goal report: goals and volume never share a denominator. */
object HabitAnalysis {
    fun currentCompletions(workspace: LocalHabitWorkspace, habitId: String): Map<LocalDate, HabitCompletion> = workspace.completions.filter { it.habitId == habitId }
        .sortedWith(compareByDescending<HabitCompletion> { it.entity.version }.thenByDescending { Instant.parse(it.entity.updatedAt) }.thenByDescending { it.entity.id })
        .distinctBy { it.date }.associateBy { it.date }
    fun availabilityKnown(habit: Habit, date: LocalDate, today: LocalDate): Boolean = date >= today
        || habit.lifecycleHistory.minOfOrNull { it.date }?.let { date >= it && !HabitLifecycle.state(habit, date).unknown } == true
    fun day(workspace: LocalHabitWorkspace, habit: Habit, date: LocalDate, now: Instant = Instant.now(),
        index: Map<LocalDate, HabitCompletion> = currentCompletions(workspace, habit.id)): HabitAnalysisDay {
        val state = HabitRuleHistory.state(habit, date); val rule = state.rule; val definition = HabitMeasurements.effective(rule)
        val today = now.atZone(ZoneId.of(rule.periodGoal?.context?.timeZone ?: rule.schedule.timezone)).toLocalDate()
        val lifecycle = HabitLifecycle.state(habit, date); val completion = index[date]
        val measured = definition?.let { HabitMeasurements.progress(habit, date, workspace.measurements) }
        val history = HabitHistory.state(workspace.history, habit.id, date)
        val before = date < habit.createdDate; val future = date > today
        val scheduledHabit = habit.copy(active = true, schedule = rule.schedule, ruleHistory = emptyList(), lifecycleHistory = emptyList())
        val scheduled = !before && state.conflicts.isEmpty() && lifecycle.status == "active" && !lifecycle.conflict
            && HabitEngine(GenesisCalendar(ZoneId.of(rule.schedule.timezone))).isScheduled(scheduledHabit, date)
        val quality = measured != null && measured.total > 0 && habit.qualityScale != "none" && completion?.qualityConfirmedAt == null
        val conflict = lifecycle.conflict || state.conflicts.isNotEmpty() || history.conflict || measured?.let { it.incompatible || it.entries.any { entry -> entry.conflict } } == true
        val completed = if (definition != null) measured!!.completed && !quality else completion?.completed == true
        val active = (measured?.total ?: 0) > 0 || completion?.completed == true
        val flexible = rule.periodGoal?.metric?.let { it != "days" } == true
        val activity = when { conflict -> "conflict"; completed && !flexible -> "completed"; completion?.skippedAt != null -> "skipped";
            quality -> "quality-pending"; active -> if (flexible) "activity" else "partial"; completion != null || measured?.entries?.isNotEmpty() == true -> "unmarked"; else -> "missing" }
        val period = rule.periodGoal?.let { HabitPeriodGoals.period(it, date) }
        return HabitAnalysisDay(date, today, scheduled, availabilityKnown(habit, date, today), future, before, lifecycle.status, activity,
            measured?.total ?: if (completed) 1 else 0, if (flexible) null else definition?.target ?: 1, definition?.unit, definition?.kind ?: "binary",
            rule.periodGoal?.period, rule.periodGoal?.metric ?: "day", rule.id, completed, completion != null || measured?.entries?.isNotEmpty() == true || history.rows.isNotEmpty(),
            completion, workspace.completions.filter { it.habitId == habit.id && it.date == date }.map { it.entity.id } + measured?.entries.orEmpty().flatMap { it.revisions.map { row -> row.entity.id } }
                + history.rows.map { it.entity.id }, period?.let { "${rule.id}:${it.start}:${it.end}" })
    }
    fun range(workspace: LocalHabitWorkspace, habit: Habit, range: HabitGoalPeriod, now: Instant = Instant.now()): HabitRangeAnalysis {
        require(range.start < range.end) { "INVALID_CALENDAR_DATE" }
        val current = currentCompletions(workspace, habit.id); val projected = workspace.copy(completions = current.values.toList())
        val days = mutableListOf<HabitAnalysisDay>(); val opportunities = mutableListOf<HabitGoalOpportunity>()
        val periods = linkedMapOf<String, LocalDate>(); val volumes = linkedMapOf<String, HabitVolumeAnalysis>()
        fun volume(day: HabitAnalysisDay): HabitVolumeAnalysis? {
            if (day.kind == "binary" || day.unit == null) return null
            val plan = if (day.period != null && day.metric != "sum") "flexible" else "fixed"
            return volumes.getOrPut("${day.kind}:${day.unit}:$plan") { HabitVolumeAnalysis(day.kind, day.unit, plan) }
        }
        var date = range.start
        while (date < range.end) {
            val day = day(projected, habit, date, now, current); days += day; date = date.plusDays(1)
            if (day.beforeCreation || day.future) continue
            val data = volume(day)
            if (day.activity == "conflict") data?.let { it.conflicts++ }
            if (!day.scheduled) { data?.let { it.extraActual = Math.addExact(it.extraActual, day.volume) }; continue }
            if (day.periodKey != null) { periods[day.periodKey] = day.date; continue }
            val closed = day.date < day.today; val eligible = closed && day.availabilityKnown && day.activity != "conflict"
            opportunities += HabitGoalOpportunity(day.date.toString(), day.date, day.date.plusDays(1), day.date, "day", if (day.kind == "binary") "days" else "sum",
                day.volume, day.target!!, day.completed, closed, eligible, day.activity == "quality-pending", day.activity == "conflict", false, day.availabilityKnown, day.ruleId)
            data?.let { if (eligible) { it.actual = Math.addExact(it.actual, day.volume); it.target = Math.addExact(it.target, day.target); it.hasPlan = true }
                else if (closed) it.unknownActual = Math.addExact(it.unknownActual, day.volume) else it.openActual = Math.addExact(it.openActual, day.volume) }
        }
        for ((key, sampleDate) in periods) {
            val period = HabitPeriodGoals.progress(habit, sampleDate, projected.measurements, projected.completions, now)!!
            val today = now.atZone(ZoneId.of(period.goal.context.timeZone)).toLocalDate()
            val closed = period.deadline?.let { it < today } == true
            val known = period.allowedDays.all { availabilityKnown(habit, it, today) }
            val within = period.period.start >= range.start && period.period.end <= range.end
            val eligible = closed && known && within && !period.conflicts && period.status != "neutral"
            opportunities += HabitGoalOpportunity(key, period.period.start, period.period.end, period.deadline, period.goal.period, period.goal.metric,
                period.value, period.goal.target, period.completed, closed, eligible, period.qualityPending, period.conflicts, period.partial || !within, known, period.rule.id)
            val sample = days.first { it.periodKey == key }; val data = volume(sample)
            if (data != null) {
                val amount = days.filter { it.periodKey == key && it.scheduled && !it.future }.fold(0L) { sum, it -> Math.addExact(sum, it.volume) }
                if (closed) {
                    if (!known) data.unknownActual = Math.addExact(data.unknownActual, amount)
                    else if (eligible) { data.actual = Math.addExact(data.actual, amount); if (period.goal.metric == "sum") { data.target = Math.addExact(data.target, period.goal.target); data.hasPlan = true } }
                    else data.extraActual = Math.addExact(data.extraActual, amount)
                } else data.openActual = Math.addExact(data.openActual, amount)
                if (period.conflicts) data.conflicts++
            }
        }
        val eligible = opportunities.filter { it.eligible }
        return HabitRangeAnalysis(habit.id, range, days, opportunities, eligible.size, eligible.count { it.completed },
            days.count { it.date < it.today && it.activity == "conflict" }, days.count { !it.future && !it.beforeCreation && !it.availabilityKnown }, volumes.values.toList())
    }
    fun comparison(workspace: LocalHabitWorkspace, today: LocalDate, mode: CalendarMode, context: CalendarContext,
        now: Instant = Instant.now()): HabitGoalComparison {
        val definition = HabitPeriodGoal(period = "week", metric = "days", target = 1, calendar = mode.wireValue, context = context)
        val period = HabitPeriodGoals.period(definition, today); val previous = HabitPeriodGoals.period(definition, period.start.minusDays(1))
        val elapsed = minOf(ChronoUnit.DAYS.between(period.start, today), ChronoUnit.DAYS.between(previous.start, previous.end)).toInt()
        fun aggregate(start: LocalDate): HabitComparisonPart {
            val reports = if (elapsed == 0) emptyList() else workspace.habits.map { range(workspace, it, HabitGoalPeriod(start, start.plusDays(elapsed.toLong())), now) }
            return HabitComparisonPart(reports.sumOf { it.completedCount }, reports.sumOf { it.closedCount }, reports.sumOf { it.unknownDays }, reports.sumOf { it.unresolvedCount })
        }
        val open = workspace.habits.sumOf { range(workspace, it, HabitGoalPeriod(period.start, today.plusDays(1)), now).open.size }
        return HabitGoalComparison(aggregate(period.start), aggregate(previous.start), elapsed, period.start, previous.start,
            if (elapsed == 0) null else previous.start.plusDays(elapsed - 1L), open)
    }
}
