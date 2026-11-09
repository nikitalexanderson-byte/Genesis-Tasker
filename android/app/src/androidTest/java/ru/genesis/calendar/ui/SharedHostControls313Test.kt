package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.core.view.WindowInsetsCompat
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import java.time.Instant
import java.time.LocalDate
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.StoicheionGestureActivity
import ru.genesis.calendar.auth.*
import ru.genesis.calendar.data.UiPreferences
import ru.genesis.calendar.domain.CalendarMode

/** Shipped UI with isolated, stateful gateways. These are not live account or PHP transport tests. */
class SharedHostControls313Test {
    @get:Rule val compose = createAndroidComposeRule<StoicheionGestureActivity>()
    private val space = "10000000-0000-4000-8000-000000000031"
    private val parent = "10000000-0000-4000-8000-000000000032"
    private val child = "10000000-0000-4000-8000-000000000033"
    private val board = "10000000-0000-4000-8000-000000000034"
    private val taskId = "10000000-0000-4000-8000-000000000035"
    private val seriesId = "10000000-0000-4000-8000-000000000036"
    private fun copy(value: JSONObject) = JSONObject(value.toString())
    private fun guard() {
        val app = compose.activity.application as GenesisApplication
        check(BuildConfig.DEBUG && app.packageName == "ru.genesis.calendar.v313.debug" && app.workspaceScope == "internal-validation-v1")
    }
    private fun await(matcher: SemanticsMatcher) = compose.waitUntil(15_000) {
        compose.onAllNodes(matcher).fetchSemanticsNodes().isNotEmpty()
    }
    private fun click(matcher: SemanticsMatcher) {
        val node = compose.onNode(matcher)
        if (!node.isDisplayed()) node.performScrollTo()
        node.assertIsDisplayed().assertIsEnabled().performClick()
    }
    private fun clickText(text: String, substring: Boolean = false) = click(hasText(text, substring = substring) and hasClickAction())
    private fun dialogClick(text: String) = click(hasText(text) and hasClickAction() and hasAnyAncestor(isDialog()))
    private fun field(label: String) = compose.onNode(hasText(label) and hasSetTextAction())
    private fun hideIme() = compose.dismissValidationKeyboard()
    private fun content(body: @Composable () -> Unit) = compose.setContent {
        CompositionLocalProvider(LocalGenesisLanguage provides "ru", LocalEveningTheme provides false,
            LocalGenesisUserId provides "synthetic-author") {
            MaterialTheme(colorScheme = standart) { Surface(Modifier.fillMaxSize()) { body() } }
        }
    }
    private fun enterSpace() { await(hasTestTag("shared-space-$space")); click(hasTestTag("shared-space-$space")) }
    private fun openProject(id: String) { await(hasTestTag("shared-project-$id")); click(hasTestTag("shared-project-$id")); await(hasTestTag("shared-create-task")) }
    private fun projectSettings() { click(hasTestTag("shared-actions")); clickText("Настройки проекта"); await(hasText("Название") and hasSetTextAction()) }
    private fun teamSettings() { click(hasTestTag("shared-team-actions")); clickText("Участники и роли"); await(hasText("Synthetic peer")) }

