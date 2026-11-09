package ru.genesis.calendar

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import java.io.File
import java.time.*
import java.util.UUID
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.data.*
import ru.genesis.calendar.domain.*
import ru.genesis.calendar.domain.habits.*
import ru.genesis.calendar.ui.*

class HabitRuleHistoryFlowTest {
    @get:Rule val compose=createAndroidComposeRule<StoicheionGestureActivity>()

    @Test fun explicitRuleChoicePersistsTheCausalHistoryAcrossReload() {
        val app=compose.activity.application as GenesisApplication
        check(BuildConfig.DEBUG&&app.packageName.endsWith(".debug")&&app.workspaceScope=="internal-validation-v1")
        val repository=HabitsRepository(app);val date=LocalDate.now();val now=Instant.now().toString()
        val base=Habit(TrackerEntity.create("habit",now,"d3-rule-ui-${UUID.randomUUID()}"),"D3 · Rule choice",date,
            HabitEngine(GenesisCalendar()).defaultSchedule(date,CalendarMode.PROFANE),measurement=HabitMeasurement("duration","min",60_000,15_000))
        val root=HabitMeasurements.rule(base,date)
        val left=root.copy(id="left",recordedAt=now,measurement=base.measurement!!.copy(target=90_000),supersedes=listOf(root.id))
        val right=left.copy(id="right",measurement=base.measurement.copy(target=120_000))
        val habit=base.copy(ruleHistory=listOf(root,left,right))
        runBlocking { repository.save(habit) }
        fun saved()=runBlocking { repository.workspace.first() }.habits.single { it.id==habit.id }
        var dark by mutableStateOf(false)
        compose.setContent {
            val workspace by repository.workspace.collectAsState(initial=LocalHabitWorkspace())
            val scope=rememberCoroutineScope();var busy by remember { mutableStateOf(false) }
            MaterialTheme(colorScheme=if(dark) evening else standart) {
                Surface(Modifier.fillMaxSize().safeDrawingPadding()) {
                    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal=12.dp)) {
                        workspace.habits.find { it.id==habit.id }?.let { current -> HabitRuleHistoryPanel(current,date,busy,
                            onChoose={chosen,heads,operation -> scope.launch {
                                busy=true
                                try { repository.resolveRule(habit.id,chosen,heads,operation) }
                                finally { busy=false }
                            }}) }
                    }
                }
            }
        }
        compose.waitUntil(15_000) { compose.onAllNodesWithText("Выбрать это правило").fetchSemanticsNodes().size==2 }
        val device=UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        fun capture(name: String) {
            compose.onNodeWithText("История целей и расписаний").performScrollTo();compose.waitForIdle()
            assertTrue(device.takeScreenshot(File(app.getExternalFilesDir(null),name)))
        }
        capture("d3-conflict-light.png")
        compose.runOnIdle { dark=true };capture("d3-conflict-dark.png")
        compose.onNodeWithTag("choose-habit-rule-left").performScrollTo().performClick()
        compose.waitUntil(15_000) { saved().ruleHistory.size==4&&HabitRuleHistory.state(saved(),date).conflicts.isEmpty() }
        val reloaded=runBlocking { HabitsRepository(app).workspace.first() }.habits.single { it.id==habit.id }
        assertEquals("left",HabitMeasurements.rule(reloaded,date).id)
        assertEquals(90_000L,HabitMeasurements.rule(reloaded,date).measurement!!.target)
        compose.runOnIdle { dark=false };capture("d3-saved-light.png")
        compose.runOnIdle { dark=true };capture("d3-saved-dark.png")
    }
}
