package ru.genesis.calendar.auth

import android.content.Context
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import ru.genesis.calendar.GenesisApplication
import java.util.UUID

class ProjectAccessStorageTest {
    @Test fun activeAndCopiedAccessDraftsBelongToTheirSpaceDuringMigration() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        assumeTrue("Separate 3.3.6 QA installation required", context.packageName == "ru.genesis.calendar.qa1103.debug")
        val app = context.applicationContext as GenesisApplication
        val owner = "access-migration-${UUID.randomUUID()}"
        val space = UUID.randomUUID().toString()
        val otherSpace = UUID.randomUUID().toString()
        val project = UUID.randomUUID().toString()
        val member = "qa-member-${UUID.randomUUID()}"
        val scope = ProjectAccessProtocol.scope(space, member)
        val otherScope = ProjectAccessProtocol.scope(otherSpace, member)
        val copyId = UUID.randomUUID().toString()
        val store = PlanningDraftStore(context, "project-access")
        val journal = PlanningJournal(store, contract = ProjectAccessJournalContract)
        fun key(slot: String) = "project-access-v1:${owner.length}:$owner:${slot.length}:$slot"
        fun edit(spaceId: String, role: String) = JSONObject()
            .put("kind", "project-access").put("spaceId", spaceId).put("userId", member)
            .put("expectedRevision", 1).put("fingerprint", "a".repeat(64)).put("review", JSONObject.NULL)
            .put("draft", JSONObject().put("allProjects", false).put("grants", JSONArray().put(
                JSONObject().put("projectId", project).put("role", role).put("includeDescendants", false))))
        suspend fun entries(kind: String, resource: String): List<JSONObject> {
            val inventory = NativeLocalWorkInventory.capture(context, app.database, owner, kind, resource, JSONObject()) {}
            val rows = inventory.getJSONArray("entries")
            return (0 until rows.length()).map(rows::getJSONObject)
        }
        try {
            val active = journal.save(owner, scope, null, edit(space, "viewer"))
            val copy = journal.saveCopy(owner, scope, copyId, null, edit(space, "member"))
            journal.save(owner, otherScope, null, edit(otherSpace, "viewer"))

            val retained = entries("space", space).associateBy { it.getString("key") }
            assertEquals(setOf(key(scope), "copies:${key(scope)}"), retained.keys)
            for (row in retained.values) {
                assertEquals(space, row.getString("spaceId"))
                assertTrue(row.isNull("projectId"))
                assertEquals("history-only", row.getJSONObject("content").getString("execution"))
            }
            val retainedActive = JSONObject(retained.getValue(key(scope)).getJSONObject("content").getString("rawDocument"))
            val retainedCopies = JSONObject(retained.getValue("copies:${key(scope)}").getJSONObject("content").getString("rawDocument"))
            assertEquals(active.toString(), retainedActive.toString())
            assertEquals(copy.toString(), retainedCopies.getJSONArray("copies").getJSONObject(0).toString())
            assertEquals(setOf(key(otherScope)), entries("space", otherSpace).map { it.getString("key") }.toSet())
            assertTrue(entries("project", project).isEmpty())
            assertEquals(active.toString(), journal.load(owner, scope).toString())
        } finally {
            store.locked {
                for (slot in listOf(scope, otherScope)) {
                    store.remove(key(slot))
                    store.remove("copies:${key(slot)}")
                }
            }
        }
    }

    @Test fun coldJournalRestoresRulesAndKeystoreRejectsAnotherAccountOrMemberAad() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        assumeTrue("Separate QA installation required", context.packageName.endsWith(".c5qa.debug"))
        val state = JSONObject(InstrumentationRegistry.getInstrumentation().context.assets.open("project-access/state.json").bufferedReader().use { it.readText() })
        val account = "access-storage-${UUID.randomUUID()}"; val space = state.getString("spaceId"); val member = state.getString("userId")
        val scope = ProjectAccessProtocol.scope(space, member)
        val preferences = context.getSharedPreferences("genesis.shared.project-access.v1", Context.MODE_PRIVATE)
        val key = "project-access-v1:${account.length}:$account:${scope.length}:$scope"
        val other = ProjectAccessProtocol.scope(space, "other-member")
        val otherKey = "project-access-v1:${account.length}:$account:${other.length}:$other"
        fun journal() = PlanningJournal(PlanningDraftStore(context, "project-access"), contract = ProjectAccessJournalContract)
        try {
            val edit = ProjectAccessProtocol.newEdit(state)
            val record = journal().save(account, scope, null, edit)
            val encrypted = requireNotNull(preferences.getString(key, null))
            assertFalse(encrypted.contains(member)); assertFalse(encrypted.contains("allProjects")); assertFalse(encrypted.contains("grants"))
            assertEquals(record.toString(), journal().load(account, scope)!!.toString())
            assertNull(journal().load("another-account", scope)); assertNull(journal().load(account, other))
            preferences.edit().putString(otherKey, encrypted).commit()
            assertTrue(runCatching { journal().load(account, other) }.isFailure)
            assertEquals(encrypted, preferences.getString(otherKey, null)); assertEquals(record.toString(), journal().load(account, scope)!!.toString())
        } finally { preferences.edit().remove(key).remove(otherKey).commit() }
    }
}
