package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject

/** Undo is idempotent by import ID; preserve its identity before the first request and after a lost response. */
internal class DataImportUndoJournal(private val storage: PlanningJournalStorage) {
    private fun key(account: String, space: String): String {
        require(account.isNotBlank() && PlanningLifecycle.id(space)); return "data-import-undo-v1:${account.length}:$account:$space"
    }
    private fun read(account: String, space: String): List<JSONObject> {
        val raw = storage.read(key(account, space)) ?: return emptyList()
        require(raw.toByteArray(Charsets.UTF_8).size <= 2_000_000) { "DATA_UNDO_JOURNAL_INVALID" }
        val rows = JSONArray(raw); require(rows.length() <= 100) { "DATA_UNDO_JOURNAL_INVALID" }
        return (0 until rows.length()).map { DataImportProtocol.receipt(rows.getJSONObject(it), space) }.also { values ->
            require(values.map { it.getString("importId") }.toSet().size == values.size) { "DATA_UNDO_JOURNAL_INVALID" }
        }
    }
    private fun write(account: String, space: String, values: List<JSONObject>) {
        require(values.size <= 100) { "DATA_UNDO_JOURNAL_LIMIT" }
        val raw = JSONArray(values).toString(); require(raw.toByteArray(Charsets.UTF_8).size <= 2_000_000) { "DATA_UNDO_JOURNAL_LIMIT" }
        storage.write(key(account, space), raw)
    }
    fun pending(account: String, space: String): List<JSONObject> = storage.locked { read(account, space).filter { it.getString("state") == "active" } }
    fun outcomes(account: String, space: String): List<JSONObject> = storage.locked { read(account, space).filter { it.getString("state") == "undone" } }
    fun prepare(account: String, space: String, receipt: JSONObject): JSONObject = storage.locked {
        val valid = DataImportProtocol.receipt(receipt, space).put("notices", JSONArray())
        require(valid.getString("state") == "active" && valid.getBoolean("canUndo")) { "DATA_UNDO_UNAVAILABLE" }
        val rows = read(account, space); val previous = rows.find { it.getString("importId") == valid.getString("importId") }
        if (previous != null) return@locked previous
        val active = rows.filter { it.getString("state") == "active" }; val outcomes = rows.filter { it.getString("state") != "active" }.takeLast(49)
        write(account, space, active + outcomes + valid); valid
    }
    fun succeeded(account: String, space: String, import: String, response: JSONObject) = storage.locked {
        require(response.opt("importId") == import && response.opt("state") == "undone") { "DATA_UNDO_RECEIPT_INVALID" }
        val values = read(account, space)
        require(values.any { it.getString("importId") == import }) { "DATA_UNDO_JOURNAL_INVALID" }
        write(account, space, values.map { if (it.getString("importId") == import) JSONObject(it.toString()).put("state", "undone").put("canUndo", false) else it })
    }
    fun rejected(account: String, space: String, import: String) = storage.locked {
        // A conservative server conflict proves no undo occurred; subsequent edits are preserved.
        write(account, space, read(account, space).filterNot { it.getString("importId") == import })
    }
}
