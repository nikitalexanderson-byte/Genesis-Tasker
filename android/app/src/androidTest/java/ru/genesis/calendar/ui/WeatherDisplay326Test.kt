package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.StoicheionGestureActivity
import ru.genesis.calendar.captureNativeWindow
import ru.genesis.calendar.data.LocalPreferences
import ru.genesis.calendar.domain.*
import java.io.File
import java.time.Instant

class WeatherDisplay326Test {
    @get:Rule val compose = createAndroidComposeRule<StoicheionGestureActivity>()
    private val app get() = compose.activity.application as GenesisApplication
    private fun fixture() = InstrumentationRegistry.getInstrumentation().context.assets.open("weather-v1.json")
        .bufferedReader().use { WeatherSnapshotV1.fromJson(JSONObject(it.readText())) }
    private val now = Instant.parse("2026-11-06T12:30:00Z")

    @Test fun permanentReadingsAndSavedUnitsFitBothModesWithLargeText() {
        check(BuildConfig.DEBUG && listOf(".qa326.debug", ".qa328.debug", ".qa330.debug").any(app.packageName::endsWith))
        val store = LocalPreferences(app, "qa-weather-326")
        val display = compose.activity.resources.displayMetrics
        val widths = if (compose.activity.resources.configuration.smallestScreenWidthDp >= 600)
            listOf(768,1440) else listOf(360,390)
        var width by mutableIntStateOf(widths.first())
        var dark by mutableStateOf(false)
        var units by mutableStateOf(WeatherDisplayUnits())
        val sample = fixture()
        compose.setContent {
            CompositionLocalProvider(LocalGenesisLanguage provides "ru", LocalEveningTheme provides dark,
                LocalWeatherDisplayUnits provides units,
                LocalDensity provides Density(display.widthPixels.toFloat()/width, 1.3f)) {
                MaterialTheme(colorScheme = if (dark) eveningPalette("blue") else daylightPalette("blue"),
                    typography = GenesisTypography, shapes = GenesisShapes) {
                    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                        Column(Modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()).padding(12.dp),
                            verticalArrangement = Arrangement.spacedBy(16.dp)) {
                            CivilTodayWeather(CivilWeatherState(enabled=true, snapshot=sample), now) {
                                Column(Modifier.testTag("weather-test-date")) {
                                    Text("Воскресенье", style=MaterialTheme.typography.headlineSmall)
                                    Text("8 ноября 2026", style=MaterialTheme.typography.bodyMedium)
                                    Text("01:50:11", style=MaterialTheme.typography.titleLarge)
                                }
                            }
                            WeatherDisplaySettings(units, onTemperature = {
                                runBlocking { store.set("weatherTemperatureUnit", it) }
                                units=units.copy(temperature=WeatherTemperatureUnit.fromWire(it))
                            }, onPressure = {
                                runBlocking { store.set("weatherPressureUnit", it) }
                                units=units.copy(pressure=WeatherPressureUnit.fromWire(it))
                            })
                        }
                    }
                }
            }
        }
        for (night in listOf(false,true)) for (w in widths) {
            compose.runOnIdle { dark=night; width=w; units=WeatherDisplayUnits() }
            compose.onNodeWithTag("civil-weather-current").performScrollTo().assertHasNoClickAction()
            compose.onNodeWithTag("civil-weather-temperature").assertTextEquals("+6°C")
            compose.onNodeWithTag("civil-weather-pressure").assertTextContains("1008 гПа", substring=true)
            val date=compose.onNodeWithTag("weather-test-date").fetchSemanticsNode().boundsInRoot
            val current=compose.onNodeWithTag("civil-weather-current").fetchSemanticsNode().boundsInRoot
            val details=compose.onNodeWithTag("civil-weather-details").fetchSemanticsNode().boundsInRoot
            val temperature=compose.onNodeWithTag("civil-weather-temperature").fetchSemanticsNode().boundsInRoot
            assertTrue(current.left>=date.right)
            assertTrue(details.top>=temperature.bottom && details.right<=current.right+1)
            compose.onNodeWithTag("weather-temperature-fahrenheit").performScrollTo().performClick().assertIsSelected()
            compose.onNodeWithTag("weather-pressure-mmhg").performScrollTo().performClick().assertIsSelected()
            if (w>=768) {
                val temperatureGroup=compose.onNodeWithTag("weather-unit-group-temperature").fetchSemanticsNode().boundsInRoot
                val pressureGroup=compose.onNodeWithTag("weather-unit-group-pressure").fetchSemanticsNode().boundsInRoot
                assertEquals(temperatureGroup.width,pressureGroup.width,1f)
                assertEquals(temperatureGroup.top,pressureGroup.top,1f)
                assertEquals(temperatureGroup.height,pressureGroup.height,1f)
            }
            captureNativeWindow(File(app.getExternalFilesDir(null), "release326-weather-settings-${if(night) "dark" else "light"}-$w.png"))
            compose.onNodeWithTag("civil-weather-temperature").performScrollTo().assertTextEquals("+43°F")
            compose.onNodeWithTag("civil-weather-pressure").assertTextContains("756,1 мм рт. ст.", substring=true)
            compose.onNodeWithTag("civil-weather-humidity").assertIsDisplayed()
            compose.onNodeWithTag("civil-weather-precipitation").assertIsDisplayed()
            compose.waitForIdle()
            captureNativeWindow(File(app.getExternalFilesDir(null), "release326-weather-permanent-${if(night) "dark" else "light"}-$w.png"))
            val reloaded = runBlocking { LocalPreferences(app,"qa-weather-326").values.first() }
            assertEquals("fahrenheit",reloaded.weatherTemperatureUnit)
            assertEquals("mmhg",reloaded.weatherPressureUnit)
        }
    }

    @Test fun staleUnknownAndCitySelectionStatesStayTruthful() {
        val original=fixture()
        var state by mutableStateOf(CivilWeatherState(enabled=true, snapshot=original.copy(status="stale",
            current=original.current!!.copy(temperatureC=null, humidityPercent=null, pressureMslHpa=null, precipitationRateMmH=0.0))))
        var cityChosen=false
        compose.setContent { CompositionLocalProvider(LocalGenesisLanguage provides "en") {
            MaterialTheme { CivilTodayWeather(state,now,onChooseCity={cityChosen=true}) { Text("Friday") } }
        } }
        compose.onNodeWithText("Outdated data").assertIsDisplayed()
        compose.onNodeWithTag("civil-weather-temperature").assertDoesNotExist()
        compose.onNodeWithTag("civil-weather-humidity").assertDoesNotExist()
        compose.onNodeWithTag("civil-weather-pressure").assertDoesNotExist()
        compose.onNodeWithTag("civil-weather-precipitation").assertTextContains("0 mm/h", substring=true)
        compose.runOnIdle { state=CivilWeatherState(enabled=true,requiresLocation=true) }
        compose.onNodeWithTag("civil-weather-choose-city").performClick()
        compose.runOnIdle { assertTrue(cityChosen) }
    }

    @Test fun tabletSettingsUseFreeColumnSpaceAndKeepWeatherLastAtFullWidth() {
        val display=compose.activity.resources.displayMetrics
        var width by mutableIntStateOf(1024)
        var dark by mutableStateOf(false)
        compose.setContent {
            CompositionLocalProvider(LocalGenesisLanguage provides "ru", LocalEveningTheme provides dark,
                LocalDensity provides Density(display.widthPixels.toFloat()/width,1.3f)) {
                MaterialTheme(colorScheme=if(dark) eveningPalette("blue") else daylightPalette("blue"),
                    typography=GenesisTypography, shapes=GenesisShapes) {
                    Surface(Modifier.fillMaxSize(),color=MaterialTheme.colorScheme.background) {
                        AdaptiveSettingsSections {
                            Text("Настройки · Оформление",Modifier.fillMaxWidth().height(40.dp).testTag("packing-header"))
                            listOf("a" to 220,"b" to 60,"c" to 60,"d" to 80).forEach { (id,height) ->
                                Surface(Modifier.fillMaxWidth().height(height.dp).testTag("packing-$id"),
                                    color=MaterialTheme.colorScheme.surfaceContainerLow) { Text("Раздел $id",Modifier.padding(12.dp)) }
                            }
                            WeatherDisplaySettings(WeatherDisplayUnits(),{}, {})
                        }
                    }
                }
            }
        }
        fun rect(tag: String)=compose.onNodeWithTag(tag).fetchSemanticsNode().boundsInRoot
        for(night in listOf(false,true)) for(w in listOf(1024,1440)) {
            compose.runOnIdle { width=w; dark=night }
            val header=rect("packing-header")
            val cards=listOf("a","b","c","d").map { rect("packing-$it") }
            val weather=rect("appearance-weather-settings")
            assertEquals(cards[0].width,cards[1].width,1f)
            assertEquals(cards[1].left,cards[2].left,1f)
            assertTrue(cards[2].top>=cards[1].bottom && cards[2].top<cards[0].bottom)
            assertEquals(header.width,weather.width,1f)
            assertTrue(weather.top>=cards.maxOf { it.bottom })
            val all=listOf(header)+cards+weather
            all.forEachIndexed { i,a -> all.drop(i+1).forEach { b -> assertFalse("Settings cards must not overlap",a.overlaps(b)) } }
            captureNativeWindow(File(app.getExternalFilesDir(null),"release326-tablet-settings-packing-${if(night) "dark" else "light"}-$w.png"))
        }
    }
}
