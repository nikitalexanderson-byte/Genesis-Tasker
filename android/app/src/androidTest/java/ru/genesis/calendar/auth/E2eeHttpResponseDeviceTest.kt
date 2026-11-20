package ru.genesis.calendar.auth

import android.content.Context
import android.content.ContextWrapper
import android.content.SharedPreferences
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.CancellationException
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.data.LocalCipher
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.net.URL
import java.security.cert.Certificate
import java.util.UUID
import javax.net.ssl.HttpsURLConnection

/** Actual AuthSessionClient, Android JSONObject and Keystore session journal.
 * Only the connection factory is synthetic; this is not a TLS/backend test. */
class E2eeHttpResponseDeviceTest {
    private class Reply(val bytes: ByteArray, val status: Int = 200, val mime: String = "application/json", val declared: Long = -1,
        private val afterRead: () -> Unit = {}) : HttpsURLConnection(URL("https://example.invalid/")) {
        var closed = false; var streamClosed = false; var reads = 0
        val loans = mutableListOf<ByteArray>(); private val sent = ByteArrayOutputStream()
        val stream = object : ByteArrayInputStream(bytes) {
            override fun read(target: ByteArray, offset: Int, count: Int): Int {
                assertTrue(loans.all { value -> value.all { it == 0.toByte() } }); loans.add(target); reads++
                val result = super.read(target, offset, minOf(count, 3)); afterRead(); return result
            }
            override fun close() { streamClosed = true; super.close() }
        }
        override fun connect() = Unit
        override fun disconnect() { closed = true; sent.reset() }
        override fun usingProxy() = false
        override fun getCipherSuite() = "TLS_SYNTHETIC_WIRE_PORT"
        override fun getLocalCertificates(): Array<Certificate>? = null
        override fun getServerCertificates(): Array<Certificate> = emptyArray()
        override fun getResponseCode() = status
        override fun getContentType() = mime
        override fun getContentLengthLong() = declared
        override fun getHeaderFields(): Map<String, List<String>> = emptyMap()
        override fun getInputStream() = stream
        override fun getErrorStream() = stream
        override fun getOutputStream() = sent
    }
    private class Rig : AutoCloseable {
        val app = InstrumentationRegistry.getInstrumentation().targetContext
        private val namespace = "synthetic-wire-${UUID.randomUUID()}"
        private val stores = mutableSetOf<String>()
        private val context = object : ContextWrapper(app) {
            override fun getApplicationContext() = this
            override fun getSharedPreferences(name: String, mode: Int): SharedPreferences {
                val scoped = "$namespace.$name"; stores += scoped; return app.getSharedPreferences(scoped, mode)
            }
        }
        val preferences = context.getSharedPreferences("genesis.native.auth.v1", Context.MODE_PRIVATE)
        var reply = Reply("{}".toByteArray()); var calls = 0
        val client: AuthSessionClient; var generation: Long
        init {
            check(BuildConfig.DEBUG && app.packageName == "ru.genesis.calendar.qa1103.debug")
            val csrf = AuthProtocol.csrf("a".repeat(48))
            val saved = JSONObject().put("cookie", "syntheticCookie0123456789").put("csrf", csrf).put("expiresAt", System.currentTimeMillis() + 3600000)
            check(preferences.edit().putString("session", LocalCipher().encrypt(saved.toString(), "genesis.native.auth.v2"))
                .putString("pending-private-canary", "retained-synthetic-work").commit())
            client = AuthSessionClient(context, { url ->
                assertTrue(url.path.startsWith("/api/e2ee/v1/")); calls++; reply
            }); generation = client.begin()
        }
        fun call(path: String = "/source") = client.e2ee(generation, path, JSONObject().put("scopeId", "personal:synthetic"))
        fun assertClean() { assertTrue(reply.closed); assertTrue(reply.streamClosed); assertTrue(reply.loans.all { value -> value.all { it == 0.toByte() } }) }
        override fun close() { client.begin(); for (store in stores) check(app.deleteSharedPreferences(store)) }
    }
    @Test fun actualAuthenticatedChannelRejectsEveryAmbiguityWithoutPublishingSessionOrLosingPendingWork() {
        Rig().use { rig ->
            val cases = JSONObject(rig.app.assets.open("transport-json-v1.json").bufferedReader().use { it.readText() }).getJSONArray("cases")
            assertEquals(44, cases.length()); var rejected = 0; var admitted = 0
            for (index in 0 until cases.length()) for (status in listOf(200, 409)) {
                val row = cases.getJSONObject(index)
                val bytes = if (row.has("hex")) row.getString("hex").chunked(2).map { it.toInt(16).toByte() }.toByteArray() else row.getString("raw").toByteArray(Charsets.UTF_8)
                val before = rig.preferences.all.toMap(); rig.reply = Reply(bytes, status)
                try {
                    rig.call(); assertTrue(row.getString("id"), row.getBoolean("valid") && status == 200); admitted++
                } catch (error: AuthApiError) {
                    assertFalse(row.getString("id"), row.getBoolean("valid")); assertEquals(200, status); assertEquals("E2EE_INVALID_RESPONSE", error.code); rejected++
                } catch (error: AuthFailure) {
                    assertEquals(409, status); assertEquals(AuthFailure.Kind.CONFLICT, error.kind); rejected++
                }
                if (!row.getBoolean("valid") || status != 200) assertEquals(row.getString("id"), before, rig.preferences.all)
                assertEquals("retained-synthetic-work", rig.preferences.getString("pending-private-canary", null)); rig.assertClean()
            }
            assertEquals(8, admitted); assertEquals(80, rejected); assertEquals(88, rig.calls)
        }
    }
    @Test fun currentGenerationCancellationSurvivesBothSuccessAndErrorBodyCleanup() {
        Rig().use { rig ->
            for (status in listOf(200, 409)) {
                val before = rig.preferences.all.toMap(); rig.generation = rig.client.begin()
                rig.reply = Reply("{\"error\":\"E2EE_MIGRATION_FENCED\"}".toByteArray(), status) { rig.client.begin(); Unit }
                try { rig.call(); fail("Retired response accepted") } catch (_: CancellationException) { }
                assertEquals(before, rig.preferences.all); rig.assertClean()
            }
        }
    }
    @Test fun realChannelKeepsValidCodesAndRefusesDeclaredRouteSizesBeforeReadingAnyBody() {
        Rig().use { rig ->
            val before = rig.preferences.all.toMap()
            for ((path, maximum) in listOf("/source" to 256 * 1024, "/read" to 16 * 1024 * 1024, "/directory" to 32 * 1024 * 1024)) {
                rig.reply = Reply("{}".toByteArray(), declared = maximum + 1L)
                try { rig.call(path); fail("Declared oversize accepted") } catch (error: AuthApiError) { assertEquals("E2EE_RESPONSE_TOO_LARGE", error.code) }
                assertEquals(0, rig.reply.reads); rig.assertClean(); assertEquals(before, rig.preferences.all)
            }
            for (code in listOf("E2EE_SOURCE_CHANGED", "E2EE_MIGRATION_FENCED")) {
                rig.reply = Reply(JSONObject().put("error", code).toString().toByteArray(), 409)
                try { rig.call(); fail("Public error lost") } catch (error: AuthApiError) { assertEquals(code, error.code) }
                rig.assertClean(); assertEquals(before, rig.preferences.all)
            }
            rig.reply = Reply("{\"sourceHash\":\"synthetic-valid\"}".toByteArray())
            assertEquals("synthetic-valid", rig.call().getString("sourceHash")); rig.assertClean()
        }
    }

