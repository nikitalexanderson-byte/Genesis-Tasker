package ru.genesis.calendar.auth

import org.json.JSONObject

/** The account transport is synchronous and is called on its existing IO path.
 * Keep the submitted JSON stable across actual bounded rate waits. Only pure
 * scope discovery and signed reads retry; writer/approval journals own mutations.
 */
internal fun e2eePrivateRequestWithRateRetry(
    path: String,
    body: JSONObject?,
    current: () -> Unit,
    wait: (Long) -> Unit = { Thread.sleep(it) },
    send: (JSONObject?) -> JSONObject
): JSONObject {
    current()
    val submitted = body?.toString()
    val request = {
        current()
        send(submitted?.let(::JSONObject)).also { current() }
    }
    if (path !in setOf("/read", "/directory", "/status")) return request()
    var retries = 0
    while (true) {
        current()
        try { return request() }
        catch (failure: AuthFailure) {
            val seconds = e2eeReadRetrySeconds(failure, retries) ?: throw failure
            retries++
            repeat(seconds) { current(); wait(1000); current() }
        }
    }
}
