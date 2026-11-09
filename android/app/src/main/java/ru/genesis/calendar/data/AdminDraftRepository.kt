package ru.genesis.calendar.data

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.auth.AdminGateway
import java.util.concurrent.ConcurrentHashMap

/** Includes uncertain POST intent; no request is ever replayed by this store. */
internal class AdminDraftRepository(private val database: GenesisDatabase, private val scope: String, uid: String, private val checkScope: () -> Unit) {
    constructor(app: GenesisApplication, uid: String, gateway: AdminGateway) : this(app.database, app.workspaceScope, uid, gateway::check)
    private val kind = "admin-ad-draft-v1"
    private val aad = "$scope/$kind/$uid"
    private val cipher = LocalCipher()
    private val mutex = locks.getOrPut(aad) { Mutex() }
    private fun check() { checkScope() }
    suspend fun load(): JSONObject? = mutex.withLock {
        check()
        database.dao().document(scope, kind)?.let { row -> JSONObject(cipher.decrypt(row.encrypted, aad)).also { check() } }
    }
    suspend fun save(state: JSONObject): Boolean = mutex.withLock {
        check(); require(state.getInt("schemaVersion") == 1 && state.toString().toByteArray().size <= 800_000)
        require(state.getString("draftId").isNotBlank() && state.getLong("generation") >= 0)
        val stored = database.dao().document(scope, kind)?.let { JSONObject(cipher.decrypt(it.encrypted, aad)) }
        if (stored != null && stored.getLong("generation") >= state.getLong("generation")) return@withLock stored.toString() == state.toString()
        database.dao().putDocument(DocumentRecord(scope, kind, cipher.encrypt(state.toString(), aad), System.currentTimeMillis())); check()
        true
    }
    companion object { private val locks = ConcurrentHashMap<String, Mutex>() }
}
