package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.StoicheionGestureActivity
import ru.genesis.calendar.captureNativeWindow
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.GenesisCalendar
import java.io.File
import java.time.LocalDate
import java.time.ZoneId

class Android310AcceptanceTest {
    @get:Rule val compose = createAndroidComposeRule<StoicheionGestureActivity>()
    private val args get() = InstrumentationRegistry.getArguments()
    private val width get() = args.getString("genesisWidth")?.toIntOrNull() ?: 390
    private val dark get() = args.getString("genesisDark").toBoolean()
    @Composable private fun Frame(content: @Composable () -> Unit) {
        val density = compose.activity.resources.displayMetrics.widthPixels.toFloat() / width
        CompositionLocalProvider(LocalDensity provides Density(density, 1f),
            LocalEveningTheme provides dark, LocalGenesisLanguage provides "ru") {
            MaterialTheme(colorScheme = if(dark) evening else standart, typography = GenesisTypography, shapes = GenesisShapes) {
                Surface(Modifier.fillMaxSize()) { content() }
            }
        }
    }
    private fun capture(name: String) {
        // Settle an animated scroll and submit the frame on the Android UI thread;
        // screenshot capture itself never draws an AndroidComposeView off-thread.
        compose.mainClock.advanceTimeByFrame()
        compose.waitForIdle()
        compose.runOnUiThread { compose.activity.window.decorView.postInvalidateOnAnimation() }
        compose.mainClock.advanceTimeByFrame()
        compose.waitForIdle()
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        captureNativeWindow(File(context.getExternalFilesDir(null), "310-$width-${if(dark) "dark" else "light"}-$name.png"))
    }

    @Test fun yearSelectionRestoresTheChosenMonthInEveryCalendar() {
        val calendar = GenesisCalendar()
        val anchor = LocalDate.of(2026,10,29)
        var mode by mutableStateOf(CalendarMode.PROFANE)
        var selected by mutableStateOf(anchor)
        val menu = MenuSwipeState()
        compose.setContent { Frame {
            val states = rememberSaveableStateHolder()
            states.SaveableStateProvider(workspaceScreenStateKey("Календарь", menu)) {
                CalendarScreen(selected, mode, onSelect = { selected = it }, experimental = true, menuSwipeState = menu)
            }
        } }
        for (choice in CalendarMode.entries) {
            compose.runOnIdle { selected=anchor; mode=choice; menu.calendar="month" }
            // Visit month first: this primes the stale restoration that caused the bug.
            compose.onNodeWithTag("month-description-layout").assertExists()
            compose.onNodeWithText("Год").performClick()
            val (tag, expected) = when(choice) {
                CalendarMode.PROFANE -> "calendar-year-month-2026-01-01" to LocalDate.of(2026,1,1)
                CalendarMode.SACRED -> "sacred-year-month-0" to calendar.gregorianDate(2026,0,1)
                CalendarMode.LUNAR -> "lunar-year-month-1" to calendar.lunarMonthStart(calendar.lunarDate(anchor).year.startMonthIndex)
            }
            compose.onNodeWithTag("calendar-year").performScrollToNode(hasTestTag(tag))
            compose.onNodeWithTag(tag).performClick()
            compose.onNodeWithTag("month-description-layout").assertIsDisplayed()
            compose.runOnIdle { assertEquals("Chosen $choice month must survive submenu restoration", expected, selected) }
            val period = compose.onNodeWithTag("calendar-month-period").fetchSemanticsNode().config[androidx.compose.ui.semantics.SemanticsProperties.Text].joinToString { it.text }
            val expectedName = when(choice) {
                CalendarMode.PROFANE -> "Январь 2026"
                CalendarMode.SACRED -> ru.genesis.calendar.domain.SacredCatalog.months[0].name
                CalendarMode.LUNAR -> calendar.lunarDate(expected).month.name
            }
            assertTrue("$period must show $expectedName", period.contains(expectedName, ignoreCase=true))
            capture("selected-${choice.wireValue}-month")
        }
    }

