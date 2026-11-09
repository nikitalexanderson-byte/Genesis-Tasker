package ru.genesis.calendar.ui

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeout
import org.json.JSONArray
import java.io.ByteArrayOutputStream
import java.net.URL
import java.net.URLEncoder
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.util.Locale
import java.util.concurrent.atomic.AtomicReference
import javax.net.ssl.HttpsURLConnection
import kotlin.coroutines.coroutineContext
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

internal val dictationSpellerLanguages = setOf("ru", "en", "uk")
internal const val dictationSpellerCreditUrl = "https://yandex.ru/dev/speller/"

/** Explicit opt-in only. This free public endpoint receives one new final phrase, never a stored note or audio. */
internal suspend fun correctDictatedPhrase(text: String, language: String): String {
    require(language in dictationSpellerLanguages && text.isNotBlank() && text.length <= 4_000)
    return withTimeout(2_500) {
        coroutineScope {
            suspendCancellableCoroutine { continuation ->
                val connectionRef = AtomicReference<HttpsURLConnection?>()
                val task = launch(Dispatchers.IO) {
                    var connection: HttpsURLConnection? = null
                    try {
                        coroutineContext.ensureActive()
                        connection = URL("https://speller.yandex.net/services/spellservice.json/checkText")
                            .openConnection() as HttpsURLConnection
                        connectionRef.set(connection)
                        coroutineContext.ensureActive()
                        // Separate from the GENESIS transport: no session, cookies, account IDs or logging.
                        connection.instanceFollowRedirects = false
                        connection.connectTimeout = 2_500; connection.readTimeout = 2_500
                        connection.useCaches = false; connection.requestMethod = "POST"
                        connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
                        connection.setRequestProperty("Accept", "application/json")
                        connection.setRequestProperty("Cache-Control", "no-store")
                        connection.doOutput = true
                        val bytes = ("text=" + URLEncoder.encode(text, "UTF-8") + "&lang=" + language + "&options=6&format=plain")
                            .toByteArray(Charsets.UTF_8)
                        connection.setFixedLengthStreamingMode(bytes.size)
                        connection.outputStream.use { it.write(bytes) }
                        check(connection.responseCode == 200)
                        check(connection.contentLengthLong <= 65_536)
                        val output = ByteArrayOutputStream()
                        connection.inputStream.use { input ->
                            val buffer = ByteArray(8_192)
                            while (true) {
                                coroutineContext.ensureActive()
                                val count = input.read(buffer)
                                if (count < 0) break
                                check(output.size() + count <= 65_536)
                                output.write(buffer, 0, count)
                            }
                        }
                        val json = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                            .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(output.toByteArray())).toString()
                        val corrected = applyDictationSpelling(text, JSONArray(json), language)
                        if (continuation.isActive) continuation.resume(corrected)
                    } catch (failure: Exception) {
                        if (continuation.isActive) continuation.resumeWithException(failure)
                    } finally { runCatching { connection?.disconnect() } }
                }
                continuation.invokeOnCancellation { runCatching { connectionRef.get()?.disconnect() }; task.cancel() }
            }
        }
    }
}

/** Verify every source span before applying suggestions; repetition and grammar are left to the author. */
internal fun applyDictationSpelling(text: String, response: JSONArray, language: String = "ru"): String {
    require(response.length() <= 512 && language in dictationSpellerLanguages)
    data class Correction(val start: Int, val end: Int, val value: String)
    val ranges = mutableListOf<Pair<Int, Int>>()
    val corrections = (0 until response.length()).mapNotNull { index ->
        val error = response.getJSONObject(index)
        val code = error.get("code") as? Int ?: kotlin.error("SPELLING_REPLY_INVALID")
        require(code in setOf(1, 2, 3))
        val suggestions = error.getJSONArray("s")
        require(suggestions.length() <= 32)
        val values = (0 until suggestions.length()).map { suggestions.get(it) as? String ?: kotlin.error("SPELLING_REPLY_INVALID") }
        val start = error.get("pos") as? Int ?: kotlin.error("SPELLING_REPLY_INVALID")
        val length = error.get("len") as? Int ?: kotlin.error("SPELLING_REPLY_INVALID")
        require(start >= 0 && length > 0 && start <= text.length - length)
        val word = error.get("word") as? String ?: kotlin.error("SPELLING_REPLY_INVALID")
        require(text.substring(start, start + length) == word)
        val end = start + length
        require(start == 0 || !Character.isLetter(text.codePointBefore(start)))
        require(end == text.length || !Character.isLetter(text.codePointAt(end)))
        ranges += start to end
        if (code == 2 || dictationIdentifierAt(text, start, end)) return@mapNotNull null
        val candidates = values.filter { plausibleDictationSuggestion(word, it, language) }.distinct()
        if (candidates.size != 1 || candidates.single() == word) return@mapNotNull null
        Correction(start, end, candidates.single())
    }.sortedBy { it.start }
    var end = 0
    for (range in ranges.sortedBy { it.first }) { require(range.first >= end); end = range.second }
    return StringBuilder(text).apply {
        for (correction in corrections.asReversed()) replace(correction.start, correction.end, correction.value)
    }.toString()
}

private fun dictationIdentifierAt(text: String, start: Int, end: Int): Boolean {
    var left = start; var right = end
    while (left > 0 && !text[left - 1].isWhitespace()) left--
    while (right < text.length && !text[right].isWhitespace()) right++
    val token = text.substring(left, right).trim { it in "\"'«»“”‘’()[]{}.,;:!?…" }
    val word = text.substring(start, end)
    return token.any { it.isDigit() || it in "@/_=" } ||
        Regex("\\p{L}[.:]\\p{L}").containsMatchIn(token) ||
        word.drop(1).any { it.isUpperCase() } && !word.all { it.isUpperCase() }
}

/** Match the web guard: a single nearby spelling suggestion, never a multiword or ambiguous rewrite. */
private fun plausibleDictationSuggestion(word: String, suggestion: String, language: String): Boolean {
    if (word.isEmpty() || suggestion.isEmpty() || word.length > 80 || suggestion.length > 80 ||
        !word.all { it.isLetter() } || !suggestion.all { it.isLetter() }) return false
    val scripts = (word + suggestion).map { Character.UnicodeScript.of(it.code) }.toSet()
    if (scripts.size != 1 || scripts.single() !in setOf(Character.UnicodeScript.LATIN, Character.UnicodeScript.CYRILLIC)) return false
    val source = word.lowercase(Locale.forLanguageTag(language))
    val target = suggestion.lowercase(Locale.forLanguageTag(language))
    val limit = minOf(2, maxOf(1, maxOf(source.length, target.length) / 4))
    if (kotlin.math.abs(source.length - target.length) > limit) return false
    val distance = Array(source.length + 1) { IntArray(target.length + 1) }
    for (i in 0..source.length) distance[i][0] = i
    for (j in 0..target.length) distance[0][j] = j
    for (i in 1..source.length) for (j in 1..target.length) {
        distance[i][j] = minOf(distance[i - 1][j] + 1, distance[i][j - 1] + 1,
            distance[i - 1][j - 1] + if (source[i - 1] == target[j - 1]) 0 else 1)
        if (i > 1 && j > 1 && source[i - 1] == target[j - 2] && source[i - 2] == target[j - 1])
            distance[i][j] = minOf(distance[i][j], distance[i - 2][j - 2] + 1)
    }
    return distance[source.length][target.length] <= limit
}
