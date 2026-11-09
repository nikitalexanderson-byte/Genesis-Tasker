package ru.genesis.calendar.ui

import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import androidx.compose.material3.Surface
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.io.IOException
import kotlinx.coroutines.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.Assume.assumeTrue
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.auth.FeatureAccess
import ru.genesis.calendar.data.*
import ru.genesis.calendar.reminders.ReminderScheduler

/** Real PHP/SQLite over adb reverse, real encrypted Room and native Compose.
 * Only an explicit local fixture is accepted. No Google/OAuth transport is mocked or asserted here.
 */
class MindmapsIntegrationTest {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
    private fun fixture():JSONObject {
        val file=File(context.getExternalFilesDir(null),"mindmaps-fixture.json")
        val arguments=InstrumentationRegistry.getArguments()
        val expectedRun=arguments.getString("genesisMindmapsRunId")
        if(!expectedRun.isNullOrBlank())check(file.exists()) {"Requested native mindmap fixture is missing"}
        assumeTrue("Requires scripts/qa/mindmaps-native-fixture.php and adb reverse tcp:4341 tcp:4341",file.exists())
        return JSONObject(file.readText()).also {value->
            require(value.getBoolean("synthetic")) {"Only an isolated synthetic fixture is accepted"}
            require(value.getString("origin")=="http://127.0.0.1:4341")
            require(value.getString("runId").matches(Regex("[a-zA-Z0-9-]{6,80}")))
            require(value.getString("deviceKey").matches(Regex("[a-z0-9][a-z0-9-]{0,39}")))
            require(value.getString("userId").isNotBlank())
            require(value.getString("email").endsWith("@example.invalid"))
            require(value.getString("expectedPlan")=="premium")
            require(value.getString("session").matches(Regex("[A-Za-z0-9,-]{16,128}")))
            if(!expectedRun.isNullOrBlank())require(value.getString("runId")==expectedRun)
            arguments.getString("genesisMindmapsDeviceKey")?.takeIf {it.isNotBlank()}?.let {
                require(value.getString("deviceKey")==it)
            }
        }
    }
    private class LocalApi(val fixture:JSONObject):MindmapTransport {
        var failKey=false;var loseReply=false
        private var csrf=""
        override fun check() {}
        suspend fun featureAccess():FeatureAccess {
            val response=request("/session");csrf=response.getString("csrf")
            val user=response.getJSONObject("user")
            check(user.getString("uid")==fixture.getString("userId")) {"Fixture session belongs to another user"}
            check(user.getString("email")==fixture.getString("email") && !user.getBoolean("isAdmin")) {"Ordinary synthetic user required"}
            val access=FeatureAccess.fromJson(user.getJSONObject("featureAccess"))
            check(access.declaredPlan==fixture.getString("expectedPlan") && access.effectivePlan=="premium")
            check(access.enforcementEnabled && access.limit("mindmaps")==100 && access.allows("data-export")) {"Actual paid server entitlement required"}
            return access
        }
        override suspend fun workspace():JSONObject {
            if(failKey)throw IOException("offline before key")
            return request("/workspace")
        }
        override suspend fun request(path:String,body:JSONObject?):JSONObject=withContext(Dispatchers.IO) {
            require(path=="/session" || path=="/workspace" || path.startsWith("/mindmaps"))
            if(csrf.isEmpty()&&path!="/session")csrf=request("/session").getString("csrf")
            val connection=URL(fixture.getString("origin")+"/api$path").openConnection() as HttpURLConnection
            try {
                connection.instanceFollowRedirects=false
                connection.connectTimeout=10000;connection.readTimeout=15000
                connection.setRequestProperty("Cookie","GENESISSESSID="+fixture.getString("session"))
                connection.setRequestProperty("X-CSRF-Token",csrf)
                if(body!=null){connection.requestMethod="PUT";connection.doOutput=true;connection.setRequestProperty("Content-Type","application/json");connection.outputStream.use {it.write(body.toString().toByteArray())}}
                val status=connection.responseCode
                val payload=(if(status<400)connection.inputStream else connection.errorStream).bufferedReader().use {it.readText()}
                check(status==200) {"Local fixture HTTP $status"}
                if(body!=null&&loseReply){loseReply=false;throw IOException("lost response after commit")}
                JSONObject(payload)
            } finally {connection.disconnect()}
        }
    }
    private fun screenshot(name:String) {
        compose.waitForIdle();android.os.SystemClock.sleep(500)
        UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).takeScreenshot(File(context.getExternalFilesDir(null),name))
    }
    @Test fun offlineRetryConflictAndRestartKeepEveryDraft()=runBlocking {
        val fixture=fixture();val api=LocalApi(fixture)
        val access=api.featureAccess()
        val db=Room.inMemoryDatabaseBuilder(context,GenesisDatabase::class.java).build()
        fun repository(scope:String="mindmap-resilience")=MindmapRepository(db,scope,fixture.getString("userId"),api,{access})
        try {
            val first=repository();val document=MindmapDocument.new("${fixture.getString("deviceKey")} resilience")
            first.save(document)
            api.failKey=true
            assertTrue(runCatching {first.save(document.copy(title="offline preserved"))}.isFailure)
            val resumed=repository();resumed.loadCached();api.failKey=false;resumed.refresh()
            assertEquals("offline preserved",resumed.records.value.single {it.document.id==document.id}.document.title)
            assertTrue(resumed.records.value.single {it.document.id==document.id}.unsynced)
            resumed.retry(document.id)
            val revision=resumed.records.value.single {it.document.id==document.id}.revision
            api.loseReply=true
            assertTrue(runCatching {resumed.save(document.copy(title="committed once"))}.isFailure)
            val afterLoss=repository();afterLoss.loadCached();afterLoss.retry(document.id)
            assertEquals(revision+1,afterLoss.records.value.single {it.document.id==document.id}.revision)
            val other=repository("other-device");other.refresh()
            afterLoss.save(document.copy(title="first device"))
            assertTrue(runCatching {other.save(document.copy(title="second device draft"))}.isFailure)
            other.adoptServer(document.id)
            assertEquals("first device",other.records.value.single {it.document.id==document.id}.document.title)
            assertTrue(other.records.value.any {it.document.id!=document.id&&it.document.title.startsWith("second device draft")&&it.unsynced})
            assertFalse(db.dao().document("mindmap-resilience","mindmaps")!!.encrypted.contains("first device"))
        } finally {db.close()}
    }
    @Test fun nativeTaskReferenceRoundtripAndPdf() {
        val fixture=fixture();val api=LocalApi(fixture)
        val access=runBlocking {api.featureAccess()}
        val artifactPrefix="mindmaps-${fixture.getString("deviceKey")}"
        val db=Room.inMemoryDatabaseBuilder(context,GenesisDatabase::class.java).build()
        val scope="mindmaps-device-roundtrip"
        val repository=MindmapRepository(db,scope,fixture.getString("userId"),api,{access})
        val taskRepository=TaskRepository(db,LocalCipher(),scope,ReminderScheduler(context))
        val map=MindmapDocument.new("${fixture.getString("deviceKey")} mindmap",template="idea")
        val thought=map.nodes[1]
        runBlocking {repository.save(map)}
        var dark by mutableStateOf(false)
        var taskEditor by mutableStateOf<LocalTask?>(null)
        compose.setContent {
            val tasks by taskRepository.tasks.collectAsState(initial=emptyList())
            val jobs=rememberCoroutineScope()
            CompositionLocalProvider(LocalGenesisLanguage provides "ru",LocalEveningTheme provides dark,LocalFeatureAccess provides access) {
                MaterialTheme(colorScheme=if(dark)evening else standart) {
                    Surface(Modifier.fillMaxSize(),color=MaterialTheme.colorScheme.background) {MindmapsScreen(repository,tasks,emptyList(),null,{},
                        onCreate={taskEditor=it},
                        onTask={task,_->taskEditor=task},
                        onComplete={task,_->jobs.launch {taskRepository.complete(task.id)}},onProject={})
                    taskEditor?.let {draft->TaskEditor(draft,java.time.LocalDate.now().toString(),UiPreferences(),WorkspaceStructure(),null,null,emptyList(),null,
                        onDismiss={taskEditor=null},onSave={jobs.launch {taskRepository.save(it);taskEditor=null}},onTransfer=null,onDelete=null,onDeleteOccurrence=null,showSelectedOccurrence=false)}
                    }
                }
            }
        }
        try {
            compose.onNodeWithTag("mindmap-open-${map.id}").performScrollTo().performClick()
            compose.onNodeWithTag("mindmap-export-menu").assertIsEnabled().performClick()
            compose.onNodeWithTag("mindmap-export-pdf").assertIsEnabled()
            compose.onNodeWithTag("mindmap-export-json").assertIsEnabled().performClick()
            compose.onNodeWithText("Экспорт JSON").assertIsDisplayed()
            compose.onNodeWithText("Документ GENESIS").assertExists()
            compose.onNodeWithText("Закрыть").performClick()
            compose.onNodeWithTag("mindmap-node-${thought.id}").performScrollTo().performClick()
            compose.onNodeWithTag("mindmap-node-text").performTextReplacement("One task across views")
            compose.onNodeWithText("Создать задачу из мысли").performScrollTo().performClick()
            compose.waitUntil(10000) {compose.onAllNodesWithTag("save-task").fetchSemanticsNodes().isNotEmpty()}
            // Save is in the editor's fixed footer, outside task-editor-scroll.
            compose.onNodeWithTag("save-task").assertIsDisplayed().assertIsEnabled().performClick()
            compose.waitUntil(15000) {repository.records.value.first {it.document.id==map.id}.document.nodes.any {it.id==thought.id&&it.kind=="task"}}
            compose.onNodeWithTag("mindmap-node-${thought.id}").performScrollTo().performClick()
            compose.onNodeWithText("Открыть карточку задачи").performScrollTo().performClick()
            compose.onNodeWithTag("task-title").performScrollTo().performTextReplacement("Changed in ordinary task repository")
            compose.onNodeWithTag("save-task").assertIsDisplayed().assertIsEnabled().performClick()
            compose.waitUntil(5000) {compose.onAllNodesWithText("Changed in ordinary task repository").fetchSemanticsNodes().isNotEmpty()}
            compose.onNodeWithTag("mindmap-node-close").assertIsDisplayed().assertIsEnabled().performClick()
            screenshot("$artifactPrefix-light.png")
            compose.runOnIdle {dark=true}
            compose.waitForIdle();screenshot("$artifactPrefix-dark.png")
            compose.onNodeWithTag("mindmap-mode-toggle").assertIsDisplayed()
                .assertContentDescriptionEquals("Показать структуру").performClick()
            compose.onNodeWithTag("mindmap-canvas").assertDoesNotExist()
            compose.onNodeWithTag("mindmap-mode-toggle").assertIsDisplayed()
                .assertContentDescriptionEquals("Показать карту").performClick()
            compose.onNodeWithTag("mindmap-canvas").assertIsDisplayed()
            screenshot("$artifactPrefix-canvas.png")
            runBlocking {
                val saved=repository.records.value.first {it.document.id==map.id}.document
                repository.save(saved.remove(thought.id))
                assertEquals("Changed in ordinary task repository",taskRepository.get(map.taskId(thought.id))!!.title)
                val reopened=MindmapRepository(db,scope,fixture.getString("userId"),api,{access});reopened.loadCached();reopened.refresh()
                assertFalse(reopened.records.value.first {it.document.id==map.id}.document.nodes.any {it.id==thought.id})
                assertEquals(1,db.dao().accountTasks(scope).size)
                val exported=JSONObject(repository.exportJson(saved))
                assertEquals("genesis-mindmap",exported.getString("format"))
                assertEquals(map.id,exported.getJSONObject("document").getString("id"))
                val large=map.copy(nodes=listOf(map.nodes[0])+List(999){MindmapNode("pdf-$it",map.nodes[0].id,text="Кириллица 日本語 Ελληνικά $it",note="Пояснение $it")})
                val file=File(context.getExternalFilesDir(null),"$artifactPrefix-1000.pdf")
                val started=System.nanoTime()
                repository.requireDataExchange()
                withContext(Dispatchers.IO){file.outputStream().use {writeMindmapPdf(it,large,large.nodes.associate {it.id to it.text},JSONObject(),"Структура карты")}}
                val millis=(System.nanoTime()-started)/1_000_000
                assertTrue("PDF took $millis ms",millis<30000)
                PdfRenderer(ParcelFileDescriptor.open(file,ParcelFileDescriptor.MODE_READ_ONLY)).use {assertTrue(it.pageCount>2)}
                File(context.getExternalFilesDir(null),"$artifactPrefix-result.json").writeText(JSONObject()
                    .put("runId",fixture.getString("runId")).put("deviceKey",fixture.getString("deviceKey"))
                    .put("plan",access.effectivePlan).put("policyRevision",access.policyRevision)
                    .put("paidJsonUi",true).put("paidPdfGate",true).put("pdfMs",millis).put("nodes",1000).put("taskCount",1).toString())
            }
        } finally {db.close()}
    }
}
