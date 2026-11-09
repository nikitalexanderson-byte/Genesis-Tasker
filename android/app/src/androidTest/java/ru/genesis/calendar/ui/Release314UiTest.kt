package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.captureNativeWindow
import ru.genesis.calendar.auth.*
import java.io.File

class Release314UiTest {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    private val app get() = compose.activity.application as GenesisApplication
    private val args get() = InstrumentationRegistry.getArguments()
    private val dark get() = args.getString("genesisDark") == "true"
    @Composable private fun Frame(content: @Composable () -> Unit) {
        val width = args.getString("genesisWidth")?.toIntOrNull() ?: 390
        val font = args.getString("genesisFontScale")?.toFloatOrNull() ?: 1f
        val density = compose.activity.resources.displayMetrics.widthPixels.toFloat() / width
        val config = android.content.res.Configuration(LocalConfiguration.current).apply { screenWidthDp = width }
        CompositionLocalProvider(LocalEveningTheme provides dark, LocalGenesisLanguage provides "ru",
            LocalDensity provides Density(density, font), LocalConfiguration provides config) {
            MaterialTheme(colorScheme = if (dark) evening else standart, typography = GenesisTypography, shapes = GenesisShapes) {
                Surface(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing)) { content() }
            }
        }
    }
    private fun capture(name: String) {
        compose.waitForIdle()
        captureNativeWindow(File(app.getExternalFilesDir(null), "314-${args.getString("genesisWidth") ?: "390"}-${if(dark)"dark"else"light"}-$name.png"))
    }

    @Test fun sourceSwitchesAllowEitherOrBothAndKeepTheLastSelectedSource() {
        var saved=AdvicePreferences(smart=false,categories=listOf("aretology","hestiology"))
        compose.setContent { Frame { Column(Modifier.verticalScroll(rememberScrollState())) {
            DailyAdviceSettings(saved,listOf("aretology","hestiology"),true,"ru",true) { patch ->
                val next=saved.toJson();patch.keys().asSequence().forEach { next.put(it,patch.get(it)) }
                AdvicePreferences.fromJson(next).also { saved=it }
            }
        } } }
        compose.onNodeWithTag("advice-collection-aurora").performScrollTo().assertIsNotEnabled()
        compose.onNodeWithTag("advice-source-tab-philosophers").performScrollTo().performClick()
        compose.onNodeWithTag("advice-collection-philosophers").performClick()
        compose.waitUntil(5_000) { saved.collections.size==2 }
        capture("sources-both")
        compose.onNodeWithTag("advice-source-tab-aurora").performScrollTo().performClick()
        compose.onNodeWithTag("advice-collection-aurora").performClick()
        compose.waitUntil(5_000) { saved.collections==listOf("philosophers") }
        compose.onNodeWithTag("advice-smart").assertIsNotEnabled()
        compose.onNodeWithTag("advice-category-aretology").performScrollTo().assertIsOn().assertIsNotEnabled()
        compose.onNodeWithTag("advice-category-hestiology").performScrollTo().assertIsOn().assertIsNotEnabled()
        compose.runOnIdle { assertEquals(listOf("aretology","hestiology"),saved.categories) }
        compose.onNodeWithTag("advice-source-tab-philosophers").performScrollTo().performClick()
        compose.onNodeWithTag("advice-collection-philosophers").assertIsNotEnabled()
        compose.onNodeWithTag("advice-smart").assertDoesNotExist()
        capture("sources-philosophers")
        compose.onNodeWithTag("advice-source-tab-aurora").performScrollTo().performClick()
        compose.onNodeWithTag("advice-collection-aurora").performScrollTo().performClick()
        compose.waitUntil(5_000) { saved.collections.size==2 }
        compose.onNodeWithTag("advice-category-aretology").performScrollTo().assertIsOn().assertIsEnabled()
        compose.onNodeWithTag("advice-category-hestiology").performScrollTo().assertIsOn().assertIsEnabled()
        compose.onNodeWithTag("advice-source-tab-philosophers").performScrollTo().performClick()
        compose.onNodeWithTag("advice-collection-philosophers").performClick()
        compose.waitUntil(5_000) { saved.collections==listOf("aurora") }
    }

    @Test fun automaticDeletionFieldsChooseCountUnitsAndPointsAndRejectInvalidCounts() {
        var saved: ru.genesis.calendar.domain.habits.HabitAutoDeletePolicy?=null
        var valid=true
        compose.setContent { Frame { Column(Modifier.verticalScroll(rememberScrollState())) {
            var value by remember { mutableStateOf<ru.genesis.calendar.domain.habits.HabitAutoDeletePolicy?>(null) }
            HabitAutoDeleteFields(value,true,{ value=it;saved=it },{ valid=it })
        } } }
        compose.onNodeWithText("Автоудаление").performClick()
        compose.onNodeWithTag("habit-auto-delete-enabled").performClick()
        compose.onNodeWithTag("habit-auto-delete-count").performScrollTo().performTextReplacement("2")
        compose.onNodeWithTag("habit-auto-delete-weeks").performScrollTo().performClick()
        compose.onNodeWithTag("habit-auto-delete-remove").performScrollTo().performClick()
        compose.waitForIdle()
        assertEquals(2,saved!!.count);assertEquals("weeks",saved!!.unit);assertEquals("remove",saved!!.points);assertTrue(valid)
        compose.runOnUiThread { androidx.core.view.WindowCompat.getInsetsController(compose.activity.window, compose.activity.window.decorView).hide(androidx.core.view.WindowInsetsCompat.Type.ime()) }
        compose.waitForIdle()
        capture("habit-auto-delete")
        compose.onNodeWithTag("habit-auto-delete-count").performScrollTo().performTextReplacement("0")
        compose.waitUntil(5_000) { !valid }
        compose.onNodeWithText("Укажите целое число от 1 до 365.").assertExists()
        compose.onNodeWithTag("habit-auto-delete-enabled").performScrollTo().performClick()
        compose.waitUntil(5_000) { saved==null && valid }
    }

    @Test fun everyOlympianImageActuallyRendersFromThePackagedAsset() {
        compose.setContent { Frame { Column(Modifier.verticalScroll(rememberScrollState())) { OlympianIsopsephy {} } } }
        compose.onNodeWithTag("olympian-isopsephy-toggle").performClick()
        for (id in listOf("zeus", "hera", "poseidon", "demeter", "athena", "apollo", "artemis", "ares",
            "aphrodite", "hephaestus", "hermes", "hestia", "dionysus")) {
            compose.onNodeWithTag("olympian-$id").performScrollTo().assertIsDisplayed()
            compose.waitUntil(10_000) {
                runCatching {
                    val bitmap = compose.onNodeWithTag("olympian-symbol-$id", useUnmergedTree = true)
                        .captureToImage().asAndroidBitmap()
                    val colors = mutableSetOf<Int>()
                    for (y in 0 until bitmap.height step 4) for (x in 0 until bitmap.width step 4) colors += bitmap.getPixel(x, y)
                    colors.size > 8
                }.getOrDefault(false)
            }
        }
        compose.onNodeWithTag("olympian-zeus").performScrollTo()
        capture("olympian-images")
    }

    private class AdviceAccount(val limit: Int) {
        var count = 1
        var nextCalls = 0
        fun id(slot: Int) = "advice-" + ('a' + slot - 1).toString().repeat(24)
        fun card(slot: Int) = JSONObject().put("id", id(slot)).put("dayKey", "2026-10-31")
            .put("title", "Совет номер $slot").put("body", "Полный текст совета $slot.\nВторой абзац сохраняется.")
            .put("language", "ru").put("categories", JSONArray().put("aretology"))
            .put("sources", JSONArray()).put("dismissed", false).put("sequence", slot)
        fun response() = JSONObject().put("dayKey", "2026-10-31").put("state", "ready")
            .put("advice", card(count)).put("history", JSONArray((1..count).map(::card)))
            .put("sequence", count).put("dailyLimit", limit).put("canNext", count < limit)
        fun session() = object : DailyAdviceGateway {
            override suspend fun today(context: JSONObject) = response()
            override suspend fun next(context: JSONObject, id: String, day: String): JSONObject {
                assertEquals(this@AdviceAccount.id(count), id); assertEquals("2026-10-31", day)
                check(count < limit); nextCalls++; count++
                return response()
            }
            override suspend fun record(id: String, day: String, dismiss: Boolean) {
                assertTrue(id in (1..count).map(this@AdviceAccount::id)); assertEquals("2026-10-31", day)
                assertFalse(dismiss)
            }
        }
    }

    @Test fun threeAndFiveAdviceCardsRemainBrowsableBySwipeAndArrowsAfterTheLimitAndReopen() {
        var account by mutableStateOf(AdviceAccount(3))
        var session by mutableStateOf(account.session())
        var open by mutableStateOf(true)
        compose.setContent { Frame { Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            if (open) TodayAdvicePanel(session, "same-synthetic-account", "2026-10-31", "ru", AdvicePreferences(), emptyList())
        } } }
        fun page(tag: String, slot: Int) = compose.onNode(hasTestTag(tag) and
            hasAnyAncestor(hasTestTag("daily-advice-page-${account.id(slot)}")), useUnmergedTree = true)
        fun shown(slot: Int) {
            compose.waitUntil(10_000) { runCatching { compose.onNodeWithText("Совет номер $slot").isDisplayed() }.getOrDefault(false) }
        }
        for (limit in listOf(3, 5)) {
            if (limit != account.limit) compose.runOnIdle { open = false }
            if (limit != account.limit) compose.runOnIdle { account = AdviceAccount(limit); session = account.session(); open = true }
            shown(1)
            for (slot in 2..limit) {
                // Requesting a fresh card while browsing an earlier one still uses the latest server pointer.
                if (slot == 3) { compose.onNodeWithTag("daily-advice-history").performTouchInput { swipeRight() }; shown(1) }
                page("daily-advice-next", if (slot == 3) 1 else slot - 1).assertIsEnabled().performClick()
                shown(slot)
            }
            page("daily-advice-next", limit).assertIsNotEnabled()
            compose.onNodeWithTag("daily-advice-history").performTouchInput { swipeRight() }; shown(limit - 1)
            for (slot in limit - 1 downTo 2) { page("daily-advice-previous-saved", slot).performClick(); shown(slot - 1) }
            page("daily-advice-previous-saved", 1).assertIsNotEnabled()
            compose.onNodeWithTag("daily-advice-history").performTouchInput { swipeLeft() }; shown(2)
            for (slot in 2 until limit) { page("daily-advice-next-saved", slot).performClick(); shown(slot + 1) }
            assertEquals(limit, account.count); assertEquals(limit - 1, account.nextCalls)
            compose.runOnIdle { open = false }
            compose.runOnIdle { session = account.session(); open = true }
            shown(limit)
            page("daily-advice-previous-saved", limit).assertIsEnabled().performClick(); shown(limit - 1)
            assertEquals(limit, account.count); assertEquals(limit - 1, account.nextCalls)
            capture("advice-history-$limit")
        }
    }
}
