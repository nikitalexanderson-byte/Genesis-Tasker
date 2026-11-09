package ru.genesis.calendar.ui

import android.content.res.Configuration
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.captureNativeWindow
import java.io.File
import java.util.UUID
import ru.genesis.calendar.data.TrackersRepository
import ru.genesis.calendar.domain.CalendarMode

/**
 * Exercises actions exported into the actual shell, including physical touch dispatch.
 * Only the first test uses controlled states; the second mounts the production habits route.
 */
class AbstinenceHeader317Test {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    private val app get() = compose.activity.application as GenesisApplication
    private val args get() = InstrumentationRegistry.getArguments()
    private var checkpoint = "setup"
    private var phase = "setup"

    private fun guard() = check(BuildConfig.DEBUG && app.packageName.endsWith(".debug") &&
        app.workspaceScope == "internal-validation-v1")


    private fun scenario(name: String, body: () -> Unit) {
        guard()
        try { body() }
        catch (failure: Throwable) {
            // Capture while this test's screen is still mounted; a screenshot from
            // a previous successful method must never stand in for this failure.
            val directory = app.getExternalFilesDir(null) ?: app.cacheDir
            runCatching {
                val roots = compose.onAllNodes(isRoot(), useUnmergedTree = true)
                val trees = roots.fetchSemanticsNodes().indices.joinToString("\n\n") { roots[it].printToString() }
                val repositoryState = runCatching {
                    runBlocking { kotlinx.coroutines.withTimeout(2_000) { TrackersRepository(app).workspace.first() } }
                }.fold(
                    { "repositorySnapshot=loaded; addictionDataLoaded=${it.addictionDataLoaded}; revision=${it.revision}; trackerCount=${it.addictionTrackers.size}" },
                    { "repositorySnapshotFailure=${it.javaClass.simpleName}" },
                )
                File(directory, "abstinence-header317-" + name + ".txt").writeText(
                    "checkpoint=" + checkpoint + "\nphase=" + phase + "\nworkspaceScope=" + app.workspaceScope +
                        "\n" + repositoryState + "\n" + trees)
            }.exceptionOrNull()?.let(failure::addSuppressed)
            runCatching {
                captureNativeWindow(File(directory, "abstinence-header317-" + name + ".png"))
            }.exceptionOrNull()?.let(failure::addSuppressed)
            throw failure
        }
    }

    @Composable
    private fun Shell(page: String = "Привычки", dark: Boolean = args.getString("genesisDark") == "true",
        content: @Composable () -> Unit) {
        val originalDensity = LocalDensity.current
        val widthOverride = args.getString("genesisWidth")?.toIntOrNull()
        val width = widthOverride ?: LocalConfiguration.current.screenWidthDp
        val font = args.getString("genesisFontScale")?.toFloatOrNull() ?: originalDensity.fontScale
        val density = widthOverride?.let { compose.activity.resources.displayMetrics.widthPixels.toFloat() / it }
            ?: originalDensity.density
        val configuration = Configuration(LocalConfiguration.current).apply {
            screenWidthDp = width
            screenHeightDp = (compose.activity.resources.displayMetrics.heightPixels / density).toInt()
            fontScale = font
        }
        CompositionLocalProvider(
            LocalGenesisLanguage provides "ru",
            LocalEveningTheme provides dark,
            LocalSacredFeaturesEnabled provides true,
            LocalDensity provides Density(density, font),
            LocalConfiguration provides configuration,
        ) {
            MaterialTheme(colorScheme = if (dark) evening else standart,
                typography = GenesisTypography, shapes = GenesisShapes) {
                Surface(Modifier.fillMaxSize()) {
                    MobileWorkspaceShell(page, if (page == "Привычки") "Привычки" else null,
                        emptyList(), "", false, calendarMode = CalendarMode.PROFANE,
                        onNavigate = {}, actions = {
                            CalendarModeSwitcher(CalendarMode.PROFANE, {}, size = 48.dp, interactive = false)
                        }) { content() }
                }
            }
        }
    }

