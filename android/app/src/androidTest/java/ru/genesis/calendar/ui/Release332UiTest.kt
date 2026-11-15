package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toPixelMap
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
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.data.HabitsRepository
import ru.genesis.calendar.data.StoicheionTimelineState
import ru.genesis.calendar.data.StoicheionTimelineWindow
import androidx.compose.ui.graphics.Color
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking

class Release332UiTest {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val baseline get() = InstrumentationRegistry.getArguments().getString("genesisBaseline") == "true"

    @Test fun threeCardsHonorTheStateReceivedFromTheWebsite() {
        val now = java.time.Instant.parse("2026-11-15T10:01:00Z").toEpochMilli()
        val catalog = org.json.JSONArray(context.assets.open("stoicheion.json").bufferedReader().use { it.readText() })
        val letters = (0 until catalog.length()).map { i -> catalog.getJSONObject(i).let { item ->
            StoicheionLetter(item.getString("id"), i, item.getString("name"), item.getString("symbol"),
                item.getString("lowercase"), item.getInt("value"), item.getInt("pythmen"), item.getString("tagline"),
                item.getString("content"), "", "", "", Color(0xffdfc17e))
        } }
        var session by mutableStateOf(StoicheionTimelineState("2026-11-15", "2026-11-09", 0x12345678L, 3,
            now - 300000, listOf(
                StoicheionTimelineWindow(0, now - 60000, now + 120000, false, true),
                StoicheionTimelineWindow(1, now - 300000, now - 120000, false, false),
                StoicheionTimelineWindow(2, now - 10000, now + 170000, false, true)), 0))
        var dark by mutableStateOf(false)
        val actions = mutableListOf<Pair<Int, String>>()
        compose.setContent {
            CompositionLocalProvider(LocalGenesisLanguage provides "ru", LocalEveningTheme provides dark,
                LocalDarkPalette provides "blue") {
                MaterialTheme(colorScheme = if (dark) eveningPalette("blue") else daylightPalette("blue"),
                    typography = GenesisTypography, shapes = GenesisShapes) {
                    Column(Modifier.safeDrawingPadding().verticalScroll(rememberScrollState())) {
                        StoicheionTimelinePanel(letters, session.asDraw(), true, now, false, {}, {},
                            session, { position, action -> actions += position to action })
                    }
                }
            }
        }
        compose.onNodeWithTag("stoicheion-reroll-timeline-0").performScrollTo().assertIsEnabled()
        // The next snapshot represents a reroll already spent in a browser.
        compose.runOnIdle { session = session.copy(revision = 4, cards = session.cards.map { if (it.position == 0) it.copy(rerolled = true, canReroll = false) else it }) }
        for (night in listOf(false, true)) {
            compose.runOnIdle { dark = night }
            compose.onNodeWithTag("stoicheion-reroll-timeline-0").performScrollTo().assertIsNotEnabled()
            compose.onNodeWithTag("stoicheion-reroll-timeline-1").assertIsNotEnabled()
            compose.onNodeWithTag("stoicheion-reroll-timeline-2").assertIsEnabled().performClick()
            captureNativeWindow(File(context.getExternalFilesDir(null), "release332-timeline-$night.png"))
        }
        assertEquals(listOf(2 to "reroll", 2 to "reroll"), actions)
    }

    @Test fun newIdentityAndLauncherSwitchAcrossAllEightSchemes() {
        var palette by mutableStateOf("green")
        var dark by mutableStateOf(false)
        compose.setContent {
            CompositionLocalProvider(LocalDarkPalette provides palette, LocalEveningTheme provides dark) {
                Box(Modifier.fillMaxSize().safeDrawingPadding(), contentAlignment = androidx.compose.ui.Alignment.Center) {
                    GenesisIdentityImage(Modifier.size(240.dp))
                }
            }
        }
        try {
            for (p in GenesisBrandIcon.palettes) for (night in listOf(false, true)) {
                compose.runOnIdle { palette = p; dark = night }
                runBlocking { GenesisBrandIcon.updateLauncher(context, p, night) }
                val intent = android.content.Intent(android.content.Intent.ACTION_MAIN)
                    .addCategory(android.content.Intent.CATEGORY_LAUNCHER).setPackage(context.packageName)
                val entries = context.packageManager.queryIntentActivities(intent, 0)
                assertEquals("Only one launcher entry", 1, entries.size)
                assertEquals(GenesisBrandIcon.alias(p, night), entries.single().activityInfo.name)
                assertTrue(context.packageManager.getActivityInfo(android.content.ComponentName(context.packageName,
                    "ru.genesis.calendar.MainActivity"), 0).enabled)
                compose.onNodeWithContentDescription("GENESIS").assertIsDisplayed()
                captureNativeWindow(File(context.getExternalFilesDir(null), "release332-icon-$p-$night.png"))
            }
        } finally { runBlocking { GenesisBrandIcon.updateLauncher(context, "green", false) } }
    }

