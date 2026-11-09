package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.StoicheionGestureActivity
import ru.genesis.calendar.data.*

/** Real pointer gestures exercise ripple/focus lifetime, which semantics clicks bypass. */
class PersonalProjectStability326Test {
    @get:Rule val compose = createAndroidComposeRule<StoicheionGestureActivity>()
    private val app get() = compose.activity.application as GenesisApplication

    @Before fun separateQaPackage() {
        check(BuildConfig.DEBUG && app.packageName.endsWith(".qa326.debug"))
        app.activateAccount(null)
    }

    private fun showProjects() {
        val dark = InstrumentationRegistry.getArguments().getString("genesisEvening") == "true"
        compose.setContent {
            val tasks by app.repository.tasks.collectAsState(initial = emptyList())
            CompositionLocalProvider(LocalEveningTheme provides dark) {
                MaterialTheme(colorScheme = if (dark) evening else standart, shapes = GenesisShapes,
                    typography = GenesisTypography) {
                    Surface(Modifier.fillMaxSize().safeDrawingPadding()) {
                        ProjectsScreen(app, tasks, true, onOpenTask = {}, onCreateTask = {})
                    }
                }
            }
        }
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("projects-screen").fetchSemanticsNodes().isNotEmpty() }
    }

    @Test fun emptyProjectsSurviveLongPressMenusAndRepeatedDeletion() {
        val repo = WorkspaceStructureRepository(app)
        val prefix = "qa326-${System.nanoTime()}"
        val ids = (1..8).map { "$prefix-$it" }
        runBlocking { ids.forEachIndexed { index, id ->
            repo.saveProject(GenesisProject(id, null, null, "Empty project ${index + 1}", "", emptyList(), "active", index))
        } }
        showProjects()
        ids.forEach { id ->
            val actions = hasContentDescription("Действия с проектом") and hasAnyAncestor(hasTestTag("project-drop-$id"))
            compose.onNodeWithTag("projects-screen").performScrollToNode(hasTestTag("project-drop-$id"))
            compose.onNodeWithTag("project-drop-$id").performTouchInput { longClick(Offset(center.x, 32.dp.toPx()), 900) }
            compose.waitForIdle()
            if (compose.onAllNodes(actions, useUnmergedTree = true).fetchSemanticsNodes().isEmpty())
                compose.onNodeWithTag("project-drop-$id").performTouchInput { click(Offset(center.x, 32.dp.toPx())) }
            compose.onNodeWithTag("projects-screen").performScrollToNode(actions)
            compose.onNode(actions, useUnmergedTree = true).performScrollTo()
                .performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.OnClick) { it() }
            compose.onNodeWithTag("delete-project-$id").performClick()
            compose.onNodeWithTag("confirm-delete-project").performClick()
            compose.waitUntil(10_000) { runBlocking { repo.workspace.first().projects.none { it.id == id } } }
            compose.mainClock.advanceTimeBy(1_000)
            compose.waitForIdle()
        }
        assertTrue(runBlocking { repo.workspace.first().projects.none { it.id in ids } })
    }
}
