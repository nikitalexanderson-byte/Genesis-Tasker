package ru.genesis.calendar.ui

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import java.util.Locale

/** Injectable service boundary; tests exercise the real UI without recording private audio. */
internal interface VoiceRecognizer {
    fun listener(value: RecognitionListener)
    fun start(intent: Intent)
    fun stop()
    fun cancel()
    fun destroy()
}
internal fun interface VoiceRecognizerFactory { fun create(onDevice: Boolean): VoiceRecognizer? }

internal class AndroidVoiceRecognizerFactory(private val context: Context) : VoiceRecognizerFactory {
    override fun create(onDevice: Boolean): VoiceRecognizer? {
        val service = if (onDevice) {
            if (Build.VERSION.SDK_INT < 31 || !SpeechRecognizer.isOnDeviceRecognitionAvailable(context)) return null
            SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
        } else {
            if (!SpeechRecognizer.isRecognitionAvailable(context)) return null
            SpeechRecognizer.createSpeechRecognizer(context)
        }
        return object : VoiceRecognizer {
            override fun listener(value: RecognitionListener) = service.setRecognitionListener(value)
            override fun start(intent: Intent) = service.startListening(intent)
            override fun stop() = service.stopListening()
            override fun cancel() = service.cancel()
            override fun destroy() = service.destroy()
        }
    }
}

internal fun dictationLanguage(language: String, device: Locale = Locale.getDefault()): String {
    if (device.language == language && device.country.isNotBlank()) return device.toLanguageTag()
    val region = mapOf("ru" to "RU", "en" to "US", "el" to "GR", "de" to "DE", "fr" to "FR",
        "es" to "ES", "it" to "IT", "pt" to "PT", "pl" to "PL", "sr" to "RS", "uk" to "UA",
        "zh" to "CN", "tr" to "TR", "ja" to "JP")[language]
    return Locale.forLanguageTag(if (region == null) language else "$language-$region").toLanguageTag()
}

