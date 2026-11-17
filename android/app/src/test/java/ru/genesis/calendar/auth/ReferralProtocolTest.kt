package ru.genesis.calendar.auth

import org.junit.Assert.*
import org.junit.Test

class ReferralProtocolTest {
    @Test fun linkedIdentityReceivesPrimaryAccountInstruction() {
        val error = requireNotNull(referralAccessError(403, "REFERRAL_PRIMARY_GOOGLE_REQUIRED"))
        assertEquals("primaryRequired", referralErrorKey(error))
        assertEquals("standardRequired", referralErrorKey(requireNotNull(referralAccessError(403, "REFERRAL_STANDARD_REQUIRED"))))
        assertEquals("privateProgram", referralErrorKey(requireNotNull(referralAccessError(409, "REFERRAL_PRIVATE_PARTNER_PROGRAM"))))
    }
    @Test fun unrelatedFailuresRemainRetryableAndNeverExposeDetails() {
        assertNull(referralAccessError(500, "REFERRAL_PRIMARY_GOOGLE_REQUIRED"))
        assertNull(referralAccessError(403, "REFERRAL_PRIVATE_PARTNER_PROGRAM"))
        assertNull(referralAccessError(403, "PRIVATE_SERVER_DETAIL"))
        assertEquals("error", referralErrorKey(AuthFailure(AuthFailure.Kind.NETWORK)))
        assertEquals("error", referralErrorKey(AuthApiError("PRIVATE_SERVER_DETAIL")))
    }
    @Test fun referralTransportDoesNotOpenPrivatePartnerRoutes() {
        assertTrue(allowedAuthSessionRoute("GET", "/referrals/me"))
        assertFalse(allowedAuthSessionRoute("DELETE", "/referrals/me"))
        assertFalse(allowedAuthSessionRoute("POST", "/referrals/me"))
        assertFalse(allowedReferralRoute("GET", "/partners/me"))
    }
}
