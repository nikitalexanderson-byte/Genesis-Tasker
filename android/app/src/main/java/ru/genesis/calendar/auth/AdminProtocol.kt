package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Base64
import java.util.Locale
import java.security.MessageDigest

internal interface AdminGateway {
    fun check()
    suspend fun ads(): JSONObject
    suspend fun saveAd(id: String?, body: JSONObject): JSONObject
    suspend fun deleteAd(id: String): JSONObject
    suspend fun subscription(userId: String, plan: String, expectedPlan: String): JSONObject
    suspend fun resetAccess(userId:String,expectedPlan:String,expectedRevision:Int):JSONObject=throw UnsupportedOperationException("SUBSCRIPTION_RESET_UNAVAILABLE")
    suspend fun forecastPrivilege(userId:String,enabled:Boolean,expectedRevision:Int):JSONObject=throw UnsupportedOperationException("FORECAST_PRIVILEGE_UNAVAILABLE")
}

internal fun allowedAdminExtensionRoute(method: String, path: String): Boolean {
    val uuid = "[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}"
    return when {
        path == "/admin/ads" -> method == "GET" || method == "POST"
        Regex("/admin/ads/$uuid").matches(path) -> method == "PUT" || method == "DELETE"
        Regex("/admin/users/[A-Za-z0-9_-]{1,100}/subscription").matches(path) -> method == "PUT"
        Regex("/admin/users/[A-Za-z0-9_-]{1,100}/reset-access").matches(path) -> method == "POST"
        Regex("/admin/users/[A-Za-z0-9_-]{1,100}/forecast-privilege").matches(path) -> method == "PUT"
        else -> false
    }
}

