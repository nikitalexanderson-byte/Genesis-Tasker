package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.*
import ru.genesis.calendar.data.*
import ru.genesis.calendar.domain.*
import ru.genesis.calendar.domain.habits.*
import ru.genesis.calendar.domain.trackers.*
import java.io.File
import java.time.LocalDate
import java.util.concurrent.ConcurrentHashMap

/** Synthetic fixtures only; intended to run on the connected Realme at both themes/font scales. */
class Release313UiTest {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    private val app get() = compose.activity.application as GenesisApplication
    private val args get() = InstrumentationRegistry.getArguments()
    private val width get() = args.getString("genesisWidth")?.toIntOrNull() ?: 360
    private val dark get() = args.getString("genesisDark") == "true"
    private val font get() = args.getString("genesisFontScale")?.toFloatOrNull() ?: 1f
    private val brokenWords = linkedMapOf<String, Boolean>()
    @Composable private fun Frame(content: @Composable () -> Unit) {
        val density = compose.activity.resources.displayMetrics.widthPixels.toFloat() / width
        val config = android.content.res.Configuration(LocalConfiguration.current).apply {
            screenWidthDp = width
            screenHeightDp = (compose.activity.resources.displayMetrics.heightPixels / density).toInt()
            fontScale = font
        }
        CompositionLocalProvider(LocalGenesisLanguage provides (args.getString("genesisLanguage") ?: "ru"),
            LocalEveningTheme provides dark,
            LocalDensity provides Density(density, font), LocalConfiguration provides config,
            LocalGenesisTextLayoutAudit provides { text, layout -> brokenWords[text] = layout.splitsWord() }) {
            MaterialTheme(colorScheme = if (dark) evening else standart, typography = GenesisTypography, shapes = GenesisShapes) {
                Surface(Modifier.fillMaxSize()) { content() }
            }
        }
    }
    private fun capture(name: String) {
        compose.waitForIdle()
        captureNativeWindow(File(app.getExternalFilesDir(null), "313-$width-${if (dark) "dark" else "light"}-font$font-$name.png"))
    }
    private fun wordsStayWhole() {
        compose.waitForIdle()
        assertEquals("No alphabetic word may be split: ${brokenWords.filterValues { it }.keys}", emptyList<String>(), brokenWords.filterValues { it }.keys.toList())
    }
    private fun assertMonthStartsAtTop() {
        compose.waitForIdle()
        compose.onNodeWithTag("calendar-month-navigation").assertIsDisplayed()
        if (width < 840) assertEquals(0f, compose.onNodeWithTag("calendar-month-scroll").fetchSemanticsNode()
            .config[SemanticsProperties.VerticalScrollAxisRange].value(), 1f)
    }

    @Test fun narrowAlphabeticLabelsShrinkEnoughToKeepTheirWordsWhole() {
        compose.setContent { Frame {
            Column(Modifier.width(64.dp)) {
                for (label in listOf("Gewohnheitstracker", "Οκτωβρίου", "Завдання"))
                    UntranslatedText(label, style = MaterialTheme.typography.bodyLarge.copy(fontSize = 20.sp))
            }
        } }
        wordsStayWhole()
    }

