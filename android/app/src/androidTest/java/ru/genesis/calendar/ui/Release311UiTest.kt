package ru.genesis.calendar.ui

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.auth.DailyAdvice
import ru.genesis.calendar.auth.DailyAdviceSource
import ru.genesis.calendar.captureNativeWindow
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.data.MindmapDocument
import ru.genesis.calendar.data.MindmapNode
import java.io.File
import java.io.IOException
import java.util.concurrent.atomic.AtomicInteger

class Release311UiTest {
    @get:Rule val compose=createAndroidComposeRule<PagerTestActivity>()
    private val args get()=InstrumentationRegistry.getArguments()
    private val width get()=args.getString("genesisWidth")?.toIntOrNull() ?: 390
    private val dark get()=args.getString("genesisDark")=="true"
    private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
    @Composable private fun Frame(content:@Composable ()->Unit) {
        CompositionLocalProvider(LocalDensity provides Density(compose.activity.resources.displayMetrics.widthPixels.toFloat()/width,
            args.getString("genesisFontScale")?.toFloatOrNull() ?: 1f),LocalGenesisLanguage provides "ru",LocalEveningTheme provides dark) {
            MaterialTheme(colorScheme=if(dark)evening else standart,typography=GenesisTypography,shapes=GenesisShapes) {
                Surface(Modifier.fillMaxSize()) {content()}
            }
        }
    }
    private fun capture(name:String) {compose.waitForIdle();captureNativeWindow(File(context.getExternalFilesDir(null),"311-$width-${if(dark)"dark" else "light"}-$name.png"))}
    @Test fun draggingSurvivesScrollingTheSourceCompletelyOutOfView() {
        var picked by mutableStateOf(false);var cancelled=0;var completed=0;var moves=0
        lateinit var scrollAway:()->Unit
        compose.setContent {Frame {
            val list=rememberLazyListState();val scope=rememberCoroutineScope()
            scrollAway={scope.launch {list.scrollToItem(18)}}
            WorkspaceDragHost(Modifier.fillMaxSize()) { LazyColumn(state=list) {
                item(key="source") {DraggableWorkspaceBlock("source","Исходная карточка",picked,
                    {picked=true},{moves++},{cancel->if(cancel)cancelled++ else completed++;picked=false}) {Box(Modifier.height(120.dp))}}
                items(40) {Box(Modifier.height(120.dp))}
            }}
        }}
        compose.onNodeWithTag("drag-block-source").performTouchInput {down(center)}
        compose.mainClock.advanceTimeBy(800)
        compose.onRoot().performTouchInput {moveBy(Offset(0f,20f))}
        compose.runOnIdle {assertTrue(picked);scrollAway()};compose.waitForIdle()
        assertEquals(0,cancelled)
        compose.onRoot().performTouchInput {moveBy(Offset(0f,40f));up()}
        compose.runOnIdle {assertEquals(0,cancelled);assertEquals(1,completed);assertTrue(moves>=2)}
    }
    @Test fun selectedDayGlassKeepsArtworkAndCompactReadableContentInEveryCalendar() {
        var mode by mutableStateOf(CalendarMode.PROFANE)
        var date by mutableStateOf(java.time.LocalDate.of(2026,4,1))
        compose.setContent { Frame { CalendarScreen(date,mode,{},experimental=true) } }
        capture("april-month-header")
        compose.runOnIdle { date=java.time.LocalDate.of(2026,10,29) }
        for(choice in CalendarMode.entries) {
            compose.runOnIdle { mode=choice }
            compose.onNodeWithTag("calendar-selected-day").performScrollTo()
            compose.onNodeWithTag("calendar-day-hero").assertHeightIsAtLeast(100.dp)
            compose.onNodeWithTag("calendar-weekday-art",useUnmergedTree=true).assertExists()
            capture("selected-day-${choice.wireValue}")
        }
    }
    @Test fun allCalendarsKeepArrowsBelowThePeriodAndTodayAtTheMonthDescriptionCorner() {
        var mode by mutableStateOf(CalendarMode.PROFANE)
        val navigation=MenuSwipeState()
        compose.setContent { Frame { CalendarScreen(java.time.LocalDate.of(2026,10,29),mode,{},
            experimental=true,menuSwipeState=navigation) } }
        for(choice in CalendarMode.entries) {
            compose.runOnIdle { mode=choice;navigation.calendar="month" }
            compose.onNodeWithTag("calendar-month-navigation").performScrollTo()
            val previous=compose.onNodeWithTag("calendar-month-previous").fetchSemanticsNode().boundsInRoot
            val next=compose.onNodeWithTag("calendar-month-next").fetchSemanticsNode().boundsInRoot
            val period=compose.onNodeWithTag("calendar-month-period").fetchSemanticsNode().boundsInRoot
            val hero=compose.onNodeWithTag("month-description-layout").fetchSemanticsNode().boundsInRoot
            assertTrue(previous.left>=hero.left && next.right<=hero.right && previous.top>period.bottom && next.top>period.bottom)
            assertEquals(previous.center.y,next.center.y,1f)
            compose.onNodeWithTag("calendar-month-today").performScrollTo()
            val today=compose.onNodeWithTag("calendar-month-today").fetchSemanticsNode().boundsInRoot
            val description=compose.onNodeWithTag("month-description-layout").fetchSemanticsNode().boundsInRoot
            assertTrue(today.right<=description.right+1f && today.right>=description.right-40f)
            assertTrue(today.top>=description.top && today.top<description.top+50f)
            capture("month-today-${choice.wireValue}")
            compose.runOnIdle { navigation.calendar="year" }
            compose.onNodeWithTag("calendar-month-today").assertDoesNotExist()
            compose.onNodeWithText("Сегодня").assertDoesNotExist()
            capture("year-${choice.wireValue}")
        }
    }
    @Test fun manualUpdateFailureCanRetryWithoutAnyAccountSession() {
        val calls=AtomicInteger()
        compose.setContent {Frame {AndroidUpdateCheckAction(iconOnly=false,check={if(calls.incrementAndGet()==1)throw IOException("offline") else null})}}
        compose.onNodeWithTag("app-update-check-settings").performClick()
        compose.waitUntil(10000) {compose.onAllNodesWithTag("app-update-check-retry").fetchSemanticsNodes().isNotEmpty()}
        compose.onNodeWithText("Установлена актуальная версия").assertDoesNotExist();capture("update-error")
        compose.onNodeWithTag("app-update-check-retry").performClick()
        compose.waitUntil(10000) {compose.onAllNodesWithText("Установлена актуальная версия").fetchSemanticsNodes().isNotEmpty()}
        assertEquals(2,calls.get());capture("update-current")
    }
    @Test fun manualUpdateOpensTheDownloadDialogWithoutSynchronization() {
        compose.setContent {Frame {AndroidUpdateCheckAction(iconOnly=false,check={AndroidRelease(999,"3.1.1","a".repeat(64))})}}
        compose.onNodeWithTag("app-update-check-settings").performClick()
        compose.waitUntil(10000) {compose.onAllNodesWithTag("android-update-dialog").fetchSemanticsNodes().isNotEmpty()}
        compose.onNodeWithTag("android-update-download").assertIsEnabled();capture("update-available")
    }
    @Test fun connectionCancelAndSecondNodeClicksAreIndependentOfCanvasGestures() {
        val root=MindmapNode("root",null,text="Главная мысль");val child=MindmapNode("child","root",text="Вторая мысль")
        val map=MindmapDocument("fixture","Карта",nodes=listOf(root,child))
        val view=JSONObject().put("zoom",1).put("positions",JSONObject().put("root",JSONObject().put("x",24).put("y",24))
            .put("child",JSONObject().put("x",24).put("y",136)))
        var links=0;var opens=0;var affairs=0
        compose.setContent {Frame {NativeMindmapCanvas(map,map.rows(),view,{it.text},{opens++},{},{},{_,_->links++},Modifier.fillMaxSize(),onAffair={affairs++})}}
        compose.onNodeWithTag("mindmap-connect-root").performClick();compose.onNodeWithTag("mindmap-cancel-link").assertIsDisplayed();capture("connection")
        compose.onNodeWithTag("mindmap-cancel-link").performClick();compose.onNodeWithTag("mindmap-cancel-link").assertDoesNotExist()
        compose.onNodeWithTag("mindmap-node-child").performClick();assertEquals(1,opens);assertEquals(0,links)
        compose.onNodeWithTag("mindmap-connect-root").performClick();compose.onNodeWithTag("mindmap-node-child").performClick()
        assertEquals(1,links);compose.onNodeWithTag("mindmap-cancel-link").assertDoesNotExist()
        compose.onNodeWithTag("mindmap-canvas").performTouchInput {longClick(Offset(width*.7f,height*.85f))}
        compose.onNodeWithTag("mindmap-context-add").assertIsDisplayed();compose.onNodeWithTag("mindmap-context-home").assertIsDisplayed();capture("context-menu")
        compose.onNodeWithTag("mindmap-context-affair").performClick();assertEquals(1,affairs)
    }
    @Test fun exportedAdviceContainsArtworkAndFullTextAndSharesAnAccessiblePng() {
        val short=DailyAdvice("advice-"+"a".repeat(24),"2026-10-29","Практика ясности","Первый абзац.","ru",listOf("aretology"),null,false,
            listOf(DailyAdviceSource("quote","Автор","Источник","Глава 1")))
        val artwork=Bitmap.createBitmap(640,320,Bitmap.Config.ARGB_8888).apply {eraseColor(android.graphics.Color.rgb(37,91,89))}
        val small=adviceShareBitmap(short,artwork)
        val long=short.copy(body=(1..70).joinToString("\n") {"Полный абзац $it — без сокращений."})
        val full=adviceShareBitmap(long,artwork)
        assertTrue(full.height>small.height+2000);assertEquals(1080,full.width)
        File(context.getExternalFilesDir(null),"311-share-fixture.png").outputStream().use {full.compress(Bitmap.CompressFormat.PNG,100,it)}
        val intent=adviceShareIntent(context,long,artwork)
        assertEquals("image/png",intent.type);assertTrue(intent.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0)
        assertTrue(intent.getStringExtra(Intent.EXTRA_TEXT)!!.contains(adviceApplicationUrl))
        val uri=intent.getParcelableExtra<android.net.Uri>(Intent.EXTRA_STREAM)!!
        context.contentResolver.openInputStream(uri).use {assertNotNull(BitmapFactory.decodeStream(it))}
        small.recycle();full.recycle();artwork.recycle()
    }
}
