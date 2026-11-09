package ru.genesis.calendar.auth

import android.content.Context
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.util.UUID

class ProjectAccessStorageTest {
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
