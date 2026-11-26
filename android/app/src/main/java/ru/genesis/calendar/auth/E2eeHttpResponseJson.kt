package ru.genesis.calendar.auth

import org.json.JSONException
import org.json.JSONObject
import java.io.InputStream
import java.nio.ByteBuffer
import java.nio.CharBuffer
import java.nio.charset.CodingErrorAction

/** Wire-only policy, mirrored by app/e2ee/transport-json.ts. This is not the
 * private-file parser or an envelope authenticator. The caller closes input.
 * Owned byte/scratch buffers expire even on refusal; immutable JSON strings
 * and parsed objects cannot be zeroized and remain caller/runtime-owned. */
internal object E2eeHttpResponseJson {
    private class Invalid(val code: String = "E2EE_INVALID_RESPONSE") : Exception(code)
    private fun invalid(): Nothing = throw Invalid()
    private class Bytes(private val limit: Int) : AutoCloseable {
        var value = ByteArray(minOf(8192, limit)); private set
        var size = 0; private set
        fun append(input: ByteArray, count: Int) {
            if (count > limit - size) throw Invalid("E2EE_RESPONSE_TOO_LARGE")
            if (size + count > value.size) {
                val next = ByteArray(minOf(limit, maxOf(size + count, value.size * 2)))
                value.copyInto(next, 0, 0, size); value.fill(0); value = next
            }
            input.copyInto(value, size, 0, count); size += count
        }
        override fun close() { value.fill(0); size = 0 }
    }

    fun read(input: InputStream, path: String, status: Int, mime: String?, declared: Long,
        current: () -> Unit, observation: E2eeHttpBodyObservation? = null): JSONObject? {
        require(E2eeTransportProtocol.allowedRoute(if (path == "/e2ee/v1/status") "GET" else "POST", path))
        val success = status in 200..299
        val maximum = if (success) E2eeTransportProtocol.responseLimit(path) else 8192
        val chunk = ByteArray(8192)
        try {
            current()
            observation?.begin(E2eeHttpBodyObservation.Response(path, status, mime, declared.takeIf { it >= 0 }?.toString())); current()
            if (declared > maximum) throw Invalid("E2EE_RESPONSE_TOO_LARGE")
            if (!mime.orEmpty().substringBefore(';').trim().equals("application/json", true)) invalid()
            Bytes(maximum).use { bytes ->
                while (true) {
                    current(); val count = try { input.read(chunk) } catch (error: java.io.IOException) {
                        current(); if (success) throw error; return null
                    }
                    try {
                        current(); if (count == -1) break
                        if (count !in 1..chunk.size) invalid()
                        bytes.append(chunk, count)
                        if (observation != null) {
                            val loan = chunk.copyOf(count)
                            try { observation.append(loan); current() } finally { loan.fill(0) }
                        }
                    } finally { chunk.fill(0) }
                }
                observation?.finish(); current()
                // Validate without allocating a second whole-body CharBuffer.
                val decoder = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                val source = ByteBuffer.wrap(bytes.value, 0, bytes.size)
                val scratch = CharBuffer.allocate(4096)
                try {
                    while (true) {
                        current(); val result = decoder.decode(source, scratch, true)
                        scratch.array().fill('\u0000'); scratch.clear()
                        if (result.isError) invalid(); if (result.isUnderflow) break
                    }
                    val result = decoder.flush(scratch); if (result.isError || result.isOverflow) invalid()
                } finally { scratch.array().fill('\u0000') }
                current()
                // Match web TextDecoder's single initial UTF8 BOM, including
                // split reads. A second/out-of-position BOM fails JSON syntax.
                val start = if (bytes.size >= 3 && bytes.value[0] == 0xef.toByte() &&
                    bytes.value[1] == 0xbb.toByte() && bytes.value[2] == 0xbf.toByte()) 3 else 0
                val text = String(bytes.value, start, bytes.size - start, Charsets.UTF_8)
                bytes.close(); current(); validate(text, current); current()
                val payload = try { JSONObject(text) } catch (_: JSONException) { invalid() }
                current(); return payload
            }
        } catch (error: Invalid) {
            current(); if (success) throw AuthApiError(error.code); return null
        } finally { chunk.fill(0); observation?.close() }
    }

    private fun validate(text: String, current: () -> Unit) {
        var at = 0; var nodes = 0
        fun whitespace() { while (at < text.length && text[at] in " \t\r\n") at++ }
        fun string(name: Boolean): String {
            if (at == text.length || text[at++] != '"') invalid()
            val decoded = if (name) StringBuilder() else null; var length = 0
            while (at < text.length) {
                if (at % 4096 == 0) current()
                var char = text[at++]; if (char == '"') return decoded?.toString() ?: ""
                if (char.code < 32) invalid()
                if (char == '\\') {
                    if (at == text.length) invalid()
                    char = when (val escape = text[at++]) {
                        '"', '\\', '/' -> escape
                        'b' -> '\b'; 'f' -> '\u000c'; 'n' -> '\n'; 'r' -> '\r'; 't' -> '\t'
                        'u' -> {
                            if (at + 4 > text.length) invalid(); var code = 0
                            repeat(4) {
                                val digit = when (val hex = text[at++]) {
                                    in '0'..'9' -> hex.code - 48; in 'A'..'F' -> hex.code - 55; in 'a'..'f' -> hex.code - 87; else -> invalid()
                                }; code = (code shl 4) or digit
                            }; code.toChar()
                        }
                        else -> invalid()
                    }
                }
                if (name) { if (++length > 1024) invalid(); decoded!!.append(char) }
            }
            invalid()
        }
        fun number() {
            val start = at
            fun digit() = at < text.length && text[at] in '0'..'9'
            fun advance() { at++; if (at - start > 128) invalid() }
            if (at < text.length && text[at] == '-') advance()
            if (at < text.length && text[at] == '0') advance()
            else { if (!digit()) invalid(); while (digit()) advance() }
            if (at < text.length && text[at] == '.') { advance(); if (!digit()) invalid(); while (digit()) advance() }
            if (at < text.length && text[at] in "eE") {
                advance(); if (at < text.length && text[at] in "+-") advance()
                if (!digit()) invalid(); while (digit()) advance()
            }
            if (text.substring(start, at).toDoubleOrNull()?.isFinite() != true) invalid()
        }
        fun value(depth: Int) {
            if (depth > 40 || ++nodes > 250000) invalid(); current(); whitespace()
            if (at == text.length) invalid()
            when (text[at]) {
                '{' -> {
                    at++; whitespace(); val names = mutableSetOf<String>()
                    if (at < text.length && text[at] == '}') { at++; return }
                    while (true) {
                        whitespace(); val name = string(true); if (names.size >= 10000 || !names.add(name)) invalid()
                        whitespace(); if (at == text.length || text[at++] != ':') invalid(); value(depth + 1); whitespace()
                        if (at == text.length) invalid(); when (text[at++]) { '}' -> return; ',' -> Unit; else -> invalid() }
                    }
                }
                '[' -> {
                    at++; whitespace(); if (at < text.length && text[at] == ']') { at++; return }
                    while (true) { value(depth + 1); whitespace(); if (at == text.length) invalid(); when (text[at++]) { ']' -> return; ',' -> Unit; else -> invalid() } }
                }
                '"' -> { string(false); return }
                else -> {
                    for (literal in listOf("true", "false", "null")) if (text.startsWith(literal, at)) { at += literal.length; return }
                    number()
                }
            }
        }
        whitespace(); if (at == text.length || text[at] != '{') invalid()
        value(0); whitespace(); if (at != text.length) invalid()
    }
}
