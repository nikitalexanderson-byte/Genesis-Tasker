package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

internal const val bulkOperationFixture = "10000000-0000-4000-8000-000000000001"
internal fun bulkSelectionFixture() = JSONObject().put("mode", "page").put("items", JSONArray().put(JSONObject().put("id", "task").put("projectId", "project").put("revision", 1)))
internal fun bulkActionFixture() = JSONObject().put("kind", "priority").put("priority", 0)
internal fun bulkEditFixture() = JSONObject().put("projectId", "project").put("selection", bulkSelectionFixture()).put("action", bulkActionFixture())
internal fun bulkScopeFixture() = JSONObject().put("total", 1).put("hasMore", false).put("nextCursor", JSONObject.NULL).put("projects", JSONArray().put(
    JSONObject().put("id", "project").put("spaceId", "space").put("title", "Private project title").put("taskCount", 1).put("statuses", JSONArray())))
internal fun bulkReportFixture() = JSONObject().put("id", bulkOperationFixture).put("state", "preview").put("mode", "page")
    .put("action", bulkActionFixture()).put("expiresAt", "2026-10-20T12:10:00Z").put("errorCode", JSONObject.NULL).put("retryAt", JSONObject.NULL)
    .put("actionInfo", JSONObject().put("unavailable", false)).put("counts", JSONObject().put("selected", 1).put("affected", 1)
        .put("pending", 1).put("succeeded", 0).put("skipped", 0).put("failed", 0).put("cancelled", 0))
    .put("items", JSONArray().put(JSONObject().put("cursor", 1).put("selected", true).put("state", "pending").put("code", JSONObject.NULL)
        .put("id", "task").put("projectId", "project").put("projectTitle", "Private project title").put("title", "Private task title").put("available", true)))
    .put("hasMore", false).put("nextCursor", JSONObject.NULL)

