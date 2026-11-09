package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import kotlinx.coroutines.runBlocking
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.StoicheionGestureActivity
import ru.genesis.calendar.data.*

class Refinements306InteractionTest {
    @get:Rule val compose = createAndroidComposeRule<StoicheionGestureActivity>()
    private val app get() = compose.activity.application as GenesisApplication
    private fun content(block: @Composable () -> Unit) {
        compose.setContent { CompositionLocalProvider(LocalGenesisLanguage provides "ru", LocalSacredFeaturesEnabled provides true) {
            MaterialTheme(colorScheme = standart, typography = GenesisTypography, shapes = GenesisShapes) {
                Surface(Modifier.fillMaxSize()) { block() }
            }
        } }
    }
    @Test fun stillPressOnBlankViewportAddsAtTheDocumentPointButPanAndReadOnlyDoNot() {
        val map = MindmapDocument.new("Карта", template = "empty")
        var readOnly by mutableStateOf(false)
        var added: Offset? = null
        content { NativeMindmapCanvas(map, map.rows(), JSONObject().put("zoom", 1.0), { it.text }, {}, {},
            { added = it }, { _, _ -> }, Modifier.fillMaxSize(), readOnly) }
        val canvas = compose.onNodeWithTag("mindmap-canvas")
        canvas.performTouchInput { swipe(Offset(10f, height - 30f), Offset(100f, height - 30f), 300) }
        compose.onNodeWithTag("mindmap-context-add").assertDoesNotExist()
        canvas.performTouchInput { longClick(Offset(15f, height - 30f)) }
        compose.onNodeWithTag("mindmap-context-add").assertIsDisplayed().performClick()
        assertNotNull(added)
        assertTrue(added!!.y > 180f) // outside the old short content box
        compose.runOnIdle { readOnly = true }
        canvas.performTouchInput { longClick(Offset(15f, height - 30f)) }
        compose.onNodeWithTag("mindmap-context-add").assertDoesNotExist()
    }
    @Test fun compactSearchKeepsSortFilterAndCloseInOneRowAndPreservesQuery() {
        var query by mutableStateOf("Мой запрос")
        var sort = 0; var filter = 0
        content { Box(Modifier.fillMaxSize()) {
            WorkspaceSearchDock(query, { query = it }, "Поиск задач", "test-search", Modifier.align(androidx.compose.ui.Alignment.BottomCenter)) {
                AffairsIconButton("Сортировка", AffairsAction.SORT, { sort++ }, Modifier.testTag("test-sort"))
                AffairsIconButton("Фильтры", AffairsAction.FILTER, { filter++ }, Modifier.testTag("test-filter"))
            }
        } }
        compose.onNodeWithTag("test-search-open").performClick()
        val field = compose.onNodeWithTag("test-search").fetchSemanticsNode().boundsInRoot
        val sortBounds = compose.onNodeWithTag("test-sort").fetchSemanticsNode().boundsInRoot
        val filterBounds = compose.onNodeWithTag("test-filter").fetchSemanticsNode().boundsInRoot
        val close = compose.onNodeWithTag("test-search-close").fetchSemanticsNode().boundsInRoot
        assertTrue(field.right <= sortBounds.left && sortBounds.right <= filterBounds.left && filterBounds.right <= close.left)
        assertEquals(close.center.y, sortBounds.center.y, 1f)
        compose.onNodeWithTag("test-sort").performClick(); compose.onNodeWithTag("test-filter").performClick()
        assertEquals(1, sort); assertEquals(1, filter)
        compose.onNodeWithTag("test-search-close").performClick()
        assertEquals("Мой запрос", query)
        compose.onNodeWithTag("test-search-open").performClick()
        compose.onNodeWithTag("test-search").assertTextContains("Мой запрос")
    }
    @Test fun sleepHeaderAndEmptyStateBothOpenTheRealPlanEditor() {
        check(ru.genesis.calendar.BuildConfig.DEBUG && app.workspaceScope == "internal-validation-v1")
        runBlocking { TrackersRepository(app).resetTracking() }
        content {
            MobileWorkspaceShell("Привычки", "Сон и настроение", emptyList(), "Тест", true, onNavigate = {}, actions = {}) {
                TrackersScreen(app, true)
            }
        }
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("sleep-plan-empty").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("sleep-plan-header").assertIsEnabled().performTouchInput { click() }
        compose.onNodeWithTag("sleep-plan-close").assertIsDisplayed().performClick()
        compose.onNodeWithTag("sleep-plan-empty").performScrollTo().performClick()
        compose.onNodeWithTag("sleep-plan-close").assertIsDisplayed()
    }
    @Test fun personalEventAndMeetingSaveTheirRealRecordTypes() {
        var type by mutableStateOf("event")
        var saved: LocalTask? = null
        content { key(type) { TaskEditor(null, "2026-10-28", UiPreferences(), WorkspaceStructure(), null,
            null, emptyList(), null, onDismiss = {}, onSave = { saved = it }, onTransfer = null,
            onDelete = null, onDeleteOccurrence = null, showSelectedOccurrence = false, initialEntryType = type) } }
        for (kind in listOf("event", "meeting")) {
            compose.runOnIdle { type = kind; saved = null }
            compose.onNodeWithTag("personal-entry-$kind").assertIsSelected()
            compose.onNodeWithTag("task-title").performTextReplacement("Проверка $kind")
            compose.onNodeWithTag("save-task").performClick()
            compose.runOnIdle {
                assertNotNull(saved)
                assertEquals(kind, JSONObject(saved!!.sourceFieldsJson).getString("entryType"))
                assertEquals("2026-10-28", JSONObject(saved!!.sourceFieldsJson).getString("endDate"))
            }
        }
    }

}
