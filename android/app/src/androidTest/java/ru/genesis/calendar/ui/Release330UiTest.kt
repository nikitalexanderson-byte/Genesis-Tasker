package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.captureNativeWindow
import ru.genesis.calendar.data.HabitDocument
import ru.genesis.calendar.data.LocalHabitWorkspace
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.GenesisCalendar
import ru.genesis.calendar.domain.habits.Habit
import java.io.File
import java.time.LocalDate
import java.time.ZoneId
import java.util.Locale
import java.util.UUID

/** Synthetic local data in a separate package; never touches the signed user's workspace. */
class Release330UiTest {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    @Before fun isolated() { check(BuildConfig.DEBUG && context.packageName.endsWith(".qa330.debug")) }
    @Composable private fun Frame(width: Int = 390, palette: String = "blue", night: Boolean = false,
        language: String = "ru", sacred: Boolean = true, content: @Composable () -> Unit) {
        CompositionLocalProvider(LocalDensity provides Density(compose.activity.resources.displayMetrics.widthPixels.toFloat()/width, 1.3f),
            LocalGenesisLanguage provides language, LocalEveningTheme provides night, LocalDarkPalette provides palette,
            LocalSacredFeaturesEnabled provides sacred) {
            MaterialTheme(colorScheme = if (night) eveningPalette(palette) else daylightPalette(palette),
                typography = GenesisTypography, shapes = GenesisShapes) {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    Box(Modifier.safeDrawingPadding()) { content() }
                }
            }
        }
    }
    private fun shot(name: String) {
        compose.waitForIdle()
        captureNativeWindow(File(context.getExternalFilesDir(null), "release330-$name.png"))
    }
    @Test fun monthReturnStaysAtTopRightAcrossCalendarsPalettesAndSizes() {
        var width by mutableIntStateOf(360); var palette by mutableStateOf("blue")
        var night by mutableStateOf(false); var mode by mutableStateOf(CalendarMode.PROFANE)
        var sacred by mutableStateOf(true); var epoch by mutableIntStateOf(0)
        compose.setContent { key(epoch) { Frame(width, palette, night, sacred = sacred) {
            Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(4.dp)) {
                CalendarMonthHero(GenesisCalendar(), LocalDate.of(2027,2,28), mode, ZoneId.of("Europe/Moscow"), true, {}, {}, {})
                CalendarCivilDate(LocalDate.of(2027,2,28), Locale.forLanguageTag("ru"))
            }
        } } }
        for (w in listOf(360,390,768,1440)) for (p in listOf("green","blue","burgundy","violet")) for (dark in listOf(false,true)) {
            for (m in CalendarMode.entries) {
                compose.runOnIdle { width=w; palette=p; night=dark; mode=m; sacred=true; epoch++ }
                val today = compose.onNodeWithTag("calendar-month-today").assertIsDisplayed().getUnclippedBoundsInRoot()
                val next = compose.onNodeWithTag("calendar-month-next").assertIsDisplayed().getUnclippedBoundsInRoot()
                assertTrue("$w/$p/$dark/$m return above next", today.bottom <= next.top)
                assertEquals(today.right.value, next.right.value, 1f)
                if (m == CalendarMode.PROFANE) compose.onNodeWithTag("calendar-month-period").assertTextContains("\n2027", substring=true)
                if (p=="blue" && m==CalendarMode.LUNAR) shot("month-$w-$p-$dark")
            }
            if (p=="blue") {
                compose.runOnIdle { mode=CalendarMode.PROFANE; sacred=false; epoch++ }
                compose.onNodeWithTag("calendar-month-period").assertTextContains("\n2027", substring=true)
                shot("civil-month-$w-$dark")
            }
        }
    }
    @Test fun moonNameFitsInsideDiscAndTodayHasHalfTheGutter() {
        var night by mutableStateOf(false); var width by mutableIntStateOf(390)
        compose.setContent { Frame(width, night=night) {
            SortableTodayWorkspace("", emptyList(), {}, header = { DayHeader(LocalDate.of(2026,11,11), CalendarMode.LUNAR) })
        } }
        for(w in listOf(360,390,768,1440)) for(dark in listOf(false,true)) {
            compose.runOnIdle { width=w; night=dark }
            val hero=compose.onNodeWithTag("today-hero").getUnclippedBoundsInRoot()
            assertEquals(8f, hero.left.value, 1f)
            val disc=compose.onNodeWithTag("today-lunar-disc").getUnclippedBoundsInRoot()
            val label=compose.onNodeWithTag("today-lunar-epithet").getUnclippedBoundsInRoot()
            assertTrue(label.left>=disc.left && label.right<=disc.right && label.top>=disc.top && label.bottom<=disc.bottom)
            shot("today-lunar-$w-$dark")
        }
    }
    @Test fun searchableZonePickerAcceptsLocalizedCitiesIanaAndUtc() {
        var selected by mutableStateOf("Europe/Moscow")
        compose.setContent { Frame { TimeZonePicker(selected, true) { selected=it } } }
        compose.onNodeWithTag("abstinence-time-zone").performClick()
        compose.onNodeWithTag("time-zone-search").performTextInput("Токио")
        compose.onNodeWithTag("time-zone-Asia/Tokyo").assertIsDisplayed().performClick()
        assertEquals("Asia/Tokyo",selected)
        compose.onNodeWithTag("abstinence-time-zone").performClick()
        compose.onNodeWithTag("time-zone-search").performTextInput("UTC+03:00 Moscow")
        compose.onNodeWithTag("time-zone-Europe/Moscow").assertIsDisplayed()
        shot("zone-search")
    }
    @Test fun disablingTimerSurvivesSaveAndLocalSerialization() {
        var saved: Habit? = null
        compose.setContent { Frame { HabitEditor(null,false,null,CalendarMode.PROFANE,null,
            initialTitle="Synthetic opt-in habit",onDismiss={},onSave={saved=it},onChooseRule={_,_,_->}) } }
        compose.onNodeWithTag("habit-timer-enabled").performScrollTo().assertIsOff().performClick().assertIsOn().performClick().assertIsOff()
        compose.onNodeWithTag("habit-auto-delete-enabled").performScrollTo().assertIsDisplayed()
        shot("habit-editor")
        compose.onNodeWithText("Сохранить",useUnmergedTree=true).performScrollTo().performClick()
        compose.runOnIdle {
            assertNotNull(saved); assertFalse(saved!!.timerEnabled)
            val decoded=HabitDocument.decode(HabitDocument.encode(LocalHabitWorkspace(habits=listOf(saved!!))),0)
            assertFalse(decoded.habits.single().timerEnabled)
        }
    }
    @Test fun dailyCacheSurvivesRecreationDeduplicatesRequestsAndRollsOverNextDay() = runBlocking {
        val user="qa330-${UUID.randomUUID()}"; var loads=0; var seen=0
        fun response(day:String)=JSONObject().put("dayKey",day).put("state","ready")
            .put("advice",JSONObject().put("id","advice-"+"a".repeat(24)).put("dayKey",day)
                .put("title","Synthetic advice").put("body","Daily cached advice").put("language","en")
                .put("dismissed",false).put("categories",JSONArray().put("aretology")).put("sources",JSONArray()))
        val first=DailyAdviceCache(context,user,"en","qa330")
        coroutineScope { (1..8).map { async { first.today("2026-11-12") { loads++; delay(10); response("2026-11-12") } } }.awaitAll() }
        val recreated=DailyAdviceCache(context,user,"en","qa330")
        recreated.today("2026-11-12") { error("must use the persisted day") }
        assertEquals(1,loads)
        repeat(3) { recreated.recordOnce("2026-11-12","advice-"+"a".repeat(24)) { seen++ } }
        assertEquals(1,seen)
        recreated.dismiss("2026-11-12","advice-"+"a".repeat(24))
        assertTrue(recreated.today("2026-11-12") { error("must remain cached") }.getJSONObject("advice").getBoolean("dismissed"))
        recreated.today("2026-11-13") { loads++; response("2026-11-13") }
        assertEquals(2,loads)
        DailyAdviceCache(context,user+"-other","en","qa330").today("2026-11-13") { loads++; response("2026-11-13") }
        assertEquals(3,loads)
    }
    @Test fun oracleTextAndReversedSurfaceRemainReadableInEveryLightPalette() {
        val letter=StoicheionLetter("theta",8,"Тэта","Θ","θ",9,9,"","","Бёдра","Μηροί","ΩΘΟΥΘΩΘΩ",Color(0xff6a839f))
        var palette by mutableStateOf("blue")
        compose.setContent { Frame(palette=palette) {
            Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(8.dp)) {
                Card(colors=androidx.compose.material3.CardDefaults.cardColors(containerColor=stoicheionCardSurface(true))) {
                    StoicheionCardFace(letter,Modifier.width(220.dp))
                    Text("Перевёрнутое положение")
                }
            }
        } }
        for(p in listOf("green","blue","burgundy","violet")) {
            compose.runOnIdle { palette=p }
            val title=compose.onNodeWithText("08  ТЭТА",useUnmergedTree=true).fetchSemanticsNode()
            val layouts=mutableListOf<androidx.compose.ui.text.TextLayoutResult>()
            title.config[androidx.compose.ui.semantics.SemanticsActions.GetTextLayoutResult].action!!.invoke(layouts)
            assertEquals(Color(0xfff3e5c0),layouts.single().layoutInput.style.color)
            shot("oracle-$p")
        }
        assertEquals(14,release330Notes.size)
    }
}
