package ru.genesis.calendar

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import androidx.room.withTransaction
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.time.LocalDate
import java.util.UUID
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.data.*
import ru.genesis.calendar.domain.*
import ru.genesis.calendar.domain.habits.*
import ru.genesis.calendar.ui.*

/** Real Compose surfaces with synthetic data, repeated at physical sizes and both themes. */
class Refinements304AcceptanceTest {
    @get:Rule val compose = createAndroidComposeRule<StoicheionGestureActivity>()
    private val app get() = compose.activity.application as GenesisApplication
    private val dark get() = InstrumentationRegistry.getArguments().getString("genesisDark") == "true"
    private fun content(block: @Composable () -> Unit) {
        compose.setContent {
            CompositionLocalProvider(LocalGenesisLanguage provides "ru", LocalEveningTheme provides dark) {
                MaterialTheme(colorScheme = if (dark) evening else standart,
                    typography = GenesisTypography, shapes = GenesisShapes) {
                    Surface(Modifier.fillMaxSize()) { block() }
                }
            }
        }
    }
    private fun capture(name: String) {
        val folder = File(app.getExternalFilesDir(null), "refinements-304").apply { mkdirs() }
        captureNativeWindow(File(folder, "$name.png"))
    }

    @Test fun yearDetailsAndCircleShareTheCtaAndBothOpen() {
        content {
            Column(Modifier.safeDrawingPadding().verticalScroll(rememberScrollState()).padding(16.dp)) {
                CalendarYearDescriptionCard(GenesisCalendar(), LocalDate.of(2026, 10, 27), CalendarMode.SACRED)
            }
        }
        val details = compose.onNodeWithTag("sacred-year-details-open").performScrollTo().assertHeightIsAtLeast(60.dp)
        val width = details.fetchSemanticsNode().boundsInRoot.width
        val circle = compose.onNodeWithTag("solar-model-open").performScrollTo().assertHeightIsAtLeast(60.dp)
        assertEquals(width, circle.fetchSemanticsNode().boundsInRoot.width, 1f)
        capture("year-actions")
        details.performScrollTo().performClick()
        compose.onNodeWithTag("sacred-year-details-dialog").assertIsDisplayed()
        compose.onNodeWithTag("sacred-year-details-close").performClick()
        circle.performScrollTo().performClick()
        compose.onNodeWithTag("solar-calendar-model").assertIsDisplayed()
        compose.onNodeWithTag("solar-model-close").performClick()
    }

    @Test fun oracleResultKeepsItsArithmeticAndRestorationAction() {
        val data = JSONArray(app.assets.open("stoicheion.json").bufferedReader().use { it.readText() })
        val art = JSONObject(app.assets.open("stoicheion-art.json").bufferedReader().use { it.readText() })
        val letters = (0 until data.length()).map { index ->
            val row = data.getJSONObject(index); val id = row.getString("id"); val image = art.getJSONObject(id)
            StoicheionLetter(id, row.getInt("order"), row.getString("name"), row.getString("symbol"),
                row.getString("lowercase"), row.getInt("value"), row.getInt("pythmen"), row.getString("tagline"),
                row.getString("content"), image.getString("body"), image.getString("bodyGreek"), image.getString("invocation"),
                Color(android.graphics.Color.parseColor(image.getString("accent"))))
        }
        val seed = (1L..100L).first { value -> StoicheionReading.spread(letters, value).any { it.second } }
        val draw = StoicheionDraw("spread", "2026-10-27", seed, 2, 0, 0)
        var restores = 0
        content {
            Column(Modifier.safeDrawingPadding().verticalScroll(rememberScrollState()).padding(16.dp)) {
                StoicheionDrawPanel(letters, StoicheionDraws(draw.copy(kind = "daily"), draw), 1_000L,
                    false, null, {}, {}, "Начать восполнение", { restores++ })
            }
        }
        compose.onNodeWithTag("stoicheion-isopsephy").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("stoicheion-restoration-begin").performScrollTo().assertHeightIsAtLeast(48.dp)
        capture("oracle-result")
        compose.onNodeWithTag("stoicheion-restoration-begin").performClick()
        assertEquals(1, restores)
    }

