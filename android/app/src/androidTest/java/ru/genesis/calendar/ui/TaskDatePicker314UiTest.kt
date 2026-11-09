package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.data.UiPreferences
import ru.genesis.calendar.data.WorkspaceStructure
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.GenesisCalendar
import java.time.LocalDate

/** Uses the real editor and picker, including months whose calendar grid shrinks to four weeks. */
class TaskDatePicker314UiTest {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()

    @Test fun selectingFebruaryInThePickerAlonePreservesItsComposition() {
        var value by mutableStateOf("2027-01-31")
        compose.setContent {
            CompositionLocalProvider(LocalGenesisLanguage provides "ru", LocalSacredFeaturesEnabled provides true) {
                MaterialTheme(colorScheme = standart, typography = GenesisTypography, shapes = GenesisShapes) {
                    Surface(Modifier.fillMaxSize()) { AuthorDatePicker(value, CalendarMode.PROFANE) { value = it } }
                }
            }
        }
        compose.onNodeWithText("2027-01-31").performClick()
        compose.onNodeWithText("→").performClick()
        compose.onNodeWithContentDescription("2027-02-28").performScrollTo().performClick()
        compose.onNodeWithText("2027-02-28").assertIsDisplayed()
        compose.runOnIdle { assertEquals("2027-02-28", value) }
    }

    @Test fun februarySelectionAndMonthLengthChangesPreserveTheTaskDateInAllCalendars() {
        val calendar = GenesisCalendar()
        var mode by mutableStateOf(CalendarMode.PROFANE)
        var initial by mutableStateOf("2027-01-31")
        var instance by mutableIntStateOf(0)
        var saved: ru.genesis.calendar.data.LocalTask? = null
        compose.setContent {
            CompositionLocalProvider(LocalGenesisLanguage provides "ru", LocalSacredFeaturesEnabled provides true) {
                MaterialTheme(colorScheme = standart, typography = GenesisTypography, shapes = GenesisShapes) {
                    Surface(Modifier.fillMaxSize()) {
                        key(instance) { TaskEditor(null, initial, UiPreferences(input = mode), WorkspaceStructure(), null,
                            null, emptyList(), null, onDismiss = {}, onSave = { saved = it }, onTransfer = null,
                            onDelete = null, onDeleteOccurrence = null, showSelectedOccurrence = false) }
                    }
                }
            }
        }
        val cases = listOf(
            Triple(CalendarMode.PROFANE, "2027-01-31", "2027-02-28"),
            Triple(CalendarMode.PROFANE, "2027-03-31", "2027-04-30"),
            Triple(CalendarMode.PROFANE, "2028-01-31", "2028-02-29"),
            Triple(CalendarMode.SACRED, "2027-01-31", "2027-02-28"),
            Triple(CalendarMode.LUNAR, "2027-01-31", "2027-02-28"))
        for ((index, case) in cases.withIndex()) {
            compose.runOnIdle { mode = case.first; initial = case.second; instance++; saved = null }
            compose.onNodeWithTag("task-title").performTextReplacement("QA Π date $index")
            android.util.Log.i("Date314", "editor open picker ${case.first} ${case.second}")
            compose.onNode(hasText(calendar.formatDate(LocalDate.parse(case.second), case.first)) and hasClickAction())
                .performScrollTo().performClick()
            var shown = LocalDate.parse(case.second)
            val target = LocalDate.parse(case.third)
            while (target !in calendar.monthRange(shown, case.first).let { it.start..it.end }) {
                android.util.Log.i("Date314", "editor next ${case.first} $shown")
                compose.onNodeWithText("→").performScrollTo().performClick()
                shown = calendar.monthRange(shown, case.first).end.plusDays(1)
            }
            android.util.Log.i("Date314", "editor choose ${case.first} $target")
            compose.onNodeWithContentDescription(calendar.formatDate(target, case.first)).performScrollTo().performClick()
            compose.onNodeWithTag("task-title").assertExists()
            compose.onNode(hasText(calendar.formatDate(target, case.first)) and hasClickAction()).assertExists()
            compose.runOnUiThread { androidx.core.view.WindowCompat.getInsetsController(compose.activity.window, compose.activity.window.decorView).hide(androidx.core.view.WindowInsetsCompat.Type.ime()) }
            compose.waitForIdle()
            compose.onNodeWithTag("save-task").assertIsDisplayed().assertIsEnabled().performClick()
            compose.waitUntil(10_000) { saved != null }
            compose.runOnIdle { assertEquals(target.toString(), saved?.date) }
        }
    }
}
