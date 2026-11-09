package ru.genesis.calendar.domain.habits

import java.time.*
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.domain.*

class HabitRuleHistoryTest {
    private val day=LocalDate.parse("2026-05-04")
    private val stamp="2026-05-04T12:00:00.000Z"
    private val engine=HabitEngine(GenesisCalendar(ZoneId.of("UTC")))
    private fun habit()=Habit(TrackerEntity.create("habit",stamp,"causal-habit"),"Synthetic rule history",day,
        engine.defaultSchedule(day,CalendarMode.PROFANE),measurement=HabitMeasurement("quantity","pages",100_000,25_000))
    private fun conflict(): Habit {
        val habit=habit();val root=HabitMeasurements.rule(habit,day)
        return habit.copy(ruleHistory=listOf(root,
            root.copy(id="left",recordedAt=stamp,measurement=habit.measurement!!.copy(target=150_000),supersedes=listOf(root.id)),
            root.copy(id="right",recordedAt=stamp,measurement=habit.measurement.copy(target=200_000),supersedes=listOf(root.id))))
    }
    @Test fun independentRulesAreNeutralWhileSequentialAndLegacyRulesRetainTheirMeaning() {
        val habit=conflict();HabitRuleHistory.validate(habit.ruleHistory)
        assertEquals(2,HabitRuleHistory.state(habit,day).conflicts.size)
        assertEquals("initial:${habit.id}",HabitMeasurements.rule(habit,day).id)
        assertFalse(engine.isScheduled(habit,day))
        assertThrows(IllegalArgumentException::class.java) { preserveHabitCreationSettings(habit,habit,day,stamp) }
        val sequential=habit.copy(ruleHistory=habit.ruleHistory.map { if(it.id=="right") it.copy(supersedes=listOf("left")) else it })
        assertEquals("right",HabitMeasurements.rule(sequential,day).id)
        assertTrue(HabitRuleHistory.state(sequential,day).conflicts.isEmpty())
        val legacy=habit.copy(ruleHistory=habit.ruleHistory.map { it.copy(supersedes=null) })
        assertEquals("right",HabitMeasurements.rule(legacy,day).id)
        assertTrue(HabitRuleHistory.state(legacy,day).conflicts.isEmpty())
    }
    @Test fun explicitChoiceKeepsEventRuleIdsAndTheEarnedXpAcrossReplay() {
        val habit=conflict();val one=habit.copy(ruleHistory=habit.ruleHistory.filterNot { it.id=="right" })
        val events=HabitMeasurements.append(one,day,150_000,emptyList(),operationId="owned-entry",timestamp=stamp)
        val completions=HabitMeasurements.project(listOf(one),events,emptyList(),day,stamp)
        val blocked=HabitMeasurements.project(listOf(habit),events,completions,day,stamp)
        assertFalse(blocked.single().completed);assertEquals(10,blocked.single().xpAwarded)
        val chosen=HabitRuleHistory.resolve(habit,"left",listOf("left","right"),"choice",stamp)
        assertEquals(4,chosen.ruleHistory.size);assertEquals("left",HabitMeasurements.rule(chosen,day).id)
        assertTrue(HabitMeasurements.progress(chosen,day,events).completed)
        assertSame(chosen,HabitRuleHistory.resolve(chosen,"left",listOf("left","right"),"choice",stamp))
        assertEquals(10,HabitMeasurements.project(listOf(chosen),events,blocked,day,stamp).single().xpAwarded)
        assertThrows(IllegalArgumentException::class.java) { HabitRuleHistory.resolve(chosen,"right",listOf("left","right"),"choice",stamp) }
    }
    @Test fun twoConcurrentChoicesStayExplicitAndStaleChoiceCannotEraseAnotherBranch() {
        val habit=conflict();val one=HabitRuleHistory.resolve(habit,"left",listOf("left","right"),"choice-left",stamp)
        val two=HabitRuleHistory.resolve(habit,"right",listOf("left","right"),"choice-right",stamp)
        val merged=habit.copy(ruleHistory=(one.ruleHistory+two.ruleHistory).distinctBy { it.id })
        HabitRuleHistory.validate(merged.ruleHistory)
        assertEquals(2,HabitRuleHistory.state(merged,day).conflicts.size)
        val extra=habit.copy(ruleHistory=habit.ruleHistory+habit.ruleHistory.last().copy(id="third"))
        assertThrows(IllegalArgumentException::class.java) { HabitRuleHistory.resolve(extra,"left",listOf("left","right"),"stale",stamp) }
    }
    @Test fun brokenGraphsAndInventedChoicesAreRejected() {
        val habit=conflict();val root=habit.ruleHistory.first();val left=habit.ruleHistory[1];val right=habit.ruleHistory[2]
        listOf(listOf(root,left.copy(supersedes=listOf("missing"))),
            listOf(root,left.copy(supersedes=listOf("right")),right.copy(supersedes=listOf("left"))),
            listOf(root,left.copy(selectedRuleId=root.id)),listOf(root,left,left.copy(supersedes=emptyList()))).forEach { rules ->
            assertThrows(IllegalArgumentException::class.java) { HabitRuleHistory.validate(rules) }
        }
    }
    @Test fun resolvingAPastPeriodRestoresStatisticsWithoutRetroactiveRewards() {
        val base=habit().copy(measurement=null,periodGoal=HabitPeriodGoal(period="week",metric="entries",target=1,
            calendar="profane",context=CalendarContext(timeZone="UTC")))
        val root=HabitMeasurements.rule(base,day)
        val left=root.copy(id="left",supersedes=listOf(root.id));val right=root.copy(id="right",supersedes=listOf(root.id),periodGoal=root.periodGoal!!.copy(target=2))
        val habit=base.copy(ruleHistory=listOf(root,left,right))
        val one=habit.copy(ruleHistory=listOf(root,left))
        val events=HabitMeasurements.append(one,day,1000,emptyList(),timestamp=stamp)
        val chosen=HabitRuleHistory.resolve(habit,"left",listOf("left","right"),"late","2026-05-20T12:00:00Z")
        val state=HabitPeriodGoals.progress(chosen,day.plusDays(6),events,emptyList(),Instant.parse("2026-05-20T12:00:00Z"))!!
        assertTrue(state.completed);assertFalse(state.rewardEligible)
    }
}
