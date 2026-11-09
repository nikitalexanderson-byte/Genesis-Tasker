package ru.genesis.calendar

import androidx.room.Room
import androidx.room.withTransaction
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import java.io.File
import java.io.IOException
import java.time.LocalDate
import java.util.UUID
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.auth.*
import ru.genesis.calendar.data.*
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.ui.*

class TaskListsFlowTest {
    @get:Rule val compose = createAndroidComposeRule<StoicheionGestureActivity>()
    private val app get() = compose.activity.application as GenesisApplication

    @Test fun incompleteBootstrapPreservesEncryptedListsAndOtherAccount() = runBlocking {
        val db=Room.inMemoryDatabaseBuilder(app,GenesisDatabase::class.java).build()
        val a=CloudAccountSnapshot.scopeFor("list-account-a")
        val b=CloudAccountSnapshot.scopeFor("list-account-b")
        fun payload(vararg titles: String) = JSONObject()
            .put("user",JSONObject().put("authProvider","google"))
            .put("taskLists",JSONArray().apply {
            titles.forEach { put(GoogleTaskList(it,it,"google-a").json()) }
        })
        try {
            TaskListsRepository.cacheBootstrap(db,a,payload("Original list"))
            TaskListsRepository.cacheBootstrap(db,b,payload("Other account list"))
            val beforeB=requireNotNull(db.dao().document(b,"task-lists"))
            val row=requireNotNull(db.dao().document(a,"task-lists"))
            assertFalse(row.encrypted.contains("Original list"))
            TaskListsRepository.cacheBootstrap(db,a,payload("Partial list").put("syncWarning","partial"))
            val partial=requireNotNull(db.dao().document(a,"task-lists"))
            val raw=LocalCipher().decrypt(partial.encrypted,"$a/task-lists")
            assertTrue(raw.contains("Original list")); assertTrue(raw.contains("Partial list"))
            TaskListsRepository.cacheBootstrap(db,a,payload().put("taskLists",JSONArray().put("bad row")))
            TaskListsRepository.cacheBootstrap(db,a,payload().put("tasksDeferred",true))
            assertEquals(raw,LocalCipher().decrypt(requireNotNull(db.dao().document(a,"task-lists")).encrypted,"$a/task-lists"))
            assertEquals(beforeB,db.dao().document(b,"task-lists"))
            TaskListsRepository.cacheBootstrap(db,a,payload("Complete list"))
            val complete=LocalCipher().decrypt(requireNotNull(db.dao().document(a,"task-lists")).encrypted,"$a/task-lists")
            assertFalse(complete.contains("Original list")); assertTrue(complete.contains("Complete list"))
        } finally { db.close() }
    }

    @Test fun newListTaskKeepsSelectedGoogleAccountAndListThroughOutboxSync() = runBlocking {
        val db=Room.inMemoryDatabaseBuilder(app,GenesisDatabase::class.java).build()
        val owner=CloudAccountSnapshot.scopeFor("list-sync-account")
        try {
            val task=LocalTask("list-task","Read a chapter",date=LocalDate.now().toString(),
                sourceFieldsJson=listTaskFields(GoogleTaskList("reading-list","Reading","google-b"),CalendarMode.LUNAR).toString())
            db.dao().putTask(TaskRecord(owner,task.id,LocalCipher().encrypt(task.json(),"$owner/${task.id}"),1,false))
            db.dao().putOutbox(OutboxRecord(owner,task.id,1,"list-create-op"))
            var requests=0
            val transport=object:CloudTaskTransport {
                override fun put(id:String,task:JSONObject):JSONObject {
                    requests++
                    assertEquals("reading-list",task.getString("googleTaskListId"))
                    assertEquals("google-b",task.getString("googleAccountId"))
                    assertEquals("google-b",task.getJSONArray("syncAccountIds").getString(0))
                    assertTrue(task.isNull("googleEventId"))
                    assertEquals("lunar",task.getString("calendarMode"))
                    return JSONObject().put("task",JSONObject(task.toString()).put("googleTaskId","remote-task"))
                }
                override fun delete(id:String,task:JSONObject):JSONObject=error("Unexpected deletion")
            }
            assertEquals(1,CloudTaskSync(db,transport).flush(owner))
            assertEquals(0,CloudTaskSync(db,transport).flush(owner));assertEquals(1,requests)
            val saved=requireNotNull(db.dao().task(owner,task.id))
            assertEquals("remote-task",JSONObject(LocalCipher().decrypt(saved.encrypted,"$owner/${task.id}")).getString("googleTaskId"))
        } finally { db.close() }
    }

