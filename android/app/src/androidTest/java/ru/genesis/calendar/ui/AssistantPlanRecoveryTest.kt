package ru.genesis.calendar.ui

import android.os.Build
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.auth.AssistantGateway
import ru.genesis.calendar.data.*
import ru.genesis.calendar.domain.CalendarMode
import java.io.File
import java.io.IOException
import java.time.LocalDate
import java.util.UUID

/** Uses only the emulator's debug validation scope and uniquely owned synthetic rows. */
class AssistantPlanRecoveryTest {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    private val app get() = compose.activity.application as GenesisApplication
    private val token = UUID.randomUUID().toString()
    private val owner = "assistant-test-$token"
    private var current: JSONObject? = null
    private var active = false
    private val ownedTasks = mutableListOf<String>()
    private val ownedProjects = mutableListOf<String>()
    private val ownedLists = mutableListOf<GoogleTaskList>()
    private val gateway = object : AssistantGateway {
        override fun check() = Unit
        override suspend fun status() = JSONObject().put("available", true).put("audioAvailable", false).put("provider", "gemini")
        override suspend fun plan(command: String, audio: JSONObject?, context: JSONObject) = response()
    }
    private fun response(withList: Boolean = false): JSONObject {
        val today = LocalDate.now().toString()
        val project = JSONObject().put("title", "Тестовый проект $token").put("description", "Проверка восстановления")
            .put("parentProject", "").put("category", "").put("tags", JSONArray())
        val tasks = JSONArray()
        if (!withList) repeat(2) { index -> tasks.put(JSONObject().put("title", "Синтетическая задача ${index + 1} $token")
            .put("description", "Сохранить черновик").put("startDate", today).put("dueDate", today).put("time", "18:30")
            .put("project", project.getString("title")).put("taskList", "").put("tags", JSONArray().put("проверка"))
            .put("priority", 5).put("reminderMinutes", 0)) }
        val lists = JSONArray()
        if (withList) lists.put(JSONObject().put("title", "Тестовый список $token").put("project", project.getString("title")).put("accountEmail", ""))
        return JSONObject().put("provider", "gemini").put("model", "synthetic-test")
            .put("plan", JSONObject().put("summary", "Только искусственные данные").put("request", "Проверить сохранение")
                .put("projects", JSONArray().put(project)).put("tasks", tasks).put("taskLists", lists))
    }
    private fun repository(create: suspend (String, String) -> GoogleTaskList = { _, _ -> error("No remote lists in this fixture") }) =
        AssistantPlanRepository(app, owner, gateway, create)
    @Before fun guard() = runBlocking {
        assumeTrue(BuildConfig.DEBUG && (Build.HARDWARE == "ranchu" || Build.HARDWARE == "goldfish"))
        assumeTrue(app.workspaceScope == "internal-validation-v1")
        assumeTrue(app.database.dao().document(app.workspaceScope, "assistant-plan-v1") == null)
        active = true
    }
    private suspend fun prepare(repo: AssistantPlanRepository, list: Boolean = false): JSONObject = repo.prepare(
        response(list), WorkspaceStructureRepository(app).workspace.first(), TaskListsRepository(app).lists.first(), emptyList()).also {
        current = it
        val tasks = it.getJSONArray("taskIds"); repeat(tasks.length()) { index -> ownedTasks += tasks.getString(index) }
        val projects = it.getJSONArray("projectIds"); repeat(projects.length()) { index -> ownedProjects += projects.getString(index) }
    }
    @After fun cleanup() = runBlocking {
        if (!active || app.workspaceScope != "internal-validation-v1") return@runBlocking
        repository().load()?.let { repository().discard(it.getString("id")) }
        ownedTasks.forEach { id -> app.repository.get(id)?.let { app.repository.delete(it.id, it.revision) } }
        ownedProjects.forEach { id ->
            if (WorkspaceStructureRepository(app).workspace.first().projects.any { it.id == id }) WorkspaceStructureRepository(app).deleteProject(id)
        }
        ownedLists.forEach { TaskListsRepository(app).rememberRemoved(it) }
    }
    @Test fun interruptionAfterLocalCommitResumesWithoutDuplicates() = runBlocking {
        val first = repository(); val journal = prepare(first)
        val result = runCatching { first.apply(journal, emptyList(), CalendarMode.PROFANE) {
            if (it.getInt("tasksDone") == 1) throw IOException("synthetic interruption after checkpoint")
        } }
        assertTrue(result.isFailure)
        assertNotNull(app.repository.get(ownedTasks.first()))
        assertNull(app.repository.get(ownedTasks.last()))
        val completed = app.repository.get(ownedTasks.first())!!
        app.repository.delete(completed.id, completed.revision)
        val encrypted = app.database.dao().document(app.workspaceScope, "assistant-plan-v1")!!.encrypted
        assertFalse(encrypted.contains("Синтетическая")); assertFalse(encrypted.contains(token))
        val restarted = repository(); val restored = restarted.load()!!
        assertEquals(1, restored.getInt("tasksDone"))
        restarted.apply(restored, emptyList(), CalendarMode.PROFANE) {}
        assertNull(restarted.load())
        assertNull(app.repository.get(ownedTasks.first()))
        assertEquals(1, ownedTasks.count { app.repository.get(it) != null })
        assertTrue(runCatching { restarted.apply(restored, emptyList(), CalendarMode.PROFANE) {} }.isFailure)
        assertEquals(1, ownedTasks.count { app.repository.get(it) != null })
    }
    @Test fun uncertainRemoteListCreationIsNotSentTwice() = runBlocking {
        var sent = 0
        val repo = repository { _, _ -> sent++; throw IOException("synthetic lost reply") }
        val journal = prepare(repo, true)
        assertTrue(runCatching { repo.apply(journal, emptyList(), CalendarMode.PROFANE) {} }.isFailure)
        assertEquals(1, sent)
        val pending = repo.load()!!
        assertEquals(0, pending.getInt("pendingList"))
        assertTrue(runCatching { repo.apply(pending, emptyList(), CalendarMode.PROFANE) {} }.isFailure)
        assertEquals(1, sent)
        val list = GoogleTaskList("local:$token", "Тестовый список $token")
        ownedLists += list; TaskListsRepository(app).rememberCreated(list)
        repo.apply(repo.load()!!, emptyList(), CalendarMode.PROFANE) {}
        assertEquals(1, sent); assertNull(repo.load())
    }
    @Test fun reviewedPlanRemainsReadableWithLargeFontAndStickyApply() {
        val repo = repository()
        runBlocking { prepare(repo) }
        val args = InstrumentationRegistry.getArguments()
        val dark = args.getString("genesisEvening") == "true"
        val width = args.getString("genesisWidth")?.toIntOrNull() ?: 390
        compose.setContent {
            CompositionLocalProvider(LocalGenesisLanguage provides "ru", LocalEveningTheme provides dark,
                LocalDensity provides Density(compose.activity.resources.displayMetrics.widthPixels.toFloat() / width, 1.3f)) {
                MaterialTheme(colorScheme = if (dark) evening else standart, typography = GenesisTypography, shapes = GenesisShapes) {
                    Surface(Modifier.fillMaxSize()) { ServerAssistantDialog(app, owner, gateway, WorkspaceStructure(), emptyList(), emptyList(), CalendarMode.PROFANE,
                        "ru", { _, _ -> error("No network") }, {}, {}) }
                }
            }
        }
        compose.waitUntil(15000) { compose.onAllNodesWithTag("server-assistant-apply").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("server-assistant-apply").assertIsDisplayed().assertIsEnabled()
        val folder = File(app.getExternalFilesDir(null), "3.0-workspace-captures").apply { mkdirs() }
        val image = compose.onAllNodes(isRoot()).onLast().captureToImage().asAndroidBitmap()
        java.io.FileOutputStream(File(folder, "3.0-assistant-$width-${if (dark) "dark" else "light"}-font130.png")).use {
            assertTrue(image.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)); it.fd.sync()
        }
    }
}
