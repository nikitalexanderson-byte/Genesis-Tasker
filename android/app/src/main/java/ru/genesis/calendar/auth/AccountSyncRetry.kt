package ru.genesis.calendar.auth

/** Leave one polling interval after a failed connection before contacting the same server again. */
internal class AccountSyncRetry(private val elapsedMillis: () -> Long) {
    private var owner: String? = null
    private var retryAt = 0L

    fun connectionFailed(uid: String) {
        owner = uid
        retryAt = elapsedMillis() + POLL_MILLIS
    }

    fun waiting(uid: String): Boolean = owner == uid && elapsedMillis() < retryAt

    fun retryNow(uid: String) {
        if (owner == uid) owner = null
    }

    companion object {
        const val POLL_MILLIS = 30_000L
    }
}
