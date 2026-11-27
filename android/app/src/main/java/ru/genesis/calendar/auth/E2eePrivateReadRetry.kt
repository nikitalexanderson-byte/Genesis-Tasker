package ru.genesis.calendar.auth

import kotlinx.coroutines.asContextElement
import org.json.JSONObject

private val pollingPrivateTasks = ThreadLocal<Boolean>()

/** Foreground polling releases the edit mutex on 429. Its controller schedules the next attempt. */
internal fun deferPrivateSyncRateWait() = pollingPrivateTasks.asContextElement(true)

/** The account transport is synchronous and is called on its existing IO path.
 * Keep the submitted JSON stable across actual bounded rate waits. Only pure
 * scope discovery, membership snapshots and signed reads retry. Writers and approvals keep separate journals.
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
    if (pollingPrivateTasks.get() == true || path !in setOf("/read", "/directory", "/status", "/membership-graph", "/membership-state")) return request()
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
