package ru.genesis.calendar.data

import java.time.Instant
import java.time.ZoneId
import ru.genesis.calendar.domain.GenesisCalendar
import ru.genesis.calendar.domain.habits.*

internal object HabitAutoDeleteWorkspace {
    fun apply(workspace: LocalHabitWorkspace, now: Instant = Instant.now()): LocalHabitWorkspace {
        var next = reconcileEvidence(workspace)
        if(workspace.settings.enabled) for(habit in next.habits) {
            val policy = habit.autoDeletePolicy ?: continue
            val state = HabitLifecycle.state(habit)
            if(state.status != "active" || state.conflict) continue
            val zone = ZoneId.of(habit.schedule.timezone)
            val today = now.atZone(zone).toLocalDate()
            val engine = HabitEngine(GenesisCalendar(zone))
            val evidence = if(habit.periodGoal != null || habit.ruleHistory.any { it.periodGoal != null })
                HabitPeriodGoals.goalCompletions(listOf(habit),workspace.measurements,workspace.completions,
                    maxOf(habit.createdDate,policy.startOn),today,now,false)
                else workspace.completions.filter { it.habitId == habit.id }
            val successes=if(HabitPeriodGoals.progress(habit,today,workspace.measurements,workspace.completions,now)?.completed==true)
                evidence+HabitCompletion(TrackerEntity.create("habit-auto-delete-evidence"),habit.id,today,completed=true) else evidence
            val due = HabitAutoDelete.due(policy,habit.createdDate,today,successes,
                { day -> HabitLifecycle.state(habit,day).let { availability ->
                    if(HabitRuleHistory.state(habit,day).conflicts.isNotEmpty()) availability.copy(conflict=true) else availability } },
                { day -> if(HabitMeasurements.rule(habit,day).periodGoal != null)
                    HabitPeriodGoals.settlement(habit,day,workspace.measurements,workspace.completions,now)?.status == "missed"
                    else engine.isScheduled(habit,day,workspace.completions) }) ?: continue
            val at = (state.heads.map { Instant.parse(it.at) } + due.deadline.atStartOfDay(zone).toInstant()).maxOrNull()!!.toString()
            next = HabitLifecycleWorkspace.apply(next,HabitLifecycleCommand(due.id,habit.id,at,"delete",state.heads.map { it.id },automaticPoints=policy.points))
        }
        return reconcilePoints(next)
    }

    fun reconcilePoints(workspace: LocalHabitWorkspace): LocalHabitWorkspace {
        val cutoffs = workspace.habits.mapNotNull { habit -> habit.lifecycleHistory.filter {
            HabitAutoDelete.automaticPoints(it.id,it.action,it.automaticPoints) == "remove"
                && habit.lifecycleHistory.none { row -> row.id == "habit-auto-delete-reset:${it.id}:restore" }
        }.maxOfOrNull { it.date }?.let { habit.id to it } }.toMap()
        if(cutoffs.isEmpty() && workspace.progress.forfeitedHabitXp == null) return workspace
        val credits = HabitPracticeGoals.xpEntries(workspace.habits,HabitHistory.economy(workspace).completions)
            .filter { row -> cutoffs[row.habitId]?.let { row.date < it } == true }
        val forfeited = habitCompletionCredits(credits).sum()
        val previous = workspace.progress
        val gross = previous.grossLifetimeXp ?: previous.lifetimeXp + (previous.forfeitedHabitXp ?: 0)
        val progress = HeroProgress.reconcile(previous.copy(grossLifetimeXp=gross,forfeitedHabitXp=forfeited),
            habitCompletionCredits(HabitPracticeGoals.xpEntries(workspace.habits,workspace.completions)),previous.updatedAt)
        return if(progress == previous) workspace else workspace.copy(progress=progress)
    }

    fun reconcileEvidence(workspace: LocalHabitWorkspace): LocalHabitWorkspace {
        var next=workspace
        for(habit in workspace.habits) {
            val state=HabitLifecycle.state(habit)
            val event=state.heads.singleOrNull() ?: continue
            if(state.conflict || state.status!="deleted" || HabitAutoDelete.automaticPoints(event.id,event.action,event.automaticPoints)==null) continue
            val firstMissed=Regex("habit-auto-delete:[a-f0-9-]{36}:(\\d{4}-\\d{2}-\\d{2}):.*").matchEntire(event.id)?.groupValues?.get(1)?.let(java.time.LocalDate::parse) ?: continue
            if(workspace.completions.none { it.habitId==habit.id && it.completed && it.date>=firstMissed }) continue
            val restoreId="habit-auto-delete-reset:${event.id}:restore"
            next=HabitLifecycleWorkspace.apply(next,HabitLifecycleCommand(restoreId,habit.id,event.at,"restore",listOf(event.id)))
            next=HabitLifecycleWorkspace.apply(next,HabitLifecycleCommand("habit-auto-delete-reset:${event.id}:resume",habit.id,event.at,"resume",listOf(restoreId)))
        }
        return next
    }
}
