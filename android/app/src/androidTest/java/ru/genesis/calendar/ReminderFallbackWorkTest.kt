package ru.genesis.calendar

import android.app.NotificationManager
import androidx.test.platform.app.InstrumentationRegistry
import androidx.work.WorkInfo
import androidx.work.WorkManager
import java.time.*
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertTrue
import org.junit.Test
import ru.genesis.calendar.data.HabitsRepository
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.GenesisCalendar
import ru.genesis.calendar.domain.habits.Habit
import ru.genesis.calendar.domain.habits.HabitEngine
import ru.genesis.calendar.domain.habits.HabitReminder
import ru.genesis.calendar.domain.habits.TrackerEntity
import ru.genesis.calendar.reminders.ReminderRecoveryWorker

class ReminderFallbackWorkTest {
    @Test fun futureHabitOwnsPersistentWorkManagerBackup() = runBlocking {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        check(BuildConfig.DEBUG && app.packageName.endsWith(".debug"))
        app.activateAccount(null)
        val repo = HabitsRepository(app)
        val at = ZonedDateTime.now().plusHours(2)
        val date = at.toLocalDate()
        val time = at.toLocalTime().withSecond(0).withNano(0)
        val id = "workmanager-fallback-habit"
        repo.delete(id)
        try {
            repo.save(Habit(TrackerEntity.create("habit", id = id), "Проверка резервной доставки", date,
                HabitEngine(GenesisCalendar()).defaultSchedule(date, CalendarMode.PROFANE),
                preferredTime = time.toString(), reminder = HabitReminder(enabled = true,
                    allowDuringQuietHours = true)))
            app.scheduler.restoreHabitNotifications()
            val works = WorkManager.getInstance(app)
                .getWorkInfosForUniqueWork(ReminderRecoveryWorker.HABIT_WORK).get()
            assertTrue(works.any { it.state == WorkInfo.State.ENQUEUED || it.state == WorkInfo.State.RUNNING })
            assertTrue(app.scheduler.scheduledHabitAlarmCount() > 0)
            assertTrue(repo.workspace.first().habits.any { it.id == id })
        } finally {
            repo.delete(id)
        }
    }

    @Test fun recentTaskMissedByTheOsIsRecoveredOnce() = runBlocking {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        check(BuildConfig.DEBUG && app.packageName.endsWith(".debug"))
        app.activateAccount(null)
        val id = "workmanager-fallback-task"
        app.repository.get(id)?.takeIf { !it.done }?.let { app.repository.complete(id) }
        val saved = app.repository.save(ru.genesis.calendar.data.LocalTask(id = id,
            title = "Проверка восстановления задачи", reminderAt = System.currentTimeMillis() - 5_000,
            revision = app.repository.get(id)?.revision ?: 0))
        try {
            app.scheduler.restore(recoverOverdue = true)
            val row = app.database.dao().taskReminders(app.workspaceScope, id).single()
            assertTrue(row.state == "delivered")
            val manager = app.getSystemService(NotificationManager::class.java)
            for (attempt in 0 until 40) {
                if (manager.activeNotifications.any { it.tag == app.workspaceScope + "/" + row.id }) break
                Thread.sleep(50)
            }
            assertTrue(manager.activeNotifications.any { it.tag == app.workspaceScope + "/" + row.id })
            app.scheduler.restore(recoverOverdue = true)
            assertTrue(app.database.dao().taskReminders(app.workspaceScope, id).single().revision == saved.revision)
        } finally {
            app.repository.get(id)?.takeIf { !it.done }?.let { app.repository.complete(id) }
        }
    }
}
