package ru.genesis.calendar.ui

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.os.Environment
import androidx.activity.compose.LocalActivityResultRegistryOwner
import androidx.activity.result.ActivityResultRegistry
import androidx.activity.result.ActivityResultRegistryOwner
import androidx.activity.result.contract.ActivityResultContract
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.app.ActivityOptionsCompat
import androidx.core.content.FileProvider
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.text.TextLayoutResult
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import kotlinx.coroutines.CompletableDeferred
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.auth.*
import java.io.File
import java.io.InputStream
import java.util.UUID

private const val importUiSpace = "11111111-1111-4111-8111-111111111111"
private const val importUiProject = "22222222-2222-4222-8222-222222222222"

private class ImportPickerRegistry : ActivityResultRegistry(), ActivityResultRegistryOwner {
    override val activityResultRegistry: ActivityResultRegistry get() = this
    var requestCode = 0
    override fun <I, O> onLaunch(requestCode: Int, contract: ActivityResultContract<I, O>, input: I, options: ActivityOptionsCompat?) {
        assertTrue(contract is ActivityResultContracts.OpenDocument)
        val intent = contract.createIntent(InstrumentationRegistry.getInstrumentation().targetContext, input)
        assertEquals(Intent.ACTION_OPEN_DOCUMENT, intent.action); assertEquals("*/*", intent.type)
        assertArrayEquals(arrayOf("*/*"), intent.getStringArrayExtra(Intent.EXTRA_MIME_TYPES)); this.requestCode = requestCode
    }
}

