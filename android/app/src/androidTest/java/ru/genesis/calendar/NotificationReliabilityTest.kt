package ru.genesis.calendar

import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import ru.genesis.calendar.data.LocalTask
import ru.genesis.calendar.reminders.ReminderScheduler
import ru.genesis.calendar.ui.appBatterySettingsIntent
import ru.genesis.calendar.ui.samsungNeverSleepingAppsIntent

/** Arm and verify run in separate instrumentation processes with `am kill` between them. */
class NotificationReliabilityTest {
    private val app get() = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
    private val fixture get() = app.getSharedPreferences("genesis.notification.reliability.test", Context.MODE_PRIVATE)

    @Test fun distinctTaskAndHabitChannelsAndNotifications() = runBlocking {
        check(BuildConfig.DEBUG && app.packageName.endsWith(".debug"))
        check(!app.workspaceScope.startsWith("account-")) { "Use the isolated local debug workspace" }
        assertTrue(app.scheduler.notificationsAllowed())
        app.scheduler.createChannels("ru")
        val manager = app.getSystemService(NotificationManager::class.java)
        val taskChannel = manager.getNotificationChannel(ReminderScheduler.TASK_CHANNEL)
        val habitChannel = manager.getNotificationChannel(ReminderScheduler.HABIT_CHANNEL)
        assertNotEquals(taskChannel.sound, habitChannel.sound)
        assertNotEquals(taskChannel.lightColor, habitChannel.lightColor)
        val id = "distinct-notifications-fixture-" + System.currentTimeMillis()
        val old = app.repository.get(id)
        val task = app.repository.save(LocalTask(id=id, title="Notification validation task",
            reminderAt=System.currentTimeMillis()+5_000, revision=old?.revision ?: 0))
        val row = app.database.dao().taskReminders(app.workspaceScope, id).first { it.state == "pending" }
        delay(5_500)
        app.scheduler.deliver(app.workspaceScope, row.id, task.revision)
        assertTrue(app.scheduler.showHabitTonePreview("calm", "ru"))
        // NotificationManager posts across Binder; notify() need not already be
        // reflected in activeNotifications when it returns, especially on API26.
        val published = withTimeoutOrNull(5_000) {
            while (manager.activeNotifications.none { it.tag == app.workspaceScope + "/" + row.id } ||
                manager.activeNotifications.none { it.tag == "habit-tone-preview" }) delay(50)
            manager.activeNotifications
        }
        val observed = published ?: manager.activeNotifications
        val diagnostic = "observed=" + observed.joinToString { "${it.tag}:${it.notification.channelId}" } +
            "; notificationPermission=${app.scheduler.notificationsAllowed()}; reminder=${row.id}"
        assertTrue("Task notification publication failed: $diagnostic", observed.any { it.tag == app.workspaceScope + "/" + row.id })
        assertTrue("Habit notification publication failed: $diagnostic", observed.any { it.tag == "habit-tone-preview" })
        val taskNote = observed.single { it.tag == app.workspaceScope + "/" + row.id }.notification
        val habitNote = observed.single { it.tag == "habit-tone-preview" }.notification
        assertEquals(ReminderScheduler.TASK_CHANNEL, taskNote.channelId)
        assertEquals(ReminderScheduler.HABIT_CHANNEL, habitNote.channelId)
        assertNotEquals(taskNote.color, habitNote.color)
        assertNotEquals(R.drawable.ic_notification_task, R.drawable.ic_notification_habit)
        if (android.os.Build.MANUFACTURER.lowercase() in setOf("realme", "oppo", "oneplus")) {
            println("GENESIS_OEM_POSTED_ICONS=${taskNote.smallIcon.resId}/${habitNote.smallIcon.resId}")
        } else assertNotEquals(taskNote.smallIcon.resId, habitNote.smallIcon.resId)
        for (channel in listOf(taskChannel, habitChannel)) {
            app.contentResolver.openInputStream(channel.sound).use { stream ->
                assertNotNull("Notification sound must resolve", stream)
                val header = ByteArray(4)
                java.io.DataInputStream(requireNotNull(stream)).readFully(header)
                assertEquals("RIFF", String(header, Charsets.US_ASCII))
            }
        }
        println("GENESIS_DISTINCT_TASK_HABIT_NOTIFICATIONS_VERIFIED")
    }

