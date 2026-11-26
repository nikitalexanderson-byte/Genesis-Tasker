package ru.genesis.calendar.auth

import kotlinx.coroutines.delay

private const val MAX_READ_RATE_RETRIES = 2
private const val MAX_RETRY_AFTER_SECONDS = 600
internal const val E2EE_SIGNED_READ_RATE_WAIT_MILLIS = MAX_READ_RATE_RETRIES * MAX_RETRY_AFTER_SECONDS * 1000L

internal fun e2eeReadRetrySeconds(failure: AuthFailure, retries: Int): Int? =
    failure.retryAfterSeconds?.takeIf {
        failure.kind == AuthFailure.Kind.RATE_LIMIT && failure.httpStatus == 429 && it in 1..MAX_RETRY_AFTER_SECONDS && retries < MAX_READ_RATE_RETRIES
    }

/** Only an unobserved, signed read may wait and retry here. Legacy source
 * observation and mutation custody keep their own immutable request journals. */
internal suspend fun <T> e2eeReadWithRateRetry(
    current: () -> Unit,
    wait: suspend (Long) -> Unit = { delay(it) },
    request: suspend () -> T
): T {
    var retries=0
    while(true) {
        current()
        try {return request().also{current()}}
        catch(failure:AuthFailure) {
            val seconds=e2eeReadRetrySeconds(failure,retries)?:throw failure
            retries++
            // Check lock/owner/generation throughout a potentially long server
            // backoff, without occupying an IO thread or sending more requests.
            repeat(seconds) {current();wait(1000);current()}
        }
    }
}
