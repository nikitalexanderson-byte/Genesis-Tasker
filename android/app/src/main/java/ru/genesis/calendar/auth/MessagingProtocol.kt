package ru.genesis.calendar.auth

import org.json.JSONObject

internal interface MessagingGateway {
    fun check()
    fun featureAccess(): FeatureAccess = FeatureAccess()
    suspend fun request(method: String, path: String, body: JSONObject? = null): JSONObject
}

internal object MessagingProtocol {
    val errors = setOf("PRIVATE_FILE_NOT_READY", "PRIVATE_FILE_CONFLICT", "PRIVATE_FILE_NOT_FOUND", "INVALID_PRIVATE_FILE",
        "MESSAGE_REVISION_CONFLICT", "MESSAGE_NOT_FOUND", "MESSAGE_AUTHOR_REQUIRED", "MESSAGE_STORAGE_LIMIT", "MESSAGE_RATE_LIMIT",
        "MESSAGING_KEY_MISMATCH", "MESSAGING_KEY_REQUIRED", "RECIPIENT_KEY_REQUIRED", "PRIVATE_INVITATION_REQUIRED", "INVITATION_ALREADY_RESPONDED",
        "INVALID_MESSAGE_KEY", "INVALID_CIPHERTEXT", "INVALID_PRIVATE_FILES")
    private const val UUID = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}"
    fun allowedRoute(method: String, path: String): Boolean {
        if (path == "/shared/messenger/conversations") return method in setOf("GET", "POST")
        if (path == "/shared/messenger/contacts") return method in setOf("GET", "POST", "DELETE")
        if (path == "/shared/messenger/blocks") return method == "POST"
        if (path == "/shared/messenger/projects") return method == "GET"
        if (path == "/shared/messenger/devices") return method in setOf("GET", "POST")
        if (Regex("/shared/messenger/devices/$UUID").matches(path)) return method == "DELETE"
        if (Regex("/shared/messenger/conversations/$UUID").matches(path)) return method == "GET"
        if (Regex("/shared/messenger/conversations/$UUID/(membership|read|visibility)").matches(path)) return method == "POST"
        if (Regex("/shared/messenger/conversations/$UUID/messages\\?before=[0-9]{1,16}(?:&deviceId=$UUID)?").matches(path)) return method == "GET"
        if (Regex("/shared/messenger/conversations/$UUID/messages").matches(path)) return method == "POST"
        if (Regex("/shared/messenger/conversations/$UUID/messages/$UUID").matches(path)) return method in setOf("PATCH", "DELETE")
        if (path == "/shared/messaging/key") return method in setOf("GET", "POST")
        if (path == "/shared/messaging/inbox") return method == "GET"
        if (Regex("/shared/messaging/contacts\\?q=[A-Za-z0-9_%+.*~-]*(?:&cursor=$UUID)?").matches(path)) return method == "GET"
        if (Regex("/shared/spaces/$UUID/participants").matches(path)) return method in setOf("GET", "POST")
        if (Regex("/shared/spaces/$UUID/private-conversations").matches(path)) return method == "POST"
        if (Regex("/shared/private-conversations/$UUID").matches(path)) return method == "GET"
        if (Regex("/shared/private-conversations/$UUID/(invitation|read)").matches(path)) return method == "POST"
        if (Regex("/shared/private-conversations/$UUID/messages\\?before=[0-9]{1,16}").matches(path)) return method == "GET"
        if (Regex("/shared/private-conversations/$UUID/messages").matches(path)) return method in setOf("POST", "DELETE")
        if (Regex("/shared/private-conversations/$UUID/messages/$UUID").matches(path)) return method in setOf("PATCH", "DELETE")
        if (Regex("/shared/private-conversations/$UUID/files/$UUID/[0-9]{1,2}").matches(path)) return method in setOf("GET", "PUT")
        return method == "DELETE" && Regex("/shared/private-conversations/$UUID/files/$UUID").matches(path)
    }
}
