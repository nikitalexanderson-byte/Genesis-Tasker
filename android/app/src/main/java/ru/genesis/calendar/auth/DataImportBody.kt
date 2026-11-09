package ru.genesis.calendar.auth

import org.json.JSONObject
import java.io.OutputStream
import java.io.OutputStreamWriter
import java.nio.charset.CodingErrorAction

/** Stream one large JSON string without allocating the escaped request and its UTF-8 copy. */
internal class DataImportBody(metadata: JSONObject, private val content: String) {
    private val prefix: ByteArray
    val length: Int
    init {
        require(!metadata.has("content") && DataExportProtocol.utf8Within(content, DataExportProtocol.FILE_LIMIT)) { "DATA_SOURCE_INVALID" }
        val json = metadata.toString(); require(json.toByteArray(Charsets.UTF_8).size <= 2_000_000) { "DATA_IMPORT_INVALID" }
        prefix = (json.dropLast(1) + (if (metadata.length() == 0) "" else ",") + "\"content\":\"").toByteArray(Charsets.UTF_8)
        var bytes = prefix.size.toLong() + 2; var index = 0
        while (index < content.length) {
            val char = content[index++]
            require(char.code >= 32 || char in "\n\r\t") { "DATA_SOURCE_INVALID" }
            bytes += when {
                char in "\"\\\n\r\t" -> 2
                char.code < 128 -> 1
                char.code < 2048 -> 2
                char.isHighSurrogate() -> { index++; 4 }
                else -> 3
            }
        }
        require(bytes <= 45L * 1024 * 1024) { "DATA_FILE_TOO_LARGE" }; length = bytes.toInt()
    }
    fun write(output: OutputStream, current: () -> Unit) {
        current(); output.write(prefix)
        val encoder = Charsets.UTF_8.newEncoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
        val writer = OutputStreamWriter(output, encoder).buffered()
        var start = 0
        while (start < content.length) {
            current(); val end = minOf(start + 8192, content.length); var run = start
            for (index in start until end) {
                val escape = when (content[index]) { '"' -> "\\\""; '\\' -> "\\\\"; '\n' -> "\\n"; '\r' -> "\\r"; '\t' -> "\\t"; else -> null }
                if (escape != null) { writer.write(content, run, index - run); writer.write(escape); run = index + 1 }
            }
            writer.write(content, run, end - run); start = end
        }
        current(); writer.write("\"}"); writer.flush()
    }
}
