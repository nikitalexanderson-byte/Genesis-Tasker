package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class TrialAccessTest {
    private val start = Instant.parse("2026-11-03T10:00:00Z")
    private val end = start.plusSeconds(TrialAccess.DURATION_SECONDS)
    private var elapsed = 1_000L
    private var foreground = true
    private fun meta(plan: String = "premium") = TrialAccess("active", plan, TrialAccess.label(plan),
        start, end, start, emptyList())
    private fun paid(plan: String = "free", until: Instant? = null) = FeatureAccess(
        enforcementEnabled = true, declaredPlan = plan, effectivePlan = plan, validUntil = until,
        lifetimePremium = plan == "premium4life", policyRevision = "test",
        allowedFeatures = if (plan == "free") setOf("tasks") else setOf("tasks", "habit-timer", "data-export"),
        freeFeatures = setOf("tasks"), limits = mapOf("mindmaps" to if (plan == "free") 3 else 20),
        freeLimits = mapOf("mindmaps" to 3), evaluatedAt = start)
    private fun wire(plan: String = "premium", baseline: FeatureAccess = paid()) =
        paid(plan, end).copy(declaredPlan = baseline.declaredPlan, source = "trial", trial = meta(plan), paidAccess = baseline,
            allowedFeatures = setOf("tasks", "habit-timer", "data-export", "diary"),
            limits = mapOf("mindmaps" to 100)).json()
    private fun proof(server: Instant = start, requestStart: Long = 1_000L, plan: String = "premium") =
        TrialLiveProof("fixture", server, requestStart, meta(plan), { foreground }, { elapsed })

    @Test fun selectedTrialHasExactlyOneServerWindowAndNoExtraPaidIds() {
        for (plan in TrialAccess.plans) {
            val access = FeatureAccess.fromJson(wire(plan), proof(plan = plan))
            assertEquals(plan, access.currentPlan(start))
            assertEquals("Trial-" + when(plan) { "standart" -> "Standart"; "premium" -> "Premium"; else -> "Business" }, access.trial!!.label)
            assertTrue(access.allows("data-export", start))
            assertEquals(100, access.limit("mindmaps", start))
        }
        assertEquals(listOf("standart", "premium", "business"), TrialAccess.plans)
    }

    @Test fun wallClockRollbackAndForwardCannotChangeLiveTrialDeadline() {
        val access = FeatureAccess.fromJson(wire(), proof())
        assertTrue(access.allows("diary", Instant.parse("2099-01-01T00:00:00Z")))
        elapsed += TrialAccess.DURATION_SECONDS * 1_000 - 1_000
        assertFalse(access.allows("diary", Instant.parse("1970-01-01T00:00:00Z")))
        assertEquals("expired", access.trialPhase())
        assertEquals(3, access.limit("mindmaps", start))
    }

    @Test fun requestStartAndIsoSecondSafetyNeverAddNetworkTime() {
        val access = FeatureAccess.fromJson(wire(), proof(end.minusSeconds(2)))
        assertEquals(1_000L, access.trialRemainingMillis())
        elapsed = 1_999
        assertTrue(access.trialActive())
        elapsed = 2_000
        assertFalse(access.trialActive())
        assertEquals(0L, access.trialRemainingMillis())
    }

    @Test fun cachedOrImportedJsonCannotReconstituteALiveLease() {
        val live = FeatureAccess.fromJson(wire(), proof())
        assertTrue(live.trialActive())
        val serialized = live.json()
        assertEquals(start.toString(), serialized.getString("evaluatedAt"))
        assertFalse(serialized.has("trialProof"))
        val cached = FeatureAccess.fromJson(JSONObject(serialized.toString()))
        assertFalse(cached.allows("diary", start))
        assertEquals("verification-required", cached.trialPhase())
        assertEquals(3, cached.limit("mindmaps", start))
        assertEquals(meta(), cached.trial)
    }

    @Test fun foregroundGenerationRevocationRequiresANewProofAndKeepsPaidBaseline() {
        val access = FeatureAccess.fromJson(wire(baseline = paid("standart", end.plusSeconds(100))), proof())
        assertTrue(access.allows("diary", start))
        foreground = false
        assertFalse(access.allows("diary", start))
        assertTrue(access.allows("habit-timer", start))
        assertEquals("standart", access.currentPlan(start))
        val restarted = FeatureAccess.fromJson(access.json())
        assertFalse(restarted.trialActive())
        assertTrue(restarted.allows("data-export", start))
    }

    @Test fun elapsedClockResetCannotReopenTrial() {
        val access = FeatureAccess.fromJson(wire(), proof())
        elapsed = 0
        assertFalse(access.trialActive())
        assertEquals("verification-required", access.trialPhase())
    }

    @Test fun expiryReturnsToOwnPaidExpiryWithoutExtendingIt() {
        val access = FeatureAccess.fromJson(wire(baseline = paid("standart", end.minusSeconds(1))), proof())
        elapsed += TrialAccess.DURATION_SECONDS * 1_000
        assertFalse(access.allows("habit-timer", end))
        assertFalse(access.allows("data-export", end))
        assertEquals("free", access.currentPlan(end))
        assertTrue(access.allows("tasks", end))
    }

    @Test fun malformedTrialsFailClosedButDoNotEraseValidPaidGrant() {
        val baseline = paid("standart", end.plusSeconds(100))
        val variants = listOf<(JSONObject) -> Unit>(
            { it.getJSONObject("trial").put("plan", "premium4life") },
            { it.getJSONObject("trial").put("durationSeconds", 259_201) },
            { it.getJSONObject("trial").put("durationSeconds", "259200") },
            { it.getJSONObject("trial").put("endsAt", end.plusSeconds(1).toString()) },
            { it.put("source", "trial-unknown") },
            { it.remove("source") },
            { it.put("source", "subscription") },
            { it.remove("trial") },
            { it.put("validUntil", "2099-01-01T00:00:00Z") },
        )
        for (mutate in variants) {
            val value = wire(baseline = baseline).also(mutate)
            val access = FeatureAccess.fromJson(value, proof())
            assertFalse(access.trialActive())
            assertFalse(access.allows("diary", start))
            assertTrue(access.allows("habit-timer", start))
        }
        val noBaseline = wire().put("trial", JSONObject()).put("paidAccess", JSONObject.NULL)
        assertFalse(FeatureAccess.fromJson(noBaseline, proof()).allows("diary", start))
    }

    @Test fun equalOrHigherPaidCannotBeDowngradedByMalformedOverlay() {
        val business = paid("business", end.plusSeconds(1))
        val access = FeatureAccess.fromJson(wire("business", business), proof())
        assertEquals("business", access.currentPlan(start))
        assertFalse(access.trialActive())
        val alreadyPaid = business.copy(trial = meta().copy(status = "expired"))
        assertFalse(alreadyPaid.trialNeedsPayment(start))
    }

    @Test fun ordinaryPaidOfflineBehaviorRemainsAvailable() {
        val original = paid("standart", end.plusSeconds(100))
        val cached = FeatureAccess.fromJson(original.json())
        assertTrue(cached.allows("habit-timer", start))
        assertTrue(cached.allows("data-export", start))
        assertFalse(cached.allows("habit-timer", end.plusSeconds(100)))
    }

    @Test fun malformedOrNestedBaselineNeverGrantsPaidFeatures() {
        for (change in listOf<(JSONObject) -> Unit>(
            { it.put("source", "trial") }, { it.put("effectivePlan", "unknown") },
            { it.put("paidAccess", paid("business", end).json()) }, { it.put("trial", meta().json()) },
        )) {
            val value = wire().also { change(it.getJSONObject("paidAccess")) }
            assertFalse(FeatureAccess.fromJson(value, proof()).allows("diary", start))
            assertFalse(FeatureAccess.fromJson(value, proof()).allows("data-export", start))
        }
    }

    @Test fun proofCannotBeReusedForAnotherPlanOrWindow() {
        assertFalse(FeatureAccess.fromJson(wire("business"), proof()).trialActive())
        val shifted = wire().also {
            val metadata = it.getJSONObject("trial")
            metadata.put("startsAt", start.plusSeconds(10).toString())
            metadata.put("endsAt", end.plusSeconds(10).toString())
            it.put("validUntil", end.plusSeconds(10).toString())
        }
        assertFalse(FeatureAccess.fromJson(shifted, proof()).trialActive())
    }

    @Test fun subscriptionSourcePreservesRealPaidAccessAndTerminalTrialMetadata() {
        val original = paid("business", end.plusSeconds(100)).copy(source = "subscription", trial = meta().copy(status = "expired"))
        val parsed = FeatureAccess.fromJson(original.json())
        assertEquals("business", parsed.currentPlan(start))
        assertFalse(parsed.trialActive())
        assertFalse(parsed.trialNeedsPayment(start))
        assertEquals("expired", parsed.trialPhase())
    }

    @Test fun fullProfileRequiresTheSameAccountAndImmutableWindow() {
        fun response(): JSONObject {
            val user = JSONObject().put("uid", "fixture")
                .put("googleAccounts", JSONArray().put(JSONObject().put("id", "fixture")
                    .put("email", "fixture@example.invalid").put("isPrimary", true)))
                .put("syncRouting", JSONObject().put("mode", "fixed").put("defaultAccountIds", JSONArray().put("fixture"))
                    .put("categoryAccountIds", JSONObject()))
                .put("trial", meta().json()).put("featureAccess", wire(baseline = paid("standart", end.plusSeconds(100))))
            return JSONObject().put("user", user)
        }
        assertTrue(requireNotNull(AccountSettings.fromResponse(response(), proof())).featureAccess.trialActive())
        val secondBoundary = response().also { it.getJSONObject("user").getJSONObject("trial").put("serverNow", start.plusSeconds(1).toString()) }
        assertTrue(requireNotNull(AccountSettings.fromResponse(secondBoundary, proof())).featureAccess.trialActive())
        val variants = listOf<(JSONObject) -> Unit>(
            { it.put("uid", "another-account") }, { it.remove("trial") }, { it.put("trial", "malformed") },
            { it.getJSONObject("trial").put("plan", "business").put("label", "Trial-Business") },
        )
        for (change in variants) {
            val value = response().also { change(it.getJSONObject("user")) }
            val account = requireNotNull(AccountSettings.fromResponse(value, proof()))
            assertFalse(account.featureAccess.trialActive())
            assertTrue(account.featureAccess.allows("habit-timer", start))
        }
        val missingAccess = response().also { it.getJSONObject("user").remove("featureAccess") }
        assertFalse(requireNotNull(AccountSettings.fromResponse(missingAccess, proof())).featureAccess.allows("diary", start))
    }

    @Test fun damagedTrialExplanationCannotEraseAnOtherwiseValidPaidSubscription() {
        val subscription = paid("standart", end.plusSeconds(100)).copy(source = "subscription").json().put("trial", JSONObject())
        val access = FeatureAccess.fromJson(subscription)
        assertEquals("standart", access.currentPlan(start))
        assertTrue(access.allows("data-export", start))
        val malformedOverlay = wire().put("source", "subscription").also { it.remove("paidAccess") }
        assertFalse(FeatureAccess.fromJson(malformedOverlay, proof()).allows("diary", start))
    }

    @Test fun onlyExplicitPostTrialRouteIsAllowed() {
        assertTrue(allowedBillingRoute("POST", "/billing/trial"))
        assertFalse(allowedBillingRoute("GET", "/billing/trial"))
        assertFalse(allowedBillingRoute("DELETE", "/billing/trial"))
        assertFalse(allowedBillingRoute("POST", "/billing/trial/elite"))
    }

    @Test fun localCutoffCannotShowPaymentBeforeServerConfirmsExpiry() {
        val access = FeatureAccess.fromJson(wire(), proof())
        elapsed += TrialAccess.DURATION_SECONDS * 1_000
        assertFalse(access.trialActive())
        assertEquals("expired", access.trialPhase())
        assertFalse(access.trialNeedsPayment(end))
        val confirmed = paid().copy(source = "subscription", trial = meta().copy(status = "expired", serverNow = end))
        assertTrue(confirmed.trialNeedsPayment(end))
    }
}
