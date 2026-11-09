package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.delay
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.StoicheionGestureActivity
import ru.genesis.calendar.auth.*
import java.io.File
import java.io.IOException
import java.util.concurrent.CopyOnWriteArrayList

class DailyAdviceUiTest {
    @get:Rule val compose = createAndroidComposeRule<StoicheionGestureActivity>()
    private val day = "2026-10-23"
    private val body = "Полный авторский текст совета.\nВторой абзац сохраняется без сокращения."
    private fun response(id: String, language: String = "ru", dismissed: Boolean = false) = JSONObject()
        .put("dayKey", day).put("state", "ready").put("advice", JSONObject().put("id", id).put("dayKey", day)
            .put("title", "Совет для " + id.takeLast(1)).put("body", body).put("language", language).put("dismissed", dismissed)
            .put("categories", JSONArray().put("aretology")).put("sources", JSONArray()))

    private inner class Fixture(val id: String = "advice-" + "a".repeat(24)) : DailyAdviceGateway {
        @Volatile var loads = 0
        @Volatile var loadFailure = false
        @Volatile var hideFailure = false
        @Volatile var hidden = false
        @Volatile var language = "ru"
        var serverDay = day
        var captured: JSONObject? = null
        val records = CopyOnWriteArrayList<Boolean>()
        override suspend fun today(context: JSONObject): JSONObject {
            loads++
            assertFalse(context.toString().contains("habit"))
            if (loadFailure) throw IOException("isolated test")
            return captured?.let { JSONObject(it.toString()) } ?: response(id, language, hidden).apply {
                put("dayKey", serverDay); getJSONObject("advice").put("dayKey", serverDay)
            }
        }
        override suspend fun record(id: String, day: String, dismiss: Boolean) {
            assertEquals(this.id, id); assertEquals(serverDay, day)
            records += dismiss
            if (dismiss && hideFailure) { hideFailure = false; throw IOException("isolated test") }
            if (dismiss) hidden = true
        }
    }

