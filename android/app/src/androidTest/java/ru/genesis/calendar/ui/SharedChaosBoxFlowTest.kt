package ru.genesis.calendar.ui

import android.content.SharedPreferences
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.auth.SharedWorkspaceGateway
import ru.genesis.calendar.captureNativeWindow
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.data.UiPreferences
import java.io.File
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.math.abs

/** Actual hosted Compose screens; every identity and server response is an isolated fixture. */
class SharedChaosBoxFlowTest {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    private val args get() = InstrumentationRegistry.getArguments()
    private val width get() = args.getString("genesisWidth")?.toIntOrNull() ?: 390
    private val dark get() = args.getString("genesisDark") == "true"
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val testAccount = "review5-shared-${UUID.randomUUID()}"
    private var account by mutableStateOf(testAccount)
    private var displayCalendar by mutableStateOf(CalendarMode.PROFANE)
    private lateinit var displayPreferences: SharedPreferences
    private lateinit var sortKey: String
    private var originalSort: String? = null
    private var hadSort = false

    @Before fun preserveDisplayPreference() {
        val app = context.applicationContext as GenesisApplication
        displayPreferences = app.getSharedPreferences("genesis.task-display.v1", 0)
        sortKey = "${app.workspaceScope}:shared:sort"
        hadSort = displayPreferences.contains(sortKey)
        originalSort = displayPreferences.getString(sortKey, null)
        displayPreferences.edit().remove(sortKey).commit()
    }

    @After fun removeOnlySyntheticPreferences() {
        val layout = context.getSharedPreferences("genesis.shared-inbox-layout.v1", 0)
        val edit = layout.edit()
        layout.all.keys.filter { it.startsWith(testAccount) }.forEach { edit.remove(it) }
        edit.commit()
        displayPreferences.edit().apply {
            if (hadSort) putString(sortKey, originalSort) else remove(sortKey)
        }.commit()
    }

    @Composable private fun Theme(content: @Composable () -> Unit) {
        val density = compose.activity.resources.displayMetrics.widthPixels.toFloat() / width
        CompositionLocalProvider(
            LocalDensity provides Density(density, args.getString("genesisFontScale")?.toFloatOrNull() ?: 1f),
            LocalGenesisLanguage provides "ru", LocalEveningTheme provides dark,
            LocalGenesisUserId provides account
        ) {
            MaterialTheme(colorScheme = if (dark) evening else standart, typography = GenesisTypography, shapes = GenesisShapes) {
                Surface(Modifier.fillMaxSize()) { content() }
            }
        }
    }

    private fun open(fixture: ChaosFixture) {
        compose.setContent { Theme {
            MobileWorkspaceShell("Проекты", null, emptyList(), "Синтетическая проверка", true,
                onNavigate = {}, actions = { CalendarModeSwitcher(displayCalendar,
                    { displayCalendar = nextAvailableCalendarMode(displayCalendar, CalendarMode.entries.toSet()) }, size = 48.dp) }) {
                SharedProjectsScreen(fixture, "ru", preferences = UiPreferences(display = displayCalendar, input = CalendarMode.PROFANE))
            }
        } }
        await("shared-space-${fixture.spaceA}")
    }

    private fun await(tag: String) {
        compose.waitUntil(15_000) { compose.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty() }
        compose.waitForIdle()
    }

    private fun click(tag: String, scroll: Boolean = false) {
        await(tag)
        if (scroll && tag in setOf("shared-hide-inbox", "shared-show-inbox")) {
            tapInboxControlAfterRealScroll(tag)
            return
        }
        if (scroll) compose.onNodeWithTag(tag).performScrollTo()
        if (tag == "shared-legacy-tasks") {
            compose.onNode(hasClickAction() and hasAnyAncestor(hasTestTag(tag))).performClick()
        } else compose.onNodeWithTag(tag).performClick()
    }

    /** A semantics scroll only checks the viewport; it cannot see the floating search button.
     * Reveal these controls with ordinary touch scrolling and prove the actual tap is unobscured. */
    private fun tapInboxControlAfterRealScroll(tag: String) {
        val proof = JSONObject().put("tag", tag)
        var swipes = 0
        for (attempt in 0..8) {
            val node = compose.onNodeWithTag(tag).fetchSemanticsNode()
            val bounds = node.boundsInRoot
            val viewport = compose.onNodeWithTag("shared-projects-screen").fetchSemanticsNode().boundsInRoot
            val overlays = listOf("shared-task-search-open", "shared-task-search-dock").flatMap {
                compose.onAllNodesWithTag(it).fetchSemanticsNodes().map { item -> item.boundsInRoot }
            }.filter { it.width > 0f && it.height > 0f }
            val usableBottom = minOf(viewport.bottom, overlays.minOfOrNull { it.top } ?: viewport.bottom)
            if (attempt == 0) proof.put("before", bounds.toString()).put("beforeOverlays", overlays.toString())
            val visible = bounds.height >= node.size.height - 1f && bounds.width >= node.size.width - 1f &&
                bounds.top >= viewport.top && bounds.bottom <= usableBottom - 2f
            if (visible) {
                val point = bounds.center
                assertTrue("A real tap must not hit the fixed search controls", overlays.none { it.contains(point) })
                proof.put("swipes", swipes).put("after", bounds.toString()).put("tap", point.toString())
                    .put("viewport", viewport.toString()).put("overlays", overlays.toString())
                File(context.getExternalFilesDir(null), "shared-touch-$tag-proof.json").writeText(proof.toString())
                capture("touch-ready-$tag")
                val origin = dragRoot().fetchSemanticsNode().boundsInRoot.topLeft
                dragRoot().performTouchInput { click(point - origin) }
                return
            }
            if (attempt == 8) break
            val height = usableBottom - viewport.top
            assertTrue("A48dp control must have usable space above the search overlay", height > node.size.height + 4f)
            val measuredCenter = node.positionInRoot.y + node.size.height / 2f
            val delta = (measuredCenter - (viewport.top + usableBottom) / 2f).coerceIn(-height * .65f, height * .65f)
            val start = Offset(viewport.left + viewport.width * .25f,
                if (delta >= 0f) usableBottom - height * .1f else viewport.top + height * .1f)
            val origin = dragRoot().fetchSemanticsNode().boundsInRoot.topLeft
            dragRoot().performTouchInput {
                down(start - origin)
                moveTo(start - origin - Offset(0f, delta), 600)
                moveBy(Offset.Zero, 200)
                up()
            }
            compose.waitForIdle()
            swipes++
        }
        capture("touch-unreachable-$tag")
        fail("Inbox control must be reachable by ordinary scrolling without a search overlay: $proof")
    }

