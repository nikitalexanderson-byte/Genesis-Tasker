package ru.genesis.calendar.auth

import org.json.JSONObject
import ru.genesis.calendar.security.E2eeScopeTransport

/** Exact route allowlist, shared by the real authenticated channel and tests. */
internal object E2eeTransportProtocol {
    private val posts = setOf("/bootstrap", "/command", "/read", "/challenge", "/directory", "/source", "/membership-state", "/membership-preview", "/membership",
        "/membership-graph", "/membership-atomic-begin", "/membership-atomic-page", "/membership-atomic-status", "/membership-atomic-cancel", "/membership-atomic-seal",
        "/membership-atomic-commit", "/membership-atomic-receipt", "/membership-atomic-receipt-page", "/membership-atomic-preview")
    private val drivePosts = setOf("connect","authorize","disconnect","prepare","commit","list","download")
    fun driveRoute(method:String,path:String):Boolean = method=="GET"&&path=="/private-drive/v1/status" || method=="POST"&&drivePosts.any{path=="/private-drive/v1/$it"}
    fun allowedRoute(method: String, path: String): Boolean =
        method == "GET" && path == "/e2ee/v1/status" || method == "POST" && posts.any { path == "/e2ee/v1$it" } || driveRoute(method,path)
    fun responseLimit(path: String): Int = when (path) {
        "/e2ee/v1/directory" -> 32 * 1024 * 1024
        "/e2ee/v1/read" -> 16 * 1024 * 1024
        "/e2ee/v1/command" -> 8 * 1024 * 1024
        "/e2ee/v1/membership-preview", "/e2ee/v1/membership-graph", "/e2ee/v1/membership-atomic-preview", "/e2ee/v1/membership-atomic-receipt-page" -> 4 * 1024 * 1024
        "/private-drive/v1/download" -> 25 * 1024 * 1024
        "/private-drive/v1/list" -> 512 * 1024
        "/private-drive/v1/status", "/private-drive/v1/connect", "/private-drive/v1/authorize", "/private-drive/v1/disconnect", "/private-drive/v1/prepare", "/private-drive/v1/commit" -> 16384
        else -> 256 * 1024
    }
    fun errorCode(status: Int, payload: JSONObject): String? = payload.optString("error").takeIf {
        status in 400..599 && it.matches(Regex("(?:E2EE|DRIVE)_[A-Z_]{1,80}"))
    }
    fun transport(client: AuthSessionClient, generation: Long, requireAccount: () -> Unit): E2eeScopeTransport = object : E2eeScopeTransport {
        private fun call(path: String, body: JSONObject): JSONObject {
            requireAccount()
            return client.e2ee(generation, path, body).also { requireAccount() }
        }
        override fun directory(scopeId: String) = call("/directory", JSONObject().put("scopeId", scopeId))
        override fun command(packet: JSONObject) = call("/command", packet)
        override fun read(packet: JSONObject) = call("/read", packet)
    }
}
