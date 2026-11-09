package ru.genesis.calendar.ui

import android.view.View
import android.webkit.WebView
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.*
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.ViewAction
import androidx.test.espresso.UiController
import androidx.test.espresso.matcher.ViewMatchers.isAssignableFrom
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import kotlinx.coroutines.runBlocking
import org.hamcrest.Matcher
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.captureNativeWindow
import ru.genesis.calendar.auth.AuthFailure
import ru.genesis.calendar.data.AuroraGateway
import ru.genesis.calendar.data.AuroraNativeStore
import ru.genesis.calendar.domain.StoicheionReading
import java.io.File
import java.util.Base64
import java.util.concurrent.atomic.AtomicReference
import java.util.concurrent.atomic.AtomicBoolean

private class AuroraSyntheticGateway: AuroraGateway{
    var active=true
    var offline=false
    var envelope:JSONObject?=null
    val key=ByteArray(32){(it+1).toByte()}
    override fun check(){check(active){"AURORA_ACCOUNT_CHANGED"}}
    override suspend fun workspace():JSONObject{check();if(offline)throw AuthFailure(AuthFailure.Kind.NETWORK)
        return JSONObject().put("workspace",JSONObject().put("keyMode","account").put("key",Base64.getEncoder().encodeToString(key)))}
    override suspend fun request(method:String,path:String,body:JSONObject?):JSONObject{
        check();if(offline)throw AuthFailure(AuthFailure.Kind.NETWORK)
        require(path=="/aurora-workspace")
        if(method=="GET")return JSONObject().put("document",envelope?:JSONObject.NULL)
        require(method=="PUT"&&body!=null)
        val old=envelope
        if(old?.optString("iv")==body.getString("iv")&&old.optString("ciphertext")==body.getString("ciphertext"))return JSONObject().put("revision",old.getLong("revision"))
        check((old?.getLong("revision")?:0L)==body.getLong("expectedRevision"))
        envelope=JSONObject(body.toString()).put("revision",body.getLong("expectedRevision")+1)
        return JSONObject().put("revision",envelope!!.getLong("revision"))
    }
    override suspend fun billing(method:String,path:String,body:JSONObject?)=error("Synthetic checkout disabled")
}