    private inner class HostFixture(seeded: Boolean = true) : SharedWorkspaceGateway {
        var available = seeded
        val projects = mutableListOf<JSONObject>()
        var expanded = emptyList<String>()
        val operations = mutableListOf<String>()
        val creates = mutableListOf<JSONObject>()
        var invites = mutableListOf(JSONObject().put("id", "invite-decline").put("spaceTitle", "Decline fixture").put("inviterName", "Synthetic inviter"),
            JSONObject().put("id", "invite-accept").put("spaceTitle", "Accept fixture").put("inviterName", "Synthetic inviter"))
        val peers = mutableListOf(JSONObject().put("userId", "synthetic-peer").put("displayName", "Synthetic peer")
            .put("spaceRole", "member").put("role", "member").put("canOrganizeTasks", true))
        init { if (seeded) projects += project(parent, "Parent QA", "Preserve parent source", null) }
        fun project(id: String, title: String, description: String, parentId: String?) = JSONObject()
            .put("id", id).put("spaceId", space).put("title", title).put("description", description)
            .put("parentId", parentId ?: JSONObject.NULL).put("layout", "list").put("kind", "project").put("isInbox", 0)
            .put("role", "owner").put("spaceRole", "owner").put("revision", 1).put("archivedAt", JSONObject.NULL)
            .put("canOrganizeTasks", true).put("planning", JSONObject().put("enabled", false).put("estimateUnit", "points").put("revision", 1))
        fun row(id: String) = projects.single { it.getString("id") == id }
        private fun workspace() = JSONObject().put("id", space).put("title", "Synthetic workspace").put("role", "owner")
        override suspend fun sharedSpaces() = JSONObject().put("spaces", JSONArray().apply { if (available) put(workspace()) })
        override suspend fun createSharedSpace(title: String): JSONObject {
            assertEquals("Synthetic workspace", title); available = true; operations += "space:create"
            return JSONObject().put("space", workspace())
        }
        override suspend fun sharedProjects(spaceId: String) = JSONObject().put("projects", JSONArray(projects.filter { it.isNull("archivedAt") }.map(::copy)))
        override suspend fun archivedSharedProjects(spaceId: String) = JSONObject().put("projects", JSONArray(projects.filterNot { it.isNull("archivedAt") }.map(::copy)))
        override suspend fun sharedWorkflowRepairProjects(spaceId: String) = JSONObject().put("projects", JSONArray())
        override suspend fun sharedSpaceUi(spaceId: String) = JSONObject().put("expandedIds", JSONArray(expanded))
        override suspend fun saveSharedSpaceUi(spaceId: String, ids: List<String>): JSONObject { expanded = ids; return sharedSpaceUi(spaceId) }
        override suspend fun flushSharedOfflineTasks() = 0
        override suspend fun queuedSharedTasks(projectId: String) = emptyList<JSONObject>()
        override suspend fun sharedGoogleSettings(projectId: String) = JSONObject().put("settings", JSONObject())
        override suspend fun querySharedTasks(filter: JSONObject, cursor: String?) = JSONObject().put("tasks", JSONArray())
            .put("total", 0).put("hasMore", false).put("nextCursor", JSONObject.NULL).put("queryVersion", "synthetic-" + projects.sumOf { it.getInt("revision") })
        override suspend fun sharedProject(projectId: String) = JSONObject().put("project", copy(row(projectId)))
            .put("statuses", JSONArray().put(JSONObject().put("id", board).put("title", "К выполнению").put("isDone", 0).put("revision", 1).put("position", 0).put("color", "#2d6c68").put("imageUrl", ""))
                .put(JSONObject().put("id", "done").put("title", "Готово").put("isDone", 1).put("revision", 1)))
            .put("tasks", JSONArray()).put("members", JSONArray(peers.map(::copy))).put("spaceMembers", JSONArray())
            .put("categories", JSONArray()).put("customFieldDefinitions", JSONArray())
        override suspend fun createSharedProject(spaceId: String, title: String, description: String, layout: String,
            parentId: String?, kind: String, boardStatusId: String?): JSONObject {
            assertEquals(space, spaceId); assertEquals("list", layout); assertEquals("project", kind)
            require(parentId == null || projects.any { it.getString("id") == parentId })
            val id = if (projects.isEmpty()) parent else child
            val created = project(id, title, description, parentId)
            projects += created; creates += copy(created); operations += "project:create:$id"
            return JSONObject().put("project", copy(created))
        }
        override suspend fun updateSharedProject(projectId: String, changes: JSONObject): JSONObject {
            val current = row(projectId); assertEquals(current.getInt("revision"), changes.getInt("expectedRevision"))
            require(changes.optString("parentId") != projectId)
            for (key in listOf("title", "description", "layout", "parentId")) current.put(key, changes.get(key))
            current.put("revision", current.getInt("revision") + 1); operations += "project:update"
            return JSONObject().put("project", copy(current))
        }
        override suspend fun setSharedProjectArchived(projectId: String, archived: Boolean): JSONObject {
            row(projectId).put("archivedAt", if (archived) "2026-10-30T12:00:00Z" else JSONObject.NULL)
                .put("revision", row(projectId).getInt("revision") + 1)
            operations += "project:archive:$archived"; return JSONObject().put("ok", true)
        }
        override suspend fun inviteSharedSpaceMember(spaceId: String, email: String, role: String): JSONObject {
            assertEquals(space, spaceId); assertEquals("synthetic-recipient@gmail.com", email); assertEquals("guest", role)
            operations += "invite:create:guest"; return JSONObject().put("ok", true)
        }
        override suspend fun sharedInvitations() = JSONObject().put("invitations", JSONArray(invites.map(::copy)))
        override suspend fun rejectSharedInvitation(id: String): JSONObject {
            assertEquals("invite-decline", id); check(invites.removeAll { it.getString("id") == id })
            operations += "invite:decline"; return JSONObject().put("ok", true)
        }
        override suspend fun acceptSharedInvitation(id: String): JSONObject {
            assertEquals("invite-accept", id); check(invites.removeAll { it.getString("id") == id })
            operations += "invite:accept"; return JSONObject().put("spaceId", space)
        }
        override suspend fun changeSharedMemberRole(projectId: String, userId: String, role: String): JSONObject {
            assertEquals(parent, projectId); assertEquals("synthetic-peer", userId); assertEquals("viewer", role)
            peers.single().put("role", role); operations += "member:viewer"; return JSONObject().put("ok", true)
        }
        override suspend fun changeSharedSpaceRole(spaceId: String, userId: String, role: String, canOrganizeTasks: Boolean?): JSONObject {
            assertEquals(space, spaceId); assertEquals("synthetic-peer", userId); assertEquals("guest", role)
            peers.single().put("spaceRole", role); canOrganizeTasks?.let { peers.single().put("canOrganizeTasks", it) }
            operations += if (canOrganizeTasks == null) "member:guest" else "member:organize:$canOrganizeTasks"
            return JSONObject().put("ok", true)
        }
        override suspend fun removeSharedMember(projectId: String, userId: String): JSONObject {
            assertEquals(parent, projectId); assertEquals("synthetic-peer", userId); check(peers.size == 1)
            peers.clear(); operations += "member:remove"; return JSONObject().put("ok", true)
        }
    }

