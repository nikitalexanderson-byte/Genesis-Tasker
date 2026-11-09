package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

internal fun accessFixture(name: String) = JSONObject(requireNotNull(ProjectAccessProtocolTest::class.java.getResourceAsStream("/project-access/$name.json")).bufferedReader().use { it.readText() })
internal fun accessEdit() = ProjectAccessProtocol.newEdit(accessFixture("state")).put("draft", accessFixture("preview").getJSONObject("desired"))

class ProjectAccessProtocolTest {
    @Test fun realPhpContractPreservesExplicitExclusionInheritanceAndAssignmentConsequences() {
        val raw = accessFixture("state"); val state = ProjectAccessProtocol.snapshot(raw.getString("spaceId"), raw.getString("userId"), raw)
        assertEquals(8, state.getJSONArray("projects").length()); assertTrue(state.getBoolean("allProjects"))
        val edit = accessEdit(); val preview = ProjectAccessProtocol.preview(edit, accessFixture("preview"))
        val grants = ProjectAccessProtocol.rows(preview.getJSONObject("desired").getJSONArray("grants"))
        assertTrue(grants.any { it.getString("role") == "none" }); assertTrue(grants.any { it.getBoolean("includeDescendants") })
        assertEquals(1, ProjectAccessProtocol.rows(preview.getJSONArray("changes")).sumOf { it.getInt("clearedAssignments") })
        val reviewed = ProjectAccessProtocol.reviewed(edit, preview)
        ProjectAccessProtocol.verify(reviewed, preview, ProjectAccessProtocol.scope(raw.getString("spaceId"), raw.getString("userId")), false)
        assertFalse(reviewed.toString().contains("title")); assertFalse(reviewed.toString().contains("displayName"))
    }
    @Test fun ownerDirectoryNeverRetainsEmailsInvitationsOrOtherSettingsAndRejectsAnAdmin() {
        val raw = accessFixture("members").put("invitations", JSONArray().put(JSONObject().put("email", "private@example.invalid")))
        raw.getJSONArray("members").getJSONObject(0).put("email", "member@example.invalid")
        val projected = ProjectAccessProtocol.members(raw.getJSONObject("space").getString("id"), raw)
        assertFalse(projected.toString().contains("email")); assertFalse(projected.toString().contains("invitations"))
        raw.getJSONObject("space").put("role", "admin")
        assertEquals("PROJECT_ACCESS_PERMISSION_CHANGED", assertThrows(IllegalArgumentException::class.java) { ProjectAccessProtocol.members(raw.getJSONObject("space").getString("id"), raw) }.message)
    }
    @Test fun aChangedAssignmentPreviewCannotReuseEarlierHumanConfirmation() {
        val edit = ProjectAccessProtocol.reviewed(accessEdit(), accessFixture("preview")); val changed = accessFixture("preview")
        changed.getJSONArray("changes").getJSONObject(0).put("clearedAssignments", 2)
        val project = changed.getJSONArray("changes").getJSONObject(0).getString("projectId")
        ProjectAccessProtocol.rows(changed.getJSONArray("projects")).first { it.getString("id") == project }.put("assignedTaskCount", 2)
        assertEquals("PROJECT_ACCESS_REVIEW_REQUIRED", assertThrows(IllegalArgumentException::class.java) {
            ProjectAccessProtocol.verify(edit, changed, ProjectAccessProtocol.scope(edit.getString("spaceId"), edit.getString("userId")), false)
        }.message)
        changed.put("fingerprint", "a".repeat(64))
        assertEquals("PROJECT_ACCESS_CONFLICT", assertThrows(IllegalArgumentException::class.java) {
            ProjectAccessProtocol.verify(edit, changed, ProjectAccessProtocol.scope(edit.getString("spaceId"), edit.getString("userId")), false)
        }.message)
    }
    @Test fun lastOwnerAndUnreviewedInputAreBlockedAndPendingBodyContainsOnlyServerKeys() {
        val edit = accessEdit(); val preview = accessFixture("preview")
        assertThrows(IllegalArgumentException::class.java) { ProjectAccessProtocol.command(edit, UUID.randomUUID().toString()) }
        preview.getJSONArray("blockers").put(JSONObject().put("projectId", preview.getJSONArray("projects").getJSONObject(0).getString("id")).put("code", "LAST_OWNER"))
        val reviewed = ProjectAccessProtocol.reviewed(edit, preview)
        assertEquals("LAST_OWNER", assertThrows(IllegalArgumentException::class.java) {
            ProjectAccessProtocol.verify(reviewed, preview, ProjectAccessProtocol.scope(edit.getString("spaceId"), edit.getString("userId")), false)
        }.message)
        val command = ProjectAccessProtocol.command(ProjectAccessProtocol.reviewed(edit, accessFixture("preview")), UUID.randomUUID().toString())
        val body = ProjectAccessProtocol.body(command)
        assertEquals(setOf("allProjects", "grants", "operationId", "expectedFingerprint"), body.keys().asSequence().toSet())
        val receipt = JSONObject().put("operationId", body.getString("operationId")).put("revision", edit.getLong("expectedRevision") + 1).put("changed", 3)
            .put("allProjects", body.getBoolean("allProjects")).put("grants", body.getJSONArray("grants"))
        ProjectAccessProtocol.receipt(command, receipt)
        receipt.put("revision", 5)
        assertThrows(IllegalArgumentException::class.java) { ProjectAccessProtocol.receipt(command, receipt) }
    }
    @Test fun togglingAllProjectsKeepsTheLocalRulesButSendsNoHiddenGrant() {
        val draft = accessEdit().getJSONObject("draft").put("allProjects", true)
        assertEquals(3, ProjectAccessProtocol.draft(draft).getJSONArray("grants").length())
        assertEquals(0, ProjectAccessProtocol.draft(draft, true).getJSONArray("grants").length())
        assertNotEquals(ProjectAccessProtocol.scope("ab", "c"), ProjectAccessProtocol.scope("a", "bc"))
        assertThrows(IllegalArgumentException::class.java) { ProjectAccessProtocol.scope("space/other", "user") }
    }
    @Test fun malformedPermissionsDuplicateGrantsWrongScopeAndNonIntegralCountsReject() {
        val state = accessFixture("state"); val space = state.getString("spaceId"); val user = state.getString("userId")
        assertThrows(IllegalArgumentException::class.java) { ProjectAccessProtocol.snapshot(space, "other", state) }
        state.getJSONArray("projects").getJSONObject(0).put("assignedTaskCount", 1.5)
        assertThrows(IllegalArgumentException::class.java) { ProjectAccessProtocol.snapshot(space, user, state) }
        val edit = accessEdit(); edit.getJSONObject("draft").getJSONArray("grants").put(edit.getJSONObject("draft").getJSONArray("grants").getJSONObject(0))
        assertThrows(IllegalArgumentException::class.java) { ProjectAccessProtocol.edit(edit) }
        val preview = accessFixture("preview"); preview.getJSONArray("changes").getJSONObject(0).getJSONObject("afterPermissions").put("editTasks", "false")
        assertThrows(IllegalArgumentException::class.java) { ProjectAccessProtocol.preview(accessEdit(), preview) }
    }
}
