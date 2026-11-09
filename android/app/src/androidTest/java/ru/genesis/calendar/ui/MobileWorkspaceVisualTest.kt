package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.captureNativeWindow
import ru.genesis.calendar.auth.SharedWorkspaceGateway
import ru.genesis.calendar.data.*
import java.io.File
import java.util.Base64

/** Synthetic, isolated data only. No authenticated controller, public API or user database. */
class MobileWorkspaceVisualTest {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    private data class Preview(val width: Int, val dark: Boolean)
    private val previews = listOf(Preview(360, false), Preview(360, true), Preview(412, false), Preview(412, true))
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private val device get() = UiDevice.getInstance(instrumentation)

    private fun content(preview: () -> Preview, screen: @Composable () -> Unit) {
        compose.setContent {
            val state = preview()
            val original = LocalDensity.current
            val fontScale = InstrumentationRegistry.getArguments().getString("genesisFontScale")?.toFloatOrNull() ?: original.fontScale
            val density = Density(compose.activity.resources.displayMetrics.widthPixels.toFloat() / state.width, fontScale)
            CompositionLocalProvider(LocalDensity provides density, LocalGenesisLanguage provides "ru",
                LocalEveningTheme provides state.dark, LocalGenesisUserId provides "synthetic-mobile-workspace",
                LocalFeatureAccess provides validationDataExchangeAccess()) {
                MaterialTheme(colorScheme = if (state.dark) evening else standart,
                    typography = GenesisTypography, shapes = GenesisShapes) {
                    Surface(Modifier.fillMaxSize().safeDrawingPadding(), color = MaterialTheme.colorScheme.background) {
                        key(state) { screen() }
                    }
                }
            }
        }
    }

    private fun capture(state: Preview, name: String) {
        compose.waitForIdle()
        val file = File(instrumentation.targetContext.getExternalFilesDir(null),
            "3.0-workspace-${state.width}-${if (state.dark) "dark" else "light"}-$name.png")
        captureNativeWindow(file)
        assertTrue("Screenshot must contain PNG data", file.length() > 0)
    }

    private fun hierarchy(state: Preview, name: String) {
        File(instrumentation.targetContext.getExternalFilesDir(null),
            "3.0-workspace-${state.width}-${if (state.dark) "dark" else "light"}-$name.txt")
            .writeText(compose.onAllNodes(isRoot(), useUnmergedTree = true).onLast().printToString())
    }

