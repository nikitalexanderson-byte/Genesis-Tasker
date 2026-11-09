package ru.genesis.calendar.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.StoicheionGestureActivity

private class DictationRecognizer : VoiceRecognizer {
    lateinit var callback: RecognitionListener
    var starts = 0
    var lastIntent: Intent? = null
    var brokenStop = false
    override fun listener(value: RecognitionListener) { callback = value }
    override fun start(intent: Intent) { lastIntent = intent; starts++ }
    override fun stop() { if (brokenStop) error("isolated stop failure") }
    override fun cancel() = Unit
    override fun destroy() = Unit
    fun result(text: String, partial: Boolean = false) {
        val result = Bundle().apply { putStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION, arrayListOf(text)) }
        if (partial) callback.onPartialResults(result) else callback.onResults(result)
    }
}

class VoiceDictationTest {
    @get:Rule val compose = createAndroidComposeRule<StoicheionGestureActivity>()

    @Before fun grantOnlyTheIsolatedDebugPackageMicrophonePermission() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        check(context.packageName.endsWith(".debug"))
        // OEM devices may forbid the shell permission grant. Exercise the normal Android prompt;
        // the device operator grants it to this isolated test package without changing system policy.
        if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            compose.activity.runOnUiThread {
                compose.activity.requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 324)
            }
            val deadline = SystemClock.elapsedRealtime() + 45_000
            while (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED &&
                SystemClock.elapsedRealtime() < deadline) SystemClock.sleep(100)
        }
        assertEquals("Grant the normal microphone prompt only for the isolated QA package",
            PackageManager.PERMISSION_GRANTED, context.checkSelfPermission(Manifest.permission.RECORD_AUDIO))
    }

    @Test fun partialHypothesesAppearImmediatelyButOnlyFinalChunksAreCommittedOrSentForSpelling() {
        val recognizer = DictationRecognizer()
        var body by mutableStateOf("")
        var partial by mutableStateOf("")
        val spelling = mutableListOf<String>()
        var failure: String? = null
        compose.setContent { MaterialTheme { Column {
            UntranslatedText(appendDictationText(body, partial), Modifier.testTag("live-dictation-body"))
            VoiceSpeechInput({ body = appendDictationText(body, it) }, {}, { failure = it },
                VoiceRecognizerFactory { recognizer }, onPartialTranscript = { partial = it }, onFinalTranscript = spelling::add)
        } } }
        compose.waitUntil(5_000) { recognizer.starts == 1 }
        if (Build.VERSION.SDK_INT >= 33) assertEquals(RecognizerIntent.FORMATTING_OPTIMIZE_LATENCY,
            recognizer.lastIntent?.getStringExtra(RecognizerIntent.EXTRA_ENABLE_FORMATTING))
        compose.runOnIdle { recognizer.result("Я видел", partial = true) }
        compose.onNodeWithTag("live-dictation-body").assertTextEquals("Я видел")
        compose.runOnIdle { recognizer.result("Я видел море", partial = true) }
        compose.onNodeWithTag("live-dictation-body").assertTextEquals("Я видел море")
        assertEquals("", body); assertTrue(spelling.isEmpty())
        val previousListener = recognizer.callback
        compose.runOnIdle { recognizer.result("Я видел море.") }
        compose.waitUntil(5_000) { recognizer.starts == 2 }
        compose.runOnIdle {
            previousListener.onResults(Bundle().apply {
                putStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION, arrayListOf("Поздний дубликат"))
            })
            recognizer.result("Оно было тёплым.")
        }
        compose.onNodeWithTag("live-dictation-body").assertTextEquals("Я видел море. Оно было тёплым.")
        assertEquals(listOf("Я видел море.", "Оно было тёплым."), spelling)
        assertNull(failure)
    }

    @Test fun failedStopKeepsTheLastPartialOnceAndNeverTreatsItAsAProviderFinal() {
        val recognizer = DictationRecognizer().apply { brokenStop = true }
        val committed = mutableListOf<String>()
        val spelling = mutableListOf<String>()
        var finished = false
        compose.setContent { MaterialTheme {
            VoiceSpeechInput(committed::add, { finished = true }, {}, VoiceRecognizerFactory { recognizer },
                onFinalTranscript = spelling::add)
        } }
        compose.waitUntil(5_000) { recognizer.starts == 1 }
        compose.runOnIdle { recognizer.result("Последние слова", partial = true) }
        compose.onNodeWithTag("dream-voice-finish").performClick()
        assertTrue(finished)
        assertEquals(listOf("Последние слова"), committed)
        assertTrue(spelling.isEmpty())
        compose.runOnIdle { recognizer.result("Поздний окончательный ответ") }
        assertEquals(listOf("Последние слова"), committed)
    }
}
