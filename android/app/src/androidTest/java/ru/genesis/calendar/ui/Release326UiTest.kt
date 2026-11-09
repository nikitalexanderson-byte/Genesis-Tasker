package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.time.LocalDate
import java.time.ZoneId
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.StoicheionGestureActivity
import ru.genesis.calendar.captureNativeWindow
import ru.genesis.calendar.data.LocalHabitWorkspace
import ru.genesis.calendar.domain.*

class Release326UiTest {
    @get:Rule val compose = createAndroidComposeRule<StoicheionGestureActivity>()
    private val app get() = compose.activity.application as GenesisApplication
    private val args get() = InstrumentationRegistry.getArguments()
    @Before fun isolated() { check(BuildConfig.DEBUG && app.packageName.endsWith(".qa326.debug")); app.activateAccount(null) }
    @Composable private fun Frame(dark: Boolean, palette: String, width: Int = 390, scroll: Boolean = true, content: @Composable () -> Unit) {
        val font = args.getString("genesisFontScale")?.toFloatOrNull() ?: 1.3f
        val density = Density(compose.activity.resources.displayMetrics.widthPixels.toFloat() / width, font)
        CompositionLocalProvider(LocalEveningTheme provides dark, LocalDarkPalette provides palette,
            LocalGenesisLanguage provides "en", LocalDensity provides density, LocalSacredFeaturesEnabled provides true) {
            MaterialTheme(colorScheme = if (dark) eveningPalette(palette) else daylightPalette(palette),
                typography = GenesisTypography, shapes = GenesisShapes) {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    Column(Modifier.fillMaxSize().safeDrawingPadding().then(if (scroll)
                        Modifier.verticalScroll(rememberScrollState()).padding(12.dp) else Modifier)) { content() }
                }
            }
        }
    }
    private fun capture(name: String) { compose.waitForIdle(); captureNativeWindow(File(app.getExternalFilesDir(null), "release326-$name.png")) }

    @Test fun fourPalettesRemainSelectableInLightAndDarkAndAtEveryWidth() {
        var dark by mutableStateOf(false)
        var palette by mutableStateOf("green")
        var width by mutableIntStateOf(390)
        compose.setContent { Frame(dark, palette, width) {
            AppearancePanel(app, LocalHabitWorkspace(), true, accountTheme = if (dark) "standart-dark" else "standart",
                darkPalette = palette, onPalette = { palette = it })
        } }
        for (night in listOf(false, true)) for (w in listOf(360,390,768,1440)) {
            compose.runOnIdle { dark=night; width=w }
            for (id in listOf("green","blue","burgundy","violet")) {
                compose.onNodeWithTag("appearance-palette").performScrollTo().performClick()
                val name = when(id) { "green" -> "Forest · default"; "blue" -> "Night sky"; "burgundy" -> "Ruby"; else -> "Purple" }
                compose.onAllNodesWithText(name).onLast().performClick()
                compose.runOnIdle { assertEquals(id,palette) }
                capture("palette-$id-${if(night) "dark" else "light"}-$w")
            }
        }
    }

    @Test fun eachDecadeUsesItsOwnArtAndCaptionBelowTheLargerMoon() {
        val calendar = GenesisCalendar(ZoneId.systemDefault())
        val start = calendar.lunarMonthStart(calendar.lunarMonthIndex(LocalDate.of(2026,11,8)))
        var day by mutableIntStateOf(1)
        var dark by mutableStateOf(false)
        compose.setContent { Frame(dark, "blue") { DayHeader(start.plusDays((day-1).toLong()), CalendarMode.LUNAR) } }
        for (night in listOf(false,true)) for (d in listOf(1,11,21)) {
            compose.runOnIdle { dark=night; day=d }
            val name = lunarPatronForDay(d).let { when(it) { LunarPatron.ARTEMIS -> "Artemis"; LunarPatron.SELENE -> "Selene"; else -> "Hecate" } }
            compose.onNodeWithTag("today-lunar-epithet").assertTextEquals(name)
            val moon = compose.onNodeWithTag("today-lunar-disc").fetchSemanticsNode().boundsInRoot
            val caption = compose.onNodeWithTag("today-lunar-epithet").fetchSemanticsNode().boundsInRoot
            assertTrue(caption.top >= moon.bottom)
            assertEquals(lunarPatronForDay(d).artPath, todayHeroCopy(start.plusDays((d-1).toLong()),CalendarMode.LUNAR,calendar,"en").imagePath)
            compose.waitUntil(5_000) { compose.onAllNodesWithTag("lunar-triad").fetchSemanticsNodes().isNotEmpty() }
            val artSize = compose.onNodeWithTag("today-calendar-image").fetchSemanticsNode().size
            compose.waitUntil(10_000) { OriginalImageLoader.cached(lunarPatronForDay(d).artPath,
                ((artSize.width + 127) / 128) * 128, ((artSize.height + 127) / 128) * 128) != null }
            capture("lunar-$d-${if(night) "dark" else "light"}")
        }
    }

    @Test fun civilLandscapeAndItsReadingAreasRenderInBothModes() {
        // Solar relighting outlasts its one-second clock tick; freeze frame time for deterministic captures.
        compose.mainClock.autoAdvance = false
        var dark by mutableStateOf(false)
        var width by mutableIntStateOf(390)
        val zone = ZoneId.of("Europe/Moscow")
        compose.setContent { Frame(dark, "blue", width) {
            CivilTodayHero(SolarLocation(55.7558,37.6173,"Europe/Moscow","Москва",false),
                GenesisCalendar(zone), zone)
        } }
        compose.mainClock.advanceTimeBy(2_000)
        for (night in listOf(false,true)) for (w in listOf(360,390,768,1440)) {
            compose.runOnIdle { dark=night; width=w }
            compose.waitUntil(10_000) { compose.mainClock.advanceTimeByFrame()
                compose.onAllNodesWithTag("civil-today-terrain").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithTag("today-civil-date").assertIsDisplayed()
            capture("civil-${if(night) "dark" else "light"}-$w")
        }
    }

    @Test fun habitChoicesAndExpandedAlphabetFitTheirPanels() {
        compose.mainClock.autoAdvance = true
        val display=compose.activity.resources.displayMetrics
        val widths=if(display.widthPixels<display.heightPixels) listOf(360,390) else listOf(768,1440)
        var dark by mutableStateOf(false)
        var width by mutableIntStateOf(390)
        var oracle by mutableStateOf(false)
        compose.setContent { Frame(dark, "blue", width, scroll = false) {
            CompositionLocalProvider(LocalGenesisLanguage provides "ru") {
                if (oracle) StoicheionScreen(app, true)
                else HabitsScreen(app, true, CalendarMode.PROFANE, CalendarMode.PROFANE)
            }
        } }
        fun rect(tag: String) = compose.onNodeWithTag(tag).fetchSemanticsNode().boundsInRoot
        for (night in listOf(false,true)) for (w in widths) {
            compose.runOnIdle { dark=night; width=w; oracle=false }
            compose.waitUntil(10_000) { compose.onAllNodesWithTag("habit-create").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithTag("habit-create").performClick()
            val binary=rect("habit-measurement-binary")
            val quantity=rect("habit-measurement-quantity")
            val duration=rect("habit-measurement-duration")
            assertEquals(quantity.width,duration.width,1f)
            assertEquals(quantity.top,duration.top,1f)
            assertEquals(binary.left,quantity.left,1f)
            assertEquals(binary.right,duration.right,1f)
            capture("habit-measurement-${if(night) "dark" else "light"}-$w")
            compose.onNodeWithTag("habit-period-day").performScrollTo()
            val periods=listOf("day","week","month").map { rect("habit-period-$it") }
            periods.forEach { assertEquals(periods.first().width,it.width,1f); assertEquals(periods.first().top,it.top,1f) }
            capture("habit-period-${if(night) "dark" else "light"}-$w")
            // Scroll the vertical form first; the choice row has its own horizontal scroll ancestor.
            compose.onNodeWithText("Повторение").performScrollTo()
            compose.onNodeWithText("Дни недели").performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.OnClick) { it() }
            compose.onNodeWithTag("habit-schedule-day-7").performScrollTo()
            val days=(1..7).map { rect("habit-schedule-day-$it") }
            days.forEach { assertEquals(days.first().top,it.top,1f); assertEquals(days.first().width,it.width,1f) }
            val monday=compose.onNodeWithTag("habit-schedule-day-1")
            if (!monday.fetchSemanticsNode().config[androidx.compose.ui.semantics.SemanticsProperties.Selected]) monday.performClick()
            monday.assertIsSelected()
            capture("habit-days-${if(night) "dark" else "light"}-$w")
            compose.onNodeWithTag("habit-scoring-quality-bipolar").performScrollTo()
            val xp=listOf("none","binary","quality-ten","quality-bipolar").map { rect("habit-scoring-$it") }
            xp.forEach { assertEquals(xp.first().width,it.width,1f) }
            assertEquals(xp[0].top,xp[1].top,1f); assertEquals(xp[2].top,xp[3].top,1f)
            assertTrue(xp[2].top>xp[0].bottom)
            capture("habit-xp-${if(night) "dark" else "light"}-$w")
            compose.onNodeWithTag("habit-editor-close").performScrollTo().performClick()
            // The weekday choice is an unsaved draft; use the ordinary discard confirmation.
            if (compose.onAllNodesWithText("Не сохранять").fetchSemanticsNodes().isNotEmpty())
                compose.onNodeWithText("Не сохранять").performClick()
            compose.runOnIdle { oracle=true }
            // The local catalogue loads on Dispatchers.IO, outside the virtual Compose clock.
            android.os.SystemClock.sleep(500)
            compose.waitForIdle()
            // Use a real scroll gesture: lazy-grid semantic indexing can race its changing span table.
            val grid=compose.onNodeWithTag("stoicheion-grid")
            var found=false
            repeat(12) {
                if(!found) {
                    val viewport=grid.fetchSemanticsNode().boundsInRoot
                    val header=compose.onAllNodesWithTag("stoicheion-alphabet-toggle").fetchSemanticsNodes().firstOrNull()?.boundsInRoot
                    found=header!=null && header.top>=viewport.top && header.bottom<=viewport.bottom
                    if(!found) { grid.performTouchInput { swipeUp(durationMillis=250) }; compose.waitForIdle() }
                }
            }
            check(found) { "The loaded catalogue must be reachable by ordinary scrolling" }
            val beforeExpansion=rect("stoicheion-alphabet-toggle").top
            compose.onNodeWithTag("stoicheion-alphabet-toggle").performClick()
            compose.waitUntil(10_000) { compose.onAllNodesWithTag("stoicheion-letter-alpha").fetchSemanticsNodes().isNotEmpty() }
            compose.waitForIdle()
            compose.onNodeWithTag("stoicheion-letter-alpha").assertIsDisplayed()
            capture("alphabet-expanded-${if(night) "dark" else "light"}-$w")
            // At wide widths all 24 cards can already fit; scrolling then clamps at the content end.
            assertTrue("Expansion must reveal the catalogue without moving its header down",
                rect("stoicheion-alphabet-toggle").top <= beforeExpansion+1f)
        }
    }
}