    @Test fun actualWorkspaceNestedProjectEditArchiveCancelAndRestoreSurviveFreshScreen() {
        guard(); val fixture = HostFixture(seeded = false); var generation by mutableIntStateOf(0)
        content { key(generation) { SharedProjectsScreen(fixture, "ru") } }
        await(hasTestTag("shared-create-space")); click(hasTestTag("shared-create-space"))
        compose.onNodeWithTag("shared-create-confirm").assertIsNotEnabled()
        field("Название пространства").performTextReplacement("Synthetic workspace"); hideIme()
        click(hasTestTag("shared-create-confirm")); await(hasTestTag("shared-create-project"))
        click(hasTestTag("shared-create-project")); field("Название проекта").performTextReplacement("Parent QA")
        field("Описание").performTextReplacement("Preserve parent source"); hideIme(); click(hasTestTag("shared-create-confirm"))
        await(hasTestTag("shared-create-task")); click(hasTestTag("shared-create-task")); click(hasTestTag("shared-create-project-option"))
        field("Название проекта").performTextReplacement("Child αβ"); field("Описание").performTextReplacement("Nested original")
        hideIme(); compose.onNode(hasText("Parent QA") and hasClickAction() and hasAnyAncestor(isDialog())).assertIsSelected()
        click(hasTestTag("shared-create-confirm")); compose.waitUntil(15_000) { fixture.creates.size == 2 }
        await(hasTestTag("shared-create-task")); assertEquals(parent, fixture.row(child).getString("parentId"))
        projectSettings(); field("Название").performTextReplacement("Renamed child αβ")
        field("Описание").performTextReplacement("Saved nested description"); hideIme(); dialogClick("Верхний уровень"); dialogClick("Сохранить проект")
        compose.waitUntil(10_000) { fixture.row(child).isNull("parentId") }
        dialogClick("Parent QA"); dialogClick("Сохранить проект")
        compose.waitUntil(10_000) { fixture.row(child).optString("parentId") == parent }
        dialogClick("Архивировать проект"); dialogClick("Отмена")
        assertFalse(fixture.operations.any { it.startsWith("project:archive") })
        dialogClick("Архивировать проект"); dialogClick("В архив")
        await(hasTestTag("shared-space-data")); click(hasTestTag("shared-space-data")); clickText("Архив проектов")
        await(hasText("Восстановить") and hasClickAction()); clickText("Восстановить")
        compose.waitUntil(10_000) { fixture.row(child).isNull("archivedAt") }
        assertEquals(listOf("project:archive:true", "project:archive:false"), fixture.operations.filter { it.startsWith("project:archive") })
        assertEquals("Saved nested description", fixture.row(child).getString("description")); assertEquals(parent, fixture.row(child).getString("parentId"))
        compose.runOnIdle { generation++ }; enterSpace(); openProject(child); projectSettings()
        field("Название").assertTextContains("Renamed child αβ"); field("Описание").assertTextContains("Saved nested description")
        compose.onNode(hasText("Parent QA") and hasClickAction() and hasAnyAncestor(isDialog())).assertIsSelected()
        assertEquals(2, fixture.projects.size); assertEquals("Preserve parent source", fixture.row(parent).getString("description"))
    }

