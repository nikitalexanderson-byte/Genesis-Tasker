package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.habits.HabitTimerPreferences
import ru.genesis.calendar.captureNativeWindow
import java.io.File
import org.json.JSONObject

/** Shipped controls, isolated debug process and synthetic data only. */
class PiNextControlsTest {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    private val app get() = compose.activity.application as GenesisApplication
    private val dark get() = InstrumentationRegistry.getArguments().getString("genesisDark") == "true"
    @Composable private fun Frame(content: @Composable () -> Unit) {
        CompositionLocalProvider(LocalGenesisLanguage provides "ru", LocalEveningTheme provides dark) {
            MaterialTheme(colorScheme = if (dark) evening else standart, typography = GenesisTypography, shapes = GenesisShapes) {
                Surface(Modifier.fillMaxSize()) { content() }
            }
        }
    }
    private fun capture(name: String) {
        compose.waitForIdle()
        captureNativeWindow(File(app.getExternalFilesDir(null), "pi-next-${if(dark)"dark"else"light"}-$name.png"))
    }
    @Test fun taskStartsInReadingAndOnlyItsEditButtonEnablesFields() {
        var editing by mutableStateOf(false)
        compose.setContent { Frame {
            SharedTaskDialog("Synthetic π task", editing, true, false, { editing = true }, {}, {}) {
                if (editing) androidx.compose.material3.OutlinedTextField("Synthetic title", {}, Modifier.testTag("pi-title-editor"))
                else {
                    SharedTaskReadSummary(JSONObject().put("dueDate", "2026-11-01"), emptyList(), emptyList(), CalendarMode.PROFANE)
                    Text("Описание"); Text("Содержание задачи и свойства доступны для чтения.")
                }
            }
        } }
        compose.onNodeWithTag("pi-title-editor").assertDoesNotExist()
        compose.onNodeWithText("Описание").assertIsDisplayed()
        val editBounds = compose.onNodeWithTag("shared-task-edit").assertHasClickAction().fetchSemanticsNode().boundsInRoot
        val summaryBounds = compose.onNodeWithTag("shared-task-read-summary").fetchSemanticsNode().boundsInRoot
        val density = compose.activity.resources.displayMetrics.density
        assertTrue(editBounds.width / density >= 47.9f && editBounds.height / density >= 47.9f)
        assertEquals(summaryBounds.right, editBounds.right, 1f)
        capture("task-reading")
        compose.onNodeWithTag("shared-task-edit").performClick()
        compose.onNodeWithTag("pi-title-editor").assertIsDisplayed()
        capture("task-editing")
    }
    @Test fun timerCanBeDisabledAndModesAndIntervalsCanBeEditedWithoutLosingTheSelection() {
        var enabled by mutableStateOf(true)
        var preferences by mutableStateOf(HabitTimerPreferences())
        var valid = true
        compose.setContent { Frame { Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp)) {
            HabitTimerPreferenceFields(enabled, { enabled = it }, preferences, true, { preferences = it }, { valid = it })
        } } }
        compose.onNodeWithTag("habit-timer-allow-stopwatch").performScrollTo().performClick()
        compose.runOnIdle { assertEquals(listOf("pomodoro"), preferences.modes) }
        compose.onNodeWithTag("habit-timer-allow-pomodoro").assertIsNotEnabled()
        compose.onNodeWithTag("habit-timer-work").performScrollTo().performTextReplacement("40")
        compose.onNodeWithTag("habit-timer-rest").performScrollTo().performTextReplacement("8")
        compose.onNodeWithTag("habit-timer-progress-time-only").performScrollTo().performClick()
        compose.runOnIdle { assertEquals(40, preferences.workMinutes); assertEquals(8, preferences.breakMinutes); assertEquals("time-only", preferences.progress); assertTrue(valid) }
        capture("timer-pomodoro")
        compose.onNodeWithTag("habit-timer-work").performScrollTo().performTextReplacement("")
        compose.runOnIdle { assertFalse(valid) }
        compose.onNodeWithTag("habit-timer-enabled").performScrollTo().performClick()
        compose.runOnIdle { assertFalse(enabled); assertTrue(valid) }
        compose.onNodeWithTag("habit-timer-work").assertDoesNotExist()
    }
    @Test fun shortConfirmationIsCompactAndLongManagementKeepsItsBoundedBody() {
        var confirmation by mutableStateOf(false)
        compose.setContent { Frame {
            if (confirmation) AlertDialog({}, { Button({}) { Text("Подтвердить") } }, title = { Text("Подтверждение") }, text = { Text("Synthetic confirmation") })
            else SharedManagementDialog("Synthetic management", {}, true) {
                repeat(40) { Text("Содержимое $it") }
            }
        } }
        val bounds = compose.onNodeWithTag("genesis-modal-surface").fetchSemanticsNode().boundsInRoot
        compose.runOnIdle { confirmation = true }
        val confirmationBounds = compose.onNodeWithTag("genesis-modal-surface").fetchSemanticsNode().boundsInRoot
        assertEquals(bounds.width, confirmationBounds.width, 1f)
        assertTrue("A short confirmation must not inherit the full editor height", confirmationBounds.height < bounds.height * .7f)
        compose.onNodeWithText("Подтвердить").assertIsDisplayed()
        capture("standard-confirmation")
    }
}
