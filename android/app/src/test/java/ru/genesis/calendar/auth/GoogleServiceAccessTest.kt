package ru.genesis.calendar.auth

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class GoogleServiceAccessTest {
    private fun settings(calendar: Boolean, tasks: Boolean): AccountSettings {
        val response = JSONObject("""{
          "user": {
            "googleAccounts": [{"id":"owner","email":"owner@example.invalid","displayName":"Owner",
              "isPrimary":true,"calendarConnected":$calendar,"googleTasksImportReady":$tasks}],
            "syncRouting":{"mode":"fixed","defaultAccountIds":["owner"],"categoryAccountIds":{}},
            "multiAccountEnabled":true
          }
        }""")
        return requireNotNull(AccountSettings.fromResponse(response))
    }

    @Test fun distinguishesCalendarOnlyAndTasksOnlyGrants() {
        val calendarOnly = GoogleServiceAccess.primary(settings(calendar = true, tasks = false))
        assertTrue(calendarOnly.calendar)
        assertFalse(calendarOnly.tasks)
        assertTrue(GOOGLE_TASKS_SCOPE in calendarOnly.scopesForConsent())
        assertTrue(GOOGLE_CALENDAR_SCOPE in calendarOnly.scopesForConsent())

        val tasksOnly = GoogleServiceAccess.primary(settings(calendar = false, tasks = true))
        assertFalse(tasksOnly.calendar)
        assertTrue(tasksOnly.tasks)
        assertTrue(GOOGLE_CALENDAR_SCOPE in tasksOnly.scopesForConsent())
        assertTrue(GOOGLE_TASKS_SCOPE in tasksOnly.scopesForConsent())
    }

    @Test fun newAndReconnectedAccountsRequestTheRequiredServiceScopes() {
        val fresh = GoogleServiceAccess.primary(settings(calendar = false, tasks = false))
        assertEquals(setOf(GOOGLE_CALENDAR_SCOPE, GOOGLE_TASKS_SCOPE),
            fresh.scopesForConsent().filter { it.startsWith("https://") }.toSet())

        val connected = GoogleServiceAccess.primary(settings(calendar = true, tasks = true))
        assertTrue(connected.complete)
        assertEquals(setOf(GOOGLE_CALENDAR_SCOPE, GOOGLE_TASKS_SCOPE),
            connected.scopesForConsent().filter { it.startsWith("https://") }.toSet())
    }
}
