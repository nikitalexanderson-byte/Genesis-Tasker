package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.captureNativeWindow
import java.io.File

/** Real workflow UI plus the two common dialog shells; no network or production data. */
class ModalDesign310Test {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    private val width = InstrumentationRegistry.getArguments().getString("genesis310Width")?.toInt() ?: 390
    private var dark by mutableStateOf(false)
    private var page by mutableIntStateOf(0)
    private var language by mutableStateOf("ru")
    private var open by mutableStateOf(true)
    private val fixture = WorkflowUiFixture()
    private var density = 1f

    private fun show() = compose.setContent {
        density = InstrumentationRegistry.getInstrumentation().targetContext.resources.displayMetrics.widthPixels.toFloat() / width
        CompositionLocalProvider(LocalDensity provides Density(density, 1f),
            LocalEveningTheme provides dark, LocalGenesisLanguage provides language, LocalGenesisUserId provides fixture.account) {
            MaterialTheme(colorScheme = if (dark) evening else standart, shapes = GenesisShapes, typography = GenesisTypography) {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    if (open) when (page) {
                        0 -> SharedWorkflowScreen(fixture, "project", { open = false }, {})
                        1 -> Dialog({ open = false }, properties = androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
                            GenesisModalFrame({ open = false }, maxWidth = 720.dp) {
                                Column(Modifier.testTag("modal-sample")) {
                                    AffairsDialogHeader("Пользовательские поля", "Обзвон потенциальных клиентов", { open = false },
                                        closeTag = "sample-close") {
                                        AffairsIconButton("Обновить", AffairsAction.REFRESH, {}, Modifier.testTag("sample-refresh"))
                                    }
                                    androidx.compose.material3.HorizontalDivider()
                                    Row(Modifier.fillMaxWidth().padding(16.dp)) {
                                        Text("Поля", Modifier.weight(1f))
                                        TemplateIconButton("Добавить поле", AffairsAction.ADD, true,
                                            Modifier.size(48.dp).testTag("sample-add")) { }
                                    }
                                }
                            }
                        }
                        else -> AlertDialog({ open = false }, title = { Text("Удалить черновик?") },
                            text = { Text("Это удалит только сохранённый ввод. Правило на сервере не изменится.") },
                            confirmButton = { Button({ open = false }, Modifier.testTag("sample-confirm")) { Text("Удалить") } },
                            dismissButton = { androidx.compose.material3.TextButton({ open = false }, Modifier.heightIn(min = 48.dp)) { Text("Отмена") } })
                    }
                }
            }
        }
    }
    private fun capture(name: String) {
        compose.waitForIdle()
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        captureNativeWindow(File(context.getExternalFilesDir(null), "modal310-$width-${if (dark) "dark" else "light"}-$name.png"))
    }
    private fun target(tag: String) {
        val bounds = compose.onNodeWithTag(tag).assertIsDisplayed().fetchSemanticsNode().boundsInWindow
        assertTrue("$tag width", bounds.width / density >= 47.9f)
        assertTrue("$tag height", bounds.height / density >= 47.9f)
    }
    @After fun clean() = fixture.clean()

    @Test fun workflowIsBoundedAndItsHeaderAndSectionsRemainUsable() {
        show()
        for (night in listOf(false, true)) {
            compose.runOnIdle { dark = night }
            compose.waitUntil(10000) { compose.onAllNodesWithTag("workflow-summary").fetchSemanticsNodes().isNotEmpty() }
            val bounds = compose.onNodeWithTag("genesis-modal-surface").fetchSemanticsNode().boundsInWindow
            assertTrue("Left outside-tap margin", bounds.left / density >= 11.9f)
            assertTrue("Right outside-tap margin", bounds.right / density <= width - 11.9f)
            assertTrue("Bounded modal", bounds.top > 0f)
            listOf("workflow-back", "workflow-refresh", "workflow-close").forEach(::target)
            val close = compose.onNodeWithTag("workflow-close").fetchSemanticsNode().boundsInWindow
            val refresh = compose.onNodeWithTag("workflow-refresh").fetchSemanticsNode().boundsInWindow
            assertEquals(close.top, refresh.top, .5f)
            assertTrue(refresh.right <= close.left)
            val tabs = listOf("statuses", "transitions", "history").map {
                target("workflow-section-$it")
                compose.onNodeWithTag("workflow-section-$it").fetchSemanticsNode().boundsInWindow
            }
            assertEquals(tabs[0].top, tabs[1].top, .5f)
            assertEquals(tabs[1].top, tabs[2].top, .5f)
            compose.onNodeWithTag("workflow-section-transitions").performClick()
            compose.onNodeWithTag("workflow-transitions").assertExists()
            compose.onNodeWithTag("workflow-section-statuses").performClick()
            capture("workflow")
        }
        compose.onNodeWithTag("workflow-close").performClick()
        compose.onNodeWithTag("shared-workflow-screen").assertDoesNotExist()
    }

    @Test fun commonHeadersKeepRefreshAndCloseOnTheRightInBothThemes() {
        page = 1; show()
        for (night in listOf(false, true)) for (lang in listOf("ru", "en", "de", "ja")) {
            compose.runOnIdle { dark = night; language = lang }
            listOf("sample-close", "sample-refresh", "sample-add").forEach(::target)
            val close = compose.onNodeWithTag("sample-close").fetchSemanticsNode().boundsInWindow
            val refresh = compose.onNodeWithTag("sample-refresh").fetchSemanticsNode().boundsInWindow
            assertEquals(close.top, refresh.top, .5f)
            assertTrue(refresh.right <= close.left)
            capture("fields-$lang")
        }
        compose.runOnIdle { page = 2; language = "ru" }
        compose.onAllNodesWithContentDescription("Закрыть").assertCountEquals(1)
        compose.onNodeWithTag("sample-confirm").assertIsDisplayed()
        capture("confirmation")
        compose.onNodeWithContentDescription("Закрыть").performClick()
        compose.onNodeWithTag("sample-confirm").assertDoesNotExist()
    }
}
