package ru.genesis.calendar.auth

import android.os.SystemClock
import org.json.JSONArray
import org.json.JSONObject
import java.time.Duration
import java.time.Instant

/** Metadata only. A cached/catalog/imported instance is never a trial capability. */
data class TrialAccess(
    val status: String,
    val plan: String?,
    val label: String?,
    val startsAt: Instant?,
    val endsAt: Instant?,
    val serverNow: Instant,
    val eligiblePlans: List<String>,
) {
    fun json(): JSONObject = JSONObject().put("schemaVersion", 1).put("status", status)
        .put("plan", plan ?: JSONObject.NULL).put("label", label ?: JSONObject.NULL)
        .put("startsAt", startsAt?.toString() ?: JSONObject.NULL).put("endsAt", endsAt?.toString() ?: JSONObject.NULL)
        .put("serverNow", serverNow.toString()).put("durationSeconds", DURATION_SECONDS)
        .put("eligiblePlans", JSONArray(eligiblePlans))

    companion object {
        const val DURATION_SECONDS = 259_200L
        val plans = listOf("standart", "premium", "business")
        fun label(plan: String): String = when (plan) {
            "standart" -> "Trial-Standart"
            "premium" -> "Trial-Premium"
            "business" -> "Trial-Business"
            else -> error("Invalid trial plan")
        }
        fun fromJson(value: JSONObject?): TrialAccess? {
            if (value == null) return null
            require(value.get("schemaVersion") is Int && value.getInt("schemaVersion") == 1)
            val duration = value.get("durationSeconds")
            require((duration is Int || duration is Long) && (duration as Number).toLong() == DURATION_SECONDS)
            val status = value.getString("status")
            require(status in setOf("available", "active", "expired", "revoked", "used", "ineligible"))
            fun optional(key: String) = value.optString(key).takeIf { value.has(key) && !value.isNull(key) && it.isNotBlank() }
            val plan = optional("plan"); require(plan == null || plan in plans)
            val providedLabel = optional("label"); require(providedLabel == plan?.let { label(it) })
            val start = optional("startsAt")?.let(Instant::parse)
            val end = optional("endsAt")?.let(Instant::parse)
            require((start == null) == (end == null))
            if (start != null && end != null) require(Duration.between(start, end) == Duration.ofSeconds(DURATION_SECONDS))
            if (status in setOf("active", "expired", "revoked")) require(plan != null && start != null && end != null)
            require((plan == null) == (start == null))
            if (status in setOf("available", "used")) require(plan == null && start == null && end == null)
            val options = value.getJSONArray("eligiblePlans").let { rows -> (0 until rows.length()).map(rows::getString) }
            require(options.distinct() == options && options.all { it in plans })
            require(if (status == "available") options.isNotEmpty() else options.isEmpty())
            return TrialAccess(status, plan, providedLabel, start, end, Instant.parse(value.getString("serverNow")), options)
        }
    }
}

/** Exists only in memory after a real authenticated HTTP profile response. Never serialized. */
class TrialLiveProof internal constructor(
    internal val userId: String,
    private val serverNow: Instant,
    private val requestStartedElapsed: Long,
    private val window: TrialAccess,
    private val current: () -> Boolean,
    private val elapsed: () -> Long = SystemClock::elapsedRealtime,
) {
    internal fun serverTime(): Instant? {
        if (!current()) return null
        val delta = elapsed() - requestStartedElapsed
        if (delta < 0) return null // reboot/invalid clock anchor, never revive a lease
        // ISO-second server timestamps have <=999ms uncertainty. Count the whole request
        // transit and an extra second conservatively, never extend the server cutoff.
        return runCatching { serverNow.plusMillis(delta).plusMillis(1_000) }.getOrNull()
    }
    internal fun remainingMillis(trial: TrialAccess): Long? {
        if (window.status != "active" || trial.status != "active" || window.plan != trial.plan ||
            window.startsAt != trial.startsAt || window.endsAt != trial.endsAt) return null
        val now = serverTime() ?: return null
        if (trial.startsAt?.let(now::isBefore) != false) return null
        val end = trial.endsAt ?: return null
        return runCatching { Duration.between(now, end).toMillis().coerceAtLeast(0) }.getOrNull()
    }
}

internal fun trialPlanRank(plan: String): Int = listOf("free", "standart", "premium", "business", "premium4life")
    .indexOf(plan).coerceAtLeast(0)
