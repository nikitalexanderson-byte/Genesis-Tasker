package ru.genesis.calendar.domain

import java.time.LocalDate
import java.time.ZoneId
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.domain.habits.HabitCompletion
import ru.genesis.calendar.domain.habits.TrackerEntity
import ru.genesis.calendar.domain.habits.Habit
import ru.genesis.calendar.domain.habits.HabitEngine
import ru.genesis.calendar.domain.habits.HabitLifecycle
import ru.genesis.calendar.domain.habits.HabitLifecycleCommand
import ru.genesis.calendar.domain.habits.HabitIntervalSchedule
import ru.genesis.calendar.domain.habits.HabitMeasurement
import ru.genesis.calendar.domain.habits.HabitPeriodGoal

class StoicheionRestorationTest {
    @Test fun greekWordsUseTheSameAncientNumeralsAndAccentNormalizationAsTheWeb() {
        StoicheionRestoration.supports.forEach {
            assertEquals(it.value.toLong(), StoicheionRestoration.isopsephy(it.word))
        }
        assertEquals(571L, StoicheionRestoration.isopsephy("ΤΑΞΙΣ"))
        assertEquals(571L, StoicheionRestoration.isopsephy("ταξις"))
        assertEquals(6L, StoicheionRestoration.isopsephy("Ϛ"))
        assertEquals(9, StoicheionRestoration.root(2700))
        assertEquals(listOf(2701L, 10L, 1L), StoicheionRestoration.trace(2701))
        for (invalid in listOf("", "logos", "Α  Β", "Α!")) {
            assertThrows(IllegalArgumentException::class.java) { StoicheionRestoration.isopsephy(invalid) }
        }
        assertThrows(IllegalArgumentException::class.java) { StoicheionRestoration.root(0) }
        assertThrows(IllegalArgumentException::class.java) { StoicheionRestoration.root(9_007_199_254_740_992L) }
    }

    @Test fun theAgreedBetaXiHearthExamplePreservesTheOriginalRoot() {
        val equation = StoicheionRestoration.equation(2, 2701, listOf("hearth"))
        assertEquals(1, equation.target)
        assertEquals(6, equation.requiredRoot)
        assertEquals(listOf("xi", "chi"), equation.candidates.map { it.id })
        assertEquals(listOf(172L, 10L, 1L), StoicheionRestoration.trace(2 + 60 + equation.supportTotal.toLong()))
        assertEquals(listOf("hearth"), equation.supports.map { it.id })
    }

    @Test fun allNineRootsAndAllThirtyTwoAuxiliarySelectionsHaveExactlyTheCompatibleAlphabetLetters() {
        for (target in 1..9) for (card in StoicheionRestoration.letters) for (mask in 0 until 32) {
            val supports = StoicheionRestoration.supports.filterIndexed { index, _ -> mask and (1 shl index) != 0 }
            val equation = StoicheionRestoration.equation(card.value, target, supports.reversed().map { it.id })
            val compatible = StoicheionRestoration.letters.filter { letter ->
                StoicheionReading.pythmen(card.value + letter.value + supports.sumOf { it.value }) == target
            }
            assertEquals(compatible, equation.candidates)
            assertTrue(equation.candidates.isNotEmpty())
            assertEquals(supports, equation.supports)
        }
        assertEquals(StoicheionRestoration.equation(2, 2701, listOf("hearth", "entrance")),
            StoicheionRestoration.equation(2, 2701, listOf("entrance", "hearth", "hearth")))
        assertThrows(IllegalArgumentException::class.java) { StoicheionRestoration.equation(2, 2701, listOf("north")) }
    }

    @Test fun tetractysCountsTenDistinctRealDaysAfterTheCycleStartedAndRetainsProgressAcrossGaps() {
        val source = fixture()
        val start = LocalDate.parse(source.startedDate)
        val entries = (-1..14).map { offset -> HabitCompletion(
            TrackerEntity.create("entry", "2026-10-22T12:01:00Z", "entry-$offset"), "habit", start.plusDays(offset.toLong()), true) }
        val duplicated = entries + entries[2] + HabitCompletion(
            TrackerEntity.create("entry", "2026-10-22T11:59:59Z", "old"), "habit", start.plusDays(2), true)
        assertEquals((0L..9L).map(start::plusDays), StoicheionRestoration.completionDates(source, "habit", duplicated, start.plusDays(10)))
        val withGap = entries.filterNot { it.date == start.plusDays(1) }
        assertEquals(listOf(start, start.plusDays(2), start.plusDays(3)),
            StoicheionRestoration.completionDates(source, "habit", withGap, start.plusDays(3)))
        assertTrue(StoicheionRestoration.completionDates(source, "different", entries, start.plusDays(20)).isEmpty())
        val linkedAfterTodaysCompletion = source.copy(excludeStartDate = true)
        assertEquals(listOf(start.plusDays(1)), StoicheionRestoration.completionDates(linkedAfterTodaysCompletion,
            "habit", entries, start.plusDays(1)))
    }

