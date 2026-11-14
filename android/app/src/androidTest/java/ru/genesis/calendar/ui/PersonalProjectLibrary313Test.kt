package ru.genesis.calendar.ui

import android.app.Instrumentation
import android.content.Context
import android.content.ContextWrapper
import android.content.SharedPreferences
import android.database.DatabaseErrorHandler
import android.database.sqlite.SQLiteDatabase
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.room.Room
import androidx.room.withTransaction
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.captureNativeWindow
import ru.genesis.calendar.data.*
import java.io.File
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/** Real Application/repositories, private paths only. No onCreate, AuthController, workers or login. */
internal class Project313Context(base: Context, token: String) : ContextWrapper(base) {
    val databaseName = "qa313-projects-$token-genesis.db"
    val preferencePrefix = "qa313-projects-$token-"
    val preferenceNames: MutableSet<String> = ConcurrentHashMap.newKeySet()
    lateinit var fixtureApplication: GenesisApplication

    override fun getApplicationContext(): Context =
        if (::fixtureApplication.isInitialized) fixtureApplication else this

    private fun checkDatabaseName(name: String) {
        require(name == "genesis.db" || name == databaseName || name == databasePath.absolutePath)
    }
    val databasePath: File get() = baseContext.getDatabasePath(databaseName)
    override fun getDatabasePath(name: String): File { checkDatabaseName(name); return databasePath }
    override fun openOrCreateDatabase(name: String, mode: Int, factory: SQLiteDatabase.CursorFactory?): SQLiteDatabase {
        checkDatabaseName(name)
        return baseContext.openOrCreateDatabase(databaseName, mode, factory)
    }
    override fun openOrCreateDatabase(name: String, mode: Int, factory: SQLiteDatabase.CursorFactory?,
        errorHandler: DatabaseErrorHandler?): SQLiteDatabase {
        checkDatabaseName(name)
        return baseContext.openOrCreateDatabase(databaseName, mode, factory, errorHandler)
    }
    override fun deleteDatabase(name: String): Boolean { checkDatabaseName(name); return baseContext.deleteDatabase(databaseName) }
    override fun getSharedPreferences(name: String, mode: Int): SharedPreferences {
        val privateName = preferencePrefix + name
        preferenceNames += privateName
        return baseContext.getSharedPreferences(privateName, mode)
    }
}

/** Tests shipped ProjectsScreen. Task rows are search fixtures; no task-creation/completion credit. */
class PersonalProjectLibrary313Test {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    private val target get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val realApplication get() = target.applicationContext as GenesisApplication
    private val width get() = InstrumentationRegistry.getArguments().getString("genesisWidth")?.toIntOrNull() ?: 390
    private val dark get() = InstrumentationRegistry.getArguments().getString("genesisEvening") == "true"
    private var hideSearchKeyboard: (() -> Unit)? = null
    private val statusActionTrace = JSONArray()

    private data class Baseline(val scope: String, val structure: DocumentRecord?, val tasks: List<TaskRecord>,
        val outbox: List<OutboxRecord>, val reminders: List<ReminderRecord>,
        val sortPreferences: Map<String, *>, val inboxPreferences: Map<String, *>)

    private fun baseline(): Baseline = runBlocking {
        val app = realApplication
        app.database.withTransaction {
            val scope = app.workspaceScope
            Baseline(scope, app.database.dao().document(scope, "structure"),
                app.database.dao().accountTasks(scope).sortedBy { it.id },
                app.database.dao().outbox(scope).sortedBy { it.entityId },
                app.database.dao().reminders(scope).sortedBy { it.id },
                app.getSharedPreferences("genesis.task-display.v1", 0).all.toMap(),
                app.getSharedPreferences("genesis.personal-layout.v1", 0).all.toMap())
        }
    }

