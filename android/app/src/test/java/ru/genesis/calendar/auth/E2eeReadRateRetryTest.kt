package ru.genesis.calendar.auth

import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class E2eeReadRateRetryTest {
    @Test fun waitsForTheActualBoundaryWithoutPollingTheServer()=runBlocking {
        var calls=0;var waited=0L
        val value=e2eeReadWithRateRetry(current={},wait={waited+=it}) {
            calls++;if(calls==1)throw AuthFailure(AuthFailure.Kind.RATE_LIMIT,429,173)
            "verified"
        }
        assertEquals("verified",value);assertEquals(2,calls);assertEquals(173000L,waited)
    }
    @Test fun lockDuringBackoffPreventsAnotherRequest()=runBlocking {
        var open=true;var calls=0;var waited=0L
        val failure=runCatching {e2eeReadWithRateRetry(current={check(open){"locked"}},wait={waited+=it;open=false}) {
            calls++;throw AuthFailure(AuthFailure.Kind.RATE_LIMIT,429,600)
        }}.exceptionOrNull()
        assertTrue(failure is IllegalStateException);assertEquals(1,calls);assertEquals(1000L,waited)
    }
    @Test fun missingInvalidOrUnrelatedResponseNeverRetriesAndRetriesAreBounded()=runBlocking {
        for(failure in listOf(AuthFailure(AuthFailure.Kind.RATE_LIMIT,429),AuthFailure(AuthFailure.Kind.RATE_LIMIT,429,601),
            AuthFailure(AuthFailure.Kind.SERVER,503,2),AuthFailure(AuthFailure.Kind.UNAUTHORIZED,403,2))) {
            var calls=0
            assertSame(failure,runCatching {e2eeReadWithRateRetry(current={},wait={fail("Unexpected wait")}){calls++;throw failure}}.exceptionOrNull())
            assertEquals(1,calls)
        }
        var calls=0;var waited=0L;val repeated=AuthFailure(AuthFailure.Kind.RATE_LIMIT,429,2)
        assertSame(repeated,runCatching {e2eeReadWithRateRetry(current={},wait={waited+=it}){calls++;throw repeated}}.exceptionOrNull())
        assertEquals(3,calls);assertEquals(4000L,waited)
    }
}