    private fun enabled(tag: String): SemanticsNodeInteraction {
        checkpoint = tag
        compose.waitUntil(10_000) {
            compose.onAllNodes(hasTestTag(tag) and isEnabled()).fetchSemanticsNodes().size == 1
        }
        return compose.onNodeWithTag(tag).assertIsEnabled()
    }

    private fun tap(tag: String) {
        enabled(tag).assertIsDisplayed().performTouchInput { click(center) }
    }

    private fun assertHostedCreate(tag: String = "abstinence-create") {
        compose.onAllNodesWithTag(tag).assertCountEquals(1)
        compose.onNodeWithTag(tag).assertIsDisplayed()
            .assert(hasAnyAncestor(hasTestTag("app-header")))
            .assertWidthIsAtLeast(48.dp).assertHeightIsAtLeast(48.dp)
    }

    @Composable
    private fun HeaderProbe(loaded: Boolean, busy: Boolean, callbackValue: String, onCreate: (String) -> Unit) {
        // Value parameters deliberately capture each generation. Reading the test's State
        // directly inside actions would fail to detect a stale exported action lambda.
        WorkspaceScreenHeader("Воздержание", navigation = {
            WorkspaceHeaderButton("К привычкам", "header-probe-back", onClick = {}) {
                GenesisLucideIcon("chevron-left")
            }
        }, actions = {
            WorkspaceHeaderButton("Добавить трекер воздержания", "header-probe-create",
                enabled = loaded && !busy, onClick = { onCreate(callbackValue) }) {
                GenesisLucideIcon("plus")
            }
        }, showThemeToggle = false)
        Text("Синтетическая загрузка")
    }

    @Test fun exportedActionsObserveLoadingBusyAndLatestCallback() = scenario("exported-actions") {
        var loaded by mutableStateOf(false)
        var busy by mutableStateOf(false)
        var callbackValue by mutableStateOf("before-load")
        var page by mutableStateOf("Привычки")
        val calls = mutableListOf<String>()
        compose.setContent {
            Shell(page) {
                if (page == "Привычки") HeaderProbe(loaded, busy, callbackValue) { calls += it }
                else WorkspaceScreenHeader("Сегодня")
            }
        }
        assertHostedCreate("header-probe-create")
        compose.onNodeWithTag("header-probe-create").assertIsNotEnabled()
            .performTouchInput { click(center) }
        compose.runOnIdle { assertEquals(emptyList<String>(), calls) }

        compose.runOnIdle { loaded = true; callbackValue = "after-load" }
        tap("header-probe-create")
        compose.runOnIdle { assertEquals(listOf("after-load"), calls) }

        compose.runOnIdle { busy = true; callbackValue = "while-saving" }
        compose.onNodeWithTag("header-probe-create").assertIsNotEnabled()
            .performTouchInput { click(center) }
        compose.runOnIdle { assertEquals(listOf("after-load"), calls) }

        compose.runOnIdle { busy = false; callbackValue = "after-save" }
        tap("header-probe-create")
        compose.runOnIdle { assertEquals(listOf("after-load", "after-save"), calls) }

        compose.runOnIdle { loaded = false; callbackValue = "reload-pending" }
        compose.onNodeWithTag("header-probe-create").assertIsNotEnabled()
            .performTouchInput { click(center) }
        compose.runOnIdle { assertEquals(listOf("after-load", "after-save"), calls) }
        compose.runOnIdle { loaded = true; callbackValue = "after-reload" }
        tap("header-probe-create")
        compose.runOnIdle { assertEquals(listOf("after-load", "after-save", "after-reload"), calls) }

        // Changing selectedPage replaces the shell's header holder, then returning
        // exercises disposal of the old registration and registration into the new host.
        compose.runOnIdle { page = "Сегодня" }
        compose.onNodeWithTag("header-probe-create").assertDoesNotExist()
        compose.runOnIdle { callbackValue = "after-return"; page = "Привычки" }
        assertHostedCreate("header-probe-create")
        tap("header-probe-create")
        compose.runOnIdle {
            assertEquals(listOf("after-load", "after-save", "after-reload", "after-return"), calls)
        }
    }

