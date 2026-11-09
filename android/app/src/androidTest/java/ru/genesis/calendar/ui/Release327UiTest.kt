package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.espresso.Espresso
import androidx.test.platform.app.InstrumentationRegistry
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
import ru.genesis.calendar.data.MindmapDocument
import ru.genesis.calendar.data.MindmapNode
import java.io.File
import java.time.LocalDate
import java.time.ZoneId

/** Shipped controls and dialogs, synthetic dates, isolated QA package; no account writes. */
class Release327UiTest {
    @get:Rule val compose=createAndroidComposeRule<PagerTestActivity>()
    private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
    @Before fun isolatedPackageOnly() {
        check(BuildConfig.DEBUG && context.packageName.endsWith(".qa327.debug"))
    }
    @Composable private fun Frame(width:Int,palette:String,night:Boolean,content:@Composable ()->Unit) {
        CompositionLocalProvider(LocalDensity provides Density(compose.activity.resources.displayMetrics.widthPixels.toFloat()/width,1.3f),
            LocalGenesisLanguage provides "ru",LocalEveningTheme provides night,LocalDarkPalette provides palette,
            LocalSacredFeaturesEnabled provides true) {
            MaterialTheme(colorScheme=if(night)eveningPalette(palette) else daylightPalette(palette),typography=GenesisTypography,shapes=GenesisShapes) {
                Surface(Modifier.fillMaxSize(),color=MaterialTheme.colorScheme.background) {
                    Box(Modifier.safeDrawingPadding()) {content()}
                }
            }
        }
    }
    private fun shot(name:String) {
        compose.waitForIdle()
        captureNativeWindow(File(context.getExternalFilesDir(null),"release327-$name.png"))
    }
    @Test fun lunarLayoutControlsFillTheRowWithEqualTouchTargetsAcrossPalettesAndWidths() {
        var width by mutableIntStateOf(360)
        var palette by mutableStateOf("blue")
        var night by mutableStateOf(false)
        var epoch by mutableIntStateOf(0)
        compose.setContent {key(epoch) {Frame(width,palette,night) {
            CalendarScreen(LocalDate.of(2026,11,8),CalendarMode.LUNAR,{},experimental=true)
        } } }
        for(w in listOf(360,390,768,1440)) for(p in listOf("green","blue","burgundy","violet")) for(dark in listOf(false,true)) {
            compose.runOnIdle {width=w;palette=p;night=dark;epoch++}
            val first=compose.onNodeWithTag("lunar-layout-decades").performScrollTo()
            val second=compose.onNodeWithTag("lunar-layout-weekdays")
            val a=first.getUnclippedBoundsInRoot();val b=second.getUnclippedBoundsInRoot()
            val pixelDp=w.toFloat()/context.resources.displayMetrics.widthPixels+.02f
            assertEquals("$w/$p/$dark width",(a.right-a.left).value,(b.right-b.left).value,pixelDp)
            assertEquals("$w/$p/$dark height",(a.bottom-a.top).value,(b.bottom-b.top).value,pixelDp)
            assertTrue(a.bottom-a.top>=47.5.dp && a.right-a.left>=47.5.dp)
            val panel=compose.onNodeWithTag("calendar-month-panel-lunar").getUnclippedBoundsInRoot()
            assertTrue("Full card row: $a / $b / $panel",a.left>=panel.left && b.right<=panel.right &&
                a.left-panel.left<=12.dp && panel.right-b.right<=12.dp)
            assertEquals("Symmetric content insets",(a.left-panel.left).value,(panel.right-b.right).value,pixelDp)
            second.performClick();first.assertIsNotSelected();second.assertIsSelected()
            first.performClick();first.assertIsSelected()
            if(!dark && w in listOf(360,1440) || dark && p=="blue" && w==390) shot("lunar-$w-$p-$dark")
        }
    }
    @Test fun namedBranchPickerMovesTheWholeBranchWithoutExposingOrEnteringIds() {
        var map by mutableStateOf(MindmapDocument("map","План",nodes=listOf(
            MindmapNode("root",null,text="План"),MindmapNode("moving","root",text="Замысел"),
            MindmapNode("child","moving",text="Деталь"),MindmapNode("destination","root",text="Работа"))))
        var target by mutableStateOf("root")
        compose.setContent {Frame(390,"blue",false) {
            Column(Modifier.fillMaxWidth().padding(16.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
                ImportChoice("Переместить в ветку",target,mindmapBranchChoices(map,"moving"){it.text},true,"qa327-branch") {target=it}
                Button({map=map.move("moving",target)},enabled=target!=map.nodes.first {it.id=="moving"}.parentId,
                    modifier=Modifier.fillMaxWidth().testTag("qa327-move")) {Text("Переместить узел")}
            }
        } }
        compose.onNodeWithTag("qa327-move").assertIsNotEnabled()
        compose.onNodeWithTag("qa327-branch").assertContentDescriptionEquals("Переместить в ветку: План").performClick()
        compose.onNodeWithTag("qa327-branch-moving").assertDoesNotExist()
        compose.onNodeWithTag("qa327-branch-child").assertDoesNotExist()
        compose.onNodeWithTag("qa327-branch-destination").assertTextEquals("План › Работа").performClick()
        compose.onNodeWithTag("qa327-branch").assertContentDescriptionEquals("Переместить в ветку: План › Работа")
        val field=compose.onNodeWithTag("qa327-branch").getUnclippedBoundsInRoot()
        val button=compose.onNodeWithTag("qa327-move").getUnclippedBoundsInRoot()
        assertEquals((field.right-field.left).value,(button.right-button.left).value,.5f)
        shot("named-branch")
        compose.onNodeWithTag("qa327-move").assertIsEnabled().performClick()
        compose.runOnIdle {
            assertEquals("destination",map.nodes.first {it.id=="moving"}.parentId)
            assertEquals("moving",map.nodes.first {it.id=="child"}.parentId)
        }
    }
    @Test fun nativeNatureHeroLoadsTheNewPanoramaAndKeepsItsDynamicSky() {
        var night by mutableStateOf(false)
        val place=SolarLocation(55.75,37.62,"Europe/Moscow","Synthetic QA observer")
        compose.mainClock.autoAdvance=false
        compose.setContent {Frame(390,"blue",night) {
            CompositionLocalProvider(LocalSacredFeaturesEnabled provides false) {
                CivilTodayHero(place,GenesisCalendar(),ZoneId.of("Europe/Moscow"))
            }
        } }
        compose.waitUntil(20_000) {
            compose.mainClock.advanceTimeByFrame()
            compose.onAllNodesWithTag("civil-today-terrain").fetchSemanticsNodes().isNotEmpty()
        }
        for(dark in listOf(false,true)) {
            compose.runOnIdle {night=dark};compose.mainClock.advanceTimeBy(1400)
            compose.onNodeWithTag("civil-today-sky").assertExists()
            compose.onNodeWithTag("today-civil-date").assertExists()
            shot("nature-$dark")
        }
        val manifest=org.json.JSONObject(context.assets.open("originals/solar-landscapes-v1/manifest.json").bufferedReader().use {it.readText()})
        assertEquals(2172,manifest.getJSONObject("entries").getJSONObject("boreal/11.webp").getInt("width"))
    }
    @Test fun lightSurfacesHavePaletteInkAndKeepCustomColorsAndSolidAccentContrast() {
        var palette by mutableStateOf("blue")
        var checkColors:(()->Unit)?=null
        compose.setContent {Frame(390,palette,false) {
            val scheme=MaterialTheme.colorScheme
            val legacy=eveningSurface(Color(0xff173b38))
            val ink=paletteSurfaceInk(legacy,Color.White)
            val accentInk=paletteSurfaceInk(scheme.primary,scheme.onPrimary)
            val outlinedInk=paletteSurfaceInk(Color.Transparent,scheme.primary)
            val translucent=eveningSurface(scheme.primaryContainer.copy(alpha=.7f))
            var preserved=Color.Unspecified
            CompositionLocalProvider(LocalPreserveCalendarColors provides true) {preserved=eveningSurface(Color(0xffb64022))}
            checkColors={
                fun contrast(a:Color,b:Color)=(maxOf(a.luminance(),b.luminance())+.05f)/(minOf(a.luminance(),b.luminance())+.05f)
                assertEquals(scheme.primaryContainer,legacy)
                assertTrue("$palette reading contrast",contrast(legacy,ink)>=4.5f)
                assertTrue("$palette button contrast",contrast(scheme.primary,accentInk)>=4.5f)
                assertEquals("$palette transparent controls retain readable accent ink",scheme.primary,outlinedInk)
                assertTrue("$palette outlined contrast",contrast(scheme.surface,outlinedInk)>=4.5f)
                assertEquals(scheme.primaryContainer.copy(alpha=.7f),translucent)
                assertEquals(Color(0xffb64022),preserved)
            }
            Column(Modifier.fillMaxSize().padding(16.dp).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(12.dp)) {
                Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {TodayThemeButton(false,true) {};CalendarModeSwitcher(CalendarMode.SACRED,{})}
                Surface(color=Color(0xff173b38)) {Text("Текст читается в выбранной палитре",Modifier.padding(16.dp),color=Color.White)}
                Button({}) {Text("Основное действие")}
                CalendarYearDescriptionCard(ru.genesis.calendar.domain.GenesisCalendar(),LocalDate.of(2026,11,8),CalendarMode.LUNAR)
            }
        } }
        for(p in listOf("green","blue","burgundy","violet")) {
            compose.runOnIdle {palette=p};compose.waitForIdle();compose.runOnIdle {checkColors!!()}
            compose.onNodeWithTag("calendar-year-description-toggle-lunar").performClick()
            shot("light-$p")
            compose.onNodeWithTag("calendar-year-description-toggle-lunar").performClick()
        }
    }
    @Test fun lunarDetailsFitTheWindowAndCloseWithSystemBack() {
        var width by mutableIntStateOf(360)
        var night by mutableStateOf(false)
        compose.setContent {Frame(width,"blue",night) {key(width,night) {Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            CalendarYearDescriptionCard(ru.genesis.calendar.domain.GenesisCalendar(),LocalDate.of(2026,11,8),CalendarMode.LUNAR)
        }}}}
        for(w in listOf(360,390,768,1440)) for(dark in listOf(false,true)) {
            compose.runOnIdle {width=w;night=dark}
            compose.onNodeWithTag("calendar-year-description-toggle-lunar").performClick()
            compose.onNodeWithTag("lunar-year-details-open").performScrollTo().performClick()
            // Platform Dialog owns a separate window with the real device density.
            val panel=compose.onNodeWithTag("lunar-year-details-dialog").assertIsDisplayed().fetchSemanticsNode().boundsInRoot
            assertTrue("$w/$dark dialog bounds $panel",panel.left>=0f && panel.right<=context.resources.displayMetrics.widthPixels+1f)
            shot("lunar-dialog-$w-$dark")
            Espresso.pressBack()
            compose.onNodeWithTag("lunar-year-details-dialog").assertDoesNotExist()
        }
    }
}
