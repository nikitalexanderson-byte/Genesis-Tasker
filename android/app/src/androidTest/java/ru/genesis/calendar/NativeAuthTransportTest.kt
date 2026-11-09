package ru.genesis.calendar

import androidx.test.platform.app.InstrumentationRegistry
import java.net.URL
import javax.net.ssl.HttpsURLConnection
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.auth.AuthProtocol
import ru.genesis.calendar.auth.AuthSessionClient

/** Device-only transport probe; does not send credentials or mutate account data. */
class NativeAuthTransportTest {
    @Test fun nativeClientCanRequestProductionChallenge() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext
        val client = AuthSessionClient(app)
        val generation = client.begin()
        assertTrue(client.session(generation).has("csrf"))
        val challenge = AuthProtocol.challenge(client.challenge(generation))
        assertEquals(43, challenge.nonce.length)
    }

    @Test fun deviceCanReachProductionSessionOverHttps() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext
        assertTrue(BuildConfig.DEBUG && app.packageName.endsWith(".debug"))
        assertEquals(BuildConfig.APPLICATION_ID, app.packageName)
        val connection = URL("${BuildConfig.GENESIS_ORIGIN}/api/session").openConnection() as HttpsURLConnection
        try {
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 10_000
            connection.readTimeout = 15_000
            connection.setRequestProperty("Accept", "application/json")
            assertEquals(200, connection.responseCode)
            assertTrue(connection.contentType.orEmpty().startsWith("application/json"))
            val payload = JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
            assertTrue(payload.has("csrf"))
            assertTrue(payload.has("user"))
        } finally {
            connection.disconnect()
        }
    }
}