    private fun capture(name: String) {
        compose.waitForIdle()
        captureNativeWindow(File(context.getExternalFilesDir(null),
            "review5-shared-$width-${if (dark) "dark" else "light"}-$name.png"))
    }

    private fun assertPlainInlineInbox() {
        compose.onNodeWithTag("shared-project-inbox").assertExists()
        compose.onNode(hasSetTextAction() and hasAnyAncestor(hasTestTag("shared-project-inbox")), useUnmergedTree = true)
            .assertDoesNotExist()
        compose.onNode(hasTestTag("shared-boards") and hasAnyAncestor(hasTestTag("shared-project-inbox")), useUnmergedTree = true)
            .assertDoesNotExist()
        compose.onNodeWithTag("affairs-page-header").assertDoesNotExist()
    }

    @Test fun spaceContainsOnlyProjectsAndHidesLegacyInboxControls() {
        val fixture = ChaosFixture()
        open(fixture)
        click("shared-space-${fixture.spaceA}")
        await("shared-project-${fixture.projectA}")
        compose.onNodeWithTag("shared-inbox-create-task").assertDoesNotExist()
        compose.onNodeWithTag("shared-project-inbox").assertDoesNotExist()
        compose.onNodeWithTag("shared-task-root-task").assertDoesNotExist()
        compose.onNodeWithTag("shared-legacy-tasks").assertDoesNotExist()
        compose.onNodeWithTag("shared-inbox-list-${fixture.spaceList}").assertDoesNotExist()
        capture("space-projects-only")
        click("shared-project-${fixture.projectA}", scroll = true)
        await("shared-task-project-a-1")
        assertPlainInlineInbox()
        compose.onNodeWithTag("shared-task-root-task").assertDoesNotExist()
    }

    @Test fun inboxVisibilityRemainsIndependentInsideEachProject() {
        val fixture = ChaosFixture()
        open(fixture)
        click("shared-space-${fixture.spaceA}")
        click("shared-project-${fixture.projectA}", scroll = true)
        await("shared-task-project-a-1")
        assertPlainInlineInbox()
        click("shared-hide-inbox", scroll = true)
        await("shared-show-inbox")
        click("shared-back")
        click("shared-project-${fixture.projectB}", scroll = true)
        await("shared-task-project-b-task")
        assertPlainInlineInbox()
        click("shared-back")
        click("shared-project-${fixture.projectA}", scroll = true)
        await("shared-show-inbox")
        compose.onNodeWithTag("shared-project-inbox").assertDoesNotExist()
        click("shared-show-inbox", scroll = true)
        compose.onNodeWithTag("shared-task-project-a-1").assertExists()
    }

