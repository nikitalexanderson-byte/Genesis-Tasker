package ru.genesis.calendar.auth

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.OutputStream
import java.util.concurrent.CancellationException

class DataImportBodyTest {
    @Test fun exactJsonAndDeclaredUtf8LengthIncludingAnEmojiAcrossTheWriterBoundary() {
        val content = "x".repeat(8191) + "😀\"\\\r\n\tПривет\uFEFF"
        val metadata = JSONObject().put("title", "Импорт").put("nil", JSONObject.NULL).put("zero", 0).put("flag", false)
        val body = DataImportBody(metadata, content); val output = ByteArrayOutputStream()
        body.write(output) {}
        assertEquals(body.length, output.size()); val parsed = JSONObject(output.toString("UTF-8"))
        assertEquals(content, parsed.getString("content")); assertEquals("Импорт", parsed.getString("title"))
        assertEquals(0, parsed.getInt("zero")); assertFalse(parsed.getBoolean("flag")); assertTrue(parsed.isNull("nil"))
        assertFalse(metadata.has("content"))
    }
    @Test fun fullSizeEscapedSourceIsWrittenWithoutBuildingAnEscapedRequestCopy() {
        val content = "\"".repeat(DataExportProtocol.FILE_LIMIT)
        val body = DataImportBody(JSONObject().put("format", "csv"), content)
        var count = 0L
        val output = object : OutputStream() { override fun write(value: Int) { count++ }; override fun write(buffer: ByteArray, offset: Int, length: Int) { count += length } }
        body.write(output) {}; assertEquals(body.length.toLong(), count); assertTrue(count > 2L * DataExportProtocol.FILE_LIMIT)
    }
    @Test fun cancellationStopsARequestPartWayThroughTheSource() {
        val body = DataImportBody(JSONObject(), "x".repeat(100_000)); val output = ByteArrayOutputStream(); var calls = 0
        assertThrows(CancellationException::class.java) { body.write(output) { if (++calls == 3) throw CancellationException() } }
        assertTrue(output.size() < body.length)
    }
    @Test fun invalidSourcesNeverReachTheWriter() {
        for (source in listOf("\uD800", "\uDC00", "a\u0000b", "a\u000Bb")) assertThrows(IllegalArgumentException::class.java) { DataImportBody(JSONObject(), source) }
        assertThrows(IllegalArgumentException::class.java) { DataImportBody(JSONObject().put("content", "duplicate"), "x") }
    }
}