internal object AdminProtocol {
    val plans = listOf("free", "standart", "premium", "business", "premium4life", "elite_plus")
    private val languages = setOf("ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja")
    fun userId(value: String) = value.also { require(Regex("[A-Za-z0-9_-]{1,100}").matches(it)) { "ADMIN_SCOPE_INVALID" } }
    fun adId(value: String) = value.also { require(Regex("[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}").matches(it)) { "ADMIN_SCOPE_INVALID" } }
    fun subscription(user: JSONObject, plan: String): JSONObject {
        userId(user.getString("id")); val previous = user.optString("subscriptionPlan", "free")
        require(plan in plans && previous in plans) { "INVALID_SUBSCRIPTION_PLAN" }
        return JSONObject().put("subscriptionPlan", plan).put("expectedPlan", previous)
    }
    fun canDelete(user: JSONObject, confirmation: String) = !user.optBoolean("isAdmin") &&
        user.optString("email").isNotBlank() && confirmation.trim().equals(user.getString("email"), ignoreCase = true)
    fun codes(value: String, uppercase: Boolean = false): List<String> = value.split(Regex("[\\s,;]+"))
        .map(String::trim).filter(String::isNotEmpty).map { if (uppercase) it.uppercase(Locale.ROOT) else it.lowercase(Locale.ROOT) }.distinct()
    private fun url(value: String, required: Boolean): String = value.trim().also {
        if (it.isBlank() && !required) return@also
        val parsed = runCatching { URI(it) }.getOrNull()
        require(it.length <= 2048 && parsed?.scheme.equals("https", true) && !parsed?.host.isNullOrBlank() && parsed?.userInfo == null) { "ADMIN_AD_HTTPS_REQUIRED" }
    }
    fun imageData(value: String): String = value.also {
        if (it.isBlank()) return@also
        val match = Regex("data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})").matchEntire(it)
        require(it.length <= 700_000 && match != null) { "ADMIN_AD_IMAGE_INVALID" }
        val bytes = Base64.getDecoder().decode(requireNotNull(match).groupValues[2])
        try { require(bytes.size in 1..500_000) { "ADMIN_AD_IMAGE_INVALID" } } finally { bytes.fill(0) }
    }
    fun localDate(value: String?, zone: ZoneId): String = value?.takeIf { it.isNotBlank() && it != "null" }
        ?.let { LocalDateTime.ofInstant(Instant.parse(it), zone).format(DateTimeFormatter.ISO_LOCAL_DATE_TIME) }.orEmpty()
    private fun utc(value: String, zone: ZoneId): String? = value.takeIf(String::isNotBlank)?.let {
        val local = LocalDateTime.parse(it)
        require(zone.rules.getValidOffsets(local).isNotEmpty()) { "ADMIN_AD_DATE_INVALID" }
        local.atZone(zone).toInstant().toString()
    }
    fun emptyForm() = JSONObject().put("title", "").put("description", "").put("imageUrl", "").put("imageData", "").put("linkUrl", "")
        .put("languages", "").put("countries", "").put("platforms", JSONArray(listOf("web", "android")))
        .put("startsAt", "").put("endsAt", "").put("repeatHours", "24").put("priority", "0").put("enabled", false)
    fun form(row: JSONObject, zone: ZoneId): JSONObject {
        adId(row.getString("id")); val image = row.getString("imageUrl")
        fun textCodes(field: String): String = row.getJSONArray(field).let { (0 until it.length()).joinToString(", ") { index -> it.getString(index) } }
        return emptyForm().put("title", row.getString("title")).put("description", row.getString("description"))
            .put("imageUrl", image.takeUnless { it.startsWith("data:") }.orEmpty()).put("imageData", image.takeIf { it.startsWith("data:") }.orEmpty())
            .put("linkUrl", row.getString("linkUrl")).put("languages", textCodes("languages")).put("countries", textCodes("countries"))
            .put("platforms", JSONArray(row.getJSONArray("platforms").toString())).put("startsAt", localDate(row.optString("startsAt"), zone))
            .put("endsAt", localDate(row.optString("endsAt"), zone)).put("repeatHours", row.getInt("repeatHours").toString())
            .put("priority", row.getInt("priority").toString()).put("enabled", row.getBoolean("enabled"))
    }
    fun input(form: JSONObject, zone: ZoneId): JSONObject {
        val title = form.getString("title").trim(); val description = form.getString("description").trim()
        require(title.codePointCount(0, title.length) in 1..120 && description.codePointCount(0, description.length) in 1..2000) { "ADMIN_AD_TEXT_INVALID" }
        val image = imageData(form.getString("imageData")); val remote = url(form.getString("imageUrl"), false)
        require(image.isNotBlank() || remote.isNotBlank()) { "ADMIN_AD_IMAGE_REQUIRED" }
        val lang = codes(form.getString("languages")); val countries = codes(form.getString("countries"), true)
        require(lang.size <= 30 && lang.all { it in languages } && countries.size <= 30 && countries.all { Regex("[A-Z]{2}").matches(it) }) { "ADMIN_AD_AUDIENCE_INVALID" }
        val platforms = form.getJSONArray("platforms").let { (0 until it.length()).map(it::getString) }
        require(platforms.distinct().size == platforms.size && platforms.all { it in setOf("web", "android") }) { "ADMIN_AD_AUDIENCE_INVALID" }
        val start = utc(form.getString("startsAt"), zone); val end = utc(form.getString("endsAt"), zone)
        require(start == null || end == null || Instant.parse(end) > Instant.parse(start)) { "ADMIN_AD_DATE_INVALID" }
        val repeat = form.getString("repeatHours").toIntOrNull(); val priority = form.getString("priority").toIntOrNull()
        require(repeat != null && repeat in 1..720 && priority != null && priority in 0..10) { "ADMIN_AD_NUMBER_INVALID" }
        return JSONObject().put("title", title).put("description", description).put("imageData", image).put("imageUrl", remote).put("linkUrl", url(form.getString("linkUrl"), true))
            .put("languages", JSONArray(lang)).put("countries", JSONArray(countries)).put("platforms", JSONArray(platforms))
            .put("startsAt", start ?: JSONObject.NULL).put("endsAt", end ?: JSONObject.NULL).put("repeatHours", repeat).put("priority", priority).put("enabled", form.getBoolean("enabled"))
    }
    /** Normalize the image field and unordered audiences for the best available client conflict check. */
    fun fingerprint(value: JSONObject): String {
        val result = JSONObject()
        listOf("title", "description", "linkUrl", "repeatHours", "priority", "enabled").forEach { result.put(it, value.get(it)) }
        result.put("image", value.optString("imageData").takeIf(String::isNotBlank) ?: value.getString("imageUrl"))
        listOf("languages", "countries", "platforms").forEach { field -> val array = value.getJSONArray(field)
            result.put(field, JSONArray((0 until array.length()).map(array::getString).sorted())) }
        listOf("startsAt", "endsAt").forEach { field -> result.put(field, value.optString(field).takeIf { it.isNotBlank() && it != "null" }?.let { Instant.parse(it).toString() } ?: JSONObject.NULL) }
        return MessageDigest.getInstance("SHA-256").digest(canonical(result).toByteArray()).joinToString("") { "%02x".format(it) }
    }
    private fun canonical(value: Any?): String = when (value) {
        is JSONObject -> value.keys().asSequence().toList().sorted().joinToString(",", "{", "}") { JSONObject.quote(it) + ":" + canonical(value.get(it)) }
        is JSONArray -> (0 until value.length()).joinToString(",", "[", "]") { canonical(value.get(it)) }
        null, JSONObject.NULL -> "null"
        is String -> JSONObject.quote(value)
        is Boolean -> value.toString()
        is Number -> JSONObject.numberToString(value)
        else -> throw IllegalArgumentException("ADMIN_AD_VALUE_INVALID")
    }
}
