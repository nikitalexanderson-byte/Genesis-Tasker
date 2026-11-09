package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.auth.AuthFailure
import ru.genesis.calendar.auth.SharedWorkspaceGateway
import java.io.File

private class PlanningFixture : SharedWorkspaceGateway {
    val report = ReportUiFixture()
    override suspend fun sharedSprintReport(projectId:String,sprintId:String,unit:String) = report.sharedSprintReport(projectId,sprintId,unit)
    override suspend fun checkSharedSprintReport(projectId:String,sprintId:String,token:String) = report.checkSharedSprintReport(projectId,sprintId,token)
    var organize=true
    var cached=false
    var deny=false
    var offline=false
    var pending=false
    var version=1
    var pageReads=0
    var cursorReads=0
    var planningReads=0
    @Volatile var lastReadBucket=""
    var gate:CompletableDeferred<Unit>?=null
    val queue=mutableListOf<JSONObject>()
    val updates=mutableListOf<JSONObject>()
    val records=(0 until 131).map {i->JSONObject().put("id","task-$i").put("projectId","project")
        .put("title","Подготовить обзор проекта · $i").put("revision",1).put("sprintId",JSONObject.NULL)
        .put("assigneeId",if(i==0)"member" else JSONObject.NULL)
        .put("storyPoints",if(i==0)0 else JSONObject.NULL).put("estimateHours",if(i==0)2.5 else JSONObject.NULL)}.toMutableList()
    fun total(rows:List<JSONObject>)=JSONObject().put("count",rows.size).put("completed",0).apply {
        for((key,unit) in listOf("storyPoints" to "points","estimateHours" to "hours"))put(unit,JSONObject()
            .put("value",rows.filter{!it.isNull(key)}.sumOf{it.getDouble(key)}).put("unestimated",rows.count{it.isNull(key)}))
    }
    override suspend fun sharedPlanning(projectId:String):JSONObject {
        planningReads++
        if(deny)throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
        if(offline)throw AuthFailure(AuthFailure.Kind.NETWORK)
        return JSONObject().put("config",JSONObject().put("enabled",true).put("estimateUnit","points").put("revision",1))
            .put("context",JSONObject().put("permissions",JSONObject().put("editTasks",organize).put("organizeTasks",organize).put("manageProjects",organize)))
            .put("sprints",JSONArray(listOf("sprint" to "planning","closed" to "completed").map{(id,state)->JSONObject()
                .put("id",id).put("projectId","project").put("title",if(id=="sprint")"Следующий спринт" else "Завершённый спринт").put("goal","Согласовать план команды")
                .put("state",state).put("startDate","2026-10-19").put("endDate","2026-10-25").put("calendarMode","profane")
                .put("calendarContext",JSONObject().put("version",2).put("timeZone","Europe/Moscow").put("gregorianYearStart","march"))}))
            .put("totals",JSONObject().put("backlog",total(records.filter{it.isNull("sprintId")})).put("sprint",total(records.filter{it.optString("sprintId")=="sprint"})).put("closed",total(emptyList())))
            .put("byAssignee",JSONObject().apply {
                for(bucket in listOf("backlog","sprint","closed")){
                    val rows=records.filter{if(bucket=="backlog")it.isNull("sprintId")else it.optString("sprintId")==bucket}
                    if(rows.isNotEmpty())put(bucket,JSONObject().apply{
                        rows.groupBy{it.optString("assigneeId").takeUnless{it.isBlank()||it=="null"}?:"unassigned"}
                            .forEach{(id,tasks)->put(id,total(tasks))}
                    })
                }
            }).put("offlineCache",cached)
    }
    override suspend fun querySharedTasks(filter:JSONObject,cursor:String?):JSONObject {
        pageReads++
        if(cursor!=null)cursorReads++
        val bucket=filter.optString("sprintId","backlog")
        if(bucket=="sprint")gate?.let{withContext(NonCancellable){it.await()}}
        val rows=records.filter{if(bucket=="backlog")it.isNull("sprintId")else it.optString("sprintId")==bucket}
        val start=cursor?.toInt()?:0;val end=minOf(start+100,rows.size)
        lastReadBucket=bucket
        return JSONObject().put("tasks",JSONArray(rows.subList(start,end).map{JSONObject(it.toString())}))
            .put("total",rows.size).put("queryVersion","v$version-$bucket").put("nextCursor",if(end<rows.size)end.toString()else JSONObject.NULL)
            .put("offlineCache",cached)
    }
    override suspend fun queuedSharedTasks(projectId:String)=queue.toList()
    override suspend fun sharedTask(projectId:String,taskId:String)=JSONObject().put("task",JSONObject(records.first{it.getString("id")==taskId}.toString()))
    override suspend fun updateSharedTask(projectId:String,taskId:String,changes:JSONObject):JSONObject {
        updates.add(JSONObject(changes.toString()))
        if(pending){queue.add(JSONObject().put("taskId",taskId).put("requestId","original-uuid").put("body",changes));return JSONObject().put("task",JSONObject().put("id",taskId).put("projectId",projectId).put("pending",true))}
        val task=records.first{it.getString("id")==taskId};task.put("sprintId",changes.opt("sprintId")).put("revision",task.getInt("revision")+1);version++
        return JSONObject().put("task",JSONObject(task.toString()))
    }
}

