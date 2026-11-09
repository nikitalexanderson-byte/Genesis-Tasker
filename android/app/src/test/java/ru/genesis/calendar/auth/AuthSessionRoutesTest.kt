package ru.genesis.calendar.auth

import org.junit.Assert.*
import org.junit.Test

class AuthSessionRoutesTest {
    @Test fun planGuidanceMethodsStayAccountScopedAndCannotExpandToOtherResources() {
        assertTrue(allowedAuthSessionRoute("GET", "/account/plan-guidance"))
        assertFalse(allowedAuthSessionRoute("POST", "/account/plan-guidance"))
        for (action in listOf("claim", "shown", "read", "release")) {
            assertTrue(allowedAuthSessionRoute("POST", "/account/plan-guidance/$action"))
            for (method in listOf("GET", "PUT", "PATCH", "DELETE", "HEAD"))
                assertFalse(allowedAuthSessionRoute(method, "/account/plan-guidance/$action"))
        }
        assertFalse(allowedAuthSessionRoute("POST", "/account/plan-guidance/claim?user=another"))
        assertFalse(allowedAuthSessionRoute("POST", "/account/plan-guidance/delete"))
        assertFalse(allowedBillingRoute("POST", "/account/plan-guidance/claim"))
    }

    @Test fun weatherUsesOnlyItsAuthenticatedPostRoute() {
        assertTrue(allowedAuthSessionRoute("POST", "/weather/v1/current"))
        for (method in listOf("GET", "PUT", "PATCH", "DELETE", "HEAD"))
            assertFalse(allowedAuthSessionRoute(method, "/weather/v1/current"))
        assertFalse(allowedAuthSessionRoute("POST", "/weather/v1/current?provider=external"))
        assertFalse(allowedAuthSessionRoute("POST", "/weather/v1/current/other-user"))
    }

    @Test fun donationCheckoutIsOnlyAnExplicitPostAndDoesNotExpandBillingRoutes() {
        assertTrue(allowedAuthSessionRoute("POST", "/donations/cloudtips/checkout"))
        for (method in listOf("GET", "PUT", "PATCH", "DELETE", "HEAD"))
            assertFalse(allowedAuthSessionRoute(method, "/donations/cloudtips/checkout"))
        assertFalse(allowedAuthSessionRoute("POST", "/donations/cloudtips/checkout?user=someone"))
        assertFalse(allowedBillingRoute("POST", "/donations/cloudtips/checkout"))
    }

    @Test fun verificationStatusAndExplicitResendReachTheTransportGuard() {
        assertTrue(allowedAuthSessionRoute("GET", "/account/email/verification"))
        assertTrue(allowedAuthSessionRoute("POST", "/account/email/verification"))
        for (method in listOf("PUT", "PATCH", "DELETE", "HEAD"))
            assertFalse(allowedAuthSessionRoute(method, "/account/email/verification"))
        assertFalse(allowedAuthSessionRoute("GET", "/account/email/verification/other-user"))
    }

    @Test fun forecastPrivilegeAndResultRoutesStillUseTheirScopedGuards() {
        val id = "12345678-1234-4123-8123-123456789abc"
        assertTrue(allowedAuthSessionRoute("PUT", "/admin/users/$id/forecast-privilege"))
        assertFalse(allowedAuthSessionRoute("POST", "/admin/users/$id/forecast-privilege"))
        assertTrue(allowedAuthSessionRoute("GET", "/billing/modeling/results/$id"))
        assertFalse(allowedAuthSessionRoute("POST", "/billing/modeling/results/$id"))
        assertFalse(allowedAuthSessionRoute("GET", "/private/config"))
    }
}
