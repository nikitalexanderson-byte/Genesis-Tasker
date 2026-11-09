package ru.genesis.calendar.auth

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** One canonical bundled policy; no country, age or consent is inferred from language/Google. */
internal object NativeAdviceAgeAccess {
    @Volatile private var rules: JSONObject? = null
    fun load(context: Context) {
        rules = runCatching { context.assets.open("originals/catalogs/advice-age-access-policy.json").bufferedReader(Charsets.UTF_8)
            .use { JSONObject(it.readText()) }.also { require(it.getInt("version") == 1 && it.get("corpusEnabled") is Boolean) } }.getOrNull()
    }
    val policy: JSONObject? get() = rules
    val policyVersion: String get() = rules?.optString("policyVersion") ?: "2026-11-01"
    val subcategoryIds: List<String> get() = rules?.optJSONArray("subcategories")?.let { rows ->
        (0 until rows.length()).map { rows.getJSONObject(it).getString("id") }
    }.orEmpty()
    data class Jurisdiction(val state: String, val minimumAge: Int? = null)
    fun jurisdiction(country: String, subdivision: String = "", policy: JSONObject? = rules): Jurisdiction {
        var rule = policy?.optJSONObject("jurisdictions")?.optJSONObject(country) ?: return Jurisdiction("unknown")
        if (rule.optString("status") == "subdivision-required") {
            if (subdivision.isEmpty()) return Jurisdiction("subdivision-required")
            rule = rule.optJSONObject("subdivisions")?.optJSONObject(subdivision) ?: return Jurisdiction("unknown")
        } else if (subdivision.isNotEmpty()) return Jurisdiction("unknown")
        if (rule.optString("status") == "blocked") return Jurisdiction("blocked")
        val age = (rule.opt("minimumAge") as? Number)?.toInt()
        return if (rule.optString("status") == "verified" && age != null && age > 0) Jurisdiction("verified", maxOf(18, age)) else Jurisdiction("unknown")
    }
    fun alcoholAllowed(preferences: AdvicePsychopompiaPreferences, policy: JSONObject? = rules): Boolean {
        val declaration = preferences.alcohol
        val rule = jurisdiction(declaration.countryCode, declaration.subdivisionCode, policy)
        return preferences.adultConfirmed && declaration.consent && declaration.policyVersion == policy?.optString("policyVersion") &&
            rule.state == "verified" && declaration.ageAtLeast == rule.minimumAge
    }
    fun allowed(card: DailyAdvice, preferences: AdvicePreferences, policy: JSONObject? = rules): Boolean {
        val selected = preferences.psychopompia
        val ids = policy?.optJSONArray("subcategories")?.let { rows -> (0 until rows.length()).map { rows.getJSONObject(it).getString("id") } }.orEmpty()
        return policy?.optBoolean("corpusEnabled") == true && "psychopompia" in card.categories && "psychopompia" in preferences.categories && selected.adultConfirmed &&
            card.requiresAdult && card.psychopompiaPublished && card.reviewStatus == "cleared" && card.containsAlcohol != null &&
            card.subcategories.isNotEmpty() && card.subcategories.all { it in ids } && card.subcategories.any { it in selected.subcategories } &&
            (card.containsAlcohol != true || alcoholAllowed(selected, policy))
    }
    fun notificationSafe(card: DailyAdvice): Boolean = !card.requiresAdult && card.containsAlcohol != true &&
        card.categories.none { it in setOf("aphrodisia", "psychopompia") }
}

data class AdviceAlcoholDeclaration(val consent: Boolean = false, val countryCode: String = "", val subdivisionCode: String = "",
    val ageAtLeast: Int? = null, val policyVersion: String = NativeAdviceAgeAccess.policyVersion) {
    init {
        require(Regex("(?:[A-Z]{2})?").matches(countryCode) && Regex("(?:[A-Z]{2}-[A-Z0-9]{1,4})?").matches(subdivisionCode))
        require(subdivisionCode.isEmpty() || subdivisionCode.startsWith("$countryCode-"))
        require(ageAtLeast == null || ageAtLeast in setOf(18,19,20,21,25))
        require(Regex("[0-9]{4}-[0-9]{2}-[0-9]{2}").matches(policyVersion))
    }
    fun toJson(): JSONObject = JSONObject().put("consent", consent).put("countryCode", countryCode).put("subdivisionCode", subdivisionCode)
        .put("ageAtLeast", ageAtLeast ?: JSONObject.NULL).put("policyVersion", policyVersion)
    companion object {
        fun fromJson(value: JSONObject?): AdviceAlcoholDeclaration {
            if (value == null) return AdviceAlcoholDeclaration()
            require(value.keys().asSequence().all { it in setOf("consent", "countryCode", "subdivisionCode", "ageAtLeast", "policyVersion") })
            require(!value.has("consent") || value.get("consent") is Boolean)
            val rawAge = value.opt("ageAtLeast")
            require(value.isNull("ageAtLeast") || rawAge is Int || rawAge is Long)
            val age = if (value.isNull("ageAtLeast")) null else value.getInt("ageAtLeast")
            return AdviceAlcoholDeclaration(value.optBoolean("consent"), value.optString("countryCode", ""), value.optString("subdivisionCode", ""),
                age, value.optString("policyVersion", NativeAdviceAgeAccess.policyVersion))
        }
    }
}
data class AdvicePsychopompiaPreferences(val adultConfirmed: Boolean = false,
    val subcategories: List<String> = NativeAdviceAgeAccess.subcategoryIds, val alcohol: AdviceAlcoholDeclaration = AdviceAlcoholDeclaration()) {
    fun toJson(): JSONObject = JSONObject().put("adultConfirmed", adultConfirmed).put("subcategories", JSONArray(subcategories)).put("alcohol", alcohol.toJson())
    companion object {
        fun fromJson(value: JSONObject?): AdvicePsychopompiaPreferences {
            if (value == null) return AdvicePsychopompiaPreferences()
            require(value.keys().asSequence().all { it in setOf("adultConfirmed", "subcategories", "alcohol") })
            require(!value.has("adultConfirmed") || value.get("adultConfirmed") is Boolean)
            require(!value.has("subcategories") || value.get("subcategories") is JSONArray)
            require(!value.has("alcohol") || value.get("alcohol") is JSONObject)
            val selected = value.optJSONArray("subcategories")?.let { rows -> (0 until rows.length()).map { rows.getString(it) } }
                ?: NativeAdviceAgeAccess.subcategoryIds
            return AdvicePsychopompiaPreferences(value.optBoolean("adultConfirmed"), selected, AdviceAlcoholDeclaration.fromJson(value.optJSONObject("alcohol")))
        }
    }
}
