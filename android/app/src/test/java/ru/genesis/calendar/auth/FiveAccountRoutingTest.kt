package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class FiveAccountRoutingTest {
    @Test fun parsesFiveAccountsAndPreservesCategoryDestinations() {
        val ids = (1..5).map { "account-$it" }
        val accounts = JSONArray().apply {
            ids.forEachIndexed { index, id ->
                put(JSONObject().put("id", id).put("email", "$id@example.com")
                    .put("displayName", "Account ${index + 1}").put("isPrimary", index == 0)
                    .put("calendarConnected", true).put("googleTasksImportReady", true))
            }
        }
        val routing = JSONObject().put("mode", "category")
            .put("defaultAccountIds", JSONArray(listOf(ids.first())))
            .put("categoryAccountIds", JSONObject().put("work", JSONArray(ids)))
        val response = JSONObject().put("user", JSONObject().put("googleAccounts", accounts)
            .put("syncRouting", routing).put("multiAccountEnabled", true))
        val settings = requireNotNull(AccountSettings.fromResponse(response))
        assertEquals(5, settings.accounts.size)
        assertEquals(ids, settings.routing.categoryAccountIds["work"])
        assertTrue(settings.routing.validFor(settings.accounts))
        assertFalse(settings.routing.copy(categoryAccountIds = mapOf("work" to ids + "unknown"))
            .validFor(settings.accounts))
    }
}
