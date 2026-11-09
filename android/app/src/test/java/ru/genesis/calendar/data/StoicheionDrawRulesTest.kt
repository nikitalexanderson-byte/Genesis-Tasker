package ru.genesis.calendar.data

import org.junit.Assert.*
import org.junit.Test
import org.json.JSONObject
import org.json.JSONArray
import java.time.Instant

class StoicheionDrawRulesTest {
    @Test fun oneRerollWithinThreeMinutesAndThenFixedForDay() {
        val first = StoicheionDrawRules.next(null, "daily", "2026-09-24", 42L, 1_000L)
        assertEquals(1, first.attempts)
        assertEquals(181_000L, first.rerollDeadline)
        assertTrue(first.canReroll(180_999L))
        val second = StoicheionDrawRules.next(first, "daily", "2026-09-24", 43L, 180_999L)
        assertEquals(2, second.attempts)
        assertEquals(first.firstAt, second.firstAt)
        assertEquals(first.rerollDeadline, second.rerollDeadline)
        assertFalse(second.canReroll(181_000L))
        assertThrows(IllegalArgumentException::class.java) {
            StoicheionDrawRules.next(second, "daily", "2026-09-24", 44L, 181_000L)
        }
        assertThrows(IllegalArgumentException::class.java) {
            StoicheionDrawRules.next(first, "daily", "2026-09-24", 43L, 181_000L)
        }
        assertEquals(1, StoicheionDrawRules.next(null, "daily", "2026-09-25", 44L, 181_000L).attempts)
    }

    @Test fun dailyAndSpreadHaveIndependentLimits() {
        val daily = StoicheionDrawRules.next(null, "daily", "2026-09-24", 1L, 1_000L)
        val spread = StoicheionDrawRules.next(null, "spread", "2026-09-24", 2L, 1_000L)
        assertEquals("daily", daily.kind)
        assertEquals("spread", spread.kind)
        assertThrows(IllegalArgumentException::class.java) {
            StoicheionDrawRules.next(daily, "spread", "2026-09-24", 3L, 1_001L)
        }
    }

    @Test fun serverDrawUsesCanonicalAccountDateAndTimestamps() {
        val value = JSONObject().put("kind", "daily").put("dayKey", "2026-09-26")
            .put("seed", 4_294_967_295L).put("attempts", 1)
            .put("firstDrawAt", "2026-09-26T07:00:00Z")
            .put("rerollDeadline", "2026-09-26T07:03:00Z")
        val draw = StoicheionDrawWire.fromServerJson(value)
        assertEquals("2026-09-26", draw.dayKey)
        assertEquals(4_294_967_295L, draw.seed)
        assertEquals(Instant.parse("2026-09-26T07:00:00Z").toEpochMilli(), draw.firstAt)
        assertTrue(draw.canReroll(Instant.parse("2026-09-26T07:02:59Z").toEpochMilli()))
        value.put("kind", "unknown")
        assertThrows(IllegalArgumentException::class.java) { StoicheionDrawWire.fromServerJson(value) }
    }

    @Test fun emptyServerDrawListIsAcceptedByTheAccountContract() {
        val payload = JSONObject().put("dayKey", "2026-09-26").put("draws", JSONArray())
        assertEquals(0, StoicheionDrawWire.drawsObject(payload).length())
        payload.put("draws", JSONArray().put(JSONObject()))
        assertThrows(IllegalArgumentException::class.java) { StoicheionDrawWire.drawsObject(payload) }
    }

    @Test fun theCompleteServerSnapshotIsValidatedBeforeAnyLocalReplacement() {
        val draws = JSONObject()
        for (kind in listOf("daily", "spread", "timeline")) draws.put(kind, JSONObject()
            .put("kind", kind).put("dayKey", "2026-11-05").put("seed", 4_294_967_295L).put("attempts", 2)
            .put("firstDrawAt", "2026-11-04T21:10:16Z").put("rerollDeadline", "2026-11-04T21:13:16Z"))
        val payload = JSONObject().put("dayKey", "2026-11-05").put("draws", draws)
        assertEquals(3, StoicheionDrawWire.snapshot(payload).second.size)
        // A malformed entry used to be silently omitted by optJSONObject, erasing that saved draw.
        draws.put("spread", JSONObject.NULL)
        assertThrows(org.json.JSONException::class.java) { StoicheionDrawWire.snapshot(payload) }
        draws.put("spread", JSONObject().put("kind", "daily").put("dayKey", "2026-11-05")
            .put("seed", 1).put("attempts", 1).put("firstDrawAt", "2026-11-04T21:10:16Z")
            .put("rerollDeadline", "2026-11-04T21:13:16Z"))
        assertThrows(IllegalArgumentException::class.java) { StoicheionDrawWire.snapshot(payload) }
    }

    @Test fun weeklyServerDrawsKeepTheirOriginalDateUntilMonday() {
        assertTrue(StoicheionDrawRules.inPeriod("spread","2026-11-02","2026-11-08"))
        assertTrue(StoicheionDrawRules.inPeriod("timeline","2026-11-06","2026-11-08"))
        assertFalse(StoicheionDrawRules.inPeriod("spread","2026-11-08","2026-11-09"))
        assertFalse(StoicheionDrawRules.inPeriod("daily","2026-11-06","2026-11-07"))
        val draw=JSONObject().put("kind","spread").put("dayKey","2026-11-02").put("seed",42).put("attempts",1)
            .put("firstDrawAt","2026-11-02T09:00:00Z").put("rerollDeadline","2026-11-02T09:03:00Z")
        val payload=JSONObject().put("dayKey","2026-11-08").put("draws",JSONObject().put("spread",draw))
        assertEquals("2026-11-02",StoicheionDrawWire.snapshot(payload).second.single().dayKey)
        payload.put("dayKey","2026-11-09")
        assertThrows(IllegalArgumentException::class.java){StoicheionDrawWire.snapshot(payload)}
        draw.put("unlimited",true)
        assertTrue(StoicheionDrawWire.fromServerJson(draw).canReroll(Long.MAX_VALUE))
    }
}
