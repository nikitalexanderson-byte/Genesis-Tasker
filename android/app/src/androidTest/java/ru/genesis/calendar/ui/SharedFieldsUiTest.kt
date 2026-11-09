package ru.genesis.calendar.ui

import android.graphics.BitmapFactory
import android.os.ParcelFileDescriptor
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.auth.*
import java.io.File

class SharedFieldsUiTest {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    private val fixture = FieldEditorHttpsFixture()
    private val ids = mutableMapOf<String, String>()
    private var dark by mutableStateOf(false); private var language by mutableStateOf("ru"); private var epoch by mutableIntStateOf(0)
    @Before fun setup() {
        fixture.open()
        for (type in CustomFieldProtocol.types) {
            val edit = CustomFieldEditorProtocol.newEdit(fixture.space, fixture.project).apply {
                getJSONObject("draft").put("title", if (type == "select") "Этап проекта — следующий шаг" else "План • $type").put("type", type)
                    .put("options", if (type in setOf("select", "multi")) JSONArray().put(JSONObject().put("id", "first").put("title", "Согласовать следующий этап").put("archived", false)) else JSONArray())
            }
            val service = fixture.service(); val saved = service.save(fixture.project, null, edit); val preview = service.preview(fixture.project, saved.getString("stamp"))
            val pending = service.prepare(fixture.project, preview.getString("stamp")); val received = service.send(fixture.project, pending.getString("stamp"))
            ids[type] = received.getJSONObject("receipt").getJSONObject("field").getString("id"); service.remove(fixture.project, received.getString("stamp"))
        }
        fixture.bodies.clear()
    }
    @After fun cleanup() {
        try {
            runCatching { File(fixture.base.app.filesDir, "fields-last-semantics.txt").writeText(compose.onAllNodes(isRoot()).printToString()) }
        } finally { fixture.close() }
    }
    @Composable private fun Content() { key(epoch, language) {
        CompositionLocalProvider(LocalGenesisLanguage provides language, LocalGenesisUserId provides fixture.actor, LocalEveningTheme provides dark) {
            MaterialTheme(colorScheme = if (dark) evening else standart) { Surface(Modifier.fillMaxSize()) {
                SharedFieldsScreen(fixture.gateway, fixture.space, fixture.project, {}, {}, {})
            } }
        }
    } }
    private fun await(tag: String) {
        compose.waitUntil(30_000) { compose.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty() }
        compose.waitUntil(30_000) { compose.onAllNodesWithTag("field-progress").fetchSemanticsNodes().isEmpty() }
        compose.waitForIdle()
    }
    private fun click(tag: String) {
        val node = compose.onNodeWithTag(tag)
        if (tag !in setOf("field-preview", "field-save", "field-retry", "field-done", "field-back", "field-refresh", "field-close")) node.performScrollTo()
        node.performClick()
        compose.waitUntil(30_000) { compose.onAllNodesWithTag("field-progress").fetchSemanticsNodes().isEmpty() }
    }
    private fun select(type: String) {
        val tag = "field-row-${ids.getValue(type)}"
        while (compose.onAllNodesWithTag(tag).fetchSemanticsNodes().isEmpty()) click("field-more")
        click(tag); await("field-title")
    }
    @Test fun creationPreviewLostReplyAndRecreationUseTheSameNativePut() {
        val restoration = StateRestorationTester(compose); restoration.setContent { Content() }; await("field-add")
        click("field-add"); await("field-title")
        compose.onNodeWithTag("field-title").performScrollTo().performTextInput("Сохранить мои варианты")
        click("field-type"); compose.onNodeWithTag("field-type-select").performClick(); click("field-option-add")
        compose.onNodeWithTag("field-option-0").performScrollTo().performTextInput("Первый вариант")
        click("field-showList"); compose.onNodeWithTag("field-showList").assertIsOn()
        compose.waitUntil(15_000) { !compose.onNodeWithTag("field-preview").fetchSemanticsNode().config.contains(androidx.compose.ui.semantics.SemanticsProperties.Disabled) }
        click("field-preview"); await("field-review"); compose.onNodeWithTag("field-save").assertIsEnabled()
        fixture.loseReply = true; click("field-save"); await("field-retry")
        assertEquals(1, fixture.bodies.size)
        restoration.emulateSavedInstanceStateRestore(); await("field-retry"); click("field-retry"); await("field-done")
        assertEquals(2, fixture.bodies.size); assertEquals(fixture.bodies[0], fixture.bodies[1])
        val stored = fixture.base.client.sharedFieldDefinitions(fixture.base.generation, fixture.space, fixture.project, true).getJSONArray("fields")
        assertEquals(8, stored.length()); val created = importRows(stored).single { it.getString("title") == "Сохранить мои варианты" }
        assertEquals("select", created.getString("type")); assertTrue(created.getBoolean("showList")); assertEquals("Первый вариант", created.getJSONArray("options").getJSONObject(0).getString("title"))
    }
    @Test fun actualHistoryRestoresSettingsIntoADraftAndRevocationClearsAllLiveContent() = runBlocking {
        val state = SharedFieldEditorState(fixture.gateway, fixture.actor, fixture.space, fixture.project)
        try {
            state.load(); state.choose(ids.getValue("select")); state.readHistory(); assertEquals(1, state.history.size)
            val historical = state.history.single().getJSONObject("field")
            state.change { it.getJSONObject("draft").put("showList", true) }; state.saveLocal(); state.restore(historical)
            assertFalse(state.edit!!.getJSONObject("draft").getBoolean("showList")); assertTrue(state.edit!!.isNull("review")); assertEquals(1, state.copies.size)
            fixture.forbidden = true; state.refresh()
            assertTrue(state.lost); assertTrue(state.fields.isEmpty()); assertTrue(state.history.isEmpty()); assertTrue(state.copies.isEmpty()); assertNull(state.edit); assertNull(state.record)
        } finally { fixture.forbidden = false; state.close() }
    }
    @Test fun aSuspendedReadCannotRepopulateAPausedOrClosedScreen() = runBlocking {
        val entered = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>()
        val gateway = object : SharedWorkspaceGateway by fixture.gateway {
            override suspend fun sharedProject(projectId: String): JSONObject { entered.complete(Unit); release.await(); return fixture.gateway.sharedProject(projectId) }
        }
        val state = SharedFieldEditorState(gateway, fixture.actor, fixture.space, fixture.project)
        val loading = async(Dispatchers.Default) { runCatching { state.load() } }; entered.await(); state.pause(); release.complete(Unit)
        assertTrue(loading.await().isFailure); assertNull(state.edit); assertTrue(state.fields.isEmpty()); assertFalse(state.loaded); state.close()
    }
    private fun screenshot(name: String) {
        compose.waitForIdle()
        val pipe = InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p")
        val pixels = ParcelFileDescriptor.AutoCloseInputStream(pipe).use { it.readBytes() }
        val bitmap = requireNotNull(BitmapFactory.decodeByteArray(pixels, 0, pixels.size))
        try {
            val root = compose.onNodeWithTag("shared-fields-screen").fetchSemanticsNode().boundsInWindow
            val close = compose.onNodeWithTag("field-close").fetchSemanticsNode().boundsInWindow
            val metrics = compose.activity.resources.displayMetrics; val density = metrics.density
            assertTrue("Dialog fits logical display", root.left >= 0 && root.top >= 0 && root.right <= metrics.widthPixels + 1 && root.bottom <= metrics.heightPixels + 1)
            assertTrue("Complete 48dp close target", close.left >= root.left && close.right <= root.right && close.top >= root.top && close.bottom <= root.bottom && close.width >= 48 * density - 1 && close.height >= 48 * density - 1)
            File(fixture.base.app.filesDir, "fields-$name.png").writeBytes(pixels)
            File(fixture.base.app.filesDir, "fields-$name.metrics.json").writeText(JSONObject().put("imageWidth", bitmap.width).put("imageHeight", bitmap.height)
                .put("logicalWidth", metrics.widthPixels).put("logicalHeight", metrics.heightPixels).put("density", density.toDouble())
                .put("root", root.toString()).put("close", close.toString()).put("fontScale", compose.activity.resources.configuration.fontScale.toDouble())
                .put("screenWidthDp", compose.activity.resources.configuration.screenWidthDp).put("capture", "screencap-physical-display").toString())
        } finally { bitmap.recycle() }
    }
    @Test fun optionLimitPreviewKeepsOwnInputAndExplainsTheArchivedChoiceBound() {
        val args = InstrumentationRegistry.getArguments()
        val capture = args.getString("genesisFieldLimitCapture") == "true"
        val languages = if (capture && args.getString("genesisFieldLanguages") == "true") SharedTemplateProtocol.languages else setOf("ru")
        compose.setContent { Content() }
        for (locale in languages) for (night in if (capture) listOf(false, true) else listOf(false)) {
            fixture.service().load(fixture.project)?.let { fixture.service().remove(fixture.project, it.getString("stamp")) }
            val source = ru.genesis.calendar.auth.PlanningLifecycle.rows(fixture.base.client.sharedFieldDefinitions(fixture.base.generation, fixture.space, fixture.project, true).getJSONArray("fields"))
                .single { it.getString("id") == ids.getValue("select") }
            val own = CustomFieldEditorProtocol.newEdit(fixture.space, fixture.project, source).apply { getJSONObject("draft").put("options",
                JSONArray((1..200).map { index -> JSONObject().put("id", "new-$index").put("title", "Вариант $index").put("archived", false) })) }
            fixture.service().save(fixture.project, null, own)
            compose.runOnIdle { language = locale; dark = night; epoch++ }; await("field-preview")
            click("field-preview"); await("field-error")
            assertEquals("editing", fixture.service().load(fixture.project)!!.getString("phase"))
            assertEquals(200, fixture.service().load(fixture.project)!!.getJSONObject("edit").getJSONObject("draft").getJSONArray("options").length())
            assertTrue(fixture.bodies.isEmpty())
            if (capture) screenshot("limits-${args.getString("genesisFieldWidth")}-${locale}-${if (night) "dark" else "light"}")
            else compose.onNodeWithTag("field-error").assertTextEquals("Лимит — 200 вариантов, включая архивные. Для новых вариантов создайте другое поле.")
        }
    }
    @Test fun captureFieldManagement() {
        val args = InstrumentationRegistry.getArguments(); assumeTrue(args.getString("genesisFieldCapture") == "true")
        val width = requireNotNull(args.getString("genesisFieldWidth"))
        val languages = if (args.getString("genesisFieldLanguages") == "true") SharedTemplateProtocol.languages else setOf("ru")
        compose.setContent { Content() }
        for (locale in languages) for (night in listOf(false, true)) {
            fixture.service().load(fixture.project)?.let { fixture.service().remove(fixture.project, it.getString("stamp")) }
            compose.runOnIdle { language = locale; dark = night; epoch++ }; await("field-add")
            val name = "$width-$locale-${if (night) "dark" else "light"}"
            screenshot("$name-library"); select("select"); screenshot("$name-editor")
            click("field-preview"); await("field-review"); compose.onNodeWithTag("field-review").performScrollTo(); screenshot("$name-preview")
            click("field-history"); await("field-history-content"); compose.onNodeWithTag("field-history-content").performScrollTo(); screenshot("$name-history")
        }
    }
}
