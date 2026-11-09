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
import java.time.ZoneId
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

class HabitPeriodGoalFlowTest {
    @get:Rule val compose=createAndroidComposeRule<StoicheionGestureActivity>()

    @Test fun threeExecutionsPersistAsThreeEntriesAndOneDayWithoutADailyObligation() {
        val app=compose.activity.application as GenesisApplication
        check(BuildConfig.DEBUG&&app.packageName.endsWith(".debug")&&app.workspaceScope=="internal-validation-v1")
        val repository=HabitsRepository(app)
        val date=LocalDate.now()
        val habit=Habit(TrackerEntity.create("habit",id="d2-period-ui-${UUID.randomUUID()}"),"D2 · Weekly executions",date,
            HabitEngine(GenesisCalendar()).defaultSchedule(date,CalendarMode.PROFANE),
            periodGoal=HabitPeriodGoal(period="week",metric="entries",target=3,calendar="profane",context=CalendarContext(timeZone=ZoneId.systemDefault().id)))
        runBlocking { repository.save(habit) }
        fun saved()=runBlocking { repository.workspace.first() }
        var dark by mutableStateOf(false)
        compose.setContent {
            val workspace by repository.workspace.collectAsState(initial=LocalHabitWorkspace())
            MaterialTheme(colorScheme=if(dark) evening else standart) {
                Surface(Modifier.fillMaxSize().safeDrawingPadding()) {
                    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState())) {
                        workspace.habits.find { it.id==habit.id }?.let { current ->
                            HabitPeriodGoalProgress(current,workspace.measurements,workspace.completions,date)
                            HabitMeasurementInputs(current,workspace.measurements,date,
                                workspace.completions.find { it.habitId==habit.id&&it.date==date },true,
                                onRecord={amount,entry,replaces,note -> repository.recordMeasurement(habit.id,date,amount,entry,replaces,note);Unit},
                                onQuality={quality -> repository.complete(habit.id,true,quality,date);Unit})
                        }
                    }
                }
            }
        }
        compose.waitUntil(15_000) { compose.onAllNodesWithTag("habit-period-progress-${habit.id}").fetchSemanticsNodes().isNotEmpty() }
        val addTag = "habit-measurement-quick-${habit.id}"
        repeat(3) { index ->
            compose.waitUntil(15_000) { compose.onAllNodesWithTag(addTag).filter(isEnabled()).fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithTag(addTag).assertTextContains("Добавить выполнение").performScrollTo().performClick()
            compose.waitUntil(15_000) { saved().measurements.count { it.habitId==habit.id }==index+1 }
        }
        val workspace=saved()
        val state=HabitPeriodGoals.progress(habit,date,workspace.measurements,workspace.completions)!!
        assertEquals(3L,state.value);assertTrue(state.completed)
        assertEquals(10,workspace.completions.single { it.habitId==habit.id }.xpAwarded)
        compose.onNodeWithText("Записи · 3").performScrollTo().performClick()
        compose.onAllNodesWithText("Удалить запись")[0].performScrollTo().performClick()
        compose.waitUntil(15_000) { HabitPeriodGoals.progress(habit,date,saved().measurements,saved().completions)!!.value==2L }
        compose.waitUntil(15_000) { compose.onAllNodesWithText("Восстановить запись").filter(isEnabled()).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Восстановить запись").performScrollTo().performClick()
        compose.onNodeWithTag("habit-measurement-save-${habit.id}").assertTextContains("Сохранить").performScrollTo().performClick()
        compose.waitUntil(15_000) { HabitPeriodGoals.progress(habit,date,saved().measurements,saved().completions)!!.value==3L }
        compose.onNodeWithText("Записи · 3").performScrollTo().performClick()
        val reload=runBlocking { HabitsRepository(app).workspace.first() }
        assertEquals(3L,HabitPeriodGoals.progress(reload.habits.single { it.id==habit.id },date,reload.measurements,reload.completions)!!.value)
        assertEquals(10,reload.completions.single { it.habitId==habit.id }.xpAwarded)
        compose.waitUntil(15_000) { compose.onAllNodesWithTag(addTag).filter(isEnabled()).fetchSemanticsNodes().isNotEmpty() }
        val device=UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        compose.onNodeWithTag("habit-period-progress-${habit.id}").performScrollTo()
        assertTrue(device.takeScreenshot(File(app.getExternalFilesDir(null),"d2-period-light.png")))
        compose.runOnIdle { dark=true };compose.waitForIdle()
        assertTrue(device.takeScreenshot(File(app.getExternalFilesDir(null),"d2-period-dark.png")))
    }
}
