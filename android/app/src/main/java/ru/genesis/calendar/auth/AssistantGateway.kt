package ru.genesis.calendar.auth

import org.json.JSONObject

internal interface AssistantGateway {
    fun check()
    suspend fun status(): JSONObject
    suspend fun plan(command: String, audio: JSONObject?, context: JSONObject): JSONObject
}

internal fun allowedAssistantRoute(method: String, path: String) =
    method == "GET" && path == "/assistant/status" || method == "POST" && path == "/assistant/plan"
