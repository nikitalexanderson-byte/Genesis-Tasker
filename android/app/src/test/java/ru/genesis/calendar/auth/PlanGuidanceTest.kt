package ru.genesis.calendar.auth

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

/** Contract checks prepared for a later permitted native test run. */
class PlanGuidanceTest {
    private fun free() = FeatureAccess(enforcementEnabled = true, policyRevision = "server-policy-v1",
        declaredPlan = "free", effectivePlan = "free", source = "subscription")

    @Test fun onlyCanonicalVerifiedFreeIsEligible() {
        assertTrue(nativePlanGuidanceEligible(free()))
        assertFalse(nativePlanGuidanceEligible(FeatureAccess()))
        assertFalse(nativePlanGuidanceEligible(FeatureAccess.unverifiedAccount()))
        assertFalse(nativePlanGuidanceEligible(free().copy(source = "trial")))
        assertFalse(nativePlanGuidanceEligible(free().copy(declaredPlan = "premium", effectivePlan = "premium",
            validUntil = Instant.now().plusSeconds(86_400))))
        assertFalse(nativePlanGuidanceEligible(free().copy(declaredPlan = "premium", effectivePlan = "premium",
            validUntil = Instant.EPOCH))) // Local wall-clock expiry cannot manufacture a canonical Free profile.
        assertFalse(nativePlanGuidanceEligible(free().copy(lifetimePremium = true)))
    }

    @Test fun aShowClaimNeedsACompleteLeaseAndCarriesTheServerClock() {
        val row = JSONObject().put("show", true).put("eligible", true).put("nextAt", JSONObject.NULL)
            .put("token", "a".repeat(48)).put("leaseUntil", "2026-11-06T12:02:00Z").put("serverNow", "2026-11-06T12:00:00Z")
            .put("notice", JSONObject().put("schemaVersion", 1).put("id", "b".repeat(32)).put("topic", "habits")
                .put("reason", "return").put("createdAt", "2026-11-06T12:00:00Z"))
        val claim = PlanGuidanceClaim.fromJson(row)
        assertEquals(Instant.parse("2026-11-06T12:00:00Z"), claim.serverNow)
        assertEquals("return", claim.notice?.reason)
        row.remove("token")
        try { PlanGuidanceClaim.fromJson(row); fail("Incomplete visible lease was accepted") }
        catch (_: IllegalArgumentException) { }
    }

    @Test fun requestsRejectUnknownTopicsResourcesAndImplicitPayments() {
        val valid = PlanGuidanceRequest("projects", "quota", resource = "personal-projects").json()
        assertEquals("personal-projects", valid.getString("resource"))
        assertFalse(valid.has("feature"))
        for (bad in listOf(
            { PlanGuidanceRequest("other-user", "scheduled") },
            { PlanGuidanceRequest("overview", "checkout") },
            { PlanGuidanceRequest("overview", "quota", resource = "invoices") },
            { PlanGuidanceRequest("overview", "feature", feature = "../config") },
        )) {
            try { bad(); fail("Invalid guidance request was accepted") }
            catch (_: IllegalArgumentException) { }
        }
    }
}
