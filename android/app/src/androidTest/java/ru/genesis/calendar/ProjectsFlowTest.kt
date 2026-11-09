package ru.genesis.calendar

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.core.graphics.ColorUtils
import androidx.core.view.WindowInsetsControllerCompat
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import androidx.room.Room
import java.io.File
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.Before
import org.json.JSONObject
import ru.genesis.calendar.data.*

class ProjectsFlowTest {
    @get:Rule val compose = createAndroidComposeRule<TestWorkspaceActivity>()

    @Before fun selectIsolatedWorkspace() {
        val app = compose.activity.application as GenesisApplication
        check(BuildConfig.DEBUG && app.packageName.endsWith(".debug"))
        app.activateAccount(null)
    }

    private fun workspaceRoot() = compose.onNode(isRoot() and hasAnyDescendant(hasTestTag("projects-screen")))
    private var dragAutoAdvance: Boolean? = null
    private fun restoreDragClock() { dragAutoAdvance?.let { compose.mainClock.autoAdvance = it }; dragAutoAdvance = null }

    private fun beginTaskDrag(id: String) {
        val source = compose.onNodeWithTag("drag-task-$id", useUnmergedTree = true)
        source.performScrollTo().assertIsDisplayed()
        val point = source.fetchSemanticsNode().boundsInRoot.center
        val origin = workspaceRoot().fetchSemanticsNode().boundsInRoot.topLeft
        try {
            dragAutoAdvance = compose.mainClock.autoAdvance
            compose.mainClock.autoAdvance = false
            workspaceRoot().performTouchInput { down(point - origin) }
            compose.mainClock.advanceTimeBy(800)
            workspaceRoot().performTouchInput { moveBy(Offset(0f, 4f)) }
            compose.mainClock.advanceTimeByFrame()
            compose.onNodeWithTag("drag-floating-task").assertExists()
        } catch (error: Throwable) {
            cancelTaskDrag()
            throw error
        }
    }

    private fun cancelTaskDrag() { runCatching { workspaceRoot().performTouchInput { cancel() } }; restoreDragClock() }

    private fun dropTaskOn(id: String) {
        val tag = if (id == "__genesis_inbox__") "project-inbox" else "project-drop-$id"
        val viewport = compose.onNodeWithTag("projects-screen").fetchSemanticsNode().boundsInRoot
        val origin = workspaceRoot().fetchSemanticsNode().boundsInRoot.topLeft
        // Leave the scrolling edge before measuring the destination. A timed move/up
        // batch advances frames and can move that destination away from the old point.
        workspaceRoot().performTouchInput { moveTo(viewport.center - origin) }
        compose.mainClock.advanceTimeBy(64)
        fun targetVisible() = compose.onAllNodesWithTag(tag).fetchSemanticsNodes().any { node ->
            node.boundsInRoot.height >= minOf(node.size.height.toFloat(), 48f * compose.activity.resources.displayMetrics.density) &&
                node.boundsInRoot.width > 0f
        }
        var soughtFrames = 0
        if (!targetVisible()) {
            // Keep the real pointer held. A synchronous semantics scroll can wait on
            // this intentionally frozen clock, so bound the edge search by display frames.
            var direction = -1f
            var unchanged = 0
            var previousScroll = compose.onNodeWithTag("projects-screen").fetchSemanticsNode()
                .config[SemanticsProperties.VerticalScrollAxisRange].value()
            for (step in 1..120) {
                val edge = Offset(viewport.center.x, if (direction < 0f) viewport.top + 8f else viewport.bottom - 8f)
                workspaceRoot().performTouchInput { moveTo(edge - origin) }
                compose.mainClock.advanceTimeBy(100)
                soughtFrames++
                if (targetVisible()) break
                val scroll = compose.onNodeWithTag("projects-screen").fetchSemanticsNode()
                    .config[SemanticsProperties.VerticalScrollAxisRange].value()
                unchanged = if (scroll == previousScroll) unchanged + 1 else 0
                if (unchanged >= 3 && direction < 0f) { direction = 1f; unchanged = 0 }
                previousScroll = scroll
            }
            assertTrue("The held pointer must reveal $tag within12s of display frames", targetVisible())
            workspaceRoot().performTouchInput { moveTo(viewport.center - origin) }
            compose.mainClock.advanceTimeBy(64)
        }
        compose.mainClock.advanceTimeByFrame()
        val target = compose.onNodeWithTag(tag).assertIsDisplayed().fetchSemanticsNode().boundsInRoot.center
        workspaceRoot().performTouchInput { moveTo(target - origin) }
        compose.mainClock.advanceTimeByFrame()
        val releaseBounds = compose.onNodeWithTag(tag).fetchSemanticsNode().boundsInRoot
        val proof = JSONObject().put("targetTag", tag).put("point", target.toString())
            .put("releaseTarget", releaseBounds.toString()).put("viewport", viewport.toString())
            .put("heldSearchSteps", soughtFrames)
        File(compose.activity.getExternalFilesDir(null), "projects-short-drop-$id.json").writeText(proof.toString())
        assertTrue("The pointer must be inside the visible destination at release: $proof",
            viewport.contains(target) && releaseBounds.contains(target))
        workspaceRoot().performTouchInput { up() }
        restoreDragClock()
    }

