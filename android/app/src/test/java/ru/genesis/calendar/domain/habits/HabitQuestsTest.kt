package ru.genesis.calendar.domain.habits

import java.time.LocalDate
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.GenesisCalendar

class HabitQuestsTest {
    private val today = LocalDate.of(2026, 9, 24)
    private val stamp = "2026-09-24T10:00:00.000Z"
    private val engine = HabitEngine(GenesisCalendar())
    private fun habit(id: String, priority: Int = 5) = Habit(TrackerEntity(id, stamp, stamp),
        id, today.minusDays(10), engine.defaultSchedule(today.minusDays(10), CalendarMode.PROFANE),
        priority = priority)
    private fun goal(day: LocalDate, status: String) = DailyGoalRecord(day, "rhythm", "Europe/Moscow", 1,
        if (status in setOf("qualified", "perfect")) 1 else 0, 1, status, stamp)

    @Test fun windowsMatchWebMondayAndCalendarMonth() {
        assertEquals(LocalDate.of(2026, 9, 21) to LocalDate.of(2026, 9, 27), HabitQuests.week(today))
        assertEquals(LocalDate.of(2026, 9, 1) to LocalDate.of(2026, 9, 30), HabitQuests.month(today))
        assertEquals(1, LocalDate.of(2026, 9, 21).toString().filter(Char::isDigit).toInt() % 4)
    }

    @Test fun createsAttainableDailyWeeklyAndEpicQuestsAndPaysOnce() {
        val habits = listOf(habit("h1"))
        val initial = HabitQuests.reconcile(emptyList(), habits, emptyList(), listOf(goal(today,"open")),
            today, stamp) { _, _ -> true }
        assertEquals(listOf("daily", "weekly", "epic"), HabitQuests.current(initial, today).map { it.cadence })
        assertEquals("daily-goals", initial.single { it.cadence == "weekly" }.kind)
        assertEquals(4, initial.single { it.cadence == "weekly" }.target)
        assertEquals(7, initial.single { it.cadence == "epic" }.target)
        val completion = HabitCompletion(TrackerEntity("c1",stamp,stamp),"h1",today,true)
        val completed = HabitQuests.reconcile(initial,habits,listOf(completion),listOf(goal(today,"perfect")),
            today,stamp) { _, _ -> true }
        assertEquals(1,completed.single { it.cadence == "daily" }.progress)
        assertNotNull(completed.single { it.cadence == "daily" }.completedAt)
        assertEquals(1,completed.single { it.cadence == "weekly" }.progress)
        val ledger = HabitQuests.reconcileRewards(completed,emptyList())
        assertEquals(3,Rewards.balance(ledger))
        assertEquals(ledger,HabitQuests.reconcileRewards(completed,ledger))
        val reversed = HabitQuests.reconcile(completed,habits,emptyList(),listOf(goal(today,"open")),
            today,stamp) { _, _ -> true }
        assertEquals(1,reversed.single { it.cadence == "daily" }.progress)
        assertEquals(completed.single { it.cadence == "daily" }.completedAt,
            reversed.single { it.cadence == "daily" }.completedAt)
    }

    @Test fun weeklyHabitVariantChoosesHighestAttainableThenPriority() {
        val date = LocalDate.of(2026, 10, 20)
        val first = habit("a", 4)
        val second = habit("b", 8)
        val quests = HabitQuests.reconcile(emptyList(),listOf(first,second),emptyList(),emptyList(),
            date,stamp) { _, _ -> true }
        val weekly = quests.single { it.cadence == "weekly" }
        assertEquals("habit-completions",weekly.kind)
        assertEquals("b",weekly.habitId)
        assertEquals(5,weekly.target)
    }

    @Test fun noScheduledHabitMakesNoNewQuestButKeepsHistory() {
        assertTrue(HabitQuests.reconcile(emptyList(),emptyList(),emptyList(),emptyList(),today,
            stamp) { _, _ -> false }.isEmpty())
        val previous = HabitQuests.reconcile(emptyList(),listOf(habit("h1")),emptyList(),emptyList(),
            today,stamp) { _, _ -> true }
        assertEquals(previous,HabitQuests.reconcile(previous,emptyList(),emptyList(),emptyList(),
            today,stamp) { _, _ -> false })
    }
}
