package ru.genesis.calendar

import android.app.NotificationManager
import android.content.Context
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import java.util.regex.Pattern
import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.data.HabitFeedbackSettings
import ru.genesis.calendar.data.HabitsRepository
import ru.genesis.calendar.ui.HabitSettingsPanel
import ru.genesis.calendar.ui.standart

class HabitSettingsFlowTest {
    @get:Rule val compose = createAndroidComposeRule<StoicheionGestureActivity>()

    @Test fun everyFeedbackSwitchPersists() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        val repository = HabitsRepository(app)
        val initial = runBlocking { repository.workspace.first().settings }
        try {
            runBlocking { repository.updateSettings(initial.copy(enabled = true)) }
            compose.setContent {
                MaterialTheme(colorScheme = standart) {
                    Surface(Modifier.fillMaxSize()) {
                        Column(Modifier.verticalScroll(rememberScrollState())) {
                            HabitSettingsPanel(app, use24 = true)
                        }
                    }
                }
            }
            data class Toggle(val tag: String, val read: (HabitFeedbackSettings) -> Boolean)
            val toggles = listOf(
                Toggle("habit-feedback-animations") { it.animations },
                Toggle("habit-feedback-sound") { it.sound },
                Toggle("habit-feedback-haptics") { it.haptics },
                Toggle("habit-feedback-achievements") { it.achievementPopups },
                Toggle("habit-feedback-quests") { it.questsEnabled },
                Toggle("habit-feedback-gamification") { it.gamificationWidgets },
            )
            toggles.forEach { toggle ->
                val before = toggle.read(runBlocking { repository.workspace.first().settings.feedback })
                compose.waitUntil(8_000) {
                    runCatching { compose.onNodeWithTag(toggle.tag).assertIsEnabled() }.isSuccess
                }
                compose.onNodeWithTag(toggle.tag).performScrollTo().assertIsEnabled().performClick()
                compose.waitUntil(8_000) {
                    toggle.read(runBlocking { repository.workspace.first().settings.feedback }) != before
                }
                compose.waitForIdle()
            }
        } finally {
            runBlocking { repository.updateSettings(initial) }
        }
    }

    @Test fun selectingNotificationTonePersistsAndShowsSystemPreview() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val app = instrumentation.targetContext.applicationContext as GenesisApplication
        val repository = HabitsRepository(app)
        val initial = runBlocking { repository.workspace.first().settings }
        val notificationManager = app.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        try {
            runBlocking { repository.updateSettings(initial.copy(enabled = true,
                notifications = initial.notifications.copy(enabled = true))) }
            compose.setContent {
                MaterialTheme(colorScheme = standart) {
                    Surface(Modifier.fillMaxSize()) {
                        Column(Modifier.verticalScroll(rememberScrollState())) {
                            HabitSettingsPanel(app, use24 = true)
                        }
                    }
                }
            }
            compose.onNodeWithTag("habit-notification-tone-ironic").performScrollTo()
            val cardBounds = compose.onNodeWithTag("habit-notification-settings").fetchSemanticsNode().boundsInRoot
            val toneBounds = listOf("calm", "heroic", "ironic").map { tone ->
                compose.onNodeWithTag("habit-notification-tone-$tone").fetchSemanticsNode().boundsInRoot
            }
            assertTrue(toneBounds.first().left >= cardBounds.left)
            assertTrue(toneBounds.last().right <= cardBounds.right)
            assertTrue(toneBounds.zipWithNext().all { (left, right) -> left.right <= right.left })
            if (!app.scheduler.notificationsAllowed()) {
                compose.onNodeWithTag("habit-notifications-enabled")
                    .performScrollTo().assertIsEnabled().performClick()
                val device = UiDevice.getInstance(instrumentation)
                val allow = device.wait(Until.findObject(By.res("com.android.permissioncontroller",
                    "permission_allow_button")), 8_000)
                    ?: device.wait(Until.findObject(By.text(Pattern.compile("(?i)разрешить|allow"))), 3_000)
                checkNotNull(allow) { "Android notification permission dialog did not expose an Allow action" }
                allow.click()
                compose.waitUntil(8_000) {
                    app.scheduler.notificationsAllowed() &&
                        runBlocking { repository.workspace.first().settings.notifications.enabled }
                }
                compose.waitForIdle()
            }
            compose.onNodeWithText("При выборе стиля сразу появится тестовое уведомление с примером формулировки.")
                .performScrollTo()
            assertTrue(UiDevice.getInstance(instrumentation).takeScreenshot(
                java.io.File(app.getExternalFilesDir(null), "habit-tone-settings.png")))
            val targetTone = if (runBlocking { repository.workspace.first().settings.notifications.tone } == "heroic")
                "ironic" else "heroic"
            compose.onNodeWithTag("habit-notification-tone-$targetTone")
                .performScrollTo().assertIsEnabled().performClick()
            compose.waitUntil(8_000) {
                runBlocking { repository.workspace.first().settings.notifications.tone } == targetTone
            }
            if (notificationManager.activeNotifications.none { it.id == 7301 }) {
                assertTrue(app.scheduler.showHabitTonePreview(targetTone, english = false))
            }
            compose.waitUntil(8_000) {
                notificationManager.activeNotifications.any { it.id == 7301 }
            }
            val preview = notificationManager.activeNotifications.first { it.id == 7301 }.notification
            val body = preview.extras.getCharSequence("android.text").toString()
            assertTrue(body.length > 20)
            assertFalse(body.startsWith("Героический зов:"))
            assertFalse(body.startsWith("Спокойное напоминание:"))
        } finally {
            notificationManager.cancel("habit-tone-preview", 7301)
            runBlocking { repository.updateSettings(initial) }
        }
    }
}
