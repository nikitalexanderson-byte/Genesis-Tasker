package ru.genesis.calendar.auth

import org.json.JSONObject
import java.time.Instant

internal val nativePlanGuidanceTopics = setOf("projects", "habits", "mindmaps", "diary", "dreams", "overview")
internal val nativePlanGuidanceResources = setOf("personal-projects", "habits", "mindmaps", "diary", "shared-projects", "shared-mindmaps", "advice")

internal fun nativePlanGuidanceEligible(access: FeatureAccess): Boolean = access.enforcementEnabled &&
    access.policyRevision !in setOf("unverified-account", "legacy-unrestricted") && access.source != "trial" &&
    !access.trialActive() && access.currentAccess().effectivePlan == "free" && access.currentPlan() == "free"

internal fun nativePlanGuidanceTopic(feature: String?): String = when {
    feature == null -> "overview"
    feature.contains("dream") -> "dreams"
    feature.contains("habit") || feature.contains("rhythm") -> "habits"
    feature.contains("mindmap") -> "mindmaps"
    feature.contains("diary") -> "diary"
    feature.contains("project") || feature.contains("task") || feature.contains("affair") -> "projects"
    else -> "overview"
}

internal data class PlanGuidanceNotice(val id: String, val topic: String, val reason: String,
    val createdAt: Instant, val resource: String?, val feature: String?) {
    companion object {
        fun fromJson(row: JSONObject?): PlanGuidanceNotice? = row?.let { value ->
            require(value.getInt("schemaVersion") == 1)
            val id = value.getString("id").also { require(it.matches(Regex("[a-f0-9]{32}"))) }
            val topic = value.getString("topic").also { require(it in nativePlanGuidanceTopics) }
            val reason = value.getString("reason").also { require(it in setOf("scheduled", "return", "quota", "feature")) }
            PlanGuidanceNotice(id, topic, reason, Instant.parse(value.getString("createdAt")),
                value.optString("resource").takeUnless { !value.has("resource") || value.isNull("resource") },
                value.optString("feature").takeUnless { !value.has("feature") || value.isNull("feature") })
        }
    }
}

internal data class PlanGuidanceRequest(val topic: String, val reason: String,
    val resource: String? = null, val feature: String? = null) {
    init {
        require(topic in nativePlanGuidanceTopics && reason in setOf("scheduled", "quota", "feature"))
        require(resource == null || resource in nativePlanGuidanceResources)
        require(feature == null || feature.matches(Regex("[a-z][a-z0-9-]{0,63}")))
    }
    fun json(): JSONObject = JSONObject().put("topic", topic).put("reason", reason).also {
        if (resource != null) it.put("resource", resource)
        if (feature != null) it.put("feature", feature)
    }
}

internal data class PlanGuidanceClaim(val show: Boolean, val eligible: Boolean, val nextAt: Instant?,
    val notice: PlanGuidanceNotice?, val token: String?, val leaseUntil: Instant?, val serverNow: Instant? = null) {
    companion object {
        fun fromJson(row: JSONObject): PlanGuidanceClaim {
            fun instant(key: String) = row.optString(key).takeUnless { !row.has(key) || row.isNull(key) }?.let(Instant::parse)
            val token = row.optString("token").takeUnless { !row.has("token") || row.isNull("token") }
                ?.also { require(it.matches(Regex("[a-f0-9]{48}"))) }
            val result = PlanGuidanceClaim(row.getBoolean("show"), row.getBoolean("eligible"), instant("nextAt"),
                PlanGuidanceNotice.fromJson(row.optJSONObject("notice")), token, instant("leaseUntil"), instant("serverNow"))
            require(!result.show || result.eligible && result.notice != null && result.token != null && result.leaseUntil != null)
            return result
        }
    }
}
