package ru.genesis.calendar.ui

import android.Manifest
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Before
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.StoicheionGestureActivity
import ru.genesis.calendar.captureNativeWindow
import java.io.File
import org.json.JSONArray
import org.json.JSONObject

private class FakeVoiceRecognizer : VoiceRecognizer {
    lateinit var callback: RecognitionListener
    var starts = 0
    var destroyed = false
    var lastIntent: Intent? = null
    override fun listener(value: RecognitionListener) { callback = value }
    override fun start(intent: Intent) { starts++; lastIntent = intent }
    override fun stop() = Unit
    override fun cancel() = Unit
    override fun destroy() { destroyed = true }
    fun result(text: String, partial: Boolean = false) {
        val value = Bundle().apply { putStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION, arrayListOf(text)) }
        if (partial) callback.onPartialResults(value) else callback.onResults(value)
    }
}

class Release320RecoveryTest {
    @get:Rule val compose = createAndroidComposeRule<StoicheionGestureActivity>()
    @Before fun grantMicrophoneToIsolatedTestPackage() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        check(context.packageName.endsWith(".qa320.debug"))
        instrumentation.uiAutomation.grantRuntimePermission(context.packageName, Manifest.permission.RECORD_AUDIO)
    }

    @Test fun deviceSpeechLanguageSupportIsReportedWithoutStartingTheMicrophone() {
        if (android.os.Build.VERSION.SDK_INT < 33) return
        val report = JSONObject()
        val instrumentation = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
        for (offline in listOf(false, true)) {
            val done = java.util.concurrent.CountDownLatch(1)
            var service: SpeechRecognizer? = null
            val row = JSONObject().put("onDevice", offline)
            instrumentation.runOnMainSync {
                val available = if (offline) SpeechRecognizer.isOnDeviceRecognitionAvailable(compose.activity)
                    else SpeechRecognizer.isRecognitionAvailable(compose.activity)
                row.put("available", available)
                if (!available) done.countDown()
                else {
                    service = if (offline) SpeechRecognizer.createOnDeviceSpeechRecognizer(compose.activity) else SpeechRecognizer.createSpeechRecognizer(compose.activity)
                    val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                        .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                        .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ru-RU")
                    service!!.checkRecognitionSupport(intent, compose.activity.mainExecutor, object : android.speech.RecognitionSupportCallback {
                        override fun onSupportResult(value: android.speech.RecognitionSupport) {
                            row.put("installedOnDevice", JSONArray(value.installedOnDeviceLanguages))
                                .put("supportedOnDevice", JSONArray(value.supportedOnDeviceLanguages)).put("online", JSONArray(value.onlineLanguages))
                            done.countDown()
                        }
                        override fun onError(errorCode: Int) { row.put("supportError", errorCode); done.countDown() }
                    })
                }
            }
            row.put("answered", done.await(8, java.util.concurrent.TimeUnit.SECONDS))
            instrumentation.runOnMainSync { service?.destroy() }
            report.put(if (offline) "device" else "system", row)
        }
        File(compose.activity.getExternalFilesDir(null), "release320-speech-support.json").writeText(report.toString(2))
    }

    @Test fun adminCanGrantAndRevokeForecastsAndTheMainListImmediatelyShowsElitePlus() {
        var dark by mutableStateOf(true)
        var palette by mutableStateOf("blue")
        val user = JSONObject().put("id", "synthetic-forecast-user").put("email", "forecast@example.invalid")
            .put("displayName", "Тестовый пользователь").put("subscriptionPlan", "free").put("isAdmin", false)
            .put("forecastElitePlus", false).put("forecastPrivilegeRevision", 0)
        val calls = mutableListOf<Pair<Boolean, Int>>()
        val gateway = object : ru.genesis.calendar.auth.AdminGateway {
            override fun check() = Unit
            override suspend fun ads() = JSONObject().put("ads", JSONArray())
            override suspend fun saveAd(id: String?, body: JSONObject): JSONObject = error("No ads")
            override suspend fun deleteAd(id: String): JSONObject = error("No deletion")
            override suspend fun subscription(userId: String, plan: String, expectedPlan: String): JSONObject = error("No subscription change")
            override suspend fun forecastPrivilege(userId: String, enabled: Boolean, expectedRevision: Int): JSONObject {
                assertEquals(user.getString("id"), userId)
                assertEquals(user.getInt("forecastPrivilegeRevision"), expectedRevision)
                calls += enabled to expectedRevision
                user.put("forecastElitePlus", enabled).put("forecastPrivilegeRevision", expectedRevision + 1)
                return JSONObject().put("userId", userId).put("forecastElitePlus", enabled).put("forecastPrivilegeRevision", expectedRevision + 1)
            }
        }
        compose.setContent { CompositionLocalProvider(LocalGenesisLanguage provides "ru", LocalEveningTheme provides dark) {
            MaterialTheme(colorScheme = if (dark) eveningPalette(palette) else standart, typography = GenesisTypography) {
                NativeAdminPanel({}, { JSONObject().put("users", JSONArray().put(user)) }, { _, _ -> error("No deletion") }, gateway)
            }
        } }
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("admin-forecast-tab").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("admin-forecast-tab").performScrollTo().performClick()
        compose.onNodeWithTag("admin-forecast-synthetic-forecast-user").performScrollTo().performClick()
        compose.waitUntil(5_000) { calls.size == 1 }
        compose.onNodeWithText("Пользователи").performClick()
        compose.onNodeWithText("Elite+").performScrollTo().assertIsDisplayed()
        assertEquals("free", user.getString("subscriptionPlan"))
        compose.onNodeWithTag("admin-forecast-tab").performScrollTo().performClick()
        for ((night, color) in listOf(false to "green", true to "green", true to "burgundy", true to "blue", true to "violet")) {
            compose.runOnIdle { dark = night; palette = color }
            compose.onNodeWithTag("admin-forecast-synthetic-forecast-user").assertIsDisplayed()
            captureNativeWindow(File(compose.activity.getExternalFilesDir(null), "release320-admin-elite-plus-$night-$color.png"))
        }
        compose.onNodeWithTag("admin-forecast-synthetic-forecast-user").performScrollTo().performClick()
        compose.waitUntil(5_000) { calls.size == 2 }
        assertEquals(listOf(true to 0, false to 1), calls)
        compose.onNodeWithText("Пользователи").performClick()
        compose.onNodeWithText("Elite+").assertDoesNotExist()
    }

    @Test fun androidJsonNullDoesNotBecomeAnInvalidLiteralTimerEpochDuringAccountMerge() {
        val old = ru.genesis.calendar.auth.WorkspacePatch.emptyDocument().put("habitTimerEpoch", org.json.JSONObject.NULL)
        val local = org.json.JSONObject(old.toString())
        val remote = org.json.JSONObject(old.toString())
        val result = ru.genesis.calendar.auth.WorkspacePatch.apply(old, local, remote, emptySet(), 1L,
            "2026-11-05T00:00:00Z", "synthetic-device").document
        assertEquals("", result.getString("habitTimerEpoch"))
        assertEquals("", ru.genesis.calendar.data.HabitTimerCodec.epoch(old, "habitTimerEpoch"))
        // Only actual JSON null is compatible. Corrupt non-null values must still fail closed.
        for (invalid in listOf<Any>("null", false, 42)) {
            try {
                ru.genesis.calendar.data.HabitTimerCodec.epoch(org.json.JSONObject().put("habitTimerEpoch", invalid), "habitTimerEpoch")
                fail("Invalid timer epoch was accepted")
            } catch (_: IllegalArgumentException) { }
        }
    }

    @Test fun systemRecognitionDoesNotForceOfflineAndFinishIgnoresLateCallbacks() {
        val system = FakeVoiceRecognizer()
        val selections = mutableListOf<Boolean>()
        val chunks = mutableListOf<String>()
        var finished = false
        var failure: String? = null
        val factory = VoiceRecognizerFactory { offline -> selections += offline; system }
        compose.setContent { MaterialTheme { VoiceSpeechInput(chunks::add, { finished = true }, { failure = it }, factory) } }
        compose.waitUntil(5_000) { system.starts == 1 }
        assertEquals(listOf(false), selections)
        assertEquals("ru-RU", system.lastIntent!!.getStringExtra(RecognizerIntent.EXTRA_LANGUAGE))
        assertFalse(system.lastIntent!!.getBooleanExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, false))
        compose.runOnIdle { system.result("Я видел море", partial = true) }
        compose.onNodeWithTag("dream-voice-finish").performClick()
        compose.runOnIdle { system.result("Я видел море") }
        assertTrue(finished)
        assertEquals(listOf("Я видел море"), chunks)
        compose.runOnIdle { system.result("Поздний дубликат"); system.callback.onError(SpeechRecognizer.ERROR_CLIENT) }
        assertEquals(listOf("Я видел море"), chunks)
        assertNull(failure)
    }

    @Test fun languageFailureTriesTheOtherServiceAndPreservesRecognizedText() {
        val system = FakeVoiceRecognizer()
        val device = FakeVoiceRecognizer()
        val chunks = mutableListOf<String>()
        var failure: String? = null
        val factory = VoiceRecognizerFactory { offline -> if (offline) device else system }
        compose.setContent { MaterialTheme { VoiceSpeechInput(chunks::add, {}, { failure = it }, factory) } }
        compose.waitUntil(5_000) { system.starts == 1 }
        compose.runOnIdle { system.result("Начало сна", partial = true); system.callback.onError(SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE) }
        compose.waitUntil(5_000) { device.starts == 1 }
        assertTrue(system.destroyed)
        compose.runOnIdle { device.result("Продолжение сна") }
        assertEquals(listOf("Начало сна", "Продолжение сна"), chunks)
        assertNull(failure)
        compose.runOnIdle { system.callback.onError(SpeechRecognizer.ERROR_NETWORK) }
        assertNull(failure)
        compose.onNodeWithTag("dream-voice-input").assertExists()
    }

    @Test fun unavailableLanguageIsExplainedAndFailureDoesNotDiscardThePartialTranscript() {
        val system = FakeVoiceRecognizer()
        val chunks = mutableListOf<String>()
        var failure: String? = null
        val factory = VoiceRecognizerFactory { offline -> if (offline) null else system }
        compose.setContent { MaterialTheme { VoiceSpeechInput(chunks::add, {}, { failure = it }, factory) } }
        compose.waitUntil(5_000) { system.starts == 1 }
        compose.runOnIdle { system.result("Сохранённые слова", partial = true); system.callback.onError(SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE) }
        assertEquals(listOf("Сохранённые слова"), chunks)
        assertTrue(failure!!.startsWith("Язык диктовки недоступен."))
    }

    @Test fun boardPaletteHasNoHexAndOnlyApplyChangesTheStoredColor() {
        var selected by mutableStateOf("#2D6C68")
        var dark by mutableStateOf(false)
        compose.setContent { CompositionLocalProvider(LocalEveningTheme provides dark, LocalGenesisLanguage provides "ru") {
            MaterialTheme(colorScheme = if (dark) eveningPalette("blue") else standart, typography = GenesisTypography) {
                Column { CategoryColorPicker(selected) { selected = it } }
            }
        } }
        for (night in listOf(false, true)) {
            compose.runOnIdle { dark = night }
            compose.onNodeWithTag("category-color-open").performClick()
            compose.onNodeWithTag("category-color-picker").assertIsDisplayed()
            compose.onNode(hasText("HEX", substring = true)).assertDoesNotExist()
            compose.onNodeWithTag("category-swatch-#8666a8").performScrollTo().performClick()
            compose.onNodeWithText("Отмена").performClick()
            assertEquals("#2D6C68", selected)
            compose.onNodeWithTag("category-color-open").performClick()
            compose.onNodeWithTag("category-color-picker").assertIsDisplayed()
            compose.waitForIdle()
            captureNativeWindow(File(compose.activity.getExternalFilesDir(null), "release320-palette-$night.png"))
            compose.onNodeWithTag("category-swatch-#8666a8").performScrollTo().performClick()
            compose.onNodeWithTag("category-color-apply").performClick()
            assertEquals("#8666a8", selected)
            compose.runOnIdle { selected = "#2D6C68" }
        }
    }

    // The former static goal list is now covered by AuroraNativeTest using the
    // real source draw and the separate secondary circle.
}
