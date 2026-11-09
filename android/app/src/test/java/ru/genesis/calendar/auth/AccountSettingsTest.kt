package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class AccountSettingsTest {
    @Test fun disablingSacredFeaturesUsesOnlyGregorianAndRestoresEverySavedCalendarCombination() {
        listOf(setOf("profane", "sacred", "lunar"), setOf("lunar"), setOf("sacred", "lunar"))
            .forEach { calendars ->
                val saved = UiVisibility(enabledCalendars = calendars, sacredFeaturesEnabled = false)
                val parsed = UiVisibility.fromJson(saved.toJson())
                assertEquals(setOf("profane"), parsed.visibleCalendars)
                assertEquals(calendars, parsed.enabledCalendars)
                assertEquals(calendars, parsed.copy(sacredFeaturesEnabled = true).visibleCalendars)
            }
    }

    @Test fun sacredVisibilityRoundTripsWithoutRewritingCalendarPreferences() {
        val saved = UiVisibility(enabledCalendars=setOf("sacred"), sacredFeaturesEnabled=false)
        val parsed = UiVisibility.fromJson(saved.toJson())
        assertFalse(parsed.sacredFeaturesEnabled)
        assertEquals(setOf("sacred"), parsed.enabledCalendars)
        assertEquals(setOf("profane"), parsed.visibleCalendars)
        assertEquals(setOf("sacred"), parsed.copy(sacredFeaturesEnabled=true).visibleCalendars)
        assertTrue(UiVisibility.fromJson(JSONObject()).sacredFeaturesEnabled)
    }

    private val response = JSONObject("""{
      "user": {
        "googleAccounts": [
          {"id":"owner-1","email":"owner@example.invalid","displayName":"Owner","isPrimary":true,"calendarConnected":true,"googleTasksImportReady":true},
          {"id":"linked-2","email":"linked@example.invalid","displayName":"Linked","isPrimary":false,"calendarConnected":true,"googleTasksImportReady":true}
        ],
        "syncRouting": {"mode":"category","defaultAccountIds":["owner-1"],
          "categoryAccountIds":{"work":["linked-2"]}},
        "multiAccountEnabled":true,"theme":"experimental","themeRevision":3,
        "calendarMode":"lunar","taskCalendarMode":"profane","timeFormat":"12h","weekStart":"monday",
        "stoicheionDivinationDisabled":false,"language":"ru"
      }
    }""")

    @Test fun parsesLinkedAccountsAndCategoryRoutingWithoutChangingTheirIds() {
        val settings = AccountSettings.fromResponse(response)!!
        assertEquals(2, settings.accounts.size)
        assertEquals("linked-2", settings.routing.categoryAccountIds["work"]!!.single())
        assertEquals("experimental", settings.theme)
        assertEquals("lunar", settings.calendarMode)
        assertEquals("12h", settings.timeFormat)
        assertEquals("monday", settings.weekStart)
        assertEquals("linked-2", settings.routing.toJson().getJSONObject("categoryAccountIds")
            .getJSONArray("work").getString(0))
    }

    @Test fun refusesUnknownDestinationsAndEmptyDefaultTargets() {
        val settings = AccountSettings.fromResponse(response)!!
        assertFalse(settings.routing.copy(defaultAccountIds = emptyList()).validFor(settings.accounts))
        assertFalse(settings.routing.copy(categoryAccountIds = mapOf("work" to listOf("unknown")))
            .validFor(settings.accounts))
        assertTrue(settings.routing.copy(mode = "choose").validFor(settings.accounts))
    }

    @Test fun acceptsFiveLinkedAccountsWithoutTruncatingDestinations() {
        val accounts = response.getJSONObject("user").getJSONArray("googleAccounts")
        for (index in 3..5) accounts.put(JSONObject()
            .put("id", "linked-$index").put("email", "linked$index@example.invalid")
            .put("displayName", "Linked $index").put("isPrimary", false))
        val settings = AccountSettings.fromResponse(response)!!
        assertEquals(5, settings.accounts.size)
        assertTrue(settings.routing.copy(defaultAccountIds = settings.accounts.map { it.id })
            .validFor(settings.accounts))
    }

    @Test fun acceptsLegacyEmptyCategoryArrayFromAccountsWithoutRouting() {
        val legacy = JSONObject(response.toString())
        legacy.getJSONObject("user").getJSONObject("syncRouting")
            .put("mode", "fixed")
            .put("categoryAccountIds", JSONArray())

        val settings = AccountSettings.fromResponse(legacy)!!

        assertTrue(settings.routing.categoryAccountIds.isEmpty())
        assertEquals("owner-1", settings.routing.defaultAccountIds.single())
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsPopulatedArrayInPlaceOfCategoryMap() {
        val malformed = JSONObject(response.toString())
        malformed.getJSONObject("user").getJSONObject("syncRouting")
            .put("categoryAccountIds", JSONArray().put("owner-1"))
        AccountSettings.fromResponse(malformed)
    }
}
