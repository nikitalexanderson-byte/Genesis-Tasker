package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.StoicheionGestureActivity
import ru.genesis.calendar.auth.*

/** Actual shipped controls against an isolated in-memory gateway; no authenticated controller/network. */
class SharedCoreControls313Test {
    @get:Rule val compose = createAndroidComposeRule<StoicheionGestureActivity>()
    private val project = "10000000-0000-4000-8000-000000000021"
    private val taskId = "10000000-0000-4000-8000-000000000022"
    private val space = "10000000-0000-4000-8000-000000000023"
    private fun copy(value: JSONObject) = JSONObject(value.toString())
    private fun task() = JSONObject().put("id", taskId).put("projectId", project).put("revision", 1)
        .put("title", "Synthetic lifecycle source").put("description", "Retain Unicode αβ and child link")
        .put("parentTaskId", JSONObject.NULL).put("completedAt", JSONObject.NULL).put("archivedAt", JSONObject.NULL)
        .put("createdBy", "author").put("approvalRequired", false).put("approvals", JSONArray())
    private fun guard() {
        val app = compose.activity.application as GenesisApplication
        check(BuildConfig.DEBUG && app.packageName == BuildConfig.APPLICATION_ID && app.packageName.endsWith(".debug") && app.workspaceScope == "internal-validation-v1")
    }
    private fun await(matcher: SemanticsMatcher) = compose.waitUntil(10_000) {
        compose.onAllNodes(matcher).fetchSemanticsNodes().isNotEmpty()
    }
    private fun click(text: String) {
        val node = compose.onNodeWithText(text)
        if (!node.isDisplayed()) node.performScrollTo()
        node.assertIsDisplayed().assertIsEnabled().performClick()
    }
    private fun content(body: @Composable () -> Unit) = compose.setContent {
        CompositionLocalProvider(LocalGenesisLanguage provides "ru", LocalEveningTheme provides false) {
            MaterialTheme(colorScheme = standart) { Surface(Modifier.fillMaxSize()) { body() } }
        }
    }