    @Test fun projectAndTaskAssignmentPersistEncrypted() = runBlocking {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        check(BuildConfig.DEBUG && app.packageName.endsWith(".debug"))
        val projectId="internal-project-validation-v1"
        val structure=WorkspaceStructureRepository(app)
        structure.saveProject(GenesisProject(projectId,null,"work","Тестовый проект","",emptyList(),"active",0))
        val taskId="internal-project-task-v1"
        val previous=app.repository.get(taskId)
        val saved=app.repository.save(LocalTask(id=taskId,title="Тест задачи в проекте",projectId=projectId,
            revision=previous?.revision ?: 0))
        assertEquals("work",saved.categoryId)
        assertEquals("Тестовый проект",saved.project)
        val independent=Room.databaseBuilder(app,GenesisDatabase::class.java,"genesis.db").build()
        try {
            val document=independent.dao().document(app.workspaceScope,"structure")!!
            assertFalse(document.encrypted.contains("Тестовый проект"))
            assertEquals(projectId,WorkspaceStructureCodec.decode(LocalCipher().decrypt(document.encrypted,
                app.workspaceScope+"/structure"),document.revision).projects.single { it.id==projectId }.id)
            val row=independent.dao().task(app.workspaceScope,taskId)!!
            assertFalse(row.encrypted.contains("Тест задачи в проекте"))
            assertEquals(projectId,app.repository.get(taskId)?.projectId)
            structure.saveCategory(GenesisCategory("internal-category-validation-v1","Тестовый раздел","#2d6c68",10),
                expectedRevision=document.revision)
            var staleRejected=false
            try {
                structure.saveCategory(GenesisCategory("internal-category-validation-v2","Устаревший раздел","#2d6c68",11),
                    expectedRevision=document.revision)
            } catch (_: IllegalArgumentException) { staleRejected=true }
            assertTrue("stale structure revision must not overwrite local changes",staleRejected)
        } finally { independent.close() }
    }

