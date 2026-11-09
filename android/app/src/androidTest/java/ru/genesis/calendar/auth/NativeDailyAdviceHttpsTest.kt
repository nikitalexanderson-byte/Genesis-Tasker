package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.Assert.*

/** Real native cookie/CSRF/TLS client -> loopback PHP. No production account or external delivery. */
class NativeDailyAdviceHttpsTest {
    private val fixture = TemplateHttpsFixture()
    @Before fun open() = fixture.open()
    @After fun close() = fixture.close()
    @Test fun oneServerAdviceSurvivesLanguagePreferencesViewDismissAndAnotherSession() {
        val client = fixture.client; val generation = fixture.generation
        val original = client.session(generation).getJSONObject("user")
        val preferences = original.getJSONObject("advicePreferences")
        val language = original.getString("language")
        try {
            client.updatePreferences(generation, JSONObject().put("advicePreferences",
                JSONObject().put("enabled", true).put("smart", false).put("categories", JSONArray().put("aretology"))))
            val first = DailyAdviceProtocol.parse(client.dailyAdvice(generation, JSONObject().put("scores", JSONObject()).put("topics", JSONObject())))
            val initial = requireNotNull(first.advice)
            val rotated = DailyAdviceProtocol.parse(client.nextDailyAdvice(generation,
                JSONObject().put("scores", JSONObject()).put("topics", JSONObject()), initial.id, initial.day))
            val card = requireNotNull(rotated.advice)
            assertNotEquals(initial.id, card.id)
            assertEquals(initial.day, card.day)
            assertEquals(first.sequence + 1, rotated.sequence)
            val retried = DailyAdviceProtocol.parse(client.nextDailyAdvice(generation, JSONObject(), initial.id, initial.day))
            assertEquals(card.id, retried.advice!!.id)
            assertEquals(rotated.sequence, retried.sequence)
            assertTrue(card.body.isNotBlank()); assertNotNull(card.image)
            client.recordAdvice(generation, card.id, card.day, false)
            client.recordAdvice(generation, card.id, card.day, false)
            client.updatePreferences(generation, JSONObject().put("language", "ja"))
            val japanese = DailyAdviceProtocol.parse(client.dailyAdvice(generation, JSONObject()))
            assertEquals(card.id, japanese.advice!!.id); assertEquals("ja", japanese.advice.language)
            client.recordAdvice(generation, card.id, card.day, true)
            val repeated = DailyAdviceProtocol.parse(client.dailyAdvice(generation, JSONObject()))
            assertEquals(card.id, repeated.advice!!.id); assertTrue(repeated.advice.dismissed)
            client.updatePreferences(generation, JSONObject().put("advicePreferences", JSONObject().put("enabled", false)))
            assertEquals("disabled", DailyAdviceProtocol.parse(client.dailyAdvice(generation, JSONObject())).state)
            client.updatePreferences(generation, JSONObject().put("advicePreferences", JSONObject().put("enabled", true)))
            val nextSession = AuthSessionClient(fixture.app); val nextGeneration = nextSession.begin()
            val retained = DailyAdviceProtocol.parse(nextSession.dailyAdvice(nextGeneration, JSONObject()))
            assertEquals(card.id, retained.advice!!.id); assertTrue(retained.advice.dismissed)
        } finally {
            client.updatePreferences(generation, JSONObject().put("language", language).put("advicePreferences", preferences))
        }
    }
}
