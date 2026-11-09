package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class DailyAdviceProtocolTest {
    @Test fun notificationsAreOptInAndKeepAnExplicitAccountTimeZone() {
        assertFalse(AdvicePreferences.fromJson(null).notifications.enabled)
        val original = AdvicePreferences(notifications = AdviceNotificationPreferences(true, "23:15", "Europe/Moscow"))
        assertEquals(original, AdvicePreferences.fromJson(original.toJson()))
        val disabled = original.copy(notifications = original.notifications.copy(enabled = false))
        assertEquals("23:15", AdvicePreferences.fromJson(disabled.toJson()).notifications.time)
        assertEquals("Europe/Moscow", AdvicePreferences.fromJson(disabled.toJson()).notifications.timeZone)
        assertFalse(AdvicePreferences.fromJson(disabled.toJson()).notifications.enabled)
        for (invalid in listOf(
            JSONObject().put("time", "24:00"), JSONObject().put("time", "9:00"),
            JSONObject().put("timeZone", "+03:00"), JSONObject().put("timeZone", "Unknown/Zone"),
            JSONObject().put("enabled", "true"), JSONObject().put("test", true))) {
            assertTrue(runCatching { AdviceNotificationPreferences.fromJson(invalid) }.isFailure)
        }
    }
    @Test fun savedLinksReadTheSameSlotWithoutAUsableNextAllowance() {
        val id = "advice-" + "a".repeat(24)
        assertEquals("/advice/saved?id=$id&dayKey=2026-10-23&collection=aurora&maxDailyCards=9",
            DailyAdviceProtocol.savedPath(id, "2026-10-23", "aurora"))
        for (slot in 1..9) {
            val wire = response().put("sequence", slot).put("canNext", false).put("remaining", 0)
            wire.getJSONObject("advice").put("sequence", slot)
            wire.put("history", JSONArray().put(wire.getJSONObject("advice")))
            val parsed = DailyAdviceProtocol.parse(wire)
            assertEquals(id, parsed.advice!!.id); assertEquals(slot, parsed.advice.sequence)
            assertFalse(parsed.canNext); assertEquals(1, parsed.history.size)
        }
        assertTrue(runCatching { DailyAdviceProtocol.savedPath(id, "2026-02-30", "aurora") }.isFailure)
        assertTrue(runCatching { DailyAdviceProtocol.savedPath(id, "2026-10-23", "unknown") }.isFailure)
    }
    @Test fun aCachedNotificationCannotBypassTheMainSourceAdultOrDismissedControls() {
        val card = DailyAdviceProtocol.parse(response()).advice!!
        assertTrue(DailyAdviceProtocol.visible(card, AdvicePreferences()))
        assertFalse(DailyAdviceProtocol.visible(card, AdvicePreferences(enabled = false)))
        assertFalse(DailyAdviceProtocol.visible(card, AdvicePreferences(collections = listOf("philosophers"))))
        assertFalse(DailyAdviceProtocol.visible(card.copy(dismissed = true), AdvicePreferences()))
        val adult = card.copy(categories = listOf("aphrodisia"), requiresAdult = true)
        assertFalse(DailyAdviceProtocol.visible(adult, AdvicePreferences(aphrodisiaAdult = false, categories = listOf("aphrodisia"))))
        assertTrue(DailyAdviceProtocol.visible(adult, AdvicePreferences(aphrodisiaAdult = true, categories = listOf("aphrodisia"))))
    }
    @Test fun collectionPreferencesRoundTripAndLegacyCardsRemainAurora() {
        assertEquals(listOf("aurora"),AdvicePreferences.fromJson(null).collections)
        for(collections in listOf(listOf("aurora"),listOf("philosophers"),listOf("aurora","philosophers"))) {
            val original=AdvicePreferences(collections=collections)
            assertEquals(original,AdvicePreferences.fromJson(original.toJson()))
        }
        val wire=response()
        assertEquals("aurora",DailyAdviceProtocol.parse(wire).advice!!.collection)
        wire.getJSONObject("advice").put("collection","philosophers").put("categories",JSONArray())
        assertEquals("philosophers",DailyAdviceProtocol.parse(wire).advice!!.collection)
        assertTrue(runCatching { DailyAdviceProtocol.parse(wire.apply { getJSONObject("advice").put("collection","unknown") }) }.isFailure)
    }
    private fun response() = JSONObject().put("dayKey", "2026-10-23").put("state", "ready").put("advice",
        JSONObject().put("id", "advice-" + "a".repeat(24)).put("dayKey", "2026-10-23").put("title", "Full title")
            .put("body", "Full text\nSecond paragraph").put("language", "ru").put("categories", JSONArray().put("aretology"))
            .put("image", "/advice-art/aretology/advice-" + "a".repeat(24) + ".webp").put("dismissed", false).put("sources", JSONArray()))
    @Test fun preservesIdentityFullTextAndDismissalAcrossRepeatedResponses() {
        val wire = response()
        val first = DailyAdviceProtocol.parse(wire).advice!!
        assertEquals("Full text\nSecond paragraph", first.body)
        val body = DailyAdviceProtocol.record(first.id, first.day)
        assertEquals(setOf("id", "dayKey"), body.keys().asSequence().toSet())
        wire.getJSONObject("advice").put("dismissed", true)
        val next = DailyAdviceProtocol.parse(wire).advice!!
        assertEquals(first.id, next.id); assertTrue(next.dismissed)
        assertEquals(first.image, next.image)
    }
    @Test fun optionalArtworkCannotIntroduceAnArbitraryRemoteUrl() {
        val wire = response(); wire.getJSONObject("advice").put("image", "https://outside.invalid/image")
        assertNull(DailyAdviceProtocol.parse(wire).advice!!.image)
    }
    @Test fun rotationKeepsTheServerDailyBudgetAndHestiologyArtwork() {
        val wire = response().put("sequence", 2).put("dailyLimit", 3).put("canNext", true)
        wire.getJSONObject("advice").put("categories", JSONArray().put("hestiology"))
            .put("image", "/advice-art/hestiology/advice-" + "a".repeat(24) + ".webp")
        val parsed = DailyAdviceProtocol.parse(wire)
        assertEquals(2, parsed.sequence); assertEquals(3, parsed.dailyLimit); assertTrue(parsed.canNext)
        assertEquals(listOf("hestiology"), parsed.advice!!.categories)
        assertTrue(parsed.advice.image!!.contains("/hestiology/"))
        assertFalse(DailyAdviceProtocol.parse(wire.put("sequence", 3).put("canNext", false)).canNext)
        assertTrue(runCatching { DailyAdviceProtocol.parse(wire.put("canNext", true)) }.isFailure)
        assertTrue(runCatching { DailyAdviceProtocol.parse(wire.put("dailyLimit", 10)) }.isFailure)
    }
    @Test fun malformedOrCrossDayDataIsRejected() {
        for (mutate in listOf<(JSONObject) -> Unit>(
            { it.getJSONObject("advice").put("dayKey", "2026-10-24") },
            { it.getJSONObject("advice").put("dismissed", 0) },
            { it.getJSONObject("advice").put("language", "unknown") },
            { it.put("state", "ready").put("advice", JSONObject.NULL) }
        )) {
            assertTrue(runCatching { DailyAdviceProtocol.parse(response().also(mutate)) }.isFailure)
        }
    }
    @Test fun missingLegacyPreferencesUseTheWebsiteDefaultsWithoutLosingFalse() {
        assertEquals(AdvicePreferences(), AdvicePreferences.fromJson(null))
        val actual = AdvicePreferences.fromJson(JSONObject().put("enabled", false).put("smart", false)
            .put("categories", JSONArray().put("hermetica").put("unknown")))
        assertFalse(actual.enabled); assertFalse(actual.smart); assertEquals(listOf("hermetica"), actual.categories)
    }

    @Test fun aphorismCountDefaultsToOneAndSurvivesPreferenceRoundTrips() {
        assertEquals(1, AdvicePreferences.fromJson(null).philosophersPerDay)
        for (count in 1..3) {
            val preferences = AdvicePreferences(philosophersPerDay = count)
            assertEquals(preferences, AdvicePreferences.fromJson(preferences.toJson()))
        }
        for (count in listOf(0, 4)) assertTrue(runCatching { AdvicePreferences(philosophersPerDay = count) }.isFailure)
    }

    @Test fun sixAdviceCardsAndThreeAphorismsRetainTheirServerOrder() {
        val wire = response().put("sequence", 9).put("dailyLimit", 9).put("canNext", false)
        val history = JSONArray()
        for (slot in 1..9) history.put(JSONObject(wire.getJSONObject("advice").toString())
            .put("id", "advice-" + slot.toString(16).padStart(24, '0')).put("sequence", slot)
            .put("collection", if (slot > 6) "philosophers" else "aurora"))
        wire.put("history", history).put("advice", history.getJSONObject(8))
        val parsed = DailyAdviceProtocol.parse(wire)
        assertEquals((1..9).toList(), parsed.history.map { it.sequence })
        assertEquals(3, parsed.history.count { it.collection == "philosophers" })
        assertFalse(parsed.canNext)
    }

    @Test fun historyRetainsAccountOrderAndTheExhaustedAllowance() {
        val wire = response().put("sequence", 3).put("dailyLimit", 3).put("canNext", false)
        val rows = JSONArray()
        for (slot in 1..3) rows.put(JSONObject(wire.getJSONObject("advice").toString())
            .put("id", "advice-" + ('a' + slot - 1).toString().repeat(24)).put("sequence", slot))
        wire.put("history", rows).put("advice", JSONObject(rows.getJSONObject(2).toString()))
        val parsed = DailyAdviceProtocol.parse(wire)
        assertEquals(listOf(1, 2, 3), parsed.history.map { it.sequence })
        assertEquals(3, parsed.sequence); assertFalse(parsed.canNext)
        assertEquals(parsed.advice!!.id, parsed.history.last().id)
        for (mutate in listOf<(JSONObject) -> Unit>(
            { it.getJSONArray("history").getJSONObject(0).put("dayKey", "2026-10-22") },
            { it.getJSONArray("history").getJSONObject(0).put("sequence", 4) },
            { it.getJSONArray("history").getJSONObject(0).put("id", rows.getJSONObject(1).getString("id")) },
            { it.getJSONArray("history").getJSONObject(0).put("sequence", 2) },
            { it.getJSONArray("history").getJSONObject(0).put("language", "ja") }
        )) assertTrue(runCatching { DailyAdviceProtocol.parse(JSONObject(wire.toString()).also(mutate)) }.isFailure)
    }
}
