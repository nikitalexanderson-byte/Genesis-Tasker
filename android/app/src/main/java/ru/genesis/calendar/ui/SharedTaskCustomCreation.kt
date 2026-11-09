package ru.genesis.calendar.ui

import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import org.json.JSONObject
import ru.genesis.calendar.data.UiPreferences

/** The temporary identity scopes local input only; it is never included in create fields. */
internal class SharedTaskCustomCreation private constructor(val projectId: String, initial: JSONObject) {
    val source: JSONObject = source(projectId)
    var details by mutableStateOf(JSONObject(initial.toString()))
        private set

    fun change(next: JSONObject) { details = JSONObject(next.toString()) }
    fun reset(preferences: UiPreferences) { details = initialSharedTaskCustom(source, JSONObject(), preferences) }
    fun saved(): String = JSONObject().put("version", 1).put("projectId", projectId).put("details", details).toString()

    /** Empty required inputs are guidance on a new form; an explicit clear still shows its error. Never use this copy for submission. */
    fun presentation(binding: SharedTaskCustomBinding): SharedTaskCustomBinding {
        val input = binding.draft?.snapshot()?.getJSONObject("input") ?: JSONObject()
        return binding.copy(errors = binding.errors.filter { (id, error) -> error != "CUSTOM_FIELD_REQUIRED" || input.has(id) })
    }

    fun fields(binding: SharedTaskCustomBinding): JSONObject {
        require(binding.valid) { binding.error ?: binding.errors.values.firstOrNull() ?: "CUSTOM_FIELD_UNAVAILABLE" }
        val current = sharedTaskCustomDraft(source, details)
        require(current.snapshot().toString() == requireNotNull(binding.draft).snapshot().toString()) { "CUSTOM_FIELD_CONFLICT" }
        val patch = current.patch(binding.fields)
        return JSONObject().apply { if (patch.length() > 0) put("customFields", patch) }
    }

    companion object {
        private fun source(projectId: String) = JSONObject().put("id", "new-task").put("projectId", projectId).put("customFields", JSONObject())
        fun initial(projectId: String, preferences: UiPreferences) = SharedTaskCustomCreation(projectId,
            initialSharedTaskCustom(source(projectId), JSONObject(), preferences))
        fun restore(projectId: String, raw: String): SharedTaskCustomCreation = try {
            require(raw.toByteArray(Charsets.UTF_8).size <= 16_500_000) { "CUSTOM_FIELD_INVALID" }
            val saved = JSONObject(raw)
            require(saved.keys().asSequence().toSet() == setOf("version", "projectId", "details") &&
                saved.opt("version") == 1 && saved.optString("projectId") == projectId) { "CUSTOM_FIELD_UNAVAILABLE" }
            SharedTaskCustomCreation(projectId, saved.getJSONObject("details"))
        } catch (_: Exception) {
            // Keep unreadable input locally until an explicit reset; no automatic empty replacement.
            SharedTaskCustomCreation(projectId, JSONObject().put(SHARED_CUSTOM_DRAFT_KEY,
                JSONObject().put("error", "CUSTOM_FIELD_INVALID")).put("_unreadableCreation", raw))
        }
    }
}

@Composable internal fun rememberSharedTaskCustomCreation(projectId: String, preferences: UiPreferences): SharedTaskCustomCreation =
    rememberSaveable(projectId, saver = Saver<SharedTaskCustomCreation, String>(save = { it.saved() }, restore = { SharedTaskCustomCreation.restore(projectId, it) })) {
        SharedTaskCustomCreation.initial(projectId, preferences)
    }