    private fun openAbstinenceFromHabits() {
        tap("habit-workspace-menu")
        tap("habit-open-abstinence")
        enabled("abstinence-create")
        assertHostedCreate()
        compose.onNodeWithTag("abstinence-add").assertIsEnabled()
    }

    private fun openAndDismissFromTop() {
        tap("abstinence-create")
        enabled("abstinence-name").assertIsDisplayed()
        tap("abstinence-editor-close")
        compose.onNodeWithTag("abstinence-editor-close").assertDoesNotExist()
    }

    @Test fun abstinenceOverflowOpensRepeatedlyFromTheRealHabitsRoute() = scenario("overflow319") {
        var dark by mutableStateOf(false)
        compose.setContent { Shell(dark = dark) { HabitsScreen(app, experimental = true) } }
        for (night in listOf(false, true)) {
            compose.runOnIdle { dark = night }
            tap("habit-workspace-menu")
            tap("habit-open-abstinence")
            assertHostedCreate()
            for (action in listOf("today", "refresh", "create")) {
                tap("abstinence-actions")
                listOf("today", "refresh", "create").forEach {
                    enabled("abstinence-action-$it").assertIsDisplayed().assertHeightIsAtLeast(48.dp)
                }
                tap("abstinence-action-$action")
                compose.onNodeWithTag("abstinence-action-today").assertDoesNotExist()
                if (action == "create") {
                    enabled("abstinence-name").assertIsDisplayed()
                    tap("abstinence-editor-close")
                }
                compose.onNodeWithTag("abstinence-screen").assertExists()
            }
            tap("abstinence-back")
        }
    }

    private fun withOwnedTracker(name: String, body: (TrackersRepository, String) -> Unit) {
        guard()
        val repo = TrackersRepository(app)
        val marker = "QA317 практика ${UUID.randomUUID()}"
        var primaryFailure: Throwable? = null
        try {
            // Capture a failure before cleanup changes the screen or persisted rows.
            scenario(name) { body(repo, marker) }
        } catch (failure: Throwable) {
            primaryFailure = failure
            throw failure
        } finally {
            val cleanupFailure = runCatching {
                runBlocking {
                    // Never reset the repository: other synthetic fixtures may coexist.
                    repo.workspace.first().addictionTrackers.filter { it.trackedBehavior == marker }.forEach {
                        repo.deleteAddiction(it.id, it.entity.version)
                    }
                }
            }.exceptionOrNull()
            if (cleanupFailure != null) {
                val original = primaryFailure
                if (original != null) original.addSuppressed(cleanupFailure) else throw cleanupFailure
            }
        }
    }

    @Test fun equalTrackerActionsKeepPauseResumeAndDayResultWorkingInBothThemes() = withOwnedTracker("equal-actions") { repo, marker ->
        var dark by mutableStateOf(false)
        compose.setContent { Shell(dark = dark) { AbstinenceScreen(app) {} } }
        tap("abstinence-create")
        enabled("abstinence-name").performTextReplacement(marker)
        tap("abstinence-tracker-save")
        compose.waitUntil(10_000) { runBlocking { repo.workspace.first().addictionTrackers.any { it.trackedBehavior == marker } } }
        val tracker = runBlocking { repo.workspace.first().addictionTrackers.single { it.trackedBehavior == marker } }
        val active = "abstinence-active-${tracker.id}"
        val paused = "abstinence-paused-${tracker.id}"
        val result = "abstinence-record-${tracker.id}"
        for (night in listOf(false, true)) {
            compose.runOnIdle { dark = night }
            enabled(result).performScrollTo().assertIsDisplayed()
            val bounds = listOf(active, paused, result).map {
                compose.onNodeWithTag(it).assertIsDisplayed().assertHeightIsAtLeast(48.dp)
                    .fetchSemanticsNode().boundsInRoot
            }
            bounds.drop(1).forEach {
                assertEquals("Equal action width", bounds[0].width, it.width, 1.1f)
                assertEquals("Equal action height", bounds[0].height, it.height, 1.1f)
                assertEquals("Actions share one row", bounds[0].top, it.top, 1.1f)
            }
            assertTrue(bounds.zipWithNext().all { (a, b) -> a.right <= b.left })
            val scheme = if (night) "dark" else "light"
            captureNativeWindow(File(app.getExternalFilesDir(null), "abstinence-layout317-$scheme.png"))
            tap(paused)
            compose.waitUntil(10_000) { runBlocking { repo.workspace.first().addictionTrackers.single { it.id == tracker.id }.status == "paused" } }
            compose.onNodeWithTag(result).assertIsNotEnabled()
            tap(active)
            enabled(result).performTouchInput { click(center) }
            compose.onNodeWithTag("abstinence-clean").assertIsDisplayed()
            tap("abstinence-close")
            enabled("abstinence-today").performScrollTo().assertIsDisplayed()
                .performTouchInput { click(center) }
        }
    }

