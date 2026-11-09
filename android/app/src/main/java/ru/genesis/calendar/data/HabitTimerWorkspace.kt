package ru.genesis.calendar.data

import android.content.Context
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID
import ru.genesis.calendar.domain.CalendarContext
import ru.genesis.calendar.domain.GenesisCalendar
import ru.genesis.calendar.domain.habits.*

data class HabitTimerCommand(val action: String, val owner: String, val at: String, val id: String,
    val sessionId: String? = null, val habitId: String? = null, val mode: String = "stopwatch",
    val workMinutes: Int = 25, val breakMinutes: Int = 5, val branchId: String? = null, val timeOnly: Boolean = false)

internal object HabitTimerDevice {
    @Synchronized fun owner(context: Context): String {
        val preferences = context.getSharedPreferences("genesis-habit-timer-device", Context.MODE_PRIVATE)
        preferences.getString("id", null)?.let { require(it.length in 1..100); return it }
        val id = "android-${UUID.randomUUID()}"
        check(preferences.edit().putString("id", id).commit()) { "HABIT_TIMER_DEVICE_STORAGE_FAILED" }
        return id
    }
}

/** Called inside the repository's Room transaction; a failed write leaves the finished session intact. */
internal object HabitTimerWorkspace {
    /** Save elapsed time only, so a hidden session cannot block the next habit's timer. */
    fun finishDisabled(workspace: LocalHabitWorkspace, at: String, owner: String): LocalHabitWorkspace {
        var operations = workspace.timers
        for (session in HabitTimers.sessions(operations)) {
            if (session.root.owner != owner) continue
            val habit = workspace.habits.firstOrNull { it.id == session.root.habitId } ?: continue
            if (habit.timerEnabled && session.root.plan?.mode in (habit.timerPreferences ?: HabitTimerPreferences()).modes) continue
            // Conflicting history still needs explicit resolution; unrelated edits must remain possible.
            val state = session.state ?: continue
            if (state.status in setOf("running", "paused")) {
                val finishedAt = Instant.parse(at)
                val allocations = HabitTimers.days(state, finishedAt).map { day ->
                    HabitTimerAllocation(day.date, day.workMs, day.value, requireNotNull(session.root.plan).ruleId, "not-duration")
                }
                operations = HabitTimers.append(operations, session.id, session.root.owner, "finish", finishedAt,
                    "timer-disabled:${UUID.randomUUID()}", allocations = allocations)
            }
            if (HabitTimers.sessions(operations).first { it.id == session.id }.state?.status == "finished")
                operations = HabitTimers.append(operations, session.id, session.root.owner, "save", Instant.parse(at), timeOnly = true)
        }
        return if (operations == workspace.timers) workspace else workspace.copy(timers = operations)
    }
    private fun scheduled(habit: Habit, date: LocalDate) = HabitEngine(GenesisCalendar()).isScheduled(habit, date)

