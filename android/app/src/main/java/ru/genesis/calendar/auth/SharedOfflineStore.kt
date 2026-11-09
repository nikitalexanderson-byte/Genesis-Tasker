package ru.genesis.calendar.auth

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.data.LocalCipher

/** Account-scoped team snapshots and unsent task drafts, encrypted with Android Keystore. */
internal class SharedOfflineStore(context: Context) {
    private val preferences = context.getSharedPreferences("genesis.shared.offline.v1", Context.MODE_PRIVATE)
    private val cipher = LocalCipher()

    private fun cacheKey(userId: String, path: String) = "cache:$userId:$path"
    private fun queueKey(userId: String) = "queue:$userId"
    private fun read(key: String): String? = preferences.getString(key, null)?.let { cipher.decrypt(it, key) }
    private fun write(key: String, value: String) {
        check(preferences.edit().putString(key, cipher.encrypt(value, key)).commit()) {
            "Shared offline data could not be saved"
        }
    }

    @Synchronized fun saveSnapshot(userId: String, path: String, payload: JSONObject) {
        write(cacheKey(userId, path), JSONObject().put("savedAt", System.currentTimeMillis())
            .put("payload", payload).toString())
    }

    @Synchronized fun snapshot(userId: String, path: String): JSONObject? {
        val saved = read(cacheKey(userId, path))?.let(::JSONObject) ?: return null
        val age = System.currentTimeMillis() - saved.optLong("savedAt", 0)
        if (age !in 0..30L * 24 * 60 * 60 * 1000) return null
        return JSONObject(saved.getJSONObject("payload").toString()).put("offlineCache", true)
    }

    @Synchronized fun queued(userId: String): List<JSONObject> {
        val rows = read(queueKey(userId))?.let(::JSONArray) ?: JSONArray()
        return (0 until rows.length()).map { rows.getJSONObject(it) }
    }

    @Synchronized fun enqueue(userId: String, item: JSONObject) {
        val rows = queued(userId).toMutableList()
        require(rows.size < 100) { "Shared offline queue is full" }
        rows.add(item)
        write(queueKey(userId), JSONArray(rows).toString())
    }

    @Synchronized fun remove(userId: String, requestId: String) {
        write(queueKey(userId), JSONArray(queued(userId)
            .filter { it.optString("requestId") != requestId }).toString())
    }

    @Synchronized fun markError(userId: String, requestId: String, code: String) {
        write(queueKey(userId), JSONArray(queued(userId).map { item ->
            if (item.optString("requestId") == requestId) item.put("error", code) else item
        }).toString())
    }

    @Synchronized fun clear(userId: String) {
        val keys = preferences.all.keys.filter { it == queueKey(userId) || it.startsWith("cache:$userId:") }
        val editor = preferences.edit()
        keys.forEach(editor::remove)
        check(editor.commit()) { "Shared offline data could not be cleared" }
    }

    @Synchronized fun clearSnapshots(userId: String) {
        val editor = preferences.edit()
        preferences.all.keys.filter { it.startsWith("cache:$userId:") }.forEach(editor::remove)
        check(editor.commit()) { "Shared offline snapshots could not be cleared" }
    }
}
