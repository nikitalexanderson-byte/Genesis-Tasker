package ru.genesis.calendar.auth

import androidx.room.withTransaction
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.data.DocumentRecord
import ru.genesis.calendar.data.LocalCipher

/** Exact, account-bound server snapshots. No text or identity is stored in alarms or WorkManager. */
internal class AdviceSnapshotStore(private val app: GenesisApplication) {
    private val dao = app.database.dao()
    private val cipher = LocalCipher()
    private val indexKind = "advice-snapshots-v1"
    private fun kind(id: String, day: String, collection: String): String {
        DailyAdviceProtocol.savedPath(id, day, collection)
        return "advice-snapshot-v1-$day-$collection-$id"
    }
    private suspend fun readDocument(scope: String, kind: String): JSONObject? = dao.document(scope, kind)?.let {
        JSONObject(cipher.decrypt(it.encrypted, "$scope/$kind"))
    }
    private suspend fun writeDocument(scope: String, kind: String, value: JSONObject) {
        dao.putDocument(DocumentRecord(scope, kind, cipher.encrypt(value.toString(), "$scope/$kind"), System.currentTimeMillis()))
    }
    private suspend fun index(scope: String): JSONObject {
        require(Regex("account-[a-f0-9]{32}").matches(scope))
        return readDocument(scope, indexKind) ?: JSONObject()
    }
    private fun JSONObject.rows(key: String): List<JSONObject> = optJSONArray(key)?.let { rows ->
        (0 until rows.length()).map { rows.getJSONObject(it) }
    }.orEmpty()
    private fun JSONObject.strings(key: String): List<String> = optJSONArray(key)?.let { rows ->
        (0 until rows.length()).map { rows.getString(it) }
    }.orEmpty()

    suspend fun cache(scope: String, response: JSONObject, current: Boolean = true) = app.database.withTransaction {
        val parsed = DailyAdviceProtocol.parse(response)
        val index = index(scope)
        val entries = index.strings("entries").toMutableList()
        val cards = response.optJSONArray("history") ?: JSONArray().apply {
            response.optJSONObject("advice")?.let { put(it) }
        }
        for (position in 0 until cards.length()) {
            val card = JSONObject(cards.getJSONObject(position).toString())
            val slot = card.optInt("sequence", parsed.sequence.coerceAtLeast(1))
            card.put("sequence", slot)
            val key = kind(card.getString("id"), parsed.day, card.optString("collection", "aurora"))
            val saved = JSONObject().put("dayKey", parsed.day).put("state", "ready").put("advice", card)
                .put("history", JSONArray().put(card)).put("sequence", slot).put("dailyLimit", 1)
                .put("canNext", false).put("remaining", 0)
            DailyAdviceProtocol.parse(saved)
            writeDocument(scope, key, saved)
            entries.remove(key); entries.add(key)
        }
        if (current) {
            val card = parsed.advice
            val latest = index.rows("latest").filterNot {
                it.optString("day") == parsed.day && (card == null || it.optString("language") == card.language)
            }.toMutableList()
            if (card != null) latest.add(JSONObject().put("day", card.day).put("language", card.language)
                .put("kind", kind(card.id, card.day, card.collection)))
            index.put("latest", JSONArray(latest.takeLast(35)))
        }
        // Keep notified snapshots when newer Today history fills the bounded cache.
        val pinned = index.rows("targets").map { it.getString("kind") }.toSet()
        val retained = entries.filter { it in pinned } + entries.filterNot { it in pinned }.takeLast((64 - pinned.size).coerceAtLeast(0))
        entries.filterNot { it in retained }.forEach { dao.deleteDocument(scope, it) }
        index.put("entries", JSONArray(retained.distinct()))
        writeDocument(scope, indexKind, index)
    }

    suspend fun saved(scope: String, id: String, day: String, collection: String): JSONObject? {
        index(scope) // Validate the account scope even when there is no index yet.
        return readDocument(scope, kind(id, day, collection))?.also { DailyAdviceProtocol.parse(it) }
    }

    suspend fun latest(scope: String, day: String, language: String): JSONObject? {
        val key = index(scope).rows("latest").lastOrNull { it.optString("day") == day && it.optString("language") == language }
            ?.getString("kind") ?: return null
        return readDocument(scope, key)?.also { DailyAdviceProtocol.parse(it) }
    }

    /** First selection wins even if a user explicitly draws a later card before a delivery retry. */
    suspend fun notificationTarget(scope: String, day: String, candidate: DailyAdvice?): JSONObject? = app.database.withTransaction {
        val index = index(scope)
        val targets = index.rows("targets").toMutableList()
        val existing = targets.firstOrNull { it.getString("day") == day }
        val key = existing?.getString("kind") ?: candidate?.takeIf { it.day == day }?.let { kind(it.id, it.day, it.collection) }
            ?: return@withTransaction null
        val saved = readDocument(scope, key) ?: return@withTransaction null
        DailyAdviceProtocol.parse(saved)
        if (existing == null) {
            targets.add(JSONObject().put("day", day).put("kind", key))
            index.put("targets", JSONArray(targets.takeLast(35)))
            writeDocument(scope, indexKind, index)
        }
        saved
    }

    suspend fun delivered(scope: String, day: String): Boolean = day in index(scope).strings("delivered")
    suspend fun markDelivered(scope: String, day: String) = app.database.withTransaction {
        val index = index(scope)
        index.put("delivered", JSONArray((index.strings("delivered").filterNot { it == day } + day).takeLast(35)))
        writeDocument(scope, indexKind, index)
    }

    suspend fun invalidate(scope: String, id: String, day: String, collection: String) = app.database.withTransaction {
        val key = kind(id, day, collection)
        dao.deleteDocument(scope, key)
        val index = index(scope)
        index.put("entries", JSONArray(index.strings("entries").filterNot { it == key }))
        index.put("latest", JSONArray(index.rows("latest").filterNot { it.optString("kind") == key }))
        writeDocument(scope, indexKind, index)
    }
}
