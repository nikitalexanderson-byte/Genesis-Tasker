package ru.genesis.calendar.auth

import org.json.JSONObject

/** Saved input is separate from the acknowledged base; only changed, currently editable IDs go on wire. */
internal class CustomFieldDraft private constructor(val known: Boolean, private val base: JSONObject, private val input: JSONObject) {
    companion object {
        fun fromTask(task: JSONObject): CustomFieldDraft {
            val values = CustomFieldProtocol.fromTask(task)
            return CustomFieldDraft(task.has("customFields"), values, JSONObject(values.toString()))
        }
        fun restore(raw: JSONObject): CustomFieldDraft {
            require(raw.keys().asSequence().toSet() == setOf("version", "known", "base", "input") && raw.opt("version") == 1 && raw.opt("known") is Boolean) { "CUSTOM_FIELD_INVALID" }
            return CustomFieldDraft(raw.getBoolean("known"), CustomFieldProtocol.values(raw.get("base")), CustomFieldProtocol.values(raw.get("input")))
        }
    }
    fun snapshot() = JSONObject().put("version", 1).put("known", known).put("base", JSONObject(base.toString())).put("input", JSONObject(input.toString()))
    fun value(id: String): Any? = input.opt(id)
    fun previous(id: String): Any? = base.opt(id)
    fun change(id: String, value: Any?): CustomFieldDraft {
        CustomFieldProtocol.id(id)
        val next = JSONObject(input.toString()).put(id, value ?: JSONObject.NULL)
        return CustomFieldDraft(known, JSONObject(base.toString()), CustomFieldProtocol.values(next))
    }
    fun reset(id: String): CustomFieldDraft {
        val next = JSONObject(input.toString())
        if (base.has(id)) next.put(id, base.get(id)) else next.remove(id)
        return CustomFieldDraft(known, JSONObject(base.toString()), next)
    }
    fun changedIds(fields: List<JSONObject>): Set<String> {
        val catalog = fields.associateBy { it.getString("id") }
        return (input.keys().asSequence().toSet() + base.keys().asSequence().toSet()).filter { id ->
            val raw = input.opt(id); val old = base.opt(id); val field = catalog[id]
            val value = if (field != null) runCatching { CustomFieldProtocol.normalize(field, raw, old) }.getOrElse { raw } else raw
            !CustomFieldProtocol.equal(value, old)
        }.toSet()
    }
    fun errors(fields: List<JSONObject>): Map<String, String> {
        val failures = linkedMapOf<String, String>()
        if (!known && fields.isNotEmpty()) failures["@snapshot"] = "CUSTOM_FIELD_UNAVAILABLE"
        val changed = changedIds(fields); val catalog = fields.associateBy { it.getString("id") }
        changed.filter { it !in catalog }.forEach { failures[it] = "CUSTOM_FIELD_UNAVAILABLE" }
        fields.forEach { field ->
            val id = field.getString("id")
            if (field.getBoolean("archived")) {
                if (id in changed) failures[id] = "CUSTOM_FIELD_UNAVAILABLE"
            } else try {
                val value = CustomFieldProtocol.normalize(field, input.opt(id), base.opt(id))
                if (field.getBoolean("required") && CustomFieldProtocol.absent(value)) failures[id] = "CUSTOM_FIELD_REQUIRED"
            } catch (failure: Exception) { failures[id] = failure.message?.takeIf { it in CustomFieldProtocol.errors } ?: "CUSTOM_FIELD_VALUE_INVALID" }
        }
        if (changed.size > 200) failures["@snapshot"] = "CUSTOM_FIELD_VALUE_INVALID"
        return failures
    }
    fun patch(fields: List<JSONObject>): JSONObject {
        val failures = errors(fields); require(failures.isEmpty()) { failures.values.first() }
        val catalog = fields.associateBy { it.getString("id") }; val patch = JSONObject()
        changedIds(fields).sorted().forEach { id -> patch.put(id, CustomFieldProtocol.normalize(requireNotNull(catalog[id]), input.opt(id), base.opt(id))) }
        require(patch.toString().toByteArray(Charsets.UTF_8).size <= 800_000) { "CUSTOM_FIELD_VALUE_INVALID" }
        return patch
    }
    /** Explicit rebase preserves the user's changed values, including conflicts requiring a local reset. */
    fun rebase(task: JSONObject, fields: List<JSONObject>): CustomFieldDraft {
        val next = fromTask(task); val merged = JSONObject(next.input.toString())
        changedIds(fields).forEach { id -> merged.put(id, input.opt(id) ?: JSONObject.NULL) }
        return CustomFieldDraft(next.known, next.base, merged)
    }
}