    @Test fun projectScreenOffersNativeEditor() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        try {
        val projectTitle = "Проект UI-проверки-${java.util.UUID.randomUUID()}"
        val alreadyCreated = runBlocking {
            val repo = WorkspaceStructureRepository(app)
            if (repo.workspace.first().categories.none { it.id == "work" }) {
                repo.saveCategory(GenesisCategory("work", "Работа", "#2d6c68", 0))
            }
            repo.workspace.first().projects.any { it.title == projectTitle }
        }
        compose.openWorkspacePage("Проекты")
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("projects-screen").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("projects-screen").assertExists()
        compose.onNodeWithTag("personal-actions").performClick()
        compose.onNodeWithTag("create-project").performClick()
        if (alreadyCreated) {
            compose.onNodeWithTag("project-title").assertExists()
            compose.onNodeWithText("Отмена").performScrollTo().performClick()
        } else {
            compose.onNodeWithTag("project-title").performTextInput(projectTitle)
            val category=compose.onNodeWithTag("project-category-work").performScrollTo()
            if(category.fetchSemanticsNode().config.getOrElse(SemanticsProperties.Selected){false}.not())category.performClick()
            compose.onNodeWithTag("save-project").performScrollTo().performClick()
        }
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("project-title").fetchSemanticsNodes().isEmpty() }
        assertEquals("The editor must save the chosen category", "work",runBlocking { WorkspaceStructureRepository(app).workspace.first().projects.first { it.title==projectTitle }.categoryId })
        compose.onAllNodes(hasTestTag("app-theme-Standart") or hasTestTag("app-theme-Evening")).onFirst().assertExists()
        compose.onNodeWithTag("personal-task-search-open").performClick()
        compose.waitUntil(5_000) { compose.onAllNodesWithTag("personal-task-search-dock").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("personal-category-filters").assertIsEnabled().performClick()
        compose.onNodeWithTag("category-filter-work").performScrollTo()
        compose.onNodeWithTag("category-filter-work")
            .assert(hasAnyAncestor(hasTestTag("life-categories-card")))
        compose.onNodeWithTag("category-filter-work").performClick().assertIsSelected()
        compose.onNodeWithTag("personal-task-search-close").performClick()
        compose.onNodeWithTag("projects-screen").performScrollToIndex(0)
        compose.waitForIdle()
        val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        assertTrue(device.takeScreenshot(File(app.getExternalFilesDir(null), "projects-standart-overview.png")))
        compose.onNodeWithTag("projects-screen").performScrollToNode(hasText(projectTitle))
        assertTrue(compose.onAllNodesWithText(projectTitle).fetchSemanticsNodes().isNotEmpty())
        compose.waitForIdle()
        assertTrue(device.takeScreenshot(File(app.getExternalFilesDir(null), "projects-standart.png")))
        } catch (failure: Throwable) {
            // Preserve the failing search/editor state. A later method's PNG is
            // not evidence of this failure; original assertions/timeouts remain.
            val directory = app.getExternalFilesDir(null) ?: app.cacheDir
            runCatching {
                File(directory, "projects-editor-search-failure.txt").writeText(workspaceRoot().printToString())
            }.exceptionOrNull()?.let(failure::addSuppressed)
            val keyguard = app.getSystemService(android.app.KeyguardManager::class.java)
            if (keyguard?.isKeyguardLocked == false) runCatching {
                check(UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).takeScreenshot(
                    File(directory, "projects-editor-search-failure.png")))
            }.exceptionOrNull()?.let(failure::addSuppressed)
            throw failure
        }
    }

    @Test fun chaosBoxTaskCanBeMovedIntoProjectWithoutGoogleAccount() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        check(BuildConfig.DEBUG && app.packageName.endsWith(".debug"))
        val projectId = "internal-drag-target-v1"
        val taskId = "internal-chaos-drag-v1"
        val title = "Проект для переноса"
            runBlocking {
                WorkspaceStructureRepository(app).saveProject(
                    GenesisProject(projectId, null, "work", title, "", emptyList(), "active", 0))
                val previous = app.repository.get(taskId)
                app.repository.save(LocalTask(id = taskId, title = "Задача из Хаос-бокса",
                    revision = previous?.revision ?: 0))
            }
            compose.waitUntil(10_000) {
                compose.onAllNodes(hasTestTag("app-theme-Standart") or hasTestTag("app-theme-Evening")).fetchSemanticsNodes().isNotEmpty()
            }
            compose.openWorkspacePage("Проекты")
            compose.onNodeWithTag("project-inbox").assertExists()
            compose.onNodeWithTag("drag-task-$taskId", useUnmergedTree = true)
                .performScrollTo().assertIsDisplayed()
            val taskTitle = runBlocking { requireNotNull(app.repository.get(taskId)).title }
            compose.onNode(hasContentDescription("Действия с задачей: $taskTitle") and
                hasAnyAncestor(hasTestTag("drag-task-$taskId")), useUnmergedTree = true).performClick()
            compose.onNodeWithTag("move-task-$taskId").performClick()
            compose.onNodeWithTag("project-destination-search").assertIsDisplayed()
            compose.onNodeWithTag("project-destination-list")
                .performScrollToNode(hasTestTag("project-menu-target-$projectId"))
            compose.onNodeWithTag("project-menu-target-$projectId").performClick()
            compose.waitUntil(10_000) {
                runBlocking { app.repository.get(taskId)?.projectId == projectId }
            }
            compose.onNodeWithTag("projects-screen").performScrollToNode(hasTestTag("project-drop-$projectId"))
            compose.onNodeWithTag("project-drop-$projectId").assertExists()
    }

    @Test fun longPressDragMovesChaosTaskToProject() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        check(BuildConfig.DEBUG && app.packageName.endsWith(".debug"))
        val taskId = "internal-gesture-task-v1"
        val projectId = runBlocking {
            val repo = WorkspaceStructureRepository(app)
            if (repo.workspace.first().projects.isEmpty()) repo.saveProject(
                GenesisProject("internal-gesture-project-v1", null, null, "Проект жеста", "", emptyList(), "active", 0))
            val id = WorkspaceStructureCodec.ordered(repo.workspace.first()).first().first.id
            val previous = app.repository.get(taskId)
            app.repository.save(LocalTask(id = taskId, title = "Задача для жеста",
                revision = previous?.revision ?: 0))
            id
        }
            compose.waitUntil(10_000) {
                compose.onAllNodes(hasTestTag("app-theme-Standart") or hasTestTag("app-theme-Evening")).fetchSemanticsNodes().isNotEmpty()
            }
            compose.openWorkspacePage("Проекты")
            beginTaskDrag(taskId)
            try {
                val preview = File(app.getExternalFilesDir(null), "projects-drag-preview-after.png")
                assertTrue(UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).takeScreenshot(preview))
                dropTaskOn(projectId)
            } finally { cancelTaskDrag() }
            compose.waitUntil(10_000) { runBlocking { app.repository.get(taskId)?.projectId == projectId } }
    }

    @Test fun longPressDragMovesTaskBetweenProjectsAndBackToChaosBox() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        check(BuildConfig.DEBUG && app.packageName.endsWith(".debug"))
        val originId = "internal-project-drag-origin-v1"
        val destinationId = "internal-project-drag-destination-v1"
        val taskId = "internal-project-drag-task-v1"
            runBlocking {
                val repo = WorkspaceStructureRepository(app)
                repo.saveProject(GenesisProject(originId, null, null, "B Жест — исток", "", emptyList(), "active", 0))
                repo.saveProject(GenesisProject(destinationId, null, null, "A Жест — цель", "", emptyList(), "active", 0))
                val previous = app.repository.get(taskId)
                app.repository.save(LocalTask(id = taskId, title = "Задача между проектами", projectId = originId,
                    revision = previous?.revision ?: 0))
            }
            compose.waitUntil(10_000) {
                compose.onAllNodes(hasTestTag("app-theme-Standart") or hasTestTag("app-theme-Evening")).fetchSemanticsNodes().isNotEmpty()
            }
            compose.openWorkspacePage("Проекты")
            compose.waitUntil(10_000) {
                compose.onAllNodesWithTag("projects-screen").fetchSemanticsNodes().isNotEmpty()
            }
            val startingRevision=runBlocking { requireNotNull(app.repository.get(taskId)).revision }
            fun dragTo(targetId: String) {
                beginTaskDrag(taskId)
                try { dropTaskOn(targetId) } finally { cancelTaskDrag() }
            }
            compose.onNodeWithTag("projects-screen").performScrollToNode(hasTestTag("project-drop-$originId"))
            compose.onNodeWithTag("project-drop-$originId").performClick()
            compose.waitUntil(10_000) {
                compose.onAllNodesWithTag("drag-task-$taskId", useUnmergedTree = true)
                    .fetchSemanticsNodes().isNotEmpty()
            }
            dragTo(destinationId)
            compose.waitUntil(10_000) { runBlocking { app.repository.get(taskId)?.projectId == destinationId } }
            assertEquals(startingRevision+1, runBlocking { app.repository.get(taskId)?.revision })
            compose.onNodeWithTag("projects-screen").performScrollToNode(hasTestTag("project-drop-$destinationId"))
            if (compose.onAllNodesWithTag("drag-task-$taskId", useUnmergedTree = true).fetchSemanticsNodes().isEmpty())
                compose.onNodeWithTag("project-drop-$destinationId").performClick()
            dragTo("__genesis_inbox__")
            compose.waitUntil(10_000) { runBlocking { app.repository.get(taskId)?.projectId == "__genesis_inbox__" } }
            assertEquals(startingRevision+2, runBlocking { app.repository.get(taskId)?.revision })
            compose.runOnIdle {
                assertFalse(compose.activity.isFinishing)
                assertEquals(androidx.lifecycle.Lifecycle.State.RESUMED, compose.activity.lifecycle.currentState)
            }
            assertEquals(app.packageName, UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).currentPackageName)
            captureNativeWindow(File(app.getExternalFilesDir(null), "projects-short-drag-roundtrip.png"))
    }

    @Test fun draggingNearBottomAutoScrollsProjectDestinations() = verifyAutoScroll(false)

    @Test fun draggingNearBottomAutoScrollsProjectDestinationsInDarkTheme() = verifyAutoScroll(true)

    @Suppress("DEPRECATION")
    private fun assertSystemBarContrast(dark: Boolean, theme: String) {
        val proof = compose.runOnIdle {
            val window = compose.activity.window
            val controller = WindowInsetsControllerCompat(window, window.decorView)
            val background = (if (dark) ru.genesis.calendar.ui.evening else ru.genesis.calendar.ui.standart).background.toArgb()
            val effectiveNavigation = ColorUtils.compositeColors(window.navigationBarColor, background)
            val icons = if (controller.isAppearanceLightNavigationBars) android.graphics.Color.BLACK else android.graphics.Color.WHITE
            JSONObject().put("api", android.os.Build.VERSION.SDK_INT).put("theme", theme)
                .put("lightNavigationBars", controller.isAppearanceLightNavigationBars)
                .put("lightStatusBars", controller.isAppearanceLightStatusBars)
                .put("navigationBarColor", "#%08X".format(window.navigationBarColor))
                .put("appBackground", "#%08X".format(background))
                .put("effectiveNavigationBackground", "#%08X".format(effectiveNavigation))
                .put("legacyContrastEvaluated", android.os.Build.VERSION.SDK_INT < 29)
                .put("legacyNavigationContrast", ColorUtils.calculateContrast(icons, effectiveNavigation))
        }
        File(compose.activity.getExternalFilesDir(null), "projects-system-bars-$theme.json").writeText(proof.toString())
        assertEquals("Navigation icon brightness must follow the app theme: $proof", !dark, proof.getBoolean("lightNavigationBars"))
        assertEquals("Status icon brightness must follow the app theme: $proof", !dark, proof.getBoolean("lightStatusBars"))
        if (android.os.Build.VERSION.SDK_INT < 29) {
            assertTrue("Legacy navigation buttons need at least3:1 contrast: $proof", proof.getDouble("legacyNavigationContrast") >= 3.0)
        }
    }

    private fun verifyAutoScroll(dark: Boolean) {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        check(BuildConfig.DEBUG && app.packageName.endsWith(".debug"))
        val theme = if (dark) "dark" else "light"
        runBlocking {
            HabitsRepository(app).updateAppearance(JSONObject().put("mode", if (dark) "evening" else "light"))
            LocalPreferences(app, app.workspaceScope).set("theme", if (dark) "standart-dark" else "standart")
        }
        val originId = "internal-autoscroll-origin-v1"
        val lastId = "internal-autoscroll-target-18-v1"
        val taskId = "internal-autoscroll-task-v1"
        runBlocking {
            val repo = WorkspaceStructureRepository(app)
            repo.saveProject(GenesisProject(originId, null, null, "00 Auto-scroll origin", "", emptyList(), "active", 0))
            (1..18).forEach { index ->
                val id = "internal-autoscroll-target-${index.toString().padStart(2, '0')}-v1"
                repo.saveProject(GenesisProject(id, null, null,
                    "${index.toString().padStart(2, '0')} Auto-scroll destination", "", emptyList(), "active", index))
            }
            val previous = app.repository.get(taskId)
            app.repository.save(LocalTask(id = taskId, title = "Auto-scroll drag task", projectId = originId,
                revision = previous?.revision ?: 0))
        }
        compose.waitUntil(10_000) {
            compose.onAllNodesWithTag(if (dark) "app-theme-Evening" else "app-theme-Standart").fetchSemanticsNodes().isNotEmpty()
        }
        compose.openWorkspacePage("Проекты")
        compose.onNodeWithTag("projects-screen").performScrollToNode(hasTestTag("project-drop-$originId"))
        compose.onNodeWithTag("project-drop-$originId").performClick()
        val autoAdvance = compose.mainClock.autoAdvance
        beginTaskDrag(taskId)
        try {
            compose.mainClock.autoAdvance = false
            val listBounds = compose.onNodeWithTag("projects-screen").fetchSemanticsNode().boundsInRoot
            val origin = workspaceRoot().fetchSemanticsNode().boundsInRoot.topLeft
            fun scrollPosition() = compose.onNodeWithTag("projects-screen").fetchSemanticsNode()
                .config[SemanticsProperties.VerticalScrollAxisRange].value()
            val initialScroll = scrollPosition()
            val startedAt = compose.mainClock.currentTime
            workspaceRoot().performTouchInput { moveTo(Offset(listBounds.center.x, listBounds.bottom - 8f) - origin) }
            var reached = false
            var targetBounds = "absent"
            var targetSize = "absent"
            // Advance the display clock explicitly while the finger is held; an ongoing
            // frame-based scroll is intentionally not an idle animation.
            for (step in 1..80) {
                compose.mainClock.advanceTimeBy(100)
                val targets = compose.onAllNodesWithTag("project-drop-$lastId").fetchSemanticsNodes()
                targetBounds = targets.singleOrNull()?.boundsInRoot?.toString() ?: "absent"
                targetSize = targets.singleOrNull()?.size?.toString() ?: "absent"
                reached = targets.any {
                    // boundsInRoot is clipped by the lazy viewport: compare it with the
                    // complete measured size before considering the destination revealed.
                    it.boundsInRoot.height >= it.size.height - 1f &&
                        it.boundsInRoot.width >= it.size.width - 1f &&
                        it.boundsInRoot.top >= listBounds.top && it.boundsInRoot.bottom <= listBounds.bottom
                }
                if (reached) break
            }
            val finalScroll = scrollPosition()
            val proof = JSONObject().put("viewport", listBounds.toString()).put("rootOrigin", origin.toString())
                .put("finger", Offset(listBounds.center.x, listBounds.bottom - 8f).toString())
                .put("floatingPreview", compose.onAllNodesWithTag("drag-floating-task").fetchSemanticsNodes()
                    .singleOrNull()?.boundsInRoot?.toString() ?: "absent")
                .put("target", targetBounds).put("targetSize", targetSize).put("targetFullyVisible", reached)
                .put("initialScroll", initialScroll.toDouble()).put("finalScroll", finalScroll.toDouble())
                .put("virtualElapsedMs", compose.mainClock.currentTime - startedAt)
            File(app.getExternalFilesDir(null), "projects-auto-scroll-$theme-proof.json").writeText(proof.toString())
            println("QA313_PROJECT_AUTO_SCROLL=$proof")
            UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
                .takeScreenshot(File(app.getExternalFilesDir(null), "projects-auto-scroll-$theme-${if (reached) "revealed" else "timeout"}.png"))
            assertTrue("Holding at the bottom must fully reveal the18th target within8s of Compose time: $proof", reached)
            assertTrue("The list must actually scroll while the finger remains held: $proof", finalScroll > initialScroll)
            compose.onNodeWithTag("drag-floating-task").assertExists()
            compose.onNodeWithTag("project-drop-$lastId").assertIsDisplayed()
            // Leave the edge and let the production auto-scroll loop observe the new
            // finger position. Do not scroll the lazy list through semantics here.
            workspaceRoot().performTouchInput { moveTo(listBounds.center - origin) }
            compose.mainClock.advanceTimeBy(64)
            val dropTarget = compose.onNodeWithTag("project-drop-$lastId").fetchSemanticsNode()
            assertTrue("The complete target must remain visible before dropping: $proof",
                dropTarget.boundsInRoot.height >= dropTarget.size.height - 1f)
            val dropPoint = dropTarget.boundsInRoot.center
            // Deliver the move separately from up: with autoAdvance=false a single
            // 300ms event batch can release against geometry from an earlier frame.
            workspaceRoot().performTouchInput { moveTo(dropPoint - origin) }
            compose.mainClock.advanceTimeByFrame()
            val releaseBounds = compose.onNodeWithTag("project-drop-$lastId").fetchSemanticsNode().boundsInRoot
            proof.put("dropPoint", dropPoint.toString()).put("releaseTarget", releaseBounds.toString())
                .put("releaseScroll", scrollPosition().toDouble())
            File(app.getExternalFilesDir(null), "projects-auto-scroll-$theme-proof.json").writeText(proof.toString())
            println("QA313_PROJECT_AUTO_SCROLL_RELEASE=$proof")
            assertTrue("The release point must still be inside the destination after its layout frame: $proof",
                releaseBounds.contains(dropPoint))
            workspaceRoot().performTouchInput { up() }
            compose.mainClock.autoAdvance = autoAdvance
            compose.onNodeWithTag("drag-floating-task").assertDoesNotExist()
            compose.waitUntil(10_000) { runBlocking { app.repository.get(taskId)?.projectId == lastId } }
            captureNativeWindow(File(app.getExternalFilesDir(null), "projects-auto-scroll-$theme-saved.png"))

            // Return from the distant project using the same held-finger scroll, not a
            // semantics scroll. This also covers moving out of a project to the inbox.
            if (compose.onAllNodesWithTag("drag-task-$taskId", useUnmergedTree = true).fetchSemanticsNodes().isEmpty())
                compose.onNodeWithTag("project-drop-$lastId").performClick()
            beginTaskDrag(taskId)
            val backViewport = compose.onNodeWithTag("projects-screen").fetchSemanticsNode().boundsInRoot
            val backOrigin = workspaceRoot().fetchSemanticsNode().boundsInRoot.topLeft
            val reverseStart = scrollPosition()
            workspaceRoot().performTouchInput { moveTo(Offset(backViewport.center.x, backViewport.top + 8f) - backOrigin) }
            for (step in 1..80) {
                compose.mainClock.advanceTimeBy(100)
                if (scrollPosition() <= .5f) break
            }
            val reverseEnd = scrollPosition()
            val reverseProof = JSONObject().put("initialScroll", reverseStart.toDouble()).put("finalScroll", reverseEnd.toDouble())
                .put("direction", "up").put("target", "inbox")
            File(app.getExternalFilesDir(null), "projects-auto-scroll-$theme-return-proof.json").writeText(reverseProof.toString())
            assertTrue("Holding at the top must return to the first item within8s: $reverseProof", reverseStart > 0f && reverseEnd <= .5f)
            workspaceRoot().performTouchInput { moveTo(backViewport.center - backOrigin) }
            compose.mainClock.advanceTimeBy(64)
            val inboxTarget = compose.onNodeWithTag("project-inbox").assertIsDisplayed().fetchSemanticsNode().boundsInRoot.center
            workspaceRoot().performTouchInput { moveTo(inboxTarget - backOrigin) }
            compose.mainClock.advanceTimeByFrame()
            workspaceRoot().performTouchInput { up() }
            restoreDragClock()
            compose.waitUntil(10_000) { runBlocking { app.repository.get(taskId)?.projectId == "__genesis_inbox__" } }
            compose.onNodeWithTag("drag-floating-task").assertDoesNotExist()
            assertFalse("A completed drag must keep its activity visible", compose.activity.isFinishing)
            captureNativeWindow(File(app.getExternalFilesDir(null), "projects-auto-scroll-$theme-returned.png"))
            assertSystemBarContrast(dark, theme)
        } finally {
            cancelTaskDrag()
            compose.mainClock.autoAdvance = autoAdvance
        }
    }
}
