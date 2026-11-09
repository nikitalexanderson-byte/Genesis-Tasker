package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.auth.AuthFailure
import ru.genesis.calendar.auth.MessagingGateway
import ru.genesis.calendar.captureNativeWindow
import ru.genesis.calendar.data.LocalCipher
import ru.genesis.calendar.data.MessengerRepository
import ru.genesis.calendar.data.MessagingStore
import java.io.File
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

/** In-memory test cells only; no Room database, AuthController or real account. */
private class OrdinaryCycleStore : MessagingStore {
    private val cells = ConcurrentHashMap<String, String>()
    private val cipher = LocalCipher()
    private val scope = "ordinary-cycle-${UUID.randomUUID()}"
    override suspend fun read(key: String) = cells[key]?.let { cipher.decrypt(it, "$scope:$key") }
    override suspend fun write(key: String, value: String) { cells[key] = cipher.encrypt(value, "$scope:$key") }
    override suspend fun delete(key: String) { cells.remove(key) }
}

private data class OrdinaryCycleCall(val method: String, val path: String, val body: String?)

/** Strict in-process transport: unexpected routes/recipients fail, and no network client exists. */
private class OrdinaryCycleGateway : MessagingGateway {
    val owner = "ordinary-cycle-owner"
    val peer = "ordinary-cycle-peer"
    val email = "ordinary-cycle-peer@example.invalid"
    val otherId = "31300000-0000-0000-0000-000000000001"
    val loseNextReply = AtomicBoolean(false)
    private val lock = Any()
    private var contactAdded = false
    private var target: String? = null
    private val calls = mutableListOf<OrdinaryCycleCall>()
    private val chats = linkedMapOf(otherId to chat(otherId, "QA Другой чат", "ordinary-cycle-other"))
    private val rows = mutableMapOf<String, MutableList<JSONObject>>()
    private val committed = mutableMapOf<String, String>()
    val targetId: String get() = synchronized(lock) { requireNotNull(target) }
    fun messageCalls() = synchronized(lock) { calls.filter { it.method == "POST" && it.path.endsWith("/messages") } }
    fun texts(id: String) = synchronized(lock) { rows[id].orEmpty().map { it.getString("text") } }
    fun historyReads(id: String) = synchronized(lock) { calls.count { it.method == "GET" && it.path == "/shared/messenger/conversations/$id/messages?before=0" } }
    fun forbiddenRoutes() = synchronized(lock) { calls.filter { !it.path.startsWith("/shared/messenger/") || "/devices" in it.path || "/key" in it.path || "/files" in it.path } }
    private fun chat(id: String, title: String, peerId: String) = JSONObject()
        .put("id", id).put("kind", "direct").put("title", title).put("members", JSONArray()
            .put(JSONObject().put("userId", owner).put("name", "QA Вы").put("role", "owner").put("status", "active"))
            .put(JSONObject().put("userId", peerId).put("name", title).put("role", "member").put("status", "active")))
    private fun contact() = JSONObject().put("userId", peer).put("name", "QA Нужный собеседник").put("email", email)
    override fun check() = Unit
    override suspend fun request(method: String, path: String, body: JSONObject?): JSONObject = synchronized(lock) {
        calls += OrdinaryCycleCall(method, path, body?.toString())
        require(path.startsWith("/shared/messenger/"))
        val route = path.removePrefix("/shared/messenger")
        when {
            method == "GET" && route == "/conversations" -> JSONObject().put("conversations", JSONArray(chats.values.toList()))
            method == "GET" && route == "/contacts" -> JSONObject().put("contacts", if (contactAdded) JSONArray().put(contact()) else JSONArray())
            method == "POST" && route == "/contacts" -> {
                val input = requireNotNull(body)
                require(input.length() == 1 && input.getString("email") == email)
                contactAdded = true
                JSONObject().put("ok", true)
            }
            method == "POST" && route == "/conversations" -> {
                val input = requireNotNull(body)
                require(contactAdded && target == null && input.length() == 3)
                require(input.getString("kind") == "direct" && input.getString("email") == email)
                val id = UUID.fromString(input.getString("id")).toString()
                target = id
                chat(id, "QA Нужный собеседник", peer).also { chats[id] = it }
            }
            method == "GET" && chats.keys.any { route == "/conversations/$it" } -> JSONObject(requireNotNull(chats[route.substringAfterLast('/')]).toString())
            method == "GET" && chats.keys.any { route == "/conversations/$it/messages?before=0" } -> {
                val id = route.removePrefix("/conversations/").substringBefore('/')
                JSONObject().put("messages", JSONArray(rows[id].orEmpty().map { JSONObject(it.toString()) })).put("nextCursor", JSONObject.NULL)
            }
            method == "POST" && chats.keys.any { route == "/conversations/$it/read" } -> {
                val id = route.removePrefix("/conversations/").substringBefore('/')
                require(requireNotNull(body).getLong("seq") == rows[id].orEmpty().maxOf { it.getLong("seq") })
                JSONObject().put("ok", true)
            }
            method == "POST" && target != null && route == "/conversations/$target/messages" -> {
                val input = requireNotNull(body)
                require(input.length() == 2)
                val messageId = UUID.fromString(input.getString("id")).toString()
                val command = input.toString()
                val previous = committed[messageId]
                require(previous == null || previous == command) { "Retry changed the saved command" }
                if (previous == null) {
                    val messages = rows.getOrPut(requireNotNull(target)) { mutableListOf() }
                    messages += JSONObject().put("id", messageId).put("seq", messages.size + 1).put("senderId", owner)
                        .put("revision", 1).put("deletedAt", JSONObject.NULL).put("text", input.getString("text"))
                    committed[messageId] = command
                }
                // The fake accepted the message, but its first reply never reached the UI.
                if (loseNextReply.compareAndSet(true, false)) throw AuthFailure(AuthFailure.Kind.NETWORK)
                JSONObject().put("ok", true).put("id", messageId)
            }
            else -> error("Unexpected ordinary messenger fixture route: $method $path")
        }
    }
}

