package ru.genesis.calendar

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import java.io.File
import java.util.UUID
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.data.WorkspaceStructureRepository
import ru.genesis.calendar.ui.*

/** Exercises category persistence in an isolated debug workspace, including colours outside the palette. */
class CategoryPaletteFlowTest {
    @get:Rule val compose = createAndroidComposeRule<StoicheionGestureActivity>()
    private val app get() = compose.activity.application as GenesisApplication
    private val width = InstrumentationRegistry.getArguments().getString("genesisWidth")?.toIntOrNull() ?: 390
    private val dark = InstrumentationRegistry.getArguments().getString("genesisEvening") == "true"
    private fun capture(name: String) {
        compose.waitForIdle()
        assertTrue(UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).takeScreenshot(
            File(app.getExternalFilesDir(null), "2.3.10-${width}dp-${if(dark) "evening" else "light"}-$name.png")))
    }

    @Test fun createAndEditAnyColourWithoutLosingExactHex() {
        check(BuildConfig.DEBUG && app.packageName.endsWith(".debug"))
        app.activateAccount(null)
        val repository = WorkspaceStructureRepository(app)
        val name = "Палитра ${UUID.randomUUID()}"
        compose.setContent {
            val density = Density(compose.activity.resources.displayMetrics.widthPixels.toFloat() / width, LocalDensity.current.fontScale)
            CompositionLocalProvider(LocalDensity provides density, LocalEveningTheme provides dark) {
                MaterialTheme(colorScheme = if (dark) evening else standart) {
                    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                        ProjectsScreen(app, emptyList(), true, {}, {})
                    }
                }
            }
        }
        try {
            compose.waitUntil(10_000) { compose.onAllNodesWithTag("projects-screen").fetchSemanticsNodes().isNotEmpty() }
            if (compose.onAllNodesWithTag("manage-categories").fetchSemanticsNodes().isEmpty())
                compose.onNodeWithTag("projects-screen").performScrollToNode(hasTestTag("manage-categories"))
            compose.onNodeWithTag("manage-categories").performScrollTo().performClick()
            compose.onNodeWithTag("create-category").performScrollTo().performClick()
            compose.waitUntil(10_000) { compose.onAllNodesWithTag("category-name").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithTag("category-name").performTextInput(name)
            UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).pressBack()
            assertEquals(60, compose.onAllNodes(SemanticsMatcher("Colour swatch") {
                it.config.getOrNull(SemanticsProperties.TestTag)?.startsWith("category-swatch-") == true
            }).fetchSemanticsNodes().size)
            compose.onNodeWithTag("category-swatch-B65472").performScrollTo().performClick()
            compose.onNodeWithTag("category-color-hex").performScrollTo().assertTextContains("#B65472")
            capture("category-palette")
            compose.onNodeWithTag("category-color-hex").performTextReplacement("#")
            compose.onNodeWithTag("save-category").assertIsNotEnabled()
            compose.onNodeWithTag("category-color-hex").performTextReplacement("#17C9B3")
            UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).pressBack()
            compose.onNodeWithTag("save-category").assertIsEnabled().performClick()
            compose.waitUntil(10_000) { runBlocking { repository.workspace.first().categories.any { it.name == name } } }
            val created = runBlocking { repository.workspace.first().categories.single { it.name == name } }
            assertEquals("#17C9B3", created.color)
            compose.onNodeWithTag("edit-category-${created.id}").performScrollTo().performClick()
            compose.onNodeWithTag("category-color-hex").assertTextContains("#17C9B3")
            compose.onNodeWithTag("category-custom-color-tab").performScrollTo().performClick()
            compose.onNodeWithTag("category-color-hue").performScrollTo()
                .performSemanticsAction(SemanticsActions.SetProgress) { assertTrue(it(207f)) }
            compose.onNodeWithTag("category-color-saturation").performScrollTo()
                .performSemanticsAction(SemanticsActions.SetProgress) { assertTrue(it(.65f)) }
            compose.onNodeWithTag("category-color-brightness").performScrollTo()
                .performSemanticsAction(SemanticsActions.SetProgress) { assertTrue(it(.8f)) }
            compose.onNodeWithTag("category-color-hex").performScrollTo()
            val custom = compose.onNodeWithTag("category-color-hex").fetchSemanticsNode().config[SemanticsProperties.EditableText].text
            assertNotEquals("#17C9B3", custom)
            capture("category-custom-colour")
            compose.onNodeWithTag("save-category").performClick()
            compose.waitUntil(10_000) { runBlocking { repository.workspace.first().categories.single { it.id == created.id }.color == custom } }
            compose.onNodeWithTag("edit-category-${created.id}").performScrollTo().performClick()
            compose.onNodeWithTag("category-color-hex").assertTextContains(custom)
        } finally {
            runBlocking { repository.workspace.first().categories.filter { it.name == name }.forEach { repository.deleteCategory(it.id) } }
        }
    }
}
