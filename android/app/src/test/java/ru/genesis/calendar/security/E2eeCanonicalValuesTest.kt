package ru.genesis.calendar.security

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class E2eeCanonicalValuesTest {
    private fun bytes(hex: String) = hex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
    private fun vectors() = JSONObject(javaClass.getResource("/e2ee/canonical-values-v1.json")!!.readText())
    private fun refuses(block: () -> Unit) {
        try { block(); fail("Malformed technical wire was accepted") }
        catch (error: IllegalArgumentException) { assertEquals("E2EE_INVALID_COMMAND", error.message) }
    }
    @Test fun independentByteVectorsAndEveryTruncatedPrefix() {
        val valid = vectors().getJSONArray("valid")
        for (index in 0 until valid.length()) {
            val row = valid.getJSONObject(index)
            val wire = bytes(row.getString("hex"))
            assertArrayEquals(row.getString("name"), wire, E2eeCommands.canonical(row.get("value")))
            val decoded = E2eeCommands.decodeCanonical(wire)
            assertArrayEquals(wire, E2eeCommands.canonical(decoded))
            for (size in wire.indices) refuses { E2eeCommands.decodeCanonical(wire.copyOf(size)) }
        }
    }
    @Test fun malformedAndResourceBounds() {
        val invalid = vectors().getJSONArray("invalid")
        for (index in 0 until invalid.length()) refuses { E2eeCommands.decodeCanonical(bytes(invalid.getJSONObject(index).getString("hex"))) }
        var deep = byteArrayOf(0)
        repeat(17) { deep = bytes("0500000001") + deep }
        refuses { E2eeCommands.decodeCanonical(deep) }
        for (limit in listOf(0, -1, 6 * 1024 * 1024 + 1)) refuses { E2eeCommands.decodeCanonical(byteArrayOf(0), limit) }
        refuses { E2eeCommands.decodeCanonical(bytes("040000000161"), 5) }
        val original = bytes("0400000003616263")
        assertEquals("abc", E2eeCommands.decodeCanonical(original))
        assertArrayEquals(bytes("0400000003616263"), original)
    }
}
