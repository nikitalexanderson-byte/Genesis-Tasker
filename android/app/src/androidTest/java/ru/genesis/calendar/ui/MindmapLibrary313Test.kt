package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.captureNativeWindow
import ru.genesis.calendar.data.GenesisDatabase
import ru.genesis.calendar.data.MindmapDocument
import ru.genesis.calendar.data.MindmapRepository
import ru.genesis.calendar.data.MindmapTransport
import ru.genesis.calendar.data.NativeMapRecord
import ru.genesis.calendar.domain.CalendarMode
import java.io.File
import java.util.Base64
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger

/** Actual shipped catalog/editor and encrypted Room; private synthetic database, no account/session/HTTP. */
class MindmapLibrary313Test {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val args get() = InstrumentationRegistry.getArguments()

    /** Same encrypted transport pattern as MindmapsReview5Test, retaining real envelopes for history. */
    private class Transport : MindmapTransport {
        private val mutex = Mutex()
        private val latest = linkedMapOf<String, JSONObject>()
        private val versions = linkedMapOf<String, MutableList<JSONObject>>()
        val writes = AtomicInteger()
        val historyReads = AtomicInteger()
        override fun check() = Unit
        override suspend fun workspace() = JSONObject().put("workspace", JSONObject()
            .put("keyMode", "account")
            .put("key", Base64.getEncoder().encodeToString(ByteArray(32) { (it + 13).toByte() })))

        override suspend fun request(path: String, body: JSONObject?): JSONObject = mutex.withLock {
            if (body == null) {
                if (path == "/mindmaps") return@withLock JSONObject().put("maps",
                    JSONArray(latest.values.map { JSONObject(it.toString()) }))
                require(path.startsWith("/mindmaps/") && path.endsWith("/history")) { "Unexpected fixture read: $path" }
                val id = path.removePrefix("/mindmaps/").removeSuffix("/history")
                require('/' !in id && id in latest)
                historyReads.incrementAndGet()
                return@withLock JSONObject().put("versions", JSONArray(versions.getValue(id)
                    .asReversed().map { JSONObject(it.toString()) }))
            }
            require(Regex("/mindmaps/[A-Za-z0-9_-]{1,100}").matches(path))
            val id = path.substringAfterLast('/')
            val previous = latest[id]?.getLong("revision") ?: 0L
            require(body.getInt("schemaVersion") == 2 && body.getLong("expectedRevision") == previous)
            val revision = previous + 1
            val row = JSONObject(body.toString()).put("id", id).put("revision", revision)
            latest[id] = row
            versions.getOrPut(id) { mutableListOf() }.add(JSONObject(row.toString()))
            writes.incrementAndGet()
            JSONObject().put("revision", revision)
        }
    }

    private fun ready(tag: String): SemanticsNodeInteraction {
        compose.waitUntil(15_000) {
            compose.onAllNodesWithTag(tag).filter(isEnabled()).fetchSemanticsNodes().size == 1
        }
        return compose.onNodeWithTag(tag).assertIsEnabled()
    }

    private fun gone(tag: String) = compose.waitUntil(15_000) {
        compose.onAllNodesWithTag(tag).fetchSemanticsNodes().isEmpty()
    }

    private fun titleField() = compose.onNode(hasSetTextAction() and hasText("Название карты"))

