package ru.genesis.calendar.security

import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.util.regex.Pattern

/** Small private-file JSON only. Lex before JSONObject so platform leniency,
 * duplicate projection, invalid UTF8 and deep structures cannot reach IO. */
internal object E2eeFileManifestJson {
    private val number = Pattern.compile("-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?")
    private fun invalid(): Nothing = throw IllegalStateException("E2EE_CORRUPT_FILE")
    fun read(bytes: ByteArray): JSONObject {
        if (bytes.size !in 1..256 * 1024) invalid()
        try {
            val text = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString()
            var at = 0; var nodes = 0; val matcher = number.matcher(text)
            fun whitespace() { while (at < text.length && text[at] in " \t\r\n") at++ }
            fun string(name: Boolean): String {
                if (at >= text.length || text[at++] != '"') invalid()
                val decoded = if (name) StringBuilder() else null; var length = 0
                while (at < text.length) {
                    var char = text[at++]; if (char == '"') return decoded?.toString() ?: ""
                    if (char.code < 32) invalid()
                    if (char == '\\') {
                        if (at == text.length) invalid()
                        char = when (val escape = text[at++]) {
                            '"', '\\', '/' -> escape
                            'b' -> '\b'; 'f' -> '\u000c'; 'n' -> '\n'; 'r' -> '\r'; 't' -> '\t'
                            'u' -> {
                                if (at + 4 > text.length) invalid(); var value = 0
                                repeat(4) { val digit = when (val hex = text[at++]) {
                                    in '0'..'9' -> hex.code - '0'.code; in 'a'..'f' -> hex.code - 'a'.code + 10; in 'A'..'F' -> hex.code - 'A'.code + 10; else -> invalid()
                                }; value = (value shl 4) or digit }
                                value.toChar()
                            }
                            else -> invalid()
                        }
                    }
                    if (++length > (if (name) 64 else 512)) invalid(); decoded?.append(char)
                }
                invalid()
            }
            fun value(depth: Int) {
                if (depth > 16 || ++nodes > 10000) invalid(); whitespace(); if (at == text.length) invalid()
                when (text[at]) {
                    '{' -> {
                        at++; whitespace(); val names = mutableSetOf<String>()
                        if (at < text.length && text[at] == '}') { at++; return }
                        while (true) {
                            whitespace(); val name = string(true); if (names.size >= 128 || !names.add(name)) invalid()
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
                        if (!matcher.region(at, text.length).lookingAt() || matcher.end() - at > 32) invalid(); at = matcher.end()
                    }
                }
            }
            value(0); whitespace(); if (at != text.length) invalid()
            return JSONObject(text)
        } catch (_: Exception) { invalid() }
    }
}
