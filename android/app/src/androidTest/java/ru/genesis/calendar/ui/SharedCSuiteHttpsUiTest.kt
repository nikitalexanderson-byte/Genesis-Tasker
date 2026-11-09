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
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.auth.*
import java.io.File

/** All six features are reached through the real parent screen and production AuthController. */
class SharedCSuiteHttpsUiTest {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    private val fixture = TemplateHttpsFixture()
    private lateinit var controller: AuthController
    private lateinit var taskId: String
    private lateinit var memberId: String
    @Before fun open() {
        fixture.open()
        val snapshot = fixture.client.sharedProject(fixture.generation, fixture.project)
        taskId = fixture.client.createSharedTask(fixture.generation, fixture.project, JSONObject().put("title", "C-suite source from the actual API")
            .put("statusId", snapshot.getJSONArray("statuses").getJSONObject(0).getString("id"))).getJSONObject("task").getString("id")
        memberId = fixture.raw("POST", "/__fixture/add-member", JSONObject().put("spaceId", fixture.space)).getString("userId")
        controller = AuthController.get(fixture.app)
        runBlocking {
            withContext(Dispatchers.Main) { controller.checkSession() }
            withTimeout(60_000) { controller.state.first { !it.busy && it.ready && !it.requiresSignIn && it.user?.uid == fixture.actor } }
        }
    }
    @After fun close() = fixture.close()
    private fun await(tag: String) = compose.waitUntil(30_000) { compose.onAllNodesWithTag(tag, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty() }
    private fun click(tag: String) {
        await(tag)
        val node = compose.onNodeWithTag(tag, useUnmergedTree = true)
        if (runCatching { node.assertIsDisplayed() }.isFailure) node.performScrollTo()
        compose.waitUntil(30_000) { runCatching { node.assertIsEnabled() }.isSuccess }
        node.performClick(); compose.waitForIdle()
    }
    private fun capture(name: String) {
        if (InstrumentationRegistry.getArguments().getString("genesisCSuiteCapture") != "true") return
        compose.waitForIdle(); InstrumentationRegistry.getInstrumentation().waitForIdleSync()
        val file = File(fixture.app.cacheDir, "c-suite-$name.png")
        val pipe = InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p")
        ParcelFileDescriptor.AutoCloseInputStream(pipe).use { input -> file.outputStream().use(input::copyTo) }
        assertTrue(file.length() > 0)
    }
    private fun open(action: String, screen: String, ready: String, error: String? = null) {
        val menu = when(action) {
            "shared-templates-open", "shared-automations-open" -> "shared-work-actions"
            "shared-project-access-open", "shared-team-report-open" -> "shared-team-actions"
            else -> "shared-actions"
        }
        click(menu); click(action); await(screen); await(ready)
        compose.waitUntil(30_000) {
            listOf("template-progress", "automation-working", "field-progress", "access-loading")
                .all { compose.onAllNodesWithTag(it).fetchSemanticsNodes().isEmpty() }
        }
        error?.let { compose.onNodeWithTag(it).assertDoesNotExist() }
    }
    @Test fun allSixParentActionsLoadTheCurrentServerAndReportDrilldownReturnsToItsSource() {
        val dark = InstrumentationRegistry.getArguments().getString("genesisCaptureDark") == "true"
        compose.setContent {
            CompositionLocalProvider(LocalGenesisLanguage provides "ru", LocalGenesisUserId provides fixture.actor, LocalEveningTheme provides dark,
                LocalSacredFeaturesEnabled provides true) {
                MaterialTheme(colorScheme = if (dark) evening else standart) { Surface(Modifier.fillMaxSize()) {
                    SharedProjectsScreen(controller, "ru", SharedInvitationDestination(fixture.space, fixture.project))
                } }
            }
        }
        await("shared-actions"); capture("parent")
        open("shared-templates-open", "shared-templates-screen", "template-library", "template-error")
        capture("templates"); click("template-close")
        open("shared-automations-open", "shared-automations-screen", "automation-create", "automation-error")
        capture("automations"); click("automation-close")
        open("shared-fields-open", "shared-fields-screen", "field-add", "field-error")
        capture("fields"); click("field-close")
        open("shared-export-open", "data-export-screen", "export-save", "export-error")
        compose.waitUntil(30_000) { runCatching { compose.onNodeWithTag("export-save").assertIsEnabled() }.isSuccess }
        capture("export"); click("export-close")
        open("shared-import-open", "data-import-screen", "import-choose", "import-error")
        compose.waitUntil(30_000) { runCatching { compose.onNodeWithTag("import-choose").assertIsEnabled() }.isSuccess }
        capture("import"); click("import-close")
        open("shared-project-access-open", "shared-project-access", "access-close", "access-directory-error")
        compose.waitUntil(30_000) { compose.onAllNodesWithTag("access-loading").fetchSemanticsNodes().isEmpty() }
        compose.onNodeWithTag("access-directory-error").assertDoesNotExist()
        click("access-member"); click("access-member-$memberId"); await("access-all-projects")
        val allProjects = compose.onNodeWithTag("access-all-projects", useUnmergedTree = true)
        if (runCatching { allProjects.assertIsOn() }.isSuccess) click("access-all-projects")
        allProjects.assertIsOff()
        click("access-role-${fixture.project}"); click("access-role-${fixture.project}-viewer")
        val descendants = compose.onNodeWithTag("access-descendants-${fixture.project}", useUnmergedTree = true)
        if (runCatching { descendants.assertIsOff() }.isSuccess) click("access-descendants-${fixture.project}")
        descendants.assertIsOn()
        capture("access"); click("access-review"); await("access-apply")
        compose.waitUntil(30_000) { runCatching { compose.onNodeWithTag("access-apply").assertIsEnabled() }.isSuccess }
        capture("access-review"); click("access-apply"); await("access-saved")
        val access = fixture.client.sharedProjectAccess(fixture.generation, fixture.space, memberId)
        assertFalse(access.getBoolean("allProjects"))
        assertTrue(ProjectAccessProtocol.rows(access.getJSONArray("grants")).any {
            it.getString("projectId") == fixture.project && it.getString("role") == "viewer" && it.getBoolean("includeDescendants")
        })
        click("access-close")
        open("shared-team-report-open", "shared-team-report", "team-open-all", "team-error")
        compose.waitUntil(30_000) { runCatching { compose.onNodeWithTag("team-open-all").assertIsEnabled() }.isSuccess }
        capture("reports"); click("team-open-all"); await("team-source-count")
        compose.onNodeWithTag("team-source-count").assertTextEquals("1 / 1")
        click("team-source-$taskId"); await("team-task"); capture("report-source")
        val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        device.pressBack(); await("team-source-count")
        device.pressBack(); await("team-open-all")
        click("team-close"); await("shared-actions")
        compose.onNodeWithTag("shared-team-report").assertDoesNotExist()
    }
}