/** Synthetic transport only; encryption, CAS and replay are exercised by the service/storage tests. */
private class ImportUiFixture : SharedWorkspaceGateway {
    @Volatile var record: JSONObject? = null
    @Volatile var choices = 0; @Volatile var previews = 0; @Volatile var sends = 0; @Volatile var saves = 0
    var picker: ((DataImportPickedSource?) -> Unit)? = null
    var saveGate: CompletableDeferred<Unit>? = null
    var loseReply = false; var canApply = true; var richCatalogs = false; var chosenBytes: ByteArray? = null
    private val operation = UUID.randomUUID().toString()
    private var outcomes = emptyList<JSONObject>()
    fun seeded(format: String = "json", existingProject: Boolean = false): ImportUiFixture {
        val selection = importInitialSelection(importUiSpace, importUiProject.takeIf { existingProject }, "Импорт команды", "К выполнению", "Готово", "profane", "Europe/Moscow", false).put("format", format)
        record = next(selection); return this
    }
    private fun next(selection: JSONObject) = JSONObject().put("stamp", UUID.randomUUID().toString()).put("phase", "editing").put("attempts", 0).put("receipt", JSONObject.NULL)
        .put("edit", JSONObject().put("kind", "data-import").put("selection", JSONObject(selection.toString())).put("review", JSONObject.NULL)
            .put("source", JSONObject().put("id", UUID.randomUUID().toString()).put("name", "Командный план.${if (selection.getString("format") == "csv") "csv" else "json"}").put("bytes", 29).put("sha256", "b".repeat(64))))
    override suspend fun sharedDataImportDraft(spaceId: String, projectId: String) = record?.let { JSONObject(it.toString()) }
    override suspend fun sharedDataImportHeaders(spaceId: String, projectId: String, stamp: String, delimiter: String) = listOf("Название", "Описание", "Дата", "Приоритет", "Участник", "Статус")
    override suspend fun chooseSharedDataImportSource(spaceId: String, projectId: String, stamp: String?, name: String, selection: JSONObject, open: () -> InputStream): JSONObject {
        chosenBytes = open().use { it.readBytes() }; DataImportProtocol.selection(selection); choices++
        return next(selection).also { it.getJSONObject("edit").getJSONObject("source").put("name", name); record = it }
    }
    override suspend fun saveSharedDataImportDraft(spaceId: String, projectId: String, stamp: String?, edit: JSONObject): JSONObject {
        saves++; val frozen = DataImportProtocol.edit(edit); saveGate?.await()
        require(record?.getString("stamp") == stamp) { "PLANNING_DRAFT_CHANGED" }
        return JSONObject(record!!.toString()).put("stamp", UUID.randomUUID().toString()).put("edit", frozen).also { record = it }
    }
    fun preview(): JSONObject {
        val counts = JSONObject().put("projects", 1).put("tasks", 1200)
        for (key in listOf("comments", "history", "attachments", "series", "templates")) counts.put(key, 0)
        val data = JSONObject().put("format", "genesis.shared-data").put("version", 1).put("calendarMode", "profane")
            .put("calendarContext", JSONObject().put("version", 2).put("timeZone", "Europe/Moscow").put("gregorianYearStart", "january"))
            .put("projects", JSONArray().put(JSONObject().put("key", "root").put("title", "Проект команды").put("parentKey", JSONObject.NULL).put("statuses", JSONArray()
                .put(JSONObject().put("key", "open").put("title", "К выполнению").put("isDone", false))
                .put(JSONObject().put("key", "done").put("title", "Готово").put("isDone", true)))))
            .put("tasks", JSONArray((1..100).map { JSONObject().put("key", "task-$it").put("title", "Задача $it").put("projectKey", "root").put("dueDate", JSONObject.NULL) }))
            .put("members", JSONArray()).put("fields", JSONArray()).put("labels", JSONArray())
        val value = JSONObject().put("previewVersion", 1).put("sampleLimit", 100).put("fingerprint", "a".repeat(64)).put("canApply", canApply)
            .put("projectCount", 1).put("taskCount", 1200).put("sourceCounts", counts).put("data", data).put("notices", JSONArray())
            .put("blockers", if (canApply) JSONArray() else JSONArray().put(JSONObject().put("code", "DATA_APPLY_BLOCKED").put("field", "root")))
        for (key in listOf("memberMap", "statusMap", "labelMap", "fieldMap", "optionMap", "issueTitles")) value.put(key, JSONObject())
        for (key in listOf("destinationMembers", "destinationStatuses", "destinationLabels", "destinationFields")) value.put(key, JSONArray())
        value.getJSONObject("statusMap").put("open", "current-open").put("done", "current-done")
        value.getJSONArray("destinationStatuses").put(JSONObject().put("id", "current-open").put("title", "В работе").put("isDone", 0))
            .put(JSONObject().put("id", "current-done").put("title", "Завершено").put("isDone", 1))
        if (richCatalogs) {
            data.getJSONArray("members").put(JSONObject().put("key", "former").put("title", "Прежний участник"))
            value.getJSONObject("memberMap").put("former", JSONObject.NULL)
            for (index in 1..75) value.getJSONArray("destinationMembers").put(JSONObject().put("id", "member-$index").put("title", "Участник $index"))
            fun field(id: String, title: String, type: String, source: Boolean = false) = JSONObject()
                .put(if (source) "key" else "id", id).put("title", title).put("type", type).put("required", true).put("archived", false)
                .put("projectKey", JSONObject.NULL).put("options", if (type in setOf("select", "multi")) JSONArray()
                    .put(JSONObject().put("id", "blue").put("title", "Синий").put("archived", false)) else JSONArray())
            data.getJSONArray("fields").put(field("source-choice", "Исходная категория", "select", true))
            value.getJSONObject("fieldMap").put("source-choice", "choice")
            value.getJSONObject("optionMap").put("source-choice", JSONObject().put("blue", JSONObject.NULL))
            value.getJSONArray("destinationFields").put(field("effort:legacy_1", "Оценка", "number"))
                .put(field("approved", "Подтверждено", "checkbox")).put(field("due-date", "Срок", "date"))
                .put(field("choice", "Категория", "select")).put(field("tags", "Темы", "multi"))
        }
        return value
    }
    override suspend fun inspectSharedDataImport(spaceId: String, projectId: String, stamp: String): JSONObject {
        previews++; val preview = DataImportProtocol.preview(preview()); val updated = JSONObject(record!!.toString()).put("stamp", UUID.randomUUID().toString())
        updated.getJSONObject("edit").put("review", DataImportProtocol.review(preview)); record = updated
        return JSONObject().put("record", updated).put("preview", preview)
    }
    override suspend fun prepareSharedDataImport(spaceId: String, projectId: String, stamp: String): JSONObject =
        JSONObject(record!!.toString()).put("stamp", UUID.randomUUID().toString()).put("phase", "pending").put("command", operation).also { record = it }
    private fun receipt() = JSONObject().put("importId", "33333333-3333-4333-8333-333333333333").put("spaceId", importUiSpace).put("rootProjectId", importUiProject)
        .put("operationId", operation).put("projectCount", 1).put("taskCount", 1200).put("state", "active").put("canUndo", true).put("duplicate", false)
        .put("notices", JSONArray()).put("createdAt", "2026-10-20T00:00:00Z")
    override suspend fun sendSharedDataImport(spaceId: String, projectId: String, stamp: String): JSONObject {
        sends++; record = JSONObject(record!!.toString()).put("stamp", UUID.randomUUID().toString()).put("attempts", sends)
        if (loseReply) { loseReply = false; throw AuthFailure(AuthFailure.Kind.NETWORK) }
        return JSONObject(record!!.toString()).put("phase", "received").put("receipt", receipt()).also { record = it }
    }
    override suspend fun sharedDataImports(spaceId: String, cursor: String?) = JSONObject().put("imports", JSONArray().put(receipt())).put("nextCursor", JSONObject.NULL)
    override suspend fun sharedDataUndoOutcomes(spaceId: String) = outcomes
    override suspend fun undoSharedDataImport(spaceId: String, receipt: JSONObject): JSONObject {
        outcomes = listOf(JSONObject(receipt.toString()).put("state", "undone").put("canUndo", false))
        return JSONObject().put("importId", receipt.getString("importId")).put("state", "undone")
    }
}

