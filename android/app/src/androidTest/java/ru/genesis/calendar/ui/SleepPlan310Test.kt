package ru.genesis.calendar.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.captureNativeWindow
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.habits.TrackerEntity
import ru.genesis.calendar.domain.trackers.*
import java.io.File
import java.time.LocalDate
import java.time.LocalTime
import ru.genesis.calendar.domain.GenesisCalendar
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue

class SleepPlan310Test {
    @get:Rule val compose=createAndroidComposeRule<PagerTestActivity>()
    @Test fun sleepTimesAndScoringChoicesFitSymmetricRows(){
        val args=InstrumentationRegistry.getArguments()
        val width=args.getString("genesisWidth")?.toIntOrNull()?:360
        val dark=args.getString("genesisEvening")=="true"
        val plan=SleepPlan(TrackerEntity.create("sleep-plan"),dailySleepSchedule(LocalDate.of(2026,10,29),CalendarMode.PROFANE),
            scoringEnabled=true,rules=listOf(SleepRule("qa","bedtime","on-or-before",LocalTime.of(23,0),10.0)))
        compose.setContent {
            CompositionLocalProvider(LocalDensity provides Density(compose.activity.resources.displayMetrics.widthPixels.toFloat()/width,1f),LocalGenesisLanguage provides "ru",LocalEveningTheme provides dark){
                MaterialTheme(colorScheme=if(dark)evening else standart,typography=GenesisTypography,shapes=GenesisShapes){SleepPlanEditor(plan,true,false,null,{},{})}
            }
        }
        compose.onNodeWithTag("sleep-plan-bedtime").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("sleep-plan-wake").assertIsDisplayed()
        val bedtime=compose.onNodeWithTag("sleep-plan-bedtime").fetchSemanticsNode().boundsInRoot
        val wake=compose.onNodeWithTag("sleep-plan-wake").fetchSemanticsNode().boundsInRoot
        assertEquals(bedtime.width,wake.width,1f);assertEquals(bedtime.height,wake.height,1f);assertEquals(bedtime.top,wake.top,1f)
        captureNativeWindow(File(compose.activity.getExternalFilesDir(null),"sleep310-$width-${if(dark)"dark"else"light"}-times.png"))
        compose.onNodeWithTag("sleep-rule-after-qa").performScrollTo()
        val nodes=listOf("bedtime","wake","before","after").map{compose.onNodeWithTag("sleep-rule-$it-qa").assertIsDisplayed().fetchSemanticsNode().boundsInRoot}
        nodes.forEach{assertEquals(nodes.first().width,it.width,1f);assertEquals(nodes.first().height,it.height,1f)}
        assertEquals(nodes[0].left,nodes[2].left,1f);assertEquals(nodes[1].left,nodes[3].left,1f)
        assertEquals(nodes[0].top,nodes[1].top,1f);assertEquals(nodes[2].top,nodes[3].top,1f)
        captureNativeWindow(File(compose.activity.getExternalFilesDir(null),"sleep310-$width-${if(dark)"dark"else"light"}-rules.png"))
    }
    @Test fun moodDateUsesTheSelectedCalendarWithoutChangingTheDay(){
        val calendar=GenesisCalendar();val date=LocalDate.of(2026,10,29)
        var mode by mutableStateOf(CalendarMode.PROFANE)
        compose.setContent { CompositionLocalProvider(LocalGenesisLanguage provides "ru") {
            MaterialTheme(colorScheme=standart) { MoodObservationEditor(emptyList(),date,mode,"ru",emptyList(),false,null,{}, onSave={_,_,_,_,_->}) }
        } }
        for(choice in CalendarMode.entries){
            compose.runOnIdle {mode=choice}
            val label=compactDreamDate(date,choice,calendar)
            compose.onNodeWithTag("mood-editor-date").assertTextEquals(label)
        }
    }
}
