package ru.genesis.calendar.data

import java.time.Instant
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.auth.allowedAuthSessionRoute
import ru.genesis.calendar.domain.StoicheionReading

class StoicheionTimelineStateTest {
    private val now = Instant.parse("2026-11-15T10:01:00Z").toEpochMilli()
    private fun payload() = JSONObject().put("serverNow", "2026-11-15T10:01:00Z").put("timeline", JSONObject()
        .put("dayKey", "2026-11-15").put("periodKey", "2026-11-09").put("seed", 4294967295L)
        .put("revision", 2).put("firstDrawAt", "2026-11-15T10:00:00Z")
        .put("cards", JSONArray().put(JSONObject().put("position", 0)
            .put("firstRevealedAt", "2026-11-15T10:00:00Z").put("rerollDeadline", "2026-11-15T10:03:00Z")
            .put("rerolled", false).put("canReroll", true))))

    @Test fun anotherDeviceGetsTheSameWeeklyDealAndOriginalTimerDespiteClockSkew() {
        val web = requireNotNull(StoicheionTimelineWire.parse(payload(), now))
        val phone = requireNotNull(StoicheionTimelineWire.parse(payload(), now + 7200000L))
        assertEquals(web.seed, phone.seed); assertEquals(web.periodKey, phone.periodKey)
        assertEquals(120, web.remainingSeconds(0, now))
        assertEquals(120, phone.remainingSeconds(0, now + 7200000L))
        assertEquals(0, phone.remainingSeconds(0, now + 7320000L))
        assertEquals(0, phone.remainingSeconds(1, now))
        assertFalse(phone.asDraw().canReroll(now))
        assertEquals(listOf(11 to false, 9 to true, 2 to false),
            StoicheionReading.spread((0..23).toList(), 0x12345678L, 3))
    }

    @Test fun aServerDeniedNineCardRerollStaysDeniedOnThePhone() {
        val value = JSONObject().put("kind", "spread").put("dayKey", "2026-11-15").put("seed", 42)
            .put("attempts", 1).put("firstDrawAt", "2026-11-15T10:00:00Z")
            .put("rerollDeadline", "2026-11-15T10:03:00Z").put("canReroll", false)
        assertFalse(StoicheionDrawWire.fromServerJson(value).canReroll(now))
    }

    @Test fun aRerollUsedOnTheWebsiteIsAlsoUsedOnAndroid() {
        val payload = payload()
        payload.getJSONObject("timeline").getJSONArray("cards").getJSONObject(0).put("rerolled", true)
        assertEquals(0, requireNotNull(StoicheionTimelineWire.parse(payload, now)).remainingSeconds(0, now))
        payload.getJSONObject("timeline").getJSONArray("cards").getJSONObject(0).put("rerolled", false).put("canReroll", false)
        assertEquals(0, requireNotNull(StoicheionTimelineWire.parse(payload, now)).remainingSeconds(0, now))
        payload.put("timeline", JSONObject.NULL)
        assertNull(StoicheionTimelineWire.parse(payload, now))
    }

    @Test fun malformedQuotaSnapshotsCannotReplaceSavedCardsAndTheRouteIsNarrow() {
        val payload = payload()
        payload.getJSONObject("timeline").getJSONArray("cards").getJSONObject(0).put("position", 2)
        assertThrows(IllegalArgumentException::class.java) { StoicheionTimelineWire.parse(payload, now) }
        for (method in listOf("GET", "POST")) assertTrue(allowedAuthSessionRoute(method, "/stoicheion/timeline/cards"))
        for (method in listOf("DELETE", "PUT", "PATCH")) assertFalse(allowedAuthSessionRoute(method, "/stoicheion/timeline/cards"))
        assertFalse(allowedAuthSessionRoute("POST", "/stoicheion/timeline/cards/other"))
    }
}
