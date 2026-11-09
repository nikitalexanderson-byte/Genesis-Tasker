package ru.genesis.calendar.auth

import kotlinx.coroutines.CancellationException
import javax.net.ssl.HttpsURLConnection

/** Lifecycle cancellation disconnects one foreground request without cancelling unrelated sync. */
internal class ForegroundAccountCall(private val foregroundVisit: String) {
    private val guard = Any()
    private var cancelled = false
    private var connection: HttpsURLConnection? = null

    fun attach(value: HttpsURLConnection) = synchronized(guard) {
        if (cancelled || NativeActivityVisit.foregroundVisitId() != foregroundVisit) {
            value.disconnect()
            throw CancellationException("Foreground account visit ended")
        }
        connection = value
    }

    fun cancel() {
        val active = synchronized(guard) { cancelled = true; connection.also { connection = null } }
        active?.disconnect()
    }
}
