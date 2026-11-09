package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.json.JSONArray
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.*
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.captureNativeWindow
import ru.genesis.calendar.auth.*
import ru.genesis.calendar.data.UiPreferences
import java.io.File
import java.util.Collections
import java.util.concurrent.atomic.AtomicInteger

class SharedQueryBulkUiTest {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    private val fixture = QueryBulkHttpsFixture()
    private var epoch by mutableIntStateOf(0)
    private var dark by mutableStateOf(false)
    private var language by mutableStateOf("ru")
    private var incoming: JSONObject? = null
    @Volatile private var traceConfigure = false
    private val inputSequence = AtomicInteger()
    private val inputEvents = Collections.synchronizedList(mutableListOf<JSONObject>())
    private val diagnosticErrors = Collections.synchronizedList(mutableListOf<Throwable>())
    private fun inputEvent(sequence: Int, stage: String, stamp: String?, input: JSONObject, result: String? = null) {
        runCatching {
            inputEvents.add(JSONObject().put("sequence", sequence).put("stage", stage).put("atNanos", System.nanoTime())
                .put("stamp", stamp ?: JSONObject.NULL).put("form", input.optJSONObject("form")?.let { JSONObject(it.toString()) } ?: JSONObject.NULL)
                .put("result", result ?: JSONObject.NULL))
        }.onFailure { diagnosticErrors.add(it) }
    }
    @Before fun open() = fixture.open()
    @After fun close() = fixture.close()
    @Composable private fun Content() { key(epoch) {
        val gateway = remember { object : SharedWorkspaceGateway by fixture.gateway {
            override fun captureSharedBulkInputWriter() = SharedBulkInputWriter { context, stamp, input -> saveSharedBulkInput(context, stamp, input) }
            override suspend fun saveSharedBulkInput(context: String, stamp: String?, input: JSONObject): JSONObject {
                if (!traceConfigure) return fixture.gateway.saveSharedBulkInput(context, stamp, input)
                val sequence = inputSequence.incrementAndGet(); inputEvent(sequence, "started", stamp, input)
                try {
                    return fixture.gateway.saveSharedBulkInput(context, stamp, input).also { saved ->
                        inputEvent(sequence, "returned", saved.optString("stamp"), input, saved.optString("phase"))
                    }
                } catch (failure: Throwable) { inputEvent(sequence, "failed", stamp, input, failure.toString()); throw failure }
            }
        } }
        CompositionLocalProvider(LocalGenesisLanguage provides language, LocalEveningTheme provides dark, LocalGenesisUserId provides fixture.base.actor) {
            MaterialTheme(colorScheme = if (dark) evening else standart) { Surface(Modifier.fillMaxSize()) {
                val origin = incoming ?: fixture.origin()
                SharedBulkScreen(gateway, SharedBulkProtocol.QUERY_SCOPE, origin.getJSONObject("filter"), origin.getString("sort"), UiPreferences(), {}, {}, {}, { _, _ -> }, origin)
            } }
        }
    } }
    private fun await(tag: String) {
        try {
            compose.waitUntil(30_000) { compose.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty() }
            compose.waitUntil(30_000) { compose.onAllNodesWithTag("bulk-working").fetchSemanticsNodes().isEmpty() }
            compose.waitForIdle()
        } catch (failure: Throwable) {
            fun diagnostic(action: () -> Unit) {
                try { action() } catch (diagnosticFailure: Throwable) { failure.addSuppressed(diagnosticFailure) }
            }
            synchronized(diagnosticErrors) { diagnosticErrors.forEach { failure.addSuppressed(it) } }
            diagnostic {
                val proof = JSONObject().put("awaitedTag", tag).put("ownedProjects", JSONArray().put(fixture.base.project).put(fixture.second))
                    .put("failure", failure.stackTraceToString()).put("projectReads", fixture.projectReads).put("sentCount", fixture.sent.size)
                    .put("inputRecord", fixture.service().loadInput(SharedBulkProtocol.QUERY_SCOPE) ?: JSONObject.NULL)
                    .put("commandRecord", fixture.service().load(SharedBulkProtocol.QUERY_SCOPE) ?: JSONObject.NULL)
                    .put("inputEvents", JSONArray(synchronized(inputEvents) { inputEvents.toList() }))
                File(fixture.base.app.filesDir, "query-bulk-failure-$tag.json").writeText(proof.toString(2))
            }
            diagnostic { captureNativeWindow(File(fixture.base.app.filesDir, "query-bulk-failure-$tag.png")) }
            throw failure
        }
    }
    private fun click(tag: String, scroll: Boolean = true) {
        if (scroll && tag !in setOf("bulk-configure", "bulk-preview", "bulk-confirm", "bulk-retry")) compose.onNodeWithTag(tag).performScrollTo()
        compose.onNodeWithTag(tag).performClick()
    }
    private fun configure() { await("bulk-select-all"); click("bulk-select-all"); click("bulk-configure"); await("bulk-kind") }
    private fun kind(kind: String) { click("bulk-kind"); click("bulk-kind-$kind", false) }
    private fun statusMapping() {
        kind("status")
        for (project in listOf(fixture.base.project, fixture.second)) {
            val status = fixture.base.client.sharedProject(fixture.base.generation, project).getJSONArray("statuses").getJSONObject(0).getString("id")
            click("bulk-status-$project"); click("bulk-status-$project-$status", false)
        }
    }
    @Test fun perProjectStatusControlsRequireBothMappingsBeforeAnExplicitPreview() {
        traceConfigure = true
        compose.setContent { Content() }; configure(); kind("status")
        compose.onNodeWithTag("bulk-preview").assertIsNotEnabled()
        for (project in listOf(fixture.base.project, fixture.second)) {
            val status = fixture.base.client.sharedProject(fixture.base.generation, project).getJSONArray("statuses").getJSONObject(0).getString("id")
            click("bulk-status-$project"); click("bulk-status-$project-$status", false)
        }
        compose.onNodeWithTag("bulk-preview").assertIsEnabled(); click("bulk-preview"); await("bulk-confirm")
        assertEquals(1, fixture.sent.size); assertEquals(0, fixture.projectReads)
        assertEquals(2, JSONObject(fixture.sent.single()).getJSONObject("action").getJSONObject("statusIds").length())
        assertEquals("preview", fixture.service().load(SharedBulkProtocol.QUERY_SCOPE)!!.let { fixture.base.client.sharedBulkReport(fixture.base.generation, it.getJSONObject("receipt").getString("operationId"), 0).getString("state") })
    }
    @Test fun queryAssigneeOptionsUseOnlyTheSelectedProjectsAndProduceATypedAction() {
        compose.setContent { Content() }; configure(); kind("assignee"); await("bulk-assignee")
        compose.waitUntil(20_000) { compose.onNodeWithTag("bulk-assignee").fetchSemanticsNode().config.contains(androidx.compose.ui.semantics.SemanticsProperties.Disabled).not() }
        click("bulk-assignee"); click("bulk-assignee-${fixture.base.actor}", false); click("bulk-preview"); await("bulk-confirm")
        assertEquals(fixture.base.actor, JSONObject(fixture.sent.single()).getJSONObject("action").getString("assigneeId"))
        assertEquals(0, fixture.projectReads)
    }
    @Test fun incompleteShiftAndInputCalendarAreDurableBeforeAnyPreview() {
        compose.setContent { Content() }; configure(); kind("due"); click("bulk-due-mode"); click("bulk-due-mode-shift", false)
        compose.onNodeWithTag("bulk-days").performScrollTo().performTextReplacement("-")
        compose.waitUntil(20_000) { fixture.service().loadInput(SharedBulkProtocol.QUERY_SCOPE)?.getJSONObject("edit")?.getJSONObject("form")?.optString("days") == "-" }
        compose.runOnIdle { epoch++ }; await("bulk-select-all"); click("bulk-configure"); await("bulk-days")
        compose.onNodeWithTag("bulk-days").assertTextContains("-"); compose.onNodeWithTag("bulk-preview").assertIsNotEnabled()
        assertTrue(fixture.sent.isEmpty()); assertEquals(0, fixture.projectReads)
    }
    @Test fun unknownPreviewRestoresInANewScreenAndReplaysDespiteANewerTaskQueue() {
        compose.setContent { Content() }; configure(); fixture.loseReply = true; click("bulk-preview"); await("bulk-error")
        assertEquals("pending", fixture.service().load(SharedBulkProtocol.QUERY_SCOPE)!!.getString("phase"))
        fixture.queued = true; incoming = fixture.origin("Другая подборка")
        compose.runOnIdle { epoch++ }; await("bulk-retry"); compose.onNodeWithTag("bulk-retry").assertIsEnabled(); click("bulk-retry")
        await("bulk-confirm"); assertEquals(2, fixture.sent.size); assertEquals(fixture.sent[0], fixture.sent[1]); assertEquals(0, fixture.projectReads)
        click("bulk-confirm"); await("bulk-error"); compose.onNodeWithTag("bulk-error").assertTextEquals("Сначала синхронизируйте изменения задач.")
    }
    @Test fun savedViewResultsOpenTheQueryBulkScreenAndReturnTheOriginalTaskIdentity() {
        val view = fixture.views.save(fixture.views.edit().apply { getJSONObject("definition").put("filter", fixture.origin().getJSONObject("filter")) })
        var opened = ""
        compose.setContent { CompositionLocalProvider(LocalGenesisLanguage provides "ru", LocalGenesisUserId provides fixture.base.actor) {
            MaterialTheme(colorScheme = standart) { SharedSavedViewsScreen(fixture.gateway, listOf(JSONObject().put("id", fixture.base.space).put("title", "Команда").put("role", "owner")), UiPreferences(), {}, { project, task -> opened = "$project:$task" }) }
        } }
        await("saved-view-open-${view.getString("id")}"); click("saved-view-open-${view.getString("id")}"); await("saved-view-bulk"); click("saved-view-bulk")
        configure(); click("bulk-preview"); await("bulk-confirm")
        compose.onNode(hasClickAction() and hasAnyAncestor(hasTestTag("bulk-results"))).performScrollTo().performClick()
        val operation = fixture.service().load(SharedBulkProtocol.QUERY_SCOPE)!!.getJSONObject("receipt").getString("operationId")
        val cursor = fixture.base.client.sharedBulkReport(fixture.base.generation, operation, 0).getJSONArray("items").getJSONObject(0).getLong("cursor")
        click("bulk-open-$cursor"); compose.waitUntil(10_000) { opened.isNotEmpty() }
        assertTrue(fixture.tasks.any { opened == it.getString("projectId") + ":" + it.getString("id") })
    }
    @Test fun captureQueryBulk() {
        val args = InstrumentationRegistry.getArguments(); org.junit.Assume.assumeTrue(args.getString("genesisQueryBulkCapture") == "true")
        val languages = if (args.getString("genesisQueryBulkLocales") == "true") SharedTemplateProtocol.languages else setOf("ru")
        compose.setContent { Content() }
        fun screenshot(name: String) {
            compose.waitForIdle(); val instrumentation = InstrumentationRegistry.getInstrumentation()
            instrumentation.uiAutomation.waitForIdle(350, 5000)
            val file = File(instrumentation.targetContext.filesDir, "query-bulk-${args.getString("genesisQueryBulkWidth")}-${language}-${if (dark) "dark" else "light"}-$name.png")
            assertTrue(androidx.test.uiautomator.UiDevice.getInstance(instrumentation).takeScreenshot(file))
        }
        for (locale in languages) for (night in listOf(false, true)) {
            fixture.service().load(SharedBulkProtocol.QUERY_SCOPE)?.let { fixture.service().remove(SharedBulkProtocol.QUERY_SCOPE, it.getString("stamp")) }
            fixture.service().loadInput(SharedBulkProtocol.QUERY_SCOPE)?.let { fixture.service().removeInput(SharedBulkProtocol.QUERY_SCOPE, it.getString("stamp")) }
            compose.runOnIdle { language = locale; dark = night; epoch++ }
            await("bulk-select-all"); if (languages.size == 1) screenshot("selection")
            configure(); statusMapping(); screenshot("status")
            if (languages.size == 1) { click("bulk-preview"); await("bulk-confirm"); screenshot("preview") }
        }
    }
}
