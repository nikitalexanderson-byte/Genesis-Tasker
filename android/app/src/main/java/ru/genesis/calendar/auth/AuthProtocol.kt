package ru.genesis.calendar.auth

import java.net.HttpCookie
import org.json.JSONObject
import ru.genesis.calendar.BuildConfig

internal val AUTH_ORIGIN = BuildConfig.GENESIS_ORIGIN
internal val AUTH_HOST = BuildConfig.GENESIS_HOST
internal const val SESSION_COOKIE = "GENESISSESSID"

class ServerIdentity(val uid: String, val displayName: String, val email: String) {
    override fun toString() = "ServerIdentity([redacted])"
}

internal class SessionSecret(val cookie: String, val expiresAt: Long, val csrf: String) {
    override fun toString() = "SessionSecret([redacted])"
}

internal class CookieUpdate(val present: Boolean, val value: String = "", val expiresAt: Long = 0)
internal class AuthChallenge(val nonce: String, val serverClientId: String)

/** Only our host-only/same-host secure PHP session cookie is accepted. No browser cookie import. */
internal object AuthProtocol {
    fun cookie(headers: List<String>, now: Long): CookieUpdate {
        val cookies = headers.flatMap { HttpCookie.parse(it) }.filter { it.name == SESSION_COOKIE }
        if (cookies.isEmpty()) return CookieUpdate(false)
        require(cookies.size == 1) { "Ambiguous session cookie" }
        val cookie = cookies.single()
        require(cookie.secure && cookie.isHttpOnly) { "Insecure session cookie" }
        require(cookie.domain.isNullOrEmpty() || cookie.domain.trimStart('.').equals(AUTH_HOST, true)) { "Foreign session cookie" }
        require(cookie.path == "/") { "Unexpected session path" }
        if (cookie.maxAge == 0L) return CookieUpdate(true)
        require(cookie.value.matches(Regex("[A-Za-z0-9,-]{16,256}"))) { "Invalid session cookie" }
        val seconds = if (cookie.maxAge < 0) 30L * 86400 else cookie.maxAge.coerceAtMost(30L * 86400)
        return CookieUpdate(true, cookie.value, now + seconds * 1000)
    }

    fun csrf(value: String): String {
        require(value.matches(Regex("[a-fA-F0-9]{48}"))) { "Invalid CSRF value" }
        return value
    }

    fun identity(body: JSONObject): ServerIdentity? {
        require(body.has("user")) { "Missing session identity" }
        if (body.isNull("user")) return null
        val user = body.getJSONObject("user")
        val uid = user.getString("uid")
        val email = user.getString("email")
        require(uid.isNotBlank() && uid.length <= 255 && email.length <= 254) { "Invalid identity" }
        val name = if (user.isNull("displayName")) email else user.optString("displayName", email)
        return ServerIdentity(uid, name.take(160), email)
    }

    fun challenge(body: JSONObject): AuthChallenge {
        val nonce = body.getString("nonce")
        val clientId = body.getString("serverClientId")
        require(nonce.matches(Regex("[A-Za-z0-9_-]{43}"))) { "Invalid challenge" }
        require(clientId.matches(Regex("[A-Za-z0-9._-]+\\.apps\\.googleusercontent\\.com"))) { "Invalid OAuth audience" }
        require(body.getInt("expiresIn") in 1..300) { "Invalid challenge lifetime" }
        return AuthChallenge(nonce, clientId)
    }

    fun serverClientId(body: JSONObject): String {
        val clientId = body.getString("serverClientId")
        require(clientId.matches(Regex("[A-Za-z0-9._-]+\\.apps\\.googleusercontent\\.com"))) {
            "Invalid OAuth audience"
        }
        return clientId
    }

    fun googleLinkAction(body: JSONObject): String? = body.optString("googleLinkAction")
        .takeIf { it in setOf("found", "created") }
}
