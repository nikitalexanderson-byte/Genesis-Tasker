package ru.genesis.calendar.ui

import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.StoicheionGestureActivity
import ru.genesis.calendar.captureNativeWindow
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.GenesisCalendar
import java.io.File
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.temporal.TemporalAdjusters
import java.util.Locale
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.roundToInt

/** Real production composables at the device's own density/font scale; no account fixture or clock change. */
class CalendarVisual317Test {
    @get:Rule val compose = createAndroidComposeRule<StoicheionGestureActivity>()
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    @Composable private fun Frame(dark: Boolean, sacred: Boolean = true, content: @Composable () -> Unit) {
        CompositionLocalProvider(LocalEveningTheme provides dark,
            LocalSacredFeaturesEnabled provides sacred, LocalGenesisLanguage provides "ru") {
            MaterialTheme(colorScheme = if (dark) evening else standart,
                typography = GenesisTypography, shapes = GenesisShapes) {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    Box(Modifier.safeDrawingPadding()) { content() }
                }
            }
        }
    }

    private fun capture(name: String) {
        compose.mainClock.advanceTimeByFrame()
        compose.waitForIdle()
        captureNativeWindow(File(context.getExternalFilesDir(null), "calendar-visual317-$name.png"))
    }

    private fun proof(name: String, body: JSONObject) {
        val metrics = context.resources.displayMetrics
        body.put("runId", InstrumentationRegistry.getArguments().getString("genesisRunId", "manual"))
            .put("widthPx", metrics.widthPixels).put("heightPx", metrics.heightPixels)
            .put("density", metrics.density).put("fontScale", context.resources.configuration.fontScale)
            .put("scope", "isolated production composables; not a signed-in whole-app journey")
        File(context.getExternalFilesDir(null), "calendar-visual317-$name.json").writeText(body.toString(2))
    }

    /** The largest flat interior region is the actual fill, independent of text and optional marks. */
    private fun dominantFill(node: SemanticsNodeInteraction): Int {
        val image = node.captureToImage().asAndroidBitmap()
        val inset = max(2, (4 * context.resources.displayMetrics.density).roundToInt())
        val colors = mutableMapOf<Int, Int>()
        for (y in inset until image.height - inset step 2) for (x in inset until image.width - inset step 2) {
            val color = image.getPixel(x, y)
            colors[color] = (colors[color] ?: 0) + 1
        }
        return requireNotNull(colors.maxByOrNull { it.value }).key
    }

    @Test fun gregorianCellsKeepWeekdayColorsWithoutSacredMarks() {
        val calendar = GenesisCalendar()
        val today = LocalDate.now()
        val first = today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
        val dates = (0L..6L).map(first::plusDays)
        val selectedDate = dates[2]
        val adjacent = first.plusWeeks(1)
        val taskDate = dates[4]
        val sharedDate = dates[6]
        var dark by mutableStateOf(false)
        var sacred by mutableStateOf(true)
        var chosen: LocalDate? = null
        var tasksOpened: LocalDate? = null
        val states = JSONArray()
        val evidence = JSONObject().put("completed", false).put("actualToday", today.toString()).put("states", states)
        compose.setContent {
            Frame(dark, sacred) {
                CompositionLocalProvider(LocalSharedCalendarCounts provides mapOf(sharedDate.toString() to 3)) {
                    Column(Modifier.fillMaxWidth().padding(8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(1.dp)) {
                            dates.forEach { date ->
                                CalendarDay(calendar, date, date.dayOfMonth, null, "Григорианский день",
                                    date == selectedDate, { chosen = it }, Modifier.weight(1f),
                                    calendar.moonInfo(date), null, if (date == taskDate) 2 else 0, null,
                                    patron = weekdayPatronMark(date), completedTaskCount = if (date == taskDate) 1 else 0,
                                    onTaskBadgeClick = { tasksOpened = it })
                            }
                        }
                        Row {
                            CalendarDay(calendar, adjacent, adjacent.dayOfMonth, null, "Другой месяц", false,
                                { chosen = it }, Modifier.width(64.dp), calendar.moonInfo(adjacent),
                                null, 0, null, patron = weekdayPatronMark(adjacent), adjacent = true)
                        }
                    }
                }
            }
        }
        try {
            for (eveningMode in listOf(false, true)) {
                val fills = mutableMapOf<Boolean, List<Int>>()
                for (enabled in listOf(true, false)) {
                    compose.runOnIdle { dark = eveningMode; sacred = enabled }
                    compose.waitForIdle()
                    val colors = (dates + adjacent).map { date ->
                        val node = compose.onNodeWithTag("calendar-day-$date")
                        val description = node.fetchSemanticsNode().config[SemanticsProperties.ContentDescription].joinToString()
                        val mark = weekdayPatronMark(date)
                        if (enabled) {
                            compose.onNodeWithTag("calendar-patron-$date", useUnmergedTree = true).assertExists()
                            assertTrue(description.contains(mark.patrons))
                            assertTrue(description.contains("лунный день"))
                        } else {
                            compose.onNodeWithTag("calendar-patron-$date", useUnmergedTree = true).assertDoesNotExist()
                            assertFalse(description.contains(mark.patrons))
                            assertFalse(description.contains(mark.symbol))
                            assertFalse(description.contains("лунный день"))
                        }
                        dominantFill(node)
                    }
                    fills[enabled] = colors
                    compose.onNodeWithTag("calendar-day-$selectedDate").assertIsSelected()
                    compose.onNodeWithTag("calendar-day-$adjacent").assertIsNotEnabled()
                    compose.onNodeWithTag("calendar-task-count-$taskDate").assertIsDisplayed()
                    compose.onNodeWithTag("calendar-shared-count-$sharedDate").assertIsDisplayed()
                    states.put(JSONObject().put("dark", eveningMode).put("sacred", enabled)
                        .put("fillsArgb", JSONArray(colors.map { Integer.toHexString(it) })))
                    capture("cells-${if (eveningMode) "dark" else "light"}-${if (enabled) "on" else "off"}")
                }
                assertEquals("Weekday, selected and adjacent fills must survive sacred on/off", fills[true], fills[false])
                val background = (if (eveningMode) evening else standart).surface.toArgb()
                assertTrue("All seven weekday cells remain visibly tinted", fills.getValue(false).take(7).all { it != background })
            }
            // Click after pixel comparisons so press/ripple feedback cannot contaminate the fill samples.
            compose.onNodeWithTag("calendar-task-count-$taskDate").performClick()
            compose.runOnIdle { assertEquals(taskDate, tasksOpened) }
            compose.onNodeWithTag("calendar-day-${dates[0]}").performClick()
            compose.runOnIdle { assertEquals(dates[0], chosen) }
            evidence.put("completed", true)
        } finally {
            proof("cells", evidence.put("moonVisuals", "moon accessibility text is absent when off; unlabelled Canvas absence is also reviewed in paired captures"))
        }
    }

    @Test fun todayUsesBrightArtworkAndPaperOnlyBehindLightTextGroups() {
        val date = LocalDate.of(2026, 11, 3)
        val calendar = GenesisCalendar()
        val copy = todayHeroCopy(date, CalendarMode.PROFANE, calendar, "ru")
        val scroll = ScrollState(0)
        var dark by mutableStateOf(false)
        var reference by mutableStateOf(false)
        var artHeight by mutableStateOf(1.dp)
        val states = JSONArray()
        val evidence = JSONObject().put("completed", false).put("artPath", copy.imagePath).put("states", states)
        compose.setContent {
            Frame(dark) {
                Column(Modifier.fillMaxSize().verticalScroll(scroll).padding(12.dp)) {
                    if (reference) Box(Modifier.fillMaxWidth().height(artHeight)) {
                        OriginalImage(copy.imagePath, null, Modifier.matchParentSize(), dimInDarkTheme = false)
                    } else DayHeader(date, CalendarMode.PROFANE)
                }
            }
        }
        try {
            for (eveningMode in listOf(false, true)) {
                compose.runOnIdle { dark = eveningMode; reference = false; runBlocking { scroll.scrollTo(0) } }
                compose.waitForIdle()
                val state = JSONObject().put("dark", eveningMode)
                states.put(state)
                val hero = compose.onNodeWithTag("today-hero").fetchSemanticsNode()
                val density = hero.layoutInfo.density.density
                val bounds = hero.boundsInRoot
                val widthBucket = ((hero.size.width + 127) / 128) * 128
                val heightBucket = ((hero.size.height + 127) / 128) * 128
                compose.waitUntil(10_000) { OriginalImageLoader.cached(copy.imagePath, widthBucket, heightBucket) != null }
                compose.mainClock.advanceTimeByFrame()
                compose.waitForIdle()
                capture("today-${if (eveningMode) "dark" else "light"}-top")
                val actual = compose.onRoot().captureToImage().asAndroidBitmap()
                val rootBounds = compose.onRoot().fetchSemanticsNode().boundsInRoot
                var largestGutterDelta = 0
                if (!eveningMode) {
                    // Render the same OriginalImage at the measured hero geometry, without text/overlay.
                    // Comparing exposed gutter pixels catches a whole-image wash without a product test hook.
                    compose.runOnIdle { artHeight = (hero.size.height / density).dp; reference = true }
                    compose.waitForIdle()
                    val original = compose.onRoot().captureToImage().asAndroidBitmap()
                    val xPositions = listOf(bounds.left + 6 * density, bounds.right - 6 * density)
                    val top = (bounds.top - rootBounds.top + 32 * density).roundToInt()
                    val bottom = minOf(actual.height, original.height, (bounds.bottom - rootBounds.top).roundToInt()) - (20 * density).roundToInt()
                    val sourceColors = mutableSetOf<Int>()
                    for (y in top until bottom step max(1, (37 * density).roundToInt())) for (xAbsolute in xPositions) {
                        val x = (xAbsolute - rootBounds.left).roundToInt()
                        val expected = original.getPixel(x, y)
                        sourceColors += expected
                        largestGutterDelta = max(largestGutterDelta, colorDelta(actual.getPixel(x, y), expected))
                    }
                    state.put("largestLightGutterChannelDelta", largestGutterDelta).put("referenceSampleColors", sourceColors.size)
                    assertTrue("Reference artwork has decoded varied pixels", sourceColors.size > 3)
                    assertTrue("Exposed illustration keeps original colors (max channel delta $largestGutterDelta)", largestGutterDelta <= 2)
                    compose.runOnIdle { reference = false }
                    compose.waitForIdle()
                }
                val fills = JSONObject()
                state.put("textFillsArgb", fills)
                for (tag in listOf("today-hero-context", "today-hero-meaning", "today-hero-details", "today-solar-times")) {
                    val group = compose.onNodeWithTag(tag, useUnmergedTree = true).performScrollTo().assertIsDisplayed()
                    val color = dominantFill(group)
                    fills.put(tag, Integer.toHexString(color))
                    if (!eveningMode) assertEquals("Light text block $tag follows app paper", standart.background.toArgb(), color)
                }
                capture("today-${if (eveningMode) "dark" else "light"}-solar")
                if (eveningMode) state.put("largestLightGutterChannelDelta", JSONObject.NULL)
            }
            evidence.put("completed", true)
        } finally {
            proof("today", evidence)
        }
    }

    @Test fun lunarTodayKeepsTheMoonAndPhaseInsideTheFirstOfThreeGroups() {
        val date = LocalDate.of(2026, 11, 6)
        val calendar = GenesisCalendar()
        val moon = calendar.moonInfo(date)
        val copy = todayHeroCopy(date, CalendarMode.LUNAR, calendar, "ru")
        val lunarContext = requireNotNull(copy.lunarContext)
        val scroll = ScrollState(0)
        var dark by mutableStateOf(false)
        compose.setContent {
            Frame(dark) {
                Column(Modifier.fillMaxSize().verticalScroll(scroll).padding(12.dp)) {
                    DayHeader(date, CalendarMode.LUNAR)
                }
            }
        }
        for (eveningMode in listOf(false, true)) {
            compose.runOnIdle { dark = eveningMode; runBlocking { scroll.scrollTo(0) } }
            compose.onNodeWithTag("today-hero-moon", useUnmergedTree = true).assertDoesNotExist()
            val context = compose.onNodeWithTag("today-hero-context", useUnmergedTree = true)
                .assertIsDisplayed().fetchSemanticsNode().boundsInRoot
            val phaseIcon = compose.onNodeWithTag("today-lunar-phase", useUnmergedTree = true)
                .assert(hasAnyAncestor(hasTestTag("today-hero-context"))).fetchSemanticsNode().boundsInRoot
            val month = compose.onNodeWithTag("today-hero-month", useUnmergedTree = true)
                .assert(hasAnyAncestor(hasTestTag("today-hero-context")))
                .assertTextEquals("${copy.month} — ${lunarContext.monthTitle}").fetchSemanticsNode().boundsInRoot
            val progress = compose.onNodeWithTag("today-lunar-progress", useUnmergedTree = true)
                .assert(hasAnyAncestor(hasTestTag("today-hero-context")))
                .assertTextEquals(lunarContext.progress).fetchSemanticsNode().boundsInRoot
            val epithet = compose.onNodeWithTag("today-lunar-epithet", useUnmergedTree = true)
                .assertTextEquals(moon.epithet.uppercase(Locale.forLanguageTag("ru"))).fetchSemanticsNode().boundsInRoot
            val phase = compose.onNodeWithTag("today-lunar-description", useUnmergedTree = true)
                .assertTextEquals("${moon.direction} · ${moon.phase} · ${moon.illumination}%")
                .fetchSemanticsNode().boundsInRoot
            assertTrue("Moon is in the upper right of the context block", phaseIcon.center.x > context.center.x && phaseIcon.top < month.top)
            assertTrue(phaseIcon.right <= context.right && phaseIcon.top >= context.top)
            assertTrue("Month context keeps the width below the moon", month.right >= phaseIcon.right - 1f)
            assertTrue("Progress and phase follow the month", month.bottom <= progress.top &&
                progress.bottom <= epithet.top && epithet.bottom <= phase.top)
            assertTrue(phase.bottom <= context.bottom)
            compose.onNodeWithTag("today-calendar-image", useUnmergedTree = true).assertExists()
            compose.onNodeWithTag("today-hero-description").assertTextEquals(copy.description)
            compose.onNodeWithTag("today-hero-details", useUnmergedTree = true).assertDoesNotExist()
            for (tag in listOf("today-hero-meaning", "today-solar-times")) {
                compose.onNodeWithTag(tag, useUnmergedTree = true).performScrollTo().assertIsDisplayed()
            }
            capture("lunar-three-groups-${if (eveningMode) "dark" else "light"}")
        }
    }

    private fun colorDelta(first: Int, second: Int): Int = maxOf(
        abs((first shr 16 and 255) - (second shr 16 and 255)),
        abs((first shr 8 and 255) - (second shr 8 and 255)),
        abs((first and 255) - (second and 255)))
}
