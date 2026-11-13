package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.*
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.captureNativeWindow
import ru.genesis.calendar.auth.DiaryGateway
import ru.genesis.calendar.data.*
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.security.WorkspaceCipher
import java.io.File
import java.time.LocalDate
import java.util.Base64

private class DreamQaGateway:DiaryGateway {
    val key=ByteArray(32){(it+19).toByte()};val rows=mutableMapOf<String,JSONObject>()
    override fun check()=Unit
    override suspend fun workspace()=JSONObject().put("workspace",JSONObject().put("keyMode","account").put("key",Base64.getEncoder().encodeToString(key)))
    override suspend fun request(path:String,body:JSONObject?):JSONObject {
        if(path.startsWith("/diary/dream-clock"))return JSONObject().put("today",LocalDate.now().toString()).put("timeZone",java.net.URLDecoder.decode(path.substringAfter("timeZone="),"UTF-8"))
        if(body==null)return JSONObject().put("notes",JSONArray(rows.values.toList()))
        val id=path.substringAfterLast('/');check((rows[id]?.optLong("revision")?:0L)==body.getLong("expectedRevision"))
        val revision=body.getLong("expectedRevision")+1;val now=java.time.Instant.now().toString()
        rows[id]=JSONObject(body.toString()).put("id",id).put("revision",revision).put("updatedAt",now)
        return JSONObject().put("revision",revision).put("updatedAt",now)
    }
    override suspend fun remove(id:String,expectedRevision:Long):JSONObject {
        check(rows.getValue(id).getLong("revision")==expectedRevision);rows.remove(id)
        return JSONObject().put("id",id).put("revision",expectedRevision+1).put("updatedAt",java.time.Instant.now().toString()).put("deleted",true)
    }
}
private class DreamQaStore:DiaryStore {var raw:String?=null;override suspend fun read()=raw;override suspend fun write(ciphertext:String){raw=ciphertext}}
private class DreamQaCipher:DiaryCacheCipher {
    private val key=ByteArray(32){(it+39).toByte()};private val aad="synthetic-dream-cache".toByteArray()
    override fun encrypt(plaintext:String):String=WorkspaceCipher.encrypt(plaintext.toByteArray(),key,aad).let{JSONObject().put("iv",it.iv).put("ciphertext",it.ciphertext).toString()}
    override fun decrypt(ciphertext:String):String=JSONObject(ciphertext).let{WorkspaceCipher.decrypt(WorkspaceCipher.Envelope(it.getString("ciphertext"),it.getString("iv")),key,aad).toString(Charsets.UTF_8)}
}
class Release321UiTest {
    @get:Rule val compose=createAndroidComposeRule<PagerTestActivity>()
    private val args get()=InstrumentationRegistry.getArguments()
    private fun capture(name:String){captureNativeWindow(File(compose.activity.getExternalFilesDir(null),"release321-$name.png"))}
    @Test fun emptyDreamHistoryWrapsContentInBothSchemes331() {
        val repository=DiaryRepository("synthetic-empty-dream-331",DreamQaGateway(),DreamQaStore(),DreamQaCipher())
        runBlocking { repository.refresh() }
        var night by mutableStateOf(false)
        compose.setContent { CompositionLocalProvider(LocalGenesisLanguage provides "ru", LocalEveningTheme provides night) {
            MaterialTheme(colorScheme=if(night) evening else standart, typography=GenesisTypography) {
                Surface(Modifier.fillMaxSize().safeDrawingPadding()) { DreamJournal(repository,LocalDate.now(),CalendarMode.PROFANE) }
            }
        } }
        compose.onNodeWithTag("dream-history").performClick()
        for (dark in listOf(false,true)) {
            compose.runOnIdle { night=dark }
            val dialog=compose.onNodeWithTag("dream-history-dialog").getUnclippedBoundsInRoot()
            val rootHeight=with(compose.activity.resources.displayMetrics) { heightPixels / density }
            assertTrue("An empty history must not fill the screen",dialog.height.value < rootHeight * .65f)
            capture("empty-331-$dark")
        }
    }

