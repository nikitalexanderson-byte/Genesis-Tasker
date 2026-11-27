package ru.genesis.calendar.auth

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class E2eePrivateReadRetryTest {
    @Test fun allPureDiscoveryRoutesRetryTheSameSubmittedJson() {
        for (path in listOf("/read", "/directory", "/status", "/membership-graph", "/membership-state")) {
            val original = if (path == "/status") null else JSONObject().put("scopeId", "owned-scope").put("nonce", "unchanged")
            var calls = 0
            var waited = 0L
            val sent = mutableListOf<String?>()
            val value = e2eePrivateRequestWithRateRetry(path, original, current = {}, wait = {
                waited += it
                original?.put("nonce", "edited-during-wait")
            }) { body ->
                sent += body?.toString()
                calls++
                if (calls == 1) {
                    body?.put("nonce", "edited-by-transport")
                    throw AuthFailure(AuthFailure.Kind.RATE_LIMIT, 429, 2)
                }
                JSONObject().put("verified", true)
            }
            assertTrue(value.getBoolean("verified"))
            assertEquals(2, calls)
            assertEquals(2000L, waited)
            assertEquals(sent[0], sent[1])
            assertFalse(sent.filterNotNull().any { it.contains("edited-") })
        }
    }

    @Test fun mutationsDoNotRetryAndAClosingOwnerPreventsTheNextRead() {
        for (path in listOf("/command", "/challenge", "/bootstrap", "/membership", "/membership-atomic-commit")) {
            var calls = 0
            val expected = AuthFailure(AuthFailure.Kind.RATE_LIMIT, 429, 2)
            val error = runCatching {
                e2eePrivateRequestWithRateRetry(path, JSONObject(), current = {}, wait = { fail("Mutation waited") }) {
                    calls++
                    throw expected
                }
            }.exceptionOrNull()
            assertSame(expected, error)
            assertEquals(1, calls)
        }
        var open = true
        var calls = 0
        val error = runCatching {
            e2eePrivateRequestWithRateRetry("/directory", JSONObject(), current = { check(open) { "E2EE_UNLOCK_REQUIRED" } }, wait = { open = false }) {
                calls++
                throw AuthFailure(AuthFailure.Kind.RATE_LIMIT, 429, 600)
            }
        }.exceptionOrNull()
        assertEquals("E2EE_UNLOCK_REQUIRED", error?.message)
        assertEquals(1, calls)
    }

    @Test fun periodicSyncReleasesTheWriterWithoutSleepingOnRateLimit() = kotlinx.coroutines.runBlocking {
        val refusal = AuthFailure(AuthFailure.Kind.RATE_LIMIT, 429, 120)
        var calls = 0
        val error = kotlinx.coroutines.withContext(deferPrivateSyncRateWait() + kotlinx.coroutines.Dispatchers.IO) {
            runCatching {
                e2eePrivateRequestWithRateRetry("/read", JSONObject(), {}, wait = { fail("Held the edit lock while waiting") }) {
                    calls++
                    throw refusal
                }
            }.exceptionOrNull()
        }
        assertSame(refusal, error)
        assertEquals(1, calls)
    }

    @Test fun aResponseFromARetiredRequestGenerationIsNotReturned() {
        var current = true
        val error = runCatching {
            e2eePrivateRequestWithRateRetry("/status", null, current = { check(current) { "E2EE_ACCOUNT_CHANGED" } }) {
                current = false
                JSONObject().put("untrusted", true)
            }
        }.exceptionOrNull()
        assertEquals("E2EE_ACCOUNT_CHANGED", error?.message)
    }
}
