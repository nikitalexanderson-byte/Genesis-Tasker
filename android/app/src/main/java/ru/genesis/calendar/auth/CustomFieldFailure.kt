package ru.genesis.calendar.auth

import org.json.JSONObject

/** Keeps first/replayed task rejection behavior in the existing AuthFailure outbox path. */
internal class CustomFieldFailure(val code: String, status: Int) : AuthFailure(if (status == 409) Kind.CONFLICT else Kind.SERVER, status)

internal fun customFieldFailure(status: Int, payload: JSONObject): CustomFieldFailure? {
    val code = payload.optString("error")
    return if (status in 400..499 && status !in setOf(401, 403, 404, 405, 429) && code in CustomFieldProtocol.errors) CustomFieldFailure(code, status) else null
}