class AuroraNativeTest{
    @get:Rule val compose=createAndroidComposeRule<PagerTestActivity>()
    private val args get()=InstrumentationRegistry.getArguments()
    private val dark get()=args.getString("genesisEvening")=="true"
    private fun source():JSONObject{
        val ids="alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega".split(" ")
        return JSONObject().put("id","native-synthetic-source").put("seed",2).put("day","2026-11-05").put("createdAt","2026-11-05T09:00:00Z")
            .put("cards",JSONArray(StoicheionReading.spread(ids,2L).map{(id,reversed)->JSONObject().put("cardId",id).put("reversed",reversed)}))
    }
    private fun domString(expression:String):String{
        val result=AtomicReference<String?>()
        onView(isAssignableFrom(WebView::class.java)).perform(object:ViewAction{
            override fun getConstraints():Matcher<View> = isAssignableFrom(WebView::class.java)
            override fun getDescription()="Read local Aurora content"
            override fun perform(controller:UiController,view:View){(view as WebView).evaluateJavascript(expression){result.set(JSONTokener(it).nextValue() as? String)}}
        })
        compose.waitUntil(10000){result.get()!=null};return result.get()!!
    }
    private fun body()=domString("document.body.innerText")
    private fun visualFrame(){
        val ready=AtomicBoolean(false)
        onView(isAssignableFrom(WebView::class.java)).perform(object:ViewAction{
            override fun getConstraints():Matcher<View> = isAssignableFrom(WebView::class.java)
            override fun getDescription()="Wait for submitted local WebView content"
            override fun perform(controller:UiController,view:View){(view as WebView).postVisualStateCallback(1,object:WebView.VisualStateCallback(){override fun onComplete(id:Long){ready.set(true)}})}
        });compose.waitUntil(10000){ready.get()}
    }
    private fun capture(label:String){captureNativeWindow(File(compose.activity.getExternalFilesDir(null),"aurora-${if(dark)"dark" else "light"}-${args.getString("genesisFontScale","1")}-$label.png"))}
    @Test fun localBundleKeepsActualDrawAndEncryptedProgressOnCloseAndOfflineReopen(){
        val app=compose.activity.application as GenesisApplication
        val gateway=AuroraSyntheticGateway()
        runBlocking{for(kind in listOf("aurora-cache","aurora-pending","aurora-account-key"))app.database.dao().deleteDocument(app.workspaceScope,kind)}
        var open by mutableStateOf(true)
        compose.setContent{
            val density=LocalDensity.current
            CompositionLocalProvider(LocalGenesisLanguage provides "ru",LocalEveningTheme provides dark,
                LocalDensity provides Density(density.density,args.getString("genesisFontScale","1")!!.toFloat())){
                MaterialTheme(colorScheme=if(dark)evening else standart,typography=GenesisTypography,shapes=GenesisShapes){
                    if(open)NativeAuroraDialog("aurora-synthetic-owner",source(),{open=false},{},gateway)
                }
            }
        }
        compose.waitUntil(30000){runCatching{body().contains("Выберите карты для работы")}.getOrDefault(false)}
        val first=body();assertTrue(first.contains("сохранённый расклад из девяти карт"))
        assertEquals("true",domString("String(document.querySelectorAll('.aurora-sector[data-state=negative]').length>0)"))
        assertFalse(first.contains("Сохранил выполненное действие"))
        visualFrame()
        val layout=domString("JSON.stringify({viewport:[innerWidth,innerHeight],nodes:[...document.querySelectorAll('.aurora-dialog,.aurora-dialog>*')].map(x=>({tag:x.className,rect:x.getBoundingClientRect().toJSON(),display:getComputedStyle(x).display,position:getComputedStyle(x).position}))})")
        File(compose.activity.getExternalFilesDir(null),"aurora-layout.json").writeText(layout)
        assertEquals("Embedded page must fill the measured WebView: $layout","true",domString("String(document.querySelector('.aurora-dialog').clientHeight>=innerHeight-2)"))
        assertEquals("Every native footer target must be at least 48 by 48 CSS dp","true",domString("String([...document.querySelectorAll('.aurora-footer button')].every(x=>{const r=x.getBoundingClientRect();return r.width>=48&&r.height>=48}))"))
        assertEquals("The interview must not contain text-entry fields","0",domString("String(document.querySelectorAll('textarea,input:not([type=checkbox]):not([type=radio])').length)"))
        capture("source")
        val device=UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        for(selector in listOf(".aurora-sector[data-state=negative]", ".aurora-footer>.primary-button")) {
            // A WebView virtual text node can exist while its bounds are stale or
            // offscreen. Measure the actual footer and retain a real device touch.
            domString("(()=>{document.querySelector('$selector').scrollIntoView({block:'center'});return 'ready'})()")
            visualFrame()
            val target=JSONObject(domString("(()=>{const r=document.querySelector('$selector').getBoundingClientRect();return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2,width:innerWidth,height:innerHeight,visible:r.y>=0&&r.bottom<=innerHeight})})()"))
            assertTrue(layout,target.getBoolean("visible"))
            val touch=AtomicReference<IntArray>()
            val visibleBounds=AtomicReference<android.graphics.Rect>()
            onView(isAssignableFrom(WebView::class.java)).perform(object:ViewAction{
                override fun getConstraints():Matcher<View> = isAssignableFrom(WebView::class.java)
                override fun getDescription()="Tap measured native WebView next control"
                override fun perform(controller:UiController,view:View){
                    val location=IntArray(2);view.getLocationOnScreen(location)
                    visibleBounds.set(android.graphics.Rect().also { view.getGlobalVisibleRect(it) })
                    touch.set(intArrayOf(location[0]+(target.getDouble("x")*view.width/target.getDouble("width")).toInt(),location[1]+(target.getDouble("y")*view.height/target.getDouble("height")).toInt()))
                }
            })
            assertTrue("The footer must be inside the visible WebView: $target / ${visibleBounds.get()}",visibleBounds.get().contains(touch.get()[0],touch.get()[1]))
            capture("next-control")
            assertTrue(device.click(touch.get()[0],touch.get()[1]))
        }
        compose.waitUntil(10000){domString("document.querySelector('.aurora-stage h3')?.textContent??''")=="Направление изменения"}
        capture("secondary")
        compose.onNodeWithTag("aurora-native-close",useUnmergedTree=true).performClick()
        compose.waitUntil(10000){!open&&compose.onAllNodesWithTag("aurora-native-dialog").fetchSemanticsNodes().isEmpty()};assertNotNull(gateway.envelope)
        assertFalse(gateway.envelope.toString().contains("Направление изменения"))
        gateway.offline=true
        compose.runOnIdle{open=true}
        compose.waitUntil(30000){runCatching{domString("document.querySelector('.aurora-stage h3')?.textContent??''")=="Направление изменения"}.getOrDefault(false)}
        assertTrue(body().contains("ожидает связи"));capture("offline-restored")
    }
    @Test fun nativeEncryptionRejectsWrongOwnerAndLateAccountUse(){
        val app=compose.activity.application as GenesisApplication;val gateway=AuroraSyntheticGateway();val scope=app.workspaceScope
        val a=AuroraNativeStore(app,"owner-a",scope,gateway);val b=AuroraNativeStore(app,"owner-b",scope,gateway)
        runBlocking{
            val sealed=a.seal(JSONObject().put("private","synthetic"),"aurora-workspace:v1")
            assertFalse(sealed.toString().contains("synthetic"))
            assertEquals("synthetic",(a.open(sealed,"aurora-workspace:v1") as JSONObject).getString("private"))
            assertTrue(runCatching{b.open(sealed,"aurora-workspace:v1")}.isFailure)
            gateway.active=false
            assertTrue(runCatching{a.open(sealed,"aurora-workspace:v1")}.isFailure)
        };a.close();b.close()
    }
}
