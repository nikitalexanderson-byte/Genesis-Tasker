package ru.genesis.calendar.auth

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class AuthProtocolTest {
    @org.junit.Test fun olderCommentsAllowOnlyAnExactReadCursor() {
        val id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        val base = "/shared/projects/$id/tasks/$id/comments"
        org.junit.Assert.assertTrue(allowedSharedRoute("GET", "$base?before=$id"))
        org.junit.Assert.assertFalse(allowedSharedRoute("POST", "$base?before=$id"))
        org.junit.Assert.assertFalse(allowedSharedRoute("GET", "$base?before=$id&projectId=$id"))
        org.junit.Assert.assertFalse(allowedSharedRoute("GET", "$base?before=../../private"))
    }
    private val sessionId = "abcdefghijklmnopqrstuvwx12"
    private val now = 1_800_000_000_000L
    private fun header(extra: String = "") = "$SESSION_COOKIE=$sessionId; Path=/; Secure; HttpOnly$extra"

    @Test fun fieldDefinitionsOnlyAllowTheirExactMethodsIdsAndQueries() {
        val id = "01234567-89ab-cdef-0123-456789abcdef"
        for (path in listOf("/shared/spaces/$id/custom-fields?projectId=$id&archived=true", "/shared/spaces/$id/custom-fields?projectId=$id&archived=false",
            "/shared/custom-fields/$id/history", "/shared/custom-fields/legacy_field/history")) {
            assertTrue(path, allowedSharedRoute("GET", path)); assertFalse(allowedSharedRoute("POST", path)); assertFalse(allowedSharedRoute("PUT", path))
        }
        assertTrue(allowedSharedRoute("POST", "/shared/spaces/$id/custom-fields/preview"))
        assertFalse(allowedSharedRoute("GET", "/shared/spaces/$id/custom-fields/preview"))
        assertTrue(allowedSharedRoute("PUT", "/shared/spaces/$id/custom-fields"))
        for (method in listOf("GET", "POST", "PATCH", "DELETE")) assertFalse(allowedSharedRoute(method, "/shared/spaces/$id/custom-fields"))
        for (path in listOf("/shared/spaces/$id/custom-fields?other=1", "/shared/spaces/$id/custom-fields?projectId=$id&archived=1",
            "/shared/spaces/$id/custom-fields?projectId=$id&archived=true&other=1", "/shared/spaces/$id/custom-fields/preview?other=1",
            "/shared/custom-fields/../../other/history", "/shared/custom-fields/$id/history?other=1")) {
            for (method in listOf("GET", "POST", "PUT", "PATCH", "DELETE")) assertFalse("$method $path", allowedSharedRoute(method, path))
        }
    }

    @Test fun nativeBulkTransportAllowsItsExactRoutesAndRejectsOtherMethodsAndQueries() {
        val id = "01234567-89ab-cdef-0123-456789abcdef"
        for (path in listOf("/shared/bulk/scope", "/shared/bulk/preview") +
            listOf("confirm", "cancel", "advance", "resume").map { "/shared/bulk/$id/$it" }) {
            assertTrue(path, allowedSharedRoute("POST", path)); assertFalse(allowedSharedRoute("GET", path))
        }
        for (path in listOf("/shared/bulk", "/shared/bulk?cursor=opaque%2Fpage", "/shared/bulk/$id?after=0", "/shared/bulk/$id?after=100") +
            listOf("projects", "statuses", "assignees", "labels").map { "/shared/views/options?kind=$it&filter=%7B%7D&cursor=page-2" }) {
            assertTrue(path, allowedSharedRoute("GET", path)); assertFalse(allowedSharedRoute("POST", path))
        }
        for (path in listOf("/shared/bulk/$id/erase", "/shared/bulk/$id?after=-1", "/shared/bulk/$id?after=0&untrusted=1",
            "/shared/bulk?cursor=x&untrusted=1", "/shared/bulk/../../other?after=0",
            "/shared/views/options?kind=untrusted&filter=%7B%7D", "/shared/views/options?kind=projects&filter=%7B%7D&untrusted=1")) {
            assertFalse(path, allowedSharedRoute("GET", path)); assertFalse(path, allowedSharedRoute("POST", path))
        }
        assertTrue(allowedSharedRoute("GET", "/shared/projects/$id/tasks/$id?archived=true"))
        assertFalse(allowedSharedRoute("POST", "/shared/projects/$id/tasks/$id?archived=true"))
    }

    @Test fun sharedRoutesAllowInvitationsCalendarMovesAndGoogleSettings() {
        val id = "01234567-89ab-cdef-0123-456789abcdef"
        assertTrue(allowedSharedRoute("GET", "/shared/tasks?filter=%7B%7D"))
        for (sort in listOf("position", "createdAt", "createdAtAsc", "dueDate", "updatedAt", "title", "priority")) {
            assertTrue(allowedSharedRoute("GET", "/shared/tasks?filter=%7B%7D&cursor=opaque&sort=$sort"))
        }
        assertFalse(allowedSharedRoute("GET", "/shared/tasks?filter=%7B%7D&sort=untrusted"))
        assertTrue(allowedSharedRoute("GET", "/shared/notification-settings"))
        assertTrue(allowedSharedRoute("PUT", "/shared/notification-settings"))
        assertFalse(allowedSharedRoute("DELETE", "/shared/notification-settings"))
        assertTrue(allowedSharedRoute("POST", "/shared/projects/$id/tasks/$id/read"))
        assertFalse(allowedSharedRoute("GET", "/shared/projects/$id/tasks/$id/read"))
        assertTrue(allowedSharedRoute("GET", "/shared/projects/$id/tasks/$id"))
        assertTrue(allowedSharedRoute("GET", "/shared/projects/$id/planning"))
        assertTrue(allowedSharedRoute("PUT", "/shared/projects/$id/planning"))
        assertTrue(allowedSharedRoute("POST", "/shared/projects/$id/planning/sprints"))
        assertTrue(allowedSharedRoute("PATCH", "/shared/projects/$id/planning/sprints/$id"))
        assertTrue(allowedSharedRoute("POST", "/shared/projects/$id/planning/sprints/$id/transition"))
        assertFalse(allowedSharedRoute("POST", "/shared/projects/$id/planning"))
        assertFalse(allowedSharedRoute("GET", "/shared/projects/$id/planning/sprints"))
        assertFalse(allowedSharedRoute("DELETE", "/shared/projects/$id/planning/sprints/$id"))
        assertFalse(allowedSharedRoute("GET", "/shared/projects/$id/planning/sprints/$id/transition"))
        assertFalse(allowedSharedRoute("PATCH", "/shared/projects/$id/planning/sprints/../../other"))
        assertFalse(allowedSharedRoute("GET", "/shared/projects/../../other/planning"))
        assertFalse(allowedSharedRoute("POST", "/shared/tasks?filter=%7B%7D"))
        assertFalse(allowedSharedRoute("GET", "/shared/tasks?filter=%7B%7D&untrusted=1"))
        assertTrue(allowedSharedRoute("GET", "/shared/invitations"))
        assertTrue(allowedSharedRoute("POST", "/shared/invitations/$id"))
        assertTrue(allowedSharedRoute("GET", "/shared/calendar/tasks?from=2026-01-01&to=2026-12-31"))
        assertTrue(allowedSharedRoute("POST", "/shared/projects/$id/tasks/$id/move"))
        assertTrue(allowedSharedRoute("GET", "/shared/projects/$id/google"))
        assertTrue(allowedSharedRoute("POST", "/shared/projects/$id/google"))
        assertTrue(allowedSharedRoute("GET", "/shared/notifications"))
        assertTrue(allowedSharedRoute("POST", "/shared/notifications/read"))
        assertFalse(allowedSharedRoute("POST", "/shared/calendar/tasks?from=2026-01-01&to=2026-12-31"))
        assertFalse(allowedSharedRoute("GET", "/shared/projects/../../other"))
    }

    @Test fun nativeCookieAcceptsSecureSameOriginAndHonorsBoundedExpiry() {
        val cookie = AuthProtocol.cookie(listOf(header("; Max-Age=120")), now)
        assertTrue(cookie.present)
        assertEquals(sessionId, cookie.value)
        assertEquals(now + 120_000, cookie.expiresAt)
        assertEquals(now + 30L * 86400 * 1000, AuthProtocol.cookie(listOf(header("; Max-Age=99999999")), now).expiresAt)
    }

    @Test fun nativeCookieRejectsForeignInsecureAndAmbiguousCookies() {
        for (value in listOf(header("; Domain=attacker.example"),
            "$SESSION_COOKIE=$sessionId; Path=/; HttpOnly",
            "$SESSION_COOKIE=$sessionId; Path=/; Secure",
            "$SESSION_COOKIE=$sessionId; Path=/api; Secure; HttpOnly")) {
            assertThrows(IllegalArgumentException::class.java) { AuthProtocol.cookie(listOf(value), now) }
        }
        assertThrows(IllegalArgumentException::class.java) { AuthProtocol.cookie(listOf(header(), header()), now) }
        assertFalse(AuthProtocol.cookie(listOf("unrelated=123; Secure; HttpOnly; Path=/"), now).present)
    }

    @Test fun nativeCookieDeletionDoesNotRetainCredential() {
        val cookie = AuthProtocol.cookie(listOf(header("; Max-Age=0")), now)
        assertTrue(cookie.present)
        assertEquals("", cookie.value)
    }

    @Test fun nullableIdentityIsNotInventedFromGoogleCredentialOrEmail() {
        assertNull(AuthProtocol.identity(JSONObject("""{"user":null}""")))
        val identity = AuthProtocol.identity(JSONObject("""{"user":{"uid":"workspace-fixture","email":"fixture@example.invalid","displayName":"Fixture"}}"""))!!
        assertEquals("workspace-fixture", identity.uid)
        assertThrows(Exception::class.java) { AuthProtocol.identity(JSONObject("""{"email":"fixture@example.invalid"}""")) }
        assertFalse(identity.toString().contains("fixture@example.invalid"))
    }

    @Test fun challengeAndCsrfAreStrictlyValidated() {
        val input = JSONObject().put("nonce", "a".repeat(43)).put("serverClientId", "fixture.apps.googleusercontent.com").put("expiresIn", 300)
        assertEquals("fixture.apps.googleusercontent.com", AuthProtocol.challenge(input).serverClientId)
        input.put("serverClientId", "https://attacker.example")
        assertThrows(IllegalArgumentException::class.java) { AuthProtocol.challenge(input) }
        assertEquals("a".repeat(48), AuthProtocol.csrf("a".repeat(48)))
        assertThrows(IllegalArgumentException::class.java) { AuthProtocol.csrf("bad\r\nheader") }
    }

    @Test fun serviceConfigAndLinkActionAcceptOnlyExpectedValues() {
        val clientId = "fixture.apps.googleusercontent.com"
        assertEquals(clientId, AuthProtocol.serverClientId(JSONObject().put("serverClientId", clientId)))
        assertThrows(IllegalArgumentException::class.java) {
            AuthProtocol.serverClientId(JSONObject().put("serverClientId", "https://attacker.example"))
        }
        assertEquals("found", AuthProtocol.googleLinkAction(JSONObject().put("googleLinkAction", "found")))
        assertEquals("created", AuthProtocol.googleLinkAction(JSONObject().put("googleLinkAction", "created")))
        assertNull(AuthProtocol.googleLinkAction(JSONObject().put("googleLinkAction", "reassigned")))
    }
}
