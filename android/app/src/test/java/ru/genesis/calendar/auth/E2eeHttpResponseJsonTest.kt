package ru.genesis.calendar.auth

import kotlinx.coroutines.CancellationException
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.File
import java.io.IOException
import java.io.InputStream

class E2eeHttpResponseJsonTest {
    private val path = "/e2ee/v1/source"
    private fun read(raw: String, route: String = path) = E2eeHttpResponseJson.read(
        ByteArrayInputStream(raw.toByteArray(Charsets.UTF_8)), route, 200, "application/json", -1, {})
    private fun refuses(code: String = "E2EE_INVALID_RESPONSE", operation: () -> Unit) {
        try { operation(); fail("Expected $code") } catch (error: AuthApiError) { assertEquals(code, error.code) }
    }
    @Test fun sharedWireCorpusMatchesBothHttpOutcomesWithEveryByteSplit() {
        val root = generateSequence(File(requireNotNull(System.getProperty("user.dir")))) { it.parentFile }
            .first { File(it, "contracts/e2ee/transport-json-v1.json").isFile }
        val cases = JSONObject(File(root, "contracts/e2ee/transport-json-v1.json").readText(Charsets.UTF_8)).getJSONArray("cases")
        assertEquals(44, cases.length())
        for (index in 0 until cases.length()) for (status in listOf(200, 409)) {
            val row = cases.getJSONObject(index)
            val bytes = if (row.has("hex")) row.getString("hex").chunked(2).map { it.toInt(16).toByte() }.toByteArray()
                else row.getString("raw").toByteArray(Charsets.UTF_8)
            val loans = mutableListOf<ByteArray>()
            val input = object : ByteArrayInputStream(bytes) {
                override fun read(target: ByteArray, offset: Int, count: Int): Int {
                    assertTrue(loans.all { value -> value.all { it == 0.toByte() } }); loans.add(target)
                    return super.read(target, offset, minOf(count, 1))
                }
            }
            val operation = { E2eeHttpResponseJson.read(input, path, status, "application/json; charset=utf-8", bytes.size.toLong(), {}) }
            if (row.getBoolean("valid")) assertNotNull(row.getString("id"), operation())
            else if (status == 409) assertNull(row.getString("id"), operation())
            else refuses { operation() }
            assertTrue(loans.all { value -> value.all { it == 0.toByte() } })
        }
    }
    @Test fun resourceBudgetsAdmitTheirBoundariesAndARealisticDirectoryThenRefuseOneOver() {
        val cases = listOf(
            "{\"${"a".repeat(1024)}\":1}" to "{\"${"a".repeat(1025)}\":1}",
            "{\"x\":${"[".repeat(39)}0${"]".repeat(39)}}" to "{\"x\":${"[".repeat(40)}0${"]".repeat(40)}}",
            "{\"x\":0.${"0".repeat(125)}1}" to "{\"x\":0.${"0".repeat(126)}1}",
            "{${(0 until 10000).joinToString(",") { "\"k$it\":0" }}}" to "{${(0 until 10001).joinToString(",") { "\"k$it\":0" }}}",
            "{\"x\":[${"0,".repeat(249997)}0]}" to "{\"x\":[${"0,".repeat(249998)}0]}"
        )
        for ((valid, invalid) in cases) { assertNotNull(read(valid, "/e2ee/v1/directory")); refuses { read(invalid, "/e2ee/v1/directory") } }
        val history = org.json.JSONArray()
        for (revision in 0 until 2048) history.put(JSONObject().put("protocol", 1).put("ownerId", "synthetic").put("scopeId", "personal:synthetic")
            .put("deviceId", "synthetic-device").put("action", "rotate").put("expectedRevision", revision).put("checkpointHash", "synthetic")
            .put("securityEpoch", revision + 1).put("operationId", "synthetic-$revision").put("payload", JSONObject().put("keyId", "synthetic-root")
                .put("generation", revision + 1).put("capsules", org.json.JSONArray().put(JSONObject().put("deviceId", "synthetic-device").put("ciphertext", "A".repeat(128))))))
        assertEquals(2048, read(JSONObject().put("events", history).toString(), "/e2ee/v1/directory")!!.getJSONArray("events").length())
    }
    @Test fun bothByteLimitsMimeAndNonProgressRefuseWithoutAProjectedPrefix() {
        for (route in listOf(path, "/e2ee/v1/read", "/e2ee/v1/directory")) {
            var reads = 0
            val input = object : InputStream() { override fun read(): Int { reads++; return -1 } }
            refuses("E2EE_RESPONSE_TOO_LARGE") { E2eeHttpResponseJson.read(input, route, 200, "application/json", E2eeTransportProtocol.responseLimit(route) + 1L, {}) }
            assertEquals(0, reads)
        }
        val limit = E2eeTransportProtocol.responseLimit(path)
        assertNotNull(read("{\"x\":\"${"a".repeat(limit - 8)}\"}"))
        refuses("E2EE_RESPONSE_TOO_LARGE") { read("{\"x\":\"${"a".repeat(limit - 7)}\"}") }
        for ((status, bytes) in listOf(200 to "{}".toByteArray(), 409 to ByteArray(8193) { 32 })) {
            val result = { E2eeHttpResponseJson.read(ByteArrayInputStream(bytes), path, status, "text/html", -1, {}) }
            if (status == 200) refuses { result() } else assertNull(result())
        }
        val zero = object : InputStream() { override fun read() = 0; override fun read(target: ByteArray, offset: Int, length: Int) = 0 }
        refuses { E2eeHttpResponseJson.read(zero, path, 200, "application/json", -1, {}) }
        assertNull(E2eeHttpResponseJson.read(ByteArrayInputStream(ByteArray(8193) { 32 }), path, 409, "application/json", -1, {}))
    }
    @Test fun currentAccountCancellationAndIoFailureNeverBecomeAValidMigrationResponse() {
        for (status in listOf(200, 409)) {
            var touched = false; var loan: ByteArray? = null
            val input = object : ByteArrayInputStream("{}".toByteArray()) {
                override fun read(target: ByteArray, offset: Int, length: Int): Int {
                    touched = true; loan = target; return super.read(target, offset, length)
                }
            }
            try {
                E2eeHttpResponseJson.read(input, path, status, "application/json", -1, current = { if (touched) throw CancellationException("synthetic-retired") })
                fail("Account cancellation swallowed")
            } catch (error: CancellationException) { assertEquals("synthetic-retired", error.message) }
            assertTrue(requireNotNull(loan).all { it == 0.toByte() })
            val io = object : InputStream() { override fun read(): Int = throw IOException("synthetic-wire-canary") }
            if (status == 409) assertNull(E2eeHttpResponseJson.read(io, path, status, "application/json", -1, {}))
            else try { E2eeHttpResponseJson.read(io, path, status, "application/json", -1, {}); fail("IO error swallowed") } catch (_: IOException) { }
        }
    }

    @Test fun rawObservationMustAcknowledgeExactBytesBeforeParsingAndCannotMutateItsInput() {
        val raw = "\ufeff {\"sourceHash\":\"first\", \"sourceHash\":\"second\"}\r\n".toByteArray()
        val events = mutableListOf<String>(); val copies = mutableListOf<ByteArray>(); val loans = mutableListOf<ByteArray>()
        val capture = object : E2eeHttpBodyObservation {
            override fun begin(response: E2eeHttpBodyObservation.Response) { assertEquals(200, response.status); events += "begin" }
            override fun append(bytes: ByteArray) { assertTrue(bytes.size <= 65536); copies += bytes.copyOf(); loans += bytes; bytes.fill(32); events += "append" }
            override fun finish() { events += "eof" }
            override fun close() { events += "close" }
        }
        refuses { E2eeHttpResponseJson.read(ByteArrayInputStream(raw), path, 200, "application/json", -1, {}, capture) }
        assertEquals(listOf("begin", "append", "eof", "close"), events)
        assertArrayEquals(raw, copies.single()); assertTrue(loans.all { value -> value.all { it == 0.toByte() } })
        val parsed = E2eeHttpResponseJson.read(ByteArrayInputStream("{\"sourceHash\":\"original\"}".toByteArray()), path, 200, "application/json", -1, {}, capture)
        assertEquals("original", parsed!!.getString("sourceHash"))
    }

    @Test fun observationStorageIoAndCancellationAreNeverSwallowedByAnHttpErrorBody() {
        for (status in listOf(200, 409)) for (cancel in listOf(false, true)) {
            var eof = false; var closed = false; var loan: ByteArray? = null
            val failure = if (cancel) CancellationException("synthetic-retired") else IOException("synthetic-storage-private-canary")
            val capture = object : E2eeHttpBodyObservation {
                override fun begin(response: E2eeHttpBodyObservation.Response) = Unit
                override fun append(bytes: ByteArray) { loan = bytes; throw failure }
                override fun finish() { eof = true }
                override fun close() { closed = true }
            }
            try { E2eeHttpResponseJson.read(ByteArrayInputStream("{}".toByteArray()), path, status, "application/json", -1, {}, capture); fail("Observation failure swallowed") }
            catch (error: Exception) { assertSame(failure, error) }
            assertFalse(eof); assertTrue(closed); assertTrue(requireNotNull(loan).all { it == 0.toByte() })
        }
    }
}
