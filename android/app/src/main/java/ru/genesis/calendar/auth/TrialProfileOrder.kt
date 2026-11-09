package ru.genesis.calendar.auth

import java.time.Instant

/** In-memory receipt for a complete, successful authenticated profile response. */
class LiveAccountReceipt internal constructor(
    internal val userId: String,
    internal val proof: TrialLiveProof?,
    private val current: () -> Boolean,
) {
    internal fun isCurrent(): Boolean = current()
}

/** A late old profile cannot supersede a newer paid/revoked profile or revive a terminal window. */
internal class TrialProfileOrder {
    internal data class Stamp(val uid: String, val sequence: Long, val evaluatedAt: Instant?)
    private var sequence = 0L
    private val latest = mutableMapOf<String, Stamp>()
    private val terminal = mutableSetOf<String>()

    @Synchronized fun beginRequest(): Long = ++sequence

    @Synchronized fun accept(uid: String, sequence: Long, evaluatedAt: Instant?, trial: TrialAccess?): Stamp? {
        val previous = latest[uid]
        if (previous != null && (sequence < previous.sequence ||
            previous.evaluatedAt != null && (evaluatedAt == null || evaluatedAt.isBefore(previous.evaluatedAt)))) return null
        val window = trial?.takeIf { it.plan != null && it.startsAt != null && it.endsAt != null }
            ?.let { "$uid:${it.plan}:${it.startsAt}:${it.endsAt}" }
        if (trial?.status == "active" && window != null && window in terminal) return null
        if (trial?.status in setOf("expired", "revoked") && window != null) terminal += window
        return Stamp(uid, sequence, evaluatedAt).also { latest[uid] = it }
    }

    @Synchronized fun isCurrent(stamp: Stamp): Boolean = latest[stamp.uid] === stamp

    @Synchronized fun invalidate() { latest.clear() }
}
