package ru.genesis.calendar.ui

import android.annotation.SuppressLint
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import ru.genesis.calendar.BuildConfig
import java.time.Instant
import java.util.TimeZone

/** Public environment diagnostic plus real Java/WebView civil-time agreement.
 * No account, storage, network or fixture key enters this plain isolated view. */
@RunWith(AndroidJUnit4::class)
class NativeTimeZoneCompatibilityTest {
    @SuppressLint("SetJavaScriptEnabled")
    @Test fun currentProviderReportsTheSystemZoneAndMatchingWinterSummerOffsets():Unit=runBlocking {
        val app=InstrumentationRegistry.getInstrumentation().targetContext
        check(BuildConfig.DEBUG&&app.packageName.endsWith(".qa1103.debug"))
        val result=CompletableDeferred<String>();var view:WebView?=null
        try {
            withContext(Dispatchers.Main.immediate){
                view=WebView(app).apply{
                    settings.javaScriptEnabled=true;settings.domStorageEnabled=false;settings.blockNetworkLoads=true
                    settings.allowFileAccess=false;settings.allowContentAccess=false
                    webViewClient=object:WebViewClient(){
                        override fun onPageFinished(view:WebView,url:String){view.evaluateJavascript("JSON.stringify({zone:Intl.DateTimeFormat().resolvedOptions().timeZone,utc:Intl.DateTimeFormat('en',{timeZone:'UTC'}).resolvedOptions().timeZone,winter:new Date('2026-01-15T12:00:00Z').getTimezoneOffset(),summer:new Date('2026-07-15T12:00:00Z').getTimezoneOffset()})"){result.complete(it)}}
                    }
                    loadDataWithBaseURL("https://appassets.androidplatform.net/timezone-probe","<!doctype html><title>Public timezone probe</title>","text/html","UTF-8",null)
                }
            }
            val encoded=withTimeout(15000){result.await()};val value=JSONObject(JSONObject("{\"value\":"+encoded+"}").getString("value"))
            val zone=TimeZone.getDefault()
            println("PUBLIC_RUNTIME_TIMEZONE java=${zone.id} web=${value.getString("zone")} utc=${value.getString("utc")}")
            assertTrue(value.getString("zone").isNotBlank())
            for((field,date)in listOf("winter" to "2026-01-15T12:00:00Z","summer" to "2026-07-15T12:00:00Z"))
                assertEquals(-zone.getOffset(Instant.parse(date).toEpochMilli())/60000,value.getInt(field))
        }finally{withContext(NonCancellable+Dispatchers.Main.immediate){view?.destroy()}}
    }
}
