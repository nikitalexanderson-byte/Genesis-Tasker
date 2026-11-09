package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import java.io.File
import java.time.LocalDate
import ru.genesis.calendar.StoicheionGestureActivity
import ru.genesis.calendar.domain.*
import ru.genesis.calendar.domain.habits.*
import ru.genesis.calendar.data.LocalHabitWorkspace

class HabitPracticeUiTest {
    @get:Rule val compose=createAndroidComposeRule<StoicheionGestureActivity>()
    private fun workspace(): LocalHabitWorkspace {
        val engine=HabitEngine(GenesisCalendar());val today=LocalDate.now()
        fun habit(id: String, day: LocalDate): Habit {
            val schedule=StoicheionRestoration.dailySchedule(engine.defaultSchedule(day,CalendarMode.PROFANE)).let {
                it.copy(endDate=day.plusDays(1),recurrence=it.recurrence.copy(rangeEnd=day.plusDays(1).toString())) }
            return Habit(TrackerEntity.create("habit",id=id),id,day,schedule,practiceGoal=HabitPracticeGoal(startDate=day))
        }
        val open=habit("Open practice",today);val done=habit("Completed practice",today.minusDays(1));val missed=habit("Missed practice",today.minusDays(3))
        val entries=engine.updateCompletion(emptyList(),done,done.createdDate,done.createdDate,true,null,"")
        return LocalHabitWorkspace(habits=listOf(open,done,missed),completions=entries)
    }
    private fun show(width: Int=390,dark: Boolean=false) {
        val workspace=workspace();val density=compose.activity.resources.displayMetrics.widthPixels.toFloat()/width
        compose.setContent {
            CompositionLocalProvider(LocalDensity provides Density(density,1f),LocalGenesisLanguage provides "ru",LocalEveningTheme provides dark) {
                MaterialTheme(colorScheme=if(dark) evening else standart) { Surface(Modifier.fillMaxSize()) {
                    var selected by remember { mutableStateOf("active") }
                    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {
                        Text("Сакральные практики",style=MaterialTheme.typography.headlineSmall)
                        val copy=habitPracticeCopy()
                        androidx.compose.material3.Text(copy.getString("warning"),style=MaterialTheme.typography.bodyMedium)
                        HabitLifecycleFilters(workspace,selected) { selected=it }
                        for(habit in workspace.habits.filter { habitPracticeLibraryStatus(it,workspace.completions)==selected }) {
                            Text(habit.title,modifier=Modifier.testTag("practice-title-${habit.id}"),style=MaterialTheme.typography.titleMedium)
                            HabitPracticeStatus(habit,workspace.completions)
                        }
                    }
                } }
            }
        }
        compose.waitForIdle()
    }
    @Test fun completedAndMissedPracticesLeaveActiveAndCanBeInspectedSeparately() {
        show()
        compose.onNodeWithTag("practice-title-Open practice").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("practice-title-Completed practice").assertDoesNotExist()
        compose.onNodeWithTag("habit-state-choice").performScrollTo().performClick()
        compose.onNodeWithTag("habit-state-completed").performScrollTo().performClick()
        compose.onNodeWithTag("practice-title-Completed practice").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Практика выполнена",substring=true).performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("habit-state-choice").performScrollTo().performClick()
        compose.onNodeWithTag("habit-state-missed").performScrollTo().performClick()
        compose.onNodeWithTag("practice-title-Missed practice").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Не выполнена · −10 Лавров",substring=true).performScrollTo().assertIsDisplayed()
    }
    @Test fun capturePracticeWindowAndStateChoice() {
        val args=InstrumentationRegistry.getArguments();assumeTrue(args.getString("genesisPracticeCapture")=="true")
        show(args.getString("genesisWidth")?.toInt() ?: 390,args.getString("genesisDark")=="true")
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        compose.onRoot().captureToImage().asAndroidBitmap().let { bitmap ->
            File(context.cacheDir,"practice-goal-capture.png").outputStream().use { assertTrue(bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)) }
        }
    }
}
