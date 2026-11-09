package ru.genesis.calendar

import android.graphics.Bitmap
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
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

class EveningAndMonthFlowTest {
    @get:Rule val compose = createAndroidComposeRule<StoicheionGestureActivity>()
    private val app get() = compose.activity.application as GenesisApplication
    private val width = InstrumentationRegistry.getArguments().getString("genesisWidth")?.toIntOrNull() ?: 390
    private val dark = InstrumentationRegistry.getArguments().getString("genesisEvening") == "true"
    private fun capture(name: String) {
        compose.waitForIdle()
        File(app.getExternalFilesDir(null), "2.3.10-${width}dp-${if(dark) "evening" else "light"}-$name.png")
            .outputStream().use { assertTrue(compose.onRoot().captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG,100,it)) }
    }
    private fun content(block: @Composable () -> Unit) {
        compose.setContent {
            val density=Density(compose.activity.resources.displayMetrics.widthPixels.toFloat()/width,LocalDensity.current.fontScale)
            CompositionLocalProvider(LocalDensity provides density,LocalEveningTheme provides dark) {
                MaterialTheme(colorScheme=if(dark) evening else standart) { block() }
            }
        }
    }

    @Test fun monthCardsKeepPlanetsClearAndSelectedDayStartsAtItsHero() {
        var mode by mutableStateOf(CalendarMode.PROFANE)
        val date=LocalDate.of(2026,9,28)
        val tasks=listOf(LocalTask("layout-open","Проверить план дня",date=date.toString()),
            LocalTask("layout-done","Готовый план",date=date.toString(),done=true))
        content { CalendarScreen(date,mode,{},experimental=true,tasks=tasks) }
        for(calendarMode in listOf(CalendarMode.PROFANE,CalendarMode.LUNAR,CalendarMode.SACRED)) {
            compose.runOnIdle { mode=calendarMode }
            val tag=if(calendarMode==CalendarMode.SACRED) "sacred-month-pyatas" else "calendar-month-panel-${calendarMode.wireValue}"
            compose.onNodeWithTag(tag).assertExists()
            if(calendarMode==CalendarMode.LUNAR) {
                compose.onNodeWithTag("calendar-month-description").assert(hasAnyAncestor(hasTestTag(tag)))
            }
            if(calendarMode==CalendarMode.PROFANE) {
                compose.onNodeWithTag("gregorian-month-art").assertExists()
                compose.onNodeWithTag("calendar-month-description").assert(!hasAnyAncestor(hasTestTag(tag)))
            }
            capture("${calendarMode.wireValue}-month")
            if(calendarMode==CalendarMode.PROFANE) {
                compose.onNodeWithTag("calendar-day-$date").performScrollTo()
                val planet=compose.onNodeWithTag("calendar-patron-$date",useUnmergedTree=true).fetchSemanticsNode().boundsInRoot
                val disc=compose.onNodeWithTag("calendar-task-count-disc-$date",useUnmergedTree=true).fetchSemanticsNode().boundsInRoot
                assertTrue("Planet must not overlap the upper-right personal counter",
                    planet.right <= disc.left || planet.bottom <= disc.top || planet.top >= disc.bottom)
            }
            compose.onNodeWithTag("calendar-day-$date").performScrollTo()
                .performTouchInput { click(Offset(center.x, 2f)) }
            compose.waitUntil(10_000) {
                val card=compose.onNodeWithTag("calendar-selected-day").fetchSemanticsNode().boundsInRoot
                val viewport=compose.onNodeWithTag("calendar-month").fetchSemanticsNode().boundsInRoot
                card.top>=viewport.top-3 && card.top<=viewport.top+12*compose.activity.resources.displayMetrics.density
            }
            capture("${calendarMode.wireValue}-selected-hero")
        }
    }

    @Test fun inlineMonthActionsEditDeleteAndCompleteTodaysHabit() {
        app.activateAccount(null)
        val date=LocalDate.now()
        val repo=HabitsRepository(app)
        val id="month-habit-${UUID.randomUUID()}"
        runBlocking { repo.save(Habit(TrackerEntity.create("habit",id=id),"Месячная практика",date,
            HabitEngine(GenesisCalendar()).defaultSchedule(date,CalendarMode.PROFANE))) }
        var edited=""
        var tasks by mutableStateOf(listOf(LocalTask("inline-check","Задача месяца",date=date.toString())))
        content {
            val workspace = repo.workspace.collectAsState(LocalHabitWorkspace()).value
            CalendarScreen(date,CalendarMode.PROFANE,{},experimental=true,tasks=tasks,
                onEditTask={task,_->edited=task.id},onDeleteTask={task->tasks=tasks.filterNot {it.id==task.id}},
                dayHabits={day -> TodayHabitsContent(app,day,workspace,{}) })
        }
        try {
            compose.onNodeWithTag("calendar-inline-edit-inline-check").performScrollTo().performClick()
            assertEquals("inline-check",edited)
            val stored = runBlocking { repo.workspace.first().habits.single { it.id == id } }
            assertTrue("Fixture must be scheduled today", HabitEngine(GenesisCalendar()).isScheduled(stored, date))
            compose.onNodeWithTag("today-habits-section").performScrollTo()
            compose.waitUntil(10_000) {
                compose.onAllNodesWithTag("today-habit-check-$id").fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithTag("today-habit-check-$id").performScrollTo().assertIsOff().performClick()
            compose.waitForIdle()
            compose.waitUntil(10_000) { runBlocking { repo.workspace.first().completions.any {it.habitId==id && it.completed} } }
            compose.waitUntil(10_000) {
                compose.onNodeWithTag("today-habit-check-$id").fetchSemanticsNode().config
                    .getOrNull(androidx.compose.ui.semantics.SemanticsProperties.ToggleableState) ==
                    androidx.compose.ui.state.ToggleableState.On
            }
            compose.onNodeWithTag("today-habit-check-$id").assertIsOn()
            capture("month-actions-and-habits")
            compose.onNodeWithTag("calendar-inline-delete-inline-check").performScrollTo().performClick()
            compose.onNodeWithTag("calendar-inline-delete-confirm").performClick()
            compose.onNodeWithTag("calendar-inline-delete-inline-check").assertDoesNotExist()
        } finally { runBlocking { repo.delete(id) } }
    }

    @Test fun monthSwipesUseArtworkArrowsAndYearKeepsSeparateNavigation() {
        var mode by mutableStateOf(CalendarMode.PROFANE)
        val date=LocalDate.of(2026,9,28)
        content { CalendarScreen(date,mode,{},experimental=true) }
        for(calendarMode in CalendarMode.entries) {
            compose.runOnIdle { mode=calendarMode }
            compose.onNodeWithText("Месяц").performClick()
            compose.onNodeWithTag("calendar-month-navigation").performScrollTo()
                .assert(hasAnyAncestor(hasTestTag("month-description-layout")))
            compose.onNodeWithTag("calendar-month-navigation-card").assertDoesNotExist()
            compose.onNodeWithTag("calendar-month-swipe-hint").assertDoesNotExist()
            val before=compose.onNodeWithTag("calendar-month-period").fetchSemanticsNode().config[androidx.compose.ui.semantics.SemanticsProperties.Text].single().text
            compose.onNodeWithTag("calendar-month-navigation").performTouchInput { swipeLeft() }
            compose.waitForIdle()
            compose.onNodeWithTag("calendar-month-period").assert(!hasText(before))
            compose.onNodeWithTag("calendar-month-navigation").performTouchInput { swipeRight() }
            compose.waitForIdle()
            compose.onNodeWithTag("calendar-month-period").assertTextEquals(before)
            compose.onNodeWithTag("calendar-month-navigation").performTouchInput {
                swipe(center, center.copy(x = center.x - 32f), 200)
            }
            compose.waitForIdle()
            compose.onNodeWithTag("calendar-month-period").assertTextEquals(before)
            compose.onNodeWithTag("calendar-month-next").performClick()
            compose.waitForIdle()
            compose.onNodeWithTag("calendar-month-previous").performClick()
            compose.waitForIdle()
            compose.onNodeWithTag("calendar-month-period").assertTextEquals(before)
            compose.onNodeWithText("Год").performClick()
            compose.onNodeWithTag("calendar-year-navigation-card").assertExists()
            // The calendar name belongs to the hosting Universal UI header.
            compose.onNodeWithTag("calendar-year-navigation")
                .assert(hasAnyAncestor(hasTestTag("calendar-year-navigation-card")))
            compose.onNodeWithTag("calendar-year-swipe-hint").assertDoesNotExist()
            compose.onNodeWithTag("calendar-year-navigation").assert(hasAnyAncestor(hasTestTag("calendar-year-panel")))
            compose.onNodeWithTag("calendar-year-solar-points").assertDoesNotExist()
            compose.onNodeWithTag("calendar-year-solar-toggle").performScrollTo().performClick()
            compose.onNodeWithTag("calendar-year-solar-points").assert(hasAnyAncestor(hasTestTag("calendar-year-panel")))
            val year=compose.onNodeWithTag("calendar-year-period").fetchSemanticsNode().config[androidx.compose.ui.semantics.SemanticsProperties.Text].single().text
            compose.onNodeWithTag("calendar-year-navigation").performTouchInput { swipeLeft() }
            compose.waitForIdle()
            compose.onNodeWithTag("calendar-year-period").assertTextEquals((year.toInt()+1).toString())
            compose.onNodeWithTag("calendar-year-previous").performClick()
            compose.waitForIdle()
            compose.onNodeWithTag("calendar-year-period").assertTextEquals(year)
            capture("${calendarMode.wireValue}-year-panel")
            val first=when(calendarMode) {
                CalendarMode.PROFANE -> "gregorian-season-winter"
                CalendarMode.SACRED -> "sacred-year-month-0"
                CalendarMode.LUNAR -> "lunar-year-month-1"
            }
            compose.onNodeWithTag("calendar-year").performScrollToNode(hasTestTag(first))
            compose.onNodeWithTag(first).assert(hasAnyAncestor(hasTestTag("calendar-year-panel")))
            capture("${calendarMode.wireValue}-year-months")
            if(calendarMode==CalendarMode.PROFANE) {
                compose.onNodeWithTag("calendar-year").performScrollToNode(hasTestTag("gregorian-season-spring"))
                capture("profane-year-seasons")
            }
            if(calendarMode==CalendarMode.SACRED) {
                compose.onNodeWithTag("calendar-year").performScrollToNode(hasTestTag("sacred-year-details-open"))
                compose.onNodeWithTag("sacred-year-details-open").assertIsDisplayed()
                capture("sacred-year-details-dynamic-button")
                compose.onNodeWithTag("sacred-year-details-open").assertIsDisplayed().performClick()
                compose.onNodeWithTag("sacred-year-details-dialog").assertIsDisplayed()
                compose.onNodeWithTag("sacred-year-details-close").performClick()
            }
        }
    }

    @Test fun themeSwitchPersistsAndEveryPageUsesEveningSurfaces() {
        app.activateAccount(null)
        val repo=HabitsRepository(app)
        val original=runBlocking { repo.workspace.first().settings }
        val preferences=LocalPreferences(app,app.workspaceScope)
        val originalPreferences=runBlocking { preferences.values.first() }
        val today=LocalDate.now()
        val fixture="theme-preview-${UUID.randomUUID()}"
        runBlocking {
            app.repository.save(LocalTask(fixture,"Практика внимания",date=today.minusDays(1).toString()))
            repo.save(Habit(TrackerEntity.create("habit",id=fixture),"Ежедневная прогулка",today,
                HabitEngine(GenesisCalendar()).defaultSchedule(today,CalendarMode.PROFANE)))
        }
        runBlocking {
            repo.updateAppearance(AppearanceSettings(mode=if(dark) "evening" else "light").json())
            preferences.set("display", CalendarMode.SACRED.wireValue)
        }
        content { GenesisApp(app,null,testWorkspace=true) }
        try {
            val tag=if(dark) "app-theme-Evening" else "app-theme-Standart"
            compose.waitUntil(10_000) { compose.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty() }
            for(page in listOf("Сегодня","Проекты","Календарь","Привычки","Сакральное","Настройки")) {
                compose.onNodeWithTag("navigation-$page").performClick()
                capture("page-$page")
                if(page=="Сегодня") {
                    compose.scrollToTodayNode(hasTestTag("today-tasks-section"))
                    capture("today-practice-panel")
                    compose.scrollToTodayNode(hasTestTag("today-day-details-toggle"))
                    compose.onNodeWithTag("today-day-details-toggle").performClick()
                    compose.scrollToTodayNode(hasTestTag("three-rhythms-heading"))
                    capture("today-three-rhythms")
                    compose.onAllNodes(SemanticsMatcher("Rhythm fact") {
                        it.config.getOrNull(androidx.compose.ui.semantics.SemanticsProperties.TestTag)?.startsWith("rhythm-fact-")==true
                    },useUnmergedTree=true)[1].performScrollTo()
                    capture("today-rhythm-facts")
                }
                if(page=="Проекты") {
                    compose.onNodeWithTag("submenu-tasks").performClick()
                    compose.onNodeWithTag("tasks-screen").performScrollToNode(hasTestTag("task-$fixture"))
                    compose.onNodeWithText("Просрочено").assertExists()
                    assertFalse(runBlocking {app.repository.get(fixture)!!.done})
                    capture("overdue-task")
                }
            }
            compose.onNodeWithTag(if(dark) "appearance-light" else "appearance-evening").performScrollTo().performClick()
            compose.waitUntil(10_000) { compose.onAllNodesWithTag(if(dark) "app-theme-Standart" else "app-theme-Evening").fetchSemanticsNodes().isNotEmpty() }
            assertEquals(if(dark) "light" else "evening",AppearanceSettings.read(runBlocking {repo.workspace.first().settings.rawJson}).mode)
            compose.onNodeWithTag("appearance-scheduled").performScrollTo().performClick()
            compose.waitUntil(10_000) { compose.onAllNodesWithTag("appearance-light-time").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithTag("appearance-dark-time").assertExists()
        } finally { runBlocking {
            preferences.set("display", originalPreferences.display.wireValue)
            repo.updateSettings(original); repo.delete(fixture);app.repository.delete(fixture)
        } }
    }
}