    private fun screen(gateway: Fixture, offscreen: Boolean = false) {
        compose.setContent { MaterialTheme(colorScheme = standart) {
            Surface { Column(Modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState())) {
                if (offscreen) Spacer(Modifier.height(1600.dp))
                TodayAdvicePanel(gateway, "alice", day, "ru", AdvicePreferences(), emptyList())
            } }
        } }
    }

    @Test fun adviceActionsStayInOneOrderedRowAndKeepTheirCallbacks() {
        var liked = ""; var next = 0; var diary = 0
        val card = DailyAdvice("advice-" + "a".repeat(24), day, "Смысл дня", "Полный текст совета", "ru",
            listOf("aretology"), null, false, emptyList())
        compose.setContent { MaterialTheme(colorScheme = standart, typography = GenesisTypography) {
            DailyAdviceCard(card, org.json.JSONObject(androidx.compose.ui.platform.LocalContext.current.assets.open("originals/i18n/daily-advice-copy.json").bufferedReader().use { it.readText() }).getJSONObject("ru"), null, false, false,
                rotation = DailyAdviceResponse(day, "ready", card, 2, 3, true), onNext = { next++ },
                onReaction = { liked = it }, onOpenDiary = { diary++ }, onDismiss = {})
        } }
        val tags = listOf("daily-advice-favorite", "daily-advice-dislike", "daily-advice-next", "daily-advice-diary")
        val bounds = tags.map { compose.onNodeWithTag(it).assertIsDisplayed().fetchSemanticsNode().boundsInRoot }
        assertTrue(bounds.zipWithNext().all { (a,b) -> a.left < b.left && kotlin.math.abs(a.top-b.top) < 1 })
        ru.genesis.calendar.captureNativeWindow(File(compose.activity.getExternalFilesDir(null), "review4-advice-actions.png"))
        compose.onNodeWithTag(tags[0]).performClick(); assertEquals("favorite", liked)
        compose.onNodeWithTag(tags[1]).performClick(); assertEquals("dislike", liked)
        compose.onNodeWithTag(tags[2]).performClick(); assertEquals(1, next)
        compose.onNodeWithTag(tags[3]).performClick(); assertEquals(1, diary)
    }

    @Test fun savedAdviceNavigationUsesTheCardWidthAndKeepsThePositionOnOneLine() {
        var dark by mutableStateOf(false)
        var previous = 0
        var next = 0
        val card = DailyAdvice("advice-" + "b".repeat(24), day, "Смысл дня", body, "ru",
            listOf("aretology"), null, false, emptyList())
        val copy = JSONObject(compose.activity.assets.open("originals/i18n/daily-advice-copy.json")
            .bufferedReader().use { it.readText() }).getJSONObject("ru")
        compose.setContent {
            CompositionLocalProvider(LocalEveningTheme provides dark, LocalGenesisLanguage provides "ru") {
                MaterialTheme(colorScheme = if (dark) evening else standart, typography = GenesisTypography) {
                    Surface { Column(Modifier.fillMaxSize().safeDrawingPadding().padding(16.dp)
                        .verticalScroll(rememberScrollState())) {
                        DailyAdviceCard(card, copy, null, false, false,
                            rotation = DailyAdviceResponse(day, "ready", card, 4, 6, false),
                            viewingSequence = 4, historyCount = 6,
                            onPreviousSaved = { previous++ }, onNextSaved = { next++ }, onDismiss = {})
                    } }
                }
            }
        }
        for (night in listOf(false, true)) {
            compose.runOnIdle { dark = night }
            compose.onNodeWithTag("daily-advice-position").performScrollTo().assertIsDisplayed()
            val results = mutableListOf<TextLayoutResult>()
            compose.onNodeWithTag("daily-advice-position").performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(results) }
            assertEquals(1, results.single().lineCount)
            assertFalse(results.single().hasVisualOverflow)
            assertTrue(results.single().layoutInput.text.text.contains("На сегодня"))
            val navigation = compose.onNodeWithTag("daily-advice-navigation").fetchSemanticsNode().boundsInRoot
            val text = compose.onNodeWithTag("daily-advice-body").fetchSemanticsNode().boundsInRoot
            assertTrue("Navigation is wider than the text column", navigation.width > text.width)
            for (tag in listOf("daily-advice-previous-saved", "daily-advice-next-saved")) {
                compose.onNodeWithTag(tag).assertWidthIsAtLeast(48.dp).assertHeightIsAtLeast(48.dp)
                    .performTouchInput { click(center) }
            }
            val scheme = if (night) "dark" else "light"
            ru.genesis.calendar.captureNativeWindow(File(compose.activity.getExternalFilesDir(null), "advice-navigation317-$scheme.png"))
        }
        assertEquals(2, previous)
        assertEquals(2, next)
    }

    @Test fun recordsOnlyVisibleAdviceAndRetriesDismissalWithoutDroppingTheText() {
        val fixture = Fixture(); fixture.hideFailure = true
        try {
        screen(fixture, offscreen = true)
        compose.waitUntil(5000) { fixture.loads > 0 }
        compose.runOnIdle { assertTrue(fixture.records.isEmpty()) }
        // Scroll the history viewport in the vertical parent. Scrolling its card
        // chooses HorizontalPager as the nearest scrollable and leaves it offscreen.
        compose.onNodeWithTag("daily-advice-history").performScrollTo()
        compose.onNodeWithTag("today-daily-advice").assertIsDisplayed()
        compose.waitUntil(5000) { fixture.records.contains(false) }
        compose.onNodeWithTag("daily-advice-body").assertTextEquals(body)
        compose.onNodeWithTag("daily-advice-dismiss").performClick()
        compose.waitUntil(5000) { fixture.records.count { it } == 1 }
        compose.onNodeWithTag("daily-advice-hide-error").assertExists()
        compose.onNodeWithTag("daily-advice-body").assertTextEquals(body)
        compose.onNodeWithTag("daily-advice-dismiss").performClick()
        compose.waitUntil(5000) { fixture.hidden }
        compose.onNodeWithTag("today-daily-advice").assertDoesNotExist()
        assertEquals(1, fixture.records.count { !it })
        } catch (failure: Throwable) {
            val app = compose.activity.application as ru.genesis.calendar.GenesisApplication
            val directory = app.getExternalFilesDir(null) ?: app.cacheDir
            runCatching {
                val bounds = compose.onAllNodesWithTag("today-daily-advice").fetchSemanticsNodes()
                    .map { it.boundsInRoot.toString() }
                File(directory, "advice-visible-recording-failure.txt").writeText(
                    "loads=" + fixture.loads + " records=" + fixture.records.toList() +
                        " hidden=" + fixture.hidden + " lifecycle=" + compose.activity.lifecycle.currentState +
                        " bounds=" + bounds + "\n" + compose.onRoot(useUnmergedTree = true).printToString())
            }.exceptionOrNull()?.let(failure::addSuppressed)
            if (app.getSystemService(android.app.KeyguardManager::class.java)?.isKeyguardLocked == false) runCatching {
                ru.genesis.calendar.captureNativeWindow(File(directory, "advice-visible-recording-failure.png"))
            }.exceptionOrNull()?.let(failure::addSuppressed)
            throw failure
        }
    }

    @Test fun loadFailureHasAnExplicitRetryAndDisabledAdviceMakesNoRequest() {
        val fixture = Fixture(); fixture.loadFailure = true
        screen(fixture)
        compose.onNodeWithTag("daily-advice-load-error").waitUntilVisible()
        compose.runOnIdle { fixture.loadFailure = false }
        compose.onNodeWithContentDescription("Обновить").performClick()
        compose.onNodeWithTag("daily-advice-body").waitUntilVisible()
        compose.onNodeWithTag("daily-advice-body").assertTextEquals(body)
    }

    @Test fun changingAccountOrLanguageCannotShowThePreviousAdvice() {
        val first = Fixture(); val next = Fixture("advice-" + "b".repeat(24))
        var uid by mutableStateOf("alice")
        var language by mutableStateOf("ru")
        compose.setContent { MaterialTheme(colorScheme = standart) { Surface {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                TodayAdvicePanel(if (uid == "alice") first else next, uid, day, language, AdvicePreferences(), emptyList())
            }
        } } }
        compose.onNodeWithText("Совет для a").waitUntilVisible()
        compose.runOnIdle { uid = "bob" }
        compose.onNodeWithText("Совет для b").waitUntilVisible()
        compose.onNodeWithText("Совет для a").assertDoesNotExist()
        compose.runOnIdle { next.language = "ja"; language = "ja" }
        compose.onNodeWithTag("today-daily-advice").waitUntilVisible()
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val japanese = context.assets.open("originals/i18n/daily-advice-copy.json").bufferedReader().use {
            JSONObject(it.readText()).getJSONObject("ja")
        }
        compose.onNodeWithContentDescription(japanese.getString("hide")).assertExists()
    }

    @Test fun settingsKeepFalseAndManualCategoriesAndExplainAFailedSave() {
        val patches = CopyOnWriteArrayList<String>()
        var fail = true
        var saved = AdvicePreferences()
        compose.setContent { MaterialTheme(colorScheme = standart) { Surface {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                DailyAdviceSettings(saved, listOf("aretology"), true, "ru", true) { patch ->
                    patches += patch.toString()
                    if (fail) { fail = false; throw IOException("isolated test") }
                    saved = AdvicePreferences.fromJson(JSONObject(saved.toJson().toString()).apply {
                        patch.keys().forEach { key -> put(key, patch.get(key)) }
                    })
                    saved
                }
            }
        } } }
        compose.onNodeWithTag("advice-smart").performScrollTo().performClick()
        compose.onNodeWithTag("daily-advice-settings-error").assertExists()
        compose.onNodeWithTag("advice-smart").assertIsOn()
        compose.onNodeWithTag("advice-smart").performScrollTo().performClick()
        compose.onNodeWithTag("advice-smart").assertIsOff()
        compose.onNodeWithTag("advice-category-aretology").assertIsOn().assertIsNotEnabled()
        compose.onNodeWithTag("advice-category-hermetica").assertIsOff().assertIsNotEnabled()
        assertEquals(patches[0], patches[1])
        compose.onNodeWithTag("advice-enabled").performScrollTo().performClick()
        compose.onNodeWithTag("advice-enabled").assertIsOff()
        assertFalse(saved.enabled); assertFalse(saved.smart); assertEquals(listOf("aretology"), saved.categories)
    }

    @Test fun disabledAdviceDoesNotReserveOrRecordAPost() {
        val fixture = Fixture()
        compose.setContent { MaterialTheme { TodayAdvicePanel(fixture, "alice", day, "ru",
            AdvicePreferences(enabled = false), emptyList()) } }
        compose.runOnIdle { assertEquals(0, fixture.loads); assertTrue(fixture.records.isEmpty()) }
    }

    @Test fun serverPublicationDayCanDifferFromTheDeviceWithoutHidingAdvice() {
        val fixture = Fixture().also { it.serverDay = "2026-10-24" }
        screen(fixture)
        compose.onNodeWithTag("daily-advice-body").waitUntilVisible()
        compose.waitUntil(5000) { fixture.records.contains(false) }
        compose.onNodeWithTag("daily-advice-dismiss").performClick()
        compose.waitUntil(5000) { fixture.hidden }
    }

    @Test fun captureNativeAdviceAndSettings() {
        val arguments = InstrumentationRegistry.getArguments()
        org.junit.Assume.assumeTrue(arguments.getString("genesisAdviceCapture") == "true")
        val language = arguments.getString("genesisCaptureLanguage") ?: "ru"
        val dark = arguments.getString("genesisCaptureDark") == "true"
        val payload = arguments.getString("genesisAdviceCapturePayload")?.let {
            JSONObject(String(android.util.Base64.decode(it, android.util.Base64.DEFAULT), Charsets.UTF_8))
        }
        val fixture = Fixture(payload?.getJSONObject("advice")?.getString("id") ?: "advice-" + "a".repeat(24))
            .also { it.language = language; it.captured = payload }
        compose.setContent { CompositionLocalProvider(LocalGenesisLanguage provides language, LocalEveningTheme provides dark) {
            MaterialTheme(colorScheme = if (dark) evening else standart) { Surface {
                Column(Modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    TodayAdvicePanel(fixture, "capture", day, language, AdvicePreferences(), emptyList())
                    DailyAdviceSettings(AdvicePreferences(smart = false), listOf("aretology"), true, language, true) { AdvicePreferences(smart = false) }
                }
            } }
        } }
        compose.onNodeWithTag("daily-advice-body").waitUntilVisible()
        if (payload?.getJSONObject("advice")?.optString("image")?.isNotBlank() == true) {
            compose.waitUntil(15_000) { compose.onAllNodesWithTag("daily-advice-art").fetchSemanticsNodes().isNotEmpty() }
        }
        val target = InstrumentationRegistry.getInstrumentation().targetContext
        compose.onRoot().captureToImage().asAndroidBitmap().let { bitmap ->
            File(target.cacheDir, "daily-advice-capture.png").outputStream().use {
                assertTrue(bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it))
            }
        }
        compose.onNodeWithTag("daily-advice-settings").performScrollTo()
        compose.onRoot().captureToImage().asAndroidBitmap().let { bitmap ->
            File(target.cacheDir, "daily-advice-settings-capture.png").outputStream().use {
                assertTrue(bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it))
            }
        }
    }

    private fun SemanticsNodeInteraction.waitUntilVisible() {
        compose.waitUntil(5000) { runCatching { assertIsDisplayed(); true }.getOrDefault(false) }
    }
}