    @Test fun actualArchiveTrashRestoreAndConfirmedPurgeKeepIdentityAndHonorCancellation() {
        guard()
        val record = task()
        val sourceDescription = record.getString("description")
        var state = "active"
        var view by mutableStateOf("archive-action")
        var lifecyclePage by mutableStateOf("archive")
        val mutations = mutableListOf<String>()
        val gateway = object : SharedTaskLifecycleGateway {
            override suspend fun sharedTaskArchive(scope: String, query: String, cursor: String?) = JSONObject()
                .put("tasks", JSONArray().apply { if (state == "archive") put(copy(record)) })
                .put("total", if (state == "archive") 1 else 0).put("hasMore", false).put("nextCursor", JSONObject.NULL)
            override suspend fun sharedTaskTrash(scope: String) = JSONObject().put("items", JSONArray().apply {
                if (state == "trash") put(copy(record).put("kind", "task").put("canRestore", true).put("canPurge", true)
                    .put("retentionDays", 30).put("expiresAt", "2099-12-31T12:00:00Z"))
            })
            override suspend fun sharedTaskArchiveCommand(p: String, t: String, command: JSONObject): JSONObject {
                assertEquals(project, p); assertEquals(taskId, t); assertEquals(record.getInt("revision"), command.getInt("expectedRevision"))
                assertTrue(command.getBoolean("archived")); SharedTaskLifecycleProtocol.id(command.getString("requestId"))
                mutations += "archive"; state = "archive"
                record.put("archivedAt", "2026-10-30T12:00:00Z").put("revision", record.getInt("revision") + 1)
                return JSONObject().put("task", copy(record))
            }
            override suspend fun sharedTaskTrashCommand(p: String, t: String, command: JSONObject): JSONObject {
                assertEquals(project, p); assertEquals(taskId, t); assertEquals(record.getInt("revision"), command.getInt("expectedRevision"))
                assertEquals(30, command.getInt("retentionDays")); mutations += "trash"; state = "trash"
                record.put("revision", record.getInt("revision") + 1)
                return JSONObject().put("ok", true)
            }
            override suspend fun sharedTrashRestore(scope: String, kind: String, id: String, command: JSONObject): JSONObject {
                assertEquals(space, scope); assertEquals("task", kind); assertEquals(taskId, id)
                assertEquals("2099-12-31T12:00:00Z", command.getString("expectedExpiresAt"))
                mutations += "restore"; state = "active"
                record.put("archivedAt", JSONObject.NULL).put("revision", record.getInt("revision") + 1)
                return JSONObject().put("ok", true)
            }
            override suspend fun sharedTrashPurge(scope: String, id: String, command: JSONObject): JSONObject {
                assertEquals(space, scope); assertEquals(taskId, id); assertTrue(command.getBoolean("confirmPermanent"))
                assertEquals("2099-12-31T12:00:00Z", command.getString("expectedExpiresAt"))
                mutations += "purge"; state = "purged"; return JSONObject().put("ok", true)
            }
        }
        content { key(view) {
            if (view.endsWith("-action")) SharedTaskLifecycleActionDialog(gateway, view.substringBefore("-"), copy(record),
                onClose = { view = "list" }, onChanged = {})
            else SharedTaskLifecycleScreen(gateway, space, listOf(JSONObject().put("id", project).put("canOrganizeTasks", true)),
                onClose = {}, onChanged = {}, onOpen = { _, _ -> }, page = lifecyclePage)
        } }
        click("Отмена"); compose.runOnIdle { assertTrue(mutations.isEmpty()); view = "archive-action" }
        click("В архив"); await(hasTestTag("shared-task-lifecycle")); await(hasText(record.getString("title")))
        compose.onNodeWithContentDescription("В корзину").performScrollTo().performClick()
        click("Отмена"); compose.runOnIdle { assertEquals(listOf("archive"), mutations) }
        compose.onNodeWithContentDescription("В корзину").performScrollTo().performClick(); click("Подтвердить")
        compose.onNodeWithTag("lifecycle-tab-trash").assertDoesNotExist()
        compose.runOnIdle { lifecyclePage = "trash" }; await(hasText("Восстановить")); click("Восстановить")
        compose.waitUntil(10_000) { state == "active" }
        compose.runOnIdle {
            assertEquals(taskId, record.getString("id")); assertEquals(sourceDescription, record.getString("description"))
            assertTrue(record.isNull("completedAt")); assertEquals(listOf("archive", "trash", "restore"), mutations)
            view = "trash-action"
        }
        click("В корзину")
        await(hasContentDescription("Удалить навсегда"))
        compose.onNodeWithContentDescription("Удалить навсегда").performScrollTo().performClick(); click("Отмена")
        compose.runOnIdle { assertEquals("trash", state); assertEquals(4, mutations.size) }
        compose.onNodeWithContentDescription("Удалить навсегда").performScrollTo().performClick()
        click("Удалить навсегда"); compose.waitUntil(10_000) { state == "purged" }
        compose.onNodeWithText("Корзина пуста.").assertExists()
        assertEquals(listOf("archive", "trash", "restore", "trash", "purge"), mutations)
    }

