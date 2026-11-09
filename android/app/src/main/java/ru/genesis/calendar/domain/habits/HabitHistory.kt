package ru.genesis.calendar.domain.habits

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import ru.genesis.calendar.data.LocalHabitWorkspace
import ru.genesis.calendar.domain.GenesisCalendar

data class HabitHistoryValue(val completed: Boolean, val completedTimes: List<String> = emptyList(),
    val qualityValue: Double? = null, val qualityConfirmedAt: String? = null, val note: String = "", val skippedAt: String? = null)
data class HabitHistoryEdit(val entity: TrackerEntity, val habitId: String, val date: LocalDate, val ruleId: String,
    val epoch: String, val replaces: List<String>, val value: HabitHistoryValue, val baseline: HabitCompletion?, val source: String = "history")
data class HabitHistoryMeasurement(val value: Long?, val entryId: String? = null, val replaces: List<String> = emptyList(), val note: String = "")
data class HabitHistoryCommand(val id: String, val at: String, val habitId: String, val date: LocalDate,
    val ruleId: String, val heads: List<String>, val value: HabitHistoryValue, val measurement: HabitHistoryMeasurement? = null)

object HabitHistory {
    data class State(val rows: List<HabitHistoryEdit>, val heads: List<HabitHistoryEdit>, val baseline: HabitCompletion?) {
        val current get() = heads.singleOrNull()
        val conflict get() = heads.size > 1
    }
    fun value(entry: HabitCompletion?) = HabitHistoryValue(entry?.completed ?: false, entry?.completedTimes.orEmpty(),
        entry?.qualityValue, entry?.qualityConfirmedAt, entry?.note.orEmpty(),entry?.skippedAt)
    fun validate(value: HabitHistoryValue) {
        require(value.note.length <= 2000 && value.completedTimes.size <= 1440
            && value.completedTimes.all { Regex("(?:[01]\\d|2[0-3]):[0-5]\\d").matches(it) }
            && (value.qualityValue == null || value.qualityValue.isFinite() && value.qualityValue in -5.0..10.0)) { "INVALID_HABIT_HISTORY" }
        value.qualityConfirmedAt?.let(Instant::parse)
        value.skippedAt?.let { require(!value.completed) { "INVALID_HABIT_HISTORY" };Instant.parse(it) }
    }
    fun merge(vararg sources: List<HabitHistoryEdit>): List<HabitHistoryEdit> {
        val output = linkedMapOf<String, HabitHistoryEdit>()
        sources.flatMap { it }.forEach { row ->
            require(row.entity.id.length in 1..512 && row.habitId.length in 1..512 && row.ruleId.length in 1..512
                && row.epoch.length <= 160 && row.entity.version == 1 && row.entity.createdAt == row.entity.updatedAt
                && row.source in setOf("history", "import", "decision") && row.entity.id !in row.replaces) { "INVALID_HABIT_HISTORY" }
            Instant.parse(row.entity.createdAt); validate(row.value)
            row.baseline?.let { require(it.habitId == row.habitId && it.date == row.date && it.xpAwarded in 0..20); validate(value(it)) }
            val canonical = row.copy(replaces = row.replaces.distinct().sorted(), value = row.value.copy(completedTimes = row.value.completedTimes.distinct().sorted()))
            val prior = output[row.entity.id]
            require(prior == null || prior.copy(entity = prior.entity.copy(syncState = "local"))
                == canonical.copy(entity = canonical.entity.copy(syncState = "local"))) { "HABIT_HISTORY_ID_CONFLICT" }
            output[row.entity.id] = canonical
        }
        val visited = hashSetOf<String>(); val visiting = hashSetOf<String>()
        fun visit(row: HabitHistoryEdit) {
            require(row.entity.id !in visiting) { "INVALID_HABIT_HISTORY" }
            if (row.entity.id in visited) return
            visiting += row.entity.id
            row.replaces.forEach { id ->
                val parent = requireNotNull(output[id]) { "INVALID_HABIT_HISTORY" }
                require(parent.habitId == row.habitId && parent.date == row.date && parent.epoch == row.epoch
                    && Instant.parse(parent.entity.createdAt).toEpochMilli() <= Instant.parse(row.entity.createdAt).toEpochMilli()) { "INVALID_HABIT_HISTORY" }
                visit(parent)
            }
            visiting -= row.entity.id; visited += row.entity.id
        }
        output.values.forEach(::visit)
        return output.values.sortedWith(compareBy<HabitHistoryEdit> { it.entity.createdAt }.thenBy { it.entity.id })
    }
    fun state(events: List<HabitHistoryEdit>, habitId: String, date: LocalDate): State {
        val rows = events.filter { it.habitId == habitId && it.date == date }
        val replaced = rows.flatMap { it.replaces }.toSet()
        val root = rows.filter { it.replaces.isEmpty() }.minWithOrNull(compareBy<HabitHistoryEdit> { it.entity.createdAt }.thenBy { it.entity.id })
        return State(rows, rows.filter { it.entity.id !in replaced }, root?.baseline)
    }
    fun project(habits: List<Habit>, events: List<HabitHistoryEdit>, completions: List<HabitCompletion>,
        measurements: List<HabitMeasurementEvent>): List<HabitCompletion> {
        val output = completions.toMutableList()
        events.distinctBy { it.habitId to it.date }.forEach { row ->
            val habit = habits.firstOrNull { it.id == row.habitId } ?: return@forEach
            if (row.date < habit.createdDate) return@forEach
            val state = state(events, row.habitId, row.date)
            val prior = output.firstOrNull { it.habitId == row.habitId && it.date == row.date }
            output.removeAll { it.habitId == row.habitId && it.date == row.date }
            val latestMeasurement=measurements.filter { it.habitId==habit.id && it.date==row.date }.maxOfOrNull { Instant.parse(it.entity.createdAt).toEpochMilli() } ?: 0L
            val newActivity=state.current?.source=="decision" && latestMeasurement>Instant.parse(state.current!!.entity.createdAt).toEpochMilli()
            val useCurrent=state.current?.source=="decision" && prior!=null &&
                (newActivity || Instant.parse(prior.entity.updatedAt).toEpochMilli()>Instant.parse(state.current!!.entity.createdAt).toEpochMilli())
            val next = if(useCurrent) value(prior).let { if(newActivity) it.copy(skippedAt=null) else it } else state.current?.value ?: state.baseline?.let(::value)
            if (next == null) {
                prior?.takeIf { it.xpAwarded > 0 }?.let { output += it.copy(completed = false, score = 0) }
                return@forEach
            }
            val completed = if (HabitMeasurements.effective(HabitMeasurements.rule(habit, row.date)) != null)
                HabitMeasurements.progress(habit, row.date, measurements).completed && (habit.qualityScale == "none" || next.qualityConfirmedAt != null)
                else next.completed
            val base = state.baseline ?: prior ?: HabitCompletion(TrackerEntity.create("habit-completion", state.rows.first().entity.createdAt,
                "habit-completion:${habit.id}:${row.date}"), habit.id, row.date)
            val updatedAt=if(useCurrent && newActivity && latestMeasurement>Instant.parse(prior!!.entity.updatedAt).toEpochMilli()) HabitTimers.instant(Instant.ofEpochMilli(latestMeasurement))
                else if(useCurrent) prior!!.entity.updatedAt else state.current?.entity?.createdAt ?: state.rows.last().entity.createdAt
            output += base.copy(entity = base.entity.copy(updatedAt = updatedAt,
                version = maxOf(base.entity.version, state.rows.size), syncState = "local"), completed = completed,
                completedTimes = next.completedTimes, qualityValue = next.qualityValue, qualityConfirmedAt = next.qualityConfirmedAt, note = next.note,skippedAt=next.skippedAt,
                score = scoreHabitFormula(habit.scoringMode, completed, next.qualityValue), xpAwarded = maxOf(base.xpAwarded, prior?.xpAwarded ?: 0))
        }
        return output
    }
    fun economy(workspace: LocalHabitWorkspace): LocalHabitWorkspace {
        if (workspace.history.isEmpty()) return workspace
        val days = workspace.history.filter { it.source!="decision" }.distinctBy { it.habitId to it.date }
        val keys = days.map { it.habitId to it.date }.toSet()
        return workspace.copy(completions = workspace.completions.filter { (it.habitId to it.date) !in keys }
            + days.mapNotNull { day ->
                val baselines=workspace.history.filter { it.habitId==day.habitId && it.date==day.date && it.source!="decision" }.mapNotNull { it.baseline }
                (baselines.firstOrNull { it.completed } ?: baselines.firstOrNull())?.copy(completed=baselines.any { it.completed },xpAwarded=baselines.maxOf { it.xpAwarded })
            }, measurements = workspace.measurements.filterNot { it.historical })
    }
    fun apply(workspace: LocalHabitWorkspace, command: HabitHistoryCommand, now: Instant = Instant.now()): LocalHabitWorkspace {
        val habit = workspace.habits.firstOrNull { it.id == command.habitId } ?: error("HABIT_HISTORY_DATE_UNAVAILABLE")
        val ruleState = HabitRuleHistory.state(habit, command.date); val rule = ruleState.rule
        val today = now.atZone(ZoneId.of(rule.schedule.timezone)).toLocalDate()
        val engine = HabitEngine(GenesisCalendar(ZoneId.of(rule.schedule.timezone)))
        require(command.date >= habit.createdDate && command.date < today && command.ruleId == rule.id && ruleState.conflicts.isEmpty()
            && engine.isScheduled(habit.copy(active = true,lifecycleHistory=emptyList()), command.date)) { "HABIT_HISTORY_DATE_UNAVAILABLE" }
        validate(command.value)
        val state = state(workspace.history, habit.id, command.date)
        workspace.history.firstOrNull { it.entity.id == command.id }?.let { replay ->
            val event = workspace.measurements.firstOrNull { it.entity.id == "${command.id}:value" }; val input = command.measurement
            require(replay.habitId == habit.id && replay.date == command.date && replay.ruleId == command.ruleId
                && replay.entity.createdAt == command.at && replay.value == command.value && replay.replaces.sorted() == command.heads.sorted()
                && (event != null) == (input != null) && (event == null || input != null && event.value == input.value
                    && event.note == input.note && event.entryId == (input.entryId ?: event.entity.id) && event.replaces.sorted() == input.replaces.sorted())) { "HABIT_HISTORY_ID_CONFLICT" }
            return workspace
        }
        require(state.heads.map { it.entity.id }.sorted() == command.heads.distinct().sorted()) { "HABIT_HISTORY_EDIT_CONFLICT" }
        val value = command.value
        require(if (habit.qualityScale == "none") value.qualityValue == null else value.qualityValue == null || value.qualityValue % 1.0 == 0.0
            && value.qualityValue in (if (habit.qualityScale == "ten") 1.0..10.0 else -5.0..5.0)) { "INVALID_HABIT_HISTORY" }
        require(!value.completed || habit.qualityScale == "none" || value.qualityValue != null && value.qualityConfirmedAt != null) { "INVALID_HABIT_HISTORY" }
        val times = habit.intervalSchedule?.takeIf { it.completionMode == "each" }?.times().orEmpty()
        val measured = HabitMeasurements.effective(rule) != null
        require(value.completedTimes.all { it in times } && (measured || times.isEmpty() || value.completed == times.all { it in value.completedTimes })) { "INVALID_HABIT_HISTORY" }
        val measurements = command.measurement?.let { input ->
            require(measured) { "INVALID_HABIT_HISTORY" }
            HabitMeasurements.append(habit, command.date, input.value, workspace.measurements, input.entryId, input.replaces,
                input.note, "${command.id}:value", command.at, "correction", true)
        } ?: workspace.measurements
        val baseline = economy(workspace).completions.firstOrNull { it.habitId == habit.id && it.date == command.date }
        val event = HabitHistoryEdit(TrackerEntity.create("habit-history", command.at, command.id), habit.id, command.date, rule.id,
            workspace.timerEpoch, command.heads, value, baseline)
        val history = merge(workspace.history, listOf(event))
        return workspace.copy(history = history, measurements = measurements, completions = project(workspace.habits, history, workspace.completions, measurements))
    }
}
