package ru.genesis.calendar

import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.delay
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import ru.genesis.calendar.data.*
import ru.genesis.calendar.domain.*
import ru.genesis.calendar.domain.habits.*
import ru.genesis.calendar.reminders.habitNotificationOpenIntent
import ru.genesis.calendar.reminders.planHabitNotifications
import ru.genesis.calendar.reminders.ReminderScheduler
import java.time.*

class HabitReminderRecoveryTest {
    @Test fun delayedHabitReminderIsDeliveredOnceAndCompletionCancelsIt() = runBlocking {
        val app=InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        check(BuildConfig.DEBUG && app.packageName.endsWith(".debug"))
        app.activateAccount(null)
        assumeTrue("Notification permission is required for delivery verification",
            app.scheduler.notificationsAllowed())
        val repo=HabitsRepository(app)
        val original=repo.workspace.first().settings
        val date=LocalDate.now()
        val time=LocalTime.now().minusMinutes(20).withSecond(0).withNano(0)
        val at=date.atTime(time).atZone(ZoneId.systemDefault()).toInstant()
        val manager=app.getSystemService(NotificationManager::class.java)
        val id="late-recovery-habit-${java.util.UUID.randomUUID()}"
        val habit=Habit(TrackerEntity.create("habit",id=id),"Проверка отложенной доставки",date,
            HabitEngine(GenesisCalendar()).defaultSchedule(date,CalendarMode.PROFANE),
            preferredTime=time.toString(),reminder=HabitReminder(enabled=true,allowDuringQuietHours=true))
        val key=Uri.Builder().scheme("genesis").authority("habit-reminder").appendPath(app.workspaceScope)
            .appendPath("$date/habit/$id/${at.toEpochMilli()}").build()
        val intent=Intent().setData(key).putExtra("scope",app.workspaceScope).putExtra("date",date.toString())
            .putExtra("kind","habit").putExtra("habitId",id).putExtra("at",at.toEpochMilli())
        val registry=app.getSharedPreferences("genesis_habit_alarm_registry",Context.MODE_PRIVATE)
        registry.edit().putStringSet("delivered",registry.getStringSet("delivered",emptySet()).orEmpty()-key.toString()).commit()
        manager.cancel(key.toString(),2)
        suspend fun awaitNotification(): android.service.notification.StatusBarNotification {
            repeat(50) {
                manager.activeNotifications.firstOrNull { it.tag==key.toString() }?.let { note -> return note }
                delay(100)
            }
            error("Habit notification was not posted within five seconds; delivered=" +
                registry.getStringSet("delivered", emptySet()).orEmpty().contains(key.toString()) +
                ", active=" + manager.activeNotifications.map { "${it.tag}/${it.id}" } +
                ", channel=" + manager.getNotificationChannel(ReminderScheduler.HABIT_CHANNEL)?.importance)
        }
        try {
            repo.save(habit)
            val planned = planHabitNotifications(repo.workspace.first(), date, at.minusMillis(1),
                ZoneId.systemDefault(), false, 1)
            assertTrue("Expected the saved habit to have a matching planned reminder: $planned",
                planned.any { it.kind == "habit" && it.habitId == id && it.at == at })
            assertNotNull("Habits notification channel must exist",
                manager.getNotificationChannel(ReminderScheduler.HABIT_CHANNEL))
            assertTrue("Habits notification channel must be enabled",
                app.scheduler.channelAllowed(ReminderScheduler.HABIT_CHANNEL))
            app.scheduler.deliverHabitNotification(intent)
            val delivered=awaitNotification()
            assertEquals(habit.title,delivered.notification.extras.getString(Notification.EXTRA_TITLE))
            assertFalse(delivered.notification.extras.getString(Notification.EXTRA_TEXT).orEmpty()
                .contains(Regex("\\(\\d+\\)")))
            val openIntent = habitNotificationOpenIntent(app, app.workspaceScope)
            assertEquals("habits", requestedSection(openIntent, app.workspaceScope))
            assertNotNull(delivered.notification.contentIntent)
            app.scheduler.deliverHabitNotification(intent)
            assertEquals(delivered.postTime,awaitNotification().postTime)
            repo.complete(id,true)
            manager.cancel(key.toString(),2)
            registry.edit().putStringSet("delivered",registry.getStringSet("delivered",emptySet()).orEmpty()-key.toString()).commit()
            app.scheduler.deliverHabitNotification(intent)
            for (attempt in 0 until 40) {
                if (manager.activeNotifications.none { it.tag == key.toString() }) break
                Thread.sleep(50)
            }
            assertTrue(manager.activeNotifications.none {it.tag==key.toString()})
            assertFalse(registry.getStringSet("alarms",emptySet()).orEmpty().contains(key.toString()))
        } finally {
            repo.delete(id); repo.updateSettings(original); manager.cancel(key.toString(),2)
        }
    }
}