    @Test fun fiveHundredLetterTaskTitlesStayCompleteAtBothFontScales() {
        val tokens = listOf("Ж".repeat(500), "W".repeat(500), "Ω".repeat(500))
        val ordinary = "Обычная задача"
        val paragraph = "Каждое слово остаётся целиком на своей строке"
        val forcedLines = "Первая строка\nВторая строка"
        val layouts = ConcurrentHashMap<String, TextLayoutResult>()
        var fontScale by mutableStateOf(1f)
        compose.setContent { Frame {
            val density = LocalDensity.current.density
            CompositionLocalProvider(LocalGenesisLanguage provides "ru",
                LocalDensity provides Density(density, fontScale),
                LocalGenesisTextLayoutAudit provides { text, layout ->
                    layouts[text] = layout
                    brokenWords[text] = layout.splitsWord()
                }) {
                Column(Modifier.width(120.dp)) {
                    tokens.take(2).forEachIndexed { index, token ->
                        TaskTitle(LocalTask(id = "long-token-$index", title = token, date = "2100-01-01"),
                            Modifier.width(64.dp).testTag("long-token-$index"),
                            style = MaterialTheme.typography.titleSmall,
                            maxLines = if (index == 0) Int.MAX_VALUE else 1)
                    }
                    UntranslatedText(AnnotatedString(tokens[2]), Modifier.width(64.dp).testTag("long-token-2"),
                        style = MaterialTheme.typography.bodyMedium, maxLines = 1)
                    UntranslatedText(ordinary, Modifier.width(120.dp), style = MaterialTheme.typography.titleSmall)
                    UntranslatedText(paragraph, Modifier.width(100.dp), style = MaterialTheme.typography.bodyMedium)
                    UntranslatedText(forcedLines, Modifier.width(120.dp).testTag("forced-lines-text"),
                        style = MaterialTheme.typography.bodyMedium, maxLines = 1)
                    UntranslatedText("Нулевая ширина", Modifier.size(0.dp).testTag("zero-size-text"),
                        style = MaterialTheme.typography.bodyMedium, maxLines = 1)
                }
            }
        } }
        for (scale in listOf(1f, 1.3f)) {
            compose.runOnIdle {
                if (fontScale != scale) { layouts.clear(); brokenWords.clear(); fontScale = scale }
            }
            compose.waitUntil(5_000) { tokens.all(layouts::containsKey) &&
                listOf(ordinary, paragraph, forcedLines).all(layouts::containsKey) }
            tokens.forEachIndexed { index, token ->
                compose.onNodeWithTag("long-token-$index").assertTextEquals(token)
                val layout = layouts.getValue(token)
                assertEquals("$scale/$index keeps the full title", token, layout.layoutInput.text.text)
                assertEquals("$scale/$index keeps the token on one line", 1, layout.lineCount)
                assertEquals("$scale/$index renders all 500 letters", token.length, layout.getLineEnd(0, visibleEnd = true))
                assertFalse("$scale/$index has no clipped content", layout.didOverflowWidth || layout.didOverflowHeight)
                assertFalse("$scale/$index has no ellipsis", layout.isLineEllipsized(0))
                assertFalse("$scale/$index has no split word", layout.splitsWord())
                assertTrue("$scale/$index uses the emergency fit", layout.layoutInput.style.fontSize.value < 8f)
            }
            assertEquals("$scale preserves the ordinary label size", 14f,
                layouts.getValue(ordinary).layoutInput.style.fontSize.value, .001f)
            val wrapped = layouts.getValue(paragraph)
            assertEquals("$scale preserves the ordinary paragraph size", 14f, wrapped.layoutInput.style.fontSize.value, .001f)
            assertTrue("$scale allows ordinary wrapping between words", wrapped.lineCount > 1)
            compose.onNodeWithTag("forced-lines-text").assertTextEquals(forcedLines)
            assertEquals("$scale does not shrink an impossible explicit newline toward zero", 8f,
                layouts.getValue(forcedLines).layoutInput.style.fontSize.value, .001f)
            compose.onNodeWithTag("zero-size-text").assertWidthIsEqualTo(0.dp).assertHeightIsEqualTo(0.dp)
            wordsStayWhole()
        }
    }

