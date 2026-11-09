package ru.genesis.calendar.auth

import kotlinx.coroutines.CancellationException
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

private const val viewId = "7ec0510a-a07c-4072-8ca5-67e912ee1005"
private fun definition() = JSONObject().put("version", 1).put("title", "Моя подборка 🌿").put("filter", JSONObject())
    .put("sort", "position").put("relative", "this-month").put("calendarMode", "lunar")
    .put("calendarContext", JSONObject().put("version", 2).put("timeZone", "America/New_York").put("gregorianYearStart", "march"))
private fun source(revision: Int = 3, canEdit: Boolean = true) = JSONObject().put("id", viewId).put("spaceId", JSONObject.NULL)
    .put("visibility", "personal").put("revision", revision).put("canEdit", canEdit).put("updatedAt", "2026-10-21T10:00:00Z")
    .put("definition", definition()).put("invalid", false)
private class ViewStorage : PlanningJournalStorage {
    val rows = mutableMapOf<String, String>()
    var rejectWrites = false
    override fun <T> locked(block: () -> T) = synchronized(this, block)
    override fun read(key: String) = rows[key]
    override fun write(key: String, value: String) { if (rejectWrites) error("PLANNING_DRAFT_STORAGE"); rows[key] = value }
    override fun remove(key: String) { rows.remove(key) }
}
private class ViewAccess : SavedViewAccess {
    var current = source()
    var lost = false; var malformed = false; var cancelled = false; var unavailable = false
    val commands = mutableListOf<String>()
    private var saved: JSONObject? = null
    override fun check() { if (cancelled) throw CancellationException() }
    override fun view(id: String) = SavedViewProtocol.copy(current)
    override fun preview(definition: JSONObject) { if (unavailable) throw AuthApiError("VIEW_FILTER_UNAVAILABLE") }
    override fun send(command: JSONObject): JSONObject {
        commands += command.toString()
        if (saved == null) {
            if (command.getString("kind") == "view-delete") saved = JSONObject().put("ok", true)
            else {
                val body = command.getJSONObject("body")
                saved = JSONObject().put("view", source(if (command.isNull("sprintId")) 1 else body.getInt("expectedRevision") + 1)
                    .put("spaceId", body.get("spaceId")).put("visibility", body.get("visibility")).put("definition", body.getJSONObject("definition")))
            }
        }
        if (lost) { lost = false; error("NETWORK") }
        if (malformed) return SavedViewProtocol.copy(requireNotNull(saved)).apply { getJSONObject("view").put("revision", 97) }
        return SavedViewProtocol.copy(requireNotNull(saved))
    }
}
private fun service(store: ViewStorage, access: ViewAccess, account: String = "account") = SavedViewDraftService(
    PlanningJournal(store, contract = SavedViewJournalContract), account, access)

class SavedViewJournalTest {
    @Test fun scopedReceiptAcceptsOnlyTheServersDocumentedFilterBindingWithoutChangingFrozenBytes() {
        val edit = SavedViewProtocol.newEdit(definition()).put("spaceId", "space").put("visibility", "shared")
        val command = SavedViewProtocol.command(edit, UUID.randomUUID().toString()); val frozen = command.toString()
        val response = JSONObject().put("view", source(1).put("spaceId", "space").put("visibility", "shared")
            .put("definition", definition().apply { getJSONObject("filter").put("spaceId", "space") }))
        SavedViewJournalContract.receipt(command, response); assertEquals(frozen, command.toString())
        response.getJSONObject("view").getJSONObject("definition").getJSONObject("filter").put("q", "Unexpected condition")
        assertThrows(Exception::class.java) { SavedViewJournalContract.receipt(command, response) }
    }

