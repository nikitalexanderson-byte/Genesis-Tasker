package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.ZoneId

internal val adviceCategories = listOf("aretology", "hermetica", "kourotrophy", "hestiology", "aphrodisia", "psychopompia")
internal val adviceTopics = listOf("nutrition", "training", "recovery", "discipline", "clothing", "attributes", "cleaning", "home_order")
internal val adviceCollections = listOf("aurora", "philosophers")

data class AdviceNotificationPreferences(val enabled: Boolean = false, val time: String = "09:00",
    val timeZone: String = "UTC") {
    init {
        require(Regex("(?:[01][0-9]|2[0-3]):[0-5][0-9]").matches(time))
        require(timeZone in ZoneId.getAvailableZoneIds())
    }
    fun toJson(): JSONObject = JSONObject().put("enabled", enabled).put("time", time).put("timeZone", timeZone)
    companion object {
        fun deviceTimeZone(fallback: String = "UTC"): String {
            val zone = ZoneId.systemDefault()
            if (zone.id in ZoneId.getAvailableZoneIds()) return zone.id
            // Some devices expose a fixed GMT offset instead of an IANA name.
            val seconds = zone.rules.getOffset(java.time.Instant.now()).totalSeconds
            val fixed = if (zone.rules.isFixedOffset && seconds % 3600 == 0)
                "Etc/GMT${if (seconds > 0) "-" else "+"}${kotlin.math.abs(seconds / 3600)}" else null
            return fixed?.takeIf { it in ZoneId.getAvailableZoneIds() } ?: fallback
        }
        fun fromJson(value: JSONObject?): AdviceNotificationPreferences {
            if (value == null) return AdviceNotificationPreferences()
            require(!value.has("enabled") || value.get("enabled") is Boolean)
            require(value.keys().asSequence().all { it in setOf("enabled", "time", "timeZone") })
            return AdviceNotificationPreferences(value.optBoolean("enabled", false), value.optString("time", "09:00"),
                value.optString("timeZone", "UTC"))
        }
    }
}

data class AdvicePreferences(val enabled: Boolean = true, val smart: Boolean = true,
    val categories: List<String> = adviceCategories.filter { it != "aphrodisia" }, val aphrodisiaAdult: Boolean? = null,
    val collections: List<String> = listOf("aurora"), val notifications: AdviceNotificationPreferences = AdviceNotificationPreferences(),
    val psychopompia: AdvicePsychopompiaPreferences = AdvicePsychopompiaPreferences(), val philosophersPerDay: Int = 1) {
    init { require(philosophersPerDay in 1..3) }
    fun toJson(): JSONObject = JSONObject().put("enabled", enabled).put("smart", smart).put("categories", JSONArray(categories))
        .put("aphrodisiaAdult", aphrodisiaAdult ?: JSONObject.NULL)
        .put("collections", JSONArray(collections))
        .put("philosophersPerDay", philosophersPerDay)
        .put("notifications", notifications.toJson())
        .put("psychopompia", psychopompia.toJson())
    companion object {
        fun fromJson(value: JSONObject?): AdvicePreferences {
            val selected = value?.optJSONArray("categories")
            val adult = value?.opt("aphrodisiaAdult") as? Boolean
            val requestedCollections = value?.optJSONArray("collections")
            val collections = adviceCollections.filter { id -> requestedCollections != null && (0 until requestedCollections.length()).any { requestedCollections.optString(it) == id } }.ifEmpty { listOf("aurora") }
            val categories = adviceCategories.filter { id -> (selected == null || (0 until selected.length()).any { selected.optString(it) == id }) &&
                (id != "aphrodisia" || adult != null) }
            return AdvicePreferences(value?.optBoolean("enabled", true) != false,
                value?.optBoolean("smart", true) != false, categories.ifEmpty { adviceCategories.filter { it != "aphrodisia" } }, adult, collections,
                AdviceNotificationPreferences.fromJson(value?.optJSONObject("notifications")),
                AdvicePsychopompiaPreferences.fromJson(value?.optJSONObject("psychopompia")),
                value?.optInt("philosophersPerDay", 1)?.takeIf { it in 1..3 } ?: 1)
        }
    }
}

internal interface DailyAdviceGateway {
    suspend fun today(context: JSONObject): JSONObject
    suspend fun next(context: JSONObject, id: String, day: String): JSONObject = throw UnsupportedOperationException("ADVICE_ROTATION_UNAVAILABLE")
    suspend fun saved(id: String, day: String, collection: String): JSONObject = throw UnsupportedOperationException("ADVICE_SAVED_UNAVAILABLE")
    suspend fun share(id: String, day: String, collection: String): JSONObject = throw UnsupportedOperationException("ADVICE_SHARE_UNAVAILABLE")
    suspend fun record(id: String, day: String, dismiss: Boolean = false)
}

internal data class DailyAdviceSource(val kind: String, val author: String, val work: String, val reference: String)
internal data class DailyAdvice(val id: String, val day: String, val title: String, val body: String,
    val language: String, val categories: List<String>, val image: String?, val dismissed: Boolean,
    val sources: List<DailyAdviceSource>, val aphrodisiaTheme: String? = null, val requiresAdult: Boolean = false,
    val sequence: Int? = null, val collection: String = "aurora", val subcategories: List<String> = emptyList(),
    val containsAlcohol: Boolean? = null, val psychopompiaPublished: Boolean = false, val reviewStatus: String? = null)
