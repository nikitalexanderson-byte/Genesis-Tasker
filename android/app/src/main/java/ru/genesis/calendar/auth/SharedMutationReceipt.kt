package ru.genesis.calendar.auth

import org.json.JSONObject

/** Only a definite first rejection releases the writer; later rejections keep its original identity. */
internal fun definiteSharedRejection(error: AuthFailure): Boolean = error.httpStatus?.let { it in 400..499 }
    ?: (error.kind in setOf(AuthFailure.Kind.UNAUTHORIZED, AuthFailure.Kind.RATE_LIMIT, AuthFailure.Kind.CONFLICT, AuthFailure.Kind.NOT_DEPLOYED))

/** Do not delete an encrypted pending command merely because an unrelated or incomplete JSON arrived. */
internal fun confirmedSharedReceipt(kind: String, projectId: String, taskId: String?, body: JSONObject, response: JSONObject): JSONObject {
    val task = response.optJSONObject("task")
    val expectedProject = if (kind == "move") body.optString("destinationProjectId").takeIf { it.isNotBlank() && it != "null" } ?: projectId else projectId
    val revision = task?.opt("revision") as? Number
    val valid = task != null && !task.optBoolean("pending") && task.optString("id").isNotBlank() &&
        !task.optString("id").startsWith("pending:") && (taskId == null || task.optString("id") == taskId) &&
        task.optString("projectId") == expectedProject && revision != null && revision.toDouble().isFinite() &&
        revision.toDouble() == revision.toLong().toDouble() && revision.toLong() >= body.optLong("expectedRevision", 0)
    if (!valid) throw AuthFailure(AuthFailure.Kind.PROTOCOL)
    if (body.has("customFields")) {
        val patch = try { CustomFieldProtocol.values(body.get("customFields")) } catch (_: Exception) { throw AuthFailure(AuthFailure.Kind.PROTOCOL) }
        if (patch.length() > 0) CustomFieldProtocol.confirmPatch(patch, requireNotNull(task))
    }
    return response
}
