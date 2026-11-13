package ru.genesis.calendar.ui

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject
import ru.genesis.calendar.auth.DailyAdviceProtocol
import java.security.MessageDigest

/** Private per-account daily snapshot survives screen changes and process restarts. */
internal class DailyAdviceCache(context: Context, user: String, language: String, preferences: String) {
    private val store = context.getSharedPreferences("daily_advice_day_v1", Context.MODE_PRIVATE)
    private val key = MessageDigest.getInstance("SHA-256").digest("$user\u0000$language\u0000$preferences".toByteArray())
        .joinToString("") { "%02x".format(it) }
    private val mutex get() = locks.getOrPut(key) { Mutex() }
    suspend fun today(day: String, fetch: suspend () -> JSONObject): JSONObject = mutex.withLock {
        val stored = withContext(Dispatchers.IO) { store.getString(key, null) }
        val cached = stored?.let { runCatching { JSONObject(it) }.getOrNull() }
        if (cached?.optString("deviceDay") == day) {
            val value = cached.optJSONObject("response")
            if (value != null && runCatching { DailyAdviceProtocol.parse(value) }.isSuccess) return@withLock value
        }
        val value = fetch()
        DailyAdviceProtocol.parse(value)
        save(day, value)
        value
    }
    suspend fun save(day: String, value: JSONObject) = withContext(Dispatchers.IO) {
        check(store.edit().putString(key, JSONObject().put("deviceDay", day).put("response", value).toString()).commit())
    }
    suspend fun dismiss(day: String, id: String) = mutex.withLock {
        withContext(Dispatchers.IO) {
            val entry = store.getString(key, null)?.let(::JSONObject) ?: return@withContext
            if (entry.optString("deviceDay") != day) return@withContext
            val value = entry.getJSONObject("response")
            value.optJSONObject("advice")?.takeIf { it.optString("id") == id }?.put("dismissed", true)
            value.optJSONArray("history")?.let { rows -> for (index in 0 until rows.length()) {
                rows.getJSONObject(index).takeIf { it.optString("id") == id }?.put("dismissed", true)
            } }
            check(store.edit().putString(key, entry.toString()).commit())
        }
    }
    suspend fun recordOnce(day: String, id: String, record: suspend () -> Unit) = mutex.withLock {
        val marker = "$key:seen:$id"
        if (store.getString(marker, null) == day) return@withLock
        record()
        withContext(Dispatchers.IO) { check(store.edit().putString(marker, day).commit()) }
    }
    companion object { private val locks = java.util.concurrent.ConcurrentHashMap<String, Mutex>() }
}