    @Test fun restoredCopiesRemainSeparateHabitsAndOnlyNewLinksRequireAFreeSourceCycle() {
        val snapshot = fixture()
        val day = LocalDate.parse(snapshot.startedDate)
        val original = Habit(TrackerEntity.create("habit", snapshot.startedAt, "original"), "Original", day,
            HabitEngine(GenesisCalendar()).defaultSchedule(day, CalendarMode.PROFANE), stoicheionRestoration = snapshot)
        val copy = original.copy(entity = TrackerEntity.create("habit", snapshot.startedAt, "copy"), title = "Restored copy")
        assertEquals(listOf("original", "copy"), StoicheionRestoration.visibleHabits(listOf(original, copy)).map { it.id })
        assertEquals(copy, StoicheionRestoration.habitById(listOf(original, copy), copy.id))
        assertTrue(StoicheionRestoration.canAttach(listOf(original, copy), copy.id, snapshot, snapshot))
        assertFalse(StoicheionRestoration.canAttach(listOf(original), "new", null, snapshot))
        val deleted = HabitLifecycle.apply(original, HabitLifecycleCommand("delete", original.id,
            "2026-10-22T13:00:00Z", "delete", emptyList()))
        assertEquals(listOf(copy), StoicheionRestoration.visibleHabits(listOf(deleted, copy)))
        assertTrue(StoicheionRestoration.canAttach(listOf(deleted), "new", null, snapshot))
        val paused = HabitLifecycle.apply(original, HabitLifecycleCommand("pause", original.id,
            "2026-10-22T13:00:00Z", "pause", emptyList()))
        assertEquals(listOf(paused), StoicheionRestoration.visibleHabits(listOf(paused)))
    }

    @Test fun onlySimpleActiveHabitsCanBeLinkedWithoutBypassingTheirTrackingRules() {
        val date = LocalDate.of(2026, 10, 22)
        val base = Habit(TrackerEntity.create("habit", "2026-10-22T12:00:00Z", "simple"), "Simple", date,
            HabitEngine(GenesisCalendar()).defaultSchedule(date, CalendarMode.PROFANE))
        val variants = listOf(base, base.copy(active = false), base.copy(stoicheionRestoration = fixture()),
            base.copy(schedule = base.schedule.copy(recurrence = base.schedule.recurrence.copy(enabled = false))),
            base.copy(scoringMode = "quality-ten"), base.copy(intervalSchedule = HabitIntervalSchedule(60, "09:00", "10:00", "each")),
            base.copy(measurement = HabitMeasurement("quantity", "count", 1000, 1000)),
            base.copy(periodGoal = HabitPeriodGoal(period = "week", metric = "entries", target = 3,
                calendar = "profane", context = CalendarContext(timeZone = "Europe/Moscow"))))
        assertEquals(listOf(base), StoicheionRestoration.eligibleHabits(variants))
    }

    @Test fun aNewCycleCanActuallyReachTenCompletedDaysInEachIndependentInputCalendar() {
        val day = LocalDate.of(2026, 10, 22)
        val engine = HabitEngine(GenesisCalendar(ZoneId.of("Europe/Moscow")))
        for (mode in CalendarMode.entries) {
            val base = engine.defaultSchedule(day, mode)
            val oneOff = base.copy(recurrence = base.recurrence.copy(enabled = false))
            val original = Habit(TrackerEntity.create("habit", "2026-10-22T12:00:00Z", "daily-${mode.name}"), "Practice", day, oneOff)
            assertFalse(engine.isScheduled(original, day.plusDays(1)))
            val daily = original.copy(schedule = StoicheionRestoration.dailySchedule(oneOff))
            assertEquals(oneOff.recurrence.mode, daily.schedule.recurrence.mode)
            assertEquals(oneOff.recurrence.calendarContext, daily.schedule.recurrence.calendarContext)
            for (offset in 0L..10L) assertTrue("$mode, day $offset", engine.isScheduled(daily, day.plusDays(offset)))
        }
    }

    companion object {
        fun fixture() = StoicheionRestorationSnapshot(cycleId = "2026-10-22:42:north:beta", startedAt = "2026-10-22T12:00:00Z",
            startedDate = "2026-10-22", sourceDate = "2026-10-22", sourceSeed = 42,
            cards = StoicheionRestoration.letters.take(9).map { RestorationDrawCard(it.id, true) },
            sectorId = "north", letterId = "beta", need = "conflict", supportIds = listOf("hearth"),
            resourceLetterId = "theta", practiceId = "athena-three-intentions", spreadTotal = 49, pythmen = 4,
            intention = "Ясно назвать намерение", action = "Записать один следующий шаг", practiceText = "Спокойно осмыслить меру")
    }
}
