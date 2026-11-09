package ru.genesis.calendar

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.ui.Modifier
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import java.io.File
import java.time.LocalDate
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.Before
import org.junit.After
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import ru.genesis.calendar.data.HabitsRepository
import ru.genesis.calendar.data.HabitSettings
import ru.genesis.calendar.ui.HabitsScreen
import ru.genesis.calendar.ui.standart
import ru.genesis.calendar.ui.evening
import ru.genesis.calendar.ui.LocalEveningTheme
import ru.genesis.calendar.ui.LocalSacredFeaturesEnabled
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.GenesisCalendar

class HabitsVisualTest {
    @get:Rule val compose = createAndroidComposeRule<StoicheionGestureActivity>()
    private val width = InstrumentationRegistry.getArguments().getString("genesisWidth")?.toIntOrNull()
    private val experimental = InstrumentationRegistry.getArguments().getString("genesisExperimental") != "false"
    private val dark = InstrumentationRegistry.getArguments().getString("genesisDark") == "true"
    private lateinit var repository: HabitsRepository
    private lateinit var originalSettings: HabitSettings
    @Before fun enableOnlySyntheticRewardWidgets() {
        val app = compose.activity.application as GenesisApplication
        check(BuildConfig.DEBUG && app.workspaceScope == "internal-validation-v1")
        repository = HabitsRepository(app)
        originalSettings = runBlocking { repository.workspace.first().settings }
        runBlocking { repository.updateSettings(originalSettings.copy(enabled = true,
            feedback = originalSettings.feedback.copy(gamificationWidgets = true))) }
    }
    @After fun restoreSyntheticSettings() {
        runBlocking { repository.updateSettings(originalSettings) }
    }

    @Test fun dailyHabitsLeadAndRankArtStaysInLabeledSection() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        check(BuildConfig.DEBUG && app.workspaceScope == "internal-validation-v1")
        compose.setContent {
            val originalDensity = LocalDensity.current
            val density = width?.let { Density(compose.activity.resources.displayMetrics.widthPixels.toFloat() / it,
                originalDensity.fontScale) } ?: originalDensity
            CompositionLocalProvider(LocalDensity provides density, LocalEveningTheme provides dark,
                LocalSacredFeaturesEnabled provides true) {
                MaterialTheme(colorScheme = if (dark) evening else standart) {
                    Surface(Modifier.fillMaxSize(),color=MaterialTheme.colorScheme.background) {
                        androidx.compose.foundation.layout.Column(Modifier.safeDrawingPadding()) {
                            HabitsScreen(app, experimental)
                        }
                    }
                }
            }
        }
        compose.waitUntil(10_000) {
            compose.onAllNodesWithTag("habit-workspace-today").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("habit-workspace-menu").assertExists()
        compose.onNodeWithTag("habit-workspace-menu").performScrollTo().performClick()
        compose.onNodeWithTag("habit-open-development").performClick()
        if (experimental) compose.onNodeWithText("Путь Героя и награды").assertExists()
        compose.onNodeWithContentDescription("Путь героических рангов").assertDoesNotExist()
        if (experimental) compose.onNodeWithTag("habit-hero-path-toggle").assertDoesNotExist()
        assertTrue(UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
            .takeScreenshot(File(app.getExternalFilesDir(null),
                "habits-${if (experimental) "experimental" else "standart"}-${width ?: 390}.png")))
        if (experimental) {
            compose.onNodeWithTag("habit-hero-path-heading").performScrollTo().assertIsDisplayed()
            compose.onNodeWithText("Свернуть путь").assertDoesNotExist()
            compose.onNodeWithTag("all-hero-ranks").performScrollTo().assertIsDisplayed().performClick()
            compose.onNodeWithTag("all-streak-milestones").performScrollTo().assertIsDisplayed().performClick()
            compose.onNodeWithTag("all-achievements").performScrollTo().assertIsDisplayed().performClick()
            compose.onNodeWithText("Свернуть достижения").assertExists()
            assertTrue(UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
                .takeScreenshot(File(app.getExternalFilesDir(null), "habits-rewards-buttons-${width ?: 390}.png")))
            compose.onNodeWithTag("habit-workspace-menu").performScrollTo().performClick()
            compose.onNodeWithTag("habit-open-sacred").performClick()
            compose.onNodeWithTag("sacred-habits-toggle").assertDoesNotExist()
            compose.onNodeWithText("Свернуть сакральные практики").assertDoesNotExist()
            compose.onNodeWithText("Север", substring=false).assertExists()
            compose.onNodeWithText("Северо-Запад", substring=false).assertExists()
            compose.onNodeWithText("Северо-Запад", substring=false).performScrollTo()
            assertTrue(UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
                .takeScreenshot(File(app.getExternalFilesDir(null), "habits-sacred-directions-${width ?: 390}.png")))
            compose.onNodeWithText("ТЕОКИКЛОС · ВОПЛОЩЁННЫЙ МИФ").performScrollTo()
            assertTrue(UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
                .takeScreenshot(File(app.getExternalFilesDir(null), "habits-sacred-open-${width ?: 390}.png")))
            compose.onNodeWithText("Сон и настроение").performClick()
            compose.onNodeWithTag("sleep-plan-header").assertExists()
            assertTrue(UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
                .takeScreenshot(File(app.getExternalFilesDir(null), "habits-sleep-${width ?: 390}.png")))
            compose.onNodeWithText("Привычки").performClick()
        }
        compose.onNodeWithTag("habit-workspace-menu").performScrollTo().performClick()
        compose.onNodeWithTag("habit-open-library").performClick()
        compose.onNodeWithTag("habit-create").performClick()
        compose.onNodeWithText("Календарь привычки").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Отображение дат в этой форме").assertDoesNotExist()
        // The chip row scrolls horizontally; reveal the following label in the vertical dialog first.
        compose.onNodeWithText("Начало", substring = false).performScrollTo()
        compose.onNodeWithTag("habit-calendar-lunar").performScrollTo().performClick()
        compose.onNodeWithTag("habit-calendar-lunar").assertIsSelected()
        compose.onNodeWithText("Дни расписания").assertExists()
        compose.onNodeWithText(GenesisCalendar().formatDate(LocalDate.now(),CalendarMode.LUNAR)).assertExists()
        assertTrue(UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
            .takeScreenshot(File(app.getExternalFilesDir(null),"habits-editor-lunar-${width ?: 390}.png")))
    }
}
