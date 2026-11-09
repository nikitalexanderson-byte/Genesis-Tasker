package ru.genesis.calendar.auth

import java.io.FilterInputStream
import java.io.FilterReader
import java.io.InputStream
import java.io.Reader

/** Bounds the wire envelope and each JSON token before the platform parser allocates it. */
internal class DataExportInput(input: InputStream, private val limit: Long = DataExportProtocol.ENVELOPE_LIMIT) : FilterInputStream(input) {
    private var size = 0L
    private fun count(value: Int): Int {
        if (value > 0) { size += value; if (size > limit) throw AuthFailure(AuthFailure.Kind.PROTOCOL) }
        return value
    }
    override fun read(): Int = super.read().also { if (it >= 0) count(1) }
    override fun read(buffer: ByteArray, offset: Int, length: Int): Int = count(`in`.read(buffer, offset, length))
}

internal class DataExportReader(reader: Reader, private val tokenLimit: Int = DataExportProtocol.FILE_LIMIT) : FilterReader(reader) {
    private var quoted = false
    private var escaped = false
    private var unicode = 0
    private var tokenSize = 0
    private var depth = 0
    private fun token() { if (++tokenSize > tokenLimit) throw AuthFailure(AuthFailure.Kind.PROTOCOL) }
    private fun inspect(char: Char) {
        if (quoted) {
            when {
                unicode > 0 -> { unicode--; if (unicode == 0) token() }
                escaped -> { escaped = false; if (char == 'u') unicode = 4 else token() }
                char == '\\' -> escaped = true
                char == '"' -> quoted = false
                else -> token()
            }
        } else when (char) {
            '"' -> { quoted = true; tokenSize = 0 }
            '{', '[' -> { depth++; if (depth > 64) throw AuthFailure(AuthFailure.Kind.PROTOCOL) }
            '}', ']' -> depth--
        }
    }
    override fun read(): Int = super.read().also { if (it >= 0) inspect(it.toChar()) }
    override fun read(buffer: CharArray, offset: Int, length: Int): Int = super.read(buffer, offset, length).also { count ->
        if (count > 0) for (index in offset until offset + count) inspect(buffer[index])
    }
}
