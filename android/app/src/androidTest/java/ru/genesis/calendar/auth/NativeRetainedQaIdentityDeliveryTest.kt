package ru.genesis.calendar.auth

import android.content.Context
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.data.LocalCipher
import java.io.ByteArrayInputStream
import java.net.URL
import java.security.KeyStore
import java.security.cert.CertificateFactory
import java.util.Base64
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManagerFactory

/** One separate process supplies provider identity to an already retained owned
 * fixture after its original short session expires. No vault is opened, no
 * device approval/key/role is imported, and no system credential is refreshed.
 * The driver stops this process before running the normal lock-screen tests. */
class NativeRetainedQaIdentityDeliveryTest {
    @Test fun sameRetainedOwnerReceivesANewSecureSyntheticSession()=runBlocking {
        val args=InstrumentationRegistry.getArguments()
        val app=InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        check(args.getString("genesisFullQaHttps")=="true"&&BuildConfig.DEBUG&&app.packageName=="ru.genesis.calendar.qa1103.debug"&&AUTH_ORIGIN=="https://localhost:4443")
        withContext(Dispatchers.IO){
            val expected=requireNotNull(CachedAccountEntry(app).read(app.workspaceScope)).identity
            check(expected.privateVault&&expected.uid.startsWith("qa-")&&expected.email.endsWith("@example.invalid"))
            val certificate=CertificateFactory.getInstance("X.509").generateCertificate(ByteArrayInputStream(Base64.getDecoder().decode(requireNotNull(args.getString("genesisFixtureCa")))))
            val trust=KeyStore.getInstance(KeyStore.getDefaultType()).apply{load(null);setCertificateEntry("owned-loopback",certificate)}
            val managers=TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()).apply{init(trust)}
            val previous=HttpsURLConnection.getDefaultSSLSocketFactory()
            HttpsURLConnection.setDefaultSSLSocketFactory(SSLContext.getInstance("TLS").apply{init(null,managers.trustManagers,null)}.socketFactory)
            try {
                var sessionCookie:CookieUpdate?=null
                fun get(path:String,cookie:String?=null):JSONObject {
                    check(path in setOf("/api/qa/login?tier=business","/api/session"))
                    val connection=URL(AUTH_ORIGIN+path).openConnection() as HttpsURLConnection
                    try {
                        connection.instanceFollowRedirects=false;connection.connectTimeout=15000;connection.readTimeout=30000
                        connection.setRequestProperty("Origin",AUTH_ORIGIN)
                        if(cookie!=null)connection.setRequestProperty("Cookie","$SESSION_COOKIE=$cookie")
                        assertEquals("Owned identity delivery HTTP status",200,connection.responseCode)
                        val headers=connection.headerFields.entries.filter{it.key?.equals("Set-Cookie",true)==true}.flatMap{it.value}
                        val update=AuthProtocol.cookie(headers,System.currentTimeMillis())
                        if(update.present)sessionCookie=update
                        val bytes=connection.inputStream.use{it.readBytes()};check(bytes.size<=256*1024)
                        return JSONObject(bytes.toString(Charsets.UTF_8))
                    }finally{connection.disconnect()}
                }
                val delivered=get("/api/qa/login?tier=business")
                check(delivered.getBoolean("synthetic")&&delivered.getString("userId")==expected.uid)
                val cookie=requireNotNull(sessionCookie).also{check(it.present&&it.value.isNotBlank())}
                val response=get("/api/session",cookie.value)
                val identity=requireNotNull(AuthProtocol.identity(response))
                check(identity.uid==expected.uid&&identity.email==expected.email&&identity.privateVault&&!response.getJSONObject("user").optBoolean("isAdmin"))
                val current=requireNotNull(sessionCookie)
                val payload=JSONObject().put("cookie",current.value).put("csrf",AuthProtocol.csrf(response.getString("csrf"))).put("expiresAt",current.expiresAt)
                check(app.getSharedPreferences("genesis.native.auth.v1",Context.MODE_PRIVATE).edit()
                    .putString("session",LocalCipher().encrypt(payload.toString(),"genesis.native.auth.v2")).commit())
            }finally{HttpsURLConnection.setDefaultSSLSocketFactory(previous)}
        }
    }
}