    @Test fun sharedProjectKeepsTaskDestinationAndEveryViewReachable() {
        var preview by mutableStateOf(previews.first())
        val fixture = MobileSharedPreview()
        content({ preview }) {
            SharedProjectsScreen(fixture, "ru", SharedInvitationDestination(fixture.space, fixture.projectId))
        }
        for (state in previews) {
            compose.runOnIdle { preview = state }
            compose.waitUntil(10_000) { compose.onAllNodesWithTag("shared-create-task").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithTag("shared-task-mobile-task-1").assertExists()
            compose.onNodeWithTag("shared-create-task").assertIsEnabled()
            capture(state, "shared-list")

            compose.onNodeWithTag("shared-create-task").performScrollTo().performClick()
            compose.onNodeWithTag("shared-create-task-option").performClick()
            compose.onNodeWithTag("shared-create-destination").assertTextContains(fixture.title, substring = true)
            compose.onNodeWithTag("shared-new-task-title").performTextReplacement("Черновик в общем проекте")
            device.pressBack() // IME closes before the dialog, if it was visible.
            compose.waitForIdle()
            if (compose.onAllNodesWithTag("shared-new-task-title").fetchSemanticsNodes().isNotEmpty()) device.pressBack()
            compose.waitForIdle()
            compose.onNodeWithTag("shared-create-task").performClick()
            compose.onNodeWithTag("shared-create-task-option").performClick()
            compose.onNodeWithTag("shared-new-task-title").assertTextContains("Черновик в общем проекте")
            capture(state, "shared-create-destination")
            compose.onNodeWithText("Отмена").performClick()

            compose.onNodeWithTag("shared-create-task").performClick()
            compose.onNodeWithTag("shared-create-task-list-option").assertIsEnabled()
            compose.onNodeWithTag("shared-create-project-option").assertIsEnabled()
            capture(state, "shared-create-menu")
            device.pressBack()

            compose.onNodeWithTag("shared-view-selector").performClick()
            listOf("list", "board", "calendar", "gantt").forEach {
                compose.onNodeWithTag("shared-view-$it").assertExists()
            }
            capture(state, "shared-view-menu")
            compose.onNodeWithTag("shared-view-board").performClick()
            compose.onNodeWithTag("shared-view-selector").assertContentDescriptionEquals("Доска")
            capture(state, "shared-board")
            compose.onNodeWithTag("shared-view-selector").performClick()
            compose.onNodeWithTag("shared-view-list").performClick()
            compose.onNodeWithTag("shared-task-mobile-task-1").assertExists()
        }
        assertEquals("Visual tests must not submit tasks", 0, fixture.creates)
    }

    @Test fun mindmapGivesCanvasSpaceAndProtectsEditedNodeOnBack() {
        val context = instrumentation.targetContext
        val database = Room.inMemoryDatabaseBuilder(context, GenesisDatabase::class.java).build()
        val transport = MobileMapPreviewTransport()
        val repository = MindmapRepository(database, "synthetic-mobile-map", "synthetic-map-user", transport)
        val document = MindmapDocument.new("План следующего этапа проекта", template = "idea")
        val thought = document.nodes[1]
        runBlocking { repository.save(document); repository.refresh() }
        assertEquals("Synthetic transport must survive repository refresh", document.id, repository.records.value.single().document.id)
        assertTrue("Synthetic map must be acknowledged", !repository.records.value.single().unsynced)
        var preview by mutableStateOf(previews.first())
        var showScreen by mutableStateOf(true)
        content({ preview }) { if (showScreen) MindmapsScreen(repository, emptyList(), emptyList(), null, {}, { _, _ -> }, {}, { _, _ -> }, {}) }
        try {
            for (state in previews) {
                compose.runOnIdle { preview = state }
                runBlocking { repository.saveView(document.id, JSONObject().put("mode", "map").put("zoom", 1.0)) }
                compose.waitUntil(10_000) { compose.onAllNodesWithTag("mindmap-open-${document.id}", useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty() }
                capture(state, "mindmap-library")
                compose.onNodeWithTag("mindmaps-actions").performClick()
                compose.onNodeWithTag("mindmaps-archive").assertIsDisplayed()
                compose.onNodeWithText("Импорт JSON").assertIsDisplayed()
                compose.onNodeWithText("Обновить").assertIsDisplayed()
                capture(state, "mindmap-library-files")
                device.pressBack()
                compose.onNode(hasContentDescription("Действия с картой") and
                    hasAnyAncestor(hasTestTag("mindmap-open-${document.id}")), useUnmergedTree = true).performClick()
                compose.onNodeWithText("Закрепить").assertIsEnabled()
                compose.onNodeWithText("Архивировать").assertIsEnabled()
                capture(state, "mindmap-library-actions")
                device.pressBack()
                compose.onNodeWithTag("mindmap-open-${document.id}", useUnmergedTree = true).performClick()
                compose.onNodeWithTag("mindmap-canvas").assertIsDisplayed()
                compose.onNodeWithTag("mindmap-mode-toggle").assertContentDescriptionEquals("Показать структуру")
                val rootNode = compose.onNodeWithTag("mindmap-node-${document.nodes.first().id}").fetchSemanticsNode()
                val rootLabel = compose.onNode(hasText(document.title) and
                    hasAnyAncestor(hasTestTag("mindmap-node-${document.nodes.first().id}")), useUnmergedTree = true).fetchSemanticsNode()
                assertTrue("Node title must reserve 48dp for the link action and an 8dp gap",
                    rootNode.boundsInRoot.right - rootLabel.boundsInRoot.right + 1 >= 56 * rootNode.layoutInfo.density.density)
                capture(state, "mindmap-canvas")
                compose.onNodeWithTag("mindmap-add-node").performScrollTo().performClick()
                compose.onNodeWithTag("mindmap-add-thought").assertIsDisplayed()
                compose.onNodeWithTag("mindmap-add-from-affairs").assertIsDisplayed()
                capture(state, "mindmap-add-menu")
                device.pressBack()
                compose.onNodeWithTag("mindmap-history").performScrollTo().assertIsEnabled().performClick()
                compose.onNodeWithText("История карты").assertIsDisplayed()
                val version = repository.records.value.first { it.document.id == document.id }.revision
                compose.onNodeWithText("Версия $version · ${document.title}").assertIsDisplayed()
                capture(state, "mindmap-history")
                device.pressBack()
                compose.onNodeWithTag("mindmap-export-menu").performScrollTo().assertIsEnabled().performClick()
                compose.onNodeWithTag("mindmap-export-json").assertIsDisplayed().assertIsEnabled()
                compose.onNodeWithTag("mindmap-export-pdf").assertIsDisplayed().assertIsEnabled()
                capture(state, "mindmap-export-menu")
                device.pressBack()
                compose.onNodeWithTag("mindmap-mode-toggle").performScrollTo().performClick()
                compose.onNodeWithTag("mindmap-node-${thought.id}").performScrollTo().performClick()
                val revisedThought = "Изменённая мысль ${state.width}-${if (state.dark) "dark" else "light"}"
                compose.onNodeWithTag("mindmap-node-text").performTextReplacement(revisedThought)
                capture(state, "mindmap-node-draft")
                hierarchy(state, "mindmap-before-back")
                device.pressBack()
                compose.waitForIdle()
                hierarchy(state, "mindmap-after-back")
                if (compose.onAllNodesWithText("Закрыть без сохранения?").fetchSemanticsNodes().isEmpty())
                    compose.onNodeWithContentDescription("Закрыть").performClick()
                compose.onNodeWithText("Закрыть без сохранения?").assertExists()
                capture(state, "mindmap-draft-guard")
                compose.onNodeWithText("Продолжить редактирование").performClick()
                compose.onNodeWithTag("mindmap-node-text").assertTextContains(revisedThought)
                capture(state, "mindmap-node-editor")
                compose.onNodeWithText("Сохранить мысль").performClick()
                compose.waitUntil(10_000) {
                    repository.records.value.first { it.document.id == document.id }.let { row ->
                        !row.unsynced && row.document.nodes.first { it.id == thought.id }.text == revisedThought
                    }
                }
            }
        } finally {
            // Remove the screen before closing its Room connection and its collection jobs.
            compose.runOnIdle { showScreen = false }
            compose.waitForIdle()
            database.close()
        }
    }
}

/** Same gateway contract as SharedWorkspaceUiTest, with no account/session transport. */
private class MobileSharedPreview : SharedWorkspaceGateway {
    val space = "10000000-0000-4000-8000-000000000101"
    val projectId = "10000000-0000-4000-8000-000000000102"
    val title = "Подготовка осеннего проекта"
    var creates = 0
    private val statuses = JSONArray()
        .put(JSONObject().put("id", "mobile-todo").put("title", "К выполнению").put("position", 0).put("revision", 1).put("isDone", 0))
        .put(JSONObject().put("id", "mobile-done").put("title", "Готово").put("position", 1).put("revision", 1).put("isDone", 1))
    private val tasks = JSONArray()
        .put(JSONObject().put("id", "mobile-task-1").put("projectId", projectId).put("title", "Собрать идеи и согласовать план следующего этапа")
            .put("description", "Проверить приоритеты команды").put("statusId", "mobile-todo").put("revision", 1)
            .put("priority", 2).put("dueDate", "2026-10-28").put("unreadCommentCount", 2).put("checklists", JSONArray()))
        .put(JSONObject().put("id", "mobile-task-2").put("projectId", projectId).put("title", "Подготовить материалы встречи")
            .put("description", "").put("statusId", "mobile-todo").put("revision", 1).put("priority", 0).put("checklists", JSONArray()))
    private fun project() = JSONObject().put("id", projectId).put("spaceId", space).put("title", title)
        .put("description", "").put("layout", "list").put("kind", "project").put("role", "owner")
        .put("spaceRole", "owner").put("isInbox", 0).put("revision", 1).put("canOrganizeTasks", true)
    override suspend fun sharedSpaces() = JSONObject().put("spaces", JSONArray().put(JSONObject().put("id", space).put("title", "Рабочая команда").put("role", "owner")))
    override suspend fun sharedProjects(spaceId: String) = JSONObject().put("projects", JSONArray().put(project()))
    override suspend fun archivedSharedProjects(spaceId: String) = JSONObject().put("projects", JSONArray())
    override suspend fun sharedSpaceUi(spaceId: String) = JSONObject().put("expandedIds", JSONArray())
    override suspend fun saveSharedSpaceUi(spaceId: String, ids: List<String>) = JSONObject().put("expandedIds", JSONArray(ids))
    override suspend fun sharedProject(projectId: String) = JSONObject().put("project", project()).put("statuses", JSONArray(statuses.toString()))
        .put("tasks", JSONArray(tasks.toString())).put("members", JSONArray()).put("categories", JSONArray()).put("customFieldDefinitions", JSONArray())
    override suspend fun sharedInvitations() = JSONObject().put("invitations", JSONArray())
    override suspend fun queuedSharedTasks(projectId: String) = emptyList<JSONObject>()
    override suspend fun flushSharedOfflineTasks() = 0
    override suspend fun sharedGoogleSettings(projectId: String) = JSONObject().put("settings", JSONObject())
    override suspend fun querySharedTasks(filter: JSONObject, cursor: String?) = JSONObject().put("tasks", JSONArray(tasks.toString()))
        .put("total", tasks.length()).put("hasMore", false).put("queryVersion", "synthetic-mobile-v1")
    override suspend fun createSharedTask(projectId: String, fields: JSONObject): JSONObject { creates++; error("Visual test must not submit") }
}

/** Exercises the real repository, Room and envelope format against an in-memory endpoint. */
private class MobileMapPreviewTransport : MindmapTransport {
    private val key = ByteArray(32) { (it + 1).toByte() }
    private val rows = linkedMapOf<String, JSONObject>()
    override fun check() = Unit
    override suspend fun workspace() = JSONObject().put("workspace", JSONObject().put("keyMode", "account")
        .put("key", Base64.getEncoder().encodeToString(key)))
    override suspend fun request(path: String, body: JSONObject?): JSONObject {
        if (body == null) return JSONObject().put(if (path.endsWith("/history")) "versions" else "maps", JSONArray(rows.values.toList()))
        require(path.startsWith("/mindmaps/"))
        val id = path.removePrefix("/mindmaps/")
        val revision = (rows[id]?.optLong("revision") ?: 0L) + 1
        rows[id] = JSONObject(body.toString()).put("id", id).put("revision", revision)
        return JSONObject().put("revision", revision)
    }
}
