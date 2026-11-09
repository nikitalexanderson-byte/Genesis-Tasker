package ru.genesis.calendar.ui

import android.content.res.Configuration
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.uiautomator.UiDevice
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.captureNativeWindow
import ru.genesis.calendar.auth.*
import ru.genesis.calendar.data.*
import ru.genesis.calendar.domain.CalendarMode
import java.io.File
import java.time.Instant
import java.time.LocalDate
import java.util.Base64
import java.util.concurrent.ConcurrentHashMap

private class Dream318Store:DiaryStore {
    @Volatile var encrypted:String?=null
    override suspend fun read()=encrypted
    override suspend fun write(ciphertext:String){encrypted=ciphertext}
}
private class Dream318Gateway:DiaryGateway {
    val rows=ConcurrentHashMap<String,JSONObject>()
    val key=ByteArray(32){(it+20).toByte()}
    var access=FeatureAccess()
    @Volatile var writes=0
    @Volatile var lastBody=""
    override fun check()=Unit
    override fun featureAccess()=access
    override suspend fun workspace()=JSONObject().put("workspace",JSONObject().put("keyMode","account").put("key",Base64.getEncoder().encodeToString(key)))
    private fun metadata()=JSONObject().put("settings",JSONObject().put("syncEnabled",true).put("revision",0)).put("deleted",JSONArray()).put("snapshot","0".repeat(64))
    override suspend fun request(path:String,body:JSONObject?):JSONObject {
        if(body==null){
            if(path.startsWith("/diary/dream-clock?"))return JSONObject().put("today","2026-11-04").put("timeZone",java.net.URLDecoder.decode(path.substringAfter("timeZone="),"UTF-8"))
            if(path=="/diary/dream-voice"){check(access.allows("dream-voice"));return JSONObject().put("allowed",true)}
            return metadata().put("notes",JSONArray(rows.values.toList()))
        }
        check(access.allows("dream-journal"));val dream=body.getJSONObject("dream")
        check(dream.getString("day")<="2026-11-04")
        val id=path.substringAfterLast('/');val old=rows[id];check((old?.getInt("revision")?:0)==body.getInt("expectedRevision"))
        lastBody=body.toString();writes++
        val row=JSONObject(body.toString()).put("id",id).put("revision",body.getInt("expectedRevision")+1).put("updatedAt","2026-11-04T00:00:00Z")
        rows[id]=row;return JSONObject().put("revision",row.getInt("revision")).put("updatedAt",row.getString("updatedAt"))
    }
}