    @Test fun createButtonFollowsSelectedSectionAndRetryDoesNotDuplicateListOrDraftTasks() {
        check(BuildConfig.DEBUG)
        app.activateAccount(null)
        val id=UUID.randomUUID().toString()
        var showEditor by mutableStateOf(false)
        var taskRequested=false
        var listRequests=0
        var saves=0
        var closed=false
        val expectedScope=app.workspaceScope
        val expectedDrafts="Прочитать главу\nЗаписать мысли"
        val callbackProof=JSONArray()
        var checkpoint="mount"
        val fakeList=GoogleTaskList("ui-list-$id","План чтения","fixture-google")
        val accounts=AccountSettings(listOf(LinkedGoogleAccount("fixture-google","fixture@example.invalid","Fixture",true,false,true)),
            SyncRouting("fixed",listOf("fixture-google"),emptyMap()),false,"standart",0,"profane","profane","24h",false,"ru")
        val repo=WorkspaceStructureRepository(app)
        val original=runBlocking { repo.workspace.first() }
        compose.setContent { MaterialTheme(colorScheme=standart) {
            TasksScreen(emptyList(),emptyList(),original,true,true,{taskRequested=true},{showEditor=true},{},{})
            if(showEditor) TaskListEditor(original,accounts,UiPreferences(),true,
                onDismiss={showEditor=false;closed=true},onCreate={_,account->listRequests++;assertEquals("fixture-google",account);fakeList},
                onSaveTasks={list,project,date,rows,options->
                    val proof=JSONObject().put("scopeBefore",app.workspaceScope).put("listId",list.id)
                        .put("projectId",project ?: JSONObject.NULL).put("date",date)
                        .put("rows",JSONArray(rows.map { (rowId,title) -> JSONObject().put("id",rowId).put("title",title) }))
                        .put("returned",false)
                    callbackProof.put(proof)
                    saveListDraftTasks(app,list,project,date,CalendarMode.PROFANE,rows,options)
                    proof.put("returned",true).put("scopeAfter",app.workspaceScope)
                    saves++;if(saves==1) throw IOException("Injected local failure after the first save")
                })
        } }
        try {
            compose.onNodeWithTag("create-task").performClick()
            assertTrue(taskRequested)
            compose.onNodeWithTag("submenu-lists").performClick()
            compose.onAllNodesWithText("Списки задач").assertCountEquals(2)
            compose.onNodeWithTag("genesis-icon-task_lists-static", useUnmergedTree = true).assertExists()
            compose.onNodeWithTag("genesis-icon-task_lists-animated", useUnmergedTree = true).assertDoesNotExist()
            compose.onNodeWithTag("create-task").performClick()
            compose.onNodeWithTag("task-list-title").performTextInput("План чтения")
            checkpoint="draft-input"
            compose.onNodeWithTag("task-list-drafts").performTextInput(expectedDrafts)
            compose.onNodeWithTag("task-list-drafts").assertTextContains(expectedDrafts)
            UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).pressBack()
            compose.waitForIdle()
            checkpoint="after-keyboard-back"
            compose.onNodeWithTag("task-list-drafts").assertTextContains(expectedDrafts)
            // First bring the horizontal picker row into the outer vertical viewport.
            compose.onNodeWithTag("task-list-form-calendar-lunar").onParent().performScrollTo()
            compose.onNodeWithTag("task-list-form-calendar-lunar").performScrollTo().assertIsDisplayed().performClick()
            compose.waitUntil(5_000) { compose.onAllNodes(hasTestTag("task-list-form-calendar-lunar") and isSelected()).fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithTag("task-list-form-calendar-lunar").assertIsSelected()
            checkpoint="after-calendar-change"
            compose.onNodeWithTag("task-list-drafts").assertTextContains(expectedDrafts)
            assertEquals(expectedScope,app.workspaceScope)
            checkpoint="first-save"
            compose.onNodeWithTag("save-task-list").performScrollTo().performClick()
            compose.waitUntil(10_000) { saves==1 }
            checkpoint="before-retry"
            compose.onNodeWithTag("task-list-drafts").assertTextContains(expectedDrafts)
            compose.onNodeWithTag("save-task-list").performScrollTo().performClick()
            compose.waitUntil(10_000) { closed }
            checkpoint="persisted-readback"
            assertEquals(1,listRequests);assertEquals(2,saves)
            assertEquals(expectedScope,app.workspaceScope)
            assertEquals(2,callbackProof.length())
            for (index in 0 until callbackProof.length()) {
                val proof=callbackProof.getJSONObject(index)
                assertEquals(expectedScope,proof.getString("scopeBefore"))
                assertEquals(expectedScope,proof.getString("scopeAfter"))
                assertTrue(proof.getBoolean("returned"))
                val rows=proof.getJSONArray("rows")
                assertEquals(2,rows.length())
                assertEquals(expectedDrafts.lines(),(0 until rows.length()).map { rows.getJSONObject(it).getString("title") })
            }
            val tasks=runBlocking { app.repository.tasks.first().filter { it.taskListId()==fakeList.id } }
            assertEquals(2,tasks.size)
            assertEquals(setOf("Прочитать главу","Записать мысли"),tasks.map { it.title }.toSet())
            assertTrue(tasks.all { JSONObject(it.sourceFieldsJson).getString("googleAccountId")=="fixture-google" })
        } catch (failure: Throwable) {
            val directory=app.getExternalFilesDir(null) ?: app.cacheDir
            val stem="task-lists317-retry-$id"
            runCatching {
                val tasks=runBlocking { app.repository.tasks.first().filter { it.taskListId()==fakeList.id } }
                val proof=JSONObject().put("checkpoint",checkpoint).put("expectedScope",expectedScope)
                    .put("actualScope",app.workspaceScope).put("listId",fakeList.id)
                    .put("listRequests",listRequests).put("saves",saves).put("closed",closed)
                    .put("callbacks",callbackProof).put("failure",failure.stackTraceToString())
                    .put("fieldSemantics",runCatching { compose.onNodeWithTag("task-list-drafts",useUnmergedTree=true).printToString() }
                        .getOrElse { it.toString() })
                    .put("persistedTasks",JSONArray(tasks.map { JSONObject().put("id",it.id).put("title",it.title) }))
                File(directory,"$stem.json").writeText(proof.toString(2))
            }.exceptionOrNull()?.let(failure::addSuppressed)
            runCatching { captureNativeWindow(File(directory,"$stem.png")) }.exceptionOrNull()?.let(failure::addSuppressed)
            throw failure
        } finally {
            runBlocking {
                app.repository.tasks.first().filter { it.taskListId()==fakeList.id }.forEach { app.repository.delete(it.id) }
                // Remove only this synthetic link; preserve all existing test projects/categories.
                app.database.withTransaction {
                    val owner=app.workspaceScope
                    val row=app.database.dao().document(owner,"structure")
                    if(row!=null) {
                        val current=WorkspaceStructureCodec.decode(LocalCipher().decrypt(row.encrypted,"$owner/structure"),row.revision)
                        val next=current.copy(taskListLinks=current.taskListLinks.filterNot { it.taskListId==fakeList.id })
                        app.database.dao().putDocument(row.copy(encrypted=LocalCipher().encrypt(WorkspaceStructureCodec.encode(next),"$owner/structure"),revision=row.revision+1))
                    }
                }
            }
        }
    }

