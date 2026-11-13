package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.background
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.*
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.captureNativeWindow
import ru.genesis.calendar.data.WorkspaceStructure
import ru.genesis.calendar.data.LocalHabitWorkspace
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.GenesisCalendar
import java.io.File
import java.time.LocalDate
import java.time.ZoneId

/** Render the shipped components with synthetic data, without a production account. */
class Release331UiTest {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val date = LocalDate.of(2026, 11, 13)
    private val palettes = listOf("green", "blue", "burgundy", "violet")

    @Composable private fun Frame(width: Int = 390, palette: String = "blue", dark: Boolean = false,
        sacred: Boolean = true, content: @Composable () -> Unit) {
        CompositionLocalProvider(LocalGenesisLanguage provides "ru", LocalEveningTheme provides dark,
            LocalDarkPalette provides palette, LocalSacredFeaturesEnabled provides sacred,
            LocalDensity provides Density(context.resources.displayMetrics.widthPixels.toFloat() / width, 1.3f)) {
            MaterialTheme(colorScheme = if (dark) eveningPalette(palette) else daylightPalette(palette),
                typography = GenesisTypography, shapes = GenesisShapes) {
                Surface(Modifier.fillMaxSize()) { Box(Modifier.safeDrawingPadding()) { content() } }
            }
        }
    }

    private fun shot(name: String) {
        compose.waitForIdle()
        captureNativeWindow(File(context.getExternalFilesDir(null), "release331-$name.png"))
    }

    private fun ink(tag: String): Color {
        val layouts = mutableListOf<TextLayoutResult>()
        compose.onNodeWithTag(tag, useUnmergedTree = true).fetchSemanticsNode()
            .config[SemanticsActions.GetTextLayoutResult].action!!.invoke(layouts)
        return layouts.single().layoutInput.style.color
    }

    @Test fun todayAndSelectedDayKeepLightInkInAllPalettes() {
        var palette by mutableStateOf("blue"); var dark by mutableStateOf(false)
        var mode by mutableStateOf(CalendarMode.SACRED); var selected by mutableStateOf(false)
        var epoch by mutableIntStateOf(0)
        compose.setContent { key(epoch) { Frame(palette = palette, dark = dark) {
            if (selected) CalendarScreen(date, mode, {}, experimental = true)
            else Column(Modifier.verticalScroll(rememberScrollState()).padding(8.dp)) { DayHeader(date, mode) }
        } } }
        for (p in palettes) for (night in listOf(false, true)) for (m in CalendarMode.entries) {
            compose.runOnIdle { palette = p; dark = night; mode = m; selected = false; epoch++ }
            compose.onNodeWithTag("today-civil-date", useUnmergedTree = true).assertExists()
            assertTrue("Today date must stay light: $p/$night/$m", ink("today-civil-date").red > .8f)
            if (m == CalendarMode.SACRED) shot("today-$p-$night")
            compose.runOnIdle { selected = true; epoch++ }
            compose.onNodeWithTag("calendar-selected-day").performScrollTo()
            assertTrue("Selected day must stay light: $p/$night/$m", ink("calendar-selected-primary-date").red > if (night) .7f else .8f)
            if (!night) compose.onNodeWithTag("calendar-day-light-shade", useUnmergedTree = true).assertExists()
            if (p == "blue") shot("selected-$m-$night")
        }
    }

    @Test fun plainCalendarHasSquareDaysCompactMonthAndNoMonthDescriptionsInYear() {
        var width by mutableIntStateOf(390); var dark by mutableStateOf(false)
        var year by mutableStateOf(false); var epoch by mutableIntStateOf(0)
        compose.setContent { key(epoch) { Frame(width, dark = dark, sacred = false) {
            CalendarScreen(date, CalendarMode.PROFANE, {}, experimental = true,
                hiddenSubmenus = if (year) setOf("calendar.month") else setOf("calendar.year"))
        } } }
        for (w in listOf(360, 390, 768, 1440)) for (night in listOf(false, true)) {
            compose.runOnIdle { width = w; dark = night; year = false; epoch++ }
            val cell = compose.onNodeWithTag("calendar-day-$date").getUnclippedBoundsInRoot()
            assertEquals("Square day at $w/$night", cell.width.value, cell.height.value, 1f)
            val month = compose.onNodeWithTag("month-description-layout").getUnclippedBoundsInRoot()
            assertTrue("Plain month should lose its empty middle: $w/$night", month.height.value <= 132f)
            shot("plain-month-$w-$night")
            compose.runOnIdle { year = true; epoch++ }
            compose.onNodeWithText(gregorianMonthOrigin(11), useUnmergedTree = true).assertDoesNotExist()
            compose.onNodeWithText(gregorianMonthNature(11, ZoneId.systemDefault()), useUnmergedTree = true).assertDoesNotExist()
            compose.onNodeWithTag("gregorian-year-month-number-1", useUnmergedTree = true).assertExists()
            shot("plain-year-$w-$night")
        }
        assertEquals("Календарь", calendarScreenTitle(CalendarMode.PROFANE, false))
    }