class SharedBulkProtocolTest {
    @Test fun allEightActionsKeepZeroNullAndSignedShiftAsTypedValues() {
        val actions = listOf(bulkActionFixture(), JSONObject().put("kind", "assignee").put("assigneeId", JSONObject.NULL),
            JSONObject().put("kind", "status").put("statusIds", JSONObject().put("project", "done")),
            JSONObject().put("kind", "due").put("mode", "shift").put("days", -36600),
            JSONObject().put("kind", "labels").put("mode", "remove").put("labelIds", JSONArray().put("b").put("a")),
            JSONObject().put("kind", "move").put("projectId", "other").put("statusId", "open"),
            JSONObject().put("kind", "archive"), JSONObject().put("kind", "trash").put("retentionDays", 2))
        assertEquals(SharedBulkProtocol.kinds.toSet(), actions.map { SharedBulkProtocol.action(it).getString("kind") }.toSet())
        assertEquals(0, SharedBulkProtocol.action(actions[0]).getInt("priority")); assertTrue(SharedBulkProtocol.action(actions[1]).isNull("assigneeId"))
        assertEquals(-36600, SharedBulkProtocol.action(actions[3]).getInt("days")); assertEquals("a", SharedBulkProtocol.action(actions[4]).getJSONArray("labelIds").getString(0))
        assertEquals("2028-02-29", SharedBulkProtocol.action(JSONObject().put("kind", "due").put("mode", "set").put("date", "2028-02-29")).getString("date"))
    }
    @Test fun malformedActionNeverCoercesStringsBooleansOrUnknownFields() {
        val bad = listOf(JSONObject().put("kind", "priority").put("priority", "0"), JSONObject().put("kind", "priority").put("priority", false),
            JSONObject().put("kind", "priority").put("priority", 4), JSONObject().put("kind", "due").put("mode", "shift").put("days", 0),
            JSONObject().put("kind", "due").put("mode", "shift").put("days", 36601), JSONObject().put("kind", "due").put("mode", "set").put("date", "2026-02-29"),
            JSONObject().put("kind", "assignee"), JSONObject().put("kind", "labels").put("mode", "add").put("labelIds", JSONArray()),
            JSONObject().put("kind", "archive").put("sourceTaskId", "task"))
        bad.forEach { assertThrows(Exception::class.java) { SharedBulkProtocol.action(it) } }
    }
    @Test fun explicitSelectionRejectsDuplicateMissingOrZeroRevisionsAndWrongProject() {
        for (revision in listOf<Any>(0, "1", 1.1, false)) {
            val raw = bulkSelectionFixture(); raw.getJSONArray("items").getJSONObject(0).put("revision", revision)
            assertThrows(Exception::class.java) { SharedBulkProtocol.selection(raw) }
        }
        val duplicate = bulkSelectionFixture(); duplicate.getJSONArray("items").put(duplicate.getJSONArray("items").getJSONObject(0))
        assertThrows(Exception::class.java) { SharedBulkProtocol.selection(duplicate) }
        assertThrows(Exception::class.java) { SharedBulkProtocol.edit(bulkEditFixture().put("projectId", "other")) }
        assertThrows(Exception::class.java) { SharedBulkProtocol.selection(JSONObject().put("mode", "page").put("items", JSONArray())) }
    }
    @Test fun allResultsPreserveTheEntireFrozenFilterSortAndVersionWithoutTaskPages() {
        val filter = JSONObject().put("projectIds", JSONArray().put("project")).put("q", "literal user text").put("priority", JSONArray().put(0))
            .put("customFields", JSONArray().put(JSONObject().put("fieldId", "field").put("operator", "eq").put("value", false)))
        val source = JSONObject().put("mode", "all").put("filter", filter).put("sort", "custom:field:desc").put("queryVersion", "a".repeat(64))
        val selected = SharedBulkProtocol.selection(source); assertEquals(source.toString(), selected.toString())
        source.getJSONObject("filter").put("q", "changed"); assertEquals("literal user text", selected.getJSONObject("filter").getString("q"))
        assertThrows(Exception::class.java) { SharedBulkProtocol.selection(JSONObject(selected.toString()).put("queryVersion", "")) }
    }
    @Test fun reportReadsRedactionAsReplacementAndRejectsPartlyRedactedTitles() {
        val previous = SharedBulkProtocol.report(bulkReportFixture()); assertTrue(previous.toString().contains("Private task title"))
        val revoked = bulkReportFixture(); revoked.put("items", JSONArray().put(JSONObject().put("cursor", 1).put("selected", true).put("state", "pending").put("code", JSONObject.NULL)))
        val fresh = SharedBulkProtocol.report(revoked); assertFalse(fresh.toString().contains("Private")); assertFalse(fresh.getJSONArray("items").getJSONObject(0).has("id"))
        revoked.getJSONArray("items").getJSONObject(0).put("title", "Private task title")
        assertThrows(Exception::class.java) { SharedBulkProtocol.report(revoked) }
    }
    @Test fun reportPaginationChecksOrderCountsCursorIdentityAndTypedBooleans() {
        val source = bulkReportFixture()
        for (alter in listOf<(JSONObject) -> Unit>({ it.put("id", "not-operation") }, { it.put("hasMore", true) },
            { it.put("hasMore", "false") }, { it.getJSONObject("counts").put("pending", 0) },
            { it.getJSONArray("items").getJSONObject(0).put("selected", 1) })) {
            val bad = JSONObject(source.toString()); alter(bad); assertThrows(Exception::class.java) { SharedBulkProtocol.report(bad) }
        }
        assertThrows(Exception::class.java) { SharedBulkProtocol.report(source, "10000000-0000-4000-8000-000000000002") }
        assertThrows(Exception::class.java) { SharedBulkProtocol.report(source, after = 1) }
        source.put("hasMore", true).put("nextCursor", 1); assertEquals(1L, SharedBulkProtocol.report(source).getLong("nextCursor"))
    }
    @Test fun receiptContainsOnlyOperationIdentityAndRejectsWrongActionOrSelection() {
        val command = SharedBulkJournalContract.command(bulkEditFixture(), bulkOperationFixture)
        val receipt = SharedBulkJournalContract.receipt(command, bulkReportFixture()); assertEquals(setOf("operationId"), receipt.keys().asSequence().toSet())
        assertEquals(receipt.toString(), SharedBulkJournalContract.receipt(command, receipt).toString())
        val wrong = bulkReportFixture(); wrong.getJSONObject("action").put("priority", 3)
        assertThrows(Exception::class.java) { SharedBulkJournalContract.receipt(command, wrong) }
        assertThrows(Exception::class.java) { SharedBulkJournalContract.receipt(command, bulkReportFixture().put("mode", "all")) }
    }
    @Test fun availableMoveRequiresHumanReadableDestinationAndStatusInTheLivePreview() {
        val report = bulkReportFixture().put("action", JSONObject().put("kind", "move").put("projectId", "destination").put("statusId", "open"))
        assertThrows(Exception::class.java) { SharedBulkProtocol.report(report) }
        report.getJSONObject("actionInfo").put("projectTitle", "Destination").put("statusTitle", "Open")
        assertEquals("Destination", SharedBulkProtocol.report(report).getJSONObject("actionInfo").getString("projectTitle"))
        report.put("actionInfo", JSONObject().put("unavailable", true)); assertTrue(SharedBulkProtocol.report(report).getJSONObject("actionInfo").getBoolean("unavailable"))
    }
}