    @Test fun monthIllustrationsFollowTheFullDescriptionHeightWithoutNestedScrolling() {
        var mode by mutableStateOf(CalendarMode.PROFANE)
        val anchor = LocalDate.of(2026,10,29)
        val calendar = GenesisCalendar()
        compose.setContent { Frame { CalendarScreen(anchor, mode, {}, experimental=true) } }
        for (choice in CalendarMode.entries) {
            compose.runOnIdle { mode=choice }
            val layout = compose.onNodeWithTag("month-description-layout").performScrollTo()
            layout.assertHeightIsAtLeast(160.dp)
            val art = when(choice) { CalendarMode.PROFANE -> "gregorian-month-art"; CalendarMode.SACRED -> "sacred-month-art"; CalendarMode.LUNAR -> "lunar-month-art" }
            val layoutBounds = layout.fetchSemanticsNode().boundsInRoot
            val imageBounds = compose.onNodeWithTag(art, useUnmergedTree=true).assertIsDisplayed().fetchSemanticsNode().boundsInRoot
            assertEquals("$choice artwork must fill the complete text block", layoutBounds.height, imageBounds.height, 1f)
            assertEquals(layoutBounds.top, imageBounds.top, 1f)
            compose.onAllNodes(hasAnyAncestor(hasTestTag("month-description-layout")) and hasScrollAction(),
                useUnmergedTree=true).assertCountEquals(0)
            val description = when(choice) {
                CalendarMode.PROFANE -> gregorianMonthNature(anchor.monthValue, ZoneId.systemDefault())
                CalendarMode.SACRED -> ru.genesis.calendar.domain.SacredCatalog.months[calendar.sacredDate(anchor).monthIndex].description
                CalendarMode.LUNAR -> calendar.lunarDate(anchor).month.description
            }
            val copy = compose.onNode(hasText(description, substring=false) and
                hasAnyAncestor(hasTestTag("month-description-layout")), useUnmergedTree=true).assertIsDisplayed()
            val textLayouts = mutableListOf<TextLayoutResult>()
            copy.performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(textLayouts) }
            assertEquals(description, textLayouts.single().layoutInput.text.text)
            assertFalse("$choice must display the whole month description", textLayouts.single().hasVisualOverflow)
            assertTrue(copy.fetchSemanticsNode().boundsInRoot.bottom <= layoutBounds.bottom + 1f)
            capture("hero-${choice.wireValue}")
        }
    }

    @Test fun solarDatesOpenTheirActualMonthAndSelectedDayInEveryCalendar() {
        val calendar=GenesisCalendar()
        var mode by mutableStateOf(CalendarMode.PROFANE)
        var selected by mutableStateOf(LocalDate.of(2026,9,12))
        var visible by mutableStateOf(true)
        val menu=MenuSwipeState()
        compose.setContent { Frame {
            val states=rememberSaveableStateHolder()
            if(visible) states.SaveableStateProvider(workspaceScreenStateKey("Календарь",menu)) {
                CalendarScreen(selected,mode,onSelect={selected=it},experimental=true,menuSwipeState=menu)
            }
        } }
        for(choice in CalendarMode.entries) {
            compose.runOnIdle {mode=choice;selected=LocalDate.of(2026,9,12);menu.calendar="month"}
            compose.onNodeWithTag("month-description-layout").assertExists()
            compose.onNodeWithText("Год").performClick()
            compose.onNodeWithTag("calendar-year").performScrollToNode(hasTestTag("calendar-year-solar-toggle"))
            compose.onNodeWithTag("calendar-year-solar-toggle").performClick()
            val event=calendar.solarEvents(2026).first()
            compose.onNodeWithTag("calendar-year").performScrollToNode(hasTestTag("solar-point-${event.date}"))
            compose.onNodeWithTag("solar-point-${event.date}").performClick()
            compose.waitForIdle()
            compose.runOnIdle {assertEquals("Solar date must survive $choice navigation",event.date,selected);assertEquals("month",menu.calendar)}
            compose.onNodeWithTag("calendar-day-${event.date}").assertIsSelected()
            val expected=calendar.monthRange(event.date,choice)
            compose.onNodeWithTag("calendar-day-${expected.start}").assertExists()
            capture("solar-selected-${choice.wireValue}")
            // Re-enter with a different external date after a month was saved.
            compose.runOnIdle {visible=false};compose.waitForIdle()
            val future=calendar.solarEvents(2027).last().date
            compose.runOnIdle {selected=future;visible=true}
            compose.waitForIdle()
            compose.onNodeWithTag("calendar-day-$future").assertIsSelected()
        }
    }

    @Test fun todayTasksAndHabitsHaveTheSameSeparationAsTheDayHeader() {
        compose.setContent { Frame { TodayWorkspace(
            header={ Box(Modifier.fillMaxWidth().height(60.dp).testTag("qa-header")) },
            rhythm={}, tasks={
                Box(Modifier.fillMaxWidth().height(60.dp).testTag("qa-tasks"))
                Box(Modifier.fillMaxWidth().height(60.dp).testTag("qa-habits"))
            }) } }
        val header = compose.onNodeWithTag("qa-header").fetchSemanticsNode().boundsInRoot
        val tasks = compose.onNodeWithTag("qa-tasks").fetchSemanticsNode().boundsInRoot
        val habits = compose.onNodeWithTag("qa-habits").fetchSemanticsNode().boundsInRoot
        if(width < 840) assertEquals(tasks.top-header.bottom, habits.top-tasks.bottom, 1f)
        assertTrue(habits.top-tasks.bottom > 0)
    }
}
