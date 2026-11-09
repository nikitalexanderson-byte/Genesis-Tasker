package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.StoicheionGestureActivity
import ru.genesis.calendar.captureNativeWindow
import ru.genesis.calendar.data.LocalPreferences
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.GenesisCalendar
import ru.genesis.calendar.domain.habits.*
import java.io.File
import java.time.LocalDate

class HabitIntervalGridTest {
    @get:Rule val compose = createAndroidComposeRule<StoicheionGestureActivity>()

    @Test fun rowsKeepTheirColumnsAfterSelectionInBothTimeFormats() {
        val args = InstrumentationRegistry.getArguments()
        val width = args.getString("genesisWidth")?.toIntOrNull() ?: 390
        val font = args.getString("genesisFontScale")?.toFloatOrNull() ?: 1f
        val dark = args.getString("genesisDark") == "true"
        val app = compose.activity.application as GenesisApplication
        check(ru.genesis.calendar.BuildConfig.DEBUG && app.workspaceScope == "internal-validation-v1")
        val prefs = LocalPreferences(app, app.workspaceScope)
        val original = runBlocking { prefs.values.first() }
        val today = LocalDate.now()
        val habit = Habit(TrackerEntity.create("grid"), "Повторения", today,
            HabitEngine(GenesisCalendar()).defaultSchedule(today, CalendarMode.PROFANE),
            intervalSchedule = HabitIntervalSchedule(90, "11:00", "22:00"))
        var marked by mutableStateOf(emptyList<String>())
        try {
            runBlocking { prefs.set("time", "24h") }
            compose.setContent {
                CompositionLocalProvider(LocalDensity provides Density(
                    compose.activity.resources.displayMetrics.widthPixels.toFloat() / width, font),
                    LocalGenesisLanguage provides "ru", LocalEveningTheme provides dark) {
                    MaterialTheme(colorScheme = if (dark) evening else standart, typography = GenesisTypography, shapes = GenesisShapes) {
                        Surface(Modifier.fillMaxSize()) {
                            Column(Modifier.fillMaxWidth().padding(32.dp)) {
                                HabitIntervalMarks(habit, HabitCompletion(TrackerEntity.create("marks"), habit.id, today,
                                    completedTimes = marked), true) { time, selected ->
                                    marked = if (selected) marked + time else marked - time
                                }
                            }
                        }
                    }
                }
            }
            compose.onNodeWithTag("habit-interval-marks-toggle").performClick()
            for (use24 in listOf(true, false)) {
                runBlocking { prefs.set("time", if (use24) "24h" else "12h") }
                compose.waitUntil(5000) {
                    compose.onAllNodesWithText(if (use24) "11:00" else "11:00 AM").fetchSemanticsNodes().isNotEmpty()
                }
                fun cells() = habit.intervalSchedule!!.times().map {
                    compose.onNodeWithTag("habit-interval-mark-$it").assertHeightIsAtLeast(48.dp).fetchSemanticsNode().boundsInRoot
                }
                val before = cells()
                val firstRow = before.filter { kotlin.math.abs(it.top - before.first().top) < 1f }
                before.forEachIndexed { index, cell ->
                    assertEquals(before.first().width, cell.width, 1f)
                    assertEquals(firstRow[index % firstRow.size].left, cell.left, 1f)
                    assertEquals(before.first().height, cell.height, 1f)
                }
                compose.onNodeWithTag("habit-interval-mark-12:30").performClick().assertIsSelected()
                assertEquals(before, cells())
                captureNativeWindow(File(app.getExternalFilesDir(null),
                    "interval-grid-$width-$dark-$font-$use24.png"))
                compose.onNodeWithTag("habit-interval-mark-12:30").performClick().assertIsNotSelected()
            }
        } finally { runBlocking { prefs.set("time", if (original.use24) "24h" else "12h") } }
    }
}