    @Test fun heroPathAndItsContainerUseTheSelectedPaletteInBothSchemes() {
        var palette by mutableStateOf("blue"); var dark by mutableStateOf(false); var epoch by mutableIntStateOf(0)
        compose.setContent { key(epoch) { Frame(palette = palette, dark = dark) {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                HabitArtGallery(LocalHabitWorkspace(), date, false, {}, {}, {})
            }
        } } }
        for (p in palettes) for (night in listOf(false, true)) {
            compose.runOnIdle { palette = p; dark = night; epoch++ }
            compose.onNodeWithTag("all-hero-ranks").performClick()
            compose.onNodeWithTag("hero-current-rank").performScrollTo().assertIsDisplayed()
            shot("hero-$p-$night")
        }
    }

    @Test fun projectEditorUsesCompactStandardInsets331() {
        var dark by mutableStateOf(false)
        compose.setContent { Frame(dark=dark) { ProjectEditor(WorkspaceStructure(),null,null,onDismiss={},onSave={_,_->}) } }
        for (night in listOf(false,true)) {
            compose.runOnIdle { dark=night }
            val frame=compose.onNodeWithTag("genesis-modal-surface").getUnclippedBoundsInRoot()
            val content=compose.onNodeWithTag("project-editor-content",useUnmergedTree=true).getUnclippedBoundsInRoot()
            assertTrue(content.left.value-frame.left.value <= 7f)
            compose.onNodeWithTag("project-title").assertIsDisplayed()
            shot("project-$night")
        }
    }

    @Test fun selectedDayShadeActuallyDarkensPixelsByThirtyPercent() {
        compose.setContent { Frame { Box(Modifier.size(100.dp)) {
            androidx.compose.material3.Surface(Modifier.fillMaxSize(), color = Color.White) {}
            CalendarHeroContrast(Modifier.fillMaxSize())
        } } }
        val pixels = compose.onNodeWithTag("calendar-day-light-shade", useUnmergedTree = true).captureToImage().toPixelMap()
        val pixel = pixels[pixels.width / 2, pixels.height / 2]
        assertEquals(.70f, pixel.red, .015f)
        assertEquals(pixel.red, pixel.green, .001f)
        assertEquals(pixel.green, pixel.blue, .001f)
    }

    @Test fun artworkButtonsHaveTheRequestedOpacityAndStillNavigate() {
        var palette by mutableStateOf("blue"); var dark by mutableStateOf(false)
        var previous = 0; var next = 0; var today = 0
        var surface = Color.White
        compose.setContent { Frame(palette = palette, dark = dark) {
            surface = MaterialTheme.colorScheme.surface
            Box(Modifier.fillMaxWidth().background(Color.Black)) {
                CalendarMonthHeroNavigation({ previous++ }, { next++ }, offerToday = true, onToday = { today++ })
            }
        } }
        for (p in palettes) for (night in listOf(false, true)) {
            compose.runOnIdle { palette = p; dark = night }
            val expected = if (night) Color.Black else surface.copy(alpha = .20f).compositeOver(Color.Black)
            for (action in listOf("previous", "next", "today")) {
                val node = compose.onNodeWithTag("calendar-month-$action")
                val bounds = node.getUnclippedBoundsInRoot()
                assertEquals(48f, bounds.width.value, 1f)
                assertEquals(48f, bounds.height.value, 1f)
                val pixels = node.captureToImage().toPixelMap()
                val pixel = pixels[pixels.width / 5, pixels.height / 5]
                assertEquals("$p/$night/$action red", expected.red, pixel.red, .015f)
                assertEquals("$p/$night/$action green", expected.green, pixel.green, .015f)
                assertEquals("$p/$night/$action blue", expected.blue, pixel.blue, .015f)
                node.performClick()
            }
        }
        assertEquals(8, previous); assertEquals(8, next); assertEquals(8, today)
    }

    @Test fun weekdaySelectionsKeepGoldSilverAndGrayInEveryLightPalette() {
        val sunday = LocalDate.of(2027, 1, 3)
        var palette by mutableStateOf("blue"); var dark by mutableStateOf(false)
        var selected by mutableStateOf(sunday.minusDays(1))
        compose.setContent { Frame(palette = palette, dark = dark, sacred = false) {
            Row(Modifier.fillMaxWidth().padding(4.dp), horizontalArrangement = Arrangement.spacedBy(1.dp)) {
                repeat(7) { offset ->
                    val day = sunday.plusDays(offset.toLong())
                    CalendarDay(GenesisCalendar(), day, day.dayOfMonth, null, day.dayOfWeek.name,
                        selected == day, { selected = it }, Modifier.weight(1f), null, null, 0, null,
                        patron = weekdayPatronMark(day))
                }
            }
        } }
        fun fill(day: LocalDate): Color {
            val pixels = compose.onNodeWithTag("calendar-day-$day").captureToImage().toPixelMap()
            return pixels[pixels.width / 2, pixels.height * 4 / 5]
        }
        val daylightSelections = listOf(0xffbe963c, 0xff9fa7b0, 0xffc47b6c, 0xff6fa582,
            0xff6e99c2, 0xffa483bd, 0xff656c75).map { Color(it) }
        for (p in palettes) for (night in listOf(false, true)) {
            compose.runOnIdle { palette = p; dark = night; selected = sunday.minusDays(1) }
            val mondayWash = fill(sunday.plusDays(1)); val saturdayWash = fill(sunday.plusDays(6))
            if (!night) {
                assertTrue(saturdayWash.luminance() < mondayWash.luminance())
                val washes = (0..6).map { fill(sunday.plusDays(it.toLong())).luminance() }
                assertTrue("Balanced ordinary days: $p", washes.max() - washes.min() < .08f)
            }
            for (offset in 0..6) {
                val day = sunday.plusDays(offset.toLong())
                compose.onNodeWithTag("calendar-day-$day").performClick().assertIsSelected()
                val expected = if (night) weekdayPatronMark(day).selectedBackground else daylightSelections[offset]
                val pixel = fill(day)
                assertEquals("$p/$night/$day red", expected.red, pixel.red, .015f)
                assertEquals("$p/$night/$day green", expected.green, pixel.green, .015f)
                assertEquals("$p/$night/$day blue", expected.blue, pixel.blue, .015f)
                if (offset in listOf(0,1,6)) shot("weekday-$offset-$p-$night")
            }
        }
    }
}
