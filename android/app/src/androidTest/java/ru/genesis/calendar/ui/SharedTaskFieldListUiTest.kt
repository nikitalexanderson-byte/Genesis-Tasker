package ru.genesis.calendar.ui

import android.graphics.BitmapFactory
import android.os.ParcelFileDescriptor
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.auth.CustomFieldEditorProtocol
import ru.genesis.calendar.data.UiPreferences
import java.io.File

class SharedTaskFieldListUiTest {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    private var dark by mutableStateOf(false)
    private var language by mutableStateOf("ru")
    private var filters by mutableStateOf(false)
    private val fields = listOf("number", "checkbox", "select", "text", "date", "multi", "url").mapIndexed { index, type ->
        CustomFieldEditorProtocol.newEdit("space", "project").getJSONObject("draft").apply {
            put("id", type); put("spaceId", "space"); put("projectId", "project"); put("type", type)
            put("title", listOf("Оценка", "Согласовано", "Следующий этап", "Заметка", "Дата проверки", "Направления", "Материалы")[index])
            put("showList", true); put("position", index); put("revision", 1); put("predecessorId", JSONObject.NULL)
            put("options", if (type in setOf("select", "multi")) JSONArray().put(JSONObject().put("id", "old").put("title", "Архивный выбор остаётся читаемым").put("archived", true)) else JSONArray())
        }
    }
    private val status = JSONObject().put("id", "todo").put("title", "К выполнению").put("isDone", 0)
    private val task = JSONObject().put("id", "task").put("projectId", "project").put("spaceId", "space").put("statusId", "todo")
        .put("title", "Подготовить следующий этап проекта").put("customFields", JSONObject().put("number", 0).put("checkbox", false)
            .put("select", "old").put("text", "Не задано").put("date", "2026-10-21").put("multi", JSONArray().put("old")).put("url", "https://example.invalid/materials"))

