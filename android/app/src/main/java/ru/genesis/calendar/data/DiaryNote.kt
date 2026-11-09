package ru.genesis.calendar.data

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.util.UUID

/** A defensive JSON model preserves future optional fields and the original advice/source snapshot. */
internal class DiaryNote private constructor(private val source: String) {
    private val value = JSONObject(source)
    val id: String = value.getString("id")
    val title: String = value.getString("title")
    val body: String = value.getString("body")
    val color: String = value.getString("color")
    val customColor: String? = value.opt("customColor") as? String
    val createdAt: String = value.getString("createdAt")
    val updatedAt: String = value.getString("updatedAt")
    val archived: Boolean = value.getBoolean("archived")
    val pinned: Boolean = value.getBoolean("pinned")
    val reaction: String? = value.opt("reaction") as? String
    val dreamDay: String? = value.optJSONObject("dream")?.getString("day")
    val dreamTimeZone: String? = value.optJSONObject("dream")?.getString("timeZone")
    val lucid: Boolean = value.optJSONObject("dream")?.optBoolean("lucid") == true
    val adviceId: String? = value.optJSONObject("advice")?.getString("id")
    /** A display grouping derived from provenance; never persisted or inferred from the text. */
    val category: String? get() = when {
        dreamDay != null -> null
        adviceId != null -> "saved"
        else -> "personal"
    }
    fun json(): JSONObject = JSONObject(source)
    fun changed(update: JSONObject.() -> Unit): DiaryNote = parse(json().apply(update).put("updatedAt", Instant.now().toString()))
    fun restored(): DiaryNote = changed { put("archived", false); if (reaction == "dislike") put("reaction", JSONObject.NULL) }
    fun asCopy(copyId: String = UUID.randomUUID().toString()): DiaryNote = changed {
        put("id", copyId); put("createdAt", Instant.now().toString())
        put("archived", false); put("reaction", JSONObject.NULL); remove("advice")
    }
    fun sameContent(other: DiaryNote): Boolean = canonical(json().put("updatedAt", "")) == canonical(other.json().put("updatedAt", ""))
    override fun toString() = "DiaryNote([redacted])"

    companion object {
        val colors = listOf("sage", "sand", "rose", "sky")
        val idPattern = Regex("[A-Za-z0-9_-]{1,100}")
        fun newDraftJson(): JSONObject {
            val now = Instant.now().toString()
            return JSONObject().put("version", 1).put("id", UUID.randomUUID().toString())
                .put("title", "").put("body", "").put("color", "sage").put("createdAt", now).put("updatedAt", now)
                .put("archived", false).put("pinned", false).put("reaction", JSONObject.NULL)
        }
        fun create(body: String, title: String = ""): DiaryNote = parse(newDraftJson().put("body", body).put("title", title))
        fun parse(input: JSONObject): DiaryNote {
            require(input.opt("version") is Number && input.getDouble("version") == 1.0) { "DIARY_UNKNOWN_SCHEMA" }
            fun text(key: String, max: Int): String = (input.opt(key) as? String).also { require(it != null && it.length <= max) { "DIARY_INVALID_NOTE" } }!!
            require(idPattern.matches(text("id", 100))) { "DIARY_INVALID_NOTE" }
            text("title", 200); require(text("body", 30_000).isNotBlank()) { "DIARY_INVALID_NOTE" }
            require(text("color", 10) in colors && validDate(input.opt("createdAt")) && validDate(input.opt("updatedAt"))) { "DIARY_INVALID_NOTE" }
            require(!input.has("customColor") || input.isNull("customColor") ||
                (input.opt("customColor") as? String)?.matches(Regex("#[a-fA-F0-9]{6}")) == true) { "DIARY_INVALID_NOTE" }
            require(input.opt("archived") is Boolean && input.opt("pinned") is Boolean && input.has("reaction")) { "DIARY_INVALID_NOTE" }
            val reaction = input.opt("reaction")
            require((reaction == JSONObject.NULL || reaction in listOf("favorite", "dislike")) && (reaction != "dislike" || input.getBoolean("archived"))) { "DIARY_INVALID_NOTE" }
            input.optJSONObject("dream")?.let { dream ->
                require(!input.has("advice") && dream.getString("day") == LocalDate.parse(dream.getString("day")).toString()) { "DREAM_INVALID_DATE" }
                java.time.ZoneId.of(dream.getString("timeZone"))
                require(!dream.has("lucid") || dream.opt("lucid") is Boolean) { "DREAM_INVALID_NOTE" }
            }
            if (input.has("advice") && !input.isNull("advice")) validateAdvice(input.getJSONObject("advice"))
            return DiaryNote(input.toString())
        }
        fun validateAdvice(advice: JSONObject) {
            require(advice.opt("id") is String && advice.getString("id").isNotEmpty() && advice.opt("body") is String &&
                advice.opt("language") is String && advice.opt("categories") is JSONArray && advice.opt("sources") is JSONArray) { "DIARY_INVALID_ADVICE" }
            val sources = advice.getJSONArray("sources")
            for (i in 0 until sources.length()) {
                val source = sources.getJSONObject(i)
                require(source.opt("work") is String && source.optString("kind") in setOf("quote", "inspired")) { "DIARY_INVALID_ADVICE" }
            }
        }
        fun reaction(advice: JSONObject, id: String, reaction: String, previous: DiaryNote? = null): DiaryNote {
            require(reaction in setOf("favorite", "dislike")); validateAdvice(advice)
            val base = previous?.json() ?: newDraftJson().put("id", id).put("body", advice.getString("body"))
                .put("title", advice.optString("title").take(200)).put("advice", JSONObject(advice.toString()))
            base.put("reaction", if (previous?.reaction == reaction) JSONObject.NULL else reaction)
                .put("archived", reaction == "dislike" && previous?.reaction != "dislike").put("updatedAt", Instant.now().toString())
            return parse(base)
        }
        internal fun validDate(value: Any?): Boolean = value is String && (runCatching { Instant.parse(value) }.isSuccess ||
            runCatching { OffsetDateTime.parse(value) }.isSuccess || runCatching { LocalDate.parse(value) }.isSuccess)
        private fun canonical(value: Any?): String = when (value) {
            is JSONObject -> value.keys().asSequence().toList().sorted().joinToString(prefix = "{", postfix = "}") { JSONObject.quote(it) + ":" + canonical(value.get(it)) }
            is JSONArray -> (0 until value.length()).joinToString(prefix = "[", postfix = "]") { canonical(value.get(it)) }
            null, JSONObject.NULL -> "null"
            is String -> JSONObject.quote(value)
            is Number, is Boolean -> value.toString()
            else -> error("DIARY_INVALID_NOTE")
        }
    }
}