    @Test fun actualE2eeContentCannotPublishIdentityCsrfOrRemovePendingWork() {
        Rig().use { rig ->
            val before = rig.preferences.all.toMap()
            val reserved = listOf(
                JSONObject().put("user", JSONObject().put("uid", "foreign-owner").put("email", "synthetic@example.invalid")),
                JSONObject().put("user", JSONObject.NULL),
                JSONObject().put("csrf", "b".repeat(48)))
            for (fields in reserved) {
                fields.put("sourceHash", "synthetic"); rig.reply = Reply(fields.toString().toByteArray())
                try { rig.call(); fail("E2EE content published session fields") } catch (error: AuthApiError) { assertEquals("E2EE_INVALID_RESPONSE", error.code) }
                assertEquals(before, rig.preferences.all); rig.assertClean()
            }
            // Only root transport fields are reserved; private nested names
            // remain ordinary data for their eventual semantic reader.
            rig.reply = Reply("{\"envelopes\":[{\"user\":\"synthetic-private-name\"}],\"sourceHash\":\"synthetic\"}".toByteArray())
            assertEquals("synthetic-private-name", rig.call().getJSONArray("envelopes").getJSONObject(0).getString("user")); rig.assertClean()
        }
    }

    @Test fun nativeHttpPolicyRefusesRedirectsAndPrivateFreeTextButKeepsTechnicalErrorCodes() {
        Rig().use { rig ->
            val before = rig.preferences.all.toMap(); rig.reply = Reply("{}".toByteArray(), 307)
            try { rig.call(); fail("Redirect accepted") } catch (error: AuthFailure) { assertEquals(AuthFailure.Kind.PROTOCOL, error.kind) }
            assertFalse(rig.reply.instanceFollowRedirects); rig.assertClean(); assertEquals(before, rig.preferences.all)
            for (raw in listOf("E2EE_PRIVATE synthetic-private-error-canary", "E2EE_private", "E2EE_" + "A".repeat(81))) {
                rig.reply = Reply(JSONObject().put("error", raw).toString().toByteArray(), 409)
                try { rig.call(); fail("Free-text error accepted") } catch (error: AuthFailure) { assertEquals(AuthFailure.Kind.CONFLICT, error.kind); assertFalse(error.message.orEmpty().contains("canary")) }
                rig.assertClean(); assertEquals(before, rig.preferences.all)
            }
            rig.reply = Reply("{\"error\":\"E2EE_MIGRATION_FENCED\"}".toByteArray(), 409)
            try { rig.call(); fail("Fencing error lost") } catch (error: AuthApiError) { assertEquals("E2EE_MIGRATION_FENCED", error.code) }
            rig.assertClean(); assertEquals(before, rig.preferences.all)
        }
    }
}