    @Test fun visibleListActionsRenameAndDeleteOnlyTheSelectedList() {
        val editable=GoogleTaskList("editable","План чтения","account-b")
        var visibleLists by mutableStateOf(listOf(
            GoogleTaskList("default","My Tasks","account-a",isDefault=true),
            GoogleTaskList("technical","Привычки GENESIS","account-a"), editable))
        val structure=WorkspaceStructure()
        compose.setContent { MaterialTheme(colorScheme=standart) { Surface(Modifier.fillMaxSize()) {
            TasksScreen(emptyList(),visibleLists,structure,true,true,{},{},{},{},
                onUpdateList={ list,title -> visibleLists=visibleLists.map {
                    if(it.id==list.id)it.copy(title=title) else it
                } },
                onDeleteList={ list -> visibleLists=visibleLists.filterNot { it.id==list.id } })
        } } }
        compose.onNodeWithTag("submenu-lists").performClick()
        compose.onNodeWithText("План чтения").assertExists()
        compose.onNodeWithText("My Tasks").assertDoesNotExist()
        compose.onNodeWithText("Привычки GENESIS").assertDoesNotExist()
        assertTrue(UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).takeScreenshot(
            File(app.getExternalFilesDir(null),"task-lists-edit-delete.png")))
        compose.onNodeWithTag("toggle-task-list-editable").performClick()
        compose.onNodeWithTag("edit-task-list-editable").assertIsDisplayed().performClick()
        compose.onNodeWithText("Изменить список задач").assertExists()
        compose.onNodeWithTag("edit-task-list-title").performTextClearance()
        compose.onNodeWithTag("edit-task-list-title").performTextInput("Новый план")
        compose.onNodeWithTag("save-task-list-edit").performClick()
        compose.waitUntil(5_000) { visibleLists.any { it.id==editable.id && it.title=="Новый план" } }
        compose.onNodeWithText("Новый план").assertExists()
        compose.onNodeWithTag("delete-task-list-editable").assertIsDisplayed().performClick()
        compose.onNodeWithText("Удалить список задач?").assertExists()
        compose.onNodeWithTag("confirm-delete-task-list").performClick()
        compose.waitUntil(5_000) { visibleLists.none { it.id==editable.id } }
        compose.onNodeWithText("Новый план").assertDoesNotExist()
    }
}
