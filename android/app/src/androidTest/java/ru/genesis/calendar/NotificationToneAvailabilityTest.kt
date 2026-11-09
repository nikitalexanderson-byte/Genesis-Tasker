package ru.genesis.calendar

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.data.HabitsRepository
import ru.genesis.calendar.ui.*

class NotificationToneAvailabilityTest {
    @get:Rule val compose = createAndroidComposeRule<StoicheionGestureActivity>()

    @Test fun everyTonePersistsRegardlessOfGlobalRemindersThemeOrSacredFeatures() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        val repository = HabitsRepository(app)
        val initial = runBlocking { repository.workspace.first().settings }
        val permissionBefore = app.scheduler.notificationsAllowed()
        var dark by mutableStateOf(false)
        var sacred by mutableStateOf(true)
        try {
            compose.setContent {
                CompositionLocalProvider(LocalSacredFeaturesEnabled provides sacred, LocalEveningTheme provides dark) {
                    MaterialTheme(colorScheme = if (dark) evening else standart) {
                        Surface {
                            Column(Modifier.verticalScroll(rememberScrollState())) { HabitSettingsPanel(app, use24 = true) }
                        }
                    }
                }
            }
            for (darkMode in listOf(false, true)) for (sacredMode in listOf(false, true)) {
                compose.runOnIdle { dark = darkMode; sacred = sacredMode }
                for (enabled in listOf(false, true)) {
                    runBlocking { repository.updateSettings(initial.copy(notifications = initial.notifications.copy(enabled = enabled))) }
                    compose.waitForIdle()
                    for (tone in listOf("calm", "heroic", "ironic")) {
                        compose.onNodeWithTag("habit-notification-tone-$tone").performScrollTo().assertIsEnabled().performClick()
                        compose.waitUntil(8_000) { runBlocking { repository.workspace.first().settings.notifications.tone == tone } }
                        compose.onNodeWithTag("habit-notification-tone-$tone").assertIsSelected()
                        assertEquals(enabled, runBlocking { repository.workspace.first().settings.notifications.enabled })
                    }
                }
            }
            assertEquals(permissionBefore, app.scheduler.notificationsAllowed())
        } finally {
            app.getSystemService(android.app.NotificationManager::class.java).cancel("habit-tone-preview", 7301)
            runBlocking { repository.updateSettings(initial) }
        }
    }
}
