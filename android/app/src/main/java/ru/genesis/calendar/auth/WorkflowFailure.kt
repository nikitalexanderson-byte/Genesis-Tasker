package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject

/** Extends AuthFailure so the legacy task outbox's first/replayed rejection handling still runs. */
internal class WorkflowFailure(val code: String, val details: JSONObject, status: Int) :
    AuthFailure(if (status == 409) Kind.CONFLICT else Kind.SERVER, status)

internal fun sharedFailureCode(failure: AuthFailure): String = when (failure) {
    is WorkflowFailure -> failure.code
    is CustomFieldFailure -> failure.code
    else -> failure.kind.name
}

internal fun workflowFailure(status: Int, payload: JSONObject): WorkflowFailure? {
    val code = payload.optString("error")
    if (status !in 400..499 || code !in WorkflowLifecycle.errors) return null
    val details = payload.optJSONObject("details") ?: JSONObject()
    val safe = JSONObject()
    for (key in listOf("statusId", "fromStatusId", "taskId")) {
        val value = details.opt(key)
        if (value is String && PlanningLifecycle.id(value)) safe.put(key, value)
    }
    for (key in listOf("count", "limit")) {
        val value = details.opt(key)
        if ((value is Int || value is Long) && (value as Number).toLong() in 0..Int.MAX_VALUE.toLong()) safe.put(key, value)
    }
    details.optJSONArray("fields")?.let { fields ->
        if (fields.length() <= 208) safe.put("fields", JSONArray((0 until fields.length()).mapNotNull { index ->
            (fields.opt(index) as? String)?.takeIf { it in WorkflowLifecycle.coreFields || it.startsWith("custom:") && PlanningLifecycle.id(it.removePrefix("custom:")) }
        }.distinct()))
    }
    return WorkflowFailure(code, safe, status)
}
