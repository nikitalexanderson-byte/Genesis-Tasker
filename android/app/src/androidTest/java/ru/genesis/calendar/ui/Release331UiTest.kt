package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toPixelMap
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
}