    private fun ready(tag: String): SemanticsNodeInteraction {
        compose.waitUntil(15_000) { compose.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty() }
        val node = compose.onNodeWithTag(tag)
        // Do not call performScrollTo on an already visible non-scrollable header/menu control.
        if (!node.isDisplayed()) node.performScrollTo()
        return node.assertIsDisplayed().assertIsEnabled()
    }
    private fun click(tag: String) { ready(tag).performClick() }
    private fun dialogText(text: String): SemanticsNodeInteraction = compose.onNode(
        hasText(text, substring = false) and hasClickAction() and hasAnyAncestor(isDialog()))
    private fun clickDialog(text: String) {
        val node = dialogText(text)
        if (!node.isDisplayed()) node.performScrollTo()
        node.assertIsDisplayed().assertIsEnabled().performClick()
    }
    private fun row(id: String): SemanticsNodeInteraction {
        val tag = "project-drop-$id"
        compose.onNodeWithTag("projects-screen").performScrollToNode(hasTestTag(tag))
        return ready(tag)
    }
    private fun menu(id: String) {
        val actions = hasContentDescription("Действия с проектом") and hasAnyAncestor(hasTestTag("project-drop-$id"))
        row(id)
        if (compose.onAllNodes(actions).fetchSemanticsNodes().isEmpty()) row(id).performClick()
        val button = compose.onNode(actions)
        button.performScrollTo().assertIsDisplayed().assertIsEnabled()
        compose.onAllNodesWithTag("personal-task-search-dock").fetchSemanticsNodes().singleOrNull()?.let { dock ->
            assertTrue("Project actions must remain above the search panel",
                button.fetchSemanticsNode().boundsInRoot.bottom <= dock.boundsInRoot.top + 1f)
        }
        button.performClick()
        compose.waitUntil(5_000) {
            compose.onAllNodesWithText("Изменить проект", substring = false).fetchSemanticsNodes().isNotEmpty()
        }
    }
    private fun edit(id: String) { menu(id); compose.onNodeWithText("Изменить проект", substring = false).performClick(); ready("project-title") }
    private fun settleIme() {
        compose.runOnIdle { hideSearchKeyboard?.invoke() }
        compose.dismissValidationKeyboard()
    }
    private fun selectProjectStatus(label: String) {
        settleIme()
        // Scroll the whole State section, whose closest scroll parent is vertical.
        // Scrolling the chip itself selects its horizontal Row even when invoked
        // through outer.performScrollToNode(), leaving the vertical viewport still.
        compose.onNode(hasAnyChild(hasText("Состояние", substring = false)) and
            hasAnyAncestor(isDialog())).performScrollTo().assertIsDisplayed()
        dialogText(label).assertIsDisplayed()
        statusActionTrace.put(JSONObject().put("phase", "before-status-click").put("label", label)
            .put("semantics", statusSemantics(label)))
        clickDialog(label) // Exactly one actual status-chip click; no retry or repository mutation.
        compose.waitUntil(5_000) { runCatching { dialogText(label).assertIsSelected() }.isSuccess }
        settleIme()
        dialogText(label).assertIsSelected()
        statusActionTrace.put(JSONObject().put("phase", "status-selected").put("label", label)
            .put("semantics", statusSemantics(label)))
    }
    private fun saveProject(expectedStatusLabel: String? = null, beforeSave: (() -> Unit)? = null) {
        if (expectedStatusLabel != null) settleIme()
        ready("save-project")
        expectedStatusLabel?.let { dialogText(it).assertIsSelected() }
        beforeSave?.invoke()
        // Re-read the existing enabled Save control; use the same single production callback.
        click("save-project")
        compose.waitUntil(15_000) { compose.onAllNodesWithTag("project-title").fetchSemanticsNodes().isEmpty() }
    }
    private fun semanticSnapshot(matcher: SemanticsMatcher, useUnmergedTree: Boolean = true): JSONObject {
        val result = JSONObject()
        return runCatching {
            val rows = compose.onAllNodes(matcher, useUnmergedTree = useUnmergedTree).fetchSemanticsNodes()
            result.put("count", rows.size).put("nodes", JSONArray(rows.map { node ->
                JSONObject().put("id", node.id).put("bounds", node.boundsInRoot.toString())
                    .put("selected", node.config.getOrNull(SemanticsProperties.Selected) ?: JSONObject.NULL)
                    .put("disabled", node.config.contains(SemanticsProperties.Disabled))
                    .put("config", node.config.toString())
            }))
        }.getOrElse { result.put("error", it.javaClass.simpleName + ": " + it.message) }
    }
    private fun statusSemantics(label: String) = semanticSnapshot(
        hasText(label, substring = false) and hasClickAction() and hasAnyAncestor(isDialog()),
        useUnmergedTree = false)
    private fun passiveDiagnostic(app: GenesisApplication, short: String, checkpoint: String) {
        check(app !== realApplication)
        val data = JSONObject().put("checkpoint", checkpoint).put("probeWritesDatabase", false)
            .put("statusActionTrace", statusActionTrace)
        runCatching {
            runBlocking { withTimeout(3_000) { app.database.withTransaction {
                val path = File(app.database.openHelper.writableDatabase.path)
                check(path.name.startsWith("qa313-projects-") && path.name.endsWith("-genesis.db"))
                val record = app.database.dao().document(app.workspaceScope, "structure")
                data.put("database", path.name).put("revision", record?.revision ?: JSONObject.NULL)
                    .put("currentStructure", record?.let { JSONObject(LocalCipher().decrypt(it.encrypted,
                        "${app.workspaceScope}/structure")) } ?: JSONObject.NULL)
                    .put("privateOutbox", JSONArray(app.database.dao().outbox(app.workspaceScope).map {
                        JSONObject().put("entityId", it.entityId).put("revision", it.revision).put("operationId", it.operationId)
                    }))
            } } }
        }.exceptionOrNull()?.let { data.put("readFailure", it.javaClass.simpleName + ": " + it.message) }
        data.put("activityDecorImeVisible", ViewCompat.getRootWindowInsets(compose.activity.window.decorView)
            ?.isVisible(WindowInsetsCompat.Type.ime()) ?: JSONObject.NULL)
            .put("saveButton", semanticSnapshot(hasTestTag("save-project")))
            .put("editorTitle", semanticSnapshot(hasTestTag("project-title")))
            .put("completedChip", statusSemantics("Завершён")).put("activeChip", statusSemantics("Активен"))
            .put("dialogTree", runCatching { compose.onNode(isDialog()).printToString() }
                .getOrElse { it.javaClass.simpleName + ": " + it.message })
        runCatching { shot(short, "diagnostic-$checkpoint") }
            .onSuccess { data.put("screenshot", "projects313-$short-diagnostic-$checkpoint.png") }
            .onFailure { data.put("screenshotFailure", it.javaClass.simpleName + ": " + it.message) }
        File(target.getExternalFilesDir(null), "personal-project313-status-$short-$checkpoint.json").writeText(data.toString(2))
        println("QA313_PROJECT_STATUS_DIAGNOSTIC=$data")
    }
    private fun structure(app: GenesisApplication) = runBlocking { WorkspaceStructureRepository(app).workspace.first() }
    private fun waitProject(app: GenesisApplication, predicate: (GenesisProject) -> Boolean): GenesisProject {
        compose.waitUntil(15_000) { structure(app).projects.any(predicate) }
        return structure(app).projects.single(predicate)
    }
    private fun search(value: String) {
        if (compose.onAllNodesWithTag("personal-task-search").fetchSemanticsNodes().isEmpty()) click("personal-task-search-open")
        ready("personal-task-search").performTextReplacement(value)
        settleIme()
    }
    private fun assertSearchTask(id: String) {
        compose.onNodeWithTag("projects-screen").performScrollToNode(hasTestTag("task-$id"))
        ready("task-$id")
    }
    private fun assertOrder(first: String, second: String) {
        compose.onNodeWithTag("projects-screen").performScrollToIndex(0)
        compose.waitUntil(10_000) {
            val a = compose.onAllNodesWithTag("task-$first").fetchSemanticsNodes().singleOrNull()
            val b = compose.onAllNodesWithTag("task-$second").fetchSemanticsNodes().singleOrNull()
            a != null && b != null && a.boundsInRoot.top >= 0 && a.boundsInRoot.top < b.boundsInRoot.top
        }
        ready("task-$first"); ready("task-$second")
    }
    private fun shot(token: String, label: String) {
        compose.waitForIdle()
        captureNativeWindow(File(target.getExternalFilesDir(null), "projects313-$token-$label.png"))
    }

