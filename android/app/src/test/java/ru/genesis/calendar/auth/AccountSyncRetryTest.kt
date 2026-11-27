package ru.genesis.calendar.auth

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AccountSyncRetryTest {
    @Test fun aSlowDnsFailureLeavesTheNextPollIdle() {
        var elapsed = 43_000L
        val retry = AccountSyncRetry { elapsed }
        retry.connectionFailed("first")
        elapsed = 60_000
        assertTrue(retry.waiting("first"))
        assertFalse(retry.waiting("second"))
        elapsed = 73_000
        assertFalse(retry.waiting("first"))
    }

    @Test fun manualRefreshOrRestoredConnectivityCanRetryImmediately() {
        val retry = AccountSyncRetry { 43_000L }
        retry.connectionFailed("first")
        retry.retryNow("second")
        assertTrue(retry.waiting("first"))
        retry.retryNow("first")
        assertFalse(retry.waiting("first"))
    }
}
