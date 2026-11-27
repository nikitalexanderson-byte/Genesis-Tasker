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

    @Test fun serverDeadlineSurvivesManualRefreshAndOtherAccountFailures() {
        var elapsed = 1_000L
        val retry = AccountSyncRetry { elapsed }
        retry.rateLimited("first", 120)
        elapsed = 5_000
        retry.rateLimited("first", 2)
        retry.connectionFailed("first")
        retry.retryNow("first")
        retry.rateLimited("second", null)
        elapsed = 35_000
        assertFalse(retry.waiting("second"))
        assertTrue(retry.waiting("first"))
        elapsed = 121_000
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
