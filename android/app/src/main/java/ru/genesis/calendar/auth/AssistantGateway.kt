package ru.genesis.calendar.auth

import org.json.JSONObject

internal interface AssistantGateway {
    fun check()
    suspend fun status(): JSONObject
    suspend fun plan(command: String, audio: JSONObject?, context: JSONObject): JSONObject
    suspend fun planWithConsent(command:String,audio:JSONObject?,context:JSONObject,provider:String,consent:ru.genesis.calendar.security.ExternalCopyConsent):JSONObject=throw IllegalStateException("E2EE_EXTERNAL_COPY_CONSENT_REQUIRED")
}

internal fun allowedAssistantRoute(method: String, path: String) =
    method == "GET" && path == "/assistant/status" || method == "POST" && path in setOf("/assistant/plan","/private-services/assistant/plan")
