package ru.genesis.calendar.domain.habits

import org.junit.Assert.*
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId
import ru.genesis.calendar.domain.*

class HabitCoreTest {
    private val today=LocalDate.of(2026,9,23)
    private val stamp="2026-09-23T10:00:00.000Z"
    private val engine=HabitEngine(GenesisCalendar(ZoneId.of("Europe/Moscow")))
    private fun habit(mode: String = "binary") = Habit(TrackerEntity("h1",stamp,stamp),"Test",LocalDate.of(2026,9,1),
        engine.defaultSchedule(today,CalendarMode.PROFANE),scoringMode=mode)

    @Test fun futureStartIsSavedAndLockedTogetherWithScoringAfterCreation() {
        val future = today.plusDays(3)
        val planned = preserveHabitCreationSettings(habit().copy(
            schedule=engine.defaultSchedule(future,CalendarMode.LUNAR)),null,today)
        assertEquals(future,planned.createdDate)
        assertEquals(future,planned.schedule.startDate)
        assertFalse(engine.isScheduled(planned,today))
        val edited = preserveHabitCreationSettings(planned.copy(scoringMode="none",qualityScale="ten",
            schedule=engine.defaultSchedule(today,CalendarMode.PROFANE)),planned,today)
        assertEquals(future,edited.createdDate)
        assertEquals(future,edited.schedule.startDate)
        assertEquals(planned.scoringMode,edited.scoringMode)
        assertEquals(planned.qualityScale,edited.qualityScale)
        assertEquals("classic",edited.schedule.recurrence.mode)
    }

    @Test(expected=IllegalArgumentException::class)
    fun newHabitCannotStartInThePast() {
        preserveHabitCreationSettings(habit().copy(schedule=engine.defaultSchedule(today.minusDays(1),CalendarMode.PROFANE)),null,today)
    }

    @Test fun scoresMatch64ActualWebVectorsIncludingNegativeHalfRounding() {
        webScoreVectors.forEach { line ->
            val v=line.split('|')
            assertEquals(line,v[3].toInt(),scoreHabitFormula(v[0],v[1].toBoolean(),v[2].toDoubleOrNull()))
        }
    }

    @Test fun xpAwardsMatchWebMonotonicCap() {
        webXpVectors.forEach { line -> val v=line.split('|'); assertEquals(line,v[2].toInt(),completionXpAward(v[0].toDouble(),v[1].toDouble())) }
    }

    @Test fun completionHistoryMatches20ActualWebMutations() {
        webUpdateVectors.groupBy { it.substringBefore('|') }.forEach { (mode,vectors) ->
            var entries=emptyList<HabitCompletion>()
            vectors.forEach { line ->
                val v=line.split('|')
                entries=engine.updateCompletion(entries,habit(mode),today,today,v[1].toBoolean(),v[2].toDoubleOrNull(),"",stamp,"test-completion")
                assertEquals(1,entries.size)
                val c=entries.single()
                assertEquals(line,listOf(mode,v[1],v[2],c.score,c.xpAwarded,c.entity.version,c.entity.syncState).joinToString("|"))
                assertEquals("habit-completion:h1:2026-09-23",c.entity.id)
            }
        }
    }

    @Test fun cannotRecordPastFutureOrBeforeCreationAndPreservesOtherEntities() {
        val unrelated=HabitCompletion(TrackerEntity("other",stamp,stamp),"other-habit",today,true,score=10,xpAwarded=10)
        val entries=listOf(unrelated)
        assertSame(entries,engine.updateCompletion(entries,habit(),today.minusDays(1),today,true,null,"",stamp))
        assertSame(entries,engine.updateCompletion(entries,habit(),today.plusDays(1),today,true,null,"",stamp))
        assertSame(entries,engine.updateCompletion(entries,habit().copy(createdDate=today.plusDays(1)),today,today,true,null,"",stamp))
        assertEquals(unrelated,engine.updateCompletion(entries,habit(),today,today,true,null,"",stamp).first())
    }

    @Test fun savedHabitCalendarIsNotReplacedByDisplayChoiceAndInactiveIsExcluded() {
        val monday=LocalDate.of(2026,9,21)
        val saved=habit().copy(schedule=TrackerSchedule(monday,timezone="Europe/Moscow",recurrence=RecurrenceConfig(true,"classic","weekdays",days=listOf(1))))
        assertTrue(engine.isScheduled(saved,monday))
        assertFalse(engine.isScheduled(saved,today))
        assertFalse(engine.isScheduled(saved.copy(active=false),monday))
        assertEquals("classic",engine.normalizeSchedule(saved.schedule).recurrence.mode)
    }

    @Test fun duplicateCompletionsDoNotInflateDailyGoalCounts() {
        val c=HabitCompletion(TrackerEntity("c",stamp,stamp),"h1",today,true)
        assertEquals(1 to 1,engine.dailyCounts(listOf(habit()),listOf(c,c.copy(entity=c.entity.copy(id="c2"))),today))
    }

    @Test fun rankBoundariesMatch86ActualWebVectorsAndHiddenRankNeedsReveal() {
        webRankVectors.forEach { line ->
            val v=line.split('|'); val xp=v[0].toInt()
            assertEquals(line,listOf(xp,HeroProgress.highestRank(xp)?.id ?: "null",HeroProgress.nextRank(xp)?.id ?: "null",HeroProgress.rankForProgress(UserProgress(lifetimeXp=xp)).id).joinToString("|"))
        }
        assertEquals(28,HeroRankCatalog.ranks.size)
        assertEquals(8,HeroRankCatalog.checkpoints.size)
        assertEquals("mirror-victor",HeroProgress.rankForProgress(UserProgress(lifetimeXp=14000,hiddenHeroicPathRevealedAt=stamp)).id)
    }

    @Test fun reconcileLifetimeXpDoesNotReawardOrRevokeWhenUnchecked() {
        val initial=HeroProgress.reconcile(UserProgress(),listOf(10,20),stamp)
        assertEquals(30,initial.lifetimeXp)
        val retry=HeroProgress.reconcile(initial,listOf(10,20),"2026-09-23T11:00:00.000Z")
        assertEquals(initial,retry)
        val removed=HeroProgress.reconcile(initial,emptyList(),"2026-09-23T12:00:00.000Z")
        assertEquals(initial,removed)
    }
}