    @Test fun projectSearchSortAndFiltersUseAFixedDockAndCorrectQueryPages() {
        val fixture = ChaosFixture()
        open(fixture)
        click("shared-space-${fixture.spaceA}")
        click("shared-project-${fixture.projectA}", scroll = true)
        await("shared-task-project-a-1")
        val create = compose.onNodeWithTag("shared-create-task")
            .assert(hasAnyAncestor(hasTestTag("shared-create-actions"))).fetchSemanticsNode().boundsInRoot
        val folder = compose.onNodeWithTag("shared-create-board").fetchSemanticsNode().boundsInRoot
        val tools = listOf("shared-work-actions", "shared-team-actions", "shared-actions").map { tag ->
            compose.onNodeWithTag(tag).assert(hasAnyAncestor(hasTestTag("shared-create-actions"))).fetchSemanticsNode().boundsInRoot
        }
        val row = listOf(create, folder) + tools
        assertTrue("Project actions: plus, folder, task tools, teamwork, settings", row.zipWithNext().all { (left, right) -> left.right <= right.left })
        assertTrue(row.all { abs(it.width - folder.width) <= 1f && abs(it.height - folder.height) <= 1f })
        assertPlainInlineInbox()
        compose.onNodeWithTag("shared-task-project-a-1").assert(hasAnyAncestor(hasTestTag("shared-list-board-todo")))
        compose.onNode(hasTestTag("shared-task-project-a-1") and hasAnyAncestor(hasTestTag("shared-project-inbox"))).assertDoesNotExist()
        compose.onNodeWithTag("shared-task-project-a-3").assertDoesNotExist()
        val dockBefore = compose.onNodeWithTag("shared-task-search-open").fetchSemanticsNode().boundsInRoot
        click("shared-task-more", scroll = true)
        await("shared-task-project-a-3")
        click("shared-task-more", scroll = true)
        await("shared-task-project-a-5")
        compose.onNodeWithTag("shared-task-more").assertDoesNotExist()
        val dockAfter = compose.onNodeWithTag("shared-task-search-open").fetchSemanticsNode().boundsInRoot
        assertTrue("Search must stay fixed during list scrolling", abs(dockBefore.top - dockAfter.top) <= 1.5f)
        assertTrue(fixture.queries.any { it.cursor == "2" } && fixture.queries.any { it.cursor == "4" })
        compose.onNodeWithText("Показано: 5 из 5").assertExists()

        click("shared-task-search-open")
        await("shared-task-search-close")
        val field = compose.onNodeWithTag("shared-task-search").fetchSemanticsNode().boundsInRoot
        val close = compose.onNodeWithTag("shared-task-search-close").fetchSemanticsNode().boundsInRoot
        assertTrue("Search controls must share a vertical center: $field / $close", abs(field.center.y - close.center.y) <= 1.5f)
        compose.onNodeWithTag("shared-task-search")
            .assert(hasAnyAncestor(hasTestTag("shared-task-search-dock")))
        compose.onNode(hasTestTag("shared-task-search-dock") and hasAnyAncestor(hasTestTag("shared-project-inbox")))
            .assertDoesNotExist()
        compose.onNodeWithTag("shared-task-search").performTextReplacement("Бета")
        click("shared-task-search-close")
        compose.waitUntil(15_000) { fixture.queries.any { it.filter.optString("q") == "Бета" && it.cursor == null } }
        await("shared-task-project-a-2")
        compose.onNodeWithTag("shared-task-project-a-1").assertDoesNotExist()
        click("shared-task-search-open")
        await("shared-task-search-close")
        compose.onNodeWithTag("shared-task-search").assertTextContains("Бета")
        click("shared-field-sort")
        click("task-sort-title", scroll = true)
        compose.waitUntil(15_000) { fixture.queries.any { it.sort == "title" && it.filter.optString("q") == "Бета" } }
        click("shared-filters")
        click("shared-filter-completion", scroll = true)
        click("shared-filter-completion-completed")
        click("affairs-apply-filters")
        compose.waitUntil(15_000) {
            fixture.queries.any { it.filter.optString("completion") == "completed" && it.filter.optString("q") == "Бета" && it.sort == "title" }
        }
        await("shared-task-project-a-2")
        capture("project-search-dock")
        click("shared-task-search-close")
        await("shared-task-search-open")
        compose.onNodeWithTag("shared-task-search").assertDoesNotExist()
        click("shared-task-search-open")
        compose.onNodeWithTag("shared-task-search").assertTextContains("Бета")
        compose.onNodeWithTag("shared-filters").assertIsDisplayed()
        compose.onNodeWithTag("shared-field-sort").assertIsDisplayed()
    }

    @Test fun sharedCalendarAndGanttFollowTheSingleHeaderCalendarChoice() {
        val fixture = ChaosFixture()
        open(fixture)
        click("shared-space-${fixture.spaceA}")
        val create = compose.onNodeWithTag("shared-create-project").fetchSemanticsNode().boundsInRoot
        compose.onNodeWithTag("shared-inbox-create-task").assertDoesNotExist()
        val team = compose.onNodeWithTag("shared-space-team").assertHeightIsAtLeast(48.dp).fetchSemanticsNode().boundsInRoot
        val data = compose.onNodeWithTag("shared-space-data").assertHeightIsAtLeast(48.dp).fetchSemanticsNode().boundsInRoot
        assertTrue(create.right <= team.left && team.right <= data.left)
        click("shared-project-${fixture.projectA}", scroll = true)
        for (view in listOf("calendar", "gantt")) {
            click("shared-view-selector")
            click("shared-view-$view")
            val tag = if (view == "calendar") "shared-calendar-period" else "shared-gantt"
            compose.onNodeWithTag(tag).performScrollTo()
            compose.onNodeWithTag(tag).assert(SemanticsMatcher.expectValue(androidx.compose.ui.semantics.SemanticsProperties.StateDescription, displayCalendar.wireValue))
            val before = displayCalendar
            click("calendar-mode-icon-${before.wireValue}")
            compose.onNodeWithTag(tag).assert(SemanticsMatcher.expectValue(androidx.compose.ui.semantics.SemanticsProperties.StateDescription, displayCalendar.wireValue))
            assertNotEquals(before, displayCalendar)
            capture("$view-global-calendar")
        }
    }

    @Test fun viewerSeesTaskRowsButNoCreationCompletionOrStatusMutationControls() {
        val fixture = ChaosFixture(viewer = true)
        open(fixture)
        click("shared-space-${fixture.spaceA}")
        compose.onNodeWithTag("shared-project-inbox").assertDoesNotExist()
        compose.onNodeWithTag("shared-legacy-tasks").assertDoesNotExist()
        compose.onNodeWithTag("shared-task-root-task").assertDoesNotExist()
        compose.onNode(hasContentDescription("Изменить статус") and hasAnyAncestor(hasTestTag("shared-project-inbox")))
            .assertDoesNotExist()
        compose.onNodeWithTag("shared-inbox-create-task").assertDoesNotExist()
        compose.onNodeWithTag("shared-inbox-create-list").assertDoesNotExist()
        click("shared-project-${fixture.projectA}", scroll = true)
        await("shared-task-project-a-1")
        compose.onNodeWithTag("shared-create-task").assertDoesNotExist()
        compose.onNodeWithContentDescription("Завершить задачу: Альфа — первый шаг").assertDoesNotExist()
        compose.onNode(hasContentDescription("Изменить статус") and hasAnyAncestor(hasTestTag("shared-project-inbox")))
            .assertDoesNotExist()
        click("shared-task-search-open")
        compose.onNodeWithTag("shared-field-sort").assertIsDisplayed()
        compose.onNodeWithTag("shared-filters").assertIsDisplayed()
        capture("viewer-project")
        assertEquals(0, fixture.mutations)
    }