class SharedDataImportUiTest {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    private var fixture by mutableStateOf<ImportUiFixture?>(null)
    private var epoch by mutableIntStateOf(0); private var dark by mutableStateOf(false); private var language by mutableStateOf("ru")
    private var installed = false; private var closed = false
    private fun show(value: ImportUiFixture) {
        if (!installed) {
            compose.setContent { fixture?.let { current -> key(epoch) {
                CompositionLocalProvider(LocalGenesisUserId provides "import-ui-account", LocalGenesisLanguage provides language, LocalEveningTheme provides dark) {
                    MaterialTheme(colorScheme = if (dark) evening else standart) {
                        Surface(Modifier.fillMaxSize().testTag("import-test-window")) {
                            SharedDataImportScreen(current, importUiSpace, importUiProject, "Проект команды · план работы", true, true,
                                { closed = true }, {}, {}, picker = { callback -> current.picker = callback })
                        }
                    }
                }
            } } }; installed = true
        }
        compose.runOnIdle { fixture = value; epoch++; closed = false }
        compose.waitUntil(10000) { runCatching { compose.onNodeWithTag("import-choose").assertIsEnabled() }.isSuccess }
    }
    private fun click(tag: String) {
        val node = compose.onNodeWithTag(tag, useUnmergedTree = true)
        if (runCatching { node.assertIsDisplayed() }.isFailure) node.performScrollTo()
        node.performClick(); compose.waitForIdle()
    }
    private fun awaitTag(tag: String) = compose.waitUntil(10000) { compose.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty() }
    @Test fun cancellingThePickerKeepsTheSourceAndMakesNoPreviewOrApply() {
        val f = ImportUiFixture().seeded(); show(f); click("import-choose")
        compose.runOnIdle { f.picker!!(null) }; compose.waitForIdle()
        assertEquals(0, f.choices); assertEquals(0, f.previews); assertEquals(0, f.sends)
        compose.onNodeWithTag("import-filename").assertTextEquals("Командный план.json")
        compose.onNodeWithTag("import-choose").assertIsEnabled()
    }
    @Test fun previewShowsTheFullCountAndRevealsTheSampleFiveAtATime() {
        val f = ImportUiFixture().seeded(); show(f); click("import-primary"); awaitTag("import-counts")
        compose.onNodeWithTag("import-counts").assertTextContains("1200", substring = true)
        click("import-task-sample"); compose.onNodeWithText("Задача 5").assertExists(); compose.onNodeWithText("Задача 6").assertDoesNotExist()
        click("import-task-sample-more"); compose.onNodeWithText("Задача 10").assertExists(); compose.onNodeWithText("Задача 11").assertDoesNotExist()
        assertEquals(0, f.sends); click("import-primary"); awaitTag("import-received"); assertEquals(1, f.sends)
        click("import-undo"); compose.onNodeWithText("Подтвердить отмену").performClick(); compose.waitForIdle()
        compose.onNodeWithTag("import-received").assertTextEquals("Импорт отменён.")
    }
    @Test fun typingDuringQuietAutosaveKeepsFocusAndTheNewerText() {
        val f = ImportUiFixture().seeded("csv"); show(f); click("import-file-settings")
        val field = compose.onNodeWithTag("import-title"); field.performScrollTo(); field.performClick()
        val gate = CompletableDeferred<Unit>(); compose.runOnIdle { f.saveGate = gate }
        field.performTextReplacement("Первое значение")
        compose.waitUntil(10000) { f.saves > 0 }; field.assertIsFocused(); field.assertIsEnabled(); field.performTextReplacement("Новое значение")
        compose.runOnIdle { gate.complete(Unit); f.saveGate = null }
        compose.waitUntil(10000) { f.record!!.getJSONObject("edit").getJSONObject("selection").getJSONObject("parse").getString("title") == "Новое значение" }
        field.assertTextContains("Новое значение"); field.assertIsFocused()
    }
    @Test fun aLostReplyDisablesEditingUntilTheSameCommandIsRetried() {
        val f = ImportUiFixture().seeded(); f.loseReply = true; show(f); click("import-primary"); awaitTag("import-counts")
        click("import-primary"); awaitTag("import-pending"); val identity = f.record!!.getString("command")
        compose.onNodeWithTag("import-choose").assertIsNotEnabled(); assertEquals(1, f.sends)
        click("import-primary"); awaitTag("import-received"); assertEquals(2, f.sends); assertEquals(identity, f.record!!.getString("command"))
    }
    @Test fun mappingCatalogsSupportSearchPagingStatusCompatibilityAndOptionReset() {
        val f = ImportUiFixture().seeded(existingProject = true).also { it.richCatalogs = true }
        show(f); click("import-primary"); awaitTag("import-counts"); click("import-mapping"); click("import-members")
        click("import-member-former")
        compose.onNodeWithTag("import-member-former-member-60").assertDoesNotExist()
        click("import-member-former-more")
        compose.onNodeWithTag("import-member-former-member-60").assertExists()
        compose.onNodeWithTag("import-member-former-search").performTextReplacement("Участник 75")
        click("import-member-former-member-75"); click("import-statuses"); click("import-status-done")
        compose.onNodeWithTag("import-status-done-current-open").assertDoesNotExist()
        click("import-status-done-current-done"); click("import-fields"); click("import-options-source-choice")
        click("import-option-source-choice-blue"); click("import-option-source-choice-blue-blue")
        compose.waitUntil(10000) { f.record!!.getJSONObject("edit").getJSONObject("selection").getJSONObject("optionMap").optJSONObject("source-choice")?.opt("blue") == "blue" }
        click("import-field-source-choice"); click("import-field-source-choice-new")
        compose.waitUntil(10000) { !f.record!!.getJSONObject("edit").getJSONObject("selection").getJSONObject("optionMap").has("source-choice") }
        val selection = f.record!!.getJSONObject("edit").getJSONObject("selection")
        assertEquals("member-75", selection.getJSONObject("memberMap").getString("former"))
        assertEquals("current-done", selection.getJSONObject("statusMap").getString("done"))
        assertEquals("new", selection.getJSONObject("fieldMap").getString("source-choice")); assertEquals(0, f.sends)
    }
    @Test fun requiredTypedDefaultsKeepZeroFalseDatesSelectAndMultiValues() {
        val f = ImportUiFixture().seeded(existingProject = true).also {
            it.richCatalogs = true
            it.record!!.getJSONObject("edit").getJSONObject("selection").getJSONObject("fieldDefaults")
                .put("due-date", "2026-10-19").put("tags", JSONArray().put("archived-choice"))
        }
        show(f); click("import-primary"); awaitTag("import-counts"); click("import-mapping"); click("import-required")
        compose.onNodeWithTag("import-default-effort:legacy_1").performScrollTo().performTextReplacement("0")
        click("import-default-approved"); click("import-default-approved-false")
        click("import-default-due-date")
        compose.waitUntil(5000) { compose.onAllNodesWithText("20", useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("20", useUnmergedTree = true).performScrollTo().performClick()
        click("import-default-choice"); click("import-default-choice-blue")
        click("import-default-tags-clear"); click("import-default-tags"); click("import-default-tags-blue")
        compose.onNodeWithTag("import-default-tags-blue").assertIsOn()
        compose.waitUntil(10000) {
            f.record!!.getJSONObject("edit").getJSONObject("selection").getJSONObject("fieldDefaults").optJSONArray("tags")
                ?.let { it.length() == 1 && it.optString(0) == "blue" } == true
        }
        val defaults = f.record!!.getJSONObject("edit").getJSONObject("selection").getJSONObject("fieldDefaults")
        assertEquals(0.0, defaults.getDouble("effort:legacy_1"), 0.0); assertFalse(defaults.getBoolean("approved"))
        assertEquals("2026-10-20", defaults.getString("due-date")); assertEquals("blue", defaults.getString("choice"))
        assertEquals("blue", defaults.getJSONArray("tags").getString(0)); assertEquals(0, f.sends)
    }
    @Test fun restoredOpenDocumentReadsAProviderUriWithTheFrozenSelection() {
        val restoration = StateRestorationTester(compose)
        val backing = ImportUiFixture().seeded("csv", existingProject = true)
        backing.record!!.getJSONObject("edit").getJSONObject("selection").getJSONObject("parse").apply {
            put("title", "Восстановленный импорт"); put("columns", JSONObject().put("title", 0))
            getJSONObject("calendarContext").put("timeZone", "America/New_York").put("gregorianYearStart", "march")
        }
        var registry = ImportPickerRegistry(); val controllers = mutableListOf<SharedWorkspaceGateway>()
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val input = File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "restored-import-${UUID.randomUUID()}.csv")
        val bytes = "Название,Описание\r\n\"Проверка 🌙\",\"первая\nвторая\"\r\n".toByteArray(Charsets.UTF_8)
        input.parentFile!!.mkdirs(); input.writeBytes(bytes)
        try {
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.updates", input)
            restoration.setContent {
                val controller = remember { object : SharedWorkspaceGateway by backing {}.also { controllers.add(it) } }
                CompositionLocalProvider(LocalGenesisUserId provides "import-ui-account", LocalGenesisLanguage provides "ru",
                    LocalActivityResultRegistryOwner provides registry) {
                    MaterialTheme(colorScheme = standart) {
                        SharedDataImportScreen(controller, importUiSpace, importUiProject, "Проект команды", true, true, {}, {}, {})
                    }
                }
            }
            compose.waitUntil(10000) { runCatching { compose.onNodeWithTag("import-choose").assertIsEnabled() }.isSuccess }
            click("import-choose"); val request = registry.requestCode; assertNotEquals(0, request)
            val savedRegistry = Bundle(); compose.runOnIdle { registry.onSaveInstanceState(savedRegistry) }
            registry = ImportPickerRegistry().apply { onRestoreInstanceState(savedRegistry) }
            restoration.emulateSavedInstanceStateRestore(); compose.waitForIdle()
            assertEquals(2, controllers.size); assertNotSame(controllers.first(), controllers.last())
            compose.onNodeWithTag("import-choose").assertIsNotEnabled()
            compose.runOnIdle { assertTrue(registry.dispatchResult(request, Activity.RESULT_OK, Intent().setData(uri))) }
            compose.waitUntil(10000) { backing.choices == 1 }
            compose.onNodeWithTag("import-choose").assertIsEnabled()
            compose.onNodeWithTag("import-filename").assertTextEquals(input.name)
            assertArrayEquals(bytes, backing.chosenBytes); assertEquals(0, backing.previews); assertEquals(0, backing.sends)
            val selection = backing.record!!.getJSONObject("edit").getJSONObject("selection")
            assertEquals("csv", selection.getString("format")); assertEquals(importUiProject, selection.getString("projectId"))
            val parse = selection.getJSONObject("parse"); assertEquals("Восстановленный импорт", parse.getString("title"))
            assertEquals(0, parse.getJSONObject("columns").getInt("title"))
            assertEquals("America/New_York", parse.getJSONObject("calendarContext").getString("timeZone"))
            assertEquals("march", parse.getJSONObject("calendarContext").getString("gregorianYearStart"))
        } finally { input.delete() }
    }
    @Test fun captureImport() {
        val args = InstrumentationRegistry.getArguments(); assumeTrue(args.getString("genesisImportCapture") == "true")
        val all = args.getString("genesisImportLanguages") == "true"
        val languages = if (all) listOf("ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja") else listOf("ru")
        val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()); val rotate = args.getString("genesisImportRotateLeft") == "true"
        if (rotate) device.setOrientationLeft()
        fun capture(name: String) {
            compose.waitForIdle()
            val layouts = mutableListOf<TextLayoutResult>()
            compose.onNodeWithTag("import-heading").performSemanticsAction(SemanticsActions.GetTextLayoutResult) { assertTrue(it(layouts)) }
            val density = layouts.single().layoutInput.density
            val viewport = compose.onNodeWithTag("import-test-window").fetchSemanticsNode().boundsInRoot.width / density.density
            val expected = args.getString("genesisImportWidth")!!.toFloat()
            assertTrue("Import viewport $viewport does not match $expected", kotlin.math.abs(viewport - expected) <= 1)
            assertEquals(args.getString("genesisImportFontScale")!!.toFloat(), density.fontScale, .01f)
            val phase = args.getString("genesisImportPhase") ?: "initial"
            val file = File(InstrumentationRegistry.getInstrumentation().targetContext.filesDir, "import-$phase-${args.getString("genesisImportWidth")}-${if (dark) "dark" else "light"}-$language-$name.png")
            assertTrue(device.takeScreenshot(file))
            println("QA import width=$viewport font=${density.fontScale} language=$language state=$name")
        }
        try {
            for (locale in languages) for (night in listOf(false, true)) {
                compose.runOnIdle { language = locale; dark = night }
                val f = ImportUiFixture().seeded(); show(f); capture("form")
                if (!all) {
                    click("import-primary"); awaitTag("import-counts"); capture("preview")
                    click("import-task-sample"); capture("sample")
                    f.loseReply = true; click("import-primary"); awaitTag("import-pending"); capture("pending")
                    click("import-primary"); awaitTag("import-received"); capture("received")
                    click("import-history-toggle"); compose.waitForIdle(); capture("history")
                }
            }
        } finally { if (rotate) device.setOrientationNatural() }
    }
}
