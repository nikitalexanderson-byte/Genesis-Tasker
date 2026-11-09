package ru.genesis.calendar.auth

import android.util.Log

internal const val GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.app.created"
internal const val GOOGLE_TASKS_SCOPE = "https://www.googleapis.com/auth/tasks"

internal data class GoogleServiceAccess(val calendar: Boolean, val tasks: Boolean) {
    val complete get() = calendar && tasks

    fun scopesForConsent(): List<String> = buildList {
        // The backend resolves the stable Google sub from userinfo after exchanging
        // the code. Never authorize a service grant from an email supplied by Android.
        add("openid")
        add("email")
        add("profile")
        // Request both service scopes on every authorization. The token endpoint's
        // returned scope list can then replace the stored list authoritatively,
        // without accidentally dropping an older grant during incremental consent.
        add(GOOGLE_CALENDAR_SCOPE)
        add(GOOGLE_TASKS_SCOPE)
    }

    companion object {
        fun primary(settings: AccountSettings?): GoogleServiceAccess {
            val primary = settings?.accounts?.firstOrNull { it.isPrimary }
            return GoogleServiceAccess(primary?.calendarConnected == true, primary?.tasksConnected == true)
        }
    }
}

internal object AuthDiagnostics {
    private val allowed = setOf(
        "GOOGLE_AUTH_STARTED", "GOOGLE_AUTH_SUCCESS", "GOOGLE_ID_TOKEN_RECEIVED",
        "BACKEND_AUTH_SUCCESS", "GENESIS_USER_RESOLVED", "GOOGLE_LINK_FOUND", "GOOGLE_LINK_CREATED",
        "CALENDAR_SCOPE_GRANTED", "TASKS_SCOPE_GRANTED", "SYNC_STARTED", "SYNC_SUCCESS", "SYNC_FAILED",
    )

    fun event(name: String) {
        if (name in allowed) Log.i("GenesisAuthFlow", name)
    }
}

internal class GoogleServicesAuthorizationException : Exception("Google services authorization failed")