    private data class Query(val filter: JSONObject, val cursor: String?, val sort: String)

    @Test fun toolbarFitsWithoutScrollingAndLongPressDropsOnTheBoardItself() {
        val fixture = ChaosFixture(allowMove = true, delayedMove = true)
        open(fixture)
        click("shared-space-${fixture.spaceA}")
        click("shared-project-${fixture.projectA}", scroll = true)
        await("shared-create-actions")
        val row = compose.onNodeWithTag("shared-create-actions").fetchSemanticsNode().boundsInRoot
        val tags = listOf("shared-mindmaps-open", "shared-view-selector", "shared-create-task", "shared-create-board", "shared-work-actions", "shared-team-actions", "shared-actions")
        val buttons = tags.map { compose.onNodeWithTag(it).fetchSemanticsNode().boundsInRoot }
        assertEquals(7, buttons.size)
        buttons.forEach { assertTrue(it.left >= row.left - 1 && it.right <= row.right + 1); assertEquals(buttons.first().width, it.width, 2f) }
        click("shared-view-selector"); click("shared-view-board")
        compose.onNodeWithTag("shared-boards").performScrollTo()
        await("shared-task-project-a-1")
        try {
            beginHeldTask()
            val viewport = compose.onNodeWithTag("shared-projects-screen").fetchSemanticsNode().boundsInRoot
            moveHeld(viewport.center)
            compose.mainClock.advanceTimeBy(64)
            val target = compose.onNodeWithTag("shared-board-done").assertIsDisplayed().fetchSemanticsNode().boundsInRoot
            // Keep the pointer in root coordinates even if scrolling moves its original card.
            val drop = Offset(target.left + 12f, viewport.center.y.coerceIn(target.top + 12f, target.bottom - 12f))
            moveHeld(drop)
            compose.mainClock.advanceTimeByFrame()
            val releaseTarget = compose.onNodeWithTag("shared-board-done").fetchSemanticsNode().boundsInRoot
            assertTrue("The real release must hit the current board", viewport.contains(drop) && releaseTarget.contains(drop))
            File(context.getExternalFilesDir(null), "shared-short-board-release.json").writeText(
                JSONObject().put("point", drop.toString()).put("target", releaseTarget.toString()).put("viewport", viewport.toString()).toString())
            endHeld()
        } finally { if (heldDragClock != null) endHeld(cancelled = true) }
        compose.waitUntil(10_000) { fixture.moveStarted }
        compose.onNode(hasTestTag("shared-task-project-a-1") and hasAnyAncestor(hasTestTag("shared-board-done"))).assertExists()
        assertEquals("Transport is deliberately waiting", 0, fixture.mutations)
        fixture.releaseMove.complete(Unit)
        compose.waitUntil(10_000) { fixture.mutations > 0 }
        assertEquals("done", fixture.lastMove?.getString("statusId"))
        assertEquals("project-a-1", fixture.lastMovedTask)
        assertEquals(1, fixture.lastMove?.getInt("expectedRevision"))
        assertDragActivityForeground()
        capture("board-direct-drop-and-toolbar")
    }

    @Test fun listLongPressDropsOnTheActualListWithoutASubstituteTray() {
        val fixture=ChaosFixture(allowMove=true)
        open(fixture)
        click("shared-space-${fixture.spaceA}")
        click("shared-project-${fixture.projectA}",scroll=true)
        await("shared-list-board-todo")
        try {
            beginHeldTask()
            val viewport = compose.onNodeWithTag("shared-projects-screen").fetchSemanticsNode().boundsInRoot
            val tag = "shared-list-board-done"
            if (!fullyVisible(tag, viewport, horizontal = false)) {
                holdEdgeUntilVisible(tag, Offset(viewport.center.x, viewport.bottom - 8f), viewport, false, "short-list")
            }
            // A held pointer advances display frames; a synchronous semantic scroll can
            // wait indefinitely while that same clock is intentionally frozen.
            releaseOn(tag, viewport, false, "short-list")
        } finally { if (heldDragClock != null) endHeld(cancelled = true) }
        compose.waitUntil(10000) { fixture.mutations>0 }
        assertEquals("done",fixture.lastMove?.getString("statusId"))
        assertEquals("project-a-1",fixture.lastMovedTask)
        assertEquals(1,fixture.lastMove?.getInt("expectedRevision"))
        compose.onAllNodes(hasTestTag("shared-drop-project:${fixture.projectA}")).assertCountEquals(0)
        assertDragActivityForeground()
        capture("list-direct-drop")
    }

    private fun dragRoot() = compose.onNode(isRoot() and hasAnyDescendant(hasTestTag("shared-projects-screen")))
    private var heldDragClock: Boolean? = null

    private fun beginHeldTask() {
        val source = compose.onNodeWithTag("shared-task-project-a-1")
        source.performScrollTo().assertIsDisplayed()
        val point = source.fetchSemanticsNode().boundsInRoot.center
        val origin = dragRoot().fetchSemanticsNode().boundsInRoot.topLeft
        heldDragClock = compose.mainClock.autoAdvance
        compose.mainClock.autoAdvance = false
        dragRoot().performTouchInput { down(point - origin) }
        compose.mainClock.advanceTimeBy(800)
        dragRoot().performTouchInput { moveBy(Offset(0f, 4f)) }
        compose.mainClock.advanceTimeByFrame()
    }

    private fun moveHeld(point: Offset) {
        val origin = dragRoot().fetchSemanticsNode().boundsInRoot.topLeft
        dragRoot().performTouchInput { moveTo(point - origin) }
    }

