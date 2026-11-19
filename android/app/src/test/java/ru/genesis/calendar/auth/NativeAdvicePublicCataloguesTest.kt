package ru.genesis.calendar.auth

import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.File
import java.net.CookieHandler
import java.net.CookieManager
import java.net.URL
import java.security.cert.Certificate
import javax.net.ssl.HttpsURLConnection

class NativeAdvicePublicCataloguesTest {
    private fun root():File=generateSequence(File(requireNotNull(System.getProperty("user.dir")))){it.parentFile}
        .first{File(it,"contracts/public-advice-editions-v1.json").isFile}
    private fun manifest()=File(root(),"contracts/public-advice-editions-v1.json").readBytes()
    private suspend fun reject(code:String,run:suspend ()->Unit){try{run();fail("Expected $code")}catch(error:IllegalStateException){assertEquals(code,error.message)}}
    @Test fun exactCompiledPublicPinsResolveRealEditionsAndNeverAcceptAnArbitraryPath()=runBlocking{
        val manifest=manifest();val rows=JSONObject(manifest.toString(Charsets.UTF_8)).getJSONArray("catalogues");var calls=0
        val reader=NativeAdvicePublicCatalogues({manifest}){path,maximum,current->
            current();calls++;val row=(0 until rows.length()).map{rows.getJSONObject(it)}.single{it.getString("path")==path}
            val directory=if(row.getString("kind")=="daily")"daily-advice" else "philosopher-aphorisms-locales"
            File(root(),"server/content/$directory/${row.getString("version")}/${row.getString("language")}.json").readBytes().also{assertEquals(maximum,it.size)}
        }
        assertEquals(126,JSONObject(reader.read("advice-catalogues/v1/manifest.json",{}).toString(Charsets.UTF_8)).getJSONArray("catalogues").length());assertEquals(0,calls)
        for(index in 0..13){val row=rows.getJSONObject(index);assertEquals(row.getInt("bytes"),reader.read(row.getString("path"),{}).size)}
        assertEquals(14,calls)
        for(path in listOf("https://foreign.invalid/private","../private","advice-catalogues/v1/manifest.json?owner=private","advice-catalogues/v1/daily/unknown/en."+"0".repeat(64)+".json"))
            reject("E2EE_ADVICE_CATALOGUE_UNAVAILABLE"){reader.read(path,{})}
        assertEquals(14,calls)
    }
    @Test fun changedPublicBytesLostOwnerAndAnIncompletePinMatrixNeverBecomeFallbackText()=runBlocking{
        val manifest=manifest();val value=JSONObject(manifest.toString(Charsets.UTF_8));val row=value.getJSONArray("catalogues").getJSONObject(0);val path=row.getString("path")
        val corrupt=NativeAdvicePublicCatalogues({manifest}){_,maximum,_->ByteArray(maximum){1}}
        reject("E2EE_ADVICE_CATALOGUE_INTEGRITY"){corrupt.read(path,{})}
        val short=NativeAdvicePublicCatalogues({manifest}){_,_,_->byteArrayOf(1,2)}
        reject("E2EE_ADVICE_CATALOGUE_INVALID"){short.read(path,{})}
        var active=true;val lost=NativeAdvicePublicCatalogues({manifest}){_,maximum,_->active=false;ByteArray(maximum)}
        reject("E2EE_ACCOUNT_CHANGED"){lost.read(path,{check(active){"E2EE_ACCOUNT_CHANGED"}})}
        value.getJSONArray("catalogues").remove(0)
        val incomplete=NativeAdvicePublicCatalogues({value.toString().toByteArray()}){_,_,_->error("No network")}
        reject("E2EE_ADVICE_CATALOGUE_UNAVAILABLE"){incomplete.read("advice-catalogues/v1/manifest.json",{})}
    }
    private class Reply(private val bytes:ByteArray,private val status:Int=200,private val mime:String="application/json",private val declared:Long=bytes.size.toLong()):HttpsURLConnection(URL("https://example.invalid/")){
        var closed=false;var read=false
        override fun connect()=Unit
        override fun disconnect(){closed=true}
        override fun usingProxy()=false
        override fun getCipherSuite()="TLS_SYNTHETIC_FIXTURE"
        override fun getLocalCertificates():Array<Certificate>?=null
        override fun getServerCertificates():Array<Certificate> = emptyArray()
        override fun getResponseCode()=status
        override fun getContentType()=mime
        override fun getContentLengthLong()=declared
        override fun getInputStream()=ByteArrayInputStream(bytes).also{read=true}
    }
    private val path="advice-catalogues/v1/daily/synthetic-v1/en."+"0".repeat(64)+".json"
    @Test fun dedicatedHttpsGetAddsNoAccountHeadersAndRejectsRedirectsMimeAndBothSizeLimits()=runBlocking{
        val previous=CookieHandler.getDefault();CookieHandler.setDefault(null)
        try{
            val reply=Reply("{}".toByteArray());val result=downloadAdvicePublicBytes(path,2,{}){url->assertEquals("https",url.protocol);assertTrue(url.path.endsWith(path));reply}
            assertEquals("{}",result.toString(Charsets.UTF_8));assertEquals("GET",reply.requestMethod);assertFalse(reply.instanceFollowRedirects);assertFalse(reply.useCaches);assertTrue(reply.closed)
            for(header in listOf("Cookie","Referer","Authorization","X-CSRF-Token","X-Genesis-Account-Id","X-Genesis-Installation-Id","X-Genesis-App-Version"))assertNull(reply.getRequestProperty(header))
            for(invalid in listOf(Reply(byteArrayOf(1,2),302),Reply(byteArrayOf(1,2),mime="text/html"),Reply(byteArrayOf(1,2),declared=3))){
                reject("E2EE_ADVICE_CATALOGUE_UNAVAILABLE"){downloadAdvicePublicBytes(path,2,{}){invalid}};assertFalse(invalid.read);assertTrue(invalid.closed)
            }
            val streamed=Reply(byteArrayOf(1,2,3),declared=-1)
            reject("E2EE_ADVICE_CATALOGUE_INVALID"){downloadAdvicePublicBytes(path,2,{}){streamed}};assertTrue(streamed.closed)
        }finally{CookieHandler.setDefault(previous)}
    }
    @Test fun processWideCookieContextAndMalformedPublicPathsAreDeniedBeforeOpeningConnection()=runBlocking{
        val previous=CookieHandler.getDefault();var calls=0
        try{
            CookieHandler.setDefault(CookieManager())
            reject("E2EE_ADVICE_PUBLIC_COOKIE_CONTEXT_FORBIDDEN"){downloadAdvicePublicBytes(path,2,{}){calls++;error("Unexpected network")}}
            CookieHandler.setDefault(null)
            for(value in listOf("https://foreign.invalid/private","../private","$path?owner=private"))reject("E2EE_ADVICE_CATALOGUE_INVALID"){
                downloadAdvicePublicBytes(value,2,{}){calls++;error("Unexpected network")}
            }
            assertEquals(0,calls)
        }finally{CookieHandler.setDefault(previous)}
    }
}
