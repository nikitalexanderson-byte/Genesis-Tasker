package ru.genesis.calendar.auth

/** Leave one polling interval after a failed connection before contacting the same server again. */
internal class AccountSyncRetry(private val elapsedMillis: () -> Long) {
    private var owner: String? = null
    private var retryAt = 0L
    private val serverLimits = mutableMapOf<String, Long>()

    fun connectionFailed(uid: String) {
        owner = uid
        retryAt = elapsedMillis() + POLL_MILLIS
    }

    fun rateLimited(uid: String, seconds: Int?) {
        val now = elapsedMillis()
        serverLimits.entries.removeAll { it.value <= now }
        val wait = seconds?.takeIf { it > 0 }?.times(1000L) ?: POLL_MILLIS
        serverLimits[uid] = maxOf(serverLimits[uid] ?: 0L, now + wait)
    }

    fun waiting(uid: String): Boolean {
        val now = elapsedMillis()
        return (owner == uid && now < retryAt) || now < (serverLimits[uid] ?: 0L)
    }

    fun retryNow(uid: String) {
        if (owner == uid) owner = null
    }

    companion object {
        const val POLL_MILLIS = 30_000L
    }
}
