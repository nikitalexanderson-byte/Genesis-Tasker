package ru.genesis.calendar

import android.graphics.BitmapFactory
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.time.LocalDate
import java.time.ZoneId
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.auth.*
import ru.genesis.calendar.domain.*
import ru.genesis.calendar.ui.*

/** Installed Compose screens; synthetic debug workspace only. */
class Refinements305AcceptanceTest {
    @get:Rule val compose = createAndroidComposeRule<StoicheionGestureActivity>()
    private val app get() = compose.activity.application as GenesisApplication
    private val dark get() = InstrumentationRegistry.getArguments().getString("genesisDark") == "true"
    private fun content(block: @Composable () -> Unit) {
        check(BuildConfig.DEBUG && app.workspaceScope == "internal-validation-v1")
        compose.setContent {
            CompositionLocalProvider(LocalGenesisLanguage provides "ru", LocalEveningTheme provides dark,
                LocalSacredFeaturesEnabled provides true) {
                MaterialTheme(colorScheme = if (dark) evening else standart,
                    typography = GenesisTypography, shapes = GenesisShapes) {
                    Surface(Modifier.fillMaxSize()) { block() }
                }
            }
        }
    }
    private fun capture(name: String) {
        compose.waitForIdle()
        captureNativeWindow(File(app.getExternalFilesDir(null), "refinements-305/$name.png").apply { parentFile?.mkdirs() })
    }
    @Test fun monthAndYearKeepTheirArtworkAndCalendarNavigation() {
        var mode by mutableStateOf(CalendarMode.PROFANE)
        val date = LocalDate.of(2026, 10, 28)
        content { key(mode) { Column(Modifier.safeDrawingPadding()) {
            CalendarScreen(date, mode, {}, experimental = true, regionalSeasonArt = true,
                seasonRegionZone = ZoneId.of("Australia/Perth"))
        } } }
        CalendarMode.entries.forEach { next ->
            compose.runOnIdle { mode = next }
            compose.onNodeWithTag("calendar-month").assertExists()
            capture("${next.wireValue}-month")
            compose.onNodeWithText("Год", substring = false).performClick()
            compose.onNodeWithTag("calendar-year").assertExists()
            if (next == CalendarMode.PROFANE) {
                compose.onNodeWithTag("calendar-year").performScrollToNode(hasTestTag("calendar-year-month-2026-01-01"))
                compose.onNodeWithTag("gregorian-year-art-2026-01-01", useUnmergedTree = true).assertExists()
                compose.onNodeWithTag("gregorian-year-number-1", useUnmergedTree = true).assertDoesNotExist()
            }
            compose.waitUntil(10_000) {
                compose.onAllNodes(hasContentDescription("Иллюстрация месяца", substring = true), useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()
            }
            capture("${next.wireValue}-year")
        }
    }
    @Test fun adviceRevealsTheIllustrationAndKeepsItsActionsUsable() {
        val bitmap = app.assets.open("originals/weekday-art/weekday-6-saturday-cronus.webp").use { BitmapFactory.decodeStream(it) }
        val copy = JSONObject(app.assets.open("originals/i18n/daily-advice-copy.json").bufferedReader().use { it.readText() }).getJSONObject("ru")
        val body = "Сохраняйте внутреннюю меру и ясность намерения. Дайте себе время увидеть главное, прежде чем переходить к следующему действию."
        val card = DailyAdvice("advice-" + "a".repeat(24), "2026-10-28", "Практика внутренней меры", body,
            "ru", listOf("aretology"), null, false, emptyList())
        var dismissed = false; var liked = ""
        content { Column(Modifier.safeDrawingPadding().verticalScroll(rememberScrollState()).padding(16.dp)) {
            DailyAdviceCard(card, copy, bitmap, false, false, onReaction = { liked = it }, onOpenDiary = {}, onDismiss = { dismissed = true })
        } }
        compose.onNodeWithTag("daily-advice-body").assertTextEquals(body)
        val bounds = compose.onNodeWithTag("today-daily-advice").fetchSemanticsNode().boundsInRoot
        val art = compose.onNodeWithTag("daily-advice-art", useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
        assertEquals(bounds.left, art.left, 2f)
        assertEquals(bounds.width, art.width, 2f)
        compose.onNodeWithTag("daily-advice-favorite").performScrollTo().assertHeightIsAtLeast(48.dp).performClick()
        assertEquals("favorite", liked)
        capture("advice")
        compose.onNodeWithTag("daily-advice-dismiss").performScrollTo().performClick()
        assertTrue(dismissed)
    }
    @Test fun habitDataIsADialogAndSleepStartsWithItsIllustrationAndPlanAction() {
        var sleep by mutableStateOf(false)
        content { Column(Modifier.safeDrawingPadding()) { if (sleep) TrackersScreen(app, true) else HabitsScreen(app, true) } }
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("habit-workspace-menu").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("habit-workspace-menu").performScrollTo().performClick()
        compose.onNodeWithTag("habit-open-data").performClick()
        compose.onNodeWithTag("habit-data-dialog").assertIsDisplayed()
        capture("habit-data-dialog")
        compose.onNodeWithText("Закрыть", substring = false).performClick()
        compose.onNodeWithTag("habit-workspace-today").assertExists()
        compose.runOnIdle { sleep = true }
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("sleep-plan-header").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("sleep-plan-header").assertExists()
        compose.onNodeWithTag("sleep-recovery-art").assertIsDisplayed()
        assertNotNull(app.assets.open("originals/tracker-art/sleep-recovery-v1.png").use { BitmapFactory.decodeStream(it) })
        capture("sleep-recovery")
    }
    @Test fun projectCalendarAndGanttUseSeparateSectionsAndAllFourScales() {
        var mode by mutableStateOf(CalendarMode.PROFANE)
        var gantt by mutableStateOf(false)
        val date = LocalDate.now()
        val scheduled = JSONObject().put("id", "scheduled-305").put("title", "Спланировать выпуск").put("statusId", "todo")
            .put("revision", 1).put("startDate", date.toString()).put("dueDate", date.plusDays(2).toString())
        val unplaced = JSONObject().put("id", "unplaced-305").put("title", "Подготовить материалы").put("statusId", "todo").put("revision", 1)
        content { Column(Modifier.safeDrawingPadding().verticalScroll(rememberScrollState()).padding(12.dp)) {
            if (gantt) SharedGanttView(listOf(scheduled, unplaced), listOf(JSONObject().put("id", "todo").put("isDone", false)),
                mode, CalendarMode.PROFANE, true, true, false, {}, { row, patch -> JSONObject(row.toString()).apply { patch.keys().forEach { put(it, patch.get(it)) }; put("revision", row.getInt("revision") + 1) } })
            else SharedProjectCalendarGrid(GenesisCalendar(), date, mode, date, true, JSONObject(), {}, remember { mutableMapOf() }, null)
        } }
        CalendarMode.entries.forEach { next ->
            compose.runOnIdle { mode = next }
            compose.onNodeWithTag("shared-calendar-grid").assertIsDisplayed()
            capture("project-${next.wireValue}-calendar")
        }
        compose.runOnIdle { mode = CalendarMode.PROFANE; gantt = true }
        listOf("hours", "days", "weeks", "months").forEach { scale ->
            compose.onNodeWithTag("gantt-scale-$scale").performScrollTo().performClick()
            compose.onNodeWithTag("gantt-unplaced").assertExists()
            capture("gantt-$scale")
        }
    }
}