    @Test fun everyOracleLocaleRendersItsOwnCompleteReferenceAndModal() {
        val languages = listOf("ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja")
        val olympians = org.json.JSONObject(app.assets.open("originals/catalogs/olympian-isopsephy.json")
            .bufferedReader().use { it.readText() })
        val guide = org.json.JSONObject(app.assets.open("originals/catalogs/future-modeling.json")
            .bufferedReader().use { it.readText() })
        var language by mutableStateOf("ru")
        compose.setContent { Frame { CompositionLocalProvider(LocalGenesisLanguage provides language) {
            Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp)) {
                key(language) { OlympianIsopsephy {}; FutureModelingGuide() }
            }
        } } }
        for (choice in languages) {
            compose.runOnIdle { language = choice; brokenWords.clear() }
            val copy = olympians.getJSONObject("locales").getJSONObject(choice)
            compose.onNodeWithTag("olympian-isopsephy-toggle").performScrollTo()
            // SacredYearDetailsButton applies the same invariant uppercase to this locale's title.
            compose.onNodeWithText(copy.getString("title").uppercase()).assertExists()
            compose.onNodeWithTag("olympian-isopsephy-toggle").performClick()
            compose.onNodeWithTag("olympian-athena").performScrollTo().performClick()
            val athena = olympians.getJSONArray("deities").let { rows ->
                (0 until rows.length()).map { rows.getJSONObject(it) }.first { it.getString("id") == "athena" }
            }
            compose.onNodeWithText(athena.getJSONObject("detail").getString(choice)).assertExists()
            compose.onNodeWithText(copy.getString("root")).assertExists()
            capture("locale-$choice-athena")
            compose.onNodeWithTag("olympian-dialog-close").performClick()
            compose.onNodeWithTag("olympian-isopsephy-toggle").performScrollTo().performClick()
            val guideCopy = if (choice in setOf("ru", "en")) guide.getJSONObject("locales").getJSONObject(choice)
                else org.json.JSONObject(app.assets.open("originals/catalogs/future-modeling-locales/$choice.json")
                    .bufferedReader().use { it.readText() })
            compose.onNodeWithTag("future-modeling-open").performScrollTo().performClick()
            compose.onNode(hasText(guideCopy.getString("title")) and
                hasAnyAncestor(hasTestTag("future-modeling-dialog"))).assertExists()
            compose.onNodeWithText(guideCopy.getString("intro")).assertExists()
            val guideSections = guideCopy.getJSONArray("sections")
            for (index in 0 until guideSections.length()) {
                compose.onNode(hasText(guideSections.getJSONObject(index).getString("title")) and
                    hasAnyAncestor(hasTestTag("future-modeling-step-${index + 1}")))
                    .performScrollTo().assertIsDisplayed()
                if (choice in listOf("ru", "en")) capture("locale-$choice-guide-step-${index + 1}")
            }
            compose.onNodeWithTag("future-goal-dionysus").performScrollTo().assertIsDisplayed()
            capture("locale-$choice-guide")
            compose.onNodeWithTag("future-modeling-close").performClick()
            wordsStayWhole()
        }
    }

    @Test fun olympianSymbolsOpenAllThirteenDescriptionsAndTheGuideHasEverySectorAndGoal() {
        var links = 0
        compose.setContent { Frame { Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp)) {
            OlympianIsopsephy { links++ }
            FutureModelingGuide()
        } } }
        compose.onNodeWithTag("olympian-zeus").assertDoesNotExist()
        compose.onNodeWithTag("olympian-isopsephy-toggle").performClick()
        for (id in listOf("zeus", "hera", "poseidon", "demeter", "athena", "apollo", "artemis", "ares",
            "aphrodite", "hephaestus", "hermes", "hestia", "dionysus")) {
            compose.onNodeWithTag("olympian-$id").performScrollTo().performClick()
            compose.onNodeWithTag("olympian-dialog").assertIsDisplayed()
            compose.onNodeWithTag("olympian-digital-root").assertExists()
            if (id == "athena") capture("olympian-athena")
            compose.onNodeWithTag("olympian-dialog-close").performClick()
        }
        compose.onNodeWithTag("olympian-stoicheion-link").performScrollTo().performClick()
        assertEquals(1, links)
        compose.waitUntil(5_000) { compose.onAllNodesWithTag("olympian-zeus").fetchSemanticsNodes().isEmpty() }
        compose.onNodeWithTag("olympian-zeus").assertDoesNotExist()
        compose.onNodeWithTag("olympian-isopsephy-toggle").performScrollTo().performClick()
        compose.onNodeWithTag("olympian-zeus").assertExists()
        compose.onNodeWithTag("olympian-catalog-close").performScrollTo().assertIsDisplayed().performClick()
        compose.waitUntil(5_000) { compose.onAllNodesWithTag("olympian-zeus").fetchSemanticsNodes().isEmpty() }
        compose.onNodeWithTag("olympian-zeus").assertDoesNotExist()
        compose.onNodeWithTag("future-modeling-open").performScrollTo().performClick()
        compose.onNodeWithTag("future-modeling-dialog").assertIsDisplayed()
        val sectors = org.json.JSONObject(app.assets.open("originals/catalogs/future-modeling.json").bufferedReader().use { it.readText() }).getJSONArray("sectors")
        val symbolIds = linkedSetOf<String>()
        for (index in 0 until sectors.length()) {
            val ids = sectors.getJSONObject(index).getJSONArray("deities")
            for (deity in 0 until ids.length()) symbolIds += ids.getString(deity)
        }
        symbolIds.forEach { id ->
            assertTrue("Future sector has its deity symbol: $id", compose.onAllNodes(hasTestTag("olympian-symbol-$id") and
                hasAnyAncestor(hasTestTag("future-modeling-dialog")), useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty())
        }
        compose.onNodeWithTag("future-sector-northwest").performScrollTo()
        capture("future-modeling-sectors")
        for (id in listOf("northwest", "north", "northeast", "west", "center", "east", "southwest", "south", "southeast"))
            compose.onNodeWithTag("future-sector-$id").performScrollTo().assertIsDisplayed()
        for (id in listOf("zeus", "hera", "poseidon", "demeter", "athena", "apollo", "artemis", "ares",
            "aphrodite", "hephaestus", "hermes", "hestia", "dionysus"))
            compose.onNodeWithTag("future-goal-$id").performScrollTo().assertIsDisplayed()
        capture("future-modeling-goals")
        compose.onNodeWithTag("future-modeling-close").performClick()
        compose.onNodeWithTag("future-modeling-dialog").assertDoesNotExist()
        wordsStayWhole()
    }

    @Test fun timelineRevealsThreeDistinctCardsInTemporalOrderAndOpensTheirOrientation() {
        val raw = org.json.JSONArray(app.assets.open("stoicheion.json").bufferedReader().use { it.readText() })
        val letters = (0 until raw.length()).map { index -> raw.getJSONObject(index).let {
            StoicheionLetter(it.getString("id"), it.getInt("order"), it.getString("name"), it.getString("symbol"),
                it.getString("lowercase"), it.getInt("value"), it.getInt("pythmen"), it.getString("tagline"),
                it.getString("content"), "", "", "", androidx.compose.ui.graphics.Color.White)
        } }
        var draw by mutableStateOf<StoicheionDraw?>(null)
        var selected: StoicheionSelection? = null
        compose.setContent { Frame { Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp)) {
            StoicheionTimelinePanel(letters, draw, true, 1_000L, false,
                { draw = StoicheionDraw("timeline", "2026-10-30", 0x12345678L, 1, 1_000L, 181_000L) }, { selected = it })
        } } }
        val begin = compose.onNodeWithTag("stoicheion-draw-timeline").performScrollTo().fetchSemanticsNode().boundsInRoot
        val help = compose.onNodeWithTag("stoicheion-timeline-help").fetchSemanticsNode().boundsInRoot
        assertTrue("Instructions follow the primary action", begin.bottom <= help.top)
        compose.onNodeWithTag("stoicheion-timeline-help").performScrollTo().performClick()
        compose.onNodeWithTag("stoicheion-timeline-help-dialog").assertIsDisplayed()
        assertNull("Reading the instructions must not draw cards", draw)
        capture("timeline-help-modal")
        compose.onNodeWithTag("stoicheion-timeline-help-close").performClick()
        compose.onNodeWithTag("stoicheion-timeline-help-dialog").assertDoesNotExist()
        compose.onNodeWithTag("stoicheion-draw-timeline").performScrollTo().performClick()
        val positions = listOf("past", "present", "future").map { id ->
            compose.onNodeWithTag("stoicheion-timeline-$id").performScrollTo().fetchSemanticsNode().boundsInRoot
        }
        assertTrue(positions.zipWithNext().all { (left, right) -> left.right <= right.left })
        assertEquals(3, StoicheionReading.spread(letters, 0x12345678L, 3).map { it.first.id }.distinct().size)
        compose.onNodeWithTag("stoicheion-timeline-present").performClick()
        assertEquals("present", selected!!.timePosition!!.id)
        assertEquals(StoicheionReading.spread(letters, 0x12345678L, 3)[1].second, selected!!.reversed)
        capture("timeline-three-cards")
        wordsStayWhole()
    }

    @Test fun completeMonthDescriptionsHaveNoInnerScrollAndTodayAlignsWithTheName() {
        var mode by mutableStateOf(CalendarMode.PROFANE)
        var date by mutableStateOf(LocalDate.now().plusDays(1))
        compose.setContent { Frame { CalendarScreen(date, mode, { date = it }, experimental = true) } }
        for (choice in CalendarMode.entries) {
            compose.runOnIdle { mode = choice }
            compose.onNodeWithTag("month-description-layout").performScrollTo()
            compose.onAllNodes(hasAnyAncestor(hasTestTag("month-description-layout")) and hasScrollAction(),
                useUnmergedTree = true).assertCountEquals(0)
            val name = compose.onNodeWithTag("month-description-name").fetchSemanticsNode().boundsInRoot
            val today = compose.onNodeWithTag("calendar-month-today").fetchSemanticsNode().boundsInRoot
            assertEquals(name.center.y, today.center.y, 1f)
            compose.onNodeWithTag("calendar-month-today").assertHeightIsAtLeast(48.dp)
            capture("complete-month-description-${choice.wireValue}")
        }
        wordsStayWhole()
    }

    @Test fun everyYearDescriptionStartsCollapsedAndCanBeExpanded() {
        var mode by mutableStateOf(CalendarMode.PROFANE)
        val navigation = MenuSwipeState().apply { calendar = "year" }
        compose.setContent { Frame { CalendarScreen(LocalDate.of(2026, 10, 30), mode, {},
            experimental = true, menuSwipeState = navigation) } }
        for (choice in CalendarMode.entries) {
            compose.runOnIdle { mode = choice }
            val toggle = "calendar-year-description-toggle-${choice.wireValue}"
            val body = "calendar-year-description-body-${choice.wireValue}"
            compose.onNodeWithTag("calendar-year").performScrollToNode(hasTestTag(toggle))
            compose.onNodeWithTag(body).assertDoesNotExist()
            if (choice == CalendarMode.SACRED) compose.onNodeWithText("Солнечный календарь").assertExists()
            capture("year-description-collapsed-${choice.wireValue}")
            compose.onNodeWithTag(toggle).performClick()
            compose.onNodeWithTag(body).assertExists()
            compose.onNodeWithTag(toggle).performClick()
            compose.onNodeWithTag(body).assertDoesNotExist()
        }
        wordsStayWhole()
    }

    @Test fun periodNavigationAndMenuStartAtMonthWhileSolarDatesRevealTheSelectedDay() {
        var mode by mutableStateOf(CalendarMode.PROFANE)
        var date by mutableStateOf(LocalDate.of(2026, 10, 30))
        var entry by mutableIntStateOf(1)
        val navigation = MenuSwipeState()
        val calendar = GenesisCalendar()
        compose.setContent { Frame { CalendarScreen(date, mode, { date = it }, experimental = true,
            menuSwipeState = navigation, entryRequest = entry) } }
        for (choice in CalendarMode.entries) {
            compose.runOnIdle { mode = choice; date = LocalDate.of(2026, 10, 30); entry++; navigation.calendar = "month" }
            assertMonthStartsAtTop()
            compose.onNodeWithTag("calendar-day-$date").performScrollTo().performClick()
            compose.waitForIdle()
            compose.onNodeWithTag("calendar-selected-day").assertIsDisplayed()
            val hero = compose.onNodeWithTag("calendar-day-hero").fetchSemanticsNode().boundsInRoot
            val title = compose.onNodeWithTag("calendar-selected-primary-date").fetchSemanticsNode().boundsInRoot
            assertTrue("Day text starts on top of the artwork", title.top - hero.top < 140 *
                compose.onNodeWithTag("calendar-day-hero").fetchSemanticsNode().layoutInfo.density.density)
            compose.onNodeWithTag("calendar-month-navigation").performScrollTo().performTouchInput { swipeLeft() }
            assertMonthStartsAtTop()
            capture("month-after-swipe-${choice.wireValue}")
            compose.runOnIdle { navigation.calendar = "year" }
            compose.onNodeWithTag("calendar-year").performScrollToNode(hasTestTag("calendar-year-solar-toggle"))
            compose.onNodeWithTag("calendar-year-solar-toggle").performClick()
            val year = when (choice) {
                CalendarMode.PROFANE -> date.year
                CalendarMode.SACRED -> calendar.sacredDate(date).sacredYear
                CalendarMode.LUNAR -> calendar.lunarDate(date).year.sacredYear
            }
            val event = calendar.solarEvents(year).first()
            compose.onNodeWithTag("calendar-year").performScrollToNode(hasTestTag("solar-point-${event.date}"))
            compose.onNodeWithTag("solar-point-${event.date}").performClick()
            compose.waitForIdle()
            assertEquals(event.date, date)
            compose.onNodeWithTag("calendar-selected-day").assertIsDisplayed()
            if (width < 840) {
                val day = compose.onNodeWithTag("calendar-selected-day").fetchSemanticsNode().boundsInRoot
                val viewport = compose.onNodeWithTag("calendar-month-scroll").fetchSemanticsNode().boundsInRoot
                assertEquals(viewport.top, day.top, 4f)
            }
            capture("solar-day-${choice.wireValue}")
            compose.runOnIdle { entry++ }
            assertMonthStartsAtTop()
        }
        wordsStayWhole()
    }

    @Test fun todayShowsOnlyConfiguredActiveTrackersAndUsesWholeSummaryActions() {
        val date = LocalDate.now()
        var data by mutableStateOf(LocalTrackersWorkspace())
        var moodClicks = 0
        val schedule = dailySleepSchedule(date, CalendarMode.PROFANE)
        val sleep = SleepPlan(TrackerEntity.create("sleep-plan", id = "sleep313"), schedule, "Восстановление")
        val tracker = AddictionTracker(TrackerEntity.create("addiction", id = "abstinence313"), schedule, "Моя практика")
        compose.setContent { Frame { Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp)) {
            TodayTrackerCards(data, date, true, { moodClicks++ }, { _, _ -> }, { _, _ -> }, { _, _, _, _, _ -> })
        } } }
        compose.onNodeWithTag("today-sleep-sleep313").assertDoesNotExist()
        compose.onNodeWithText("Сон").assertDoesNotExist()
        compose.onNodeWithText("Воздержание").assertDoesNotExist()
        compose.onNodeWithTag("today-abstinence-add").assertDoesNotExist()
        compose.onNodeWithTag("today-sleep-plans").assertDoesNotExist()
        compose.onNodeWithTag("today-mood-edit").assertHeightIsAtLeast(48.dp).performClick()
        assertEquals(1, moodClicks)
        compose.runOnIdle { data = data.copy(sleepPlans = listOf(sleep, sleep.copy(entity = sleep.entity.copy(id = "paused"), active = false)),
            addictionTrackers = listOf(tracker, tracker.copy(entity = tracker.entity.copy(id = "paused"), status = "paused"))) }
        compose.onNodeWithTag("today-sleep-edit-sleep313").assertExists()
        compose.onNodeWithTag("today-abstinence-edit-abstinence313").assertExists()
        compose.onNodeWithTag("today-sleep-paused").assertDoesNotExist()
        compose.onNodeWithTag("today-abstinence-paused").assertDoesNotExist()
        capture("today-observations")
        wordsStayWhole()
    }

    @Test fun compactCalendarHeroesFillTheirArtworkAndTodayAppearsOnlyWhenReturningIsUseful() {
        val today = LocalDate.now()
        val calendar = GenesisCalendar()
        var mode by mutableStateOf(CalendarMode.PROFANE)
        var date by mutableStateOf(today)
        compose.setContent { Frame { CalendarScreen(date, mode, { date = it }, experimental = true) } }
        for (choice in CalendarMode.entries) {
            compose.runOnIdle { mode = choice; date = today }
            compose.onNodeWithTag("calendar-month-today").assertDoesNotExist()
            val current = calendar.monthRange(today, choice)
            compose.runOnIdle { date = if (today < current.end) today.plusDays(1) else today.minusDays(1) }
            compose.onNodeWithTag("calendar-month-today").performScrollTo().assertHeightIsAtLeast(48.dp).performClick()
            compose.waitUntil(5_000) { date == today }
            compose.onNodeWithTag("calendar-month-today").assertDoesNotExist()
            compose.onNodeWithTag("calendar-month-next").performScrollTo().performClick()
            compose.waitUntil(10_000) { date != today }
            compose.onNodeWithTag("calendar-month-today").performScrollTo().assertIsDisplayed().performClick()
            compose.waitUntil(5_000) { date == today }
            compose.onNodeWithTag("calendar-month-today").assertDoesNotExist()
            val month = compose.onNodeWithTag("month-description-layout").performScrollTo()
            month.assertHeightIsAtLeast(256.dp)
            val monthBounds = month.fetchSemanticsNode().boundsInRoot
            val artTag = when (choice) { CalendarMode.PROFANE -> "gregorian-month-art"; CalendarMode.SACRED -> "sacred-month-art"; CalendarMode.LUNAR -> "lunar-month-art" }
            val artwork = compose.onNodeWithTag(artTag, useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
            assertEquals(monthBounds.width, artwork.width, 1f)
            assertEquals(monthBounds.height, artwork.height, 1f)
            capture("compact-month-${choice.wireValue}")
            val day = compose.onNodeWithTag("calendar-day-hero").performScrollTo()
            day.assertHeightIsEqualTo(if (choice == CalendarMode.PROFANE) 180.dp else 240.dp)
            val dayBounds = day.fetchSemanticsNode().boundsInRoot
            val dayArt = compose.onNodeWithTag("calendar-weekday-art", useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
            assertEquals(dayBounds.width, dayArt.width, 1f)
            assertEquals(dayBounds.height, dayArt.height, 1f)
            capture("compact-day-${choice.wireValue}")
        }
        assertEquals("System date is unchanged during this bounded journey", today, LocalDate.now())
        wordsStayWhole()
    }

    @Test fun todayHabitListKeepsFiveVisibleAndRevealsTheRemainingHabitsWithoutChangingMarks() {
        val date = LocalDate.now()
        val habits = (1..7).map { index -> Habit(TrackerEntity.create("habit", id = "fold313-$index"),
            "Практика $index", date, dailySleepSchedule(date, CalendarMode.PROFANE)) }
        val workspace = LocalHabitWorkspace(habits = habits)
        compose.setContent { Frame { Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp)) {
            TodayHabitsContent(app, date, workspace, {})
        } } }
        for (index in 1..5) compose.onNodeWithTag("today-habit-fold313-$index").assertExists()
        for (index in 6..7) compose.onNodeWithTag("today-habit-fold313-$index").assertDoesNotExist()
        compose.onNodeWithTag("today-habits-more").performScrollTo().assertHeightIsAtLeast(48.dp).performClick()
        for (index in 6..7) compose.onNodeWithTag("today-habit-fold313-$index").assertExists()
        compose.onNodeWithTag("today-habits-more").performScrollTo().performClick()
        compose.onNodeWithTag("today-habit-fold313-6").assertDoesNotExist()
        compose.onNodeWithTag("today-habit-fold313-7").assertDoesNotExist()
        for (index in 1..5) compose.onNodeWithTag("today-habit-check-fold313-$index").assertIsOff()
        capture("today-five-habits")
        wordsStayWhole()
    }

    @Test fun symbolicMoodScaleKeepsSelectionAndDoesNotSplitItsLabels() {
        var saved: Int? = null
        compose.setContent { Frame { MoodObservationEditor(emptyList(), LocalDate.now(), CalendarMode.PROFANE,
            "ru", emptyList(), false, null, {}, fixedDate = true) { _, value, _, _, _ -> saved = value } } }
        compose.onNodeWithTag("mood-value-2").performScrollTo().performClick()
        capture("mood-scale")
        compose.onNodeWithTag("mood-entry-save").performScrollTo().performClick()
        assertEquals(2, saved)
        wordsStayWhole()
    }

    @Test fun timerHasAnOutlinedSubBlockAlignedCollapseAndNoBrokenStopwatchLabel() {
        val date = LocalDate.now()
        val habit = Habit(TrackerEntity.create("habit", id = "timer313"), "Пить 250 мл воды каждые 1.5 часа", date,
            dailySleepSchedule(date, CalendarMode.PROFANE))
        var workspace by mutableStateOf(LocalHabitWorkspace(habits = listOf(habit)))
        var collapsed = false
        compose.setContent { Frame { Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp)) {
            HabitTimerShelf(workspace, "fixture-device", habit.id, { collapsed = true }, embedded = true) { }
        } } }
        val heading = compose.onNodeWithText("Таймер").fetchSemanticsNode().boundsInRoot
        val collapse = compose.onNodeWithTag("habit-timer-collapse").fetchSemanticsNode().boundsInRoot
        assertEquals(heading.center.y, collapse.center.y, 1f)
        compose.onNodeWithTag("habit-timer-mode-stopwatch").assertHeightIsAtLeast(48.dp)
        compose.onNodeWithTag("habit-timer-mode-pomodoro").performClick()
        capture("habit-timer")
        wordsStayWhole()
        compose.onNodeWithTag("habit-timer-collapse").performClick()
        assertTrue(collapsed)
        compose.runOnIdle { workspace = workspace.copy(habits = listOf(habit.copy(timerEnabled = false))) }
        compose.onNodeWithTag("habit-timer-panel").assertDoesNotExist()
    }

    @Test fun ganttKeepsFourScalesInOneRowAndFitsHelpLabel() {
        compose.setContent { Frame { Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp)) {
            SharedGanttView(emptyList(), emptyList(), CalendarMode.PROFANE, CalendarMode.PROFANE, true, true, false,
                onOpen = {}, onSchedule = { _, _ -> org.json.JSONObject() })
        } } }
        val buttons = listOf("hours", "days", "weeks", "months").map {
            compose.onNodeWithTag("gantt-scale-$it").assertHeightIsAtLeast(48.dp).fetchSemanticsNode().boundsInRoot
        }
        buttons.forEach { assertEquals(buttons.first().center.y, it.center.y, 1f) }
        compose.onNodeWithTag("gantt-help").performClick()
        capture("gantt-help")
        wordsStayWhole()
    }

    @Test fun drawerPlacesWholeStatusLinesAndBackgroundNoticeBeforeThreePlainActions() {
        var loading by mutableStateOf(true)
        var issue by mutableStateOf(true)
        var retries = 0
        var toggles = 0
        compose.setContent { Frame { MobileWorkspaceShell("Сегодня", null, emptyList(), "", true,
            onNavigate = {}, actions = {}, footerStatusLines = listOf("Аккаунт Genesis · Синхронизированно", "Защищенная локальная копия"),
            footerDetails = { if (issue) ru.genesis.calendar.auth.WorkspaceSyncNotice(
                ru.genesis.calendar.auth.AuthPanelState(outgoingSyncIssue =
                    "Изменения проектов или привычек пока не подтверждены сервером и сохранены на устройстве."),
                { retries++ }, { _, _ -> }, { _, _ -> }) },
            footerActions = {
                TodayThemeButton(dark, true, plainIcon = true) { toggles++ }
                AffairsIconButton("Скачать обновление", AffairsAction.IMPORT, {}, Modifier.testTag("drawer-update-fixture"), outlined = false)
                WorkspaceAccountRefreshButton("Обновить аккаунт", true) { }
            }) {
            WorkspaceBackgroundStatus(loading, "Загрузка…")
            Text("Содержимое страницы", Modifier.testTag("main-content-fixture"))
        } } }
        compose.onNodeWithTag("today-theme-toggle").assertDoesNotExist()
        compose.onNodeWithTag("calendar-theme-toggle").assertDoesNotExist()
        compose.onNodeWithTag("workspace-menu").performClick()
        compose.onNodeWithTag("drawer-account-row").performScrollTo()
        compose.onNodeWithTag("drawer-background-status").performScrollTo().assertIsDisplayed()
        val statuses = (0..1).map { compose.onNodeWithTag("drawer-account-status-$it").fetchSemanticsNode().boundsInRoot }
        val actions = compose.onNodeWithTag("drawer-actions").performScrollTo().fetchSemanticsNode().boundsInRoot
        assertTrue(statuses[0].bottom <= statuses[1].top)
        assertTrue(compose.onNodeWithTag("drawer-background-status").fetchSemanticsNode().boundsInRoot.bottom <= actions.top)
        val theme = compose.onNodeWithTag("drawer-theme-toggle").fetchSemanticsNode().boundsInRoot
        val update = compose.onNodeWithTag("drawer-update-fixture").fetchSemanticsNode().boundsInRoot
        val refresh = compose.onNodeWithTag("account-refresh").fetchSemanticsNode().boundsInRoot
        assertTrue(theme.right <= update.left && update.right <= refresh.left)
        compose.onNodeWithTag("drawer-workspace-sync-notice").performScrollTo()
        compose.onNodeWithContentDescription("Повторить").performClick()
        assertEquals(1, retries)
        compose.onNodeWithTag("drawer-actions").performScrollTo()
        compose.onNodeWithTag("drawer-theme-toggle").performClick()
        assertEquals(1, toggles)
        capture("drawer")
        wordsStayWhole()
        compose.runOnIdle { loading = false; issue = false }
        compose.onNodeWithTag("drawer-background-status").assertDoesNotExist()
        compose.onNodeWithTag("drawer-workspace-sync-notice").assertDoesNotExist()
    }

    @Test fun abstinenceIsCreatedAndRecordedInHabitsUsingTheSameTodayRepository() {
        check(BuildConfig.DEBUG && app.workspaceScope == "internal-validation-v1")
        val repo = TrackersRepository(app)
        runBlocking { repo.resetTracking() }
        compose.setContent { Frame { AbstinenceScreen(app) { } } }
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("abstinence-add").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("abstinence-add").performScrollTo().performClick()
        compose.onNodeWithTag("abstinence-name").performTextInput("Личная практика 313")
        compose.onNodeWithTag("abstinence-tracker-save").assertIsDisplayed().performClick()
        compose.waitUntil(10_000) { runBlocking { repo.workspace.first().addictionTrackers.isNotEmpty() } }
        val tracker = runBlocking { repo.workspace.first().addictionTrackers.single() }
        compose.onNodeWithTag("abstinence-record-${tracker.id}").performScrollTo().performClick()
        compose.onNodeWithTag("abstinence-clean").performClick()
        compose.onNodeWithTag("abstinence-save").performScrollTo().performClick()
        compose.waitUntil(10_000) { runBlocking { repo.workspace.first().addictionEntries.isNotEmpty() } }
        assertTrue(runBlocking { repo.workspace.first().addictionEntries.single().cleanDay })
        capture("abstinence-in-habits")
        wordsStayWhole()
    }
}