    @Test fun actualCommentSendAcknowledgesOnceAndFreshReaderKeepsTheSavedText() {
        guard(); val rows = mutableListOf<JSONObject>(); var draft by mutableStateOf(""); var generation by mutableIntStateOf(0)
        var canComment by mutableStateOf(true); var reads = 0; var writes = 0
        val gateway = object : SharedWorkspaceGateway {
            override suspend fun sharedComments(projectId: String, task: String): JSONObject {
                assertEquals(parent, projectId); assertEquals(taskId, task); reads++
                return JSONObject().put("comments", JSONArray(rows.map(::copy)))
            }
            override suspend fun readSharedTaskUpdates(projectId: String, task: String, commentIds: List<String>) = JSONObject().put("ok", true)
            override suspend fun addSharedComment(projectId: String, task: String, body: String): JSONObject {
                assertEquals(parent, projectId); assertEquals(taskId, task); assertEquals("Комментарий αβ с сохранением", body)
                writes++; val record = JSONObject().put("id", "synthetic-comment").put("body", body).put("authorId", "synthetic-author")
                    .put("authorName", "Synthetic commenter").put("createdAt", Instant.now().toString())
                rows += record; return JSONObject().put("comment", copy(record))
            }
        }
        content { key(generation) { Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            SharedTaskDiscussion(gateway, parent, taskId, true, canComment, false, draft, { draft = it })
        } } }
        await(hasTestTag("shared-comment-send")); compose.onNodeWithTag("shared-comment-send").assertIsNotEnabled()
        compose.onNodeWithTag("shared-comment-draft").performScrollTo().performTextReplacement("  Комментарий αβ с сохранением  ")
        hideIme(); click(hasTestTag("shared-comment-send")); await(hasTestTag("shared-comment-synthetic-comment"))
        compose.onNodeWithTag("shared-comment-send").assertIsNotEnabled()
        assertEquals("", compose.onNodeWithTag("shared-comment-draft").fetchSemanticsNode().config[SemanticsProperties.EditableText].text)
        assertEquals(1, writes); assertEquals(1, rows.size)
        val before = reads; compose.runOnIdle { generation++ }
        compose.waitUntil(10_000) { reads > before }; await(hasTestTag("shared-comment-synthetic-comment"))
        compose.onNodeWithText("Комментарий αβ с сохранением").assertExists()
        compose.runOnIdle { canComment = false; generation++ }; await(hasTestTag("shared-comment-synthetic-comment"))
        compose.onNodeWithTag("shared-comment-draft").assertDoesNotExist(); compose.onNodeWithTag("shared-comment-send").assertDoesNotExist()
        assertEquals(1, writes); assertEquals("synthetic-comment", rows.single().getString("id"))
    }

    @Test fun actualSeriesCreateEditSkipAndFreshReadonlyReopenKeepBothRevisionGates() {
        guard(); val today = LocalDate.now().toString()
        var task = JSONObject().put("id", taskId).put("projectId", parent).put("revision", 1).put("dueDate", today)
            .put("completedAt", JSONObject.NULL).put("archivedAt", JSONObject.NULL)
        var rendered by mutableStateOf(copy(task)); var series: JSONObject? = null; var generation by mutableIntStateOf(0)
        var readOnly by mutableStateOf(false); var reads = 0; val commands = mutableListOf<JSONObject>()
        val gateway = object : SharedTaskSeriesGateway {
            override suspend fun sharedTaskSeries(project: String, id: String): JSONObject {
                assertEquals(parent, project); assertEquals(taskId, id); reads++
                return JSONObject().put("series", series?.let(::copy) ?: JSONObject.NULL)
            }
            override suspend fun sharedTaskSeriesCommand(project: String, id: String, command: JSONObject): JSONObject {
                assertEquals(parent, project); assertEquals(taskId, id); assertEquals(task.getInt("revision"), command.getInt("taskRevision"))
                SharedTaskLifecycleProtocol.id(command.getString("requestId")); commands += copy(command)
                if (series != null) { assertEquals(seriesId, command.getString("seriesId")); assertEquals(series!!.getInt("revision"), command.getInt("expectedRevision")) }
                if (command.optBoolean("skipInstance")) {
                    series = copy(series!!).put("revision", series!!.getInt("revision") + 1)
                    series!!.getJSONArray("instances").getJSONObject(0).put("state", "skipped")
                    task = copy(task).put("archivedAt", Instant.now().toString()).put("revision", task.getInt("revision") + 1)
                } else {
                    SharedTaskSeriesProtocol.settings(command.getJSONObject("settings"))
                    series = JSONObject().put("id", seriesId).put("projectId", parent).put("revision", (series?.getInt("revision") ?: 0) + 1)
                        .put("settings", copy(command.getJSONObject("settings"))).put("paused", command.getBoolean("paused"))
                        .put("generatedCount", 1).put("instances", JSONArray().put(JSONObject().put("ordinal", 1).put("date", today)
                            .put("state", "created").put("taskId", taskId).put("projectId", parent)))
                        .put("nextDates", JSONArray()).put("workerCompletedAt", Instant.now().toString()).put("lastError", JSONObject.NULL)
                }
                return JSONObject().put("series", copy(series!!))
            }
        }
        content { key(generation) { Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            SharedTaskSeriesPanel(gateway, rendered, UiPreferences(input = CalendarMode.PROFANE), readOnly, false,
                onDirtyChange = {}, onSaved = { rendered = copy(task) }, onOpen = { _, _ -> })
        } } }
        fun expand() { await(hasTestTag("shared-task-series")); clickText("Серия общих задач", substring = true) }
        expand(); await(hasTestTag("shared-task-series-save"))
        field("Лимит повторов, включая исходный и пропуски").performScrollTo().performTextReplacement("4"); hideIme()
        click(hasTestTag("shared-task-series-save")); compose.waitUntil(10_000) { commands.size == 1 }
        assertFalse(commands[0].has("expectedRevision")); assertEquals(4, series!!.getJSONObject("settings").getInt("limit"))
        val before = reads; compose.runOnIdle { generation++ }; compose.waitUntil(10_000) { reads > before }; expand()
        field("Лимит повторов, включая исходный и пропуски").assertTextContains("4")
        field("Лимит повторов, включая исходный и пропуски").performScrollTo().performTextReplacement("3"); hideIme()
        click(hasContentDescription("Пауза")); click(hasTestTag("shared-task-series-save"))
        compose.waitUntil(10_000) { commands.size == 2 }; assertEquals(1, commands[1].getInt("expectedRevision")); assertTrue(series!!.getBoolean("paused"))
        clickText("Пропустить этот повтор"); dialogClick("Отмена"); assertEquals(2, commands.size)
        clickText("Пропустить этот повтор"); dialogClick("Подтвердить"); compose.waitUntil(10_000) { commands.size == 3 }
        assertTrue(commands[2].getBoolean("skipInstance")); assertEquals(2, commands[2].getInt("expectedRevision"))
        compose.runOnIdle { readOnly = true; generation++ }; expand(); clickText("Последние 30 повторов")
        compose.onNodeWithText("1. $today · Пропущено").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("shared-task-series-save").assertDoesNotExist(); compose.onNodeWithText("Пропустить этот повтор").assertDoesNotExist()
        assertEquals(3, series!!.getInt("revision")); assertEquals(taskId, series!!.getJSONArray("instances").getJSONObject(0).getString("taskId"))
        assertEquals(3, commands.size)
    }

    @Test fun actualInviteRoleChangesRemovalAndInvitationDecisionsReloadTheirState() {
        guard(); val fixture = HostFixture(); var generation by mutableIntStateOf(0)
        content { key(generation) { SharedProjectsScreen(fixture, "ru") } }; enterSpace(); openProject(parent); teamSettings()
        dialogClick("Читатель"); compose.waitUntil(10_000) { fixture.peers.single().getString("role") == "viewer" }
        dialogClick("Гость"); compose.waitUntil(10_000) { fixture.peers.single().getString("spaceRole") == "guest" }
        click(hasAnySibling(hasText("Может распределять задачи")) and isToggleable())
        compose.waitUntil(10_000) { !fixture.peers.single().getBoolean("canOrganizeTasks") }
        dialogClick("Пригласить по Gmail"); field("Gmail").performTextReplacement("invalid@example.test"); hideIme()
        compose.onNodeWithTag("shared-create-confirm").assertIsNotEnabled()
        field("Gmail").performTextReplacement("synthetic-recipient@gmail.com"); hideIme(); dialogClick("Читатель")
        click(hasTestTag("shared-create-confirm")); compose.waitUntil(10_000) { "invite:create:guest" in fixture.operations }
        teamSettings(); dialogClick("Удалить участника"); dialogClick("Отмена")
        assertEquals(1, fixture.peers.size); assertFalse("member:remove" in fixture.operations)
        dialogClick("Удалить участника"); dialogClick("Удалить"); compose.waitUntil(10_000) { fixture.peers.isEmpty() }
        compose.onNodeWithText("Synthetic peer").assertDoesNotExist()
        compose.runOnIdle { generation++ }; await(hasTestTag("shared-actions")); click(hasTestTag("shared-actions")); click(hasTestTag("shared-join-space"))
        await(hasText("Decline fixture")); compose.onAllNodes(hasText("Отклонить") and hasClickAction()).onFirst().performClick()
        compose.waitUntil(10_000) { fixture.invites.size == 1 }; dialogClick("Присоединиться")
        compose.waitUntil(10_000) { fixture.invites.isEmpty() }; await(hasTestTag("shared-create-project"))
        assertEquals(listOf("member:viewer", "member:guest", "member:organize:false", "invite:create:guest", "member:remove", "invite:decline", "invite:accept"),
            fixture.operations.filter { it.startsWith("member:") || it.startsWith("invite:") })
        compose.runOnIdle { generation++ }; await(hasTestTag("shared-actions")); click(hasTestTag("shared-actions")); click(hasTestTag("shared-join-space"))
        await(hasText("Приглашений пока нет.")); assertEquals(1, fixture.projects.size)
    }
}
