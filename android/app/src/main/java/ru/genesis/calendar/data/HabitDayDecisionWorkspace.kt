package ru.genesis.calendar.data

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import ru.genesis.calendar.domain.GenesisCalendar
import ru.genesis.calendar.domain.habits.*

data class HabitDayDecisionCommand(val id: String,val at: String,val habitId: String,val date: LocalDate,val heads: List<String>,val skipped: Boolean)

/** Today's explicit skip is causal intent, separate from historical corrections and earned rewards. */
internal object HabitDayDecisionWorkspace {
    fun apply(workspace: LocalHabitWorkspace,command: HabitDayDecisionCommand,now: Instant=Instant.now()): LocalHabitWorkspace {
        val habit=requireNotNull(workspace.habits.firstOrNull { it.id==command.habitId }) { "HABIT_HISTORY_DATE_UNAVAILABLE" }
        workspace.history.firstOrNull { it.entity.id==command.id }?.let { replay ->
            require(replay.source=="decision" && replay.habitId==habit.id && replay.date==command.date && replay.entity.createdAt==command.at
                && replay.value.skippedAt==(if(command.skipped) command.at else null) && replay.replaces.sorted()==command.heads.distinct().sorted()) { "HABIT_HISTORY_ID_CONFLICT" }
            return workspace
        }
        val rule=HabitRuleHistory.state(habit,command.date)
        val life=HabitLifecycle.state(habit,command.date)
        val engine=HabitEngine(GenesisCalendar(ZoneId.of(rule.rule.schedule.timezone)))
        require(command.date>=habit.createdDate && command.date==now.atZone(ZoneId.of(rule.rule.schedule.timezone)).toLocalDate()
            && Instant.parse(command.at).atZone(ZoneId.of(rule.rule.schedule.timezone)).toLocalDate()==command.date
            && !Instant.parse(command.at).isAfter(now.plusMillis(1000))
            && life.status=="active" && !life.conflict && rule.conflicts.isEmpty() && engine.isScheduled(habit,command.date)) { "HABIT_HISTORY_DATE_UNAVAILABLE" }
        val state=HabitHistory.state(workspace.history,habit.id,command.date)
        require(state.heads.map { it.entity.id }.sorted()==command.heads.distinct().sorted()) { "HABIT_HISTORY_EDIT_CONFLICT" }
        val current=workspace.completions.firstOrNull { it.habitId==habit.id && it.date==command.date }
        val value=HabitHistory.value(current).copy(skippedAt=if(command.skipped) command.at else null)
        require(!command.skipped || !value.completed) { "HABIT_HISTORY_ALREADY_COMPLETED" }
        val baseline=HabitHistory.economy(workspace).completions.firstOrNull { it.habitId==habit.id && it.date==command.date }
        val edit=HabitHistoryEdit(TrackerEntity.create("habit-decision",command.at,command.id),habit.id,command.date,rule.rule.id,workspace.timerEpoch,
            command.heads,value,baseline,"decision")
        val history=HabitHistory.merge(workspace.history,listOf(edit))
        return workspace.copy(history=history,completions=HabitHistory.project(workspace.habits,history,workspace.completions,workspace.measurements))
    }
}
