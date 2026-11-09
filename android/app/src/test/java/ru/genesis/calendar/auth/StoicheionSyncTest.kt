package ru.genesis.calendar.auth

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class StoicheionSyncTest {
    @Test fun temporaryReadFailureRecoversOnceWithoutChangingTheRequestOrRequiringSignIn() = runBlocking {
        for (kind in listOf(AuthFailure.Kind.NETWORK, AuthFailure.Kind.SERVER)) {
            var calls = 0
            var pauses = 0
            val value = stoicheionReadWithRetry(pause = { pauses++ }) {
                if (calls++ == 0) throw AuthFailure(kind)
                "unchanged snapshot"
            }
            assertEquals("unchanged snapshot", value)
            assertEquals(2, calls)
            assertEquals(1, pauses)
        }
    }

    @Test fun retriesAreBoundedAndAuthenticationRateLimitsAndInvalidDataAreNeverRetried() = runBlocking {
        for (kind in AuthFailure.Kind.entries) {
            var calls = 0
            try {
                stoicheionReadWithRetry(pause = {}) { calls++; throw AuthFailure(kind) }
                fail("Failure was hidden")
            } catch (error: AuthFailure) { assertEquals(kind, error.kind) }
            assertEquals(if (kind in setOf(AuthFailure.Kind.NETWORK, AuthFailure.Kind.SERVER)) 2 else 1, calls)
        }
        var calls = 0
        try {
            stoicheionReadWithRetry(pause = {}) { calls++; throw CancellationException() }
            fail("Changed account must cancel")
        } catch (_: CancellationException) { assertEquals(1, calls) }
    }
}