/** System recognition can download/use the requested language; offline recognition is a bounded fallback. */
@Composable internal fun VoiceSpeechInput(onTranscript: (String) -> Unit, onFinished: () -> Unit,
    onFailure: (String) -> Unit, factory: VoiceRecognizerFactory? = null,
    onPartialTranscript: ((String) -> Unit)? = null, onFinalTranscript: ((String) -> Unit)? = null) {
    val context = LocalContext.current
    val language = LocalGenesisLanguage.current
    val copy = release319Copy()
    val transcript by rememberUpdatedState(onTranscript)
    val preview by rememberUpdatedState(onPartialTranscript)
    val finalTranscript by rememberUpdatedState(onFinalTranscript)
    val finished by rememberUpdatedState(onFinished)
    val failure by rememberUpdatedState(onFailure)
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val engineFactory = remember(context, factory) { factory ?: AndroidVoiceRecognizerFactory(context) }
    val handler = remember { Handler(Looper.getMainLooper()) }
    var speech by remember { mutableStateOf<VoiceRecognizer?>(null) }
    var listening by remember { mutableStateOf(false) }
    var utteranceOpen by remember { mutableStateOf(false) }
    var finishing by remember { mutableStateOf(false) }
    var processing by remember { mutableStateOf(false) }
    var partial by remember { mutableStateOf("") }
    var generation by remember { mutableIntStateOf(0) }
    var onDevice by remember { mutableStateOf(false) }
    var fallbackUsed by remember { mutableStateOf(false) }
    var busyRetried by remember { mutableStateOf(false) }
    var silenceRetries by remember { mutableIntStateOf(0) }
    val intent = remember(language) { Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        putExtra(RecognizerIntent.EXTRA_LANGUAGE, dictationLanguage(language))
        putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
        putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        if (Build.VERSION.SDK_INT >= 33) {
            putExtra(RecognizerIntent.EXTRA_ENABLE_FORMATTING, RecognizerIntent.FORMATTING_OPTIMIZE_LATENCY)
        }
        // Do not force offline: a device service can exist without an offline model for this language.
    } }
    fun commitPartial() {
        val text = partial.trim()
        partial = ""
        preview?.invoke("")
        if (text.isNotBlank()) transcript(text)
    }
    fun fail(message: String) {
        listening = false
        utteranceOpen = false; finishing = false; processing = false
        generation++
        handler.removeCallbacksAndMessages(null)
        commitPartial()
        runCatching { speech?.cancel() }
        failure(message)
    }
    lateinit var listenerFor: (Int) -> RecognitionListener
    fun start() {
        if (!listening || finishing) return
        val currentGeneration = ++generation
        try {
            val recognizer = requireNotNull(speech)
            recognizer.listener(listenerFor(currentGeneration))
            utteranceOpen = true; processing = false
            recognizer.start(intent)
        }
        catch (_: SecurityException) { fail(copy.getString("micDenied")) }
        catch (_: Exception) { fail(copy.getString("speechUnavailable")) }
    }
    fun finish() {
        if (!listening) return
        listening = false
        utteranceOpen = false; finishing = false; processing = false
        generation++
        handler.removeCallbacksAndMessages(null)
        commitPartial()
        runCatching { speech?.cancel() }
        finished()
    }
    fun install(device: Boolean): Boolean {
        val recognizer = runCatching { engineFactory.create(device) }.getOrNull() ?: return false
        generation++
        utteranceOpen = false
        runCatching { speech?.cancel() }
        runCatching { speech?.destroy() }
        speech = recognizer
        onDevice = device
        return true
    }
    listenerFor = { currentGeneration -> object : RecognitionListener {
            private fun active() = listening && currentGeneration == generation
            override fun onReadyForSpeech(params: Bundle?) { if (active()) processing = false }
            override fun onBeginningOfSpeech() { if (active()) silenceRetries = 0 }
            override fun onRmsChanged(rmsdB: Float) = Unit
            override fun onBufferReceived(buffer: ByteArray?) = Unit
            override fun onEvent(eventType: Int, params: Bundle?) = Unit
            override fun onEndOfSpeech() { if (active()) processing = true }
            override fun onPartialResults(results: Bundle?) {
                if (!active()) return
                val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.trim().orEmpty()
                if (text.isNotBlank() && text != partial) { partial = text; preview?.invoke(text) }
            }
            override fun onResults(results: Bundle?) {
                if (!active()) return
                val recognized = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.trim().orEmpty()
                val text = recognized.ifBlank { partial.trim() }
                val nextGeneration = ++generation
                partial = ""; preview?.invoke("")
                utteranceOpen = false; processing = false
                if (text.isNotBlank()) { silenceRetries = 0; transcript(text) }
                if (recognized.isNotBlank()) finalTranscript?.invoke(recognized)
                if (finishing) finish()
                else handler.postDelayed({ if (listening && nextGeneration == generation && !finishing) start() }, 150)
            }
            override fun onError(error: Int) {
                if (!active()) return
                val nextGeneration = ++generation
                utteranceOpen = false; processing = false
                android.util.Log.w("GenesisSpeech", "Recognition failure: $error; onDevice=$onDevice")
                if (finishing) { finish(); return }
                commitPartial()
                if (error in setOf(SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT) && silenceRetries++ < 1) {
                    handler.postDelayed({ if (listening && nextGeneration == generation && !finishing) start() }, 150)
                    return
                }
                if (error in setOf(SpeechRecognizer.ERROR_RECOGNIZER_BUSY, SpeechRecognizer.ERROR_CLIENT) && !busyRetried) {
                    busyRetried = true
                    handler.postDelayed({ if (listening && nextGeneration == generation && !finishing) {
                        if (install(onDevice)) start() else fail(copy.getString("speechUnavailable"))
                    } }, 600)
                    return
                }
                if (error in setOf(SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT,
                        SpeechRecognizer.ERROR_SERVER, SpeechRecognizer.ERROR_SERVER_DISCONNECTED,
                        SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED, SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE) && !fallbackUsed) {
                    fallbackUsed = true
                    commitPartial()
                    if (install(!onDevice)) {
                        val installedGeneration = generation
                        handler.postDelayed({ if (listening && installedGeneration == generation && !finishing) start() }, 150)
                        return
                    }
                }
                fail(copy.getString(when (error) {
                    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "micDenied"
                    SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "speechNetwork"
                    SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED, SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE -> "speechLanguage"
                    SpeechRecognizer.ERROR_AUDIO -> "speechAudio"
                    SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "speechSilence"
                    else -> "speechError"
                }))
            }
        }
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted && speech != null) { listening = true; start() }
        else fail(copy.getString("micDenied"))
    }
    DisposableEffect(engineFactory, language, lifecycle) {
        // Samsung can advertise on-device recognition even when the selected language is not installed.
        if (!install(false)) { fallbackUsed = true; install(true) }
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP && listening) finish()
        }
        lifecycle.addObserver(observer)
        onDispose {
            listening = false
            generation++
            handler.removeCallbacksAndMessages(null)
            lifecycle.removeObserver(observer)
            runCatching { speech?.cancel() }
            runCatching { speech?.destroy() }
            speech = null
        }
    }
    LaunchedEffect(engineFactory, language) {
        if (speech == null) fail(copy.getString("speechUnavailable"))
        else if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            listening = true; start()
        } else permission.launch(Manifest.permission.RECORD_AUDIO)
    }
    Column(Modifier.fillMaxWidth().testTag("dream-voice-input")) {
        Button({
            finishing = true; processing = true
            handler.removeCallbacksAndMessages(null)
            val stoppedGeneration = generation
            if (!utteranceOpen) finish()
            else try { speech?.stop() } catch (_: Exception) { finish() }
            if (finishing && listening) handler.postDelayed({
                if (finishing && listening && stoppedGeneration == generation) finish()
            }, 3_000)
        }, Modifier.fillMaxWidth().testTag("dream-voice-finish"), enabled = listening && !finishing) {
            Text(copy.getString("voiceFinish"))
        }
        Text(copy.getString(if (processing) "voiceRecognizing" else "voiceListening"),
            style = MaterialTheme.typography.labelSmall)
        if (partial.isNotBlank() && preview == null) UntranslatedText(partial, maxLines = 3)
    }
}
