package ru.genesis.calendar.data

import androidx.room.withTransaction
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.auth.AuroraProtocol
import ru.genesis.calendar.auth.AuthFailure
import ru.genesis.calendar.security.WorkspaceCipher
import java.util.Base64

internal interface AuroraGateway {
    fun check()
    suspend fun workspace(): JSONObject
    suspend fun request(method: String, path: String, body: JSONObject?): JSONObject
    suspend fun billing(method: String, path: String, body: JSONObject?): JSONObject
}

/** JS never receives the workspace key. Both cloud AAD and local Room AAD
 * include the captured owner/scope; a delayed request cannot cross accounts. */
internal class AuroraNativeStore(private val app: GenesisApplication, private val owner: String,
    private val scope: String, private val gateway: AuroraGateway) : AutoCloseable {
    private val cipher = LocalCipher()
    private val lock = Mutex()
    private val mutation=ru.genesis.calendar.auth.NativeBackupMutationGuard(scope)
    private var memoryKey: ByteArray? = null
    private fun check() { mutation.check();gateway.check(); check(app.workspaceScope == scope) { "AURORA_ACCOUNT_CHANGED" } }
    private fun aad(kind: String) = "$scope/aurora/$owner/$kind"
    private suspend fun workspaceKey(): ByteArray = lock.withLock {
        check(); memoryKey?.let { return@withLock it.copyOf() }
        val cached = app.database.dao().document(scope, "aurora-account-key")
        val key = try {
            val response = gateway.workspace().getJSONObject("workspace"); check()
            require(response.getString("keyMode") == "account") { "AURORA_WORKSPACE_UNLOCK_REQUIRED" }
            WorkspaceCipher.decodeKey(response.getString("key")).also { bytes ->
                val wrapped = cipher.encrypt(Base64.getEncoder().encodeToString(bytes), aad("account-key"))
                app.database.withTransaction { check(); app.database.dao().putDocument(DocumentRecord(scope, "aurora-account-key", wrapped, 1)); check() }
            }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (error: AuthFailure) {
            if (cached == null || error.kind !in setOf(AuthFailure.Kind.NETWORK, AuthFailure.Kind.SERVER, AuthFailure.Kind.NOT_DEPLOYED)) throw error
            check(); WorkspaceCipher.decodeKey(cipher.decrypt(cached.encrypted, aad("account-key")))
        }
        check(); memoryKey = key.copyOf(); key
    }
    suspend fun getItem(key: String): String? {
        check(); val kind = AuroraProtocol.cacheKind(owner, key)
        val row = app.database.dao().document(scope, kind) ?: return null
        return cipher.decrypt(row.encrypted, aad(kind)).also { check() }
    }
    suspend fun setItem(key: String, value: String) {
        check(); require(value.length <= 8_100_000) { "AURORA_CACHE_TOO_LARGE" }
        val kind = AuroraProtocol.cacheKind(owner, key)
        val encrypted = cipher.encrypt(value, aad(kind))
        app.database.withTransaction { check(); app.database.dao().putDocument(DocumentRecord(scope, kind, encrypted, System.currentTimeMillis())); check() }
    }
    suspend fun removeItem(key: String) { app.database.withTransaction { check(); app.database.dao().deleteDocument(scope, AuroraProtocol.cacheKind(owner, key)); check() } }
    suspend fun seal(value: Any, scopeName: String): JSONObject {
        check(); require(AuroraProtocol.allowedScope(scopeName)); val key = workspaceKey()
        return try {
            val plain = value.toString().toByteArray(Charsets.UTF_8)
            try { val sealed = WorkspaceCipher.encrypt(plain, key, "genesis-mindmap-v1:$owner:$scopeName".toByteArray())
                check(); JSONObject().put("iv", sealed.iv).put("ciphertext", sealed.ciphertext)
            } finally { plain.fill(0) }
        } finally { key.fill(0) }
    }
    suspend fun open(value: JSONObject, scopeName: String): Any {
        check(); require(AuroraProtocol.allowedScope(scopeName)); val key = workspaceKey()
        return try {
            val plain = WorkspaceCipher.decrypt(WorkspaceCipher.Envelope(value.getString("ciphertext"), value.getString("iv")), key,
                "genesis-mindmap-v1:$owner:$scopeName".toByteArray())
            try { check(); org.json.JSONTokener(plain.toString(Charsets.UTF_8)).nextValue() } finally { plain.fill(0) }
        } finally { key.fill(0) }
    }
    suspend fun request(method: String, path: String, body: JSONObject?): JSONObject {
        check(); require(AuroraProtocol.allowedRoute(method, path)); return gateway.request(method, path, body).also { check() }
    }
    suspend fun billing(method: String, path: String, body: JSONObject?): JSONObject {
        check(); require(AuroraProtocol.allowedBilling(method, path)); return gateway.billing(method, path, body).also { check() }
    }
    override fun close() { memoryKey?.fill(0); memoryKey = null }
}