    @Composable private fun Content() {
        CompositionLocalProvider(LocalGenesisLanguage provides language, LocalEveningTheme provides dark, LocalGenesisUserId provides "field-list-qa") {
            MaterialTheme(colorScheme = if (dark) evening else standart) { Surface(Modifier.fillMaxSize()) {
                val query = rememberSharedTaskFieldQuery("project", UiPreferences())
                Column(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing).verticalScroll(rememberScrollState()).padding(16.dp).testTag("field-list-screen"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("Список задач", style = MaterialTheme.typography.headlineSmall)
                    AffairsSearchField("", {}, "Поиск задач", Modifier.testTag("shared-task-search"))
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        SharedTaskFieldSort(TaskListSort.DEFAULT, {}, query, fields, Modifier.weight(1f))
                        AffairsIconButton("Фильтры", AffairsAction.FILTER, { filters = true }, Modifier.testTag("shared-filters"))
                    }
                    SharedTaskFieldCriteria(query.criteria, fields, query.calendar) { query.remove(it) }
                    SharedTaskCard(task, listOf(status), false, false, language == "en", ru.genesis.calendar.domain.CalendarMode.PROFANE, null, null, {}, {},
                        customFields = fields)
                }
                if (filters) SharedTaskListFilterDialog("", "any", "", -1, listOf(status), emptyList(), query, fields,
                    { filters = false }, { _, _, _, _ -> filters = false })
            } }
        }
    }
    private fun chooseFalse() {
        compose.onNodeWithTag("shared-filters").performClick()
        compose.onNode(hasText(genesisTestTranslate("Пользовательские поля")) and hasClickAction()).performScrollTo().performClick()
        compose.onNodeWithTag("field-filter-choice").performScrollTo().performClick()
        compose.onNodeWithTag("field-filter-choice-checkbox").performClick()
        compose.onNodeWithTag("shared-custom-checkbox-false").performScrollTo().performClick()
    }
    private fun genesisTestTranslate(value: String): String = translateGenesisText(compose.activity, value, language)
    @Test fun displayKeepsZeroFalseAndUserTextWhileFilteringSurvivesRecreation() {
        val restoration = StateRestorationTester(compose); restoration.setContent { Content() }
        compose.onNodeWithTag("task-list-field-number", useUnmergedTree = true).assertTextContains("Оценка: 0")
        compose.onNodeWithTag("task-list-field-checkbox", useUnmergedTree = true).assertTextContains("Согласовано: Нет")
        compose.onNodeWithTag("task-list-field-select", useUnmergedTree = true).assertTextContains("Архивный выбор остаётся читаемым", substring = true)
        chooseFalse(); compose.onNodeWithTag("field-filter-add").performScrollTo().assertIsEnabled().performClick()
        compose.onNodeWithTag("affairs-apply-filters").performClick()
        compose.onNodeWithTag("field-criterion-0").assertExists()
        restoration.emulateSavedInstanceStateRestore(); compose.onNodeWithTag("field-criterion-0").assertExists()
        compose.onNodeWithTag("field-criterion-remove-0").performScrollTo().performClick(); compose.onNodeWithTag("field-criterion-0").assertDoesNotExist()
        compose.runOnIdle { language = "en" }
        compose.onNodeWithTag("task-list-field-text", useUnmergedTree = true).assertTextContains("Заметка: Не задано")
        compose.onNodeWithTag("task-list-field-checkbox", useUnmergedTree = true).assertTextContains("Согласовано: No")
    }
    @Test fun sortUsesAnExactCustomDirectionAndMultiNeverAppearsAsASortChoice() {
        compose.setContent { Content() }; compose.onNodeWithTag("shared-field-sort").performClick()
        compose.onNodeWithTag("field-sort-number-desc").performScrollTo().performClick()
        compose.onNodeWithText("Оценка · По убыванию").assertExists()
        compose.onNodeWithTag("shared-field-sort").performClick()
        compose.onNodeWithTag("field-sort-multi-asc").assertDoesNotExist()
    }
    private fun screenshot(name: String) {
        compose.waitForIdle()
        val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        val bytes = ParcelFileDescriptor.AutoCloseInputStream(automation.executeShellCommand("screencap -p")).use { it.readBytes() }
        val bitmap = requireNotNull(BitmapFactory.decodeByteArray(bytes, 0, bytes.size))
        try {
            val activity = compose.activity
            val root = compose.onNodeWithTag("field-list-screen").fetchSemanticsNode().boundsInWindow
            val metrics = JSONObject().put("capture", "screencap-physical-display").put("imageWidth", bitmap.width).put("imageHeight", bitmap.height)
                .put("screenWidthDp", activity.resources.configuration.screenWidthDp).put("fontScale", activity.resources.configuration.fontScale)
                .put("root", JSONArray(listOf(root.left, root.top, root.right, root.bottom)))
            File(activity.filesDir, "$name.png").writeBytes(bytes); File(activity.filesDir, "$name.metrics.json").writeText(metrics.toString())
        } finally { bitmap.recycle() }
    }
    @Test fun captureFieldList() {
        val args = InstrumentationRegistry.getArguments()
        assumeTrue(args.getString("genesisFieldListCapture") == "true")
        compose.setContent { Content() }
        val width = args.getString("genesisFieldWidth") ?: "390"
        val languages = if (args.getString("genesisFieldLanguages") == "true") listOf("ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja") else listOf("ru")
        for (locale in languages) for (night in listOf(false, true)) {
            compose.runOnIdle { language = locale; dark = night; filters = false }; compose.waitForIdle()
            screenshot("list-$width-$locale-${if (night) "dark" else "light"}-tasks")
            chooseFalse(); compose.onNodeWithTag("field-filter-add").performScrollTo(); compose.waitForIdle()
            screenshot("list-$width-$locale-${if (night) "dark" else "light"}-filters")
        }
    }
}
