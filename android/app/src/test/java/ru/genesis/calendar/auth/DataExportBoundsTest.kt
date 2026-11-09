package ru.genesis.calendar.auth

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.StringReader

class DataExportBoundsTest {
    private fun rejected(action: () -> Unit) { assertTrue(runCatching(action).exceptionOrNull() is AuthFailure) }
    @Test fun wireLimitIncludesAllReadMethodsAndDoesNotUseTheSharedResponseBudget() {
        DataExportInput(ByteArrayInputStream(byteArrayOf(1, 2, 3)), 3).use { input ->
            assertEquals(1, input.read()); assertEquals(2, input.read(ByteArray(8), 0, 8)); assertEquals(-1, input.read())
        }
        rejected { DataExportInput(ByteArrayInputStream(ByteArray(4)), 3).read(ByteArray(4)) }
        assertTrue(DataExportProtocol.ENVELOPE_LIMIT > 6L * DataExportProtocol.FILE_LIMIT)
    }
    @Test fun escapedTokensCountDecodedCharactersEvenAcrossTinyReads() {
        val text = "{\"a\":\"\\u044F\\uD83C\\uDF19\\\"\\\\\"}"
        val reader = DataExportReader(StringReader(text), 6)
        val output = StringBuilder(); while (true) { val next = reader.read(); if (next < 0) break; output.append(next.toChar()) }
        assertEquals(text, output.toString())
        rejected { DataExportReader(StringReader(text), 4).readText() }
    }
    @Test fun oversizedStringsAreRejectedBeforeTheyCanGrowIntoAnEnvelopeSizedAllocation() {
        DataExportReader(StringReader("[\"12345\"]"), 5).readText()
        rejected { DataExportReader(StringReader("[\"123456\"]"), 5).readText() }
    }
    @Test fun nestingInsideStringsIsNotCountedButUnboundedJsonDepthIsRejected() {
        DataExportReader(StringReader("[\"${"[".repeat(100)}\"]"), 100).readText()
        rejected { DataExportReader(StringReader("[".repeat(65) + "0" + "]".repeat(65))).readText() }
    }
}