    @Test fun editedDreamUsesOneIdentityForListFiltersAndStatsWhileOtherDraftsStayRecoverable(){
        check(BuildConfig.DEBUG&&compose.activity.packageName.let{it.endsWith(".aurora321.debug")||it.endsWith(".aurora323.debug")})
        val repository=DiaryRepository("synthetic-dream-versions",DreamQaGateway(),DreamQaStore(),DreamQaCipher())
        val saved=DiaryNote.create("Учебная река","QA · Сохранённый сон").changed {
            put("dream",JSONObject().put("day",LocalDate.now().toString()).put("timeZone","UTC").put("lucid",true));put("reaction","favorite")
        }
        val other=saved.changed {put("title","QA · Другой черновик")}
        val edited=DiaryNote.parse(saved.json().put("updatedAt","2099-01-01T00:00:00Z").put("title","QA · Правка сна").put("reaction",JSONObject.NULL).apply{getJSONObject("dream").put("lucid",false)})
        runBlocking {
            repository.save(saved)
            repository.keepDraft(other,1,"draft:other:${saved.id}")
            repository.keepDraft(edited,1)
        }
        compose.setContent{CompositionLocalProvider(LocalGenesisLanguage provides "ru",LocalEveningTheme provides true,LocalDarkPalette provides "violet"){
            MaterialTheme(colorScheme=eveningPalette("violet"),typography=GenesisTypography){Surface(Modifier.fillMaxSize().safeDrawingPadding()){
                Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp)){DreamJournal(repository,LocalDate.now(),CalendarMode.PROFANE)}
            }}
        }}
        compose.onAllNodesWithTag("dream-entry-${saved.id}").assertCountEquals(0)
        compose.onNodeWithTag("dream-history").performClick()
        compose.onNodeWithTag("dream-history-dialog").assertIsDisplayed()
        compose.onAllNodesWithTag("dream-entry-${saved.id}").assertCountEquals(1)
        compose.onNodeWithText("QA · Правка сна").assertExists()
        compose.onNodeWithTag("dream-filter-favorites").performClick()
        compose.onAllNodesWithTag("dream-entry-${saved.id}").assertCountEquals(0)
        compose.onNodeWithTag("dream-filter-lucid").performClick()
        compose.onAllNodesWithTag("dream-entry-${saved.id}").assertCountEquals(0)
        compose.onNodeWithTag("dream-filter-all").performClick()
        compose.onNodeWithText("Статистика снов").performScrollTo().performClick()
        compose.onNodeWithText("Черновики на устройстве · 1").performScrollTo().performClick()
        compose.onNodeWithTag("dream-recover-draft:other:${saved.id}").performScrollTo().assertIsDisplayed()
        capture("dream-recoverable-versions")
    }
    @Test fun todayIsCompactAndMonthRetainsTheBodyReferenceInEveryScheme(){
        check(BuildConfig.DEBUG&&compose.activity.packageName.let{it.endsWith(".aurora321.debug")||it.endsWith(".aurora323.debug")})
        var palette by mutableStateOf("light");var mode by mutableStateOf(CalendarMode.PROFANE);var month by mutableStateOf(false)
        val width=args.getString("genesisWidth")?.toIntOrNull()?:390;val font=args.getString("genesisFontScale")?.toFloatOrNull()?:1f
        compose.setContent { CompositionLocalProvider(LocalDensity provides Density(compose.activity.resources.displayMetrics.widthPixels.toFloat()/width,font),LocalGenesisLanguage provides "ru",LocalEveningTheme provides (palette!="light"),LocalDarkPalette provides palette){
            MaterialTheme(colorScheme=if(palette=="light")standart else eveningPalette(palette),typography=GenesisTypography){
                Surface(Modifier.fillMaxSize().safeDrawingPadding()) {
                    if(month)CalendarScreen(LocalDate.of(2026,11,5),CalendarMode.PROFANE,{},experimental=true)
                    else Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp)){DayHeader(LocalDate.of(2026,11,5),mode)}
                }
            }
        } }
        for(next in listOf("light","green","burgundy","blue","violet")) {
            compose.runOnIdle{palette=next;mode=CalendarMode.PROFANE}
            compose.onNodeWithTag("today-hero").assertIsDisplayed()
            compose.onAllNodesWithText("Части тела:",substring=true).assertCountEquals(0)
            capture("today-$width-$font-$next")
        }
        for(next in listOf(CalendarMode.SACRED,CalendarMode.LUNAR)) {
            compose.runOnIdle{mode=next};compose.onNodeWithTag("today-hero").assertExists();capture("today-$width-$font-$next")
        }
        compose.runOnIdle{month=true}
        compose.onNodeWithText("Части тела:",substring=true).performScrollTo().assertIsDisplayed()
        capture("month-reference-$width-$font")
    }
    @Test fun dreamSearchFlagsSeparationAndBothDeletionPathsUseRealEditor(){
        check(BuildConfig.DEBUG&&compose.activity.packageName.let{it.endsWith(".aurora321.debug")||it.endsWith(".aurora323.debug")})
        val gateway=DreamQaGateway();val repository=DiaryRepository("synthetic-dream-owner",gateway,DreamQaStore(),DreamQaCipher())
        runBlocking{repository.save(DiaryNote.create("Обычная личная заметка","QA · личное"))}
        var diary by mutableStateOf(false)
        compose.setContent{CompositionLocalProvider(LocalGenesisLanguage provides "ru",LocalEveningTheme provides true,LocalDarkPalette provides "violet"){
            MaterialTheme(colorScheme=eveningPalette("violet"),typography=GenesisTypography){Surface(Modifier.fillMaxSize().safeDrawingPadding()){
                if(diary)DiaryScreen(repository){} else Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp)){DreamJournal(repository,LocalDate.now(),CalendarMode.PROFANE)}
            }}
        }}
        compose.onNodeWithTag("dream-record").performScrollTo().performClick()
        compose.onNodeWithTag("dream-title").performTextInput("QA · Лунная река")
        compose.onNodeWithTag("dream-body").performTextInput("Учебный сон о серебряной реке и ясном небе.")
        compose.onNodeWithTag("dream-lucid").performScrollTo().performClick()
        compose.onNodeWithTag("dream-favorite").performScrollTo().performClick()
        capture("dream-editor")
        compose.onNodeWithTag("dream-save").performClick()
        compose.waitUntil(10000){repository.state.value.records.any{!it.draft&&it.note.lucid}}
        val saved=repository.state.value.records.first{it.note.lucid&&!it.draft};assertEquals("favorite",saved.note.reaction)
        compose.onNodeWithTag("dream-history").performClick()
        compose.onNodeWithTag("dream-search").performScrollTo().performTextInput("река")
        compose.onNodeWithTag("dream-entry-${saved.note.id}").performScrollTo().assertIsDisplayed();capture("dream-search")
        compose.onNodeWithTag("dream-entry-${saved.note.id}").performClick()
        compose.onNodeWithTag("dream-delete").performScrollTo().performClick()
        compose.onNodeWithTag("dream-delete-confirm").performClick()
        compose.waitUntil(10000){repository.state.value.records.none{it.note.dreamDay!=null}}
        compose.onNodeWithTag("dream-search").performScrollTo().performTextClearance()
        compose.onNodeWithTag("dialog-close").performClick()
        compose.onNodeWithTag("dream-history-dialog").assertDoesNotExist()
        compose.onNodeWithTag("dream-record").performScrollTo().performClick()
        compose.onNodeWithTag("dream-body").performTextInput("QA · отменённая диктовка")
        compose.onNodeWithTag("dream-delete").performScrollTo().performClick();compose.onNodeWithTag("dream-delete-confirm").performClick()
        compose.waitUntil(10000){repository.state.value.records.none{it.note.dreamDay!=null}}
        compose.runOnIdle{diary=true}
        compose.onNodeWithText("QA · личное").assertExists()
        compose.onAllNodesWithText("QA · Лунная река").assertCountEquals(0)
        capture("general-diary-separated")
    }
}