class SharedPlanningUiTest {
    @get:Rule val compose=createAndroidComposeRule<PagerTestActivity>()
    private fun withAssignmentProof(fixture: PlanningFixture, action: () -> Unit) {
        try { action() }
        catch (failure: Throwable) {
            val instrumentation = InstrumentationRegistry.getInstrumentation()
            val directory = instrumentation.targetContext.getExternalFilesDir(null) ?: instrumentation.targetContext.cacheDir
            val name = "planning313-assignment-${System.currentTimeMillis()}"
            runCatching {
                val proof = JSONObject().put("ownedProjectId", "project").put("ownedTaskId", "task-0")
                    .put("failure", failure.toString()).put("pageReads", fixture.pageReads).put("planningReads", fixture.planningReads)
                    .put("lastReadBucket", fixture.lastReadBucket)
                    .put("task", JSONObject(fixture.records.first { it.getString("id") == "task-0" }.toString()))
                    .put("updates", JSONArray(fixture.updates.map { JSONObject(it.toString()) }))
                    .put("queue", JSONArray(fixture.queue.map { JSONObject(it.toString()) }))
                File(directory, "$name.json").writeText(proof.toString(2))
            }
            runCatching {
                android.os.ParcelFileDescriptor.AutoCloseInputStream(instrumentation.uiAutomation.executeShellCommand("screencap -p"))
                    .use { input -> File(directory, "$name.png").outputStream().use { input.copyTo(it) } }
            }
            throw failure
        }
    }
    private fun show(fixture:PlanningFixture,onTask:(String)->Unit={},onClose:()->Unit={}) {
        compose.setContent { CompositionLocalProvider(LocalGenesisLanguage provides "ru") {
            MaterialTheme(colorScheme=standart){Surface(Modifier.fillMaxSize()){
                SharedPlanningScreen(fixture,JSONObject().put("id","project").put("title","План команды"),emptyList(),onClose,onTask,{})
            }}
        }}
        compose.waitUntil(10_000){compose.onAllNodesWithTag("planning-task-task-0").fetchSemanticsNodes().isNotEmpty()}
    }
    @Test fun paginatedBacklogOpensLastTaskAndShowsExactWholeProjectTotals() {
        val fixture=PlanningFixture();var opened="";show(fixture,{opened=it})
        compose.onNodeWithText("Количество задач: 131").assertExists()
        compose.onNodeWithTag("planning-tasks").performScrollToNode(hasTestTag("planning-more"))
        compose.onNodeWithTag("planning-more").performClick()
        compose.waitUntil(5_000){fixture.pageReads>=2}
        compose.onNodeWithTag("planning-tasks").performScrollToNode(hasTestTag("planning-task-task-130"))
        compose.onNodeWithText("Подготовить обзор проекта · 130").performClick()
        assertEquals("task-130",opened)
    }
    @Test fun assignmentUsesExistingTaskPatchAndKeepsZeroAndHours() {
        val fixture=PlanningFixture()
        withAssignmentProof(fixture) {
            show(fixture)
            compose.onNodeWithTag("planning-move-task-0").performClick()
            compose.onNodeWithTag("planning-destination").performClick()
            compose.onNodeWithTag("planning-destination-sprint").performClick()
            compose.onNodeWithTag("planning-assign").performClick()
            compose.waitUntil(5_000){fixture.updates.size==1}
            assertEquals(setOf("sprintId","expectedRevision"),fixture.updates.single().keys().asSequence().toSet())
            assertEquals("sprint",fixture.records[0].getString("sprintId"));assertEquals(0,fixture.records[0].getInt("storyPoints"));assertEquals(2.5,fixture.records[0].getDouble("estimateHours"),0.0)
            val readsBeforeSprint=fixture.pageReads
            compose.onNodeWithTag("planning-bucket").performClick();compose.onNodeWithTag("planning-select-sprint").performClick()
            compose.waitUntil(10_000) {
                fixture.lastReadBucket=="sprint" && fixture.pageReads>readsBeforeSprint &&
                    compose.onAllNodesWithTag("planning-loading").fetchSemanticsNodes().isEmpty()
            }
            compose.onNodeWithTag("planning-bucket").assertTextContains("Следующий спринт")
            // The sprint period/totals can put the first task below the lazy viewport.
            compose.onNodeWithTag("planning-tasks").performScrollToNode(hasTestTag("planning-task-task-0"))
            compose.onNodeWithTag("planning-task-task-0").assertIsDisplayed()
            compose.onNodeWithTag("planning-move-task-0").assertIsDisplayed().assertIsEnabled()
        }
    }
    @Test fun pendingCommandCannotBeSentAgainAndRemainsInExistingQueue() {
        val fixture=PlanningFixture().apply{pending=true};show(fixture)
        compose.onNodeWithTag("planning-move-task-0").performClick();compose.onNodeWithTag("planning-destination").performClick()
        compose.onNodeWithTag("planning-destination-sprint").performClick();compose.onNodeWithTag("planning-assign").performClick()
        compose.waitUntil(5_000){fixture.queue.size==1}
        compose.onNodeWithTag("planning-move-task-0").assertIsNotEnabled()
        assertEquals("original-uuid",fixture.queue.single().getString("requestId"));assertEquals(1,fixture.updates.size)
    }
    @Test fun explicitConflictRefreshPreservesDestinationAndUsesCurrentRevision() {
        val fixture=PlanningFixture();show(fixture)
        compose.onNodeWithTag("planning-move-task-0").performClick();compose.onNodeWithTag("planning-destination").performClick()
        compose.onNodeWithTag("planning-destination-sprint").performClick()
        compose.runOnIdle{fixture.records[0].put("revision",2);fixture.version++}
        compose.onNodeWithTag("planning-assign").performClick()
        compose.waitUntil(5_000){compose.onAllNodesWithTag("planning-selection-conflict",useUnmergedTree=true).fetchSemanticsNodes().isNotEmpty()}
        assertEquals(0,fixture.updates.size);compose.onNodeWithTag("planning-assign").assertIsNotEnabled()
        compose.onNodeWithTag("planning-refresh").performClick()
        compose.waitUntil(5_000){compose.onAllNodesWithTag("planning-selection-conflict",useUnmergedTree=true).fetchSemanticsNodes().isEmpty()}
        compose.onNodeWithTag("planning-destination").assertTextContains("Следующий спринт")
        compose.onNodeWithTag("planning-assign").performClick();compose.waitUntil(5_000){fixture.updates.size==1}
        assertEquals(2,fixture.updates.single().getInt("expectedRevision"))
    }
    @Test fun cachedViewerAndCurrentPermissionRevocationNeverOfferAWrite() {
        val fixture=PlanningFixture().apply{cached=true};show(fixture)
        compose.onAllNodes(hasTestTag("planning-move-task-0")).assertCountEquals(0)
        compose.runOnIdle{fixture.cached=false;fixture.organize=false}
        compose.onNodeWithTag("planning-refresh").performClick();compose.waitUntil(5_000){fixture.planningReads>=2}
        compose.onAllNodes(hasTestTag("planning-move-task-0")).assertCountEquals(0)
        compose.runOnIdle{fixture.deny=true};compose.onNodeWithTag("planning-refresh").performClick()
        compose.waitUntil(5_000){compose.onAllNodesWithTag("planning-task-task-0").fetchSemanticsNodes().isEmpty()}
        compose.onNodeWithText("Нет доступа").assertExists()
        compose.onAllNodesWithText("План команды").assertCountEquals(0)
    }
    @Test fun assigneeSummaryUsesWholeCollectionAndDoesNotInventAnUnavailableName() {
        val fixture=PlanningFixture();show(fixture)
        compose.onNodeWithText("Объём назначенных задач").performClick()
        compose.onNodeWithTag("planning-assignee-unassigned")
            .assert(hasAnyDescendant(hasText("Количество задач: 130")))
        compose.onNodeWithTag("planning-assignee-member")
            .assert(hasAnyDescendant(hasText("Количество задач: 1")))
            .assert(hasAnyDescendant(hasText("Недоступно")))
        assertEquals(0,fixture.cursorReads)
    }
    @Test fun systemBackReturnsWithoutCreatingATaskMutation() {
        val fixture=PlanningFixture();var closed=false;show(fixture,onClose={closed=true})
        androidx.test.uiautomator.UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).pressBack()
        compose.waitUntil(5_000){closed}
        assertTrue(fixture.updates.isEmpty());assertTrue(fixture.queue.isEmpty())
    }
    @Test fun selectedSprintOpensReadOnlyReportAndBackReturnsToPlanning() {
        val fixture=PlanningFixture();show(fixture)
        compose.onNodeWithTag("planning-sprint-report").assertDoesNotExist()
        compose.onNodeWithTag("planning-bucket").performClick();compose.onNodeWithTag("planning-select-sprint").performClick()
        if(compose.onAllNodesWithTag("planning-sprint-report").fetchSemanticsNodes().isEmpty())
            compose.onNodeWithTag("planning-tasks").performScrollToNode(hasTestTag("planning-sprint-report"))
        compose.onNodeWithTag("planning-sprint-report").performClick()
        compose.waitUntil(10000){compose.onAllNodesWithTag("report-overview").fetchSemanticsNodes().isNotEmpty()}
        androidx.test.uiautomator.UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).pressBack();compose.waitForIdle()
        compose.onNodeWithTag("shared-sprint-report").assertDoesNotExist();compose.onNodeWithTag("shared-planning-screen").assertExists()
        assertTrue(fixture.updates.isEmpty());assertTrue(fixture.queue.isEmpty())
    }
    @Test fun latePageCannotReplaceAnotherBucketAndCompletedSprintIsReadOnly() {
        val fixture=PlanningFixture();show(fixture)
        val gate=CompletableDeferred<Unit>();compose.runOnIdle{fixture.gate=gate}
        compose.onNodeWithTag("planning-bucket").performClick();compose.onNodeWithTag("planning-select-sprint").performClick()
        compose.waitUntil(5_000){fixture.pageReads>=2}
        compose.onNodeWithTag("planning-bucket").performClick();compose.onNodeWithTag("planning-select-closed").performClick()
        gate.complete(Unit)
        compose.waitUntil(5_000){compose.onAllNodesWithTag("planning-empty").fetchSemanticsNodes().isNotEmpty()}
        compose.onAllNodes(hasTestTag("planning-move-task-0")).assertCountEquals(0)
        compose.onNodeWithText("Завершённый").assertExists()
    }
    @Test fun capturePlanningBothThemesAndFourteenLanguages() {
        val args=InstrumentationRegistry.getArguments();val width=args.getString("genesisPlanningWidth")?:"390"
        val languages=if(args.getString("genesisPlanningLanguages")=="true")listOf("ru","en","el","de","fr","es","it","pt","pl","sr","uk","zh","tr","ja")else listOf("ru")
        var language by mutableStateOf("ru");var dark by mutableStateOf(false)
        compose.setContent { CompositionLocalProvider(LocalGenesisLanguage provides language,LocalEveningTheme provides dark){MaterialTheme(colorScheme=if(dark)evening else standart){Surface(Modifier.fillMaxSize()){
            key(language,dark){SharedPlanningScreen(remember{PlanningFixture()},JSONObject().put("id","project").put("title","План команды"),emptyList(),{},{},{})}
        }}}}
        for(theme in listOf(false,true))for(locale in languages){
            compose.runOnIdle{language=locale;dark=theme}
            compose.waitUntil(10_000){compose.onAllNodesWithTag("planning-task-task-0").fetchSemanticsNodes().isNotEmpty()}
            compose.waitForIdle();val instrumentation=InstrumentationRegistry.getInstrumentation()
            val file=File(instrumentation.targetContext.cacheDir,"g1-planning-$width-${if(theme)"dark"else"light"}-$locale.png")
            android.os.ParcelFileDescriptor.AutoCloseInputStream(instrumentation.uiAutomation.executeShellCommand("screencap -p")).use{input->file.outputStream().use{input.copyTo(it)}}
            assertTrue(file.length()>0)
        }
    }
    @Test fun capturePlanningInteractiveStatesBothThemes() {
        val width=InstrumentationRegistry.getArguments().getString("genesisPlanningWidth")?:"390"
        var fixture by mutableStateOf(PlanningFixture());var dark by mutableStateOf(false);var epoch by mutableIntStateOf(0)
        compose.setContent { CompositionLocalProvider(LocalGenesisLanguage provides "ru",LocalEveningTheme provides dark){
            MaterialTheme(colorScheme=if(dark)evening else standart){Surface(Modifier.fillMaxSize()){
                key(epoch,dark){SharedPlanningScreen(fixture,JSONObject().put("id","project").put("title","План команды"),emptyList(),{},{},{})}
            }}
        }}
        fun reset(cached:Boolean=false) {
            compose.runOnIdle{fixture=PlanningFixture().apply{this.cached=cached};epoch++}
            compose.waitUntil(10_000){compose.onAllNodesWithTag("planning-task-task-0").fetchSemanticsNodes().isNotEmpty()}
            compose.waitForIdle()
        }
        fun capture(state:String) {
            compose.waitForIdle();val instrumentation=InstrumentationRegistry.getInstrumentation()
            val file=File(instrumentation.targetContext.cacheDir,"g1-planning-state-$width-${if(dark)"dark"else"light"}-$state.png")
            android.os.ParcelFileDescriptor.AutoCloseInputStream(instrumentation.uiAutomation.executeShellCommand("screencap -p")).use{input->file.outputStream().use{input.copyTo(it)}}
            assertTrue(file.length()>0)
        }
        for(theme in listOf(false,true)){
            compose.runOnIdle{dark=theme};reset()
            compose.onNodeWithTag("planning-refresh").performTouchInput{longClick()}
            compose.onNodeWithText("Обновить").assertIsDisplayed();capture("tooltip")
            reset();compose.onNodeWithTag("planning-move-task-0").performClick()
            compose.onNodeWithTag("planning-destination").performClick();compose.onNodeWithTag("planning-destination-sprint").performClick()
            compose.onNodeWithTag("planning-assign").assertIsEnabled();capture("assignment")
            reset();compose.runOnIdle{fixture.records[0].put("sprintId","sprint")}
            compose.onNodeWithTag("planning-bucket").performClick();compose.onNodeWithTag("planning-select-sprint").performClick()
            compose.waitUntil(10_000){fixture.pageReads>=2&&compose.onAllNodesWithText("Согласовать план команды").fetchSemanticsNodes().isNotEmpty()}
            capture("sprint")
            reset(cached=true);compose.onAllNodes(hasTestTag("planning-move-task-0")).assertCountEquals(0);capture("cached")
            reset();compose.runOnIdle{fixture.deny=true};compose.onNodeWithTag("planning-refresh").performClick()
            compose.waitUntil(10_000){compose.onAllNodesWithText("План команды").fetchSemanticsNodes().isEmpty()}
            capture("access")
        }
    }
}
