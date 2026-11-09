package ru.genesis.calendar.auth

import android.content.Context
import ru.genesis.calendar.data.LocalCipher

/** Shared by all editors in the app process; corruption never becomes an empty draft. */
internal class PlanningDraftStore(context: Context, purpose: String = "planning") : PlanningJournalStorage {
    companion object { private val guard = Any() }
    init { require(purpose in setOf("planning", "workflow", "data-import", "project-access", "bulk", "bulk-input", "templates", "automations", "automation-editor", "field-editor", "saved-views")) }
    private val preferences = context.getSharedPreferences("genesis.shared.$purpose.v1", Context.MODE_PRIVATE)
    private val cipher = LocalCipher()
    fun clear() = synchronized(guard) {
        check(preferences.edit().clear().commit()) { "PLANNING_DRAFT_STORAGE" }
    }
    override fun <T> locked(block: () -> T): T = synchronized(guard, block)
    override fun read(key: String): String? = preferences.getString(key, null)?.let { cipher.decrypt(it, key) }
    override fun write(key: String, value: String) {
        val previous = preferences.getString(key, null)
        if (!preferences.edit().putString(key, cipher.encrypt(value, key)).commit()) {
            restoreMemory(key, previous)
            error("PLANNING_DRAFT_STORAGE")
        }
    }
    override fun remove(key: String) {
        val previous = preferences.getString(key, null)
        if (!preferences.edit().remove(key).commit()) {
            restoreMemory(key, previous)
            error("PLANNING_DRAFT_STORAGE")
        }
    }
    // SharedPreferences updates its memory cache even when the synchronous disk commit fails.
    private fun restoreMemory(key: String, previous: String?) {
        runCatching { preferences.edit().apply { if (previous == null) remove(key) else putString(key, previous) }.commit() }
    }
}
