package ru.genesis.calendar.auth

import kotlinx.coroutines.delay

internal fun e2eeReadRetrySeconds(failure: AuthFailure, retries: Int): Int? =
    failure.retryAfterSeconds?.takeIf {
        failure.kind == AuthFailure.Kind.RATE_LIMIT && failure.httpStatus == 429 && it in 1..600 && retries < 2
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