    @Test fun migratingChannelsPreservesDisabledAndVibrationSettings() {
        check(BuildConfig.DEBUG && app.packageName in setOf(
            "ru.genesis.calendar.g1qa.debug", "ru.genesis.calendar.v313.debug", "ru.genesis.calendar.qa1103.debug"))
        val manager = app.getSystemService(NotificationManager::class.java)
        val suffix = java.util.UUID.randomUUID().toString()
        val taskId = ReminderScheduler.TASK_CHANNEL + ".migration-" + suffix
        val habitId = ReminderScheduler.HABIT_CHANNEL + ".migration-" + suffix
        val legacyTaskId = "genesis.tasks.v1.migration-" + suffix
        val legacyHabitId = "genesis.habits.v1.migration-" + suffix
        try {
            manager.createNotificationChannel(android.app.NotificationChannel(legacyTaskId, "Legacy task", NotificationManager.IMPORTANCE_NONE).apply {
                vibrationPattern = longArrayOf(0, 200, 50, 200)
                enableVibration(false)
            })
            manager.createNotificationChannel(android.app.NotificationChannel(legacyHabitId, "Legacy habit", NotificationManager.IMPORTANCE_HIGH).apply {
                vibrationPattern = longArrayOf(0, 70, 90, 70)
                enableVibration(false)
            })
            app.scheduler.createChannels("ru", taskId, habitId,
                legacyTaskChannelId = legacyTaskId, legacyHabitChannelId = legacyHabitId)
            assertEquals(NotificationManager.IMPORTANCE_NONE, manager.getNotificationChannel(taskId).importance)
            assertEquals(NotificationManager.IMPORTANCE_HIGH, manager.getNotificationChannel(habitId).importance)
            assertFalse(manager.getNotificationChannel(taskId).shouldVibrate())
            assertFalse(manager.getNotificationChannel(habitId).shouldVibrate())
            assertArrayEquals(longArrayOf(0, 200, 50, 200), manager.getNotificationChannel(taskId).vibrationPattern)
            assertArrayEquals(longArrayOf(0, 70, 90, 70), manager.getNotificationChannel(habitId).vibrationPattern)
        } finally {
            listOf(taskId, habitId, legacyTaskId, legacyHabitId).forEach(manager::deleteNotificationChannel)
        }
    }

    @Test fun armDiagnosticAlarm() {
        check(BuildConfig.DEBUG && app.packageName.endsWith(".debug"))
        assertTrue("Notification permission must be granted", app.scheduler.notificationsAllowed())
        val manager = app.getSystemService(NotificationManager::class.java)
        manager.cancel("notification-diagnostic", 7303)
        // Leave enough time for instrumentation teardown and `am kill` on older emulators.
        val scheduledAt = requireNotNull(app.scheduler.scheduleDiagnosticNotification(15_000))
        fixture.edit().putLong("scheduledAt", scheduledAt).commit()
        assertEquals(scheduledAt, app.scheduler.lastDiagnosticScheduledAt())
    }

    @Test fun verifyDiagnosticAfterProcessDeath() {
        check(BuildConfig.DEBUG && app.packageName.endsWith(".debug"))
        val scheduledAt = fixture.getLong("scheduledAt", 0)
        assertTrue("Run armDiagnosticAlarm first", scheduledAt > 0)
        val delivered = app.getSystemService(NotificationManager::class.java).activeNotifications
            .single { it.id == 7303 && it.tag == "notification-diagnostic" }
        assertTrue("Diagnostic title must be localized without changing its meaning",
            delivered.notification.extras.getString(Notification.EXTRA_TITLE) in setOf(
                "GENESIS · Проверка уведомлений", "GENESIS · Notification test"))
        assertTrue(app.scheduler.lastDiagnosticDeliveredAt() >= scheduledAt)
    }

    @Test fun batterySettingsIntentsAreScopedAndSamsungAware() {
        val generic = appBatterySettingsIntent("ru.genesis.calendar")
        assertEquals("package:ru.genesis.calendar", generic.dataString)
        val samsung = requireNotNull(samsungNeverSleepingAppsIntent("Samsung"))
        assertEquals("com.samsung.android.lool", samsung.`package`)
        assertEquals(2, samsung.getIntExtra("activity_type", -1))
        assertNull(samsungNeverSleepingAppsIntent("Google"))
    }
}
