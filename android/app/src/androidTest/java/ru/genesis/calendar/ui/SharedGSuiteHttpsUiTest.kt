package ru.genesis.calendar.ui

import android.os.ParcelFileDescriptor
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.auth.*
import java.io.File
import java.time.LocalDate
import java.util.UUID

/** Normal parent screen, real AuthController/Keystore/TLS and actual server events. */
class SharedGSuiteHttpsUiTest {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    private val fixture = TemplateHttpsFixture()
    private lateinit var controller: AuthController
    private lateinit var task: JSONObject
    private fun id() = UUID.randomUUID().toString()
    private fun rows(array: JSONArray) = (0 until array.length()).map(array::getJSONObject)
    @Before fun open() {
        fixture.open()
        controller = AuthController.get(fixture.app)
        runBlocking {
            withContext(Dispatchers.Main) { controller.checkSession() }
            withTimeout(60_000) { controller.state.first { !it.busy && it.ready && !it.requiresSignIn && it.user?.uid == fixture.actor } }
        }
        val status = fixture.client.sharedProject(fixture.generation, fixture.project).getJSONArray("statuses").getJSONObject(0).getString("id")
        task = fixture.client.createSharedTask(fixture.generation, fixture.project, JSONObject().put("title", "G actual backlog source")
            .put("statusId", status)).getJSONObject("task")
    }
    @After fun close() = fixture.close()
    private fun await(tag: String) = compose.waitUntil(30_000) { compose.onAllNodesWithTag(tag, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty() }
    private fun click(tag: String) {
        if (compose.onAllNodesWithTag(tag, useUnmergedTree = true).fetchSemanticsNodes().isEmpty()) {
            for (list in listOf("report-content", "planning-tasks", "workflow-content")) {
                if (compose.onAllNodesWithTag(list).fetchSemanticsNodes().isNotEmpty())
                    runCatching { compose.onNodeWithTag(list).performScrollToNode(hasTestTag(tag)) }
            }
        }
        await(tag); val node = compose.onNodeWithTag(tag, useUnmergedTree = true)
        if (runCatching { node.assertIsDisplayed() }.isFailure) node.performScrollTo()
        compose.waitUntil(30_000) { runCatching { node.assertIsEnabled() }.isSuccess }
        node.performClick(); compose.waitForIdle()
    }
    private fun capture(name: String) {
        if (InstrumentationRegistry.getArguments().getString("genesisGSuiteCapture") != "true") return
        compose.waitForIdle(); InstrumentationRegistry.getInstrumentation().waitForIdleSync()
        val file = File(fixture.app.cacheDir, "g-suite-$name.png")
        val pipe = InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p")
        ParcelFileDescriptor.AutoCloseInputStream(pipe).use { input -> file.outputStream().use(input::copyTo) }
        assertTrue(file.length() > 0)
    }
    @Test fun parentWorkflowBacklogSprintStartCarryoverAndHistoricalSourcesUseTheSameTasks() {
        val dark = InstrumentationRegistry.getArguments().getString("genesisCaptureDark") == "true"
        compose.setContent {
            CompositionLocalProvider(LocalGenesisLanguage provides "ru", LocalGenesisUserId provides fixture.actor,
                LocalEveningTheme provides dark, LocalSacredFeaturesEnabled provides true) {
                MaterialTheme(colorScheme = if (dark) evening else standart) { Surface(Modifier.fillMaxSize()) {
                    SharedProjectsScreen(controller, "ru", SharedInvitationDestination(fixture.space, fixture.project))
                } }
            }
        }
        click("shared-work-actions"); click("shared-workflow-open"); await("workflow-summary"); capture("workflow")
        compose.onNodeWithTag("workflow-error").assertDoesNotExist()
        UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).pressBack(); await("shared-actions")
        click("shared-work-actions"); click("shared-planning-open"); await("planning-settings")
        click("planning-settings"); click("planning-enabled"); click("planning-save-lifecycle")
        await("planning-lifecycle-saved")
        click("planning-new-sprint"); await("planning-sprint-title")
        compose.onNodeWithTag("planning-sprint-title").performScrollTo().performTextReplacement("G linked sprint")
        compose.onNodeWithTag("planning-sprint-goal").performScrollTo().performTextReplacement("Preserve source and unfinished work")
        compose.activityRule.scenario.onActivity { activity ->
            (activity.getSystemService(android.content.Context.INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager)
                .hideSoftInputFromWindow(activity.window.decorView.windowToken, 0)
        }
        click("planning-save-lifecycle"); await("planning-lifecycle-saved")
        var planning = fixture.client.sharedPlanning(fixture.generation, fixture.project)
        val sprint = rows(planning.getJSONArray("sprints")).single { it.getString("title") == "G linked sprint" }
        val sprintId = sprint.getString("id")
        val start = sprint.getString("startDate"); val end = sprint.getString("endDate")
        assertTrue(LocalDate.parse(end) >= LocalDate.parse(start))
        // Actual card edit keeps independent zero hours and nonzero points before backlog assignment.
        task = runBlocking { controller.updateSharedTask(fixture.project, task.getString("id"), JSONObject()
            .put("expectedRevision", task.getInt("revision")).put("storyPoints", 3.5).put("estimateHours", 0)) }.getJSONObject("task")
        val assignment = JSONObject().put("expectedRevision", task.getInt("revision")).put("sprintId", sprintId)
        task = runBlocking { controller.updateSharedTask(fixture.project, task.getString("id"), assignment) }.getJSONObject("task")
        click("planning-refresh")
        compose.waitUntil(30_000) { runCatching {
            compose.onNodeWithTag("planning-tasks").performScrollToNode(hasTestTag("planning-task-${task.getString("id")}"))
        }.isSuccess }
        click("planning-start-sprint")
        await("planning-complete-sprint"); capture("active")
        planning = fixture.client.sharedPlanning(fixture.generation, fixture.project)
        val active = rows(planning.getJSONArray("sprints")).single { it.getString("id") == sprintId }
        assertEquals("active", active.getString("state")); assertEquals(start, active.getString("startDate")); assertEquals(end, active.getString("endDate"))
        assertEquals(3.5, planning.getJSONObject("totals").getJSONObject(sprintId).getJSONObject("points").getDouble("value"), 0.0)
        assertEquals(0.0, planning.getJSONObject("totals").getJSONObject(sprintId).getJSONObject("hours").getDouble("value"), 0.0)
        click("planning-sprint-report"); await("report-overview"); click("report-open-plan"); await("report-source-count")
        compose.onNodeWithTag("report-source-count").assertTextEquals("1 / 1")
        click("report-source-open-${task.getString("id")}"); await("report-actual-task"); capture("source")
        val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        device.pressBack(); await("report-source-count"); device.pressBack(); await("report-overview")
        device.pressBack(); await("planning-sprint-report")
        click("planning-complete-sprint"); await("planning-all-destinations"); capture("outcomes")
        click("planning-all-destinations"); click("planning-outcome-backlog"); click("planning-finish-completion")
        await("planning-lifecycle-saved")
        val completed = rows(fixture.client.sharedPlanning(fixture.generation, fixture.project).getJSONArray("sprints")).single { it.getString("id") == sprintId }
        assertEquals("completed", completed.getString("state"))
        val restored = fixture.client.sharedTask(fixture.generation, fixture.project, task.getString("id")).getJSONObject("task")
        assertTrue(restored.isNull("sprintId")); assertEquals(3.5, restored.getDouble("storyPoints"), 0.0); assertEquals(0.0, restored.getDouble("estimateHours"), 0.0)
        for (unit in SprintReportProtocol.units) {
            val report = SprintReportProtocol.snapshot(fixture.project, sprintId, unit, runBlocking { controller.sharedSprintReport(fixture.project, sprintId, unit) })
            assertEquals(1, report.getJSONObject("flow").getJSONObject("summary").getJSONObject("carried").getInt("tasks"))
        }
    }
}