    private fun stopHeldPageScroll(name: String) {
        val viewport = compose.onNodeWithTag("shared-projects-screen").fetchSemanticsNode().boundsInRoot
        val before = scrollValue(false)
        moveHeld(viewport.center)
        compose.mainClock.advanceTimeBy(64)
        File(context.getExternalFilesDir(null), "shared-held-$name-start.json").writeText(
            JSONObject().put("finger", viewport.center.toString()).put("viewport", viewport.toString())
                .put("beforeVertical", before.toDouble()).put("afterVertical", scrollValue(false).toDouble()).toString())
    }

    private fun endHeld(cancelled: Boolean = false) {
        try { dragRoot().performTouchInput { if (cancelled) cancel() else up() } }
        finally { heldDragClock?.let { compose.mainClock.autoAdvance = it }; heldDragClock = null }
    }

    private fun scrollValue(horizontal: Boolean) = compose.onNodeWithTag(if (horizontal) "shared-boards" else "shared-projects-screen")
        .fetchSemanticsNode().config[if (horizontal) SemanticsProperties.HorizontalScrollAxisRange else SemanticsProperties.VerticalScrollAxisRange].value()

    private fun fullyVisible(tag: String, viewport: Rect, horizontal: Boolean): Boolean =
        compose.onAllNodesWithTag(tag).fetchSemanticsNodes().any { node ->
            val bounds = node.boundsInRoot
            if (horizontal) bounds.width >= node.size.width - 1f && bounds.left >= viewport.left - 1f && bounds.right <= viewport.right + 1f
            else bounds.height >= node.size.height - 1f && bounds.top >= viewport.top - 1f && bounds.bottom <= viewport.bottom + 1f
        }

