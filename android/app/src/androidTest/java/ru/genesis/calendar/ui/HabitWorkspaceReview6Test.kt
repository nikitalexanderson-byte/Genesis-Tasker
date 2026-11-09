package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.room.withTransaction
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.*
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.captureNativeWindow
import ru.genesis.calendar.data.*
import ru.genesis.calendar.domain.*
import ru.genesis.calendar.domain.habits.*

/** Isolated repository scenarios for the daily workspace and contextual history. */
class HabitWorkspaceReview6Test {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    private lateinit var app: GenesisApplication
    private lateinit var repository: HabitsRepository
    private var original: DocumentRecord? = null
    private val scope = "internal-validation-v1"
    private val args get() = InstrumentationRegistry.getArguments()
    private val width get() = args.getString("genesisWidth")?.toIntOrNull() ?: 390
    private val dark get() = args.getString("genesisDark") == "true"
    private val fontScale get() = args.getString("genesisFontScale")?.toFloatOrNull() ?: 1f
    private val today get() = LocalDate.now()

    @Before fun preserveSyntheticWorkspace() {
        app = compose.activity.application as GenesisApplication
        check(BuildConfig.DEBUG && app.packageName.endsWith(".debug") && app.workspaceScope == scope)
        repository = HabitsRepository(app)
        original = runBlocking { app.database.dao().document(scope, "habits") }
    }

    @After fun restoreSyntheticWorkspace() {
        if (!::app.isInitialized) return
        check(app.workspaceScope == scope)
        runBlocking { app.database.withTransaction {
            original?.let { app.database.dao().putDocument(it) }
                ?: app.database.dao().deleteDocument(scope, "habits")
        } }
    }

    private fun habit(id: String, title: String) = Habit(TrackerEntity.create("habit", id = id), title,
        today.minusDays(2), HabitEngine(GenesisCalendar()).defaultSchedule(today.minusDays(2), CalendarMode.PROFANE))

    private fun write(habits: List<Habit>) = runBlocking {
        val workspace = LocalHabitWorkspace(habits = habits, settings = HabitSettings(feedback = HabitFeedbackSettings(
            animations = false, achievementPopups = false, sound = false, haptics = false,
            questsEnabled = false, gamificationWidgets = false)))
        app.database.withTransaction { app.database.dao().putDocument(DocumentRecord(scope, "habits",
            LocalCipher().encrypt(HabitDocument.encode(workspace), "$scope/habits"), 1)) }
    }

    private fun read() = runBlocking { repository.workspace.first() }

    private fun render() {
        compose.setContent {
            val density = compose.activity.resources.displayMetrics.widthPixels.toFloat() / width
            CompositionLocalProvider(LocalDensity provides Density(density, fontScale),
                LocalGenesisLanguage provides "ru", LocalEveningTheme provides dark) {
                MaterialTheme(colorScheme = if (LocalEveningTheme.current) evening else standart,
                    typography = GenesisTypography, shapes = GenesisShapes) {
                    Surface(Modifier.fillMaxSize().safeDrawingPadding()) {
                        HabitsScreen(app, true, CalendarMode.PROFANE, CalendarMode.PROFANE)
                    }
                }
            }
        }
        compose.waitUntil(15_000) { compose.onAllNodesWithTag("habit-daily-hero").fetchSemanticsNodes().isNotEmpty() }
    }

    private fun click(tag: String) {
        compose.waitUntil(15_000) {
            compose.onAllNodes(hasTestTag(tag) and isEnabled(), useUnmergedTree = true)
                .fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag(tag, useUnmergedTree = true).performScrollTo().assertIsEnabled().performClick()
    }

    private fun capture(name: String) {
        compose.waitForIdle()
        captureNativeWindow(File(app.getExternalFilesDir(null),
            "review6-habits-$width-${if (dark) "dark" else "light"}-font${(fontScale * 100).toInt()}-$name.png"))
    }

    @Test fun completionAndContextualHistoryKeepTheChosenHabitAndReturnToTheLibrary() {
        val first = habit("review6-first", "Первая привычка")
        val second = habit("review6-second", "Вторая привычка с длинным русским названием")
        write(listOf(first, second)); render()
        compose.onNodeWithTag("habit-daily-hero").assertExists()
        click("habit-complete-${second.id}")
        compose.waitUntil(15_000) { read().completions.any { it.habitId == second.id && it.date == today && it.completed } }
        click("habit-view-library")
        click("habit-details-${second.id}")
        click("habit-history-open-${second.id}")
        compose.onNodeWithTag("habit-history-selected-title").performScrollTo().assertTextEquals(second.title)
        compose.onNodeWithTag("habit-history-content").assertExists()
        capture("contextual-history")
        click("habit-workspace-back")
        compose.onNodeWithTag("habit-workspace-library").assertExists()
        click("habit-complete-${second.id}")
        compose.waitUntil(15_000) { read().completions.any { it.habitId == second.id && !it.completed } }
        assertEquals(setOf(first.id, second.id), read().habits.map { it.id }.toSet())
        capture("library-return")
    }

    @Test fun compactCountGoalSavesAnExecutionWithItsNoteExactlyOnce() {
        val target = habit("review6-count", "Три выполнения за неделю").copy(periodGoal = HabitPeriodGoal(
            period = "week", metric = "entries", target = 3, calendar = "profane",
            context = CalendarContext(timeZone = ZoneId.systemDefault().id)))
        write(listOf(target)); render()
        click("habit-measurement-manual-${target.id}")
        compose.onNodeWithTag("habit-measurement-note-${target.id}", useUnmergedTree = true).performScrollTo().performTextInput("Заметка к выполнению")
        click("habit-measurement-save-${target.id}")
        compose.waitUntil(15_000) { read().measurements.any { it.habitId == target.id && it.note == "Заметка к выполнению" } }
        val entries = read().measurements.filter { it.habitId == target.id }
        assertEquals(1, entries.size)
        assertEquals(1000L, entries.single().value)
        assertEquals("Заметка к выполнению", entries.single().note)
        compose.onNodeWithTag("habit-measurement-note-${target.id}").assertDoesNotExist()
        capture("count-goal-note-saved")
    }
}
