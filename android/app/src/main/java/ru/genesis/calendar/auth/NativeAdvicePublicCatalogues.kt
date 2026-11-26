package ru.genesis.calendar.auth

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import org.json.JSONObject
import ru.genesis.calendar.security.E2eeCommands
import ru.genesis.calendar.security.E2eeKeys
import java.io.ByteArrayOutputStream
import java.net.CookieHandler
import java.net.URL
import java.nio.ByteBuffer
import java.security.MessageDigest
import javax.net.ssl.HttpsURLConnection

private const val PUBLIC_ADVICE_MAXIMUM=8*1024*1024
private val publicAdviceLanguages=setOf("ru","en","el","de","fr","es","it","pt","pl","sr","uk","zh","tr","ja")

/** The only public-network capability exposed to the isolated Advice source.
 * Paths come from the signed APK's edition pins, never an owner/id or arbitrary
 * URL. No account client, cookie jar, device ID, quota or private API is used. */
internal class NativeAdvicePublicCatalogues(private val manifestBytes:()->ByteArray,
    private val download:(String,Int,()->Unit)->ByteArray={path,maximum,current->downloadAdvicePublicBytes(path,maximum,current)},
    private val metadataPinBytes:(()->ByteArray)?=null) {
    private data class Pin(val bytes:Int,val sha256:String)
    private data class Editions(val raw:ByteArray,val paths:Map<String,Pin>)
    private val editions:Editions by lazy{
        val raw=manifestBytes();check(raw.size in 2..1024*1024){"E2EE_ADVICE_CATALOGUE_INVALID"}
        val value=JSONObject(Charsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(raw)).toString());E2eeKeys.exact(value,setOf("protocol","catalogues"))
        check(E2eeCommands.integer(value.get("protocol"))==1L){"E2EE_ADVICE_CATALOGUE_INVALID"}
        val rows=value.getJSONArray("catalogues");check(rows.length() in 1..2048){"E2EE_ADVICE_CATALOGUE_INVALID"}
        val paths=linkedMapOf<String,Pin>();val names=mutableSetOf<String>();val languages=mutableMapOf<String,MutableSet<String>>()
        for(index in 0 until rows.length()){
            val row=rows.getJSONObject(index);E2eeKeys.exact(row,setOf("kind","version","language","sha256","bytes","path"))
            val kind=row.getString("kind");val version=row.getString("version");val language=row.getString("language");val hash=row.getString("sha256")
            val size=E2eeCommands.integer(row.get("bytes"),2);val path=row.getString("path")
            check(kind in setOf("daily","philosophers")&&version.matches(Regex("[-a-z0-9]{1,80}"))&&language in publicAdviceLanguages
                &&hash.matches(Regex("[a-f0-9]{64}"))&&size<=PUBLIC_ADVICE_MAXIMUM
                &&path=="advice-catalogues/v1/$kind/$version/$language.$hash.json"&&names.add("$kind:$version:$language")
                &&!paths.containsKey(path)){"E2EE_ADVICE_CATALOGUE_INVALID"}
            paths[path]=Pin(size.toInt(),hash);languages.getOrPut("$kind:$version"){mutableSetOf()}.add(language)
        }
        check(languages.values.all{it==publicAdviceLanguages}){"E2EE_ADVICE_CATALOGUE_UNAVAILABLE"}
        Editions(raw.copyOf(),paths.toMap())
    }
    suspend fun read(path:String,assertCurrent:()->Unit):ByteArray=withContext(Dispatchers.IO){
        val job=currentCoroutineContext()[Job];fun current(){job?.ensureActive();assertCurrent()};current()
        val pinned=editions;current()
        if(path=="advice-catalogues/v1/manifest.json")return@withContext pinned.raw.copyOf()
        val pin=pinned.paths[path]?:metadataPinBytes?.invoke()?.let{raw->
            val value=JSONObject(Charsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(raw)).toString());E2eeKeys.exact(value,setOf("protocol","sha256","bytes","path"))
            check(value.getInt("protocol")==1&&value.getString("sha256").matches(Regex("[a-f0-9]{64}"))&&value.getString("path")=="advice-catalogues/v1/metadata.${value.getString("sha256")}.json"
                &&value.getInt("bytes") in 2..PUBLIC_ADVICE_MAXIMUM){"E2EE_ADVICE_CATALOGUE_INVALID"}
            if(path==value.getString("path"))Pin(value.getInt("bytes"),value.getString("sha256"))else null
        }?:error("E2EE_ADVICE_CATALOGUE_UNAVAILABLE")
        val bytes=download(path,pin.bytes,::current);current()
        check(bytes.size==pin.bytes){"E2EE_ADVICE_CATALOGUE_INVALID"}
        val hash=MessageDigest.getInstance("SHA-256").digest(bytes).joinToString(""){"%02x".format(it)}
        check(hash==pin.sha256){"E2EE_ADVICE_CATALOGUE_INTEGRITY"};current();bytes
    }
    override fun toString()="NativeAdvicePublicCatalogues([public editions])"
}

/** Dedicated first-party public GET. Inheriting a process-wide Java cookie
 * handler is denied rather than risking a session on a public catalogue request.
 * The app's authenticated native jar is independent and is never consulted. */
internal fun downloadAdvicePublicBytes(path:String,maximum:Int,assertCurrent:()->Unit,
    open:(URL)->HttpsURLConnection={it.openConnection() as HttpsURLConnection}):ByteArray {
    check(path.matches(Regex("advice-catalogues/v1/(?:(?:daily|philosophers)/[-a-z0-9]{1,80}/[a-z]{2}\\.[a-f0-9]{64}|metadata\\.[a-f0-9]{64})\\.json"))
        &&maximum in 2..PUBLIC_ADVICE_MAXIMUM){"E2EE_ADVICE_CATALOGUE_INVALID"}
    assertCurrent();check(CookieHandler.getDefault()==null){"E2EE_ADVICE_PUBLIC_COOKIE_CONTEXT_FORBIDDEN"}
    val url=URL(AUTH_ORIGIN.trimEnd('/')+"/"+path);check(url.protocol=="https"){"E2EE_ADVICE_CATALOGUE_INVALID"}
    val connection=open(url)
    try{
        connection.requestMethod="GET";connection.instanceFollowRedirects=false;connection.useCaches=false
        connection.connectTimeout=10000;connection.readTimeout=15000
        connection.setRequestProperty("Accept","application/json");connection.setRequestProperty("Accept-Encoding","identity")
        assertCurrent();check(CookieHandler.getDefault()==null){"E2EE_ADVICE_PUBLIC_COOKIE_CONTEXT_FORBIDDEN"}
        check(connection.responseCode==200&&connection.contentType?.substringBefore(';')?.trim()?.equals("application/json",true)==true
            &&connection.contentLengthLong<=maximum&&connection.contentEncoding?.takeIf{it.isNotBlank()} in setOf(null,"identity")){"E2EE_ADVICE_CATALOGUE_UNAVAILABLE"}
        return connection.inputStream.use{input->
            val output=ByteArrayOutputStream(minOf(maximum,16384));val buffer=ByteArray(16384)
            while(true){assertCurrent();val size=input.read(buffer);assertCurrent();if(size<0)break
                check(output.size()+size<=maximum){"E2EE_ADVICE_CATALOGUE_INVALID"};output.write(buffer,0,size)}
            output.toByteArray().also{assertCurrent()}
        }
    }finally{connection.disconnect()}
}
