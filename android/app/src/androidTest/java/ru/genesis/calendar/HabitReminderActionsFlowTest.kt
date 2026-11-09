package ru.genesis.calendar

import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.FrameLayout
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.viewinterop.AndroidView
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import java.io.File
import java.time.*
import java.time.temporal.ChronoUnit
import java.util.UUID
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.data.*
import ru.genesis.calendar.domain.*
import ru.genesis.calendar.domain.habits.*
import ru.genesis.calendar.reminders.*
import ru.genesis.calendar.ui.*

class HabitReminderActionsFlowTest {
    @get:Rule val compose = createAndroidComposeRule<StoicheionGestureActivity>()

    @Test fun snoozeRetainsOriginalTargetAcrossRecoveryAndRespectsQuietHoursAndDeviceBudget() {
        val app = compose.activity.application as GenesisApplication
        check(BuildConfig.DEBUG && app.packageName.endsWith(".debug") && app.workspaceScope == "internal-validation-v1")
        assumeTrue(app.scheduler.notificationsAllowed())
        val repository = HabitsRepository(app)
        fun saved() = runBlocking { repository.workspace.first() }
        val originalSettings = saved().settings
        val frequency = habitReminderFrequency(app, app.workspaceScope)
        val registry = app.getSharedPreferences("genesis_habit_alarm_registry", Context.MODE_PRIVATE)
        val names = listOf("snoozes", "snoozeRequests", "deliveryTimes")
        val previous = names.associateWith { registry.getStringSet(it, null)?.toSet() }
        val now = Instant.now().truncatedTo(ChronoUnit.MINUTES)
        val zone = ZoneId.systemDefault(); val date = now.atZone(zone).toLocalDate()
        assumeTrue(now.plusSeconds(360).atZone(zone).toLocalDate() == date)
        val habit = Habit(TrackerEntity.create("habit", id = "e2-snooze-${UUID.randomUUID()}"), "E2 · Snooze validation",
            date, HabitEngine(GenesisCalendar(zone)).defaultSchedule(date, CalendarMode.PROFANE),
            reminder = HabitReminder(true, now.atZone(zone).toLocalTime().toString()))
        try {
            check(registry.edit().putStringSet("deliveryTimes", emptySet()).commit())
            saveHabitReminderFrequency(app, app.workspaceScope, HabitReminderFrequency(4, 5))
            assertEquals(HabitReminderFrequency(4, 5), habitReminderFrequency(app, app.workspaceScope))
            runBlocking {
                repository.updateSettings(originalSettings.copy(notifications = originalSettings.notifications.copy(
                    quietHoursStart = "00:00", quietHoursEnd = "00:00")))
                repository.save(habit)
            }
            val target = planHabitNotifications(saved(), date, now.minusMillis(1), zone, "ru", 1)
                .single { it.habitId == habit.id }.target!!
            fun request(id: String = "original") = Intent().putExtra("scope", app.workspaceScope)
                .putExtra("requestId", "genesis://habit-reminder/${app.workspaceScope}/${habit.id}/$id")
                .putHabitReminderTarget(target)
            val due = Instant.now().plusSeconds(300).atZone(zone).toLocalTime()
            runBlocking { repository.updateSettings(originalSettings.copy(notifications = originalSettings.notifications.copy(
                quietHoursStart = due.minusMinutes(1).toString().take(5), quietHoursEnd = due.plusMinutes(2).toString().take(5)))) }
            assertFalse(runBlocking { app.scheduler.snoozeHabitNotification(request("quiet")) })
            runBlocking { repository.updateSettings(originalSettings.copy(notifications = originalSettings.notifications.copy(
                quietHoursStart = "00:00", quietHoursEnd = "00:00"))) }
            assertTrue(runBlocking { app.scheduler.snoozeHabitNotification(request()) })
            val once = registry.getStringSet("snoozes", emptySet())!!.toSet()
            assertTrue(runBlocking { app.scheduler.snoozeHabitNotification(request()) })
            assertEquals(once, registry.getStringSet("snoozes", emptySet()))
            val persisted = habitReminderSnoozes(registry).single { it.target.habitId == habit.id }
            assertEquals(target, persisted.target)
            runBlocking { app.scheduler.restoreHabitNotifications() }
            assertTrue(registry.getStringSet("alarms", emptySet()).orEmpty().any {
                it.contains(habit.id) && it.endsWith(persisted.until.toEpochMilli().toString())
            })
            assertFalse(runBlocking { app.scheduler.snoozeHabitNotification(request("wrong-account").putExtra("scope", "other")) })
            assertFalse(runBlocking { app.scheduler.snoozeHabitNotification(request("stale").putHabitReminderTarget(target.copy(date = date.minusDays(1)))) })
            val count = registry.getStringSet("deliveryTimes", emptySet()).orEmpty() + (0..3).map {
                "genesis://habit-reminder/${app.workspaceScope}/e2-budget/$it\t${Instant.now().toEpochMilli()}"
            }
            assertTrue(registry.edit().putStringSet("deliveryTimes", count.toSet()).commit())
            assertFalse(runBlocking { app.scheduler.snoozeHabitNotification(request("budget")) })
        } finally {
            runBlocking {
                saved().habits.firstOrNull { it.id == habit.id }?.let { repository.save(it.copy(active = false)) }
                repository.updateSettings(originalSettings)
            }
            val edit = registry.edit()
            previous.forEach { (key, value) -> if (value == null) edit.remove(key) else edit.putStringSet(key, value) }
            check(edit.commit())
            saveHabitReminderFrequency(app, app.workspaceScope, frequency)
            runBlocking { app.scheduler.restoreHabitNotifications() }
        }
    }

