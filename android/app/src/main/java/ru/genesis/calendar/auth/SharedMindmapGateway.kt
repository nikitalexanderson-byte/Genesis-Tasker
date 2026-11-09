package ru.genesis.calendar.auth

import org.json.JSONObject

interface SharedMindmapGateway {
    suspend fun sharedMindmapWorkspace(): JSONObject = throw UnsupportedOperationException("sharedMindmapWorkspace")
    fun checkSharedMindmapAccount(uid: String): Unit = throw UnsupportedOperationException("checkSharedMindmapAccount")
    suspend fun sharedMindmapDocument(space: String, path: String, body: JSONObject?, method: String): JSONObject = throw UnsupportedOperationException("sharedMindmapDocument")
}

internal object SharedMindmapProtocol {
    fun mapId(value: String): String = value.also { require(Regex("[A-Za-z0-9_-]{1,100}").matches(it)) { "INVALID_MINDMAP" } }
    fun relativePath(value: String): String = value.also {
        require(Regex("/mindmaps(?:/[A-Za-z0-9_-]{1,100}(?:/history)?)?").matches(it)) { "INVALID_MINDMAP_PATH" }
    }
    fun route(space: String, path: String, method: String): String {
        SharedTaskLifecycleProtocol.id(space); relativePath(path)
        require(when (method) {
            "GET" -> true
            "PUT", "DELETE" -> Regex("/mindmaps/[A-Za-z0-9_-]{1,100}").matches(path)
            else -> false
        }) { "INVALID_MINDMAP_PATH" }
        return "/shared/spaces/$space$path"
    }
    fun scope(accountScope: String, space: String): String { SharedTaskLifecycleProtocol.id(space); return "$accountScope:shared-mindmaps:$space" }
    fun uid(uid: String, space: String): String { require(uid.isNotBlank()); SharedTaskLifecycleProtocol.id(space); return "$uid:shared:$space" }
    fun aad(uid: String, space: String, map: String): ByteArray = "genesis-mindmap-v1:${uid(uid, space)}:map:${mapId(map)}".toByteArray()
}

internal fun allowedSharedMindmapRoute(method: String, path: String): Boolean {
    val match = Regex("/shared/spaces/([a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12})(/mindmaps(?:/[A-Za-z0-9_-]{1,100}(?:/history)?)?)").matchEntire(path) ?: return false
    return runCatching { SharedMindmapProtocol.route(match.groupValues[1], match.groupValues[2], method) }.isSuccess
}

internal fun sharedMindmapAccessLost(failure: Exception): Boolean = when (failure) {
    is AuthFailure -> failure.kind == AuthFailure.Kind.UNAUTHORIZED || failure.httpStatus in setOf(401, 403, 404)
    is AuthApiError -> failure.code in setOf("UNAUTHORIZED", "AUTH_REQUIRED", "SHARED_SPACE_FORBIDDEN", "SHARED_SPACE_NOT_FOUND", "SHARED_PROJECT_FORBIDDEN", "SHARED_PROJECT_NOT_FOUND")
    else -> false
}
