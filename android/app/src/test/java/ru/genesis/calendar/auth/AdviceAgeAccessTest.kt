package ru.genesis.calendar.auth

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class AdviceAgeAccessTest {
    private fun policy() = JSONObject("""{"policyVersion":"2026-11-01","corpusEnabled":true,"subcategories":[{"id":"inner-work"},{"id":"intoxication"}],"jurisdictions":{"US":{"status":"verified","minimumAge":21},"JP":{"status":"verified","minimumAge":20},"CA":{"status":"subdivision-required","subdivisions":{"CA-ON":{"status":"verified","minimumAge":19}}},"IN":{"status":"subdivision-required","subdivisions":{"IN-DL":{"status":"verified","minimumAge":25},"IN-BR":{"status":"blocked","minimumAge":null}}}}}""")
    private fun adult() = AdvicePsychopompiaPreferences(true, listOf("inner-work", "intoxication"))
    private fun card() = DailyAdvice("advice-" + "a".repeat(24), "2026-11-01", "Synthetic", "Exact synthetic text", "en",
        listOf("psychopompia"), null, false, emptyList(), requiresAdult = true, subcategories = listOf("inner-work"),
        containsAlcohol = false, psychopompiaPublished = true, reviewStatus = "cleared")
    @Test fun declarationsRoundTripWithoutCollectingBirthdayOrActualAge() {
        val psych = adult().copy(alcohol = AdviceAlcoholDeclaration(true, "US", "", 21))
        assertEquals(psych, AdvicePsychopompiaPreferences.fromJson(psych.toJson()))
        assertFalse(AdvicePsychopompiaPreferences().adultConfirmed)
        assertFalse(AdviceAlcoholDeclaration().consent)
        assertTrue(AdviceAlcoholDeclaration().countryCode.isEmpty())
        assertTrue(runCatching { AdviceAlcoholDeclaration(countryCode = "en") }.isFailure)
        assertTrue(runCatching { AdviceAlcoholDeclaration(countryCode = "US", subdivisionCode = "CA-ON") }.isFailure)
        assertTrue(runCatching { AdviceAlcoholDeclaration.fromJson(JSONObject().put("ageAtLeast", "21")) }.isFailure)
        assertTrue(runCatching { AdviceAlcoholDeclaration.fromJson(JSONObject().put("ageAtLeast", 21.5)) }.isFailure)
    }
    @Test fun noLanguageInferenceUnknownRegionOrLowerThresholdCanOpenAlcohol() {
        val rules = policy()
        for ((country, subdivision, threshold) in listOf(Triple("US", "", 21), Triple("JP", "", 20), Triple("CA", "CA-ON", 19), Triple("IN", "IN-DL", 25))) {
            val psych = adult().copy(alcohol = AdviceAlcoholDeclaration(true, country, subdivision, threshold))
            assertTrue(NativeAdviceAgeAccess.alcoholAllowed(psych, rules))
            assertFalse(NativeAdviceAgeAccess.alcoholAllowed(psych.copy(alcohol = psych.alcohol.copy(ageAtLeast = 18)), rules))
            assertFalse(NativeAdviceAgeAccess.alcoholAllowed(psych.copy(alcohol = psych.alcohol.copy(policyVersion = "2025-01-01")), rules))
        }
        assertEquals("subdivision-required", NativeAdviceAgeAccess.jurisdiction("CA", "", rules).state)
        assertEquals("unknown", NativeAdviceAgeAccess.jurisdiction("IN", "IN-KA", rules).state)
        assertEquals("blocked", NativeAdviceAgeAccess.jurisdiction("IN", "IN-BR", rules).state)
        assertEquals("unknown", NativeAdviceAgeAccess.jurisdiction("ZZ", "", rules).state)
    }
    @Test fun reviewPublicationAndBothConsentLayersAreRequiredAndNotificationsStayAdultFree() {
        val rules = policy()
        val preferences = AdvicePreferences(psychopompia = adult())
        val entry = card()
        assertTrue(NativeAdviceAgeAccess.allowed(entry, preferences, rules))
        assertFalse(NativeAdviceAgeAccess.allowed(entry.copy(categories = listOf("aretology")), preferences, rules))
        assertFalse(NativeAdviceAgeAccess.allowed(entry.copy(requiresAdult = false), preferences, rules))
        assertFalse(NativeAdviceAgeAccess.allowed(entry, preferences.copy(categories = listOf("aretology")), rules))
        assertFalse(NativeAdviceAgeAccess.allowed(entry.copy(containsAlcohol = true), preferences, rules))
        assertFalse(NativeAdviceAgeAccess.allowed(entry.copy(reviewStatus = "blocked"), preferences, rules))
        assertFalse(NativeAdviceAgeAccess.allowed(entry.copy(reviewStatus = "unreviewed"), preferences, rules))
        assertFalse(NativeAdviceAgeAccess.allowed(entry.copy(containsAlcohol = null), preferences, rules))
        assertFalse(NativeAdviceAgeAccess.allowed(entry.copy(psychopompiaPublished = false), preferences, rules))
        assertFalse(NativeAdviceAgeAccess.allowed(entry, preferences, rules.put("corpusEnabled", false)))
        assertFalse(NativeAdviceAgeAccess.notificationSafe(entry))
        assertFalse(NativeAdviceAgeAccess.notificationSafe(entry.copy(categories = listOf("aretology"))))
        assertFalse(NativeAdviceAgeAccess.notificationSafe(entry.copy(categories = listOf("aretology"), requiresAdult = false, containsAlcohol = true)))
    }
}
