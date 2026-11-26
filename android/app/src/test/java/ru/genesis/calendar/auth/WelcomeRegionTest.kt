package ru.genesis.calendar.auth

import java.io.ByteArrayInputStream
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class WelcomeRegionTest {
    private class Reply(private val body: String, private val status: Int = 200) : HttpURLConnection(URL("https://example.invalid/api/billing/location")) {
        var closed = false
        override fun connect() = Unit
        override fun disconnect() { closed = true }
        override fun usingProxy() = false
        override fun getResponseCode() = status
        override fun getInputStream() = ByteArrayInputStream(body.toByteArray(Charsets.UTF_8))
    }

    @Test fun `only an explicit IP Russia result permits Russian`() {
        assertEquals(WelcomeIpRegion.RUSSIA, welcomeIpRegion(JSONObject("""{"region":"RU","source":"ip"}""")))
        assertEquals(WelcomeIpRegion.OTHER, welcomeIpRegion(JSONObject("""{"region":"outside-RU","source":"ip"}""")))
        for (source in listOf("device", "unknown", "", "RU")) assertEquals(WelcomeIpRegion.UNKNOWN,
            welcomeIpRegion(JSONObject().put("region", "RU").put("source", source)))
        for (region in listOf("ru", "US", "unknown", "")) assertEquals(WelcomeIpRegion.UNKNOWN,
            welcomeIpRegion(JSONObject().put("region", region).put("source", "ip")))
    }

    @Test fun `the public lookup never adds authentication and refuses redirects and caching`() {
        val reply = Reply("""{"region":"RU","source":"ip"}""")
        assertEquals(WelcomeIpRegion.RUSSIA, requestWelcomeIpRegion { reply })
        assertEquals("GET", reply.requestMethod)
        assertFalse(reply.instanceFollowRedirects)
        assertFalse(reply.useCaches)
        assertEquals("no-store", reply.getRequestProperty("Cache-Control"))
        for (header in listOf("Cookie", "Authorization", "X-Genesis-Account-Id", "X-Genesis-Device-Id")) assertNull(reply.getRequestProperty(header))
        assertTrue(reply.connectTimeout in 1..4_000 && reply.readTimeout in 1..4_000)
        assertTrue(reply.closed)
    }

    @Test fun `failed status and oversized payload cannot establish Russia`() {
        for (reply in listOf(Reply("""{"region":"RU","source":"ip"}""", 302), Reply(" ".repeat(4097)))) {
            assertEquals(WelcomeIpRegion.UNKNOWN, requestWelcomeIpRegion { reply })
            assertTrue(reply.closed)
        }
    }

    @Test fun `malformed response closes the connection without producing a location`() {
        val reply = Reply("not JSON")
        try { requestWelcomeIpRegion { reply }; fail("Malformed response accepted") }
        catch (_: org.json.JSONException) { assertTrue(reply.closed) }
    }
}
