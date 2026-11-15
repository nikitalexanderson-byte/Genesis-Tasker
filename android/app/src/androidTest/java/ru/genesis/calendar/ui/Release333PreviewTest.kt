package ru.genesis.calendar.ui

import android.webkit.WebView
import android.view.View
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.ViewAction
import androidx.test.espresso.UiController
import androidx.test.espresso.matcher.ViewMatchers.isAssignableFrom
import androidx.test.espresso.matcher.RootMatchers.isDialog
import androidx.test.uiautomator.UiDevice
import org.hamcrest.Matcher
import org.json.JSONObject
import org.json.JSONArray
import org.json.JSONTokener
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.captureNativeWindow
import ru.genesis.calendar.auth.*
import ru.genesis.calendar.data.*
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.StoicheionReading
import java.io.File
import java.time.LocalDate
import java.util.Base64
import java.util.concurrent.atomic.AtomicReference
import java.util.concurrent.atomic.AtomicBoolean

/** Emulator only, synthetic local data. Never authenticates or contacts the public API. */
class Release333PreviewTest {
    @get:Rule val compose=createAndroidComposeRule<PagerTestActivity>()
    private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
    private val app get()=context.applicationContext as GenesisApplication
    private fun shot(name:String) {
        compose.waitForIdle()
        if(compose.onAllNodesWithTag("olympian-native-webview").fetchSemanticsNodes().isNotEmpty() ||
            compose.onAllNodesWithTag("aurora-native-webview").fetchSemanticsNodes().isNotEmpty()) {
            val ready=AtomicBoolean(false)
            onView(isAssignableFrom(WebView::class.java)).inRoot(isDialog()).perform(object:ViewAction {
                override fun getConstraints():Matcher<View> = isAssignableFrom(WebView::class.java)
                override fun getDescription()="Wait for committed local WebView drawing"
                override fun perform(controller:UiController,view:View) {
                    (view as WebView).postVisualStateCallback(333,object:WebView.VisualStateCallback(){override fun onComplete(id:Long){ready.set(true)}})
                }
            })
            compose.waitUntil(10000){ready.get()}
        }
        captureNativeWindow(File(context.getExternalFilesDir(null),"release333-$name.png"))
    }
    @Composable private fun Frame(width:Int=390,palette:String="blue",dark:Boolean=false,fontScale:Float=1f,content:@Composable ()->Unit) {
        CompositionLocalProvider(LocalGenesisLanguage provides "ru",LocalDarkPalette provides palette,
            LocalEveningTheme provides dark,LocalSacredFeaturesEnabled provides true,
            LocalDensity provides Density(context.resources.displayMetrics.widthPixels.toFloat()/width,fontScale)) {
            MaterialTheme(colorScheme=if(dark)eveningPalette(palette)else daylightPalette(palette),
                typography=GenesisTypography,shapes=GenesisShapes) {
                SideEffect {androidx.core.view.WindowInsetsControllerCompat(compose.activity.window,
                    compose.activity.window.decorView).isAppearanceLightStatusBars = !dark}
                Surface(Modifier.fillMaxSize()) { Box(Modifier.safeDrawingPadding()) { content() } }
            }
        }
    }
    @Test fun timelineCardsKeepTheirHeightWhenRevealed() {
        val baseline=InstrumentationRegistry.getArguments().getString("genesisBaseline")=="true"
        val now=java.time.Instant.parse("2026-11-15T10:01:00Z").toEpochMilli()
        val catalog=JSONArray(context.assets.open("stoicheion.json").bufferedReader().use {it.readText()})
        val letters=(0 until catalog.length()).map {i->catalog.getJSONObject(i).let {item->
            StoicheionLetter(item.getString("id"),i,item.getString("name"),item.getString("symbol"),
                item.getString("lowercase"),item.getInt("value"),item.getInt("pythmen"),item.getString("tagline"),
                item.getString("content"),"","","",androidx.compose.ui.graphics.Color(0xffdfc17e))
        }}
        val initial=StoicheionTimelineState("2026-11-15","2026-11-09",0x12345678L,0,now,emptyList(),0)
        var session by mutableStateOf(initial)
        var width by mutableIntStateOf(390);var language by mutableStateOf("ru")
        var dark by mutableStateOf(true);var fontScale by mutableFloatStateOf(1f)
        compose.setContent {Frame(width=width,palette="violet",dark=dark,fontScale=fontScale) {
            CompositionLocalProvider(LocalGenesisLanguage provides language) {
                Column(Modifier.verticalScroll(rememberScrollState()).padding(12.dp)) {
                    StoicheionTimelinePanel(letters,session.asDraw(),true,now,false,{}, {},session,{_,_->})
                }
            }
        }}
        compose.onNodeWithTag("stoicheion-timeline-cards").performScrollTo()
        if(baseline){shot("timeline-before");return}
        val languages=listOf("ru","en","el","de","fr","es","it","pt","pl","sr","uk","zh","tr","ja")
        val cases=if(InstrumentationRegistry.getArguments().getString("genesisTimelineCompact")=="true")listOf(Triple(390,"ru",1f))else buildList {
            for(w in listOf(360,390,768,1440))for(lang in listOf("ru","en"))for(scale in listOf(1f,1.3f))add(Triple(w,lang,scale))
            for(lang in languages)add(Triple(360,lang,1.3f))
        }.distinct()
        for((w,lang,scale)in cases)for(night in listOf(false,true)) {
            compose.runOnIdle {width=w;language=lang;fontScale=scale;dark=night;session=initial}
            var originalHeight:Float?=null
            for(count in 0..3) {
                android.util.Log.i("GenesisTimelineQA","$w/$lang/$scale/$night/$count")
                compose.runOnIdle {session=initial.copy(cards=(0 until count).map {StoicheionTimelineWindow(it,now,now+180000,false,true)})}
                val bounds=listOf("past","present","future").map {id->
                    compose.onNodeWithTag("stoicheion-timeline-$id").fetchSemanticsNode().boundsInRoot
                }
                val label="$w/$lang/$scale/$night/$count"
                assertTrue("Equal sibling heights $label: $bounds",bounds.maxOf {it.height}-bounds.minOf {it.height}<=2f)
                if(originalHeight==null)originalHeight=bounds.first().height
                assertEquals("Stable height across reveal states $label",originalHeight!!,bounds.first().height,2f)
                if(w==390&&lang=="ru"&&scale==1f) {
                    compose.onNodeWithTag("stoicheion-timeline-cards").performScrollTo()
                    shot("timeline-$count-${if(night)"dark"else"light"}")
                }
            }
        }
    }
    private fun js(expression:String):String {
        val result=AtomicReference<String?>()
        onView(isAssignableFrom(WebView::class.java)).inRoot(isDialog()).perform(object:ViewAction {
            override fun getConstraints():Matcher<View> = isAssignableFrom(WebView::class.java)
            override fun getDescription()="Inspect local shared module"
            override fun perform(controller:UiController,view:View) {
                (view as WebView).evaluateJavascript("JSON.stringify(($expression))") {
                    result.set(JSONTokener(it).nextValue() as? String ?: "null")
                }
            }
        })
        compose.waitUntil(15000){result.get()!=null}
        return result.get()!!
    }
    @Test fun diaryStoreScreensUseSyntheticEncryptedNotes() {
        var language by mutableStateOf("ru")
        val repository=DiaryRepository("store333-diary",DiaryUiGateway(),DiaryUiStore(),
            DiaryKeystoreCipher("store333-diary","store333-diary"))
        runBlocking {
            repository.refresh()
            repository.save(DiaryNote.create("Идея для выходных\nПройти новый маршрут в парке и взять книгу."))
            repository.save(DiaryNote.create("Планы на неделю\nВыделить время для чтения, прогулок и нового проекта."))
        }
        compose.setContent {Frame {CompositionLocalProvider(LocalGenesisLanguage provides language) {
            MobileWorkspaceShell("Дневник",null,emptyList(),"",true,onNavigate={}) {DiaryScreen(repository,{})}
        }}}
        compose.waitUntil(15000){compose.onAllNodesWithTag("diary-screen").fetchSemanticsNodes().isNotEmpty()}
        shot("diary-ru-light")
        runBlocking {
            repository.state.value.records.forEachIndexed {index,record->repository.save(record.note.changed {
                put("body",if(index==0)"An idea for the weekend\nExplore a new route in the park and bring a book."
                    else "Plans for the week\nMake time for reading, walks and a new project.")
            },record.revision)}
        }
        compose.runOnIdle {language="en"}
        shot("diary-en-light")
    }
    @Test fun todayDaytimeWithoutSacredFeatures() {
        val scene=InstrumentationRegistry.getArguments().getString("genesisScene","daytime")
        if(scene=="daytime")assertTrue("Emulator must show daytime",java.time.LocalTime.now().hour in 10..15)
        val controller=AuthController.get(context)
        val field=AuthController::class.java.getDeclaredField("mutableState").apply {isAccessible=true}
        @Suppress("UNCHECKED_CAST") val state=field.get(controller) as MutableStateFlow<AuthPanelState>
        val before=state.value
        val prefs=LocalPreferences(app,app.workspaceScope)
        SolarPlaceStore.save(SolarPlaceStore.preferences(context),SolarPlace("Москва","Россия","",55.7558,37.6173,"Europe/Moscow"))
        val habits=HabitsRepository(app)
        val originalHabits=runBlocking {habits.workspace.first()}
        val settings=AccountSettings(emptyList(),SyncRouting("fixed",emptyList(),emptyMap()),false,
            "standart",1,"profane","profane","24",true,"ru",uiVisibility=UiVisibility(sacredFeaturesEnabled=false))
        state.value=AuthPanelState(ready=true,accountSettings=settings)
        runBlocking {prefs.set("theme","standart");prefs.set("language","ru");prefs.set("darkPalette","blue")}
        compose.setContent {GenesisApp(app,null,openedSection="Сегодня",testWorkspace=true)}
        try {
            compose.waitUntil(20000){compose.onAllNodesWithTag("today-civil-date").fetchSemanticsNodes().isNotEmpty()}
            for(p in listOf("blue","burgundy","violet","green")) for(dark in listOf(false,true)) {
                runBlocking {
                    prefs.set("darkPalette",p);prefs.set("theme",if(dark)"standart-dark"else"standart")
                    habits.updateSettings(originalHabits.settings.copy(rawJson=JSONObject(originalHabits.settings.rawJson)
                        .put("nativeAppearance",JSONObject().put("mode",if(dark)"evening"else"light")).toString()))
                }
                compose.waitForIdle()
                compose.onNodeWithTag("today-calendar-image").assertDoesNotExist()
                compose.onNodeWithTag("today-day-rhythm").assertDoesNotExist()
                compose.onNodeWithTag("today-civil-clock").assertExists()
                compose.onNodeWithText("Москва, Россия").assertExists()
                // Let the actual terrain bitmap load before taking the device screenshot.
                InstrumentationRegistry.getInstrumentation().waitForIdleSync()
                Thread.sleep(1000)
                shot("today-$scene-$p-${if(dark)"dark"else"light"}")
            }
        } finally {state.value=before;runBlocking {habits.updateSettings(originalHabits.settings)}}
    }
    @Test fun calendarAndHeroColorsAcrossAllPalettes() {
        var width by mutableIntStateOf(390);var palette by mutableStateOf("blue");var dark by mutableStateOf(false)
        var hero by mutableStateOf(false);var epoch by mutableIntStateOf(0)
        compose.setContent {key(epoch){Frame(width,palette,dark) {
            if(hero) Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(12.dp)) {
                HabitArtGallery(LocalHabitWorkspace(),LocalDate.now(),false,{}, {}, {},false)
            } else CalendarScreen(LocalDate.of(2026,10,31),CalendarMode.PROFANE,{})
        }}}
        for(w in listOf(360,390,768,1440)) for(p in listOf("blue","burgundy","violet","green")) for(night in listOf(false,true)) {
            compose.runOnIdle {width=w;palette=p;dark=night;hero=false;epoch++}
            compose.onNodeWithTag("month-description-layout").assertExists()
            if(w==390 && night) {
                for(day in 25..31) {
                    val cell=compose.onNodeWithTag("calendar-day-2026-10-$day")
                    cell.performScrollTo().performClick()
                    cell.assertIsSelected()
                    compose.onNodeWithTag("month-description-layout").performScrollTo()
                    shot("calendar-selection-$p-$day-dark")
                }
                compose.onNodeWithTag("month-description-layout").performScrollTo()
            }
            Thread.sleep(350)
            shot("calendar-$w-$p-${if(night)"dark"else"light"}")
        }
        if(InstrumentationRegistry.getArguments().getString("genesisCalendarOnly")=="true")return
        for(p in listOf("blue","burgundy","violet","green")) for(night in listOf(false,true)) {
            compose.runOnIdle {width=390;palette=p;dark=night;hero=true;epoch++}
            compose.onNodeWithTag("all-hero-ranks").performClick()
            Thread.sleep(350)
            shot("hero-$p-${if(night)"dark"else"light"}")
            compose.onNodeWithTag("hero-checkpoint-icarus").performScrollTo()
            shot("amphora-$p-${if(night)"dark"else"light"}")
        }
    }
    @Test fun olympianSharedReadingsAndSearchAreAvailableOffline() {
        var open by mutableStateOf(true)
        var language by mutableStateOf("ru")
        var dark by mutableStateOf(false)
        var epoch by mutableIntStateOf(0)
        compose.setContent {key(epoch){Frame(dark=dark){CompositionLocalProvider(LocalGenesisLanguage provides language) {
            if(open)NativeOlympianDialog("13 олимпийцев и их сакральные числа",{open=false},{},{})
        }}}}
        for(lang in listOf("ru","en","el","de","fr","es","it","pt","pl","sr","uk","zh","tr","ja")) {
            compose.runOnIdle {language=lang;epoch++}
            compose.waitUntil(20000){js("document.querySelectorAll('.olympian-tile').length")=="13"}
            compose.waitUntil(15000){js("Boolean(document.querySelector('input[type=search]'))")=="true"}
            assertEquals("Reading opens in $lang","true",js("(document.querySelector('[data-olympian=zeus]').click(),true)"))
            compose.waitUntil(15000){js("document.querySelectorAll('.olympian-knowledge details').length") !in listOf("0","null")}
            assertEquals("Reading must occupy a visible viewport in $lang","true",
                js("document.querySelector('.olympian-reading-modal').getBoundingClientRect().height>200"))
            if(lang in listOf("ru","en")) {
                File(context.getExternalFilesDir(null),"release333-olympian-$lang-layout.json").writeText(js("({viewport:[innerWidth,innerHeight,visualViewport?.height],dialog:[...document.querySelectorAll('.olympian-backdrop,.olympian-modal,.olympian-knowledge')].map(e=>({class:e.className,rect:JSON.stringify(e.getBoundingClientRect()),display:getComputedStyle(e).display,visibility:getComputedStyle(e).visibility,position:getComputedStyle(e).position,maxHeight:getComputedStyle(e).maxHeight,transform:getComputedStyle(e).transform})),text:document.body.innerText})"))
                shot("olympians-$lang-light")
            }
            js("document.querySelector('.olympian-knowledge summary').click()")
            assertTrue(js("document.querySelector('.olympian-letter-equation').textContent").contains("612"))
        }
        compose.runOnIdle {language="ru";dark=true;epoch++}
        compose.waitUntil(20000){js("document.querySelectorAll('.olympian-tile').length")=="13"}
        shot("olympians-catalog-ru-dark")
    }
    @OptIn(ExperimentalTestApi::class)
    @Test fun weekdayHoverPreview() {
        compose.setContent {Frame(dark=true) {CalendarScreen(LocalDate.of(2026,10,25),CalendarMode.PROFANE,{})}}
        val hovered=compose.onNodeWithTag("calendar-day-2026-10-28")
        hovered.performMouseInput {enter(center)}
        hovered.assertIsNotSelected()
        compose.onNodeWithTag("calendar-day-2026-10-25").assertIsSelected()
        shot("calendar-hover-blue-28-dark")
        hovered.performMouseInput {exit()}
    }
    @Test fun weekdayMotionPreview() {
        val diagnostics=JSONObject().put("animatorsEnabled",android.animation.ValueAnimator.areAnimatorsEnabled())
            .put("durationScale",android.animation.ValueAnimator.getDurationScale())
            .put("setting",android.provider.Settings.Global.getString(context.contentResolver,"animator_duration_scale"))
        File(context.getExternalFilesDir(null),"release333-motion-settings.json").writeText(diagnostics.toString())
        assertTrue("Motion preview needs enabled system animations: $diagnostics",android.animation.ValueAnimator.areAnimatorsEnabled())
        // The Compose test policy cancels infinite transitions when autoAdvance is true.
        compose.mainClock.autoAdvance=false
        try {
        compose.setContent {Frame(dark=true) {CalendarScreen(LocalDate.of(2026,10,25),CalendarMode.PROFANE,{})}}
        compose.onNodeWithTag("month-description-layout").assertExists()
        fun borderSample():List<androidx.compose.ui.graphics.Color> {
            val pixels=compose.onNodeWithTag("calendar-day-2026-10-25").captureToImage().toPixelMap()
            return listOf(pixels[pixels.width/2,2],pixels[2,pixels.height/2],
                pixels[pixels.width-3,pixels.height/2],pixels[pixels.width/2,pixels.height-3])
        }
        compose.mainClock.advanceTimeBy(240)
        val first=borderSample()
        compose.mainClock.advanceTimeBy(1200)
        assertNotEquals("The metallic highlight must actually move",first,borderSample())
        File(context.getExternalFilesDir(null),"release333-motion-ready.txt").writeText("ready")
        var previous=android.os.SystemClock.uptimeMillis()
        val deadline=previous+10000
        while(android.os.SystemClock.uptimeMillis()<deadline) {
            val now=android.os.SystemClock.uptimeMillis()
            compose.mainClock.advanceTimeBy((now-previous).coerceAtLeast(1))
            previous=now
            Thread.sleep(20)
        }
        } finally {compose.mainClock.autoAdvance=true}
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
        override suspend fun billing(method:String,path:String,body:JSONObject?)=error("No real billing in preview")
    }
    @Test fun currentModelingWizardLoadsAndPreservesWorkOnClose() {
        val ids="alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega".split(" ")
        val source=JSONObject().put("id","preview333-source").put("seed",2).put("day","2026-11-15").put("createdAt","2026-11-15T09:00:00Z")
            .put("cards",JSONArray(StoicheionReading.spread(ids,2L).map{(id,reversed)->JSONObject().put("cardId",id).put("reversed",reversed)}))
        val gateway=Gateway();var open by mutableStateOf(true);var dark by mutableStateOf(false)
        compose.setContent {Frame(dark=dark) {if(open)NativeAuroraDialog("preview333-synthetic-owner",source,{open=false},{},gateway)}}
        compose.waitUntil(25000){js("Boolean(document.querySelector('.gno-dialog select'))")=="true"}
        assertEquals("No page overflow","true",js("document.documentElement.scrollWidth<=window.innerWidth"))
        shot("future-modeling-light")
        compose.runOnIdle {dark=true}
        compose.waitUntil(10000){js("document.documentElement.dataset.genesisTheme")=="\"standart-dark\""}
        shot("future-modeling-dark")
        compose.onNodeWithTag("aurora-native-close").performClick()
        compose.waitUntil(15000){!open}
        assertNotNull("Draft saved through the encrypted native bridge",gateway.envelope)
    }
}
