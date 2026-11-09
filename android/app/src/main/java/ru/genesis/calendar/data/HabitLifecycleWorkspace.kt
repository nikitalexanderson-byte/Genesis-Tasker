package ru.genesis.calendar.data

import java.time.Instant
import java.util.UUID
import ru.genesis.calendar.domain.habits.*

internal fun observeChangedHabitAvailability(previous: LocalHabitWorkspace, next: LocalHabitWorkspace, at: String): LocalHabitWorkspace {
    fun changedRecords(id: String) = previous.completions.filter { it.habitId==id }!=next.completions.filter { it.habitId==id }
        || previous.measurements.filter { it.habitId==id }!=next.measurements.filter { it.habitId==id }
        || previous.history.filter { it.habitId==id }!=next.history.filter { it.habitId==id }
        || previous.timers.filter { it.habitId==id }!=next.timers.filter { it.habitId==id }
    return next.copy(habits=next.habits.map { habit ->
        val old=previous.habits.firstOrNull { it.id==habit.id }
        if(habit.lifecycleHistory.isNotEmpty() || old==habit && !changedRecords(habit.id)) habit
        else HabitLifecycle.apply(habit,HabitLifecycleCommand("habit-observed:${UUID.randomUUID()}",habit.id,at,"observe",emptyList()))
    })
}

/** Runs inside the same Room transaction as the encrypted document and outbox write. */
internal object HabitLifecycleWorkspace {
    fun apply(workspace: LocalHabitWorkspace, command: HabitLifecycleCommand): LocalHabitWorkspace {
        val habit=requireNotNull(workspace.habits.firstOrNull { it.id==command.habitId }) { "HABIT_LIFECYCLE_TRANSITION_UNAVAILABLE" }
        val changed=HabitLifecycle.apply(habit,command)
        if(changed.lifecycleHistory==habit.lifecycleHistory) return workspace
        var timers=workspace.timers
        if(!changed.active) for(session in HabitTimers.sessions(timers).filter { it.root.habitId==habit.id }) {
            val state=requireNotNull(session.state) { "HABIT_TIMER_CONFLICT" }
            if(state.status=="running") timers=HabitTimers.append(timers,session.id,session.root.owner,"pause",Instant.parse(command.at),
                "${command.id}:timer:${session.id}")
        }
        val finite=HabitPracticeGoals.progress(habit,workspace.completions,java.time.LocalDate.parse(command.at.take(10)))
        val rewards=if(command.action!="delete" || command.automaticPoints != null || finite != null) workspace.rewards
            else if(habitCompletionCount(HabitHistory.economy(workspace).completions,habit.id)>=HABIT_LAUREL_RETENTION_COMPLETIONS)
                Rewards.retainMastery(workspace.rewards,habit.id,command.at)
            else Rewards.reset(workspace.rewards,"habit-deleted-reset",habit.id,"habit-deleted:self:${habit.id}:${command.id}",command.at)
        return workspace.copy(habits=workspace.habits.map { if(it.id==habit.id) changed.copy(entity=changed.entity.changed(command.at)) else it },
            timers=timers,rewards=rewards,progress=workspace.progress.copy(laurelsBalance=Rewards.balance(rewards)))
    }
}