    @Test fun formsAndHeroOverviewFollowTheSharedLayoutAndPalette() {
        val app = context.applicationContext as GenesisApplication
        check(app.packageName.endsWith(".debug"))
        app.activateAccount(null)
        val repository = HabitsRepository(app)
        val original = runBlocking { repository.workspace.first().settings }
        runBlocking { repository.updateSettings(original.copy(enabled = true,
            feedback = original.feedback.copy(gamificationWidgets = true, animations = false))) }
        var width by mutableIntStateOf(390)
        var dark by mutableStateOf(false)
        var palette by mutableStateOf("blue")
        var panel by mutableIntStateOf(0)
        var epoch by mutableIntStateOf(0)
        compose.setContent { key(epoch) {
            CompositionLocalProvider(LocalGenesisLanguage provides "ru", LocalDarkPalette provides palette,
                LocalEveningTheme provides dark, LocalSacredFeaturesEnabled provides true,
                LocalDensity provides Density(context.resources.displayMetrics.widthPixels.toFloat() / width, 1.3f)) {
                MaterialTheme(colorScheme = if (dark) eveningPalette(palette) else daylightPalette(palette),
                    typography = GenesisTypography, shapes = GenesisShapes) {
                    Surface(Modifier.fillMaxSize()) {
                        when (panel) {
                            0 -> CategoryEditor(null, 0, 0, null, {}, onSave = { _, _ -> })
                            1 -> Column(Modifier.safeDrawingPadding().verticalScroll(rememberScrollState())) { OlympianIsopsephy(onOpenStoicheion = {}) }
                            else -> HabitsScreen(app, true, openHeroPath = true)
                        }
                    }
                }
            }
        } }
        try {
            for (w in listOf(360, 390, 768, 1440)) for (night in listOf(false, true)) {
                compose.runOnIdle { width = w; dark = night; panel = 0; epoch++ }
                val field = compose.onNodeWithTag("category-name").getUnclippedBoundsInRoot()
                val picker = compose.onNodeWithTag("category-color-open").getUnclippedBoundsInRoot()
                assertEquals(field.left.value, picker.left.value, .5f)
                assertEquals(field.right.value, picker.right.value, .5f)
                captureNativeWindow(File(context.getExternalFilesDir(null), "release332-category-$w-$night.png"))
                compose.runOnIdle { panel = 1; epoch++ }
                compose.onNodeWithTag("olympian-isopsephy-toggle").performClick()
                val frame = compose.onNodeWithTag("genesis-modal-surface").getUnclippedBoundsInRoot()
                compose.onNodeWithTag("olympian-native-webview").assertExists()
                val device = androidx.test.uiautomator.UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
                assertTrue("Current local catalog loads", device.wait(androidx.test.uiautomator.Until.hasObject(
                    androidx.test.uiautomator.By.textContains("Зевс")), 15000))
                captureNativeWindow(File(context.getExternalFilesDir(null), "release332-olympians-$w-$night.png"))
                compose.onNodeWithTag("olympian-catalog-close").performClick()
            }
            for (p in listOf("green", "blue", "burgundy", "violet")) for (night in listOf(false, true)) {
                compose.runOnIdle { width = 390; palette = p; dark = night; panel = 2; epoch++ }
                compose.waitUntil(10000) { compose.onAllNodesWithTag("habit-hero-path-section").fetchSemanticsNodes().isNotEmpty() }
                compose.onNodeWithTag("habit-hero-path-section").performScrollTo()
                val pixels = compose.onNodeWithTag("habit-hero-path-section").captureToImage().toPixelMap()
                val sampleY = (context.resources.displayMetrics.widthPixels / 390f * 6f).toInt()
                val actual = pixels[pixels.width / 2, sampleY]
                val expected = eveningPalette(p).secondaryContainer
                assertEquals("$p/$night red", expected.red, actual.red, .02f)
                assertEquals("$p/$night green", expected.green, actual.green, .02f)
                assertEquals("$p/$night blue", expected.blue, actual.blue, .02f)
                captureNativeWindow(File(context.getExternalFilesDir(null), "release332-hero-$p-$night.png"))
            }
        } finally { runBlocking { repository.updateSettings(original) } }
    }

}
