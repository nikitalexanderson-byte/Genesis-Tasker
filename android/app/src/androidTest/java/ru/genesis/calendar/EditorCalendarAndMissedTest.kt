package ru.genesis.calendar

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.Modifier
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.data.LocalTask
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.ui.EditorCalendarModePicker
import ru.genesis.calendar.ui.TodayMissedTasksCard
import ru.genesis.calendar.ui.standart

class EditorCalendarAndMissedTest {
    @get:Rule val compose = createAndroidComposeRule<StoicheionGestureActivity>()

    @Test fun editorModeChangesOnlyLocalState() {
        val default = CalendarMode.PROFANE
        var selected by mutableStateOf(default)
        compose.setContent { MaterialTheme(colorScheme = standart) {
            Surface(Modifier.fillMaxSize()) { Column(Modifier.safeDrawingPadding()) {
                EditorCalendarModePicker(selected, { selected = it }, tag = "test-form-calendar")
            } }
        } }
        compose.onNodeWithTag("test-form-calendar-profane").assertIsSelected()
        compose.onNodeWithTag("test-form-calendar-lunar").performClick()
        compose.onNodeWithTag("test-form-calendar-lunar").assertIsSelected()
        assertEquals(CalendarMode.LUNAR, selected)
        assertEquals(CalendarMode.PROFANE, default)
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        captureNativeWindow(File(context.getExternalFilesDir(null), "editor-calendar-after.png"))
    }

    @Test fun missedTaskOffersCompleteAndMoveToToday() {
        val task = LocalTask(id = "missed-preview", title = "Завершить план", date = "2026-09-28")
        var completed = 0
        var moved = 0
        compose.setContent { MaterialTheme(colorScheme = standart) {
            Surface(Modifier.fillMaxSize()) { Column(Modifier.safeDrawingPadding()) {
                TodayMissedTasksCard(listOf(task), { completed++ }, { moved++ })
            } }
        } }
        compose.onNodeWithTag("today-missed-tasks").assertExists()
        compose.onNodeWithTag("complete-missed-${task.id}").assertContentDescriptionEquals(task.title).performClick()
        compose.onNodeWithTag("move-missed-${task.id}").performClick()
        assertEquals(1, completed)
        assertEquals(1, moved)
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        captureNativeWindow(File(context.getExternalFilesDir(null), "today-missed-tasks.png"))
    }
}
