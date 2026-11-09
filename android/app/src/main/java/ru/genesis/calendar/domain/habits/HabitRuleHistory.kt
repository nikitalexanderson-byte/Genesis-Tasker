package ru.genesis.calendar.domain.habits

import java.time.LocalDate
import java.time.Instant
import java.util.UUID

data class HabitRuleState(val rule: HabitRuleVersion, val appliedVersion: HabitRuleVersion,
    val frontier: List<HabitRuleVersion>) {
    val conflicts get() = frontier.takeIf { it.size > 1 } ?: emptyList()
}

/** Legacy versions retain their historical chronological interpretation. */
object HabitRuleHistory {
    private val order=compareBy<HabitRuleVersion> { it.effectiveDate }.thenBy { it.recordedAt }.thenBy { it.id }
    private fun parents(rules: List<HabitRuleVersion>): Map<String,List<String>> {
        var legacy: String?=null
        return rules.sortedWith(order).associate { rule ->
            val prior=rule.supersedes ?: listOfNotNull(legacy)
            if(rule.supersedes==null) legacy=rule.id
            rule.id to prior
        }
    }
    private fun ancestors(id: String, parents: Map<String,List<String>>): Set<String> {
        val found=hashSetOf<String>();val pending=java.util.ArrayDeque(parents[id] ?: emptyList())
        while(pending.isNotEmpty()) {
            val parent=pending.removeLast()
            if(found.add(parent)) pending.addAll(parents[parent] ?: emptyList())
        }
        return found
    }
    fun validate(rules: List<HabitRuleVersion>) {
        val byId=rules.associateBy { it.id };require(byId.size==rules.size) { "HABIT_RULE_ID_CONFLICT" }
        val parents=parents(rules);val children=mutableMapOf<String,MutableList<String>>()
        val remaining=parents.mapValues { it.value.size }.toMutableMap()
        rules.forEach { rule ->
            val prior=parents.getValue(rule.id)
            require(prior.none { it==rule.id||it !in byId }&&prior.distinct().size==prior.size) { "INVALID_HABIT_RULE_HISTORY" }
            prior.forEach { children.getOrPut(it) { mutableListOf() }.add(rule.id) }
            rule.selectedRuleId?.let { id ->
                val selected=requireNotNull(byId[id]) { "INVALID_HABIT_RULE_HISTORY" }
                require(id in ancestors(rule.id,parents)&&selected.measurement==rule.measurement
                    &&selected.periodGoal==rule.periodGoal&&selected.schedule==rule.schedule) { "INVALID_HABIT_RULE_HISTORY" }
            }
        }
        val pending=java.util.ArrayDeque(remaining.filterValues { it==0 }.keys);var visited=0
        while(pending.isNotEmpty()) {
            val id=pending.removeLast();visited++
            children[id]?.forEach { child -> remaining[child]=remaining.getValue(child)-1
                if(remaining[child]==0) pending.add(child) }
        }
        require(visited==rules.size) { "INVALID_HABIT_RULE_HISTORY" }
    }
    fun state(habit: Habit,date: LocalDate): HabitRuleState {
        val sorted=habit.ruleHistory.sortedWith(order);val byId=sorted.associateBy { it.id };val parents=parents(sorted)
        val due=sorted.filter { it.effectiveDate<=date };val covered=hashSetOf<String>()
        val pending=java.util.ArrayDeque(due.flatMap { parents[it.id] ?: emptyList() })
        while(pending.isNotEmpty()) { val id=pending.removeLast()
            if(covered.add(id)) pending.addAll(parents[id] ?: emptyList()) }
        val heads=due.filter { it.id !in covered }
        val fallback=HabitRuleVersion("initial:${habit.id}",habit.createdDate,"1970-01-01T00:00:00.000Z",
            habit.measurement,habit.schedule,habit.periodGoal)
        var selected=heads.firstOrNull() ?: fallback
        if(heads.size>1) {
            val common=ancestors(heads.first().id,parents).toMutableSet()
            heads.drop(1).forEach { common.retainAll(ancestors(it.id,parents)) }
            selected=due.lastOrNull { it.id in common } ?: fallback
        }
        val applied=selected;val seen=hashSetOf<String>()
        while(selected.selectedRuleId!=null&&seen.add(selected.id)) selected=byId[selected.selectedRuleId] ?: selected
        return HabitRuleState(selected,applied,heads)
    }
    fun resolve(habit: Habit,chosenId: String,expectedHeads: List<String>,
        operationId: String="rule-choice:${UUID.randomUUID()}",timestamp: String=Instant.now().toString()): Habit {
        habit.ruleHistory.firstOrNull { it.id==operationId }?.let { existing ->
            require(existing.selectedRuleId==chosenId&&existing.supersedes==expectedHeads.sorted()) { "HABIT_RULE_ID_CONFLICT" }
            return habit
        }
        val heads=state(habit,LocalDate.MAX).frontier
        require(heads.size>1&&heads.map { it.id }.sorted()==expectedHeads.sorted()) { "HABIT_RULE_EDIT_CONFLICT" }
        val chosen=requireNotNull(heads.find { it.id==chosenId }) { "HABIT_RULE_EDIT_CONFLICT" }
        val choice=chosen.copy(id=operationId,recordedAt=timestamp,effectiveDate=heads.maxOf { it.effectiveDate },
            supersedes=heads.map { it.id }.sorted(),selectedRuleId=chosen.id)
        val history=(habit.ruleHistory+choice).sortedWith(order);validate(history)
        return habit.copy(measurement=chosen.measurement,periodGoal=chosen.periodGoal,schedule=chosen.schedule,
            ruleHistory=history,entity=habit.entity.changed(timestamp))
    }
}
