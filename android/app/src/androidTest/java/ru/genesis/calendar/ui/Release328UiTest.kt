package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.compose.ui.graphics.luminance
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.captureNativeWindow
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.GenesisCalendar
import ru.genesis.calendar.domain.SolarLocation
import ru.genesis.calendar.data.LocalTask

/** Synthetic UI acceptance; never runs against the installed release package. */
class Release328UiTest {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    @Before fun isolatedPackageOnly() {
        check(BuildConfig.DEBUG && context.packageName.endsWith(".qa328.debug"))
    }

    @Composable private fun Frame(width: Int, night: Boolean, palette: String = "blue", content: @Composable () -> Unit) {
        CompositionLocalProvider(
            LocalDensity provides Density(context.resources.displayMetrics.widthPixels.toFloat() / width, 1.3f),
            LocalGenesisLanguage provides if (night) "en" else "ru",
            LocalEveningTheme provides night, LocalDarkPalette provides palette,
            LocalSacredFeaturesEnabled provides false
        ) {
            MaterialTheme(colorScheme = if (night) eveningPalette(palette) else daylightPalette(palette),
                typography = GenesisTypography, shapes = GenesisShapes) {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    Box(Modifier.safeDrawingPadding()) { content() }
                }
            }
        }
    }

    @Test fun civilCalendarKeepsSquareDaysAndCenteredMonthAndCompactYearAtFont130() {
        var width by mutableIntStateOf(360)
        var night by mutableStateOf(false)
        var year by mutableStateOf(false)
        var epoch by mutableIntStateOf(0)
        val day = LocalDate.of(2026, 11, 9)
        compose.setContent { key(epoch) { Frame(width, night) {
            CalendarScreen(day, CalendarMode.PROFANE, {}, experimental = true,
                hiddenSubmenus = if (year) setOf("calendar.month") else setOf("calendar.year"))
        } } }
        for (size in listOf(360, 390, 768, 1440)) for (dark in listOf(false, true)) {
            compose.runOnIdle { width = size; night = dark; year = false; epoch++ }
            val previous = compose.onNodeWithTag("calendar-month-previous").getUnclippedBoundsInRoot()
            val next = compose.onNodeWithTag("calendar-month-next").getUnclippedBoundsInRoot()
            val title = compose.onNodeWithTag("calendar-month-period").getUnclippedBoundsInRoot()
            assertTrue("Month title stays between arrows", title.left >= previous.right && title.right <= next.left)
            compose.onNodeWithTag("gregorian-month-origin").assertDoesNotExist()
            compose.onNodeWithTag("gregorian-month-nature").assertDoesNotExist()
            val cell = compose.onNodeWithTag("calendar-day-$day").getUnclippedBoundsInRoot()
            assertEquals("Square civil day at $size/$dark", (cell.right-cell.left).value, (cell.bottom-cell.top).value, 1f)
            assertTrue("48dp day target", cell.bottom-cell.top >= 47.5.dp)
            for (number in 1..day.lengthOfMonth()) {
                val layouts=mutableListOf<TextLayoutResult>()
                compose.onNodeWithTag("calendar-day-number-${day.withDayOfMonth(number)}",useUnmergedTree=true)
                    .performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }
                assertFalse("Complete day number $number at $size/$dark",layouts.single().hasVisualOverflow)
            }
            compose.onNodeWithTag("calendar-selected-primary-date").performScrollTo().assertIsDisplayed()
            compose.onNodeWithText(if (dark) "GREGORIAN DAY" else "ГРИГОРИАНСКИЙ ДЕНЬ").assertDoesNotExist()
            captureNativeWindow(File(context.getExternalFilesDir(null), "release328-calendar-$size-$dark.png"))

            compose.runOnIdle { year = true; epoch++ }
            compose.onNodeWithTag("calendar-year").performScrollToNode(hasTestTag("calendar-year-month-2026-11-01"))
            val month = compose.onNodeWithTag("calendar-year-month-2026-11-01").getUnclippedBoundsInRoot()
            assertTrue("Compact year card grows to readable content: $month", month.bottom-month.top <= 190.dp)
            compose.onNodeWithText(genesisTestOrigin()).assertDoesNotExist()
            captureNativeWindow(File(context.getExternalFilesDir(null), "release328-year-$size-$dark.png"))
        }
    }

    private fun genesisTestOrigin() = gregorianMonthOrigin(11)

    @Test fun compactCivilDayKeepsTwoDigitsAndTaskCountsReadable() {
        val date=LocalDate.of(2026,11,28)
        var night by mutableStateOf(false)
        var opened: LocalDate? = null
        compose.setContent { Frame(360,night) {
            CompositionLocalProvider(LocalSharedCalendarCounts provides mapOf(date.toString() to 12)) {
                CalendarDay(GenesisCalendar(),date,28,null,"Saturday",false,{},Modifier.width(48.dp),
                    moon=null,crossDate=null,taskCount=120,solar=null,onTaskBadgeClick={opened=it})
            }
        } }
        for (dark in listOf(false,true)) {
            compose.runOnIdle { night=dark; opened=null }
            val layouts=mutableListOf<TextLayoutResult>()
            compose.onNodeWithTag("calendar-day-number-$date",useUnmergedTree=true)
                .performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }
            assertFalse("Two-digit date fits beside the task count",layouts.single().hasVisualOverflow)
            compose.onNode(hasText("99+") and hasAnyAncestor(hasTestTag("calendar-task-count-disc-$date")),useUnmergedTree=true)
                .assertIsDisplayed()
            compose.onNodeWithTag("calendar-task-count-$date",useUnmergedTree=true).performClick()
            compose.runOnIdle { assertEquals(date,opened) }
        }
    }

    @Test fun completedRowsStaySubduedAndReadableInEveryDarkPalette() {
        var palette by mutableStateOf("green")
        var done by mutableStateOf(true)
        var checkColors: () -> Unit = {}
        compose.setContent { Frame(390,true,palette) {
            val surface=completedTaskSurface
            val ink=completedTaskInk
            checkColors={
                assertTrue("Completed surface stays dark",surface.luminance()<.3f)
                assertTrue("Completed text contrast",(maxOf(ink.luminance(),surface.luminance())+.05f)/
                    (minOf(ink.luminance(),surface.luminance())+.05f)>=4.5f)
            }
            Column(Modifier.padding(8.dp)) {
                TodayTaskRow(done,{},onComplete={done=!done}) {
                    TaskTitle(LocalTask(title="Weekly review",done=done))
                }
            }
        } }
        for (id in listOf("green","blue","burgundy","violet")) {
            compose.runOnIdle { palette=id; done=true }
            compose.runOnIdle { checkColors() }
            compose.onAllNodes(isToggleable()).onFirst().assertIsOn()
            captureNativeWindow(File(context.getExternalFilesDir(null),"release328-completed-$id.png"))
            compose.onAllNodes(isToggleable()).onFirst().performClick().assertIsOff()
        }
    }

    @Test fun civilHeaderKeepsSolarInformationAndActualDateInBothSchemes() {
        var width by mutableIntStateOf(390)
        var night by mutableStateOf(false)
        val zone=ZoneId.of("Europe/Moscow")
        compose.mainClock.autoAdvance=false
        compose.setContent { Frame(width,night) {
            CivilTodayHero(SolarLocation(55.7558,37.6173,"Europe/Moscow","Москва",false),GenesisCalendar(zone),zone)
        } }
        compose.mainClock.advanceTimeBy(2000)
        for (size in listOf(360,390,768,1440)) for (dark in listOf(false,true)) {
            compose.runOnIdle { width=size; night=dark }
            compose.waitUntil(10000) {
                compose.mainClock.advanceTimeByFrame()
                compose.onAllNodesWithTag("civil-today-terrain").fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithTag("today-civil-date").assertIsDisplayed().assertTextEquals(
                LocalDate.now(zone).format(DateTimeFormatter.ofPattern("d MMMM yyyy",Locale.forLanguageTag(if(dark)"en" else "ru"))))
            compose.onNodeWithTag("today-civil-clock").assertIsDisplayed()
            compose.onNodeWithText(if(dark)"Sunrise" else "Восход",substring=true).assertIsDisplayed()
            compose.onNodeWithText(if(dark)"Sunset" else "Закат",substring=true).assertIsDisplayed()
            val dateLayouts=mutableListOf<TextLayoutResult>()
            val solarLayouts=mutableListOf<TextLayoutResult>()
            compose.onNodeWithTag("today-civil-date").performSemanticsAction(SemanticsActions.GetTextLayoutResult){it(dateLayouts)}
            compose.onNodeWithText(if(dark)"Sunrise" else "Восход",substring=true)
                .performSemanticsAction(SemanticsActions.GetTextLayoutResult){it(solarLayouts)}
            assertEquals("Solar labels preserve the landscape reading ink",dateLayouts.single().layoutInput.style.color,solarLayouts.single().layoutInput.style.color)
            compose.onNodeWithTag("weather-attribution-settings").assertDoesNotExist()
            captureNativeWindow(File(context.getExternalFilesDir(null),"release328-today-$size-$dark.png"))
        }
    }
}