/** Current MessengerScreen only. This is not legacy MessagingScreen or a live server test. */
class MessengerOrdinaryCycleTest {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    private val gateway = OrdinaryCycleGateway()
    private val store = OrdinaryCycleStore()
    private var repository by mutableStateOf(MessengerRepository(gateway.owner, gateway, store))
    private val width get() = InstrumentationRegistry.getArguments().getString("genesisWidth")?.toIntOrNull() ?: 390
    private val dark get() = InstrumentationRegistry.getArguments().getString("genesisEvening") == "true"

    private fun content() = compose.setContent {
        CompositionLocalProvider(
            LocalDensity provides Density(compose.activity.resources.displayMetrics.widthPixels.toFloat() / width, 1f),
            LocalGenesisLanguage provides "ru", LocalEveningTheme provides dark
        ) {
            MaterialTheme(colorScheme = if (dark) evening else standart, typography = GenesisTypography, shapes = GenesisShapes) {
                Surface(Modifier.fillMaxSize()) {
                    MobileWorkspaceShell("Сообщения", null, emptyList(), "Synthetic ordinary messenger cycle", true, onNavigate = {}, actions = {}) {
                        key(repository) { MessengerScreen(repository, "ru", onClose = {}) }
                    }
                }
            }
        }
    }
    private fun clickTag(tag: String) {
        compose.waitUntil(10000) { runCatching { compose.onNodeWithTag(tag).assertIsEnabled() }.isSuccess }
        compose.onNodeWithTag(tag).performClick()
    }
    private fun clickDescription(description: String) {
        compose.waitUntil(10000) { runCatching { compose.onNodeWithContentDescription(description).assertIsEnabled() }.isSuccess }
        compose.onNodeWithContentDescription(description).performClick()
    }
    private fun send(text: String) {
        compose.waitUntil(10000) { runCatching { compose.onNodeWithTag("messenger-draft").assertIsEnabled() }.isSuccess }
        compose.onNodeWithTag("messenger-draft").performTextInput(text)
        clickDescription("Отправить")
    }
    private fun backToInbox() {
        clickTag("messenger-back")
        compose.waitUntil(10000) { repository.state.value.selected == null }
    }
    private fun open(id: String) {
        clickTag("messenger-chat-$id")
        compose.waitUntil(10000) { repository.state.value.selected?.id == id }
    }
    private fun capture(name: String) {
        compose.waitForIdle()
        captureNativeWindow(File(compose.activity.getExternalFilesDir(null), "messenger313ordinary-$width-${if (dark) "dark" else "light"}-$name.png"))
    }

