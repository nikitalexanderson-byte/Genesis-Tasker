package ru.genesis.calendar

import android.app.ActivityManager
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.unit.dp
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import androidx.test.uiautomator.UiDevice
import androidx.lifecycle.Lifecycle
import java.io.File
import java.time.Instant
import java.time.LocalDate
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.data.*
import ru.genesis.calendar.domain.*
import ru.genesis.calendar.domain.habits.*
import ru.genesis.calendar.ui.*

class HabitTimerFlowTest {
    @get:Rule val compose = createAndroidComposeRule<StoicheionGestureActivity>()

    @Test fun launchPauseBackgroundRecoverFinishFailedSaveAndRetryKeepOneReceipt() {
        val app = compose.activity.application as GenesisApplication
        check(BuildConfig.DEBUG && app.packageName.endsWith(".debug") && app.workspaceScope == "internal-validation-v1")
        val repository = HabitsRepository(app)
        fun saved() = runBlocking { repository.workspace.first() }
        fun readyAction(tag: String): SemanticsNodeInteraction {
            // A committed Room state can precede completion of the UI command callback.
            compose.waitUntil(15_000) { runCatching { compose.onNodeWithTag(tag).assertIsEnabled() }.isSuccess }
            return compose.onNodeWithTag(tag).performScrollTo().assertIsEnabled()
        }
        check(HabitTimers.sessions(saved().timers).none {
            it.root.owner == repository.timerOwner && it.state?.status !in setOf("saved", "discarded")
        }) { "A pre-existing timer belongs to another invocation; this test will not discard it" }
        val date = LocalDate.now()
        val habit = Habit(TrackerEntity.create("habit", id = "e1-timer-${UUID.randomUUID()}"), "E1 · Чтение", date,
            HabitEngine(GenesisCalendar()).defaultSchedule(date, CalendarMode.PROFANE),
            measurement = HabitMeasurement("duration", "min", 1000, 1000))
        var render by mutableStateOf(true)
        try {
        runBlocking { repository.save(habit) }
        var dark by mutableStateOf(false)
        var failSave = true
        var requested by mutableStateOf<String?>(habit.id)
        var mount by mutableIntStateOf(0)
        val renderedTimer = AtomicReference<LocalHabitWorkspace?>(null)
        val commandTrace = CopyOnWriteArrayList<JSONObject>()
        fun trace(phase: String, command: HabitTimerCommand, failure: Throwable? = null) {
            commandTrace += JSONObject().put("phase", phase).put("action", command.action).put("id", command.id)
                .put("sessionId", command.sessionId ?: JSONObject.NULL).put("at", command.at)
                .put("ownerMatches", command.owner == repository.timerOwner)
                .put("exceptionClass", failure?.javaClass?.name ?: JSONObject.NULL)
                .put("domainCode", failure?.message?.takeIf { it.matches(Regex("HABIT_TIMER_[A-Z_]+")) } ?: JSONObject.NULL)
        }
        compose.setContent {
            val workspace by repository.workspace.collectAsState(initial = LocalHabitWorkspace())
            val timerInput = workspace
            SideEffect { renderedTimer.set(timerInput) }
            if (render) MaterialTheme(colorScheme = if (dark) evening else standart) {
                CompositionLocalProvider(LocalGenesisLanguage provides "ru", LocalEveningTheme provides dark) {
                    Surface(Modifier.fillMaxSize().safeDrawingPadding()) {
                        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState())) {
                            key(mount) {
                                HabitTimerShelf(timerInput, repository.timerOwner, requested, { requested = null }) { command ->
                                    trace("entered", command)
                                    try {
                                        if (command.action == "save" && failSave) { failSave = false; error("Synthetic durable storage failure") }
                                        repository.applyTimer(command); trace("returned", command); Unit
                                    } catch (failure: Throwable) { trace("failed", command, failure); throw failure }
                                }
                            }
                        }
                    }
                }
            }
        }
        compose.waitUntil(15_000) {
            runCatching { compose.onNodeWithTag("habit-timer-start", useUnmergedTree = true).assertIsEnabled() }.isSuccess
        }
        val startButton = compose.onNodeWithTag("habit-timer-start", useUnmergedTree = true)
            .performScrollTo().assertIsEnabled().assertHeightIsAtLeast(48.dp)
        val startBounds = startButton.fetchSemanticsNode().boundsInRoot
        for (kind in listOf("stopwatch", "pomodoro")) {
            val modeBounds = compose.onNodeWithTag("habit-timer-mode-$kind", useUnmergedTree = true)
                .assertIsEnabled().fetchSemanticsNode().boundsInRoot
            assertEquals(startBounds.width, modeBounds.width, 1f)
            assertEquals(startBounds.height, modeBounds.height, 1f)
            assertEquals(startBounds.center.y, modeBounds.center.y, 1f)
        }
        startButton.performTouchInput { click(center) }
        try {
            compose.waitUntil(15_000) { HabitTimers.sessions(saved().timers).any { it.root.habitId == habit.id } }
        } catch (failure: Throwable) {
            runCatching {
                fun state(value: LocalHabitWorkspace): JSONObject {
                    val sessions = HabitTimers.sessions(value.timers).filter { it.root.habitId == habit.id }
                    return JSONObject().put("revision", value.revision).put("timerOperations", value.timers.size)
                        .put("syntheticSessionCount", sessions.size)
                        .put("statuses", JSONArray(sessions.map { it.state?.status ?: "conflict" }))
                        .put("ownerPendingStatuses", JSONArray(HabitTimers.sessions(value.timers).filter {
                            it.root.owner == repository.timerOwner && it.state?.status !in setOf("saved", "discarded")
                        }.map { it.state?.status ?: "conflict" }))
                }
                val proof = JSONObject().put("checkpoint", "original-start-wait-failed").put("syntheticHabitId", habit.id)
                    .put("startEnabledBefore", true).put("startBounds", JSONObject().put("left", startBounds.left)
                        .put("top", startBounds.top).put("right", startBounds.right).put("bottom", startBounds.bottom))
                    .put("commandTrace", JSONArray(commandTrace.toList())).put("freshSaved", state(saved()))
                    .put("requestedStillTargetsHabit", requested == habit.id).put("probeWritesToDatabase", false)
                    .put("probeRetriedStart", false)
                    .put("startEnabledAfter", JSONArray(compose.onAllNodesWithTag("habit-timer-start", useUnmergedTree = true)
                        .fetchSemanticsNodes().map { !it.config.contains(SemanticsProperties.Disabled) }))
                renderedTimer.get()?.let { proof.put("renderedAfter", state(it)) }
                proof.put("screenshotSaved", UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).takeScreenshot(
                    File(app.getExternalFilesDir(null), "e1-timer-start-timeout.png")))
                File(app.getExternalFilesDir(null), "e1-timer-start-timeout.json").writeText(proof.toString(2))
            }.onFailure { android.util.Log.e("GENESIS_TIMER_DIAG", "Passive start diagnostic failed: ${it.javaClass.simpleName}") }
            throw failure
        }
        val sessionId = HabitTimers.sessions(saved().timers).single { it.root.habitId == habit.id }.id
        val pauseAction = readyAction("habit-timer-pause")
        val pauseBefore = compose.onAllNodesWithTag("habit-timer-pause").fetchSemanticsNodes()
            .map { !it.config.contains(SemanticsProperties.Disabled) }
        val traceBeforePause = JSONArray(commandTrace.toList())
        pauseAction.performClick()
        try {
            compose.waitUntil(15_000) { HabitTimers.sessions(saved().timers).single { it.id == sessionId }.state?.status == "paused" }
        } catch (failure: Throwable) {
            runCatching {
                fun state(value: LocalHabitWorkspace): JSONObject {
                    val session = HabitTimers.sessions(value.timers).firstOrNull { it.id == sessionId }
                    return JSONObject().put("revision", value.revision).put("timerOperations", value.timers.size)
                        .put("sessionPresent", session != null).put("status", session?.state?.status ?: JSONObject.NULL)
                        .put("headStatuses", JSONArray(session?.heads?.map { it.status }.orEmpty()))
                        .put("epochMatches", session?.root?.epoch == value.timerEpoch)
                        .put("ownerMatches", session?.root?.owner == repository.timerOwner)
                }
                val proof = JSONObject().put("checkpoint", "original-pause-wait-failed").put("syntheticHabitId", habit.id)
                    .put("sessionId", sessionId).put("pauseEnabledBefore", JSONArray(pauseBefore))
                    .put("traceBeforePause", traceBeforePause).put("commandTrace", JSONArray(commandTrace.toList()))
                    .put("freshSaved", state(saved())).put("probeWritesToDatabase", false).put("probeRetriedPause", false)
                    .put("pauseEnabledAfter", JSONArray(compose.onAllNodesWithTag("habit-timer-pause").fetchSemanticsNodes()
                        .map { !it.config.contains(SemanticsProperties.Disabled) }))
                renderedTimer.get()?.let { proof.put("renderedAfter", state(it)) }
                proof.put("screenshotSaved", UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).takeScreenshot(
                    File(app.getExternalFilesDir(null), "e1-timer-pause-timeout.png")))
                File(app.getExternalFilesDir(null), "e1-timer-pause-timeout.json").writeText(proof.toString(2))
            }.onFailure { android.util.Log.e("GENESIS_TIMER_DIAG", "Passive pause diagnostic failed: ${it.javaClass.simpleName}") }
            throw failure
        }
        val paused = HabitTimers.reading(HabitTimers.sessions(saved().timers).single { it.id == sessionId }.state!!).workMs
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val device = UiDevice.getInstance(instrumentation)
        val host = compose.activity
        val monitor = ActivityLifecycleMonitorRegistry.getInstance()
        fun awaitHostStage(expected: Stage) {
            val observed = AtomicReference<Stage>()
            compose.waitUntil(15_000) {
                instrumentation.runOnMainSync {
                    observed.set(monitor.getLifecycleStageOf(host))
                }
                observed.get() == expected
            }
        }
        val taskId = host.taskId
        device.pressHome()
        // Home and moveToFront are separate ActivityManager transitions. Issuing the
        // second before the first has stopped this host races the API26 launcher.
        // Poll raw stages: ActivityScenario.state throws during a transient STARTED.
        awaitHostStage(Stage.STOPPED)
        assertEquals(Lifecycle.State.CREATED, compose.activityRule.scenario.state)
        // Bring back this exact host; API28 may resolve a fresh instance for a reordered Intent.
        app.getSystemService(ActivityManager::class.java).appTasks.single { it.taskInfo?.id == taskId }.moveToFront()
        awaitHostStage(Stage.RESUMED)
        assertEquals(Lifecycle.State.RESUMED, compose.activityRule.scenario.state)
        compose.waitUntil(15_000) { runCatching {
            compose.onAllNodesWithTag("habit-timer-resume").fetchSemanticsNodes().isNotEmpty()
        }.getOrDefault(false) }
        compose.runOnIdle { mount++; dark = true }
        readyAction("habit-timer-resume").performClick()
        compose.waitUntil(15_000) { HabitTimers.sessions(saved().timers).single { it.id == sessionId }.state?.status == "running" }
        val recovered = runBlocking { HabitsRepository(app).workspace.first() }
        assertTrue(HabitTimers.reading(HabitTimers.sessions(recovered.timers).single { it.id == sessionId }.state!!).workMs >= paused)
        readyAction("habit-timer-finish").performClick()
        compose.waitUntil(15_000) { HabitTimers.sessions(saved().timers).single { it.id == sessionId }.state?.status == "finished" }
        compose.onNodeWithTag("habit-timer-review").performScrollTo().assertExists()
        assertTrue(device.takeScreenshot(File(app.getExternalFilesDir(null), "e1-timer-review-dark.png")))
        compose.runOnIdle { dark = false }
        readyAction("habit-timer-save")
        assertTrue(device.takeScreenshot(File(app.getExternalFilesDir(null), "e1-timer-review-light.png")))
        readyAction("habit-timer-save").performClick()
        readyAction("habit-timer-retry")
        assertEquals("finished", HabitTimers.sessions(saved().timers).single { it.id == sessionId }.state!!.status)
        readyAction("habit-timer-retry").performClick()
        compose.waitUntil(15_000) { HabitTimers.sessions(saved().timers).single { it.id == sessionId }.state?.status == "saved" }
        val result = saved()
        assertEquals(1, result.measurements.count { it.habitId == habit.id })
        runBlocking { repository.applyTimer(HabitTimerCommand("save", repository.timerOwner, Instant.now().toString(), "retry-save", sessionId)) }
        assertEquals(result.measurements, saved().measurements)
        assertEquals(result.completions.sumOf { it.xpAwarded }, saved().completions.sumOf { it.xpAwarded })
        } finally {
            compose.runOnIdle { render = false }; compose.waitForIdle()
            cleanupOwnedHabitFixtureRows(app, setOf(habit.id))
        }
    }
}
