package ru.genesis.calendar.auth

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AccountSyncRetryTest {
    @Test fun aSlowDnsFailureLeavesTheNextPollIdle() {
        var elapsed = 43_000L
        val retry = AccountSyncRetry({ elapsed }, { true })
        retry.connectionFailed("first")
        elapsed = 60_000
        assertTrue(retry.waiting("first"))
        assertFalse(retry.waiting("second"))
        elapsed = 73_000
        assertFalse(retry.waiting("first"))
    }

    @Test fun serverDeadlineSurvivesManualRefreshAndOtherAccountFailures() {
        var elapsed = 1_000L
        val retry = AccountSyncRetry({ elapsed }, { true })
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
        val retry = AccountSyncRetry({ 43_000L }, { true })
        retry.connectionFailed("first")
        retry.retryNow("second")
        assertTrue(retry.waiting("first"))
        retry.retryNow("first")
        assertFalse(retry.waiting("first"))
    }

    @Test fun anOfflineEditWaitsForConnectivityAndAReconnectHonorsTheServerDeadline() {
        var online = false
        var elapsed = 1_000L
        val retry = AccountSyncRetry({ elapsed }, { online })
        assertTrue(retry.waiting(null))
        assertTrue(retry.waiting("first"))
        retry.retryNow("first")
        assertTrue(retry.waiting("first"))
        online = true
        assertFalse(retry.waiting("first"))
        retry.rateLimited("first", 60)
        online = false
        elapsed = 30_000L
        assertTrue(retry.waiting("first"))
        online = true
        retry.retryNow("first")
        assertTrue(retry.waiting("first"))
        assertFalse(retry.waiting("second"))
        elapsed = 61_000L
        assertFalse(retry.waiting("first"))
    }
}
