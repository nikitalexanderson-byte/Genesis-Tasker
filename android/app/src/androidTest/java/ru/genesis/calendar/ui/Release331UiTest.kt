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
import androidx.compose.ui.platform.testTag
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
import kotlinx.coroutines.launch
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.flow.first
import ru.genesis.calendar.data.LocalPreferences
import ru.genesis.calendar.data.UiPreferences
import ru.genesis.calendar.data.todayHiddenBlockIds
import ru.genesis.calendar.data.encodeTodayHiddenBlocks
import java.util.UUID

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
            compose.mainClock.advanceTimeBy(1000); compose.waitForIdle()
            val expected = if (night) Color.Black else surface.copy(alpha = .20f).compositeOver(Color.Black)
            for (action in listOf("previous", "next", "today")) {
                val node = compose.onNodeWithTag("calendar-month-$action")
                val bounds = node.getUnclippedBoundsInRoot()
                assertEquals(48f, bounds.width.value, 1f)
                assertEquals(48f, bounds.height.value, 1f)
                var pixel = Color.Unspecified
                // Native RenderThread ripples settle on wall time, independently of Compose's clock.
                compose.waitUntil(5000) {
                    val pixels = node.captureToImage().toPixelMap()
                    pixel = pixels[pixels.width / 5, pixels.height / 5]
                    kotlin.math.abs(pixel.red - expected.red) < .015f && kotlin.math.abs(pixel.green - expected.green) < .015f &&
                        kotlin.math.abs(pixel.blue - expected.blue) < .015f
                }
                assertEquals("$p/$night/$action red", expected.red, pixel.red, .015f)
                assertEquals("$p/$night/$action green", expected.green, pixel.green, .015f)
                assertEquals("$p/$night/$action blue", expected.blue, pixel.blue, .015f)
                node.performClick()
                compose.mainClock.advanceTimeBy(1000); compose.waitForIdle()
            }
        }
        assertEquals(8, previous); assertEquals(8, next); assertEquals(8, today)
    }

    @Test fun weekdaySelectionsKeepGoldSilverAndGrayInEveryLightPalette() {
        val sunday = LocalDate.of(2027, 1, 3)
        var palette by mutableStateOf("blue"); var dark by mutableStateOf(false)
        var sacred by mutableStateOf(false)
        var selected by mutableStateOf(sunday.minusDays(1))
        compose.setContent { Frame(palette = palette, dark = dark, sacred = sacred) {
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
        val daylightWashes = listOf(0xfff6edcf, 0xffeef0f2, 0xfff6eae5, 0xffe8f1ea,
            0xffe8eff6, 0xfff0eaf4, 0xffe6e8eb).map { Color(it) }
        for (p in palettes) for (night in listOf(false, true)) for (sacredEnabled in if (night) listOf(false, true) else listOf(false)) {
            compose.runOnIdle { palette = p; dark = night; sacred = sacredEnabled; selected = sunday.minusDays(1) }
            compose.mainClock.advanceTimeBy(1000); compose.waitForIdle()
            val mondayWash = fill(sunday.plusDays(1)); val saturdayWash = fill(sunday.plusDays(6))
            if (!night) {
                assertTrue(saturdayWash.luminance() < mondayWash.luminance())
                val washes = (0..6).map { fill(sunday.plusDays(it.toLong())).luminance() }
                assertTrue("Balanced ordinary days: $p", washes.max() - washes.min() < .08f)
            } else {
                val washes = (0..6).map { offset ->
                    val pixel = fill(sunday.plusDays(offset.toLong())); val daylight = daylightWashes[offset]
                    assertEquals(daylight.red * .32f, pixel.red, .015f)
                    assertEquals(daylight.green * .32f, pixel.green, .015f)
                    assertEquals(daylight.blue * .32f, pixel.blue, .015f)
                    pixel.luminance()
                }
                assertTrue("Balanced ordinary night days: $p", washes.max() - washes.min() < .015f)
            }
            for (offset in 0..6) {
                val day = sunday.plusDays(offset.toLong())
                compose.onNodeWithTag("calendar-day-$day").performClick().assertIsSelected()
                compose.mainClock.advanceTimeBy(1000); compose.waitForIdle()
                val rippleSettledAt = android.os.SystemClock.uptimeMillis() + 600
                val daylight = daylightSelections[offset]
                val expected = if (night) Color(daylight.red * .65f, daylight.green * .65f, daylight.blue * .65f) else daylight
                compose.waitUntil(5000) {
                    val pixel = fill(day)
                    android.os.SystemClock.uptimeMillis() >= rippleSettledAt &&
                        kotlin.math.abs(pixel.red - expected.red) < .015f && kotlin.math.abs(pixel.green - expected.green) < .015f &&
                        kotlin.math.abs(pixel.blue - expected.blue) < .015f
                }
                val pixel = fill(day)
                assertEquals("$p/$night/$day red", expected.red, pixel.red, .015f)
                assertEquals("$p/$night/$day green", expected.green, pixel.green, .015f)
                assertEquals("$p/$night/$day blue", expected.blue, pixel.blue, .015f)
                if (night) assertTrue("White dates must remain legible: $p/$day", (Color(0xfff5f6f7).luminance() + .05f) / (pixel.luminance() + .05f) >= 4.5f)
                if (offset in listOf(0,1,6)) shot("weekday-$offset-$p-$night-$sacredEnabled")
            }
        }
    }

    @Test fun weekdayHeadingsCenterOverTheirActualColumnsInEveryScheme() {
        val selected = LocalDate.of(2026, 11, 7)
        var width by mutableIntStateOf(390); var palette by mutableStateOf("blue")
        var dark by mutableStateOf(false); var sacred by mutableStateOf(true)
        var sundayFirst by mutableStateOf(true); var epoch by mutableIntStateOf(0)
        compose.setContent { key(epoch) { Frame(width, palette, dark, sacred) {
            CalendarScreen(selected, CalendarMode.PROFANE, {}, experimental = true,
                weekStartsOnSunday = sundayFirst, hiddenSubmenus = setOf("calendar.year"))
        } } }
        for (w in listOf(360,390,768,1440)) for (p in palettes) for (night in listOf(false,true))
            for (withSacred in listOf(false,true)) for (startSunday in listOf(false,true)) {
            compose.runOnIdle { width=w; palette=p; dark=night; sacred=withSacred; sundayFirst=startSunday; epoch++ }
            val first = if (startSunday) LocalDate.of(2026,11,1) else LocalDate.of(2026,10,26)
            for (index in 0..6) {
                val heading = compose.onNodeWithTag("calendar-weekday-heading-$index", useUnmergedTree=true)
                val column = compose.onNodeWithTag("calendar-day-${first.plusDays(index.toLong())}")
                val headingBounds = heading.getUnclippedBoundsInRoot(); val columnBounds = column.getUnclippedBoundsInRoot()
                assertEquals("Heading and column center: $w/$p/$night/$withSacred/$startSunday/$index",
                    (columnBounds.left.value+columnBounds.right.value)/2, (headingBounds.left.value+headingBounds.right.value)/2, 1f)
                val layouts = mutableListOf<TextLayoutResult>()
                heading.performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }
                val layout = layouts.single()
                assertEquals("Glyphs are centered inside the heading", layout.size.width/2f,
                    (layout.getLineLeft(0)+layout.getLineRight(0))/2, 1.5f)
            }
            if (p=="blue" && startSunday && w in listOf(360,390)) shot("gregorian-columns-$w-$night-$withSacred")
        }
    }

    @Test fun actualSharedTodayCardsStayDarkAndAllTheirTextKeepsContrast() {
        val day = "2026-11-14"
        val reader = SharedTaskListReader(object : ru.genesis.calendar.auth.SharedWorkspaceGateway {})
        val rows = org.json.JSONArray()
        for (done in listOf(false,true)) rows.put(org.json.JSONObject().put("id", "qa-$done")
            .put("title", "QA331 Shared $done").put("dueDate", day).put("projectId", "qa-project")
            .put("spaceId", "qa-space").put("projectTitle", "QA331 Project $done")
            .put("completedAt", if (done) "2026-11-14T10:00:00Z" else org.json.JSONObject.NULL))
        reader.pageState.value = org.json.JSONObject().put("total",2).put("hasMore",false).put("tasks",rows)
        var palette by mutableStateOf("blue")
        compose.setContent { Frame(palette=palette,dark=true) {
            Column(Modifier.padding(8.dp)) { TodaySharedTasks(reader,day) {} }
        } }
        for (p in palettes) {
            compose.runOnIdle { palette=p }
            for (done in listOf(false,true)) {
                val pixels = compose.onNodeWithTag("today-shared-task-qa-$done").captureToImage().toPixelMap()
                val paper = pixels[pixels.width-8,pixels.height/2]
                assertTrue("Shared task has no pale surface: $p/$done",paper.luminance()<.08f)
                for (label in listOf("QA331 Shared $done",day,"QA331 Project $done")) {
                    val layouts = mutableListOf<TextLayoutResult>()
                    compose.onNode(hasText(label) and hasAnyAncestor(hasTestTag("today-shared-task-qa-$done")),useUnmergedTree=true)
                        .performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }
                    val ink=layouts.single().layoutInput.style.color
                    assertTrue("Shared task text contrast: $p/$done/$label",(ink.luminance()+.05f)/(paper.luminance()+.05f)>=4.5f)
                }
            }
            shot("shared-today-$p")
        }
    }

    @Test fun eyesAndSettingsSharePersistedVisibilityAndHiddenBlocksCanBeRestored() {
        val labels = org.json.JSONObject(context.assets.open("native-3-translations.json").bufferedReader().use { it.readText() })
        for (language in listOf("ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja")) {
            for (action in listOf("Скрыть блок", "Показать блок")) {
                assertEquals("$language/$action", labels.getJSONObject(language).getString(action),
                    translateGenesisText(context, action, language))
            }
        }
        val accountScope = "qa331-visibility-${UUID.randomUUID()}"
        val store = LocalPreferences(context, accountScope)
        var settings by mutableStateOf(false); var editing by mutableStateOf(true)
        var epoch by mutableIntStateOf(0); var savedHidden: Set<String> = emptySet()
        var dark by mutableStateOf(false)
        compose.setContent { key(epoch) {
            val prefs by store.values.collectAsState(initial = UiPreferences())
            val hidden = todayHiddenBlockIds(prefs.todayHiddenBlocks, emptySet())
            savedHidden = hidden
            val scope = rememberCoroutineScope()
            val save: (Set<String>) -> Unit = { next -> scope.launch {
                store.set("todayHiddenBlocks", encodeTodayHiddenBlocks(next))
            }; Unit }
            Frame(dark = dark) {
                if (settings) Column { TodayBlockVisibilitySettings(hidden, save) }
                else SortableTodayWorkspace("", listOf(
                    TodayBlock("tasks", "Задачи дня") { Text("Synthetic tasks", Modifier.testTag("visibility-tasks-content")) },
                    TodayBlock("habits", "Трекер привычек") { Text("Synthetic habits", Modifier.testTag("visibility-habits-content")) }),
                    {}, editing, hidden, save) { Text("Today header", Modifier.testTag("visibility-header")) }
            }
        } }
        for (night in listOf(false, true)) {
            compose.runOnIdle { dark = night; settings = false; editing = true }
            compose.onNodeWithTag("today-visibility-tasks").performClick()
            compose.waitUntil(10000) { "tasks" in savedHidden }
            compose.onNodeWithTag("visibility-tasks-content").assertDoesNotExist()
            compose.runOnIdle { settings = true }
            compose.onNodeWithTag("today-visibility-tasks").assertIsOff().performClick()
            compose.waitUntil(10000) { "tasks" !in savedHidden }
            compose.runOnIdle { settings = false }
            compose.onNodeWithTag("visibility-tasks-content").assertIsDisplayed()
            compose.onNodeWithTag("today-visibility-tasks").performClick()
            compose.waitUntil(10000) { "tasks" in savedHidden }
            compose.onNodeWithTag("today-visibility-habits").performClick()
            compose.waitUntil(10000) { "habits" in savedHidden }
            compose.runOnIdle { editing = false; epoch++ }
            compose.waitForIdle()
            compose.waitUntil(10000) { savedHidden == setOf("tasks", "habits") }
            compose.onNodeWithTag("visibility-header").assertIsDisplayed()
            compose.onNodeWithTag("today-block-tasks").assertDoesNotExist()
            compose.onNodeWithTag("today-block-habits").assertDoesNotExist()
            val reloaded = runBlocking { LocalPreferences(context, accountScope).values.first() }
            assertEquals(setOf("tasks", "habits"), todayHiddenBlockIds(reloaded.todayHiddenBlocks, emptySet()))
            assertEquals("", runBlocking { LocalPreferences(context, "$accountScope-other").values.first() }.todayHiddenBlocks)
            compose.runOnIdle { editing = true }
            shot("hidden-blocks-$night")
            compose.onNodeWithTag("today-visibility-tasks").performClick()
            compose.waitUntil(10000) { "tasks" !in savedHidden }
            compose.onNodeWithTag("today-visibility-habits").performClick()
            compose.waitUntil(10000) { savedHidden.isEmpty() }
        }
    }

    @Test fun headerButtonsOnlyFadeTheirBackgroundAndLoseTheirOutline() {
        var palette by mutableStateOf("blue"); var dark by mutableStateOf(false)
        var container = Color.White; var surface = Color.White; var ink = Color.Black; var calendarInk = Color.Black
        compose.setContent { Frame(palette = palette, dark = dark) {
            container = MaterialTheme.colorScheme.primaryContainer
            surface = MaterialTheme.colorScheme.surface
            ink = MaterialTheme.colorScheme.onPrimaryContainer
            calendarInk = if (dark) MaterialTheme.colorScheme.primary else ink
            Row(Modifier.fillMaxWidth().background(surface)) {
                Text("Сегодня", Modifier.weight(1f))
                WorkspaceHeaderButton("Порядок блоков", "header-background-test", onClick = {}) { GenesisLucideIcon("arrow-up-down") }
                CalendarModeSwitcher(CalendarMode.PROFANE, {}, size = 48.dp, headerControl = true)
            }
        } }
        for (p in palettes) for (night in listOf(false, true)) {
            compose.runOnIdle { palette = p; dark = night }
            compose.mainClock.advanceTimeBy(1000); compose.waitForIdle()
            val expected = container.copy(alpha = container.alpha * .5f).compositeOver(surface)
            for (tag in listOf("header-background-test", "calendar-mode-icon-profane")) {
                val pixels = compose.onNodeWithTag(tag).captureToImage().toPixelMap()
                // A one-pixel sample in the middle of the former outline must be the fill.
                val edge = pixels[1, pixels.height / 2]
                assertEquals("$p/$night/$tag red", expected.red, edge.red, .015f)
                assertEquals("$p/$night/$tag green", expected.green, edge.green, .015f)
                assertEquals("$p/$night/$tag blue", expected.blue, edge.blue, .015f)
                val icon = if (tag == "header-background-test") ink else calendarInk
                var foundOpaqueInk = false
                for (x in pixels.width / 4 until pixels.width * 3 / 4) for (y in pixels.height / 4 until pixels.height * 3 / 4) {
                    val pixel = pixels[x, y]
                    if (kotlin.math.abs(pixel.red - icon.red) < .015f && kotlin.math.abs(pixel.green - icon.green) < .015f &&
                        kotlin.math.abs(pixel.blue - icon.blue) < .015f) foundOpaqueInk = true
                }
                assertTrue("Icons must keep their original ink: $p/$night/$tag", foundOpaqueInk)
            }
            shot("header-$p-$night")
        }
    }

    @Test fun mindmapCanvasSeparatesFromTheMainBackgroundInEveryLightPalette() {
        val map = ru.genesis.calendar.data.MindmapDocument.new("Synthetic map")
        var palette by mutableStateOf("blue"); var dark by mutableStateOf(false)
        var main = Color.White; var expected = Color.White
        compose.setContent { Frame(palette = palette, dark = dark) {
            main = MaterialTheme.colorScheme.background
            expected = if (dark) androidx.compose.ui.graphics.lerp(MaterialTheme.colorScheme.surface, MaterialTheme.colorScheme.primary, .09f)
                else androidx.compose.ui.graphics.lerp(main, Color.Black, .15f)
            NativeMindmapCanvas(map, map.rows(), org.json.JSONObject(), { it.text }, {}, {}, {}, { _, _ -> }, Modifier.fillMaxSize())
        } }
        for (p in palettes) for (night in listOf(false, true)) {
            compose.runOnIdle { palette = p; dark = night }; compose.waitForIdle()
            val pixels = compose.onNodeWithTag("mindmap-canvas").captureToImage().toPixelMap()
            val pixel = pixels[pixels.width * 9 / 10, pixels.height * 9 / 10]
            assertEquals(expected.red, pixel.red, .015f); assertEquals(expected.green, pixel.green, .015f)
            assertEquals(expected.blue, pixel.blue, .015f)
            if (!night) assertTrue("Canvas must be visibly darker: $p", main.luminance() - pixel.luminance() > .20f)
            shot("mindmap-canvas-$p-$night")
        }
    }

    @Test fun philosopherArtworkUsesDarkShadeAndWhiteInkInEveryLightPalette() {
        val bitmap = android.graphics.Bitmap.createBitmap(600, 400, android.graphics.Bitmap.Config.ARGB_8888)
            .apply { eraseColor(android.graphics.Color.WHITE) }
        var paintedBitmap by mutableStateOf(bitmap)
        val copy = org.json.JSONObject(context.assets.open("originals/i18n/daily-advice-copy.json").bufferedReader().use { it.readText() }).getJSONObject("ru")
        val card = ru.genesis.calendar.auth.DailyAdvice("advice-" + "a".repeat(24), "2026-11-14", "Афоризмы философов",
            "Synthetic philosophy quote.", "ru", emptyList(), null, false, emptyList(), collection = "philosophers")
        var palette by mutableStateOf("blue"); var dark by mutableStateOf(false)
        compose.setContent { Frame(palette = palette, dark = dark) {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                DailyAdviceCard(card, copy, paintedBitmap, false, false, onReaction = {}, onDismiss = {})
            }
        } }
        for (p in palettes) for (night in listOf(false, true)) {
            compose.runOnIdle { palette = p; dark = night }; compose.waitForIdle()
            if (!night) {
                assertEquals(Color.White, ink("daily-advice-title")); assertEquals(Color.White, ink("daily-advice-body"))
                val pixels = compose.onNodeWithTag("philosopher-art-dark-shade", useUnmergedTree = true).captureToImage().toPixelMap()
                val pixel = pixels[8, pixels.height / 2]
                assertEquals(.45f, pixel.red, .015f); assertEquals(pixel.red, pixel.green, .001f)
                assertTrue("White text must read even over the brightest image: $p", 1.05f / (pixel.luminance() + .05f) >= 4.5f)
            } else compose.onNodeWithTag("philosopher-art-dark-shade", useUnmergedTree = true).assertDoesNotExist()
            shot("philosopher-$p-$night")
        }
        InstrumentationRegistry.getArguments().getString("release331Artwork")?.let { path ->
            val illustration = requireNotNull(android.graphics.BitmapFactory.decodeFile(path))
            compose.runOnIdle { palette = "blue"; dark = false; paintedBitmap = illustration }
            shot("philosopher-blue-artwork")
        }
    }

    @Test fun personalCategoriesHaveTheirOwnCornerAndMindmapsLiveInTheHeader() {
        check(ru.genesis.calendar.BuildConfig.DEBUG && context.packageName.endsWith(".qa330.debug"))
        val token = UUID.randomUUID().toString()
        val privateContext = Project313Context(context, token)
        val app = android.app.Instrumentation.newApplication(ru.genesis.calendar.GenesisApplication::class.java, privateContext)
            as ru.genesis.calendar.GenesisApplication
        privateContext.fixtureApplication = app; app.activateAccount(null)
        val repo = ru.genesis.calendar.data.WorkspaceStructureRepository(app)
        val work = ru.genesis.calendar.data.GenesisCategory("work", "Work", "#366597", 0)
        val home = ru.genesis.calendar.data.GenesisCategory("home", "Home", "#347d54", 1)
        val first = ru.genesis.calendar.data.GenesisProject("first", null, work.id, "QA331 Work project", "", emptyList(), "active", 0)
        val second = first.copy(id = "second", categoryId = home.id, title = "QA331 Home project", position = 1)
        runBlocking { repo.saveCategory(work); repo.saveCategory(home); repo.saveProject(first); repo.saveProject(second) }
        val tasks = listOf(
            ru.genesis.calendar.data.LocalTask(id="work-task", title="QA331 Work task", projectId=first.id, categoryId=work.id),
            ru.genesis.calendar.data.LocalTask(id="home-task", title="QA331 Home task", projectId=second.id, categoryId=home.id),
            ru.genesis.calendar.data.LocalTask(id="loose-work", title="QA331 Loose work", categoryId=work.id),
            ru.genesis.calendar.data.LocalTask(id="loose-home", title="QA331 Loose home", categoryId=home.id))
        var width by mutableIntStateOf(390); var dark by mutableStateOf(false); var palette by mutableStateOf("blue")
        var mounted by mutableStateOf(true); var mindmapsOpened = 0; var hideKeyboard: (() -> Unit)? = null
        compose.setContent { Frame(width, palette, dark) {
            val focus = androidx.compose.ui.platform.LocalFocusManager.current
            val keyboard = androidx.compose.ui.platform.LocalSoftwareKeyboardController.current
            SideEffect { hideKeyboard = { focus.clearFocus(); keyboard?.hide() } }
            if (mounted) MobileWorkspaceShell("Личные дела", null, emptyList(), "Synthetic QA", true,
                onNavigate = {}, actions = {}) {
                ProjectsScreen(app, tasks, true, {}, {}, onMindmaps = { mindmapsOpened++ })
            }
        } }
        try {
            compose.waitUntil(10000) { compose.onAllNodesWithTag("projects-screen").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithTag("personal-mindmaps").assertHasClickAction().performClick()
            compose.runOnIdle { assertEquals(1, mindmapsOpened) }
            compose.onNodeWithTag("personal-category-filters").performClick(); compose.onNodeWithTag("category-filter-work").performClick()
            compose.onNodeWithTag("project-drop-first").assertIsDisplayed(); compose.onNodeWithTag("project-drop-second").assertDoesNotExist()
            compose.onNodeWithTag("personal-task-search-open").performClick()
            compose.onNodeWithTag("personal-category-filters").assertDoesNotExist()
            compose.onNodeWithTag("personal-task-search").performTextInput("QA331"); compose.runOnIdle { hideKeyboard?.invoke() }
            compose.onNodeWithText("QA331 Work task", useUnmergedTree = true).assertExists()
            compose.onNodeWithText("QA331 Loose work", useUnmergedTree = true).assertExists()
            compose.onNodeWithText("QA331 Home task", useUnmergedTree = true).assertDoesNotExist()
            compose.onNodeWithText("QA331 Loose home", useUnmergedTree = true).assertDoesNotExist()
            compose.onNodeWithTag("personal-task-search-close").performClick()
            compose.onNodeWithTag("personal-category-filters").performClick(); compose.onNodeWithTag("create-category").performClick()
            val categoryName = "QA331 New category"
            compose.onNodeWithTag("category-name").performTextInput(categoryName); compose.runOnIdle { hideKeyboard?.invoke() }
            compose.onNodeWithTag("save-category").performClick()
            compose.waitUntil(10000) { runBlocking { repo.workspace.first().categories.any { it.name == categoryName } } }
            val created = runBlocking { repo.workspace.first().categories.single { it.name == categoryName } }
            compose.onNodeWithTag("category-filter-${created.id}").performScrollTo().performClick()
            compose.onNodeWithTag("project-drop-first").assertDoesNotExist(); compose.onNodeWithTag("project-drop-second").assertDoesNotExist()
            compose.onNodeWithTag("personal-reset-category").performClick()
            compose.onNodeWithTag("personal-task-search-open").assertIsDisplayed()
            for (w in listOf(360, 390, 768, 1440)) for (p in palettes) for (night in listOf(false, true)) {
                compose.runOnIdle { width = w; palette = p; dark = night }
                val categories = compose.onNodeWithTag("personal-category-filters").assertIsDisplayed().getUnclippedBoundsInRoot()
                val search = compose.onNodeWithTag("personal-task-search-open").assertIsDisplayed().getUnclippedBoundsInRoot()
                assertTrue(categories.left.value < 20f); assertTrue(search.right.value > w - 20f)
                assertEquals(categories.width.value, search.width.value, 1f); assertEquals(categories.bottom.value, search.bottom.value, 1f)
                compose.onNodeWithTag("personal-mindmaps").assertIsDisplayed().assert(hasAnyAncestor(hasTestTag("app-header")))
                if (p == "blue") {
                    compose.onNodeWithTag("personal-category-filters").performClick()
                    compose.onNodeWithTag("personal-category-dock").assertIsDisplayed(); shot("categories-$w-$night")
                    compose.onNodeWithTag("personal-categories-close").performClick()
                }
            }
        } finally {
            compose.runOnIdle { mounted = false }; compose.waitForIdle()
            app.appScope.cancel(); app.database.close()
            check(privateContext.databaseName.startsWith("qa313-projects-$token-")); context.deleteDatabase(privateContext.databaseName)
        }
    }
}
