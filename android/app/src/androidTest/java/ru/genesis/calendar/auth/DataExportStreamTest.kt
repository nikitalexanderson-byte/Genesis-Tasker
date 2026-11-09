package ru.genesis.calendar.auth

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayInputStream
import java.io.InputStream
import java.io.SequenceInputStream
import java.util.Collections

@RunWith(AndroidJUnit4::class)
class DataExportStreamTest {
    private fun envelope(content: String, format: String = "json") = JSONObject().put("format", format).put("content", content)
        .put("projectCount", 2).put("taskCount", 131).put("notices", JSONArray()).toString().toByteArray(Charsets.UTF_8)
    @Test fun platformStreamKeepsOpaqueFileBytesAndFullCounts() {
        val content = "{\"format\":\"genesis-shared-workspace\",\"future\":{\"nested\":true},\"title\":\"Проверка 🌙\"}\r\n"
        val result = DataExportStream.read(ByteArrayInputStream(envelope(content)), "json")
        assertArrayEquals(content.toByteArray(Charsets.UTF_8), result.getString("content").toByteArray(Charsets.UTF_8))
        assertEquals(131, result.getInt("taskCount")); assertEquals(2, result.getInt("projectCount"))
    }
    @Test fun csvPreservesBomNewlinesAndQuotes() {
        val content = "\uFEFFНазвание,Описание\r\n\"Карта\",\"строка 1\nстрока 2, \\\"текст\\\"\"\r\n"
        assertEquals(content, DataExportStream.read(ByteArrayInputStream(envelope(content, "csv")), "csv").getString("content"))
    }
    private fun httpFixture(format: String): JSONObject {
        val bytes = InstrumentationRegistry.getInstrumentation().context.assets.open("native-export-http-$format.json").use { it.readBytes() }
        val reference = JSONObject(bytes.toString(Charsets.UTF_8))
        val result = DataExportStream.read(ByteArrayInputStream(bytes), format)
        assertEquals(2, result.getInt("projectCount")); assertEquals(131, result.getInt("taskCount"))
        assertArrayEquals(reference.getString("content").toByteArray(Charsets.UTF_8), result.getString("content").toByteArray(Charsets.UTF_8))
        return result
    }
    @Test fun actualPhpHttpJsonIncludesAll131TasksTypedValuesAndRelations() {
        val manifest = JSONObject(httpFixture("json").getString("content"))
        assertEquals("genesis.shared-data", manifest.getString("format")); assertEquals(1, manifest.getInt("version"))
        assertEquals("lunar", manifest.getString("calendarMode"))
        val context = manifest.getJSONObject("calendarContext")
        assertEquals(2, context.getInt("version")); assertEquals("America/New_York", context.getString("timeZone"))
        assertEquals("march", context.getString("gregorianYearStart"))
        val tasks = manifest.getJSONArray("tasks"); assertEquals(131, tasks.length())
        val byTitle = (0 until tasks.length()).map { tasks.getJSONObject(it) }.associateBy { it.getString("title") }
        val first = byTitle.getValue("Задача, \"Луна 🌙\" · 0"); val child = byTitle.getValue("Задача, \"Луна 🌙\" · 1")
        assertTrue(byTitle.containsKey("Задача, \"Луна 🌙\" · 130"))
        assertEquals(0.0, first.getDouble("storyPoints"), 0.0); assertTrue(first.isNull("estimateHours"))
        val fields = manifest.getJSONArray("fields")
        val fieldKeys = (0 until fields.length()).map { fields.getJSONObject(it) }.associate { it.getString("type") to it.getString("key") }
        assertEquals(0, first.getJSONObject("customValues").getInt(fieldKeys.getValue("number")))
        assertFalse(first.getJSONObject("customValues").getBoolean(fieldKeys.getValue("checkbox")))
        assertEquals(first.getString("key"), child.getString("parentKey"))
        assertEquals(child.getString("key"), first.getJSONArray("checklists").getJSONObject(0).getJSONArray("items").getJSONObject(0).getString("linkedTaskKey"))
        assertEquals(1, manifest.getJSONArray("comments").length())
        assertEquals(2, manifest.getJSONArray("projects").length())
    }
    @Test fun actualPhpHttpCsvPreservesTheFullSelectionBomAndQuotedUnicode() {
        val content = httpFixture("csv").getString("content")
        assertTrue(content.startsWith("\uFEFF")); assertTrue(content.contains("\"Задача, \"\"Луна 🌙\"\" · 130\""))
        assertTrue(content.contains("Первая строка\nВторая строка, с кавычками \"\"да\"\""))
    }
    @Test fun aValidEscapedEnvelopeLargerThanTheSharedReaderLimitIsStreamed() {
        val size = 6 * 1024 * 1024
        val prefix = "{\"format\":\"csv\",\"projectCount\":1,\"taskCount\":131,\"notices\":[],\"content\":\""
        val input = SequenceInputStream(Collections.enumeration(listOf(prefix.byteInputStream(), RepeatedInput("\\u0001".toByteArray(), size), "\"}".byteInputStream())))
        assertTrue(size.toLong() * 6 > 32_000_000)
        val result = DataExportStream.read(input, "csv")
        val content = result.getString("content"); assertEquals(size, content.length)
        assertTrue(content.all { it == '\u0001' }); assertEquals(131, result.getInt("taskCount"))
    }
    @Test fun wrongTypesDuplicatesMalformedUnicodeAndTrailingContentAreRejected() {
        val original = envelope("{}")
        val invalid = listOf(
            original.toString(Charsets.UTF_8).replace("\"taskCount\":131", "\"taskCount\":\"131\"").toByteArray(),
            original.toString(Charsets.UTF_8).replace("\"taskCount\":131", "\"taskCount\":131.0").toByteArray(),
            original.toString(Charsets.UTF_8).dropLast(1).plus(",\"taskCount\":1}").toByteArray(),
            original + " true".toByteArray(), original.toString(Charsets.UTF_8).replace("\"content\":\"{}\"", "\"content\":\"\\uD800\"").toByteArray(),
            byteArrayOf('{'.code.toByte(), '"'.code.toByte(), 0xc3.toByte(), 0x28)
        )
        for (bytes in invalid) {
            val failure = runCatching { DataExportStream.read(ByteArrayInputStream(bytes), "json") }.exceptionOrNull()
            assertTrue("Invalid export was accepted", failure is AuthFailure && failure.kind == AuthFailure.Kind.PROTOCOL)
        }
    }
    @Test fun oversizedDecodedContentIsRejectedBeforeTheEnvelopeCanAllocateAnUnboundedToken() {
        val input = SequenceInputStream(Collections.enumeration(listOf("{\"content\":\"".byteInputStream(), RepeatedInput(byteArrayOf('a'.code.toByte()), DataExportProtocol.FILE_LIMIT + 1), "\"}".byteInputStream())))
        val failure = runCatching { DataExportStream.read(input, "json") }.exceptionOrNull()
        assertTrue(failure is AuthFailure && failure.kind == AuthFailure.Kind.PROTOCOL)
    }
    private class RepeatedInput(private val pattern: ByteArray, repetitions: Int) : InputStream() {
        private var position = 0L; private val limit = repetitions.toLong() * pattern.size
        override fun read(): Int = if (position == limit) -1 else pattern[(position++ % pattern.size).toInt()].toInt() and 0xff
        override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
            if (position == limit) return -1
            val count = minOf(length.toLong(), limit - position).toInt()
            for (index in 0 until count) buffer[offset + index] = pattern[((position + index) % pattern.size).toInt()]
            position += count; return count
        }
    }
}