/** Native views on a real device, with synthetic ciphertext and no production account. */
class Release318UiTest {
    @get:Rule val compose=createAndroidComposeRule<PagerTestActivity>()
    private val app get()=compose.activity.application as GenesisApplication
    private val languages=listOf("ru","en","el","de","fr","es","it","pt","pl","sr","uk","zh","tr","ja")
    private val width get()=InstrumentationRegistry.getArguments().getString("genesisWidth")?.toIntOrNull()?:390
    private var language by mutableStateOf("ru")
    private var palette by mutableStateOf("green")
    private val layouts=ConcurrentHashMap<String,TextLayoutResult>()
    private fun json(file:String)=JSONObject(app.assets.open("originals/i18n/$file.json").bufferedReader().use{it.readText()})
    private fun policy()=JSONObject(app.assets.open("originals/catalogs/feature-access-policy.json").bufferedReader().use{it.readText()})
    private fun access(plan:String):FeatureAccess {
        val features=policy().getJSONObject("features")
        fun allowed(p:String)=features.keys().asSequence().filter{key->val plans=features.getJSONArray(key)
            key!="assistant"&&(p=="premium4life"||(0 until plans.length()).any{plans.getString(it)==p})}.toSet()
        return FeatureAccess(enforcementEnabled=true,declaredPlan=plan,effectivePlan=if(plan=="premium4life")"business" else plan,
            lifetimePremium=plan=="premium4life",validUntil=Instant.now().plusSeconds(86_400),allowedFeatures=allowed(plan),freeFeatures=allowed("free"),limits=mapOf("diary" to 1000))
    }
    @Composable private fun Frame(access:FeatureAccess=access("premium"),upgrade:(String?)->Unit={},content: @Composable () -> Unit){
        val density=Density(compose.activity.resources.displayMetrics.widthPixels.toFloat()/width,1f)
        val configuration=Configuration(LocalConfiguration.current).apply{screenWidthDp=width;screenHeightDp=(compose.activity.resources.displayMetrics.heightPixels/density.density).toInt();fontScale=1f}
        CompositionLocalProvider(LocalDensity provides density,LocalConfiguration provides configuration,
            LocalGenesisLanguage provides language,LocalDarkPalette provides palette,LocalEveningTheme provides (palette!="light"),
            LocalFeatureAccess provides access,LocalNativeUpgrade provides upgrade,LocalGenesisTextLayoutAudit provides {text,result->layouts[text]=result}){
            MaterialTheme(colorScheme=if(palette=="light")standart else eveningPalette(palette),typography=GenesisTypography,shapes=GenesisShapes){
                Surface(Modifier.fillMaxSize().safeDrawingPadding()){content()}
            }
        }
    }
    private fun await(tag:String){compose.waitUntil(20_000){compose.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty()};compose.waitForIdle()}
    private fun capture(name:String){compose.waitForIdle();assertEquals("Only capture the isolated GENESIS app",app.packageName,UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).currentPackageName);captureNativeWindow(File(app.getExternalFilesDir(null),"318-$width-$language-$palette-$name.png"))}
    private fun noClippedLabels(){val clipped=layouts.filter{it.value.hasVisualOverflow};assertTrue("Clipped labels: ${clipped.keys}",clipped.isEmpty())}

    @Test fun dreamEditorAll14LanguagesAndFiveSchemesSaveCiphertextAndKeepActionsVisible(){
        val store=Dream318Store();val gateway=Dream318Gateway().also{it.access=access("premium")}
        val repository=DiaryRepository("dream318-fixture",gateway,store,DiaryKeystoreCipher("dream318-fixture","dream318-fixture"))
        compose.setContent{Frame{Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(12.dp)){
            DreamJournal(repository,LocalDate.of(2026,11,4),CalendarMode.PROFANE)
        }}}
        await("dream-record");compose.waitUntil(20_000){repository.state.value.ready}
        val proof=JSONArray()
        for(locale in languages)for(scheme in listOf("light","green","burgundy","blue","violet")){
            compose.runOnIdle{language=locale;palette=scheme;layouts.clear()}
            val text=json("dream-journal-copy").getJSONObject(locale)
            compose.onNodeWithTag("dream-record").performScrollTo().assertIsEnabled().assertHeightIsAtLeast(48.dp).performClick()
            await("dream-editor")
            compose.onNodeWithTag("dream-save").assertIsNotEnabled()
            val body="Synthetic dream $locale $scheme. This text must stay encrypted."
            compose.onNodeWithTag("dream-body").performTextReplacement(body)
            compose.waitUntil(10_000){compose.onAllNodes(hasTestTag("dream-save") and isEnabled()).fetchSemanticsNodes().size==1}
            compose.onNodeWithTag("dream-save").assertIsDisplayed().assertWidthIsAtLeast(48.dp).assertHeightIsAtLeast(48.dp)
            compose.onNodeWithTag("dream-voice").assertExists()
            capture("dream-editor");noClippedLabels()
            val before=gateway.writes;compose.onNodeWithTag("dream-save").performClick()
            compose.waitUntil(20_000){gateway.writes>before&&compose.onAllNodesWithTag("dream-editor").fetchSemanticsNodes().isEmpty()}
            assertFalse(gateway.lastBody.contains(body));assertFalse(store.encrypted.orEmpty().contains(body))
            assertEquals("2026-11-04",JSONObject(gateway.lastBody).getJSONObject("dream").getString("day"))
            assertEquals(text.getString("record"),compose.onNodeWithTag("dream-record").fetchSemanticsNode().config[androidx.compose.ui.semantics.SemanticsProperties.Text].joinToString(""){it.text})
            proof.put(JSONObject().put("language",locale).put("scheme",scheme).put("savedCiphertext",true).put("labelsUnclipped",true))
        }
        File(app.getExternalFilesDir(null),"318-dream-matrix-$width.json").writeText(proof.toString(2))
    }

    @Test fun freeCannotOpenDreamEditorAndStandardHasOnlyTextInput(){
        var plan by mutableStateOf("free");var requested:String?=null
        val gateway=Dream318Gateway();val repository=DiaryRepository("dream318-gates",gateway,Dream318Store(),DiaryKeystoreCipher("dream318-gates","dream318-gates"))
        compose.setContent{val policy=access(plan);gateway.access=policy;Frame(policy,{requested=it}){Column{DreamJournal(repository,LocalDate.of(2026,11,4),CalendarMode.PROFANE)}}}
        await("dream-record");compose.waitUntil(20_000){repository.state.value.ready}
        compose.onNodeWithTag("dream-record").performClick();compose.runOnIdle{assertEquals("dream-journal",requested)}
        compose.onNodeWithTag("dream-editor").assertDoesNotExist()
        compose.runOnIdle{plan="standart"};compose.onNodeWithTag("dream-record").performClick();await("dream-editor")
        compose.onNodeWithTag("dream-voice").assertDoesNotExist()
        compose.onNodeWithTag("dream-body").performTextReplacement("Standard supports text dreams.")
        compose.waitUntil(10_000){compose.onAllNodes(hasTestTag("dream-save") and isEnabled()).fetchSemanticsNodes().size==1}
        compose.onNodeWithTag("dream-save").performClick();compose.waitUntil(10_000){gateway.writes==1}
        compose.onNodeWithTag("dream-voice").assertDoesNotExist()
    }

    @Test fun all14PaletteMenusAndComparisonRowsKeepTheSamePlanGates(){
        var screen by mutableIntStateOf(0)
        compose.setContent{Frame{Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(12.dp)){
            if(screen==0)AppearancePanel(app,LocalHabitWorkspace(),true,"standart-dark",darkPalette=palette,onPalette={palette=it})
            else {NativeAccountPlanHeader();NativeUpgradeTier("premium",1,true,true,false,policy(),language,json("billing-feature-copy").getJSONObject(language),true,null){}}
        }}}
        for(locale in languages){
            compose.runOnIdle{screen=0;language=locale;palette="violet";layouts.clear()}
            val text=json("dark-palette-copy").getJSONObject(locale)
            compose.onNodeWithTag("appearance-palette").performScrollTo().performClick()
            compose.onNodeWithText(text.getString("blue"),useUnmergedTree=true).assertExists()
            compose.onNodeWithText(text.getString("burgundy"),useUnmergedTree=true).assertExists()
            capture("palette-menu");noClippedLabels()
            compose.onNodeWithText(text.getString("blue"),useUnmergedTree=true).performClick()
            compose.runOnIdle{assertEquals("blue",palette);screen=1;palette="violet";layouts.clear()}
            compose.onNodeWithTag("billing-feature-dream-journal",useUnmergedTree=true).performScrollTo().assertExists()
            compose.onNodeWithTag("billing-feature-dream-voice",useUnmergedTree=true).performScrollTo().assertExists()
            compose.onNodeWithTag("billing-feature-dark-palettes",useUnmergedTree=true).performScrollTo().assertExists()
            capture("comparison");noClippedLabels()
            for(plan in nativeBillingPlans){val rows=nativeBillingPlanFeatureRows(policy(),plan,locale,json("billing-feature-copy").getJSONObject(locale))
                assertEquals(plan!="free",rows.single{it.feature=="dream-journal"}.included)
                assertEquals(plan in listOf("premium","business","premium4life"),rows.single{it.feature=="dream-voice"}.included)
                assertEquals(plan in listOf("premium","business","premium4life"),rows.single{it.feature=="dark-palettes"}.included)
            }
        }
    }

    @Test fun yearlyTaskCountersOpenModalsWithoutNavigatingAndMonthStillNavigates(){
        val day=LocalDate.of(2026,11,4);var selected=day
        val menu=MenuSwipeState().also{it.calendar="year"}
        val tasks=listOf(LocalTask("318-year-task","Synthetic monthly task",date=day.toString()))
        val shared=SharedCalendarEntry("318-shared","Synthetic shared monthly task",day.toString(),"Synthetic project",false)
        compose.setContent{Frame{CalendarScreen(day,CalendarMode.PROFANE,{selected=it},tasks=tasks,menuSwipeState=menu,
            sharedCounts=mapOf(day.toString() to 1),loadSharedDay={listOf(shared)})}}
        await("calendar-year")
        compose.onNodeWithTag("calendar-year").performScrollToNode(hasTestTag("calendar-year-open-tasks-11"))
        compose.onNodeWithTag("calendar-year-open-tasks-11").performScrollTo().assertHeightIsAtLeast(48.dp).performClick()
        await("calendar-year-task-dialog");compose.onNodeWithText("Synthetic monthly task",substring=true).assertExists()
        assertEquals("year",menu.calendar);assertEquals(day,selected);capture("personal-month-tasks")
        compose.onNode(hasContentDescription("Закрыть") and hasAnyAncestor(hasTestTag("calendar-year-task-dialog"))).performClick()
        compose.onNodeWithTag("calendar-year-open-shared-11").performScrollTo().performClick();await("calendar-year-task-dialog")
        compose.waitUntil(10_000){compose.onAllNodesWithText("Synthetic shared monthly task",substring=true).fetchSemanticsNodes().isNotEmpty()}
        assertEquals("year",menu.calendar);assertEquals(day,selected);capture("shared-month-tasks")
        compose.onNode(hasContentDescription("Закрыть") and hasAnyAncestor(hasTestTag("calendar-year-task-dialog"))).performClick()
        compose.onNodeWithTag("calendar-year-month-2026-11-01").performScrollTo().performClick()
        compose.runOnIdle{assertEquals("month",menu.calendar)}
    }
}
