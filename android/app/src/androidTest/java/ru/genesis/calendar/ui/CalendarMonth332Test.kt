package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.*
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.time.LocalDate
import java.time.ZoneId
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.captureNativeWindow
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.GenesisCalendar

/** Uses only the established hero API, so the same fixture can capture 3.3.1. */
class CalendarMonth332Test {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val baseline get() = InstrumentationRegistry.getArguments().getString("genesisBaseline") == "true"
    @Test fun monthHeightIsStableAcrossPeriodsModesAndReturnButton() {
        var width by mutableIntStateOf(390)
        var dark by mutableStateOf(false)
        var sacred by mutableStateOf(true)
        var today by mutableStateOf(true)
        var mode by mutableStateOf(CalendarMode.PROFANE)
        var date by mutableStateOf(LocalDate.of(2026, 12, 31))
        var language by mutableStateOf("ru")
        var epoch by mutableIntStateOf(0)
        val calendar = GenesisCalendar()
        val issues = mutableListOf<String>()
        compose.setContent { key(epoch) {
            CompositionLocalProvider(LocalGenesisLanguage provides language,
                LocalEveningTheme provides dark, LocalDarkPalette provides "blue",
                LocalSacredFeaturesEnabled provides sacred,
                LocalDensity provides Density(context.resources.displayMetrics.widthPixels.toFloat() / width, 1.3f),
                LocalGenesisTextLayoutAudit provides { text, layout ->
                    if (layout.hasVisualOverflow || layout.splitsWord()) issues += "$text [width=${layout.didOverflowWidth}, height=${layout.didOverflowHeight}, words=${layout.splitsWord()}, size=${layout.size}, constraints=${layout.layoutInput.constraints}]"
                }) {
                MaterialTheme(colorScheme = if (dark) eveningPalette("blue") else daylightPalette("blue"),
                    typography = GenesisTypography, shapes = GenesisShapes) {
                    Surface(Modifier.fillMaxSize()) {
                        Column(Modifier.safeDrawingPadding().padding(4.dp)) {
                            CalendarMonthHero(calendar, date, mode, ZoneId.of("Europe/Moscow"), today, {}, {}, {})
                        }
                    }
                }
            }
        } }
        val proof = org.json.JSONArray()
        for (w in listOf(360, 390, 768, 1440)) for (night in listOf(false, true))
            for (enabled in listOf(true, false)) {
                var expected: Float? = null
                for (m in if (enabled) CalendarMode.entries else listOf(CalendarMode.PROFANE))
                    for (d in listOf(LocalDate.of(2026, 12, 31), LocalDate.of(2027, 2, 1)))
                        for (offer in listOf(false, true)) {
                            compose.runOnIdle {
                                width = w; dark = night; sacred = enabled; mode = m; date = d; today = offer
                                issues.clear(); epoch++
                            }
                            compose.waitForIdle()
                            val hero = compose.onNodeWithTag("month-description-layout").getUnclippedBoundsInRoot()
                            if (!baseline) {
                                if (issues.isNotEmpty()) captureNativeWindow(File(context.getExternalFilesDir(null), "release332-overflow-$w-$night-$enabled-$m-$d-$offer.png"))
                                expected?.let { assertEquals("Stable $w/$night/$enabled/$m/$d/$offer", it, hero.height.value, .5f) }
                                assertTrue("Whole, visible copy: $issues", issues.isEmpty())
                            }
                            expected = hero.height.value
                            for (action in listOf("previous", "next") + if (offer) listOf("today") else emptyList()) {
                                val button = compose.onNodeWithTag("calendar-month-$action").getUnclippedBoundsInRoot()
                                assertEquals(48f, button.width.value, 1f)
                                assertEquals(48f, button.height.value, 1f)
                                assertTrue(button.top >= hero.top && button.bottom <= hero.bottom)
                            }
                            if (offer && !baseline) {
                                val back = compose.onNodeWithTag("calendar-month-today").getUnclippedBoundsInRoot()
                                val next = compose.onNodeWithTag("calendar-month-next").getUnclippedBoundsInRoot()
                                assertTrue("Separate targets at $w/$night/$enabled: ${back.bottom}/${next.top}", back.bottom <= next.top + 1.dp)
                            }
                            proof.put(org.json.JSONObject().put("width", w).put("dark", night).put("sacred", enabled)
                                .put("mode", m.name).put("date", d.toString()).put("return", offer).put("height", hero.height.value))
                            if (offer && d.monthValue == 12) captureNativeWindow(File(context.getExternalFilesDir(null),
                                "release332-${if (baseline) "before" else "after"}-$w-$night-$enabled-$m.png"))
                        }
            }
        if (!baseline) for (lang in listOf("ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja"))
            for (m in CalendarMode.entries) {
                compose.runOnIdle {
                    width = 360; dark = false; sacred = true; today = true; mode = m
                    date = LocalDate.of(2027, 2, 1); language = lang; issues.clear(); epoch++
                }
                compose.waitForIdle()
                assertTrue("$lang/$m keeps complete words and all copy: $issues", issues.isEmpty())
            }
        File(context.getExternalFilesDir(null), "release332-${if (baseline) "before" else "after"}-height-proof.json")
            .writeText(proof.toString(2))
    }
}
