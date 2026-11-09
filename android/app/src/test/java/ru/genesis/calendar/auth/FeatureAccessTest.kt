package ru.genesis.calendar.auth

import java.time.Instant
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class FeatureAccessTest {
    private val now = Instant.parse("2026-10-30T00:00:00Z")
    private fun snapshot(plan: String = "premium", lifetime: Boolean = false, until: String? = "2026-11-30T00:00:00Z") =
        JSONObject().put("schemaVersion", 1).put("enforcementEnabled", true).put("declaredPlan", plan)
            .put("effectivePlan", if (lifetime) "business" else plan).put("lifetimePremium", lifetime)
            .put("validUntil", until ?: JSONObject.NULL).put("policyRevision", "synthetic")
            .put("allowedFeatures", org.json.JSONArray(if (lifetime) listOf("tasks", "diary", "teams") else listOf("tasks", "diary")))
            .put("freeFeatures", org.json.JSONArray(listOf("tasks")))

    @Test fun releaseAndLegacyModeNeverLimitFeatures() {
        assertTrue(FeatureAccess.fromJson(null).allows("any-future-feature", now))
        assertTrue(FeatureAccess.fromJson(snapshot().put("enforcementEnabled", false)).allows("any-future-feature", now))
    }
    @Test fun activePaidServerSnapshotGrantsOnlyItsCapabilities() {
        val access = FeatureAccess.fromJson(snapshot())
        assertTrue(access.allows("diary", now)); assertFalse(access.allows("teams", now))
    }
    @Test fun expirationFallsBackToFreeAtExactBoundaryWhileAppRemainsOpen() {
        val access = FeatureAccess.fromJson(snapshot(until = now.toString()))
        assertTrue(access.allows("tasks", now)); assertFalse(access.allows("diary", now))
        assertTrue(access.allows("diary", now.minusSeconds(1)))
    }
    @Test fun ordinaryPlanWithoutVerifiedExpiryDoesNotRetainPaidAccess() {
        assertFalse(FeatureAccess.fromJson(snapshot(until = null)).allows("diary", now))
    }
    @Test fun lifetimeAccessNeedsNoPaymentExpiryAndIncludesBusiness() {
        val access = FeatureAccess.fromJson(snapshot("premium4life", true, null))
        assertTrue(access.allows("diary", now.plusSeconds(10L * 365 * 86400)))
        assertTrue(access.allows("teams", now)); assertFalse(access.allows("unknown", now))
    }
    @Test fun accountSnapshotsAreIndependentAndHaveNoPreferencesWriter() {
        val paid = FeatureAccess.fromJson(snapshot())
        val free = FeatureAccess.fromJson(snapshot("free").put("allowedFeatures", org.json.JSONArray(listOf("tasks"))))
        assertTrue(paid.allows("diary", now)); assertFalse(free.allows("diary", now))
    }
    @Test fun freeGoogleSyncAndAllSixServerAssignedResourceLimitsArePreserved() {
        val resources = listOf("personal-projects", "habits", "mindmaps", "diary", "shared-projects", "shared-mindmaps")
        val freeValues = listOf(5, 5, 1, 100)
        for ((plan, values) in listOf("free" to freeValues, "standart" to listOf(20, 10, 5, 365),
            "premium" to listOf(100, 20, 100, 1000), "business" to listOf(100, 20, 100, 3000, 100, 100),
            "premium4life" to listOf(100, 20, 100, 3000, 100, 100))) {
            val limits = JSONObject(resources.zip(values).toMap())
            val lifetime = plan == "premium4life"
            val collaboration = plan == "business" || lifetime
            val features = listOf("tasks", "diary", "calendar-sync") + if (collaboration) listOf("shared-projects") else emptyList()
            val access = FeatureAccess.fromJson(snapshot(plan, lifetime = lifetime).put("allowedFeatures", org.json.JSONArray(features))
                .put("freeFeatures", org.json.JSONArray(listOf("tasks", "diary", "calendar-sync")))
                .put("limits", limits).put("freeLimits", JSONObject(resources.zip(freeValues).toMap())))
            assertTrue(access.allows("calendar-sync", now)); assertFalse(access.allows("assistant", now))
            assertEquals(collaboration, access.allows("shared-projects", now))
            resources.zip(values).forEach { (resource, value) ->
                assertEquals(value, access.limit(resource, now))
                assertFalse(access.canCreate(resource, value, now))
                if (value > 0) assertTrue(access.canCreate(resource, value - 1, now))
                if (lifetime) assertEquals(value, access.limit(resource, now.plusSeconds(10L * 365 * 86400)))
            }
            if (plan != "free" && !lifetime) resources.zip(freeValues).forEach { (resource, value) ->
                assertEquals(value, access.limit(resource, requireNotNull(access.validUntil)))
            }
            if (plan != "free" && !lifetime) assertFalse(access.allows("shared-projects", requireNotNull(access.validUntil)))
        }
    }
    @Test fun freeAndLegacySnapshotsCannotExportOrImportEvenWhenOldPolicyAllowedIt() {
        assertFalse(FeatureAccess().allows("data-export", now))
        for (enforced in listOf(true, false)) {
            val free = FeatureAccess.fromJson(snapshot("free").put("enforcementEnabled", enforced)
                .put("allowedFeatures", org.json.JSONArray(listOf("data-export")))
                .put("freeFeatures", org.json.JSONArray(listOf("data-export"))))
            assertFalse(free.allows("data-export", now))
            assertThrows(IllegalArgumentException::class.java) { free.requireDataExchange(now) }
        }
    }
    @Test fun portableDataRequiresAnActivePaidGrantIncludingExpiryWhileOpen() {
        for (plan in listOf("standart", "premium", "business", "premium4life")) {
            val access = FeatureAccess.fromJson(snapshot(plan, plan == "premium4life")
                .put("allowedFeatures", org.json.JSONArray(listOf("data-export")))
                .put("freeFeatures", org.json.JSONArray(listOf("data-export"))))
            access.requireDataExchange(now)
            if (plan != "premium4life") assertFalse(access.allows("data-export", requireNotNull(access.validUntil)))
        }
    }
}
