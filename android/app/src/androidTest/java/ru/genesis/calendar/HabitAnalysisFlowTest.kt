package ru.genesis.calendar

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import androidx.room.withTransaction
import androidx.test.platform.app.InstrumentationRegistry
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.*
import ru.genesis.calendar.data.*
import ru.genesis.calendar.domain.*
import ru.genesis.calendar.domain.habits.*
import ru.genesis.calendar.ui.*

class HabitAnalysisFlowTest {
    @get:Rule val compose = createAndroidComposeRule<StoicheionGestureActivity>()
    private lateinit var app: GenesisApplication
    private lateinit var scope: String
    private lateinit var repository: HabitsRepository
    @Before fun setup() {
        app = compose.activity.application as GenesisApplication
        check(BuildConfig.DEBUG && app.packageName.endsWith(".debug") && app.workspaceScope == "internal-validation-v1")
        app.activateAccount(UUID.randomUUID().toString()); scope = app.workspaceScope; repository = HabitsRepository(app)
    }
    @After fun cleanup() {
        runBlocking { app.database.withTransaction {
            app.database.openHelper.writableDatabase.execSQL("DELETE FROM documents WHERE scope=?", arrayOf(scope))
            app.database.openHelper.writableDatabase.execSQL("DELETE FROM outbox WHERE scope=?", arrayOf(scope))
        } }
        app.activateAccount(null)
    }
    private fun write(value: LocalHabitWorkspace) = runBlocking { app.database.withTransaction {
        app.database.dao().putDocument(DocumentRecord(scope, "habits", LocalCipher().encrypt(HabitDocument.encode(value), "$scope/habits"), 1))
    } }
    private fun read() = runBlocking { repository.workspace.first() }
    private fun capture(name: String) {
        val folder = java.io.File(app.getExternalFilesDir(null), "refinements-304").apply { mkdirs() }
        captureNativeWindow(java.io.File(folder, "analysis-$name.png"))
    }
    private fun observed(start: LocalDate): Habit {
        val at = start.atStartOfDay(ZoneId.systemDefault()).toInstant().toString()
        val habit = Habit(TrackerEntity("report-${UUID.randomUUID()}", at, at), "Собственная практика", start,
            HabitEngine(GenesisCalendar()).defaultSchedule(start, CalendarMode.PROFANE))
        return HabitLifecycle.apply(habit, HabitLifecycleCommand("observed", habit.id, at, "observe", emptyList()))
    }
    private fun render(mode: CalendarMode = CalendarMode.PROFANE, anchor: LocalDate = LocalDate.now(),
        history: (String, LocalDate) -> Unit = { _, _ -> }, decision: suspend (HabitDayDecisionCommand) -> Unit = { repository.decideDay(it) }) {
        compose.setContent {
            val workspace by repository.workspace.collectAsState(initial = read())
            val dark = InstrumentationRegistry.getArguments().getString("genesisDark") == "true"
            CompositionLocalProvider(LocalGenesisLanguage provides "ru", LocalEveningTheme provides dark) {
                MaterialTheme(colorScheme = if (dark) evening else standart) { Surface(Modifier.fillMaxSize()) {
                    Column(Modifier.safeDrawingPadding().verticalScroll(rememberScrollState()).padding(16.dp)) {
                        HabitAnalysisPanel(workspace, anchor, mode, history, decision)
                    }
                } }
            }
        }
        compose.waitUntil(30_000) { compose.onAllNodesWithTag("habit-goal-rate").fetchSemanticsNodes().isNotEmpty() }
    }
    @Test fun sourceNavigationAndComparisonReadEncryptedHistoryWithoutChangingIt() {
        val assets = InstrumentationRegistry.getInstrumentation().context.assets
        val cases = JSONArray(assets.open("habit-analysis-web.json").bufferedReader().use { it.readText() })
        val source = HabitDocument.decode(ru.genesis.calendar.data.CloudAccountImporter.habitsDocument(cases.getJSONObject(1).getJSONObject("workspace")), 0)
        write(source)
        val before = runBlocking { app.database.dao().document(scope, "habits") }; val outbox = runBlocking { app.database.dao().outbox(scope) }
        var opened: Pair<String, LocalDate>? = null
        render(anchor = LocalDate.parse("2026-10-22"), history = { id, date -> opened = id to date })
        capture("overview")
        compose.onNodeWithText("Сравнение").performScrollTo().performClick()
        compose.onNodeWithTag("habit-comparison-current").assertExists()
        capture("comparison")
        compose.onNodeWithTag("habit-analysis-day-2026-10-19").performScrollTo().performClick()
        compose.onNodeWithTag("habit-source-v1").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("habit-source-v2").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("habit-analysis-edit").performScrollTo().performClick()
        assertEquals(source.habits.first().id to LocalDate.parse("2026-10-19"), opened)
        compose.onNodeWithTag("habit-analysis-previous").performScrollTo().performClick()
        compose.onNodeWithTag("habit-analysis-next").performScrollTo().performClick()
        assertEquals(before, runBlocking { app.database.dao().document(scope, "habits") })
        assertEquals(outbox, runBlocking { app.database.dao().outbox(scope) })
    }
    @Test fun actualTodaySkipAndUndoPersistOnceWithoutIssuingRewards() {
        val today = LocalDate.now(); val habit = observed(today.minusDays(2))
        val at = Instant.now().minusSeconds(60).toString()
        write(LocalHabitWorkspace(habits = listOf(habit), rewards = listOf(Rewards.create(25.0, "comeback", "seed", "seed", at)),
            progress = UserProgress(lifetimeXp = 80, laurelsBalance = 25)))
        val before = read(); val commands = mutableListOf<HabitDayDecisionCommand>()
        render(decision = { commands += it; repository.decideDay(it) })
        compose.onNodeWithTag("habit-analysis-day-$today").performScrollTo().performClick()
        compose.onNodeWithTag("habit-analysis-skip").performScrollTo().performClick()
        compose.waitUntil(15_000) { read().completions.firstOrNull { it.date == today }?.skippedAt != null }
        val skipped = read(); assertEquals(before.rewards, skipped.rewards); assertEquals(before.progress.lifetimeXp, skipped.progress.lifetimeXp)
        compose.waitUntil(15_000) { compose.onNodeWithTag("habit-analysis-skip").fetchSemanticsNode().config.getOrNull(SemanticsProperties.Disabled) == null }
        compose.onNodeWithTag("habit-analysis-skip").performScrollTo().performClick()
        compose.waitUntil(15_000) { read().completions.firstOrNull { it.date == today }?.skippedAt == null && read().history.size == 2 }
        assertEquals(before.rewards, read().rewards); assertEquals(before.progress.lifetimeXp, read().progress.lifetimeXp)
        val count = read().history.size
        val document = runBlocking { app.database.dao().document(scope, "habits") }; val outbox = runBlocking { app.database.dao().outbox(scope) }
        runBlocking { repository.decideDay(commands.last()) }
        assertEquals(count, read().history.size); assertEquals(before.rewards, read().rewards)
        assertEquals(document, runBlocking { app.database.dao().document(scope, "habits") })
        assertEquals(outbox, runBlocking { app.database.dao().outbox(scope) })
    }
    @Test fun actualLongLunarYearIncludesEveryDateAndTheLastCell() {
        val calendar = GenesisCalendar()
        val range = (2020..2026).map { calendar.yearRange(LocalDate.of(it, 7, 1), CalendarMode.LUNAR) }.first { it.dates().size > 370 }
        write(LocalHabitWorkspace(habits = listOf(observed(range.start))))
        render(mode = CalendarMode.LUNAR, anchor = range.start.plusDays(100))
        compose.onNodeWithTag("habit-analysis-year").performScrollTo().performClick()
        val dates = SemanticsMatcher("report date") { it.config.getOrNull(SemanticsProperties.TestTag)?.startsWith("habit-analysis-day-") == true }
        compose.waitUntil(30_000) { compose.onAllNodes(dates).fetchSemanticsNodes().size == range.dates().size }
        compose.onNodeWithTag("habit-analysis-day-${range.start}").assertExists()
        compose.onNodeWithTag("habit-analysis-day-${range.end}").performScrollTo().assertIsDisplayed()
        assertTrue(range.dates().size > 370)
    }
}
