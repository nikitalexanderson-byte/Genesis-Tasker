package ru.genesis.calendar.auth

import org.json.JSONObject

/** Only this independent ciphertext service; no legacy backup/content fallback. */
internal interface PrivateDriveGateway{
    fun current()
    fun request(path:String,body:JSONObject?=null,call:ForegroundAccountCall?=null):JSONObject
}
