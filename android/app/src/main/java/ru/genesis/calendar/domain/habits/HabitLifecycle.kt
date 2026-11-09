package ru.genesis.calendar.domain.habits

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

data class HabitLifecycleEvent(val id: String, val habitId: String, val at: String, val date: LocalDate,
    val action: String, val status: String, val replaces: List<String>, val baselineActive: Boolean,
    val selectedId: String? = null, val automaticPoints: String? = null)
data class HabitLifecycleCommand(val id: String, val habitId: String, val at: String, val action: String,
    val heads: List<String>, val selectedId: String? = null, val automaticPoints: String? = null)

/** Immutable availability history, separate from earned credits and the measurement journal. */
object HabitLifecycle {
    fun state(habit: Habit, date: LocalDate = LocalDate.MAX) = state(habit.id, habit.active, habit.lifecycleHistory, date)
    fun project(habit: Habit): Habit {
        val events = merge(habit.lifecycleHistory)
        valid(events.all { it.habitId == habit.id })
        if (events.isEmpty()) return habit
        val state = state(habit.id, habit.active, events)
        return habit.copy(active = state.status == "active" && !state.conflict, lifecycleHistory = events)
    }
    fun apply(habit: Habit, command: HabitLifecycleCommand): Habit = project(habit.copy(lifecycleHistory =
        apply(habit.id, habit.active, habit.schedule.timezone, habit.lifecycleHistory, command)))
    data class State(val rows: List<HabitLifecycleEvent>, val heads: List<HabitLifecycleEvent>, val status: String,
        val conflict: Boolean, val baselineActive: Boolean, val unknown: Boolean)
    private val statuses = setOf("active", "paused", "archived", "deleted")
    private val actions = setOf("pause", "resume", "archive", "delete", "restore", "resolve", "observe")
    private val transitions = mapOf(
        "active" to mapOf("pause" to "paused", "archive" to "archived", "delete" to "deleted", "observe" to "active"),
        "paused" to mapOf("resume" to "active", "archive" to "archived", "delete" to "deleted", "observe" to "paused"),
        "archived" to mapOf("restore" to "paused", "delete" to "deleted", "observe" to "archived"),
        "deleted" to mapOf("restore" to "paused", "observe" to "deleted"))
    private fun compatibleObservations(rows: List<HabitLifecycleEvent>)=rows.isNotEmpty() && rows.all { it.action=="observe" && it.status==rows.first().status }
    private fun validId(value: String) = value.isNotEmpty() && value.length <= 512
    private fun instant(value: String) = try { HabitTimers.instant(Instant.parse(value)) }
        catch (_: Exception) { throw IllegalArgumentException("INVALID_HABIT_LIFECYCLE") }
    private fun valid(condition: Boolean) { require(condition) { "INVALID_HABIT_LIFECYCLE" } }

    fun merge(vararg sources: List<HabitLifecycleEvent>): List<HabitLifecycleEvent> {
        val events = linkedMapOf<String, HabitLifecycleEvent>()
        for (source in sources) for (row in source) {
            valid(row.automaticPoints == null || row.action == "delete" && row.automaticPoints in setOf("keep", "remove"))
            valid(validId(row.id) && validId(row.habitId) && row.status in statuses && row.action in actions
                && row.date.year in 1..9999 && row.replaces.size <= 64 && row.replaces.all { validId(it) && it != row.id }
                && if (row.action == "resolve") row.selectedId?.let(::validId) == true else row.selectedId == null)
            val normalized = row.copy(at = instant(row.at), replaces = row.replaces.distinct().sorted(),
                automaticPoints = HabitAutoDelete.automaticPoints(row.id, row.action, row.automaticPoints))
            val previous = events[row.id]
            require(previous == null || previous == normalized) { "HABIT_LIFECYCLE_ID_CONFLICT" }
            events[row.id] = normalized
        }
        val rows = events.values.sortedWith(compareBy<HabitLifecycleEvent> { it.at }.thenBy { it.id })
        val visiting = mutableSetOf<String>(); val visited = mutableSetOf<String>()
        fun visit(row: HabitLifecycleEvent) {
            valid(row.id !in visiting)
            if (row.id in visited) return
            visiting.add(row.id)
            for (id in row.replaces) {
                val parent = events[id] ?: throw IllegalArgumentException("INVALID_HABIT_LIFECYCLE")
                valid(parent.habitId == row.habitId && parent.at <= row.at && parent.date <= row.date)
                visit(parent)
            }
            if (row.selectedId != null) valid(row.selectedId in row.replaces && events[row.selectedId]?.status == row.status)
            if (row.action == "resolve") {
                valid(row.replaces.size >= 2)
                val frontier = row.replaces.toSet()
                for (parentId in row.replaces) {
                    val pending = ArrayDeque(events.getValue(parentId).replaces); val seen = mutableSetOf<String>()
                    while (pending.isNotEmpty()) {
                        val ancestor = pending.removeLast()
                        valid(ancestor !in frontier)
                        if (seen.add(ancestor)) pending.addAll(events.getValue(ancestor).replaces)
                    }
                }
            } else {
                valid(row.replaces.size <= 1 || compatibleObservations(row.replaces.map { events.getValue(it) }))
                val before = row.replaces.firstOrNull()?.let { events.getValue(it).status }
                    ?: if (row.baselineActive) "active" else "paused"
                valid(transitions[before]?.get(row.action) == row.status)
            }
            visiting.remove(row.id); visited.add(row.id)
        }
        rows.forEach(::visit)
        return rows
    }

