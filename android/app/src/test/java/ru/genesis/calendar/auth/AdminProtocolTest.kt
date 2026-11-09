package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.time.ZoneId
import java.util.Base64

class AdminProtocolTest {
    private val ad = "10000000-0000-4000-8000-000000000001"
    private val zone = ZoneId.of("Europe/Moscow")
    private fun form() = AdminProtocol.emptyForm().put("title", "Реклама").put("description", "Описание")
        .put("imageUrl", "https://example.test/picture.png").put("linkUrl", "https://example.test/destination")
    private fun fails(action: () -> Unit) { assertTrue(runCatching(action).isFailure) }
    @Test fun onlyExactAdminExtensionPathsAndMethodsAreAllowed() {
        assertTrue(allowedAdminExtensionRoute("GET", "/admin/ads")); assertTrue(allowedAdminExtensionRoute("POST", "/admin/ads"))
        assertTrue(allowedAdminExtensionRoute("PUT", "/admin/ads/$ad")); assertTrue(allowedAdminExtensionRoute("DELETE", "/admin/ads/$ad"))
        assertTrue(allowedAdminExtensionRoute("PUT", "/admin/users/user_1/subscription"))
        listOf("/admin/ads?all=true", "/admin/ads/../users", "/admin/ads/$ad/history", "/admin/users/user_1/subscription/extra").forEach { assertFalse(allowedAdminExtensionRoute("PUT", it)) }
        assertFalse(allowedAdminExtensionRoute("DELETE", "/admin/ads")); assertFalse(allowedAdminExtensionRoute("POST", "/admin/users/user_1/subscription"))
    }
    @Test fun userDeletionRequiresEmailAndProtectsAdministrators() {
        val user = JSONObject().put("id", "user_1").put("email", "user@example.test").put("isAdmin", false)
        assertFalse(AdminProtocol.canDelete(user, "")); assertFalse(AdminProtocol.canDelete(user, "other@example.test"))
        assertTrue(AdminProtocol.canDelete(user, " USER@example.test "))
        assertFalse(AdminProtocol.canDelete(user.put("isAdmin", true), "user@example.test"))
    }
    @Test fun subscriptionUsesObservedPlanRatherThanInventedVersion() {
        val body = AdminProtocol.subscription(JSONObject().put("id", "user_1").put("subscriptionPlan", "standart"), "premium")
        assertEquals("standart", body.getString("expectedPlan")); assertEquals("premium", body.getString("subscriptionPlan"))
        fails { AdminProtocol.subscription(JSONObject().put("id", "user_1").put("subscriptionPlan", "standart"), "admin") }
        fails { AdminProtocol.subscription(JSONObject().put("id", "../user").put("subscriptionPlan", "free"), "premium") }
    }
    @Test fun audienceCodesAndEmptyPlatformSelectionPreserveServerMeaning() {
        val input = AdminProtocol.input(form().put("languages", "RU, en; ru").put("countries", "ru UA,ru").put("platforms", JSONArray()), zone)
        assertEquals(listOf("ru", "en"), input.getJSONArray("languages").let { (0 until it.length()).map(it::getString) })
        assertEquals(listOf("RU", "UA"), input.getJSONArray("countries").let { (0 until it.length()).map(it::getString) })
        assertEquals(0, input.getJSONArray("platforms").length())
        fails { AdminProtocol.input(form().put("languages", "invalid"), zone) }
        fails { AdminProtocol.input(form().put("countries", "RUS"), zone) }
        fails { AdminProtocol.input(form().put("platforms", JSONArray().put("ios")), zone) }
    }
    @Test fun datesConvertFromDraftTimezoneAndRejectReversedRangeOrClockGap() {
        val input = AdminProtocol.input(form().put("startsAt", "2026-10-26T18:30").put("endsAt", "2026-10-27T18:30"), zone)
        assertEquals("2026-10-26T15:30:00Z", input.getString("startsAt"))
        assertEquals("2026-10-26T18:30:00", AdminProtocol.localDate(input.getString("startsAt"), zone))
        fails { AdminProtocol.input(form().put("startsAt", "2026-10-27T18:30").put("endsAt", "2026-10-26T18:30"), zone) }
        fails { AdminProtocol.input(form().put("startsAt", "2026-03-29T02:30"), ZoneId.of("Europe/Berlin")) }
    }
    @Test fun advertisementBoundsRejectUnsafeLinksAndOversizedFiles() {
        fails { AdminProtocol.input(form().put("linkUrl", "http://example.test"), zone) }
        fails { AdminProtocol.input(form().put("imageUrl", "https://user:password@example.test/image"), zone) }
        fails { AdminProtocol.input(form().put("title", "x".repeat(121)), zone) }
        fails { AdminProtocol.input(form().put("repeatHours", "0"), zone) }
        fails { AdminProtocol.input(form().put("priority", "11"), zone) }
        fails { AdminProtocol.imageData("data:image/png;base64," + Base64.getEncoder().encodeToString(ByteArray(500_001))) }
        fails { AdminProtocol.imageData("data:image/svg+xml;base64,AAAA") }
    }
    @Test fun fingerprintsPreserveDataImagesAcrossApiAndIgnoreAudienceOrder() {
        val data = "data:image/png;base64," + Base64.getEncoder().encodeToString(byteArrayOf(1, 2, 3))
        val input = AdminProtocol.input(form().put("imageData", data).put("imageUrl", "").put("languages", "ru,en"), zone)
        val server = JSONObject(input.toString()).put("id", ad).put("imageUrl", data).apply { remove("imageData") }
        assertEquals(AdminProtocol.fingerprint(input), AdminProtocol.fingerprint(server))
        server.put("languages", JSONArray(listOf("en", "ru")))
        assertEquals(AdminProtocol.fingerprint(input), AdminProtocol.fingerprint(server))
        assertEquals(data, AdminProtocol.form(server, zone).getString("imageData"))
        assertNotEquals(AdminProtocol.fingerprint(input), AdminProtocol.fingerprint(JSONObject(server.toString()).put("enabled", true)))
    }
}
