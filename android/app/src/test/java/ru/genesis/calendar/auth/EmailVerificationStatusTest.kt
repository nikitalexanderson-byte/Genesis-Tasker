package ru.genesis.calendar.auth

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class EmailVerificationStatusTest {
    @Test fun verificationSurvivesTheOfflineSettingsCache() {
        val pending = EmailVerificationStatus(true, false, true, 60)
        assertEquals(pending, EmailVerificationStatus.fromJson(pending.toJson()))
        assertEquals(EmailVerificationStatus(), EmailVerificationStatus.fromJson(null))
        assertEquals(EmailVerificationStatus(false, true, true), EmailVerificationStatus.fromJson(
            EmailVerificationStatus(false, true, true).toJson()))
    }
    @Test fun invalidStatusCannotMasqueradeAsAConfirmedAccount() {
        for (value in listOf(
            EmailVerificationStatus(true, false).toJson().put("confirmed", true),
            EmailVerificationStatus().toJson().put("required", "false"),
            EmailVerificationStatus().toJson().put("retryAfter", 61),
            EmailVerificationStatus().toJson().put("retryAfter", -1),
            JSONObject())) assertTrue(runCatching { EmailVerificationStatus.fromJson(value) }.isFailure)
    }
}