    @Test fun lostCreateReplyReopensExactCommandAndCannotBeReplacedOrRebased() {
        val store = ViewStorage(); val access = ViewAccess(); var service = service(store, access)
        val local = service.save(null, SavedViewProtocol.newEdit(definition()))
        val pending = service.prepare(local.getString("stamp")); access.lost = true
        assertThrows(Exception::class.java) { service.send(pending.getString("stamp")) }
        service = service(store, access); val restored = service.load()!!
        assertEquals("pending", restored.getString("phase")); assertEquals(1, restored.getInt("attempts"))
        assertThrows(Exception::class.java) { service.save(restored.getString("stamp"), SavedViewProtocol.newEdit(definition().put("title", "replace"))) }
        assertThrows(Exception::class.java) { service.remove(restored.getString("stamp")) }
        val received = service.send(restored.getString("stamp"))
        assertEquals("received", received.getString("phase")); assertEquals(access.commands[0], access.commands[1])
        assertEquals(received.toString(), service.send(received.getString("stamp")).toString()); assertEquals(2, access.commands.size)
    }
    @Test fun malformedReceiptLeavesTheSamePendingIdentityForReplay() {
        val store = ViewStorage(); val access = ViewAccess(); val service = service(store, access)
        val local = service.save(null, SavedViewProtocol.newEdit(definition(), source()))
        val pending = service.prepare(local.getString("stamp")); access.malformed = true
        assertThrows(Exception::class.java) { service.send(pending.getString("stamp")) }
        val restored = service.load()!!; assertEquals("pending", restored.getString("phase"))
        access.malformed = false; val received = service.send(restored.getString("stamp"))
        assertEquals(4, received.getJSONObject("receipt").getJSONObject("view").getInt("revision"))
        assertEquals(access.commands.first(), access.commands.last())
    }
    @Test fun conflictAndRoleAreCheckedBeforeAttemptAndRebasePreservesOwnConditions() {
        val store = ViewStorage(); val access = ViewAccess(); val service = service(store, access)
        val local = service.save(null, SavedViewProtocol.newEdit(definition().put("title", "Свой ввод"), source()))
        access.current = source(4)
        assertThrows(Exception::class.java) { service.prepare(local.getString("stamp")) }; assertEquals(0, access.commands.size)
        val rebased = service.rebase(local.getString("stamp"))
        assertEquals("Свой ввод", rebased.getJSONObject("edit").getJSONObject("definition").getString("title"))
        access.current = source(4, false)
        assertThrows(Exception::class.java) { service.prepare(rebased.getString("stamp")) }; assertEquals(0, access.commands.size)
    }
    @Test fun failedDiskCommitCannotSendAnUnjournaledAttempt() {
        val store = ViewStorage(); val access = ViewAccess(); val service = service(store, access)
        val local = service.save(null, SavedViewProtocol.newEdit(definition())); val pending = service.prepare(local.getString("stamp"))
        store.rejectWrites = true
        assertThrows(Exception::class.java) { service.send(pending.getString("stamp")) }
        assertEquals(0, access.commands.size); store.rejectWrites = false; assertEquals(0, service.load()!!.getInt("attempts"))
    }
    @Test fun deleteReplaysAfterItsOriginalRevisionHasDisappeared() {
        val store = ViewStorage(); val access = ViewAccess(); val service = service(store, access)
        val local = service.save(null, SavedViewProtocol.newEdit(definition(), source()).put("kind", "view-delete"))
        val pending = service.prepare(local.getString("stamp")); access.lost = true
        assertThrows(Exception::class.java) { service.send(pending.getString("stamp")) }
        access.current = source(99, false)
        val received = service.send(service.load()!!.getString("stamp"))
        assertTrue(received.getJSONObject("receipt").getBoolean("ok")); assertEquals(access.commands.first(), access.commands.last())
    }
    @Test fun unavailableFieldDoesNotTurnIntoAnUnfilteredSelection() {
        val store = ViewStorage(); val access = ViewAccess(); val service = service(store, access)
        val custom = definition().apply { getJSONObject("filter").put("customFields", JSONArray().put(JSONObject().put("fieldId", "removed").put("op", "eq").put("value", false))) }
        val local = service.save(null, SavedViewProtocol.newEdit(custom)); access.unavailable = true
        assertThrows(Exception::class.java) { service.prepare(local.getString("stamp")) }
        assertEquals("editing", service.load()!!.getString("phase")); assertEquals(false, service.load()!!.getJSONObject("edit").getJSONObject("definition").getJSONObject("filter").getJSONArray("customFields").getJSONObject(0).getBoolean("value"))
        assertEquals(0, access.commands.size)
    }
    @Test fun calendarShapeDamageAndInvalidZoneRemainExplicitlyRepairable() {
        val invalid = definition().apply { getJSONObject("calendarContext").put("timeZone", "broken zone") }
        assertEquals("broken zone", SavedViewProtocol.definition(invalid).getJSONObject("calendarContext").getString("timeZone"))
        assertThrows(Exception::class.java) { SavedViewProtocol.ready(invalid) }
        val emptyPhpFilter = definition().put("filter", JSONArray())
        assertEquals(0, SavedViewProtocol.definition(emptyPhpFilter).getJSONObject("filter").length())
        val future = source().put("invalid", true).put("definition", JSONObject().put("version", 99))
        assertEquals(99, SavedViewProtocol.newEdit(future.getJSONObject("definition"), future).getJSONObject("definition").getInt("version"))
        assertThrows(Exception::class.java) { SavedViewProtocol.command(SavedViewProtocol.newEdit(future.getJSONObject("definition"), future), UUID.randomUUID().toString()) }
    }
    @Test fun draftsHaveAccountIsolationAndAnOldCasCannotOverwriteNewerInput() {
        val store = ViewStorage(); val access = ViewAccess(); val service = service(store, access)
        val local = service.save(null, SavedViewProtocol.newEdit(definition()))
        service.save(local.getString("stamp"), SavedViewProtocol.newEdit(definition().put("title", "newer")))
        assertThrows(Exception::class.java) { service.save(local.getString("stamp"), SavedViewProtocol.newEdit(definition().put("title", "stale"))) }
        assertNull(service(store, access, "other").load()); assertEquals("newer", service.load()!!.getJSONObject("edit").getJSONObject("definition").getString("title"))
        access.cancelled = true; assertThrows(CancellationException::class.java) { service.load() }
    }
    @Test fun routesAcceptOnlyExactViewMethodsAndRejectTraversalAndExtraParameters() {
        assertTrue(allowedSharedRoute("GET", "/shared/views")); assertTrue(allowedSharedRoute("POST", "/shared/views"))
        for (method in listOf("GET", "PATCH", "DELETE")) assertTrue(allowedSharedRoute(method, "/shared/views/$viewId"))
        assertTrue(allowedSharedRoute("GET", "/shared/views?cursor=abc%2Fdef"))
        for (path in listOf("/shared/views?cursor=x&admin=1", "/shared/views/../spaces", "/shared/views/$viewId?deleted=true", "/shared/views/options?kind=secret&filter=%7B%7D")) assertFalse(allowedSharedRoute("GET", path))
        assertFalse(allowedSharedRoute("PUT", "/shared/views/$viewId")); assertFalse(allowedSharedRoute("POST", "/shared/views?cursor=x"))
    }
    @Test fun planningAndSchedulingPredicatesArePreservedAndAnUnsupportedViewDoesNotBreakTheLibrary() {
        val raw = definition().put("filter", JSONObject().put("backlog", true).put("sprintId", JSONObject.NULL).put("parentTaskId", JSONObject.NULL).put("scheduled", "date"))
        assertEquals(PlanningLifecycle.canonical(raw), PlanningLifecycle.canonical(SavedViewProtocol.ready(raw)))
        val future = source().put("definition", definition().put("filter", JSONObject().put("futurePredicate", false)))
        val page = SavedViewProtocol.page(JSONObject().put("views", JSONArray().put(future).put(source().put("id", "second"))).put("total", 2).put("hasMore", false).put("nextCursor", JSONObject.NULL))
        assertTrue(page.getJSONArray("views").getJSONObject(0).getBoolean("invalid"))
        assertEquals(false, page.getJSONArray("views").getJSONObject(0).getJSONObject("definition").getJSONObject("filter").getBoolean("futurePredicate"))
        assertFalse(page.getJSONArray("views").getJSONObject(1).getBoolean("invalid"))
    }
    @Test fun fieldInputCalendarNeverChangesTheSavedRelativePeriodOrGoesIntoTheServerCommand() {
        val edit = SavedViewProtocol.newEdit(definition().put("calendarMode", "profane")).put("inputCalendar", JSONObject().put("mode", "sacred")
            .put("version", 2).put("timeZone", "Asia/Tokyo").put("gregorianYearStart", "january"))
        val restored = SavedViewProtocol.edit(edit)
        assertEquals("sacred", restored.getJSONObject("inputCalendar").getString("mode"))
        val command = SavedViewProtocol.command(restored, UUID.randomUUID().toString())
        assertEquals("profane", command.getJSONObject("body").getJSONObject("definition").getString("calendarMode"))
        assertFalse(command.getJSONObject("body").has("inputCalendar"))
        assertEquals("America/New_York", command.getJSONObject("body").getJSONObject("definition").getJSONObject("calendarContext").getString("timeZone"))
    }
}