    @Test fun contactSendHistoryAndRestoredRetryRemainBoundToTheSameOrdinaryChat() {
        val first = "QA обычная переписка: история"
        val uncertain = "QA повтор без дубликата 🌿"
        content()
        compose.waitUntil(15000) { repository.state.value.ready }
        compose.waitUntil(10000) { runCatching { compose.onNodeWithText("Контакты").assertIsEnabled() }.isSuccess }
        compose.onNodeWithText("Контакты").performClick()
        compose.waitUntil(10000) { compose.onAllNodesWithTag("messenger-contact-email").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("messenger-contact-email").performTextInput(gateway.email)
        clickTag("messenger-contact-add")
        compose.waitUntil(10000) { repository.state.value.contacts.singleOrNull()?.email == gateway.email }
        compose.waitUntil(10000) { runCatching { compose.onNodeWithText(gateway.email).assertIsEnabled() }.isSuccess }
        compose.onNodeWithText(gateway.email).performClick()
        compose.waitUntil(10000) { repository.state.value.selected?.members?.any { it.userId == gateway.peer } == true }
        val target = gateway.targetId
        assertEquals(target, repository.state.value.selected?.id)
        assertEquals("direct", repository.state.value.selected?.kind)
        assertNull(repository.state.value.secretError)

        send(first)
        compose.waitUntil(10000) { !repository.state.value.pending && repository.state.value.rows.map { it.text } == listOf(first) }
        compose.onNodeWithText(first).assertExists()
        assertEquals(listOf(first), gateway.texts(target))
        assertEquals(1, gateway.messageCalls().size)

        gateway.loseNextReply.set(true)
        send(uncertain)
        compose.waitUntil(10000) { repository.state.value.pending && gateway.messageCalls().size == 2 }
        compose.waitUntil(10000) { runCatching { compose.onNodeWithContentDescription("Повторить").assertIsEnabled() }.isSuccess }
        compose.onNodeWithTag("messenger-draft").assertIsNotEnabled()
        val pendingKey = "messenger/pending/$target"
        val persisted = requireNotNull(runBlocking { store.read(pendingKey) })
        val saved = JSONObject(persisted)
        val uncertainCall = gateway.messageCalls()[1]
        assertEquals("POST", saved.getString("method"))
        assertEquals("/shared/messenger" + saved.getString("path"), uncertainCall.path)
        assertEquals(uncertainCall.body, saved.getJSONObject("body").toString())
        assertEquals(uncertain, saved.getJSONObject("body").getString("text"))
        assertEquals(listOf(first, uncertain), gateway.texts(target))

        backToInbox()
        open(gateway.otherId)
        assertFalse(repository.state.value.pending)
        assertTrue(repository.state.value.rows.isEmpty())
        assertEquals("", repository.state.value.draft)
        assertFalse(repository.state.value.selected!!.members.any { it.userId == gateway.peer })
        compose.onNodeWithText(first).assertDoesNotExist()
        compose.onNodeWithText(uncertain).assertDoesNotExist()
        assertEquals(persisted, runBlocking { store.read(pendingKey) })
        backToInbox()

        // Reconstruct the repository with the same cells; no fixture seed restores pending state.
        compose.runOnIdle { repository = MessengerRepository(gateway.owner, gateway, store) }
        compose.waitUntil(15000) { repository.state.value.ready && repository.state.value.selected == null }
        val beforeRestoreReads = gateway.historyReads(target)
        open(target)
        compose.waitUntil(10000) { repository.state.value.pending && repository.state.value.rows.map { it.text } == listOf(first, uncertain) }
        assertTrue(gateway.historyReads(target) > beforeRestoreReads)
        assertEquals(persisted, runBlocking { store.read(pendingKey) })
        compose.onNodeWithTag("messenger-draft").assertIsNotEnabled().assertTextContains(uncertain)
        compose.onNodeWithTag("messenger-recover-pending").assertDoesNotExist()
        capture("restored-pending")
        clickDescription("Повторить")
        compose.waitUntil(10000) { !repository.state.value.pending && repository.state.value.rows.map { it.text } == listOf(first, uncertain) && gateway.messageCalls().size == 3 }
        val sent = gateway.messageCalls()
        assertEquals(sent[1], sent[2]) // Same method, recipient path, message UUID and text.
        assertNotEquals(JSONObject(sent[0].body!!).getString("id"), JSONObject(sent[1].body!!).getString("id"))
        assertTrue(sent.all { it.path == "/shared/messenger/conversations/$target/messages" })
        assertEquals(listOf(first, uncertain), gateway.texts(target))
        assertTrue(gateway.texts(gateway.otherId).isEmpty())
        assertNull(runBlocking { store.read(pendingKey) })
        val clearedDraft = runBlocking { store.read("messenger/draft/$target") }
        assertEquals("", clearedDraft?.let { JSONObject(it).getString("text") } ?: "")
        assertEquals("", repository.state.value.draft)

        backToInbox()
        val beforeReopenReads = gateway.historyReads(target)
        open(target)
        compose.waitUntil(10000) { repository.state.value.rows.map { it.text } == listOf(first, uncertain) }
        assertTrue(gateway.historyReads(target) > beforeReopenReads)
        compose.onNodeWithText(first).assertExists()
        compose.onNodeWithText(uncertain).assertExists()
        assertFalse(repository.state.value.pending)
        assertEquals(3, gateway.messageCalls().size)
        assertTrue(gateway.forbiddenRoutes().isEmpty())
        capture("reopened-history")
    }
}