    @Test fun actualApproverConfigurationCancellationCompletionAndReviewReopenUseAuthoritativeRevision() {
        guard()
        var record = task()
        var rendered by mutableStateOf(copy(record))
        var user by mutableStateOf("author")
        var generation by mutableIntStateOf(0)
        val members = listOf(JSONObject().put("userId", "approver").put("displayName", "Synthetic approver"))
        val commands = mutableListOf<String>()
        val gateway = object : SharedTaskReviewGateway {
            override suspend fun sharedTaskApprovers(p: String, t: String, command: JSONObject): JSONObject {
                assertEquals(project, p); assertEquals(taskId, t); assertEquals(record.getInt("revision"), command.getInt("expectedRevision"))
                assertTrue(command.getBoolean("approvalRequired")); assertEquals("approver", command.getJSONArray("approverIds").getString(0))
                commands += "configure"; record = copy(record).put("approvalRequired", true).put("revision", record.getInt("revision") + 1)
                    .put("approvals", JSONArray().put(JSONObject().put("userId", "approver").put("displayName", "Synthetic approver").put("approvedAt", JSONObject.NULL)))
                return JSONObject().put("task", copy(record))
            }
            override suspend fun sharedTaskApprove(p: String, t: String): JSONObject {
                assertEquals(project, p); assertEquals(taskId, t); assertEquals("approver", user)
                assertTrue(SharedTaskReviewProtocol.canApprove(record, user)); commands += "approve"
                record = copy(record).put("revision", record.getInt("revision") + 1).put("completedAt", "2026-10-30T12:00:00Z")
                record.getJSONArray("approvals").getJSONObject(0).put("approvedAt", "2026-10-30T12:00:00Z")
                record.put("review", JSONObject().put("enabled", true).put("allowed", JSONObject().put("checked", true))
                    .put("entries", JSONArray()))
                return JSONObject().put("task", copy(record))
            }
            override suspend fun sharedTaskReview(p: String, t: String, command: JSONObject): JSONObject {
                assertEquals(project, p); assertEquals(taskId, t); assertEquals(record.getInt("revision"), command.getInt("expectedRevision"))
                assertEquals("checked", command.getString("kind")); assertTrue(command.getBoolean("enabled")); commands += "review"
                record = copy(record).put("revision", record.getInt("revision") + 1)
                record.getJSONObject("review").put("entries", JSONArray().put(JSONObject().put("kind", "checked")
                    .put("userId", "approver").put("displayName", "Synthetic approver")))
                return JSONObject().put("task", copy(record))
            }
        }
        content { key(generation) { Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            SharedTaskReviewPanel(gateway, rendered, JSONObject().put("permissions", JSONObject()
                .put("editTasks", user == "author").put("manageProjects", user == "author")), members, user, false,
                onRefresh = { rendered = copy(record) })
        } } }
        compose.onNodeWithContentDescription("Настроить подтверждение").performClick()
        compose.onNodeWithContentDescription("Нужно подтверждение").performClick()
        compose.onNodeWithText("Сохранить").assertIsNotEnabled()
        compose.onNodeWithContentDescription("Synthetic approver").performClick(); click("Сохранить")
        compose.waitUntil(10_000) { commands == listOf("configure") }
        compose.runOnIdle { user = "outsider" }
        compose.onNodeWithTag("shared-task-approve").assertDoesNotExist()
        compose.onNodeWithContentDescription("Настроить подтверждение").assertDoesNotExist()
        compose.runOnIdle { user = "approver" }
        compose.onNodeWithTag("shared-task-approve").performScrollTo().performClick(); click("Отмена")
        compose.runOnIdle { assertEquals(listOf("configure"), commands) }
        compose.onNodeWithTag("shared-task-approve").performScrollTo().performClick(); click("Подтвердить")
        compose.waitUntil(10_000) { commands == listOf("configure", "approve") }
        compose.onNodeWithTag("shared-task-approve").assertDoesNotExist()
        compose.onNodeWithTag("shared-task-review-checked").performScrollTo().assertIsOff().performClick()
        compose.waitUntil(10_000) { commands == listOf("configure", "approve", "review") }
        compose.runOnIdle { rendered = copy(record); generation++ }
        compose.onNodeWithTag("shared-task-review-checked").performScrollTo().assertIsOn()
        assertEquals(taskId, record.getString("id")); assertEquals(4, record.getInt("revision"))
        compose.runOnIdle {
            user = "outsider"; rendered = copy(record).put("review", JSONObject().put("enabled", true).put("entries", JSONArray())
                .put("allowed", JSONObject())); generation++
        }
        compose.onNodeWithTag("shared-task-review-checked").assertDoesNotExist()
        assertEquals(listOf("configure", "approve", "review"), commands)
    }
}