    /** Only pointer movement and display frames are allowed while held: no semantics scrolling. */
    private fun holdEdgeUntilVisible(tag: String, point: Offset, viewport: Rect, horizontal: Boolean, name: String): JSONObject {
        val initial = scrollValue(horizontal)
        val initialVertical = scrollValue(false)
        val startedAt = compose.mainClock.currentTime
        moveHeld(point)
        val afterMoveVertical = scrollValue(false)
        val afterMoveClock = compose.mainClock.currentTime
        var firstStepVertical: Float? = null
        var reached = false
        var approaching = false
        var heldPoint = point
        while (compose.mainClock.currentTime - startedAt < 12_000) {
            val target = compose.onAllNodesWithTag(tag).fetchSemanticsNodes().firstOrNull()?.boundsInRoot
            if (!approaching && target != null && target.width > 0f && target.height > 0f && target.overlaps(viewport)) {
                // Slow down as the target appears. On a short landscape viewport a tall
                // list has less than one full-speed frame in which it is entirely visible.
                val edge = minOf(72f * compose.activity.resources.displayMetrics.widthPixels / width,
                    (if (horizontal) viewport.width else viewport.height) / 2f)
                heldPoint = if (horizontal) Offset(
                    if (point.x > viewport.center.x) viewport.right - edge * .65f else viewport.left + edge * .65f, point.y)
                else Offset(point.x,
                    if (point.y > viewport.center.y) viewport.bottom - edge * .65f else viewport.top + edge * .65f)
                moveHeld(heldPoint)
                approaching = true
            }
            if (approaching) compose.mainClock.advanceTimeByFrame() else compose.mainClock.advanceTimeBy(100)
            if (firstStepVertical == null) firstStepVertical = scrollValue(false)
            reached = fullyVisible(tag, viewport, horizontal)
            if (reached) break
        }
        val final = scrollValue(horizontal)
        val proof = JSONObject().put("target", tag).put("targetFullyVisible", reached)
            .put("viewport", viewport.toString()).put("finger", point.toString()).put("axis", if (horizontal) "horizontal" else "vertical")
            .put("approachFinger", heldPoint.toString()).put("slowedApproach", approaching)
            .put("initialScroll", initial.toDouble()).put("finalScroll", final.toDouble())
            .put("initialVertical", initialVertical.toDouble()).put("afterMoveVertical", afterMoveVertical.toDouble())
            .put("firstStepVertical", firstStepVertical?.toDouble()).put("finalVertical", scrollValue(false).toDouble())
            .put("moveClockElapsedMs", afterMoveClock - startedAt)
            .put("virtualElapsedMs", compose.mainClock.currentTime - startedAt)
        File(context.getExternalFilesDir(null), "shared-held-$name-proof.json").writeText(proof.toString())
        UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).takeScreenshot(
            File(context.getExternalFilesDir(null), "shared-held-$name-${if (reached) "revealed" else "timeout"}.png"))
        assertTrue("A held finger must reveal the distant target within12s: $proof", reached)
        assertTrue("The native scroll position must change while the finger is held: $proof", abs(final - initial) > 10f)
        return proof
    }

    private fun releaseOn(tag: String, viewport: Rect, horizontal: Boolean, name: String) {
        moveHeld(viewport.center)
        compose.mainClock.advanceTimeBy(64)
        assertTrue("Target must remain fully visible after leaving the edge", fullyVisible(tag, viewport, horizontal))
        val target = compose.onNodeWithTag(tag).fetchSemanticsNode().boundsInRoot
        val point = if (horizontal) Offset(target.center.x, viewport.top + 64f) else target.center
        moveHeld(point)
        compose.mainClock.advanceTimeByFrame()
        val releaseBounds = compose.onNodeWithTag(tag).fetchSemanticsNode().boundsInRoot
        assertTrue("Release must remain inside its current destination: $point / $releaseBounds", releaseBounds.contains(point))
        File(context.getExternalFilesDir(null), "shared-held-$name-release.json").writeText(
            JSONObject().put("point", point.toString()).put("target", releaseBounds.toString()).toString())
        endHeld()
    }

    private fun assertDragActivityForeground() {
        compose.runOnIdle {
            assertFalse("The activity must stay open after a long held transfer", compose.activity.isFinishing)
            assertEquals(androidx.lifecycle.Lifecycle.State.RESUMED, compose.activity.lifecycle.currentState)
        }
        assertEquals("Dragging must not minimize the application", context.packageName,
            UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).currentPackageName)
    }

    @Test fun heldVerticalScrollMovesTaskToEighteenthProjectAndBack() {
        val fixture = ChaosFixture(allowMove = true, distantProjects = 18)
        open(fixture)
        click("shared-space-${fixture.spaceA}")
        click("shared-project-${fixture.projectA}", scroll = true)
        await("shared-task-project-a-1")
        val distantTag = "shared-project-${fixture.distantProjectId(18)}"
        try {
            beginHeldTask()
            val viewport = compose.onNodeWithTag("shared-projects-screen").fetchSemanticsNode().boundsInRoot
            // The top edge opens the existing project tree; the bottom edge traverses it.
            moveHeld(Offset(viewport.center.x, viewport.top + 8f))
            compose.mainClock.advanceTimeBy(100)
            compose.onNodeWithTag(distantTag).assertExists()
            holdEdgeUntilVisible(distantTag, Offset(viewport.center.x, viewport.bottom - 8f), viewport, false, "project-out")
            releaseOn(distantTag, viewport, false, "project-out")
            compose.waitUntil(10_000) { fixture.mutations == 1 }
            val moved = runBlocking { fixture.sharedTask(fixture.distantProjectId(18), "project-a-1").getJSONObject("task") }
            assertEquals(2, moved.getInt("revision")); assertEquals("", moved.getString("statusId"))
            await("shared-task-project-a-1")
            capture("held-project-saved")

            // Cross-project transfer opens the destination. Return with the same real held gesture.
            beginHeldTask()
            val returnViewport = compose.onNodeWithTag("shared-projects-screen").fetchSemanticsNode().boundsInRoot
            moveHeld(Offset(returnViewport.center.x, returnViewport.top + 8f))
            compose.mainClock.advanceTimeBy(100)
            holdEdgeUntilVisible(distantTag, Offset(returnViewport.center.x, returnViewport.bottom - 8f), returnViewport, false, "project-return-start")
            val originTag = "shared-project-${fixture.projectA}"
            holdEdgeUntilVisible(originTag, Offset(returnViewport.center.x, returnViewport.top + 8f), returnViewport, false, "project-return")
            releaseOn(originTag, returnViewport, false, "project-return")
            compose.waitUntil(10_000) { fixture.mutations == 2 }
            val returned = runBlocking { fixture.sharedTask(fixture.projectA, "project-a-1").getJSONObject("task") }
            assertEquals(3, returned.getInt("revision")); assertEquals("", returned.getString("statusId"))
            assertDragActivityForeground()
            capture("held-project-returned")
        } finally { if (heldDragClock != null) endHeld(cancelled = true) }
    }

    @Test fun heldHorizontalScrollMovesTaskAcrossEighteenBoardsAndBack() {
        val fixture = ChaosFixture(allowMove = true, extraBoards = 16)
        open(fixture)
        click("shared-space-${fixture.spaceA}")
        click("shared-project-${fixture.projectA}", scroll = true)
        click("shared-view-selector"); click("shared-view-board")
        compose.onNodeWithTag("shared-boards").performScrollTo()
        await("shared-task-project-a-1")
        try {
            beginHeldTask()
            // The original card can be in the page's vertical edge. Stop that motion
            // with a real inward move before measuring the horizontal gesture.
            stopHeldPageScroll("board-out")
            val viewport = compose.onNodeWithTag("shared-boards").fetchSemanticsNode().boundsInRoot
            val startVertical = scrollValue(false)
            holdEdgeUntilVisible("shared-board-done", Offset(viewport.right - 8f, viewport.top + 64f), viewport, true, "board-out")
            assertEquals("Horizontal hold must not scroll the page", startVertical, scrollValue(false), 2f)
            releaseOn("shared-board-done", viewport, true, "board-out")
            compose.waitUntil(10_000) { fixture.mutations == 1 }
            val moved = runBlocking { fixture.sharedTask(fixture.projectA, "project-a-1").getJSONObject("task") }
            assertEquals("done", moved.getString("statusId")); assertEquals(2, moved.getInt("revision"))
            compose.onNode(hasTestTag("shared-task-project-a-1") and hasAnyAncestor(hasTestTag("shared-board-done"))).assertExists()
            capture("held-board-saved")

            beginHeldTask()
            stopHeldPageScroll("board-return")
            val returnViewport = compose.onNodeWithTag("shared-boards").fetchSemanticsNode().boundsInRoot
            val returnVertical = scrollValue(false)
            holdEdgeUntilVisible("shared-board-todo", Offset(returnViewport.left + 8f, returnViewport.top + 64f), returnViewport, true, "board-return")
            assertEquals("Horizontal return must not scroll the page", returnVertical, scrollValue(false), 2f)
            releaseOn("shared-board-todo", returnViewport, true, "board-return")
            compose.waitUntil(10_000) { fixture.mutations == 2 }
            val returned = runBlocking { fixture.sharedTask(fixture.projectA, "project-a-1").getJSONObject("task") }
            assertEquals("todo", returned.getString("statusId")); assertEquals(3, returned.getInt("revision"))
            assertDragActivityForeground()
            capture("held-board-returned")
        } finally { if (heldDragClock != null) endHeld(cancelled = true) }
    }

    @Test fun horizontalBoardHoldCanExitUpwardToReachAnotherProject() {
        val fixture = ChaosFixture(allowMove = true, distantProjects = 18, extraBoards = 16)
        open(fixture)
        click("shared-space-${fixture.spaceA}")
        click("shared-project-${fixture.projectA}", scroll = true)
        click("shared-view-selector"); click("shared-view-board")
        compose.onNodeWithTag("shared-boards").performScrollTo()
        await("shared-task-project-a-1")
        try {
            beginHeldTask()
            stopHeldPageScroll("board-to-project")
            val board = compose.onNodeWithTag("shared-boards").fetchSemanticsNode().boundsInRoot
            val verticalStart = scrollValue(false)
            val horizontalStart = scrollValue(true)
            moveHeld(Offset(board.right - 8f, board.top + 64f))
            compose.mainClock.advanceTimeBy(400)
            assertTrue("The held gesture must first scroll the actual boards", scrollValue(true) - horizontalStart > 10f)
            assertEquals("Horizontal scrolling must leave the page steady", verticalStart, scrollValue(false), 2f)
            moveHeld(board.center)
            compose.mainClock.advanceTimeBy(64)
            assertEquals("Moving inward to stop must keep the page steady", verticalStart, scrollValue(false), 2f)
            val viewport = compose.onNodeWithTag("shared-projects-screen").fetchSemanticsNode().boundsInRoot
            moveHeld(Offset(board.center.x, minOf(board.top - 8f, viewport.top + 8f)))
            compose.mainClock.advanceTimeBy(100)
            val distantTag = "shared-project-${fixture.distantProjectId(18)}"
            compose.onNodeWithTag(distantTag).assertExists()
            holdEdgeUntilVisible(distantTag, Offset(viewport.center.x, viewport.bottom - 8f), viewport, false, "board-to-project")
            releaseOn(distantTag, viewport, false, "board-to-project")
            compose.waitUntil(10_000) { fixture.mutations == 1 }
            val moved = runBlocking { fixture.sharedTask(fixture.distantProjectId(18), "project-a-1").getJSONObject("task") }
            assertEquals(2, moved.getInt("revision"))
            assertEquals("", moved.getString("statusId"))
            assertEquals(fixture.distantProjectId(18), moved.getString("projectId"))
            assertDragActivityForeground()
            capture("held-board-to-project-saved")
        } finally { if (heldDragClock != null) endHeld(cancelled = true) }
    }

    private class ChaosFixture(private val viewer: Boolean = false, private val allowMove: Boolean = false,
        private val delayedMove: Boolean = false, private val distantProjects: Int = 0, private val extraBoards: Int = 0) : SharedWorkspaceGateway {
        val releaseMove = kotlinx.coroutines.CompletableDeferred<Unit>()
        @Volatile var moveStarted = false
        val spaceA = "chaos-space-a"
        val spaceB = "chaos-space-b"
        val inboxA = "chaos-inbox-a"
        private val inboxB = "chaos-inbox-b"
        val projectA = "chaos-project-a"
        val projectB = "chaos-project-b"
        val spaceList = "chaos-space-list"
        val projectList = "chaos-project-list"
        val queries = CopyOnWriteArrayList<Query>()
        val taskReads = CopyOnWriteArrayList<Pair<String, String>>()
        var mutations = 0
        var lastMove: JSONObject? = null
        var lastMovedTask = ""
        private val expanded = mutableMapOf<String, List<String>>()
        private val role get() = if (viewer) "viewer" else "owner"
        fun distantProjectId(index: Int) = "chaos-distant-${index.toString().padStart(2, '0')}"
        private val containers get() = listOf(
            project(inboxA, "Хаос-бокс", spaceA, inbox = true), project(inboxB, "Хаос-бокс", spaceB, inbox = true),
            project(projectA, "Проект Альфа", spaceA), project(projectB, "Проект Бета", spaceA),
            project(spaceList, "Входящий список", spaceA, inboxA, kind = "task-list"),
            project(projectList, "Проверка проекта", spaceA, projectA, kind = "task-list")
        ) + (1..distantProjects).map { project(distantProjectId(it), "Дальний проект $it", spaceA) }
        private val tasks = listOf(
            task("root-task", inboxA, "Мысль без проекта"), task("space-b-task", inboxB, "Мысль второй команды"),
            task("space-list-task", spaceList, "Пункт входящего списка"),
            task("project-a-1", projectA, "Альфа — первый шаг"), task("project-a-2", projectA, "Бета — готовый результат", done = true),
            task("project-a-3", projectA, "Гамма — следующий шаг"), task("project-a-4", projectA, "Дельта — проверка"),
            task("project-a-5", projectA, "Эпсилон — завершение"), task("project-b-task", projectB, "Отдельная задача проекта Бета"),
            task("project-list-task", projectList, "Пункт проектного списка")
        )

        private fun project(id: String, title: String, space: String, parent: String? = null,
            kind: String = "project", inbox: Boolean = false) = JSONObject()
            .put("id", id).put("spaceId", space).put("title", title).put("description", "")
            .put("parentId", parent ?: JSONObject.NULL).put("kind", kind).put("layout", "list")
            .put("isInbox", if (inbox) 1 else 0).put("role", role).put("spaceRole", if (viewer) "guest" else "owner")
            .put("revision", 1).put("taskCount", if (id == projectA) 5 else 1)
            .put("canOrganizeTasks", !viewer).put("permissions", JSONObject().put("editTasks", !viewer).put("createProjects", !viewer))
            .put("planning", JSONObject().put("enabled", false).put("estimateUnit", "points").put("revision", 1))

        private fun task(id: String, project: String, title: String, done: Boolean = false) = JSONObject()
            .put("id", id).put("projectId", project).put("spaceId", if (project == inboxB) spaceB else spaceA)
            .put("title", title).put("description", "Текст синтетической задачи").put("statusId", if (done) "done" else "todo")
            .put("revision", 1).put("priority", 0).put("position", 0).put("dueDate", JSONObject.NULL)
            .put("assigneeId", JSONObject.NULL).put("categoryId", JSONObject.NULL).put("archivedAt", JSONObject.NULL)
            .put("parentTaskId", JSONObject.NULL).put("completedAt", if (done) "2026-10-27T00:00:00Z" else JSONObject.NULL)
            .put("checklists", JSONArray()).put("attachments", JSONArray()).put("customFields", JSONObject())

        override suspend fun sharedSpaces() = JSONObject().put("spaces", JSONArray().apply {
            listOf(spaceA to "Команда Альфа", spaceB to "Команда Бета").forEach { (id, title) ->
                put(JSONObject().put("id", id).put("title", title).put("role", if (viewer) "guest" else "owner"))
            }
        })
        override suspend fun sharedProjects(spaceId: String) = JSONObject()
            .put("projects", JSONArray(containers.filter { it.getString("spaceId") == spaceId }))
        override suspend fun archivedSharedProjects(spaceId: String) = JSONObject().put("projects", JSONArray())
        override suspend fun sharedInvitations() = JSONObject().put("invitations", JSONArray())
        override suspend fun sharedSpaceUi(spaceId: String) = JSONObject().put("expandedIds", JSONArray(expanded[spaceId].orEmpty()))
        override suspend fun saveSharedSpaceUi(spaceId: String, ids: List<String>): JSONObject {
            expanded[spaceId] = ids.toList()
            return sharedSpaceUi(spaceId)
        }
        override suspend fun flushSharedOfflineTasks() = 0
        override suspend fun queuedSharedTasks(projectId: String) = emptyList<JSONObject>()
        override suspend fun sharedProject(projectId: String) = JSONObject()
            .put("project", containers.first { it.getString("id") == projectId })
            .put("statuses", JSONArray().put(JSONObject().put("id", "todo").put("title", "К выполнению").put("isDone", 0).put("revision", 1).put("position", 0)).apply {
                (1..extraBoards).forEach { put(JSONObject().put("id", "middle-$it").put("title", "Этап $it").put("isDone", 0).put("revision", 1).put("position", it)) }
                put(JSONObject().put("id", "done").put("title", "Готово").put("isDone", 1).put("revision", 1).put("position", extraBoards + 1))
            })
            .put("tasks", JSONArray(tasks.filter { it.getString("projectId") == projectId }))
            .put("members", JSONArray()).put("spaceMembers", JSONArray()).put("categories", JSONArray()).put("customFieldDefinitions", JSONArray())
        override suspend fun sharedTask(projectId: String, taskId: String): JSONObject {
            taskReads += projectId to taskId
            return JSONObject().put("task", JSONObject(tasks.first { it.getString("id") == taskId && it.getString("projectId") == projectId }.toString()))
        }
        override suspend fun sharedComments(projectId: String, taskId: String) = JSONObject().put("comments", JSONArray())
        override suspend fun sharedTaskWatch(projectId: String, taskId: String, watching: Boolean?) = JSONObject().put("watching", watching ?: false)
        override suspend fun sharedTaskSeries(project: String, task: String) = JSONObject().put("series", JSONObject.NULL)
        override suspend fun sharedGoogleSettings(projectId: String) = JSONObject().put("settings", JSONObject())
        override suspend fun sortedSharedTasks(filter: JSONObject, cursor: String?, sort: String): JSONObject {
            queries += Query(JSONObject(filter.toString()), cursor, sort)
            fun accepts(key: String, value: String) = filter.optJSONArray(key)?.let { ids ->
                (0 until ids.length()).any { ids.optString(it) == value }
            } ?: true
            var matching = tasks.filter {
                accepts("projectIds", it.getString("projectId")) && accepts("statusIds", it.getString("statusId")) &&
                    it.getString("title").contains(filter.optString("q"), ignoreCase = true) &&
                    (!filter.has("parentTaskId") || it.optString("parentTaskId") == filter.getString("parentTaskId")) &&
                    when (filter.optString("completion", "any")) {
                        "completed" -> it.getString("statusId") == "done"
                        "open" -> it.getString("statusId") != "done"
                        else -> true
                    }
            }
            if (sort == "title") matching = matching.sortedBy { it.getString("title") }
            val offset = cursor?.toInt() ?: 0
            val page = matching.drop(offset).take(2)
            val next = offset + page.size
            return JSONObject().put("tasks", JSONArray(page.map { JSONObject(it.toString()) })).put("total", matching.size)
                .put("queryVersion", "chaos-fixture-v1").put("hasMore", next < matching.size)
                .put("nextCursor", if (next < matching.size) next.toString() else JSONObject.NULL)
        }
        override suspend fun moveSharedTask(projectId: String, taskId: String, changes: JSONObject): JSONObject {
            check(allowMove && !viewer)
            moveStarted = true
            if(delayedMove) releaseMove.await()
            val task = tasks.first { it.getString("id") == taskId && it.getString("projectId") == projectId }
            check(task.getInt("revision") == changes.getInt("expectedRevision"))
            lastMove = JSONObject(changes.toString()); lastMovedTask = taskId
            task.put("projectId", changes.getString("destinationProjectId")).put("statusId", changes.getString("statusId")).put("revision", task.getInt("revision") + 1)
            mutations++
            return JSONObject().put("task", JSONObject(task.toString()))
        }
    }
}
