package ru.genesis.calendar.ui

import android.media.MediaPlayer
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.captureNativeWindow
import ru.genesis.calendar.data.*
import ru.genesis.calendar.reminders.ReminderScheduler
import java.io.File
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.flow.first

class HabitFeedback310Test {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val width = InstrumentationRegistry.getArguments().getString("genesisWidth")?.toInt() ?: 390
    private var language by mutableStateOf("ru")
    private var dark by mutableStateOf(false)
    private var settings by mutableStateOf(HabitFeedbackSettings())
    private var enabled by mutableStateOf(true)
    @Before fun selectIsolatedWorkspace() {
        val app = context.applicationContext as GenesisApplication
        check(BuildConfig.DEBUG && app.packageName.endsWith(".debug"))
        app.activateAccount(null)
        check(app.workspaceScope == "internal-validation-v1")
    }
    private fun show() {
        val app = context.applicationContext as GenesisApplication
        compose.setContent {
            val density = compose.activity.resources.displayMetrics.widthPixels.toFloat() / width
            CompositionLocalProvider(LocalDensity provides Density(density, 1f),
                LocalEveningTheme provides dark, LocalGenesisLanguage provides language) {
                MaterialTheme(colorScheme = if(dark) evening else standart, typography = GenesisTypography, shapes = GenesisShapes) {
                    Surface(Modifier.fillMaxSize()) {
                        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
                            verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            Text("Отклик на выполнение", style = MaterialTheme.typography.titleLarge)
                            HabitFeedbackControls(app, settings, enabled) { settings = it }
                        }
                        HabitFeedbackHost(app, app.workspaceScope)
                    }
                }
            }
        }
    }
    private fun capture(name: String) {
        compose.waitForIdle()
        captureNativeWindow(File(context.getExternalFilesDir(null), "feedback-$width-$name.png"))
    }

    @Test fun schemesPreviewsAndIndependentSwitchesInBothThemes() {
        show()
        listOf(false, true).forEach { night ->
            compose.runOnIdle { dark = night }
            listOf("habit-feedback-animations", "habit-feedback-sound", "habit-feedback-haptics",
                "habit-feedback-achievements", "habit-feedback-quests", "habit-feedback-gamification").forEach { tag ->
                compose.onNodeWithTag(tag).performScrollTo().performClick()
                compose.onNodeWithTag(tag).assertIsEnabled()
            }
            habitSoundSchemes.forEach { scheme ->
                compose.onNodeWithTag("feedback-scheme-$scheme").performScrollTo().performClick().assertIsSelected()
                compose.runOnIdle { assertEquals(scheme, settings.soundScheme) }
            }
            compose.onNodeWithTag("feedback-scheme-calm").performScrollTo()
            capture(if(night) "dark-schemes" else "light-schemes")
            habitFeedbackKinds.forEach { kind ->
                compose.onNodeWithTag("feedback-event-$kind").performScrollTo().performClick()
                compose.onNodeWithTag("feedback-test").performScrollTo().performClick()
                compose.waitUntil(5000) { compose.onAllNodesWithTag("habit-feedback-notice").fetchSemanticsNodes().isNotEmpty() }
                compose.onNodeWithTag("habit-feedback-notice").assertIsDisplayed()
            }
            capture(if(night) "dark-preview" else "light-preview")
        }
        compose.runOnIdle { enabled = false }
        compose.onNodeWithTag("feedback-test").assertIsNotEnabled()
        compose.onNodeWithTag("feedback-listen-calm").assertIsNotEnabled()
    }

    @Test fun everyBundledCueDecodesWithTheAndroidMediaPlayer() {
        habitSoundSchemes.forEach { scheme -> habitFeedbackKinds.forEach { kind ->
            val player = MediaPlayer()
            try {
                context.assets.openFd("originals/feedback-audio/$scheme-$kind.wav").use {
                    player.setDataSource(it.fileDescriptor, it.startOffset, it.length)
                }
                player.prepare()
                assertTrue("$scheme-$kind duration", player.duration in 300..1000)
            } finally { player.release() }
        } }
    }

    @Test fun previewDoesNotWriteProgressAndNotificationTestUsesTheRealAndroidChannel() {
        val app = context.applicationContext as GenesisApplication
        val before = runBlocking { app.database.dao().document(app.workspaceScope, "habits")?.revision }
        val manager = app.getSystemService(android.app.NotificationManager::class.java)
        app.scheduler.createChannels(language)
        assertTrue("Notification permission is required for the real-channel test", app.scheduler.notificationsAllowed())
        assertTrue("Achievement channel must be enabled: importance=" +
            manager.getNotificationChannel(ReminderScheduler.ACHIEVEMENT_CHANNEL)?.importance,
            app.scheduler.channelAllowed(ReminderScheduler.ACHIEVEMENT_CHANNEL))
        manager.cancel("habit-feedback-test", 7303)
        manager.cancel("habit-achievement", 7302)
        show()
        try {
            compose.onNodeWithTag("feedback-event-quest").performScrollTo().performClick()
            compose.onNodeWithTag("feedback-test").performScrollTo().performClick()
            compose.waitUntil(5000) { compose.onAllNodesWithTag("habit-feedback-notice").fetchSemanticsNodes().isNotEmpty() }
            assertEquals(before, runBlocking { app.database.dao().document(app.workspaceScope, "habits")?.revision })
            compose.onNodeWithTag("feedback-notification-test").performScrollTo().performClick()
            compose.waitUntil(5000) { compose.onAllNodesWithTag("feedback-notification-status").fetchSemanticsNodes().isNotEmpty() }
            compose.waitUntil(5000) { manager.activeNotifications.any { it.id == 7303 && it.tag == "habit-feedback-test" } }
            val notification = manager.activeNotifications.first { it.id == 7303 && it.tag == "habit-feedback-test" }.notification
            assertEquals(ReminderScheduler.ACHIEVEMENT_CHANNEL, notification.channelId)
            assertNull(notification.sound); assertNull(notification.vibrate)
            assertEquals(0, notification.defaults and (android.app.Notification.DEFAULT_SOUND or android.app.Notification.DEFAULT_VIBRATE))
            fun offerAndAwait(kind: String, title: String) {
                // Both phases must reach the lifecycle collector, otherwise a dropped
                // disabled event would make the negative assertion pass vacuously.
                compose.runOnIdle {
                    app.offerHabitFeedback(HabitFeedbackEvent(app.workspaceScope, kind, title, settings, achievements = 1))
                }
                compose.waitUntil(5000) {
                    compose.onAllNodes(hasTestTag("habit-feedback-notice") and hasAnyDescendant(hasText(title)))
                        .fetchSemanticsNodes().isNotEmpty()
                }
            }
            compose.runOnIdle { settings = settings.copy(achievementPopups = false) }
            compose.onNodeWithTag("feedback-notification-test").assertIsNotEnabled()
            offerAndAwait("completion", "QA feedback disabled")
            assertFalse(manager.activeNotifications.any { it.id == 7302 && it.tag == "habit-achievement" })
            compose.runOnIdle { settings = settings.copy(achievementPopups = true) }
            offerAndAwait("achievement", "QA feedback enabled")
            compose.waitUntil(5000) { manager.activeNotifications.any { it.id == 7302 && it.tag == "habit-achievement" } }
            val actual = manager.activeNotifications.first { it.id == 7302 && it.tag == "habit-achievement" }.notification
            assertEquals(ReminderScheduler.ACHIEVEMENT_CHANNEL, actual.channelId)
            assertNull(actual.sound); assertNull(actual.vibrate)
        } finally {
            manager.cancel("habit-feedback-test", 7303)
            manager.cancel("habit-achievement", 7302)
        }
    }

    @Test fun allFourteenLanguagesKeepTheThreeSchemesAccessible() {
        show()
        listOf("ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja").forEach { lang ->
            compose.runOnIdle { language = lang }
            habitSoundSchemes.forEach { scheme ->
                compose.onNodeWithTag("feedback-scheme-$scheme").performScrollTo().assertIsDisplayed()
                compose.onNodeWithTag("feedback-listen-$scheme").assertHasClickAction()
            }
            compose.onNodeWithTag("feedback-test").performScrollTo().assertIsDisplayed()
        }
    }

    @Test fun realTrialsGenerateAndRemainVisibleWithoutGameWidgets() {
        val app = context.applicationContext as GenesisApplication
        check(app.workspaceScope == "internal-validation-v1")
        val scope = app.workspaceScope
        val dao = app.database.dao()
        val original = runBlocking { dao.document(scope, "habits") }
        val today = java.time.LocalDate.now()
        val engine = ru.genesis.calendar.domain.habits.HabitEngine(ru.genesis.calendar.domain.GenesisCalendar())
        val habit = ru.genesis.calendar.domain.habits.Habit(
            ru.genesis.calendar.domain.habits.TrackerEntity.create("habit", id = "feedback-trial-fixture"), "Read", today,
            engine.defaultSchedule(today, ru.genesis.calendar.domain.CalendarMode.PROFANE))
        val repository = HabitsRepository(app)
        try {
            val initial = LocalHabitWorkspace(habits = listOf(habit), settings = HabitSettings(feedback =
                HabitFeedbackSettings(animations = false, gamificationWidgets = false)))
            runBlocking {
                dao.putDocument(DocumentRecord(scope, "habits", LocalCipher().encrypt(HabitDocument.encode(initial), "$scope/habits"), 1))
                repository.refresh()
            }
            compose.setContent { MaterialTheme(colorScheme = standart, typography = GenesisTypography, shapes = GenesisShapes) {
                Surface(Modifier.fillMaxSize().safeDrawingPadding()) { HabitsScreen(app, true,
                    inputCalendarMode = ru.genesis.calendar.domain.CalendarMode.PROFANE,
                    displayCalendarMode = ru.genesis.calendar.domain.CalendarMode.PROFANE, openHeroPath = true) }
            } }
            compose.waitUntil(8000) { compose.onAllNodesWithTag("habit-quest-panel").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithTag("habit-quest-panel").performScrollTo().assertIsDisplayed()
            listOf("daily", "weekly", "epic").forEach { compose.onNodeWithTag("quest-$it").assertExists() }
            compose.onNodeWithTag("habit-hero-path-section").assertDoesNotExist()
            val current = runBlocking { repository.workspace.first() }
            runBlocking { repository.updateSettings(current.settings.copy(feedback = current.settings.feedback.copy(questsEnabled = false))) }
            compose.waitUntil(5000) { compose.onAllNodesWithTag("habit-quest-panel").fetchSemanticsNodes().isEmpty() }
            assertEquals(current.quests, runBlocking { repository.workspace.first() }.quests)
            runBlocking { repository.updateSettings(current.settings) }
            compose.waitUntil(5000) { compose.onAllNodesWithTag("habit-quest-panel").fetchSemanticsNodes().isNotEmpty() }
        } finally {
            runBlocking { original?.let { dao.putDocument(it) } ?: dao.deleteDocument(scope, "habits") }
        }
    }
}
