package ru.genesis.calendar.reminders

import java.time.*
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.data.*
import ru.genesis.calendar.domain.*
import ru.genesis.calendar.domain.habits.*

class HabitNotificationPlanTest {
    private val zone = ZoneId.of("Europe/Moscow")
    private val date = LocalDate.of(2026, 9, 28)
    private val engine = HabitEngine(GenesisCalendar(zone))
    private fun habit(id: String, time: String) = Habit(TrackerEntity.create("habit", id=id), id, date,
        engine.defaultSchedule(date, CalendarMode.PROFANE), preferredTime=time,
        reminder=HabitReminder(true, "08:00"))
    private fun workspace(vararg habits: Habit) = LocalHabitWorkspace(habits=habits.toList(), settings=HabitSettings(
        notifications=HabitNotificationSettings(enabled=true, motivational=false)))
    private val now = date.atTime(8, 0).atZone(zone).toInstant()

    @Test fun intervalNotificationsStayInsideTheWindowAndSkipMarkedSlots() {
        val habit=habit("interval","09:00").copy(intervalSchedule=HabitIntervalSchedule(30,"09:00","10:00","each"))
        val initial=workspace(habit)
        assertEquals(listOf("09:00","09:30","10:00"),planHabitNotifications(initial,date,now,zone,false,1).map { it.at.atZone(zone).toLocalTime().toString() })
        val partial=engine.updateIntervalCompletion(emptyList(),habit,date,date,"09:30",true)
        assertEquals(listOf("09:00","10:00"),planHabitNotifications(initial.copy(completions=partial),date,now,zone,false,1).map { it.at.atZone(zone).toLocalTime().toString() })
        val done=engine.updateCompletion(partial,habit,date,date,true,null,"")
        assertTrue(planHabitNotifications(initial.copy(completions=done),date,now,zone,false,1).isEmpty())
    }
    @Test fun dayMarkIntervalsAndCustomReminderRemainIndependent() {
        val habit=habit("day","09:00").copy(intervalSchedule=HabitIntervalSchedule(30,"09:00","10:00","day"))
        assertEquals(3,planHabitNotifications(workspace(habit),date,now,zone,false,1).size)
        val custom=habit.copy(reminder=habit.reminder.copy(timing="custom",time="11:00"))
        assertEquals(listOf("11:00"),planHabitNotifications(workspace(custom),date,now,zone,false,1).map { it.at.atZone(zone).toLocalTime().toString() })
    }

    @Test fun closeTimesStaySeparateAndUseEachHabitTime() {
        val plan = planHabitNotifications(workspace(habit("water", "09:00"), habit("reading", "09:15")),date,now,zone,false,1)
        assertEquals(listOf("water", "reading"),plan.map { it.habitId })
        assertEquals(listOf("09:00", "09:15"),plan.map { it.at.atZone(zone).toLocalTime().toString() })
        assertTrue(plan[0].body.contains("water"))
        assertTrue(plan[1].body.contains("reading"))
    }
    @Test fun offsetCanCrossMidnightAndCustomTimeRemainsIndependent() {
        val habit = habit("night", "00:10").copy(reminder=HabitReminder(true,"12:00",minutesBefore=20,allowDuringQuietHours=true))
        assertEquals(date.minusDays(1).atTime(23,50).atZone(zone), habitReminderAt(habit,date))
        assertEquals(date.atTime(11,40).atZone(zone), habitReminderAt(habit.copy(reminder=habit.reminder.copy(timing="custom")),date))
    }
    @Test fun quietOverrideIsPerHabitAndCompletedPracticesAreNotScheduled() {
        val late = habit("late", "23:00")
        assertTrue(planHabitNotifications(workspace(late),date,now,zone,false,1).isEmpty())
        assertEquals(1,planHabitNotifications(workspace(late.copy(reminder=late.reminder.copy(allowDuringQuietHours=true))),date,now,zone,false,1).size)
        val entry = HabitCompletion(TrackerEntity.create("entry"),"late",date,true)
        assertTrue(planHabitNotifications(workspace(late).copy(completions=listOf(entry)),date,now,zone,false,1).isEmpty())
    }
    @Test fun personalAndGoalRemindersDoNotReplaceEachOther() {
        val w = workspace(habit("reading","20:30"))
        val enabled = w.copy(settings=w.settings.copy(notifications=w.settings.notifications.copy(motivational=true)))
        assertEquals(listOf("habit", "goal"),planHabitNotifications(enabled,date,now,zone,false,1).map { it.kind })
    }
    @Test fun personalRemindersWorkWhenTheGeneralReminderIsDisabled() {
        val w=workspace(habit("reading","20:30"))
        val personalOnly=w.copy(settings=w.settings.copy(notifications=w.settings.notifications.copy(enabled=false,motivational=true)))
        assertEquals(listOf("habit"),planHabitNotifications(personalOnly,date,now,zone,false,1).map {it.kind})
        assertTrue(planHabitNotifications(personalOnly.copy(habits=personalOnly.habits.map {
            it.copy(reminder=it.reminder.copy(enabled=false)) }),date,now,zone,false,1).isEmpty())
    }
}
