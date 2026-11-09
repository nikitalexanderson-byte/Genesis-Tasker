package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.StoicheionGestureActivity
import ru.genesis.calendar.auth.SharedWorkspaceGateway
import ru.genesis.calendar.domain.CalendarMode
import java.io.File
import java.io.IOException

class SharedTaskDetailsUiTest {
    @get:Rule val compose = createAndroidComposeRule<StoicheionGestureActivity>()
    private fun task() = JSONObject().put("id", "qa-parent").put("projectId", "qa-project").put("revision", 1)
        .put("title", "Задача").put("priority", 3).put("completedAt", JSONObject.NULL)
        .put("parentTaskId", JSONObject.NULL).put("checklists", JSONArray())
    private fun item() = JSONObject().put("id", "qa-item").put("title", "Проверить результат").put("done", false)
        .put("assigneeId", JSONObject.NULL).put("dueDate", JSONObject.NULL).put("linkedTaskId", JSONObject.NULL)
    private fun withList() = task().put("checklists", JSONArray().put(JSONObject().put("id", "qa-list")
        .put("title", "Приёмка").put("items", JSONArray().put(item()))))
    private fun content(body: @Composable () -> Unit) {
        val dark = InstrumentationRegistry.getArguments().getString("genesisCaptureDark") == "true"
        compose.setContent { CompositionLocalProvider(LocalGenesisLanguage provides "ru", LocalEveningTheme provides dark) {
            MaterialTheme(colorScheme = if (dark) evening else standart) { Surface {
                Column(Modifier.fillMaxSize().safeDrawingPadding().imePadding().verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(12.dp)) { body() }
            } }
        } }
    }

    @Test fun checklistEditingZeroPriorityAndOrderingProduceTheExpectedWireValues() {
        val original = withList()
        var draft by mutableStateOf(sharedTaskDetailDraft(original))
        content { SharedTaskDetailsFields(original, draft, { draft = it }, false) }
        compose.onNodeWithText("Без приоритета").performScrollTo().performClick()
        compose.onNodeWithTag("shared-checklist-item-qa-item").performScrollTo().performTextReplacement("Полный новый текст")
        compose.onNodeWithContentDescription("Выполнено: Полный новый текст").performScrollTo().performClick()
        compose.onNodeWithContentDescription("Добавить пункт").performScrollTo().performClick()
        var added = ""
        compose.runOnIdle { added = draft.getJSONArray("checklists").getJSONObject(0).getJSONArray("items").getJSONObject(1).getString("id") }
        compose.onNodeWithTag("shared-checklist-item-" + added).performScrollTo().performTextReplacement("Второй пункт")
        compose.runOnIdle {
            val patch = sharedTaskDetailChanges(original, draft, false)
            assertEquals(0, patch.getInt("priority"))
            val items = patch.getJSONArray("checklists").getJSONObject(0).getJSONArray("items")
            assertEquals(2, items.length()); assertTrue(items.getJSONObject(0).getBoolean("done"))
            assertEquals("Полный новый текст", items.getJSONObject(0).getString("title"))
            assertEquals("Второй пункт", items.getJSONObject(1).getString("title"))
            assertTrue(sharedTaskChecklistsValid(draft))
            assertFalse(original.getJSONArray("checklists").getJSONObject(0).getJSONArray("items").getJSONObject(0).getBoolean("done"))
        }
    }

    @Test fun conversionRetainsItsRequestIdentityAndViewerHasNoWriteControls() {
        val original = withList()
        var readOnly by mutableStateOf(false)
        val requests = mutableListOf<String>()
        content { SharedTaskDetailsFields(original, sharedTaskDetailDraft(original), {}, false,
            readOnly = readOnly, onConvert = { item, request -> assertEquals("qa-item", item); requests += request }) }
        compose.onNodeWithText("Срок, исполнитель и действия").performScrollTo().performClick()
        compose.onNodeWithContentDescription("Превратить в задачу").performScrollTo().performClick()
        compose.onNodeWithContentDescription("Превратить в задачу").performClick()
        compose.runOnIdle { assertEquals(2, requests.size); assertEquals(requests[0], requests[1]); readOnly = true }
        compose.onNodeWithContentDescription("Добавить пункт").assertDoesNotExist()
        compose.onNodeWithContentDescription("Превратить в задачу").assertDoesNotExist()
        compose.onNodeWithContentDescription("Выполнено: Проверить результат").assertIsNotEnabled()
        compose.onNodeWithText("Без приоритета").assertIsNotEnabled()
    }