    @Test fun actualProjectEditorHierarchyAndSearchKeepOwnedRowsAcrossEncryptedReopen() {
        check(BuildConfig.DEBUG && target.packageName.endsWith(".debug"))
        val token = UUID.randomUUID().toString()
        val short = token.take(8)
        val before = baseline()
        val privateContext = Project313Context(target, token)
        check(!privateContext.databasePath.exists())
        val app = Instrumentation.newApplication(GenesisApplication::class.java, privateContext) as GenesisApplication
        privateContext.fixtureApplication = app
        check(app !== realApplication && app.applicationContext === app && app.database !== realApplication.database)
        check(privateContext.databasePath.canonicalFile != target.getDatabasePath("genesis.db").canonicalFile)
        val scope = app.workspaceScope
        val cipher = LocalCipher()
        val parentTitle = "QA313 Родитель $short"
        val childTitle = "QA313 Потомок $short"
        val renamed = "QA313 Изменён $short 🌿"
        val disposableTitle = "QA313 Удалить $short"
        val categoryTitle = "QA313 Стиль $short"
        val ownedProjects = mutableSetOf<String>()
        val ownedTasks = List(3) { UUID.randomUUID().toString() }
        var mounted by mutableStateOf(true)
        var generation by mutableIntStateOf(0)
        var independent: GenesisDatabase? = null
        var failure: Throwable? = null
        val proof = JSONObject().put("syntheticToken", token).put("widthDp", width).put("dark", dark)
            .put("actualScreen", "ProjectsScreen").put("privateDatabase", privateContext.databaseName)
            .put("isolatedApplicationOnCreateCalled", false).put("taskRowsAreFixturesOnly", true)
        try {
            assertTrue(structure(app).projects.isEmpty())
            assertTrue(runBlocking { app.database.dao().accountTasks(scope).isEmpty() })
            val uiContext = object : ContextWrapper(compose.activity) {
                override fun getApplicationContext(): Context = app
            }
            compose.setContent {
                CompositionLocalProvider(LocalContext provides uiContext, LocalGenesisLanguage provides "ru",
                    LocalEveningTheme provides dark, LocalDensity provides Density(
                        compose.activity.resources.displayMetrics.widthPixels.toFloat() / width, 1f)) {
                    val focus = LocalFocusManager.current
                    val keyboard = LocalSoftwareKeyboardController.current
                    SideEffect { hideSearchKeyboard = { focus.clearFocus(); keyboard?.hide() } }
                    MaterialTheme(colorScheme = if (dark) evening else standart, typography = GenesisTypography, shapes = GenesisShapes) {
                        Surface(Modifier.fillMaxSize()) {
                            if (mounted) key(generation) {
                                val tasks by remember(app) { app.repository.tasks }.collectAsState(initial = emptyList())
                                val work = rememberCoroutineScope()
                                MobileWorkspaceShell("Личные дела", null, emptyList(), "Private project UI test", true,
                                    onNavigate = { error("No outer navigation is used") }, actions = {}) {
                                    ProjectsScreen(app, tasks, true,
                                        onOpenTask = { error("No task editor is used") }, onCreateTask = { error("Task rows are fixtures") },
                                        onDeleteTask = { task -> work.launch { app.repository.delete(task.id, task.revision) } },
                                        onCompleteTask = { task -> work.launch { app.repository.complete(task.id) } })
                                }
                            }
                        }
                    }
                }
            }
            ready("projects-screen")
            // Real category editor/color picker; no extra per-project image/color control is invented.
            click("personal-task-search-open"); click("personal-category-filters"); click("manage-categories"); click("create-category")
            ready("category-name").performTextReplacement(categoryTitle)
            click("category-color-open")
            click("category-swatch-#8666a8")
            click("category-color-apply")
            click("save-category")
            compose.waitUntil(15_000) { structure(app).categories.any { it.name == categoryTitle && it.color == "#8666a8" } }
            val category = structure(app).categories.single { it.name == categoryTitle }
            click("manage-categories"); click("personal-category-filters"); click("personal-task-search-close")
            fun createProject(title: String, categoryId: String): GenesisProject {
                click("personal-actions"); click("create-project")
                ready("project-title")
                compose.onNodeWithTag("save-project").assertIsNotEnabled()
                ready("project-title").performTextReplacement(title)
                click("project-category-$categoryId"); saveProject()
                return waitProject(app) { it.title == title }.also { ownedProjects += it.id }
            }
            val parent = createProject(parentTitle, category.id)
            val child = createProject(childTitle, "work")
            val disposable = createProject(disposableTitle, "work")
            edit(child.id)
            ready("project-title").performTextReplacement(renamed)
            val description = compose.onNode(hasSetTextAction() and hasText("Описание", substring = false))
            if (!description.isDisplayed()) description.performScrollTo()
            description.performTextReplacement("QA313 вложенность и оформление $short")
            click("project-category-${category.id}")
            clickDialog(parentTitle)
            saveProject()
            val changed = waitProject(app) { it.id == child.id && it.title == renamed && it.parentId == parent.id && it.categoryId == category.id }
            assertEquals("QA313 вложенность и оформление $short", changed.description)
            row(child.id)
            compose.onNode(hasTestTag("project-category-color-${child.id}") and
                hasAnyAncestor(hasTestTag("project-drop-${child.id}")), useUnmergedTree = true).assertExists()
            shot(short, "hierarchy-style")

            // Only fixtures for actual search/sort: deliberately opposite title and due-date order.
            val alpha = LocalTask(id = ownedTasks[0], title = "A QA313 задача $short", date = "2030-02-02", revision = 1,
                projectId = child.id, categoryId = category.id, project = renamed)
            val zulu = LocalTask(id = ownedTasks[1], title = "Z QA313 задача $short", date = "2030-02-01", revision = 1,
                projectId = parent.id, categoryId = category.id, project = parentTitle)
            val other = LocalTask(id = ownedTasks[2], title = "M QA313 задача $short", date = "2030-02-03", revision = 1, categoryId = "work")
            runBlocking { app.database.withTransaction {
                listOf(alpha, zulu, other).forEach { task -> app.database.dao().putTask(TaskRecord(scope, task.id,
                    cipher.encrypt(task.json(), "$scope/${task.id}"), 1, false)) }
            } }
            search("absent-$short")
            ready("personal-search-empty")
            ownedTasks.forEach { compose.onNodeWithTag("task-$it").assertDoesNotExist() }
            search(short)
            ownedTasks.forEach(::assertSearchTask)
            click("personal-category-filters"); click("category-filter-${category.id}")
            compose.onNodeWithTag("category-filter-${category.id}").assertIsSelected()
            click("personal-category-filters")
            click("task-sort-control"); click("task-sort-title")
            compose.onNodeWithTag("task-${other.id}").assertDoesNotExist()
            assertOrder(alpha.id, zulu.id); shot(short, "filtered-title-order")
            click("task-sort-control"); click("task-sort-dueDate")
            assertOrder(zulu.id, alpha.id); shot(short, "filtered-due-order")
            click("personal-category-filters"); click("submenu-all")
            compose.onNodeWithTag("submenu-all").assertIsSelected()
            click("personal-category-filters")
            ownedTasks.forEach(::assertSearchTask)
            ready("personal-task-search").performTextClearance()
            click("personal-task-search-close")
            row(parent.id); row(child.id); row(disposable.id)
            // Completed/active are the shipped project editor controls, not task checkbox stubs.
            edit(child.id); selectProjectStatus("Завершён")
            saveProject("Завершён") { passiveDiagnostic(app, short, "before-completed-save") }
            passiveDiagnostic(app, short, "after-completed-save")
            waitProject(app) { it.id == child.id && it.status == "completed" }
            edit(child.id); selectProjectStatus("Активен")
            saveProject("Активен") { passiveDiagnostic(app, short, "before-active-save") }
            passiveDiagnostic(app, short, "after-active-save")
            waitProject(app) { it.id == child.id && it.status == "active" }
            val cancelDocument = runBlocking { app.database.dao().document(scope, "structure") }
            val cancelQueue = runBlocking { app.database.dao().outbox(scope).sortedBy { it.entityId } }
            val cancelTasks = runBlocking { app.database.dao().accountTasks(scope).sortedBy { it.id } }
            menu(parent.id); click("delete-project-${parent.id}")
            compose.onNodeWithTag("confirm-delete-project").assertExists()
            shot(short, "subtree-delete-cancel")
            clickDialog("Отмена")
            compose.waitUntil(10_000) { compose.onAllNodesWithTag("confirm-delete-project").fetchSemanticsNodes().isEmpty() }
            assertEquals(cancelDocument, runBlocking { app.database.dao().document(scope, "structure") })
            assertEquals(cancelQueue, runBlocking { app.database.dao().outbox(scope).sortedBy { it.entityId } })
            assertEquals(cancelTasks, runBlocking { app.database.dao().accountTasks(scope).sortedBy { it.id } })
            assertEquals(parent.id, structure(app).projects.single { it.id == child.id }.parentId)
            // Confirm deletion only of a UUID-owned empty project. No task-move/reminder side effects.
            assertTrue(runBlocking { app.repository.tasks.first() }.none { it.projectId == disposable.id })
            menu(disposable.id); click("delete-project-${disposable.id}"); click("confirm-delete-project")
            compose.waitUntil(15_000) { structure(app).projects.none { it.id == disposable.id } }
            assertEquals(setOf(parent.id, child.id), structure(app).projects.map { it.id }.toSet())
            assertEquals(cancelTasks, runBlocking { app.database.dao().accountTasks(scope).sortedBy { it.id } })

            val persisted = requireNotNull(runBlocking { app.database.dao().document(scope, "structure") })
            assertFalse(persisted.encrypted.contains(renamed)); assertFalse(persisted.encrypted.contains(categoryTitle))
            assertEquals(privateContext.databasePath.canonicalPath, File(app.database.openHelper.writableDatabase.path).canonicalPath)
            independent = Room.databaseBuilder(app, GenesisDatabase::class.java, "genesis.db").build()
            val disk = requireNotNull(runBlocking { independent!!.dao().document(scope, "structure") })
            assertEquals(persisted, disk)
            val decoded = WorkspaceStructureCodec.decode(cipher.decrypt(disk.encrypted, "$scope/structure"), disk.revision)
            val fresh = structure(app) // A new production repository, not a copied fixture state.
            assertEquals(decoded, fresh)
            assertEquals(parent.id, fresh.projects.single { it.id == child.id }.parentId)
            assertEquals(renamed, fresh.projects.single { it.id == child.id }.title)
            assertEquals("active", fresh.projects.single { it.id == child.id }.status)
            assertEquals("#665C88", fresh.categories.single { it.id == category.id }.color)
            assertEquals(ownedTasks.toSet(), runBlocking { independent!!.dao().accountTasks(scope) }.map { it.id }.toSet())
            compose.runOnIdle { generation++ }
            ready("projects-screen"); row(child.id)
            menu(child.id); compose.onNodeWithText("Изменить проект", substring = false).performClick()
            ready("project-title").assertTextContains(renamed)
            compose.onNodeWithTag("project-category-${category.id}").assertIsSelected()
            dialogText(parentTitle).assertIsSelected()
            click("close-project-editor")
            search(short) // Remounted screen has no query seed; only the actual search action sets it.
            click("task-sort-control"); compose.onNodeWithTag("task-sort-dueDate").assertIsSelected()
            click("task-sort-dueDate")
            ownedTasks.forEach(::assertSearchTask)
            shot(short, "fresh-repository-reopen")
            proof.put("createdProjectIds", JSONArray(ownedProjects.toList())).put("categoryId", category.id)
                .put("seededTaskIds", JSONArray(ownedTasks)).put("confirmedDeletedEmptyProjectId", disposable.id)
                .put("deleteCancelDocumentAndQueueUnchanged", true).put("freshRoomCiphertextEqual", true)
                .put("freshRepositoryAndActualEditorReopened", true).put("sortPersistedAfterRemount", true)
                .put("privateStructureRevision", fresh.revision)
        } catch (error: Throwable) {
            failure = error
            // The isolated database still exists here. Diagnostics are read-only and precede every cleanup step.
            runCatching { passiveDiagnostic(app, short, "failure-before-cleanup") }
                .exceptionOrNull()?.let(error::addSuppressed)
            throw error
        }
        finally {
            val cleanupErrors = mutableListOf<Throwable>()
            fun cleanupStep(action: () -> Unit) { runCatching(action).exceptionOrNull()?.let(cleanupErrors::add) }
            cleanupStep {
                compose.runOnIdle { mounted = false }; compose.waitForIdle()
            }
            cleanupStep { independent?.close() }
            cleanupStep { app.appScope.cancel(); app.database.close() }
            cleanupStep {
                check(privateContext.databasePath.name == privateContext.databaseName)
                check(privateContext.databasePath.parentFile!!.canonicalFile == target.getDatabasePath("genesis.db").parentFile!!.canonicalFile)
                target.deleteDatabase(privateContext.databaseName)
                check(!privateContext.databasePath.exists())
            }
            cleanupStep {
                privateContext.preferenceNames.forEach { name ->
                    require(name.startsWith(privateContext.preferencePrefix))
                    // Wait for this private preference file's preceding apply writes before exact removal.
                    check(target.getSharedPreferences(name, 0).edit().commit())
                    target.deleteSharedPreferences(name)
                }
            }
            cleanupStep {
                assertTrue("Original app data, outbox and preferences must stay byte-equal", before == baseline())
            }
            val cleanupError = cleanupErrors.firstOrNull()?.also { first -> cleanupErrors.drop(1).forEach(first::addSuppressed) }
            proof.put("failure", failure?.toString() ?: JSONObject.NULL)
                .put("cleanupFailure", cleanupError?.toString() ?: JSONObject.NULL)
                .put("originalAppBaselinePreserved", cleanupError == null)
                .put("onlyExactPrivateDatabaseAndNamespacedPreferencesRemoved", cleanupError == null)
            File(target.getExternalFilesDir(null), "personal-project313-proof-$short.json").writeText(proof.toString(2))
            println("QA313_PERSONAL_PROJECT_PROOF=$proof")
            if (cleanupError != null) { if (failure != null) failure!!.addSuppressed(cleanupError) else throw cleanupError }
        }
    }
}
