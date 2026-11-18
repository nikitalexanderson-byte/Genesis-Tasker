package ru.genesis.calendar.auth

import android.content.Context
import org.json.JSONObject

/** Same data classification as PHP/web; it grants no endpoint/session access. */
internal class E2eeLegacyTransportPolicy(private val source: JSONObject) {
    private fun names(name: String): List<String> = source.getJSONArray(name).let { rows -> (0 until rows.length()).map { rows.getString(it) } }
    private val prefixes=names("personalPrefixes")
    private val exact=names("personalExact")
    private val metadata=names("metadataPreferenceKeys").toSet()
    private val preferences=source.getString("preferencesPath")
    init { check(source.getInt("version") == 1 && (prefixes+exact+metadata).all { it.matches(Regex("[A-Za-z][A-Za-z0-9/-]{0,100}")) }) { "E2EE_INVALID_TRANSPORT_POLICY" } }
    fun protected(method: String,path: String,body: JSONObject?): Boolean {
        val route=path.trimStart('/').substringBefore('?')
        if(prefixes.any { route == it || route.startsWith("$it/") || route.startsWith("$it-") } || route in exact)return true
        return route == preferences && method.uppercase(java.util.Locale.ROOT) !in setOf("GET","HEAD","OPTIONS") && body != null && body.keys().asSequence().any { it !in metadata }
    }
    companion object {
        fun load(context: Context) = context.assets.open("legacy-transport-v1.json").bufferedReader().use { E2eeLegacyTransportPolicy(JSONObject(it.readText())) }
    }
}