    fun state(habitId: String, active: Boolean, events: List<HabitLifecycleEvent>, date: LocalDate = LocalDate.MAX): State {
        val all = events.filter { it.habitId == habitId }; val rows = all.filter { it.date <= date }
        val replaced = rows.flatMap { it.replaces }.toSet(); val heads = rows.filter { it.id !in replaced }
        val roots = all.filter { it.replaces.isEmpty() }; val baselineUncertain = roots.map { it.baselineActive }.distinct().size > 1
        val baseline = roots.firstOrNull()?.baselineActive ?: active; val compatible=compatibleObservations(heads);val conflict = heads.size > 1 && !compatible
        val status = (if(compatible) heads.first().status else heads.singleOrNull()?.status) ?: if (conflict) {
            if (heads.any { it.status == "deleted" }) "deleted" else if (heads.any { it.status == "archived" }) "archived" else "paused"
        } else if (!baselineUncertain && baseline) "active" else "paused"
        return State(rows, heads, status, conflict, baseline, heads.isEmpty() && baselineUncertain)
    }

    /** Returning from archive or deletion preserves the ID and requires a separate Resume. */
    fun apply(habitId: String, active: Boolean, timezone: String, events: List<HabitLifecycleEvent>, command: HabitLifecycleCommand): List<HabitLifecycleEvent> {
        valid(habitId == command.habitId && validId(command.id) && command.action in actions && command.heads.all(::validId))
        val journal = merge(events); val at = instant(command.at)
        valid(command.automaticPoints == null || command.action == "delete" && command.automaticPoints in setOf("keep", "remove"))
        journal.firstOrNull { it.id == command.id }?.let { replay ->
            require(replay.habitId == command.habitId && replay.at == at && replay.action == command.action
                && replay.selectedId == command.selectedId && replay.replaces == command.heads.distinct().sorted()
                && replay.automaticPoints == HabitAutoDelete.automaticPoints(command.id,command.action,command.automaticPoints)) { "HABIT_LIFECYCLE_ID_CONFLICT" }
            return events
        }
        val state = state(habitId, active, journal)
        require(state.heads.map { it.id }.sorted() == command.heads.distinct().sorted()) { "HABIT_LIFECYCLE_EDIT_CONFLICT" }
        val selected = if (command.action == "resolve") state.heads.firstOrNull { it.id == command.selectedId } else null
        val status = if (command.action == "resolve") selected?.status else if (state.conflict) null else transitions[state.status]?.get(command.action)
        require(status != null && if (command.action == "resolve") state.conflict else command.selectedId == null) { "HABIT_LIFECYCLE_TRANSITION_UNAVAILABLE" }
        val date = Instant.parse(at).atZone(ZoneId.of(timezone)).toLocalDate()
        require(state.heads.none { it.at > at || it.date > date }) { "HABIT_LIFECYCLE_CLOCK_CONFLICT" }
        return merge(journal, listOf(HabitLifecycleEvent(command.id, habitId, at, date, command.action, status,
            command.heads.distinct().sorted(), state.baselineActive, selected?.id, command.automaticPoints)))
    }
}
