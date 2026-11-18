package ru.genesis.calendar.auth

import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONObject

internal enum class WelcomeIpRegion { RUSSIA, OTHER, UNKNOWN }

internal fun welcomeIpRegion(response: JSONObject): WelcomeIpRegion {
    if (response.optString("source") != "ip") return WelcomeIpRegion.UNKNOWN
    return when (response.optString("region")) {
        "RU" -> WelcomeIpRegion.RUSSIA
        "outside-RU" -> WelcomeIpRegion.OTHER
        else -> WelcomeIpRegion.UNKNOWN
    }
}

/** Existing first-party public hint. No account client, device ID or external geo provider. */
internal fun requestWelcomeIpRegion(open: () -> HttpURLConnection = {
    URL("$AUTH_ORIGIN/api/billing/location").openConnection() as HttpURLConnection
}): WelcomeIpRegion {
    val connection = open()
    try {
        connection.requestMethod = "GET"
        connection.instanceFollowRedirects = false
        connection.useCaches = false
        connection.connectTimeout = 4_000
        connection.readTimeout = 4_000
        connection.setRequestProperty("Accept", "application/json")
        connection.setRequestProperty("Cache-Control", "no-store")
        if (connection.responseCode != 200) return WelcomeIpRegion.UNKNOWN
        val bytes = connection.inputStream.use { input ->
            val body = java.io.ByteArrayOutputStream()
            val buffer = ByteArray(512)
            while (true) {
                val size = input.read(buffer)
                if (size < 0) break
                if (body.size() + size > 4_096) return WelcomeIpRegion.UNKNOWN
                body.write(buffer, 0, size)
            }
            body.toByteArray()
        }
        return welcomeIpRegion(JSONObject(bytes.toString(Charsets.UTF_8)))
    } finally { connection.disconnect() }
}
