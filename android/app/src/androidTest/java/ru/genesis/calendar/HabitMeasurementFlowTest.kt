package ru.genesis.calendar

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import java.io.File
import java.time.LocalDate
import java.util.UUID
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.data.*
import ru.genesis.calendar.domain.*
import ru.genesis.calendar.domain.habits.*
import ru.genesis.calendar.ui.*

class HabitMeasurementFlowTest {
    @get:Rule val compose=createAndroidComposeRule<StoicheionGestureActivity>()

    @Test fun measuredEntriesCorrectionsAndReloadPreserveValuesAndOneDailyAward() {
        val app=compose.activity.application as GenesisApplication
        check(BuildConfig.DEBUG && app.packageName.endsWith(".debug") && app.workspaceScope=="internal-validation-v1")
        val repository=HabitsRepository(app)
        val date=LocalDate.now()
        val habit=Habit(TrackerEntity.create("habit",id="d1-measurement-ui-${UUID.randomUUID()}"),"D1 · Duration",date,
            HabitEngine(GenesisCalendar()).defaultSchedule(date,CalendarMode.PROFANE),
            measurement=HabitMeasurement("duration","min",60_000,15_000))
        runBlocking { repository.save(habit) }
        fun saved()=runBlocking { repository.workspace.first() }
        var dark by mutableStateOf(false)
        compose.setContent {
            val workspace by repository.workspace.collectAsState(initial=LocalHabitWorkspace())
            MaterialTheme(colorScheme=if(dark) evening else standart) {
                Surface(Modifier.fillMaxSize().safeDrawingPadding()) {
                    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState())) {
                        workspace.habits.find { it.id==habit.id }?.let { current ->
                            HabitMeasurementInputs(current,workspace.measurements,date,
                                workspace.completions.find { it.habitId==habit.id && it.date==date },true,
                                onRecord={amount,entry,replaces,note -> repository.recordMeasurement(habit.id,date,amount,entry,replaces,note);Unit},
                                onQuality={quality -> repository.complete(habit.id,true,quality,date);Unit})
                        }
                    }
                }
            }
        }
        fun ready(node: SemanticsNodeInteraction): SemanticsNodeInteraction {
            compose.waitUntil(15_000) { runCatching { node.assertIsEnabled() }.isSuccess }
            return node
        }
        compose.waitUntil(15_000) { compose.onAllNodesWithTag("habit-measurement-${habit.id}").fetchSemanticsNodes().isNotEmpty() }
        ready(compose.onNodeWithText("+ 15 мин")).performScrollTo().performClick()
        compose.waitUntil(15_000) { saved().measurements.count { it.habitId==habit.id }==1 }
        assertFalse(saved().completions.single { it.habitId==habit.id }.completed)
        ready(compose.onNodeWithText("Значение")).performScrollTo().performTextReplacement("45,125")
        ready(compose.onNodeWithText("Добавить значение")).performScrollTo().performClick()
        compose.waitUntil(15_000) { saved().completions.single { it.habitId==habit.id }.completed }
        assertEquals(10,saved().completions.single { it.habitId==habit.id }.xpAwarded)
        compose.onNodeWithText("Записи · 2").performScrollTo().performClick()
        ready(compose.onAllNodesWithText("Изменить")[0]).performScrollTo().performClick()
        ready(compose.onNodeWithText("Значение")).performScrollTo().performTextReplacement("10,125")
        ready(compose.onNodeWithText("Сохранить")).performScrollTo().performClick()
        compose.waitUntil(15_000) { HabitMeasurements.progress(habit,date,saved().measurements).total==55_250L }
        assertFalse(saved().completions.single { it.habitId==habit.id }.completed)
        assertEquals(10,saved().completions.single { it.habitId==habit.id }.xpAwarded)
        ready(compose.onAllNodesWithText("Удалить запись")[1]).performScrollTo().performClick()
        compose.waitUntil(15_000) { HabitMeasurements.progress(habit,date,saved().measurements).total==10_125L }
        ready(compose.onNodeWithText("Восстановить запись")).performScrollTo().performClick()
        ready(compose.onNodeWithText("Сохранить")).performScrollTo().performClick()
        compose.waitUntil(15_000) { HabitMeasurements.progress(habit,date,saved().measurements).total==55_250L }
        val reloaded=HabitsRepository(app)
        assertEquals(55_250L,HabitMeasurements.progress(habit,date,runBlocking { reloaded.workspace.first() }.measurements).total)
        val device=UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        compose.onNodeWithText("Значение").performScrollTo()
        assertTrue(device.takeScreenshot(File(app.getExternalFilesDir(null),"d1-measurements-light.png")))
        compose.runOnIdle { dark=true }
        compose.waitForIdle()
        assertTrue(device.takeScreenshot(File(app.getExternalFilesDir(null),"d1-measurements-dark.png")))
    }
}
