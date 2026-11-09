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
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.captureNativeWindow
import ru.genesis.calendar.domain.GenesisCalendar
import ru.genesis.calendar.domain.SolarLocation
import java.io.File
import java.time.Instant
import java.time.ZoneId

/** Production controls, using only the separate local QA package and its preferences. */
class Release325UiTest {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val args get() = InstrumentationRegistry.getArguments()

    @Before fun isolatedPackageOnly() {
        check(BuildConfig.DEBUG && context.packageName.endsWith(".qa324.debug"))
    }

    @Composable private fun Frame(palette: String, language: String, content: @Composable () -> Unit) {
        val density = LocalDensity.current
        val font = args.getString("genesisFontScale")?.toFloatOrNull()?.coerceIn(1f, 1.5f) ?: density.fontScale
        CompositionLocalProvider(LocalGenesisLanguage provides language, LocalEveningTheme provides (palette != "light"),
            LocalDarkPalette provides palette, LocalSacredFeaturesEnabled provides false,
            LocalDensity provides Density(density.density, font)) {
            MaterialTheme(colorScheme = if (palette == "light") standart else eveningPalette(palette),
                typography = GenesisTypography, shapes = GenesisShapes) {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    Box(Modifier.safeDrawingPadding()) { content() }
                }
            }
        }
    }

    private fun capture(name: String) {
        compose.waitForIdle()
        captureNativeWindow(File(context.getExternalFilesDir(null),
            "release325-" + name + "-" + args.getString("genesisFontScale", "system") + ".png"))
    }

    @Test fun cityButtonHasLocalizedCopyAndOpensTheFocusedCityControlInAllLanguages() {
        val catalog = context.assets.open("originals/i18n/weather-copy.json")
            .bufferedReader(Charsets.UTF_8).use { JSONObject(it.readText()) }
        var language by mutableStateOf("ru")
        var region by mutableStateOf(false)
        var focus by mutableStateOf(false)
        var focusHandled = 0
        compose.setContent { Frame("violet", language) {
            if (region) Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                SolarPlaceSettings(focus) { focus = false; focusHandled++ }
            } else CivilTodayWeather(CivilWeatherState(enabled = true, requiresLocation = true), Instant.now(),
                onChooseCity = { region = true; focus = true }) { Text("Today") }
        } }
        for (next in listOf("ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja")) {
            compose.runOnIdle { language = next; region = false }
            val button = compose.onNodeWithTag("civil-weather-choose-city")
            button.assertIsDisplayed().assertTextEquals(catalog.getJSONObject(next).getString("requiresLocation"))
            val bounds = button.getUnclippedBoundsInRoot()
            // Pixel-aligned 48dp bounds can convert back slightly below 48 on fractional densities.
            assertTrue("$next city touch target: $bounds",
                bounds.right - bounds.left >= 47.5.dp && bounds.bottom - bounds.top >= 47.5.dp)
            button.performClick()
            compose.onNodeWithTag("solar-place-query").assertIsDisplayed().assertIsFocused()
            compose.runOnIdle { assertFalse(focus); assertTrue(focusHandled > 0) }
            if (next in listOf("ru", "en", "ja")) capture("city-$next")
        }
        compose.runOnIdle { assertEquals(14, focusHandled) }
    }

    @Test fun nightLandscapeLoadsSharedStarsOnPhoneAndTabletWithoutChangingTheActualTodayDate() {
        // Place the synthetic observer at local solar midnight; device time/date are never altered.
        val seconds = Instant.now().epochSecond.mod(86_400L).toDouble()
        val longitude = ((-seconds / 240.0 + 540.0) % 360.0) - 180.0
        val location = SolarLocation(0.0, longitude, "UTC", "QA night observer")
        var palette by mutableStateOf("light")
        compose.mainClock.autoAdvance = false
        compose.setContent { Frame(palette, "en") {
            CivilTodayHero(location, GenesisCalendar(), ZoneId.of("Europe/Moscow"))
        } }
        compose.waitUntil(15_000) {
            compose.mainClock.advanceTimeByFrame()
            compose.onAllNodesWithTag("civil-today-terrain").fetchSemanticsNodes().isNotEmpty()
        }
        for (next in listOf("light", "green", "burgundy", "violet")) {
            compose.runOnIdle { palette = next }
            compose.mainClock.advanceTimeBy(1400)
            compose.onNodeWithTag("civil-today-hero").assertIsDisplayed()
            compose.onNodeWithTag("today-civil-date").assertExists()
            compose.onNodeWithTag("today-civil-clock").assertExists()
            capture("night-$next")
        }
    }
}
