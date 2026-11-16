package ru.genesis.calendar.ui

import android.view.View
import android.webkit.WebView
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.ViewAction
import androidx.test.espresso.UiController
import androidx.test.espresso.matcher.RootMatchers.isDialog
import androidx.test.espresso.matcher.ViewMatchers.isAssignableFrom
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.hamcrest.Matcher
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.captureNativeWindow
import ru.genesis.calendar.data.AuroraGateway
import ru.genesis.calendar.domain.StoicheionReading
import java.io.File
import java.util.Base64
import java.util.concurrent.atomic.AtomicReference

class Release334RegressionTest {
    @get:Rule val compose=createAndroidComposeRule<PagerTestActivity>()
    private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
    private fun clearSyntheticCache() {
        check(context.packageName.endsWith(".debug"))
        val app=context.applicationContext as GenesisApplication
        runBlocking { for(kind in listOf("aurora-cache","aurora-pending","aurora-account-key"))
            app.database.dao().deleteDocument(app.workspaceScope,kind) }
    }
    private class Gateway:AuroraGateway {
        var envelope:JSONObject?=null
        override fun check(){}
        override suspend fun workspace()=JSONObject().put("workspace",JSONObject().put("keyMode","account")
            .put("key",Base64.getEncoder().encodeToString(ByteArray(32){(it+1).toByte()})))
        override suspend fun request(method:String,path:String,body:JSONObject?):JSONObject {
            require(path=="/aurora-workspace")
            if(method=="GET")return JSONObject().put("document",envelope?:JSONObject.NULL)
            envelope=JSONObject(requireNotNull(body).toString()).put("revision",(envelope?.optLong("revision")?:0)+1)
            return JSONObject().put("revision",envelope!!.getLong("revision"))
        }
        override suspend fun billing(method:String,path:String,body:JSONObject?)=error("No QA billing")
    }
    private fun source(seed:Long=0xffff_ffffL):JSONObject {
        val ids="alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega".split(" ")
        return JSONObject().put("id","regression334-$seed").put("seed",seed).put("day","2026-11-16")
            .put("createdAt","2026-11-16T09:00:00Z").put("cards",JSONArray(StoicheionReading.spread(ids,seed).map{(id,reversed)->
                JSONObject().put("cardId",id).put("reversed",reversed)}))
    }
    private fun js(expression:String):String {
        val result=AtomicReference<String?>()
        onView(isAssignableFrom(WebView::class.java)).inRoot(isDialog()).perform(object:ViewAction {
            override fun getConstraints():Matcher<View> = isAssignableFrom(WebView::class.java)
            override fun getDescription()="Read isolated modeling page"
            override fun perform(controller:UiController,view:View) {
                (view as WebView).evaluateJavascript(expression){result.set(it)}
            }
        })
        compose.waitUntil(10000){result.get()!=null};return result.get()!!
    }
    @Composable private fun Frame(width:Int=390,palette:String="blue",dark:Boolean=false,language:String="ru",content:@Composable ()->Unit) {
        CompositionLocalProvider(LocalGenesisLanguage provides language,LocalDarkPalette provides palette,
            LocalEveningTheme provides dark,LocalSacredFeaturesEnabled provides true,
            LocalDensity provides Density(context.resources.displayMetrics.widthPixels.toFloat()/width,1.3f)) {
            MaterialTheme(colorScheme=if(dark)eveningPalette(palette)else daylightPalette(palette),
                typography=GenesisTypography,shapes=GenesisShapes) {
                androidx.compose.material3.Surface(Modifier.fillMaxSize()) {content()}
            }
        }
    }
    @Test fun invalidBootstrapReportsFailureAndNativeCloseAlwaysWorks() {
        clearSyntheticCache()
        var open by mutableStateOf(true)
        val invalid=source().put("seed",-1)
        compose.setContent {Frame {if(open)NativeAuroraDialog("regression334-owner",invalid,{open=false},{},Gateway())}}
        compose.waitUntil(15000){compose.onAllNodesWithTag("aurora-native-error").fetchSemanticsNodes().isNotEmpty()}
        compose.onNodeWithTag("aurora-native-close").performClick()
        compose.waitUntil(3000){!open}
        compose.onNodeWithTag("aurora-native-dialog").assertDoesNotExist()
    }
    @Test fun modelingLoadsAllFourteenLanguagesAndClosesWithEncryptedDraft() {
        clearSyntheticCache()
        val gateway=Gateway();var open by mutableStateOf(true);var language by mutableStateOf("ru")
        var dark by mutableStateOf(false);var epoch by mutableIntStateOf(0)
        compose.setContent {key(epoch){Frame(dark=dark,language=language) {
            if(open)NativeAuroraDialog("regression334-owner",source(),{open=false},{},gateway)
        }}}
        for(lang in listOf("ru","en","el","de","fr","es","it","pt","pl","sr","uk","zh","tr","ja")) {
            compose.runOnIdle {language=lang;epoch++}
            compose.waitUntil(20000){js("Boolean(document.querySelector('.gno-intake select, .gno-dialog select'))")=="true"}
            assertEquals("Correct document language $lang","\"$lang\"",js("document.querySelector('.gno-dialog').lang"))
            // Home reaches the compound Zeus Herkeios name that blanked step two.
            js("document.querySelector('.gno-progress button').click();true")
            compose.waitUntil(5000){js("Boolean(document.querySelector('.gno-intake select'))")=="true"}
            fun select(index:Int,value:String) {
                js("(()=>{const s=document.querySelectorAll('.gno-intake select')[$index];s.value='$value';s.dispatchEvent(new Event('change',{bubbles:true}));return true})()")
            }
            select(0,"3");select(1,"0")
            compose.waitUntil(5000){js("document.querySelectorAll('.gno-intake select').length")=="8"}
            for(index in 2..7)select(index,if(index==6)"10" else "0")
            assertEquals("The situation is complete in $lang","true",js("!document.querySelector('.gno-footer .primary-button').disabled"))
            js("document.querySelector('.gno-footer .primary-button').click();true")
            compose.waitUntil(10000){js("Boolean(document.querySelector('.gno-workspace'))")=="true"}
            assertEquals("All nine cards survive the compound-name calculation in $lang","9",js("document.querySelectorAll('.gno-tile').length"))
            assertEquals("Visible body in $lang","true",js("document.querySelector('.gno-body').getBoundingClientRect().height>100"))
            assertEquals("No horizontal overflow in $lang","true",js("document.documentElement.scrollWidth<=innerWidth"))
            compose.runOnIdle {dark=true}
            compose.waitUntil(5000){js("document.documentElement.dataset.genesisTheme")=="\"standart-dark\""}
            compose.onNodeWithTag("aurora-native-close").performClick()
            compose.waitUntil(15000){!open}
            assertNotNull("Encrypted draft saved for $lang",gateway.envelope)
            compose.runOnIdle {open=true;dark=false;epoch++}
        }
    }
    @Test fun springAnnouncementAndSaturdayFollowEveryPaletteAndWidth() {
        var width by mutableIntStateOf(390);var palette by mutableStateOf("blue")
        var dark by mutableStateOf(false);var language by mutableStateOf("ru")
        compose.setContent {Frame(width,palette,dark,language) {
            Column(Modifier.fillMaxSize().safeDrawingPadding()) {
                SpringYearSuggestionCard({}, {})
                CalendarDay(ru.genesis.calendar.domain.GenesisCalendar(),java.time.LocalDate.of(2026,12,5),5,
                    "сб","Суббота",true,{},Modifier.width(androidx.compose.ui.unit.Dp(80f)),null,null,0,null,
                    weekdayPatronMark(java.time.LocalDate.of(2026,12,5)))
            }
        }}
        for(w in listOf(360,390,768,1440))for(p in listOf("blue","burgundy","violet","green"))for(night in listOf(false,true)) {
            compose.runOnIdle {width=w;palette=p;dark=night}
            compose.onNodeWithTag("spring-year-suggestion").assertIsDisplayed()
            compose.onNodeWithTag("spring-year-switch").assertIsDisplayed()
            compose.onNodeWithTag("calendar-day-2026-12-05").assertIsSelected()
            captureNativeWindow(File(context.getExternalFilesDir(null),"release334-spring-saturday-$w-$p-$night.png"))
        }
        for(lang in listOf("ru","en","el","de","fr","es","it","pt","pl","sr","uk","zh","tr","ja")) {
            compose.runOnIdle {width=360;language=lang;dark=false}
            compose.onNodeWithText(springYearCopy(lang).body).assertIsDisplayed()
            compose.onNodeWithTag("spring-year-switch").assertIsDisplayed()
        }
    }
}
