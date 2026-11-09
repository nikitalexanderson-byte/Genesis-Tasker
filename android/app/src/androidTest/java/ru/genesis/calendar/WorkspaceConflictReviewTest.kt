package ru.genesis.calendar

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import ru.genesis.calendar.auth.*
import ru.genesis.calendar.ui.*

class WorkspaceConflictReviewTest {
    @get:Rule val compose = createAndroidComposeRule<StoicheionGestureActivity>()
    private fun preview(count: Int) = WorkspaceConflictPreview.create((0 until count).map { index ->
        WorkspaceConflictField("projects/p$index/title", "Собственный проект $index", "\"Исходное $index\"",
            "\"Телефон <script>alert($index)</script>\"", "\"Сайт $index\"")
    })
    @Test fun globalNoticeOpensExactComparisonAndCancelDoesNotWrite() {
        val value = preview(1)
        var writes = 0
        var retried = 0
        val state = AuthPanelState(user = ServerIdentity("fixture-user", "Fixture", "fixture@example.invalid"),
            outgoingSyncIssue = "Конфликт: обе копии сохранены.", workspaceConflictPath = value.fields.first().path,
            workspaceConflictPreview = value)
        compose.setContent { MaterialTheme(colorScheme = standart) {
            WorkspaceSyncNotice(state, { retried++ }, { _, _ -> writes++ }, { uid, fingerprint ->
                assertEquals("fixture-user", uid); assertEquals(value.fingerprint, fingerprint); writes++
            })
        } }
        compose.onNodeWithTag("workspace-sync-compare").assertHeightIsAtLeast(48.dp).performClick()
        compose.onNodeWithTag("workspace-conflict-dialog").assertIsDisplayed()
        compose.onNodeWithTag("workspace-conflict-cancel").performClick()
        assertEquals(0, writes); assertEquals(0, retried)
        compose.onNodeWithTag("workspace-sync-compare").performClick()
        compose.onNodeWithTag("workspace-conflict-keep-remote").performClick()
        assertEquals(1, writes)
    }
    private fun capture(name: String) {
        if (InstrumentationRegistry.getArguments().getString("genesisConflictCapture") != "true") return
        compose.waitForIdle()
        val frames = CountDownLatch(1)
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            android.view.Choreographer.getInstance().postFrameCallback {
                android.view.Choreographer.getInstance().postFrameCallback { frames.countDown() }
            }
        }
        assertTrue(frames.await(10, TimeUnit.SECONDS))
        val folder = File(compose.activity.getExternalFilesDir(null), "workspace-conflict-captures").apply { mkdirs() }
        assertTrue(UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).takeScreenshot(File(folder, "$name.png")))
    }
    @Test fun paginationRequiresAllFieldsAndKeepsEscapedContentAnd48dpActions() {
        check(BuildConfig.DEBUG && compose.activity.packageName.endsWith(".debug"))
        var selected = ""; val value = preview(7)
        compose.setContent { CompositionLocalProvider(LocalGenesisLanguage provides "ru") {
            MaterialTheme(colorScheme = standart) { WorkspaceConflictDialog(value, false,
                { selected = "phone" }, { selected = "website" }, { selected = "cancel" }) }
        } }
        compose.onNodeWithTag("workspace-conflict-keep-local").assertIsNotEnabled()
        compose.onNodeWithTag("workspace-conflict-local-projects/p0/title").assertTextEquals("Телефон <script>alert(0)</script>")
        capture("light-first-page")
        compose.onNodeWithTag("workspace-conflict-more").performScrollTo().performClick()
        compose.onNodeWithTag("workspace-conflict-remote-projects/p6/title").performScrollTo().assertTextEquals("Сайт 6")
        compose.onNodeWithTag("workspace-conflict-keep-local").assertIsEnabled().assertHeightIsAtLeast(48.dp)
        capture("light-last-page")
        compose.onNodeWithTag("workspace-conflict-keep-remote").assertHeightIsAtLeast(48.dp).performClick()
        assertEquals("website", selected)
    }
    @Test fun cancelAndBusyNeverApplyEitherVersion() {
        check(BuildConfig.DEBUG && compose.activity.packageName.endsWith(".debug"))
        var writes = 0; var cancelled = 0; var busy by mutableStateOf(true); val value = preview(1)
        compose.setContent { CompositionLocalProvider(LocalGenesisLanguage provides "ru") {
            MaterialTheme(colorScheme = evening) { WorkspaceConflictDialog(value, busy,
                { writes++ }, { writes++ }, { cancelled++ }) }
        } }
        compose.onNodeWithTag("workspace-conflict-keep-local").assertIsNotEnabled()
        compose.onNodeWithTag("workspace-conflict-keep-remote").assertIsNotEnabled()
        compose.onNodeWithTag("workspace-conflict-cancel").assertIsNotEnabled()
        capture("dark-busy")
        compose.runOnIdle { busy = false }
        compose.onNodeWithTag("workspace-conflict-cancel").performClick()
        assertEquals(1, cancelled); assertEquals(0, writes)
    }
}
