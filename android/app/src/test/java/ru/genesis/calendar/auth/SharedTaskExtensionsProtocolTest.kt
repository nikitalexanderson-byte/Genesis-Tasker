package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.domain.CalendarContext
import ru.genesis.calendar.domain.RecurrenceConfig

class SharedTaskExtensionsProtocolTest {
    private val project = "10000000-0000-4000-8000-000000000001"
    private val taskId = "10000000-0000-4000-8000-000000000002"
    private val fileId = "10000000-0000-4000-8000-000000000003"
    private val request = "10000000-0000-4000-8000-000000000004"
    private fun task() = JSONObject().put("id", taskId).put("projectId", project).put("revision", 7)
        .put("completedAt", JSONObject.NULL).put("archivedAt", JSONObject.NULL).put("attachments", JSONArray())
    private fun trash(kind: String = "task") = JSONObject().put("id", taskId).put("kind", kind).put("title", "Deleted task")
        .put("retentionDays", 30).put("expiresAt", "2026-11-25T10:00:00Z").put("canRestore", true).put("canPurge", true)
    private fun fails(block: () -> Unit) { assertTrue("Unsafe command must fail closed", runCatching(block).isFailure) }

    @Test fun lifecycleUsesObservedRevisionExpiryAndSeparateRetentionCommands() {
        val archive = SharedTaskLifecycleProtocol.archive(task(), true, request)
        assertEquals(7, archive.getInt("expectedRevision")); assertTrue(archive.getBoolean("archived"))
        val entry = trash()
        val restore = SharedTaskLifecycleProtocol.restore(entry, request)
        assertEquals(entry.getString("expiresAt"), restore.getString("expectedExpiresAt"))
        assertFalse(restore.has("retentionDays"))
        assertEquals(12, SharedTaskLifecycleProtocol.restore(entry, request, 12).getInt("retentionDays"))
        fails { SharedTaskLifecycleProtocol.restore(entry, request, 31) }
        fails { SharedTaskLifecycleProtocol.archive(task().put("pending", true), true, request) }
        fails { SharedTaskLifecycleProtocol.restore(entry.put("canRestore", false), request) }
    }
    @Test fun permanentDeleteRequiresServerPermissionCurrentExpiryAndExplicitDecision() {
        assertTrue(SharedTaskLifecycleProtocol.purge(trash(), request, true).getBoolean("confirmPermanent"))
        fails { SharedTaskLifecycleProtocol.purge(trash(), request, false) }
        fails { SharedTaskLifecycleProtocol.purge(trash("project"), request, true) }
        fails { SharedTaskLifecycleProtocol.purge(trash().put("canPurge", false), request, true) }
        fails { SharedTaskLifecycleProtocol.purge(trash().put("expiresAt", "invalid"), request, true) }
    }
    @Test fun retryIdentitySurvivesObjectKeyOrderingButChangesWithPayload() {
        val identity = SharedTaskCommandIdentity()
        val first = identity.forBody(JSONObject().put("revision", 7).put("archived", true))
        assertEquals(first, identity.forBody(JSONObject().put("archived", true).put("revision", 7)))
        assertNotEquals(first, identity.forBody(JSONObject().put("archived", true).put("revision", 8)))
    }
    @Test fun extensionsAllowOnlyExactMethodsAndScopedPaths() {
        val base = "/shared/projects/$project/tasks/$taskId"
        assertTrue(allowedSharedTaskExtensionRoute("POST", "$base/series"))
        assertTrue(allowedSharedTaskExtensionRoute("PATCH", "$base/reviews"))
        assertFalse(allowedSharedTaskExtensionRoute("GET", "$base/approve"))
        assertFalse(allowedSharedTaskExtensionRoute("DELETE", "$base/series"))
        assertFalse(allowedSharedTaskExtensionRoute("POST", "$base/series?override=true"))
        assertFalse(allowedSharedTaskExtensionRoute("GET", "/shared/tasks/../attachments/$fileId"))
    }
    @Test fun fileSelectionIsBoundedAndRejectsUnsafeNamesAndEmptyContent() {
        fails { SharedTaskFilesProtocol.read("report.txt", byteArrayOf().inputStream(), 1024) }
        fails { SharedTaskFilesProtocol.read("report.txt", ByteArray(1025).inputStream(), 1024) }
        fails { SharedTaskFilesProtocol.filename("../report.txt") }
        fails { SharedTaskFilesProtocol.filename("report\n.txt") }
        fails { SharedTaskFilesProtocol.filename("run.exe") }
        assertEquals("План.txt", SharedTaskFilesProtocol.read("План.txt", "План".toByteArray().inputStream(), 20).name)
    }
    @Test fun filesUseVerifiedTaskScopedMetadataAndVersionedAtomicRemoval() {
        val value = task().put("attachments", JSONArray().put(JSONObject().put("id", fileId).put("name", "plan.txt")
            .put("size", 10).put("url", "/api/shared/tasks/$taskId/attachments/$fileId")))
        val command = SharedTaskFilesProtocol.command(value, listOf(SharedTaskFileDraft("new.txt", "new".toByteArray())), setOf(fileId))
        assertEquals(7, command.getInt("expectedRevision")); assertEquals(fileId, command.getJSONArray("removeAttachmentIds").getString(0))
        assertTrue(command.getJSONArray("attachments").getJSONObject(0).getString("data").startsWith("data:application/octet-stream;base64,"))
        fails { SharedTaskFilesProtocol.command(value, emptyList(), setOf(request)) }
        value.getJSONArray("attachments").getJSONObject(0).put("url", "https://other.example/file")
        fails { SharedTaskFilesProtocol.attachments(value) }
    }
    @Test fun reviewPermissionComesFromServerAllowedKindsAndCompletionState() {
        val value = task().put("completedAt", "2026-10-26T10:00:00Z").put("review", JSONObject().put("enabled", true)
            .put("allowed", JSONObject().put("checked", true).put("confirmed", false).put("deletable", false)))
        assertEquals(7, SharedTaskReviewProtocol.review(value, "checked", true).getInt("expectedRevision"))
        fails { SharedTaskReviewProtocol.review(value, "deletable", true) }
        fails { SharedTaskReviewProtocol.review(value.put("completedAt", JSONObject.NULL), "checked", true) }
    }
    @Test fun approvalChangesCannotBypassAuthorManagerMembershipOrCompletedGates() {
        val members = listOf(JSONObject().put("userId", "member"))
        assertTrue(SharedTaskReviewProtocol.approvers(task(), true, setOf("member"), members, true).getBoolean("approvalRequired"))
        fails { SharedTaskReviewProtocol.approvers(task(), true, setOf("member"), members, false) }
        fails { SharedTaskReviewProtocol.approvers(task(), true, setOf("stranger"), members, true) }
        fails { SharedTaskReviewProtocol.approvers(task(), true, emptySet(), members, true) }
        fails { SharedTaskReviewProtocol.approvers(task().put("completedAt", "2026-10-26T10:00:00Z"), false, emptySet(), members, true) }
        val value = task().put("approvals", JSONArray().put(JSONObject().put("userId", "member").put("approvedAt", JSONObject.NULL)))
        assertTrue(SharedTaskReviewProtocol.canApprove(value, "member")); assertFalse(SharedTaskReviewProtocol.canApprove(value, "stranger"))
        assertFalse(SharedTaskReviewProtocol.canApprove(value.put("archivedAt", "2026-10-26T10:00:00Z"), "member"))
    }
    private fun settings(mode: String = "classic", pattern: String = "daily") = JSONObject().put("timing", "schedule").put("delayDays", 1)
        .put("limit", 30).put("cloneChildren", false).put("excludedDates", JSONArray()).put("recurrence", SharedTaskSeriesProtocol.recurrence(
            RecurrenceConfig(true, mode, pattern, listOf(1), 1, "2026-10-26", "2027-10-25", calendarContext = CalendarContext(2, "Europe/Moscow", "march"))))
    @Test fun seriesKeepsAllCalendarContextsAndRejectsInvalidRulesWithoutFallback() {
        listOf("classic" to "daily", "genesis" to "pyata-days", "lunar" to "lunar-days").forEach { (mode, pattern) ->
            val result = SharedTaskSeriesProtocol.settings(settings(mode, pattern))
            assertEquals("march", result.getJSONObject("recurrence").getJSONObject("calendarContext").getString("gregorianYearStart"))
            assertEquals(mode, SharedTaskSeriesProtocol.recurrence(result.getJSONObject("recurrence")).mode)
        }
        fails { SharedTaskSeriesProtocol.settings(settings().put("limit", 1001)) }
        val invalid = settings(); invalid.getJSONObject("recurrence").put("pattern", "unrestricted")
        fails { SharedTaskSeriesProtocol.settings(invalid) }
        val badZone = settings(); badZone.getJSONObject("recurrence").getJSONObject("calendarContext").put("timeZone", "unknown/zone")
        fails { SharedTaskSeriesProtocol.settings(badZone) }
    }
    @Test fun seriesSaveAndSkipCarryBothRevisionGatesAndRejectMovedOrCompletedInstances() {
        val series = JSONObject().put("id", fileId).put("projectId", project).put("revision", 4)
        val command = SharedTaskSeriesProtocol.save(task(), settings(), true, false, series, request)
        assertEquals(7, command.getInt("taskRevision")); assertEquals(4, command.getInt("expectedRevision")); assertEquals(request, command.getString("requestId"))
        assertTrue(SharedTaskSeriesProtocol.skip(task(), series, request).getBoolean("skipInstance"))
        fails { SharedTaskSeriesProtocol.skip(task().put("completedAt", "2026-10-26T10:00:00Z"), series, request) }
        fails { SharedTaskSeriesProtocol.save(task(), settings(), false, false, series.put("projectId", request), request) }
    }
}