    fun apply(workspace: LocalHabitWorkspace, command: HabitTimerCommand, now: Instant = Instant.now()): LocalHabitWorkspace {
        val at = Instant.parse(command.at); val operations = workspace.timers
        if (command.action == "start") {
            val habit = requireNotNull(workspace.habits.firstOrNull { it.id == command.habitId }) { "HABIT_TIMER_GOAL_CHANGED" }
            require(habit.timerEnabled) { "HABIT_TIMER_DISABLED" }
            require(command.mode in (habit.timerPreferences ?: HabitTimerPreferences()).modes) { "HABIT_TIMER_DISABLED" }
            val date = at.atZone(ZoneId.of(habit.periodGoal?.context?.timeZone ?: habit.schedule.timezone)).toLocalDate()
            require(scheduled(habit, date)) { "HABIT_TIMER_DATE_UNAVAILABLE" }
            val rule = HabitMeasurements.rule(habit, date)
            val zone = rule.periodGoal?.context?.timeZone ?: rule.schedule.timezone
            val context = (rule.periodGoal?.context ?: rule.schedule.recurrence.calendarContext ?: CalendarContext()).copy(timeZone = zone)
            val calendarMode = rule.periodGoal?.calendar ?: when (rule.schedule.recurrence.mode) { "classic" -> "profane"; "lunar" -> "lunar"; else -> "sacred" }
            val plan = HabitTimerPlan(command.mode, command.workMinutes, command.breakMinutes, zone, calendarMode, context, habit.title, rule.id)
            return workspace.copy(timers = HabitTimers.start(operations, habit.id, command.owner, plan, at, command.id, workspace.timerEpoch))
        }
        val session = HabitTimers.sessions(operations).firstOrNull { it.id == command.sessionId }
        require(session != null && session.root.owner == command.owner) { "HABIT_TIMER_OTHER_DEVICE" }
        if (command.action == "resume") {
            val habit = workspace.habits.firstOrNull { it.id == session.root.habitId }
            require(habit?.active == true) { "HABIT_TIMER_DATE_UNAVAILABLE" }
            require(habit.timerEnabled && session.root.plan?.mode in (habit.timerPreferences ?: HabitTimerPreferences()).modes) { "HABIT_TIMER_DISABLED" }
        }
        val state = session.state
        require(state != null || command.action == "resolve") { "HABIT_TIMER_CONFLICT" }
        if (command.action == "finish") {
            if (state?.status in setOf("finished", "saved")) return workspace
            val habit = workspace.habits.firstOrNull { it.id == session.root.habitId }
            val allocations = HabitTimers.days(requireNotNull(state), at).map { day ->
                val rule = habit?.let { HabitMeasurements.rule(it, day.date) }
                val reason = when {
                    habit == null || !habit.active || rule?.id != session.root.plan!!.ruleId -> "rule-conflict"
                    HabitRuleHistory.state(habit, day.date).conflicts.isNotEmpty() -> "rule-conflict"
                    !scheduled(habit, day.date) -> "not-scheduled"
                    rule?.measurement?.kind == "duration" && habit?.timerPreferences?.progress != "time-only" -> "duration"
                    else -> "not-duration"
                }
                HabitTimerAllocation(day.date, day.workMs, day.value, rule?.id ?: session.root.plan!!.ruleId, reason)
            }
            return workspace.copy(timers = HabitTimers.append(operations, session.id, command.owner, "finish", at, command.id, allocations))
        }
        if (command.action == "save") {
            if (state?.status == "saved") return workspace
            require(state?.status == "finished") { "HABIT_TIMER_NOT_FINISHED" }
            var measurements = workspace.measurements
            if (!command.timeOnly) {
                require(state.allocations.orEmpty().none { it.reason == "rule-conflict" }) { "HABIT_TIMER_GOAL_CHANGED" }
                val habit = workspace.habits.firstOrNull { it.id == session.root.habitId }
                val today = now.atZone(ZoneId.of(session.root.plan!!.timeZone)).toLocalDate()
                for (row in state.allocations.orEmpty()) {
                    if (row.reason != "duration" || row.value == 0L) continue
                    require(habit != null && scheduled(habit, row.date) && row.date >= habit.createdDate && row.date <= today
                        && HabitMeasurements.rule(habit, row.date).id == row.ruleId
                        && HabitMeasurements.rule(habit, row.date).measurement?.kind == "duration") { "HABIT_TIMER_GOAL_CHANGED" }
                    measurements = HabitMeasurements.append(habit, row.date, row.value, measurements,
                        operationId = "timer-value:${session.id}:${row.date}", timestamp = requireNotNull(state.finishedAt),
                        source = "timer", historical = row.date < today)
                }
            }
            val completions = HabitMeasurements.project(workspace.habits, measurements, workspace.completions,
                LocalDate.now(), HabitTimers.instant(now))
            return workspace.copy(measurements = measurements, completions = completions,
                timers = HabitTimers.append(operations, session.id, command.owner, "save", at, timeOnly = command.timeOnly))
        }
        return workspace.copy(timers = HabitTimers.append(operations, session.id, command.owner, command.action, at,
            command.id, branchId = command.branchId))
    }
}