    @Test fun actualCatalogEditorAndEncryptedReopenKeepOneMapAndItsNodeHistory() {
        check(BuildConfig.DEBUG && context.packageName.endsWith(".debug"))
        val token = UUID.randomUUID().toString()
        val scope = "mindmap-library313-$token"
        val uid = "mindmap-qa-$token"
        val databaseName = "mindmap-library313-$token.db"
        check(Regex("mindmap-library313-[a-f0-9-]+\\.db").matches(databaseName))
        val databases = mutableListOf<GenesisDatabase>()
        fun openDatabase() = Room.databaseBuilder(context, GenesisDatabase::class.java, databaseName).build()
            .also { databases += it }
        val transport = Transport()
        var database = openDatabase()
        var repository = MindmapRepository(database, scope, uid, transport)
        var renderedRepository by mutableStateOf(repository)
        var mounted by mutableStateOf(true)
        val width = args.getString("genesisWidth")?.toIntOrNull() ?: 360
        val fontScale = args.getString("genesisFontScale")?.toFloatOrNull() ?: 1.3f
        val dark = args.getString("genesisDark") == "true"
        val title = "MAP313 ${token.take(8)} · Карта Αθήνα 日本語"
        val renamed = "$title · переименована"
        val originalThought = "Первая мысль ${token.take(8)} · Αθήνα"
        val editedThought = "Изменённая мысль ${token.take(8)} · 東京"
        val checks = JSONArray()
        val images = JSONArray()
        var failure: Throwable? = null
        var outerBack = 0

        fun saved(predicate: (MindmapDocument) -> Boolean): NativeMapRecord {
            compose.waitUntil(20_000) {
                repository.records.value.singleOrNull()?.let { !it.unsynced && predicate(it.document) } == true
            }
            compose.waitForIdle()
            return repository.records.value.single()
        }
        fun shot(name: String) {
            compose.waitForIdle()
            val file = File(context.getExternalFilesDir(null), "mindmap-library313-${token.take(8)}-$name.png")
            captureNativeWindow(file)
            images.put(file.name)
            checks.put(name)
        }
        fun openThought(id: String) {
            compose.onNodeWithTag("mindmap-node-$id").performScrollTo().performClick()
            ready("mindmap-node-save")
        }

        try {
            compose.setContent {
                if (mounted) key(renderedRepository) {
                    CompositionLocalProvider(
                        LocalDensity provides Density(compose.activity.resources.displayMetrics.widthPixels.toFloat() / width, fontScale),
                        LocalGenesisLanguage provides "ru", LocalEveningTheme provides dark
                    ) {
                        MaterialTheme(colorScheme = if (dark) evening else standart,
                            typography = GenesisTypography, shapes = GenesisShapes) {
                            Surface(Modifier.fillMaxSize()) {
                                MobileWorkspaceShell("Проекты", null, emptyList(), "Синтетическая проверка", true,
                                    onNavigate = { error("Unexpected outer navigation") },
                                    actions = { CalendarModeSwitcher(CalendarMode.PROFANE, {}, size = 48.dp) }) {
                                    MindmapsScreen(renderedRepository, emptyList(), emptyList(), null,
                                        onBack = { outerBack++ }, onTask = { _, _ -> error("No task action in this fixture") },
                                        onCreate = { error("No task creation in this fixture") },
                                        onComplete = { _, _ -> error("No task completion in this fixture") },
                                        onProject = { error("No project action in this fixture") })
                                }
                            }
                        }
                    }
                }
            }
            ready("mindmaps-create")
            assertTrue(repository.records.value.isEmpty())
            shot("empty-catalog")
            ready("mindmaps-create").performClick()
            titleField().performTextReplacement(title)
            compose.onNodeWithText("Сохранить", substring = false).assertIsEnabled().performClick()
            val created = saved { it.title == title }
            val id = created.document.id
            assertEquals(1, created.document.nodes.size)
            assertEquals(1, transport.writes.get())
            ready("mindmap-title-description").performClick()
            titleField().assertTextContains(title).performTextReplacement(renamed)
            compose.onNodeWithText("Сохранить", substring = false).assertIsEnabled().performClick()
            saved { it.id == id && it.title == renamed }
            ready("mindmaps-back").performClick()
            ready("mindmap-open-$id")
            ready("mindmaps-search-open").performClick()
            compose.onNodeWithTag("mindmaps-search").performTextReplacement("absent-$token")
            compose.onNodeWithTag("mindmap-open-$id").assertDoesNotExist()
            compose.onNodeWithTag("mindmaps-search").performTextReplacement(renamed)
            ready("mindmap-open-$id")
            shot("renamed-search")
            compose.onNodeWithTag("mindmaps-search").performTextClearance()
            ready("mindmaps-search-close").performClick()
            ready("mindmap-open-$id").performClick()
            ready("mindmap-add-node").performClick()
            ready("mindmap-add-thought").performClick()
            val added = saved { it.id == id && it.nodes.size == 2 }
            val child = added.document.nodes.single { it.parentId != null }
            compose.onNodeWithTag("mindmap-node-text").performTextReplacement(originalThought)
            ready("mindmap-node-save").performClick()
            saved { it.nodes.single { n -> n.id == child.id }.text == originalThought }
            ready("mindmap-mode-toggle").assertContentDescriptionEquals("Показать структуру").performClick()
            openThought(child.id)
            compose.onNodeWithTag("mindmap-node-text").performTextReplacement(editedThought)
            ready("mindmap-node-save").performClick()
            val edited = saved { it.nodes.single { n -> n.id == child.id }.text == editedThought }
            val editedRevision = edited.revision

            openThought(child.id)
            val writesBeforeCancel = transport.writes.get()
            ready("mindmap-node-delete").performClick()
            compose.onNodeWithText("Убрать ветку?", useUnmergedTree = true).assertExists()
            compose.onNodeWithText("Отмена", substring = false).performClick()
            compose.waitUntil(10_000) { compose.onAllNodesWithText("Убрать ветку?", useUnmergedTree = true).fetchSemanticsNodes().isEmpty() }
            assertEquals(writesBeforeCancel, transport.writes.get())
            assertEquals(editedRevision, repository.records.value.single().revision)
            assertEquals(editedThought, repository.records.value.single().document.nodes.single { it.id == child.id }.text)
            ready("mindmap-node-close").performClick()
            gone("mindmap-node-text")
            ready("mindmap-undo").performClick()
            val undone = saved { it.nodes.single { n -> n.id == child.id }.text == originalThought }
            assertTrue(undone.revision > editedRevision)
            assertEquals(2, undone.document.nodes.size)
            shot("branch-cancel-and-undo")

            ready("mindmap-history").performScrollTo().performClick()
            compose.waitUntil(15_000) { transport.historyReads.get() == 1 &&
                compose.onAllNodesWithText("История карты", useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty() }
            assertEquals(undone.revision, repository.records.value.single().revision)
            val version = "Версия $editedRevision · $renamed"
            compose.onNodeWithText(version, substring = false).performScrollTo().assertIsEnabled()
            shot("encrypted-history")
            compose.onNodeWithText(version, substring = false).performClick()
            val restored = saved { it.nodes.single { n -> n.id == child.id }.text == editedThought }
            assertTrue(restored.revision > undone.revision)
            ready("mindmaps-back").performClick()
            ready("mindmap-open-$id")
            val encrypted = runBlocking { requireNotNull(database.dao().document(scope, "mindmaps")) }
            assertFalse(encrypted.encrypted.contains(renamed))
            assertFalse(encrypted.encrypted.contains(editedThought))
            assertTrue(runBlocking { database.dao().accountTasks(scope).isEmpty() })
            assertTrue(runBlocking { database.dao().outbox(scope).isEmpty() })

            // New Room instance + new repository read the persisted ciphertext before any refresh.
            compose.runOnIdle { mounted = false }
            compose.waitForIdle()
            database = openDatabase()
            repository = MindmapRepository(database, scope, uid, transport)
            runBlocking { repository.loadCached() }
            val cached = repository.records.value.single()
            assertEquals(id, cached.document.id)
            assertEquals(renamed, cached.document.title)
            assertEquals(restored.revision, cached.revision)
            assertEquals(editedThought, cached.document.nodes.single { it.id == child.id }.text)
            assertEquals(encrypted.encrypted, runBlocking { database.dao().document(scope, "mindmaps")!!.encrypted })
            compose.runOnIdle { renderedRepository = repository; mounted = true }
            ready("mindmap-open-$id").performClick()
            ready("mindmap-mode-toggle").assertContentDescriptionEquals("Показать структуру").performClick()
            compose.onNodeWithTag("mindmap-node-${child.id}").performScrollTo().assertTextContains(editedThought)
            assertEquals(1, repository.records.value.size)
            assertEquals(2, repository.records.value.single().document.nodes.size)
            assertEquals(0, outerBack)
            shot("fresh-room-reopened")
        } catch (error: Throwable) {
            failure = error
            throw error
        } finally {
            runCatching { compose.runOnIdle { mounted = false }; compose.waitForIdle() }
            databases.asReversed().forEach { runCatching { it.close() } }
            // Generated private DB only; never the app's genesis.db, documents, preferences or keys.
            context.deleteDatabase(databaseName)
            val removed = !context.getDatabasePath(databaseName).exists()
            File(context.getExternalFilesDir(null), "mindmap-library313-proof.json").writeText(JSONObject()
                .put("test", "actualCatalogEditorAndEncryptedReopenKeepOneMapAndItsNodeHistory")
                .put("applicationId", context.packageName).put("scope", scope).put("database", databaseName)
                .put("widthDp", width).put("fontScale", fontScale).put("dark", dark)
                .put("checks", checks).put("screenshots", images).put("fixtureWrites", transport.writes.get())
                .put("historyReads", transport.historyReads.get()).put("ownDatabaseRemoved", removed)
                .put("failure", failure?.stackTraceToString() ?: JSONObject.NULL)
                .put("notTested", JSONArray(listOf("Whole-map deletion: no such catalog action",
                    "Process death/Activity recreation", "Real network/account/shared map rights", "Redo: absent capability")))
                .toString(2))
            if (failure == null) assertTrue("Only the generated private test database must be removed", removed)
        }
    }
}