    @Test fun todayGroupsAndLanguageTilesKeepTheirContentAndSelection() {
        var mode by mutableStateOf(CalendarMode.PROFANE)
        var language by mutableStateOf("ru")
        content {
            Column(Modifier.safeDrawingPadding().verticalScroll(rememberScrollState()).padding(16.dp)) {
                DayHeader(LocalDate.of(2026, 10, 27), mode)
                LanguageChips(language, dark = dark, flagsOnly = true) { language = it }
            }
        }
        CalendarMode.entries.forEach {
            compose.runOnIdle { mode = it }
            compose.onNodeWithTag("today-calendar-name", useUnmergedTree = true).assertExists()
            compose.onNodeWithTag("today-hero-description", useUnmergedTree = true).assertExists()
            compose.onNodeWithTag("today-hero").performScrollTo()
            capture("today-${it.wireValue}")
        }
        compose.onNodeWithTag("language-ja").performScrollTo().performClick().assertIsSelected()
        assertEquals("ja", language)
        capture("language-tiles")
    }

    @Test fun readingPracticeIsAdditionalAndBothStandardPracticesCanStillBeStarted() {
        val catalog = TheokyklosCatalogSource.load(app)
        val practices = catalog.practicesFor("north")
        assertEquals(2, practices.size)
        val today = LocalDate.now()
        val reading = practices.first().toHabit(CalendarMode.PROFANE).copy(
            entity = TrackerEntity.create("habit", id = "reading-304"), title = "Практика из расклада",
            stoicheionRestoration = StoicheionRestorationSnapshot(cycleId = "synthetic-304",
                startedAt = today.toString() + "T00:00:00Z", startedDate = today.toString(),
                sourceDate = today.toString(), sourceSeed = 42, cards = emptyList(), sectorId = "north",
                letterId = "alpha", need = "deficit", supportIds = emptyList(), resourceLetterId = "alpha",
                practiceId = practices.first().id, spreadTotal = 10, pythmen = 1,
                intention = "Намерение", action = "Действие", practiceText = "Личная практика"))
        val started = mutableListOf<String>()
        content {
            Column(Modifier.safeDrawingPadding().verticalScroll(rememberScrollState()).padding(16.dp)) {
                SacredHabitsBlock(LocalHabitWorkspace(habits = listOf(reading)), today, CalendarMode.PROFANE,
                    false, false, {}, experimental = true, onStart = { started += it.id },
                    onEdit = {}, onComplete = { _, _ -> }, onToggle = {})
            }
        }
        compose.onNodeWithTag("sacred-habits-toggle").assertDoesNotExist()
        compose.onNodeWithTag("sacred-sector-north").performScrollTo().performClick()
        practices.forEach { practice ->
            val row = hasAnyAncestor(hasTestTag("sacred-practice-${practice.id}"))
            compose.onNode(hasText("Начать практику") and row).performScrollTo().performClick()
            capture("standard-${practice.id}")
        }
        assertEquals(practices.map { it.id }, started)
        compose.onNodeWithTag("sacred-restoration-reading-304").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Дополнительные практики из раскладов").assertExists()
        capture("additional-reading-practice")
        compose.onNodeWithTag("sacred-sector-close").performScrollTo().performClick()
    }

    @Test fun observationHistoryStartsClosedAndStillNavigatesToItsDay() {
        check(BuildConfig.DEBUG && app.packageName.endsWith(".debug"))
        app.activateAccount("acceptance-304-${UUID.randomUUID()}")
        val scope = app.workspaceScope
        val date = LocalDate.now().minusDays(3)
        try {
            runBlocking { TrackersRepository(app).saveMood(date, 2, "Тестовая запись", emptyList(), 0) }
            content { TrackersScreen(app, experimental = true) }
            compose.waitUntil(10_000) { compose.onAllNodesWithTag("trackers-history").fetchSemanticsNodes().isNotEmpty() }
            val entry = hasText(date.toString(), substring = true) and hasClickAction()
            compose.onAllNodes(entry).assertCountEquals(0)
            compose.onNodeWithText("История наблюдений").performScrollTo()
            capture("observation-history-closed")
            compose.onNodeWithText("История наблюдений").performClick()
            compose.onNode(entry).performScrollTo().assertIsDisplayed()
            capture("observation-history-open")
            compose.onNode(entry).performClick()
            compose.onNodeWithTag("trackers-observation-note").assertExists()
            compose.onNodeWithText("Календарь просмотра").assertDoesNotExist()
        } finally {
            runBlocking { app.database.withTransaction {
                app.database.openHelper.writableDatabase.execSQL("DELETE FROM documents WHERE scope=?", arrayOf(scope))
                app.database.openHelper.writableDatabase.execSQL("DELETE FROM outbox WHERE scope=?", arrayOf(scope))
            } }
            app.activateAccount(null)
        }
    }
}