    @Test fun topCreateWorksAfterHabitBackAndScreenRemountWithoutSaving() = scenario("real-abstinence-route") {
        val before = runBlocking { TrackersRepository(app).workspace.first() }
        var mounted by mutableStateOf(true)
        compose.setContent {
            Shell {
                if (mounted) HabitsScreen(app, true,
                    inputCalendarMode = CalendarMode.PROFANE,
                    displayCalendarMode = CalendarMode.PROFANE)
            }
        }
        phase = "initial-habits-entry"
        openAbstinenceFromHabits()
        openAndDismissFromTop()

        // Compare with the second entry point (not yet verified), then tap the shell
        // action after scrolling the content down to that bottom entry point.
        enabled("abstinence-add").performScrollTo().assertIsDisplayed()
            .performTouchInput { click(center) }
        enabled("abstinence-name").assertIsDisplayed()
        tap("abstinence-editor-close")
        openAndDismissFromTop()

        tap("abstinence-back")
        compose.onNodeWithTag("abstinence-create").assertDoesNotExist()
        phase = "habits-return"
        openAbstinenceFromHabits()
        openAndDismissFromTop()

        compose.runOnIdle { mounted = false }
        compose.onNodeWithTag("abstinence-create").assertDoesNotExist()
        compose.runOnIdle { mounted = true }
        phase = "full-habits-remount"
        openAbstinenceFromHabits()
        openAndDismissFromTop()
        val after = runBlocking { TrackersRepository(app).workspace.first() }
        assertEquals("Opening and cancelling must not alter tracker data", before, after)
    }

    @Test fun topCreateTracksColdDataAfterRepeatedRemountsInBothThemes() = scenario("cold-remount") {
        val before = runBlocking { TrackersRepository(app).workspace.first() }
        var mounted by mutableStateOf(false)
        var dark by mutableStateOf(false)
        compose.setContent { Shell(dark = dark) { if (mounted) AbstinenceScreen(app) {} } }
        for (night in listOf(false, true)) {
            repeat(6) { attempt ->
                phase = "cold-remount-${if (night) "dark" else "light"}-$attempt"
                compose.runOnIdle { mounted = false }
                compose.onNodeWithTag("abstinence-create").assertDoesNotExist()
                compose.runOnIdle { dark = night; mounted = true }
                // The body proves the repository emission arrived. The exported
                // action must then reach the same enabled state and receive touch.
                enabled("abstinence-add").assertIsDisplayed()
                assertHostedCreate()
                openAndDismissFromTop()
                if (attempt == 5) captureNativeWindow(File(app.getExternalFilesDir(null),
                    "abstinence-header317-cold-ready-${if (night) "dark" else "light"}.png"))
            }
        }
        val after = runBlocking { TrackersRepository(app).workspace.first() }
        assertEquals("Remounting and cancelling must not alter tracker data", before, after)
    }
}