    @Test fun childCreationUsesImeAndRefreshesTheFilteredChildList() {
        val original = task()
        val children = mutableListOf<JSONObject>()
        var created = ""
        val gateway = object : SharedWorkspaceGateway {
            override suspend fun sortedSharedTasks(filter: JSONObject, cursor: String?, sort: String): JSONObject {
                assertEquals("qa-parent", filter.getString("parentTaskId"))
                return JSONObject().put("tasks", JSONArray(children)).put("total", children.size).put("hasMore", false)
                    .put("nextCursor", JSONObject.NULL).put("queryVersion", "revision-" + children.size)
            }
        }
        content { SharedTaskRelations(gateway, original, sharedTaskDetailDraft(original), emptyList(),
            false, false, true, CalendarMode.PROFANE, {}, { _, _ -> }) { title ->
            created = title
            children += JSONObject().put("id", "qa-child").put("projectId", "qa-project").put("title", title)
                .put("archivedAt", JSONObject.NULL).put("completedAt", JSONObject.NULL).put("assigneeId", JSONObject.NULL).put("dueDate", JSONObject.NULL)
        } }
        compose.onNodeWithText("Подзадачи и родитель").performScrollTo().performClick()
        compose.onNodeWithTag("shared-child-title").performScrollTo().performTextInput("Подготовить материалы")
        compose.onNodeWithTag("shared-child-title").performImeAction()
        compose.waitUntil(5000) { created == "Подготовить материалы" }
        compose.onNodeWithText("Подготовить материалы", substring = false).assertExists()
        assertEquals("", compose.onNodeWithTag("shared-child-title").fetchSemanticsNode()
            .config[androidx.compose.ui.semantics.SemanticsProperties.EditableText].text)
    }

    @Test fun taskWatchRecoversFromAFailedWriteAndHasASelectedState() {
        var serverWatching = false; var fail = true
        val gateway = object : SharedWorkspaceGateway {
            override suspend fun sharedTaskWatch(projectId: String, taskId: String, watching: Boolean?): JSONObject {
                if (watching != null && fail) { fail = false; throw IOException("isolated test") }
                if (watching != null) serverWatching = watching
                return JSONObject().put("watching", serverWatching)
            }
        }
        content { SharedTaskNotificationWatch(gateway, "qa-project", "qa-parent", true) }
        compose.waitUntil(5000) { runCatching {
            compose.onNodeWithContentDescription("Наблюдение за задачей").assertIsEnabled(); true
        }.getOrDefault(false) }
        compose.onNodeWithContentDescription("Наблюдение за задачей").performClick()
        compose.onNodeWithContentDescription("Обновить").assertExists().performClick()
        compose.onNodeWithContentDescription("Наблюдение за задачей").performClick()
        compose.onNodeWithContentDescription("Наблюдение за задачей").assertIsSelected()
    }

    @Test fun captureNativeTaskEditor() {
        org.junit.Assume.assumeTrue(InstrumentationRegistry.getArguments().getString("genesisDetailsCapture") == "true")
        val original = withList()
        var draft by mutableStateOf(sharedTaskDetailDraft(original))
        content { SharedTaskDetailsFields(original, draft, { draft = it }, false) }
        compose.onNodeWithTag("shared-checklist-item-qa-item").assertExists()
        val target = InstrumentationRegistry.getInstrumentation().targetContext
        compose.onRoot().captureToImage().asAndroidBitmap().let { bitmap ->
            File(target.cacheDir, "task-details-capture.png").outputStream().use {
                assertTrue(bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it))
            }
        }
    }
}