    @Test fun exactHabitQuickActionIsIdempotentStaleClickIsReadOnlyAndMeasuredActionNeedsInput() {
        val app = compose.activity.application as GenesisApplication
        check(BuildConfig.DEBUG && app.packageName.endsWith(".debug") && app.workspaceScope == "internal-validation-v1")
        assumeTrue(app.scheduler.notificationsAllowed())
        val repository = HabitsRepository(app)
        fun saved() = runBlocking { repository.workspace.first() }
        val date = LocalDate.now(); val zone = ZoneId.systemDefault()
        val at = ZonedDateTime.now().truncatedTo(ChronoUnit.MINUTES).toInstant()
        val time = at.atZone(zone).toLocalTime().toString()
        fun habit(title: String, measured: Boolean = false) = Habit(TrackerEntity.create("habit", id = "e2-${UUID.randomUUID()}"), title,
            date, HabitEngine(GenesisCalendar(zone)).defaultSchedule(date, CalendarMode.PROFANE),
            reminder = HabitReminder(true, time, allowDuringQuietHours = true),
            measurement = if (measured) HabitMeasurement("quantity", "pages", 1000, 1000) else null)
        val binary = habit("E2 · Личная практика")
        val measured = habit("E2 · Страницы", true)
        runBlocking { repository.save(binary); repository.save(measured) }
        fun target(habit: Habit) = planHabitNotifications(saved(), date, at.minusMillis(1), zone, "ru", 1)
            .single { it.habitId == habit.id }.target!!
        val binaryTarget = target(binary); val measuredTarget = target(measured)
        val key = Uri.Builder().scheme("genesis").authority("habit-reminder").appendPath(app.workspaceScope)
            .appendPath("$date/habit/${binary.id}/${at.toEpochMilli()}").build().toString()
        val manager = app.getSystemService(NotificationManager::class.java)
        runBlocking {
            app.scheduler.deliverHabitNotification(Intent().setData(Uri.parse(key)).putExtra("scope", app.workspaceScope)
                .putExtra("date", date.toString()).putExtra("kind", "habit").putExtra("habitId", binary.id)
                .putExtra("at", at.toEpochMilli()).putHabitReminderTarget(binaryTarget))
        }
        val notification = manager.activeNotifications.single { it.tag == key }.notification
        assertEquals(2, notification.actions.size)
        manager.cancel(key, 2)
        manager.cancel(Uri.Builder().scheme("genesis").authority("habit-reminder").appendPath(app.workspaceScope)
            .appendPath("$date/habit/${measured.id}/${at.toEpochMilli()}").build().toString(), 2)
        val open = habitNotificationOpenIntent(app, app.workspaceScope, binaryTarget, "complete")
        assertEquals(binaryTarget, habitReminderRequest(open, app.workspaceScope)!!.target)
        assertNull(habitReminderRequest(open, "another-account"))
        var request by mutableStateOf<HabitReminderOpenRequest?>(null)
        var dark by mutableStateOf(false)
        var showNotification by mutableStateOf(true)
        compose.setContent {
            val workspace by repository.workspace.collectAsState(initial = LocalHabitWorkspace())
            MaterialTheme(colorScheme = if (dark) evening else standart) {
                CompositionLocalProvider(LocalGenesisLanguage provides "ru", LocalEveningTheme provides dark) {
                    Surface(Modifier.fillMaxSize().safeDrawingPadding()) {
                        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState())) {
                            if (showNotification) AndroidView(factory = { context ->
                                Notification.Builder.recoverBuilder(context, notification).createBigContentView()
                                    .apply(context, FrameLayout(context))
                            }, modifier = Modifier.fillMaxWidth())
                            HabitReminderFocus(app, workspace, repository, request)
                        }
                    }
                }
            }
        }
        val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        compose.waitForIdle()
        assertTrue(device.takeScreenshot(File(app.getExternalFilesDir(null), "e2-notification-actions.png")))
        compose.runOnIdle { showNotification = false; request = habitReminderRequest(open, app.workspaceScope) }
        compose.waitUntil(15_000) { saved().completions.any { it.habitId == binary.id && it.date == date && it.completed } }
        val first = saved().completions.single { it.habitId == binary.id && it.date == date }
        runBlocking { repository.completeFromReminder(binaryTarget) }
        assertEquals(first.xpAwarded, saved().completions.single { it.habitId == binary.id && it.date == date }.xpAwarded)
        compose.runOnIdle { request = HabitReminderOpenRequest(app.workspaceScope, measuredTarget.copy(date = date.minusDays(1)), "complete") }
        compose.onNodeWithText("Это напоминание относится к другой дате или прежнему правилу. Сегодняшние данные не изменены.")
            .performScrollTo().assertExists()
        assertTrue(saved().measurements.none { it.habitId == measured.id })
        compose.runOnIdle { request = HabitReminderOpenRequest(app.workspaceScope, measuredTarget, "input") }
        compose.onNodeWithText("Добавить значение").performScrollTo().assertIsNotEnabled()
        assertTrue(device.takeScreenshot(File(app.getExternalFilesDir(null), "e2-reminder-input-light.png")))
        compose.runOnIdle { dark = true }; compose.waitForIdle()
        assertTrue(device.takeScreenshot(File(app.getExternalFilesDir(null), "e2-reminder-input-dark.png")))
        compose.onNodeWithText("Значение").performScrollTo().performTextReplacement("1")
        compose.onNodeWithText("Добавить значение").performScrollTo().performClick()
        compose.waitUntil(15_000) { saved().measurements.any { it.habitId == measured.id } }
        assertEquals(1, saved().measurements.count { it.habitId == measured.id })
        manager.cancel(key, 2)
        runBlocking {
            for (id in listOf(binary.id, measured.id)) repository.save(saved().habits.single { it.id == id }.copy(active = false))
        }
    }
}
