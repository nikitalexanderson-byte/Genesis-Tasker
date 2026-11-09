package ru.genesis.calendar.domain

import org.json.JSONObject
import java.net.URI
import java.time.Instant

/** Metric WeatherSnapshotV1 shared with app/weather-types.ts; unknown values stay null. */
internal data class WeatherCurrentV1(
    val temperatureC: Double?, val apparentTemperatureC: Double?, val humidityPercent: Double?,
    val pressureMslHpa: Double?, val windSpeedMps: Double?, val windDirectionDeg: Double?,
    val windGustMps: Double?, val cloudCoverPercent: Double?, val precipitation1hMm: Double?,
    val rain1hMm: Double?, val snowWaterEquivalent1hMm: Double?, val precipitationRateMmH: Double?,
    val snowDepthCm: Double?, val visibilityM: Double?, val condition: String, val phenomena: Set<String>,
    val precipitationKind: String, val intensity: String, val providerCode: String?,
    val thunderstorm: Boolean?, val storm: Boolean?, val blizzard: Boolean?,
)

internal data class WeatherProviderV1(val id: String, val name: String, val attributionUrl: String,
    val licenseUrl: String, val dataKind: String)

internal data class WeatherLocationV1(val latitude: Double, val longitude: Double, val approximate: Boolean)

internal data class WeatherRequestV1(val latitude: Double, val longitude: Double, val locationSource: String) {
    init {
        require(latitude.isFinite() && latitude in -90.0..90.0)
        require(longitude.isFinite() && longitude in -180.0..180.0)
        require(locationSource in setOf("selected-city", "network"))
    }

    fun json(): JSONObject = JSONObject().put("latitude", latitude).put("longitude", longitude)
        .put("locationSource", locationSource)
}

internal data class WeatherSnapshotV1(
    val status: String, val reason: String?, val provider: WeatherProviderV1, val location: WeatherLocationV1?,
    val issuedAt: Instant?, val observedAt: Instant?, val validAt: Instant?, val validUntil: Instant?,
    val fetchedAt: Instant?, val expiresAt: Instant?, val retryAt: Instant?, val current: WeatherCurrentV1?,
) {
    /** Cache freshness and the provider's actual sample window must both still hold. */
    fun isFresh(now: Instant): Boolean = status == "fresh" && current != null &&
        validAt?.let { !now.isBefore(it) } == true && validUntil?.let(now::isBefore) == true &&
        expiresAt?.let(now::isBefore) == true

    fun displayCurrent(now: Instant): WeatherCurrentV1? = current?.takeIf {
        status in setOf("fresh", "stale") && validAt?.let { time -> !now.isBefore(time) } == true
    }

    fun nextReadAt(): Instant? = retryAt ?: expiresAt

    companion object {
        private val conditions = setOf("clear", "partly-cloudy", "cloudy", "fog", "drizzle", "rain", "snow",
            "sleet", "freezing-rain", "thunderstorm", "unknown")
        private val phenomena = conditions - setOf("clear", "partly-cloudy", "cloudy", "unknown") + "hail"
        private val precipitation = setOf("none", "drizzle", "rain", "snow", "sleet", "freezing-rain", "hail", "unknown")

        fun fromJson(value: JSONObject): WeatherSnapshotV1 {
            require(value.getInt("schemaVersion") == 1)
            val status = value.getString("status")
            require(status in setOf("fresh", "stale", "unavailable", "disabled", "requires-location"))
            val source = value.getJSONObject("provider")
            val provider = WeatherProviderV1(source.getString("id"), source.getString("name").take(160),
                source.getString("attributionUrl"), source.getString("licenseUrl"), source.getString("dataKind"))
            require(provider.id in setOf("met-norway", "open-meteo") &&
                provider.dataKind in setOf("forecast", "analysis", "observation"))
            for (link in listOf(provider.attributionUrl, provider.licenseUrl)) {
                val uri = URI(link)
                require(uri.scheme == "https" && !uri.host.isNullOrBlank() && uri.userInfo == null)
            }
            val location = value.optJSONObject("location")?.let { row ->
                WeatherLocationV1(row.getDouble("latitude"), row.getDouble("longitude"), row.getBoolean("approximate")).also {
                    require(it.latitude.isFinite() && it.latitude in -90.0..90.0 &&
                        it.longitude.isFinite() && it.longitude in -180.0..180.0)
                }
            }
            val current = value.optJSONObject("current")?.let { row ->
                require(status in setOf("fresh", "stale") && location != null)
                fun number(key: String, minimum: Double? = null, maximum: Double? = null): Double? {
                    if (!row.has(key) || row.isNull(key)) return null
                    val raw = row.get(key)
                    require(raw is Number)
                    return raw.toDouble().also {
                        require(it.isFinite() && (minimum == null || it >= minimum) && (maximum == null || it <= maximum))
                    }
                }
                fun nullableBoolean(key: String): Boolean? = if (!row.has(key) || row.isNull(key)) null else row.getBoolean(key)
                val condition = row.getString("condition").also { require(it in conditions) }
                val kind = row.getString("precipitationKind").also { require(it in precipitation) }
                val intensity = row.getString("intensity").also { require(it in setOf("none", "light", "moderate", "heavy", "unknown")) }
                val phenomenaRows = row.getJSONArray("phenomena")
                require(phenomenaRows.length() <= 16)
                val currentPhenomena = (0 until phenomenaRows.length()).map { phenomenaRows.getString(it).also { item ->
                    require(item in phenomena)
                } }.toSet()
                WeatherCurrentV1(number("temperatureC"), number("apparentTemperatureC"), number("humidityPercent", 0.0, 100.0),
                    number("pressureMslHpa", 0.0), number("windSpeedMps", 0.0), number("windDirectionDeg", 0.0, 360.0),
                    number("windGustMps", 0.0), number("cloudCoverPercent", 0.0, 100.0), number("precipitation1hMm", 0.0),
                    number("rain1hMm", 0.0), number("snowWaterEquivalent1hMm", 0.0), number("precipitationRateMmH", 0.0),
                    number("snowDepthCm", 0.0), number("visibilityM", 0.0), condition, currentPhenomena, kind, intensity,
                    row.optString("providerCode").takeUnless { !row.has("providerCode") || row.isNull("providerCode") },
                    nullableBoolean("thunderstorm"), nullableBoolean("storm"), nullableBoolean("blizzard"))
            }
            fun timestamp(key: String): Instant? = if (!value.has(key) || value.isNull(key)) null else Instant.parse(value.getString(key))
            val snapshot = WeatherSnapshotV1(status, value.optString("reason").takeUnless { !value.has("reason") || value.isNull("reason") },
                provider, location, timestamp("issuedAt"), timestamp("observedAt"), timestamp("validAt"), timestamp("validUntil"),
                timestamp("fetchedAt"), timestamp("expiresAt"), timestamp("retryAt"), current)
            require(snapshot.validAt == null || snapshot.validUntil == null || snapshot.validAt.isBefore(snapshot.validUntil))
            require(provider.dataKind != "forecast" || snapshot.observedAt == null)
            return snapshot
        }
    }
}
