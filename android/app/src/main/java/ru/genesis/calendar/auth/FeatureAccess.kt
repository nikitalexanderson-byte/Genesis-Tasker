package ru.genesis.calendar.auth

import org.json.JSONObject
import java.time.Instant

/** Read-only server entitlement, deliberately separate from preferences and imports. */
data class FeatureAccess(
    val enforcementEnabled: Boolean = false,
    val declaredPlan: String = "free",
    val effectivePlan: String = "free",
    val lifetimePremium: Boolean = false,
    val validUntil: Instant? = null,
    val policyRevision: String = "legacy-unrestricted",
    val allowedFeatures: Set<String> = emptySet(),
    val freeFeatures: Set<String> = emptySet(),
    val disabledFeatures: Set<String> = setOf("assistant"),
    val limits: Map<String, Int?> = emptyMap(),
    val freeLimits: Map<String, Int?> = emptyMap(),
    val dailyAdviceLimit: Int? = null,
    val freeDailyAdviceLimit: Int? = null,
    val evaluatedAt: Instant? = null,
    val source: String? = null,
    val trial: TrialAccess? = null,
    val paidAccess: FeatureAccess? = null,
    internal val trialProof: TrialLiveProof? = null,
    internal val trialRevision: Long = 0,
) {
    /** Only an in-memory live profile proof can make the overlay effective. */
    fun currentAccess(): FeatureAccess = if (source == "trial" && !trialActive())
        paidAccess?.copy(enforcementEnabled = true) ?: failClosedFree() else this

    fun trialRemainingMillis(): Long? = trial?.takeIf { source == "trial" && it.status == "active" }
        ?.let { trialProof?.remainingMillis(it) }

    fun trialActive(): Boolean = source == "trial" && trial?.status == "active" &&
        trialRemainingMillis()?.let { it > 0 } == true

    fun trialPhase(): String? = trial?.let {
        if (it.status != "active") it.status
        else if (source != "trial") {
            if (trialPlanRank(it.plan ?: "free") > trialPlanRank(currentPlan())) "verification-required" else "active"
        } else trialRemainingMillis()?.let { remaining -> if (remaining > 0) "active" else "expired" } ?: "verification-required"
    }

    fun currentPlan(now: Instant = Instant.now()): String {
        val active = currentAccess()
        if (active !== this) return active.currentPlan(now)
        return if (source == "trial" && trialActive()) effectivePlan
        else if (lifetimePremium) "premium4life"
        else if (effectivePlan != "free" && validUntil?.let(now::isBefore) != true) "free" else effectivePlan
    }

    internal fun trialNeedsPayment(now: Instant = Instant.now()): Boolean =
        trial?.status == "expired" && trial.plan?.let { trialPlanRank(it) > trialPlanRank(currentPlan(now)) } == true

    private fun failClosedFree() = copy(enforcementEnabled = true, declaredPlan = "free", effectivePlan = "free",
        lifetimePremium = false, validUntil = null, allowedFeatures = freeFeatures, limits = freeLimits,
        dailyAdviceLimit = freeDailyAdviceLimit, source = null, trialProof = null, paidAccess = null)

    fun allows(feature: String, now: Instant = Instant.now()): Boolean {
        val active = currentAccess()
        if (active !== this) return active.allows(feature, now)
        if (feature in disabledFeatures) return false
        // 3.1.7: old cached policies included portable data on Free. Never retain that grant,
        // including legacy/offline snapshots; regular sync is a separate feature.
        if (feature == "data-export" && !hasActivePaidPlan(now)) return false
        if (!enforcementEnabled) return true
        val expired = source != "trial" && !lifetimePremium && effectivePlan != "free" && (validUntil == null || !now.isBefore(validUntil))
        return feature in if (expired) freeFeatures else allowedFeatures
    }

    private fun hasActivePaidPlan(now: Instant): Boolean =
        effectivePlan in setOf("standart", "premium", "business", "premium4life") &&
            (if (source == "trial") trialActive() else lifetimePremium || validUntil?.let(now::isBefore) == true)

    fun requireDataExchange(now: Instant = Instant.now()) {
        require(allows("data-export", now)) { "FEATURE_SUBSCRIPTION_REQUIRED" }
    }

    fun limit(resource: String, now: Instant = Instant.now()): Int? {
        val active = currentAccess()
        if (active !== this) return active.limit(resource, now)
        if (!enforcementEnabled) return null
        val expired = source != "trial" && !lifetimePremium && effectivePlan != "free" && (validUntil == null || !now.isBefore(validUntil))
        return (if (expired) freeLimits else limits)[resource]
    }

    fun canCreate(resource: String, currentCount: Int, now: Instant = Instant.now()): Boolean =
        limit(resource, now)?.let { currentCount < it } ?: true

    fun json(): JSONObject = JSONObject().put("schemaVersion",1).put("policyRevision",policyRevision)
        .put("enforcementEnabled",enforcementEnabled).put("declaredPlan",declaredPlan).put("effectivePlan",effectivePlan)
        .put("lifetimePremium",lifetimePremium).put("validUntil",validUntil?.toString() ?: JSONObject.NULL)
        .put("evaluatedAt",evaluatedAt?.toString() ?: JSONObject.NULL).put("allowedFeatures",org.json.JSONArray(allowedFeatures.toList()))
        .put("freeFeatures",org.json.JSONArray(freeFeatures.toList())).put("disabledFeatures",org.json.JSONArray(disabledFeatures.toList()))
        .put("limits",JSONObject(limits)).put("freeLimits",JSONObject(freeLimits))
        .put("adviceDailyLimit",dailyAdviceLimit ?: JSONObject.NULL).put("freeAdviceDailyLimit",freeDailyAdviceLimit ?: JSONObject.NULL)
        .put("source",source ?: JSONObject.NULL).put("trial",trial?.json() ?: JSONObject.NULL)
        .put("paidAccess",paidAccess?.json() ?: JSONObject.NULL)

    companion object {
        /** No verified account policy: preserve data, but never grant paid growth from a missing cache. */
        fun unverifiedAccount(): FeatureAccess = FeatureAccess(enforcementEnabled = true,
            policyRevision = "unverified-account", allowedFeatures = setOf("calendar", "calendar-sync", "tasks"),
            freeFeatures = setOf("calendar", "calendar-sync", "tasks"),
            limits = listOf("personal-projects", "habits", "mindmaps", "diary", "shared-projects", "shared-mindmaps").associateWith { 0 },
            freeLimits = listOf("personal-projects", "habits", "mindmaps", "diary", "shared-projects", "shared-mindmaps").associateWith { 0 })

        fun fromJson(value: JSONObject?, proof: TrialLiveProof? = null): FeatureAccess {
            // Ordinary legacy/paid payloads retain compatibility. Trial-shaped failures never do.
            if (value == null) return FeatureAccess()
            return try { decode(value, proof) } catch (failure: Exception) {
                val hasTrial = value.has("trial") && !value.isNull("trial") || value.has("paidAccess") && !value.isNull("paidAccess") ||
                    value.optString("source").let { it.isNotBlank() && it != "null" && it !in setOf("subscription") }
                if (!hasTrial) throw failure
                val baseline = value.optJSONObject("paidAccess")
                val paid = baseline?.takeIf { purePaidPayload(it) }
                    ?.let { runCatching { decode(it, null) }.getOrNull() }
                val subscription = if (value.optString("source") == "subscription" &&
                    (!value.has("paidAccess") || value.isNull("paidAccess"))) runCatching {
                        val clean = JSONObject(value.toString()).put("trial", JSONObject.NULL)
                        decode(clean, null)
                    }.getOrNull() else null
                (paid ?: subscription)?.copy(enforcementEnabled = true, trialProof = null) ?: unverifiedAccount()
            }
        }

        private fun purePaidPayload(value: JSONObject): Boolean =
            (!value.has("source") || value.isNull("source") || value.optString("source") == "subscription") &&
                (!value.has("trial") || value.isNull("trial")) && (!value.has("paidAccess") || value.isNull("paidAccess"))

        private fun decode(value: JSONObject, proof: TrialLiveProof?): FeatureAccess {
            require(value.getInt("schemaVersion") == 1) { "Unsupported feature access contract" }
            fun strings(key: String): Set<String> = value.getJSONArray(key).let { array ->
                (0 until array.length()).map { array.getString(it) }.toSet()
            }
            fun limits(key: String): Map<String, Int?> = value.optJSONObject(key)?.let { source ->
                source.keys().asSequence().associateWith { resource ->
                    if (source.isNull(resource)) null else source.get(resource).let { raw ->
                        require(raw is Int || raw is Long) { "Invalid quota" }
                        (raw as Number).toLong().also { require(it in 0..1_000_000L) }.toInt()
                    }
                }
            } ?: emptyMap()
            val source = value.optString("source").takeIf { !value.isNull("source") && it.isNotBlank() }
            require(source == null || source in setOf("subscription", "trial")) { "Unknown entitlement source" }
            // Never reinterpret a malformed trial as an ordinary wall-clock-based paid grant.
            require(!value.has("trial") || value.isNull("trial") || value.get("trial") is JSONObject)
            require(!value.has("paidAccess") || value.isNull("paidAccess") || value.get("paidAccess") is JSONObject)
            val plans = setOf("free", "standart", "premium", "business", "premium4life")
            require(value.getString("declaredPlan") in plans && value.getString("effectivePlan") in plans)
            val trial = TrialAccess.fromJson(value.optJSONObject("trial"))
            require(trial == null || source != null) { "Missing trial entitlement source" }
            val paid = value.optJSONObject("paidAccess")?.let { baseline ->
                require(purePaidPayload(baseline))
                decode(baseline, null)
            }
            require(paid == null || source == "trial") { "Baseline outside trial overlay" }
            if (source == "subscription") {
                val declared = value.getString("declaredPlan")
                val effective = value.getString("effectivePlan")
                require(if (value.getBoolean("lifetimePremium")) declared == "premium4life" && effective == "business"
                    else declared != "premium4life" && (effective == "free" || effective == declared))
            }
            if (source == "trial") {
                require(trial?.status == "active" && trial.plan == value.getString("effectivePlan"))
                require(!value.getBoolean("lifetimePremium") && paid != null)
                require(value.getString("validUntil") == trial.endsAt.toString())
                val paidPlan = if (paid.lifetimePremium) "premium4life" else paid.effectivePlan
                require(trialPlanRank(requireNotNull(trial.plan)) > trialPlanRank(paidPlan))
            }
            return FeatureAccess(value.getBoolean("enforcementEnabled"), value.getString("declaredPlan"),
                value.getString("effectivePlan"), value.getBoolean("lifetimePremium"),
                value.optString("validUntil").takeIf { !value.isNull("validUntil") && it.isNotBlank() }?.let(Instant::parse),
                value.getString("policyRevision"), strings("allowedFeatures"), strings("freeFeatures"),
                if (value.has("disabledFeatures")) strings("disabledFeatures") else setOf("assistant"), limits("limits"), limits("freeLimits"),
                value.optInt("adviceDailyLimit").takeUnless { value.isNull("adviceDailyLimit") },
                value.optInt("freeAdviceDailyLimit").takeUnless { value.isNull("freeAdviceDailyLimit") },
                value.optString("evaluatedAt").takeIf { value.has("evaluatedAt") && !value.isNull("evaluatedAt") && it.isNotBlank() }?.let(Instant::parse),
                source, trial, paid, proof)
        }
    }
}