internal data class DailyAdviceResponse(val day: String, val state: String, val advice: DailyAdvice?,
    val sequence: Int = 1, val dailyLimit: Int = 1, val canNext: Boolean = false,
    val history: List<DailyAdvice> = listOfNotNull(advice))

internal object DailyAdviceProtocol {
    private val idPattern = Regex("advice-[a-f0-9]{24}")
    private val artworkPattern = Regex("/advice-art/[a-z0-9-]+/advice-[a-f0-9]{24}\\.webp")
    private val languages = setOf("ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja")
    fun record(id: String, day: String): JSONObject {
        require(idPattern.matches(id) && LocalDate.parse(day).toString() == day)
        return JSONObject().put("id", id).put("dayKey", day)
    }
    fun savedPath(id: String, day: String, collection: String): String {
        record(id, day); require(collection in adviceCollections)
        return "/advice/saved?id=$id&dayKey=$day&collection=$collection&maxDailyCards=9"
    }
    fun visible(card: DailyAdvice, preferences: AdvicePreferences): Boolean {
        if (!preferences.enabled || card.collection !in preferences.collections || card.dismissed) return false
        if ("aphrodisia" in card.categories && ("aphrodisia" !in preferences.categories || preferences.aphrodisiaAdult == null ||
            card.requiresAdult && preferences.aphrodisiaAdult != true)) return false
        if ("psychopompia" in card.categories) return NativeAdviceAgeAccess.allowed(card, preferences)
        return card.containsAlcohol != true && (!card.requiresAdult || "aphrodisia" in card.categories)
    }
    fun parse(value: JSONObject): DailyAdviceResponse {
        val day = value.getString("dayKey")
        require(LocalDate.parse(day).toString() == day)
        val state = value.getString("state")
        val sequence = value.optInt("sequence", 1)
        val limit = value.optInt("dailyLimit", 1)
        val canNext = value.optBoolean("canNext", false)
        require(limit in 1..9 && sequence in 0..9 && (!canNext || sequence < limit))
        require(state in setOf("disabled", "empty", "no-match", "ready"))
        val advice = if (value.isNull("advice")) {
            require(state != "ready"); null
        } else {
            require(state == "ready"); parseCard(value.getJSONObject("advice"), day)
        }
        val history = if (value.has("history")) value.getJSONArray("history").let { rows ->
            require(rows.length() <= limit)
            (0 until rows.length()).map { parseCard(rows.getJSONObject(it), day) }.also { cards ->
                require(cards.all { it.sequence != null && it.sequence in 1..sequence })
                require(cards.map { it.id }.distinct().size == cards.size)
                require(cards.zipWithNext().all { (left, right) -> left.sequence!! < right.sequence!! })
                require(advice == null || cards.any { it.id == advice.id })
                require(cards.map { it.language }.distinct().size <= 1)
                require(advice == null || cards.all { it.language == advice.language })
            }
        } else listOfNotNull(advice)
        return DailyAdviceResponse(day, state, advice, sequence, limit, canNext, history)
    }

    private fun parseCard(row: JSONObject, day: String): DailyAdvice {
        val collection = row.optString("collection", "aurora").also { require(it in adviceCollections) }
        val id = row.getString("id")
        record(id, row.getString("dayKey"))
        require(row.getString("dayKey") == day && row.getString("language") in languages)
        val categories = row.getJSONArray("categories").let { rows ->
            require(rows.length() in (if(collection == "philosophers") 0 else 1)..adviceCategories.size)
            (0 until rows.length()).map { rows.getString(it).also { id -> require(id in adviceCategories) } }.distinct()
        }
        val title = row.optString("title").also { require(it.length <= 2000) }
        val body = row.getString("body").also { require(it.isNotBlank() && it.length <= 100_000) }
        require(row.get("dismissed") is Boolean)
        val sources = row.getJSONArray("sources").let { rows ->
            require(rows.length() <= 20)
            (0 until rows.length()).map { index ->
                val source = rows.getJSONObject(index)
                val kind = source.getString("kind").also { require(it in setOf("quote", "inspired")) }
                fun text(key: String) = source.optString(key).takeUnless { it == "null" }.orEmpty().also { require(it.length <= 2000) }
                DailyAdviceSource(kind, text("author"), text("work"), text("reference"))
            }
        }
        val sequence = if (row.has("sequence")) row.getInt("sequence").also { require(it in 1..9) } else null
        return DailyAdvice(id, day, title, body, row.getString("language"),
            categories, row.optString("image").takeIf { artworkPattern.matches(it) }, row.getBoolean("dismissed"), sources,
            row.optString("aphrodisiaTheme").takeIf { it in setOf("love", "aesthetics", "consciousness") },
            row.optBoolean("requiresAdult", "aphrodisia" in categories || "psychopompia" in categories), sequence, collection,
            row.optJSONArray("subcategories")?.let { rows -> require(rows.length() <= 32); (0 until rows.length()).map { rows.getString(it) } }.orEmpty(),
            row.opt("containsAlcohol") as? Boolean, row.opt("psychopompiaPublished") == true && row.opt("requiresAdult") == true, row.optJSONObject("review")?.optString("status"))
    }
}
