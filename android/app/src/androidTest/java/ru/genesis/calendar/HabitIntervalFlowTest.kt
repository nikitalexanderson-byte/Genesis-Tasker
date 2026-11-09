package ru.genesis.calendar

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import java.io.File
import java.time.LocalDate
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.data.HabitsRepository
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.ui.HabitsScreen
import ru.genesis.calendar.ui.standart

class HabitIntervalFlowTest {
    @get:Rule val compose=createAndroidComposeRule<StoicheionGestureActivity>()

    @Test fun createMarkReloadAndChangeCompletionMode() {
        val app=compose.activity.application as GenesisApplication
        check(BuildConfig.DEBUG && app.packageName.endsWith(".debug") && app.workspaceScope=="internal-validation-v1")
        val repository=HabitsRepository(app)
        val title="UX: Повторять каждые полчаса в выбранном промежутке ${java.util.UUID.randomUUID()}"
        var render by mutableStateOf(true)
        var ownedId: String? = null
        fun saved()=runBlocking { repository.workspace.first() }
        fun screenshot(name: String) {
            assertTrue(UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).takeScreenshot(
                File(app.getExternalFilesDir(null),"habit-interval-$name.png")))
        }
        try {
        compose.setContent {
            if (render) MaterialTheme(colorScheme=standart) {
                Surface(Modifier.fillMaxSize().safeDrawingPadding()) {
                    HabitsScreen(app,true,inputCalendarMode=CalendarMode.PROFANE)
                }
            }
        }
        compose.waitUntil(15_000) { runCatching { compose.onNodeWithTag("habit-create").assertIsEnabled() }.isSuccess }
        compose.onNodeWithTag("habit-create").performClick()
        compose.onNodeWithText("Название").performTextInput(title)
        compose.onNodeWithTag("habit-interval-enabled").performScrollTo().performClick()
        compose.onNodeWithTag("habit-interval-minutes").performScrollTo().performTextReplacement("0")
        compose.onNodeWithText("Сохранить").performScrollTo().assertIsNotEnabled()
        compose.onNodeWithTag("habit-interval-minutes").performScrollTo().performTextReplacement("30")
        compose.onNode(hasAnyAncestor(hasTestTag("habit-interval-end")) and hasClickAction())
            .performScrollTo().performClick()
        repeat(8) { compose.onNodeWithText("Час −").performScrollTo().performClick() }
        compose.onNodeWithText("Готово").performScrollTo().performClick()
        compose.onNodeWithTag("habit-interval-mode-each").performScrollTo().assertIsSelected()
        screenshot("editor")
        compose.onNodeWithText("Сохранить").performScrollTo().assertIsEnabled().performClick()
        compose.waitUntil(15_000) { saved().habits.any { it.title==title } }
        val habit=saved().habits.single { it.title==title }
        ownedId = habit.id
        assertEquals(listOf("09:00","09:30","10:00"),habit.intervalSchedule!!.times())
        val ownCard = hasAnyAncestor(hasTestTag("habit-card-${habit.id}"))
        fun ownNode(tag: String) = compose.onNode(hasTestTag(tag) and ownCard)
        val actionTrace = mutableListOf<JSONObject>()
        fun readiness(phase: String, tag: String, time: String): JSONObject {
            val nodes = compose.onAllNodes(hasTestTag(tag) and ownCard).fetchSemanticsNodes()
            return JSONObject().put("phase", phase).put("time", time).put("tag", tag)
                .put("nodes", nodes.size).put("enabled", JSONArray(nodes.map { !it.config.contains(SemanticsProperties.Disabled) }))
                .put("selected", JSONArray(nodes.map { it.config.getOrNull(SemanticsProperties.Selected) ?: JSONObject.NULL }))
                .put("ownGridNodes", compose.onAllNodes(hasTestTag("habit-interval-grid") and ownCard).fetchSemanticsNodes().size)
        }
        fun failureProof(stage: String, tag: String, time: String, failure: Throwable) = runCatching {
            val state = saved()
            val entry = state.completions.firstOrNull { it.habitId == habit.id && it.date == LocalDate.now() }
            val proof = readiness(stage, tag, time).put("checkpoint", "interval-original-action-failed")
                .put("syntheticHabitId", habit.id).put("revision", state.revision)
                .put("completed", entry?.completed ?: false).put("completedTimes", JSONArray(entry?.completedTimes.orEmpty()))
                .put("xpAwarded", entry?.xpAwarded ?: 0).put("actionTrace", JSONArray(actionTrace))
                .put("exceptionClass", failure.javaClass.name).put("callbackInstrumented", false)
                .put("probeWritesToDatabase", false).put("probeExpandedGrid", false)
            proof.put("screenshotSaved", UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).takeScreenshot(
                File(app.getExternalFilesDir(null), "habit-interval-action-failed.png")))
            File(app.getExternalFilesDir(null), "habit-interval-action-failed.json").writeText(proof.toString(2))
        }.onFailure { android.util.Log.e("GENESIS_INTERVAL_DIAG", "Passive action diagnostic failed: ${it.javaClass.simpleName}") }
        fun readyOwnAction(tag: String, time: String): SemanticsNodeInteraction {
            actionTrace += readiness("before-ready-wait", tag, time)
            try {
                // Room can emit a mark before the host's async command callback clears busy.
                compose.waitUntil(15_000) { runCatching { ownNode(tag).assertIsEnabled() }.isSuccess }
                val action = ownNode(tag).performScrollTo().assertIsEnabled()
                actionTrace += readiness("ready-before-click", tag, time)
                return action
            } catch (failure: Throwable) { failureProof("ready-wait-failed", tag, time, failure); throw failure }
        }
        ownNode("habit-interval-marks-toggle").performScrollTo().performClick()
        val gridsAfterOpen = compose.onAllNodes(hasTestTag("habit-interval-grid") and ownCard).fetchSemanticsNodes().size
        for(time in listOf("09:00","09:30","10:00")) {
            val tag = "habit-interval-mark-$time"
            val action = readyOwnAction(tag, time)
            try {
                action.performClick(); actionTrace += readiness("click-requested", tag, time)
                compose.waitUntil(15_000) { saved().completions.firstOrNull { it.habitId==habit.id }?.completedTimes?.contains(time)==true }
                actionTrace += JSONObject().put("phase", "persisted-mark").put("time", time)
            } catch (failure: Throwable) { failureProof("original-mark-wait-failed", tag, time, failure); throw failure }
        }
        val entry=saved().completions.single { it.habitId==habit.id && it.date==LocalDate.now() }
        assertTrue(entry.completed)
        assertEquals(10,entry.xpAwarded)
        compose.waitUntil(15_000) { compose.onAllNodes(hasText("3 / 3", substring = true) and ownCard).fetchSemanticsNodes().isNotEmpty() }
        ownNode("habit-interval-marks-toggle").performScrollTo()
        compose.waitForIdle()
        screenshot("marked")
        // A fresh repository reads the encrypted persisted document.
        assertTrue(runBlocking { HabitsRepository(app).workspace.first() }.completions.single { it.habitId==habit.id }.completed)
        if (compose.onAllNodes(hasTestTag("habit-interval-mark-09:30") and ownCard).fetchSemanticsNodes().isEmpty()) runCatching {
            val state = saved(); val current = state.completions.single { it.habitId == habit.id && it.date == LocalDate.now() }
            val proof = JSONObject().put("checkpoint", "before-original-unmark")
                .put("syntheticHabitId", habit.id).put("revision", state.revision).put("completed", current.completed)
                .put("completedTimes", JSONArray(current.completedTimes)).put("xpAwarded", current.xpAwarded)
                .put("intervalMode", state.habits.single { it.id == habit.id }.intervalSchedule?.completionMode)
                .put("gridsAfterOpen", gridsAfterOpen)
                .put("ownCardNodes", compose.onAllNodesWithTag("habit-card-${habit.id}").fetchSemanticsNodes().size)
                .put("ownGridNodes", compose.onAllNodes(hasTestTag("habit-interval-grid") and ownCard).fetchSemanticsNodes().size)
                .put("ownToggleNodes", compose.onAllNodes(hasTestTag("habit-interval-marks-toggle") and ownCard).fetchSemanticsNodes().size)
                .put("ownMissingMarkNodes", compose.onAllNodes(hasTestTag("habit-interval-mark-09:30") and ownCard).fetchSemanticsNodes().size)
                .put("probeWritesToDatabase", false).put("probeExpandedGrid", false)
            proof.put("screenshotSaved", UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).takeScreenshot(
                File(app.getExternalFilesDir(null), "habit-interval-missing-unmark.png")))
            File(app.getExternalFilesDir(null), "habit-interval-missing-unmark.json").writeText(proof.toString(2))
        }.onFailure { android.util.Log.e("GENESIS_INTERVAL_DIAG", "Passive interval diagnostic failed: ${it.javaClass.simpleName}") }
        val unmarkTag = "habit-interval-mark-09:30"
        val unmarkAction = readyOwnAction(unmarkTag, "09:30")
        try {
            unmarkAction.performClick(); actionTrace += readiness("unmark-requested", unmarkTag, "09:30")
            compose.waitUntil(15_000) { saved().completions.single { it.habitId==habit.id }.completed.not() }
        } catch (failure: Throwable) { failureProof("original-unmark-wait-failed", unmarkTag, "09:30", failure); throw failure }
        val editButton=hasTestTag("habit-actions-${habit.id}")
        compose.waitUntil(15_000) { compose.onAllNodes(editButton and isEnabled()).fetchSemanticsNodes().isNotEmpty() }
        compose.mainClock.advanceTimeBy(1000)
        compose.onNode(editButton).performScrollTo().assertIsEnabled()
        val device=UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        repeat(6) {
            if(!compose.onNode(editButton).isDisplayed()) {
                device.swipe(device.displayWidth/2,device.displayHeight*4/5,
                    device.displayWidth/2,device.displayHeight/3,30)
                compose.waitForIdle()
            }
        }
        compose.onNode(editButton).assertIsDisplayed()
        screenshot("before-edit")
        compose.onNode(editButton).performClick()
        compose.onNodeWithTag("edit-habit-${habit.id}").assertIsEnabled().performClick()
        compose.waitUntil(15_000) { compose.onAllNodesWithTag("habit-editor-close").fetchSemanticsNodes().isNotEmpty() }
        screenshot("edit-reopened")
        val timerHistory = saved().timers
        compose.onNodeWithTag("habit-timer-enabled").performScrollTo().assertIsOn().performClick().assertIsOff()
        compose.onNodeWithTag("habit-interval-mode-day").performScrollTo().performClick().assertIsSelected()
        compose.onNodeWithText("Сохранить").performScrollTo().performClick()
        compose.waitUntil(15_000) { saved().habits.single { it.id==habit.id }.let {
            it.intervalSchedule?.completionMode=="day" && !it.timerEnabled
        } }
        ownNode("habit-timer-open-${habit.id}").assertDoesNotExist()
        compose.onNodeWithTag("habit-timer-panel").assertDoesNotExist()
        assertEquals("Disabling a timer preserves all timer history", timerHistory, saved().timers)
        compose.onNode(editButton).performScrollTo().performClick()
        compose.onNodeWithTag("edit-habit-${habit.id}").performClick()
        compose.onNodeWithTag("habit-timer-enabled").performScrollTo().assertIsOff().performClick().assertIsOn()
        compose.onNodeWithText("Сохранить").performScrollTo().performClick()
        compose.waitUntil(15_000) { saved().habits.single { it.id==habit.id }.timerEnabled }
        ownNode("habit-timer-open-${habit.id}").assertExists()
        assertEquals("Re-enabling a timer preserves all timer history", timerHistory, saved().timers)
        ownNode("habit-interval-marks-toggle").assertDoesNotExist()
        readyOwnAction("habit-complete-${habit.id}", "daily").performClick()
        compose.waitUntil(15_000) { saved().completions.single { it.habitId==habit.id }.completed }
        screenshot("daily")
        } finally {
            compose.runOnIdle { render = false }; compose.waitForIdle()
            val ids = ownedId?.let { setOf(it) } ?: saved().habits.filter { it.title == title }.map { it.id }.toSet()
            cleanupOwnedHabitFixtureRows(app, ids)
        }
    }
}
