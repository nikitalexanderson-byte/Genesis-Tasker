package ru.genesis.calendar.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.captureNativeWindow
import java.io.File
import java.util.Locale

class Release330LocaleUiTest {
    @get:Rule val compose=createAndroidComposeRule<PagerTestActivity>()
    private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
    @Before fun isolated() { check(BuildConfig.DEBUG && context.packageName.endsWith(".qa330.debug")) }
    @Composable private fun Frame(language:String,night:Boolean,content:@Composable ()->Unit) {
        CompositionLocalProvider(LocalDensity provides Density(compose.activity.resources.displayMetrics.widthPixels/360f,1.3f),
            LocalGenesisLanguage provides language,LocalEveningTheme provides night,LocalDarkPalette provides "blue") {
            MaterialTheme(colorScheme=if(night)eveningPalette("blue") else daylightPalette("blue"),typography=GenesisTypography,shapes=GenesisShapes) {
                Surface(Modifier.fillMaxSize(),color=MaterialTheme.colorScheme.background) {Box(Modifier.safeDrawingPadding()) {content()}}
            }
        }
    }
    @Test fun releaseNotesAndLocalizedZoneNamesWorkInAllFourteenLanguagesAndBothSchemes() {
        var language by mutableStateOf("ru");var night by mutableStateOf(false);var epoch by mutableIntStateOf(0)
        compose.setContent {key(epoch) {Frame(language,night) {ReleaseNotesDialog {}}}}
        for(lang in listOf("ru","en","el","de","fr","es","it","pt","pl","sr","uk","zh","tr","ja")) for(dark in listOf(false,true)) {
            compose.runOnIdle {language=lang;night=dark;epoch++}
            compose.onNodeWithTag("release-notes-dialog").assertIsDisplayed()
            val text=release331Notes.getValue(lang)
            compose.onNodeWithText("• ${text.last()}",useUnmergedTree=true).performScrollTo().assertIsDisplayed()
            assertTrue(text.joinToString("\n").length<=500)
            assertTrue(timeZoneChoices(Locale.forLanguageTag(lang)).any {it.id=="Europe/Moscow" && it.city.isNotBlank()})
            if(lang in listOf("ru","en","de","el","ja")) {
                captureNativeWindow(File(context.getExternalFilesDir(null),"release330-notes-$lang-$dark.png"))
            }
        }
    }
    @Test fun nativeCloudsAndEachPrecipitationKindRenderWithReducedMotionCompatibleLayers() {
        var kind by mutableStateOf("rain");var night by mutableStateOf(false)
        compose.mainClock.autoAdvance=false
        compose.setContent {Frame("en",night) {
            Box(Modifier.fillMaxWidth().height(260.dp).background(if(night)Color(0xff10223b)else Color(0xff779dbb))) {
                val effects=CivilWeatherEffects(fresh=true,precipitation=kind,particles=36,cloudCover=.85f,
                    windVisible=true,drift=40f,fogOpacity=if(kind=="fog").3f else 0f)
                CivilWeatherOverlay(effects,CivilWeatherVisualPolicy(),.6f,if(night).05f else .9f,Modifier.matchParentSize(),skyOnly=true)
                CivilWeatherOverlay(effects,CivilWeatherVisualPolicy(),.6f,if(night).05f else .9f,Modifier.matchParentSize())
            }
        }}
        for(next in listOf("rain","drizzle","snow","sleet","hail","fog")) for(dark in listOf(false,true)) {
            compose.runOnIdle {kind=next;night=dark}
            compose.mainClock.advanceTimeBy(16)
            compose.onNodeWithTag("civil-weather-clouds").assertIsDisplayed()
            compose.onNodeWithTag("civil-weather-effects").assertIsDisplayed()
            captureNativeWindow(File(context.getExternalFilesDir(null),"release330-weather-$next-$dark.png"))
        }
    }
}
