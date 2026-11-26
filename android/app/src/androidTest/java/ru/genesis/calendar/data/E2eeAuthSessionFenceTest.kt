package ru.genesis.calendar.data

import android.content.Context
import android.content.ContextWrapper
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import ru.genesis.calendar.auth.AuthApiError
import ru.genesis.calendar.auth.AuthSessionClient
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.net.URL
import java.security.KeyStore
import java.security.cert.Certificate
import java.util.UUID
import javax.net.ssl.HttpsURLConnection

/** Uses the production request method and real isolated Room/Keystore. A fake
 * connection factory counts ALL attempts, including attempts before TLS IO. */
@RunWith(AndroidJUnit4::class)
class E2eeAuthSessionFenceTest {
    private class Reply(url: URL,private val payload: JSONObject) : HttpsURLConnection(url) {
        var closed=false
        val output=ByteArrayOutputStream()
        override fun connect() {}
        override fun disconnect() { closed=true }
        override fun usingProxy() = false
        override fun getCipherSuite() = "TLS_SYNTHETIC"
        override fun getLocalCertificates(): Array<Certificate>? = null
        override fun getServerCertificates(): Array<Certificate> = emptyArray()
        override fun getResponseCode() = 200
        override fun getContentType() = "application/json"
        override fun getInputStream() = ByteArrayInputStream(payload.toString().toByteArray(Charsets.UTF_8))
        override fun getOutputStream() = output
        override fun getHeaderFields(): Map<String,List<String>> = mapOf("Set-Cookie" to listOf("GENESISSESSID=syntheticcookiesession1234; Path=/; Secure; HttpOnly; Max-Age=3600"))
    }
    @Test fun realAuthClientFencesBeforeTheConnectionFactoryAndKeepsIndependentRoutes() = runBlocking(Dispatchers.IO) {
        val fixture=E2eeLegacyScopeFenceTest();val id=UUID.randomUUID().toString()
        val name="qa-e2ee-auth-$id.db";val room=fixture.open(name);val alias="genesis.e2ee.qa.$id"
        val preferenceNames=mutableSetOf<String>()
        val context=object : ContextWrapper(fixture.context) {
            override fun getSharedPreferences(name: String,mode: Int)=super.getSharedPreferences("qa-e2ee-auth-$id-$name".also { preferenceNames+=it },mode)
        }
        val connections=mutableListOf<Reply>()
        var mutablePreferences:JSONObject?=null
        try {
            val client=AuthSessionClient(context,openConnection={ url ->
                if(url.path=="/api/account/preferences")mutablePreferences?.put("advicePreferences",JSONObject().put("privateCanary","synthetic"))
                val payload=if(url.path=="/api/session") JSONObject().put("csrf","a".repeat(48)).put("user",JSONObject()
                    .put("uid",fixture.owner).put("email","synthetic@example.invalid").put("displayName","Synthetic").put("dataGeneration",0))
                    else JSONObject().put("ok",true)
                Reply(url,payload).also { connections+=it }
            },cipher=LocalCipher(alias),personalTransportGate={ NativeLegacyTransportGate(room) })
            val generation=client.begin()
            try { client.workspace(generation);fail("Unbound account reached a connection") }
            catch(error: AuthApiError) { assertEquals("E2EE_ACCOUNT_BINDING_REQUIRED",error.code) }
            assertEquals(0,connections.size)
            client.session(generation);client.workspace(generation);assertEquals(2,connections.size)
            assertEquals(fixture.owner,connections.last().getRequestProperty("X-Genesis-Account-Id"));assertTrue(connections.all { it.closed })
            room.dao().putOutbox(OutboxRecord(fixture.scope,"task",1,"retained-operation"))
            val fence=NativeLegacyScopeFence(room,fixture.owner,fixture.remote,{})
            fence.withFence {}
            for(active in listOf(false,true)) {
                if(active)fence.activate(fixture.directory().second)
                val count=connections.size
                try { client.workspace(generation);fail("Fenced account reached a connection") }
                catch(error: AuthApiError) { assertEquals("E2EE_LOCAL_LEGACY_TRANSPORT_FORBIDDEN",error.code) }
                assertEquals(count,connections.size)
                client.session(generation);client.e2ee(generation,"/status",null)
                assertEquals(count+2,connections.size)
                assertEquals("retained-operation",room.dao().outbox(fixture.scope).single().operationId)
            }
            mutablePreferences=JSONObject().put("language","en")
            client.updatePreferences(generation,requireNotNull(mutablePreferences))
            assertTrue(requireNotNull(mutablePreferences).has("advicePreferences"))
            assertFalse(connections.last().output.toString("UTF-8").contains("advicePreferences"))
            // A clean client has no local marker yet. The active server profile
            // must still stop legacy IO before it could send plaintext to an old
            // route. This hint grants no key/device authority.
            var restoredConnections=0
            val restoredOwner="synthetic-server-active-owner"
            assertNull(room.dao().legacyScopeFence(ru.genesis.calendar.auth.CloudAccountSnapshot.scopeFor(restoredOwner)))
            val restored=AuthSessionClient(context,openConnection={ url ->
                restoredConnections++
                Reply(url,JSONObject().put("csrf","a".repeat(48)).put("user",JSONObject().put("uid",restoredOwner)
                    .put("email","active@example.invalid").put("privatePreferencesMode","e2ee")))
            },cipher=LocalCipher(alias),personalTransportGate={ NativeLegacyTransportGate(room) })
            val restoredGeneration=restored.begin();restored.session(restoredGeneration)
            try { restored.workspace(restoredGeneration);fail("Active server profile reached legacy IO") }
            catch(error: AuthApiError) { assertEquals("E2EE_UPGRADE_REQUIRED",error.code) }
            assertEquals(1,restoredConnections)
        } finally {
            room.close();fixture.context.deleteDatabase(name)
            for(preference in preferenceNames)fixture.context.deleteSharedPreferences(preference)
            check(alias.startsWith("genesis.e2ee.qa."));KeyStore.getInstance("AndroidKeyStore").apply { load(null);deleteEntry(alias) }
        }
    }
}
