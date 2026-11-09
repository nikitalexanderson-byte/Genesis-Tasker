package ru.genesis.calendar.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import androidx.room.withTransaction
import org.json.JSONArray
import java.util.UUID

/** Store receives ciphertext only. The Room schema and existing Android Keystore key remain unchanged. */
internal interface DiaryStore {
    suspend fun read(): String?
    suspend fun write(ciphertext: String)
}
internal interface DiaryCacheCipher {
    fun encrypt(plaintext: String): String
    fun decrypt(ciphertext: String): String
}
internal class DiaryRoomStore(private val database: GenesisDatabase, private val scope: String) : DiaryStore {
    private val mutation=ru.genesis.calendar.auth.NativeBackupMutationGuard(scope)
    private val prefix = "genesis-diary-chunks-v1:"
    private fun manifest(value: String): Triple<String, Int, Int>? {
        if (!value.startsWith(prefix)) return null
        val row = JSONArray(value.removePrefix(prefix))
        val generation = row.getString(0)
        val count = row.getInt(1)
        val length = row.getInt(2)
        require(row.length() == 3 && generation.matches(Regex("[a-f0-9-]{36}")) && count in 1..4096 && length >= 0) { "DIARY_INVALID_CACHE" }
        return Triple(generation, count, length)
    }
    private fun chunkKind(generation: String, index: Int) = "diary-v1/$generation/$index"
    override suspend fun read(): String? = withContext(Dispatchers.IO) {
        database.withTransaction {
            val value = database.dao().document(scope, "diary-v1")?.encrypted ?: return@withTransaction null
            val row = manifest(value) ?: return@withTransaction value // Previous single-row cache remains readable.
            buildString(row.third.coerceAtMost(1024 * 1024)) {
                repeat(row.second) { index ->
                    append(requireNotNull(database.dao().document(scope, chunkKind(row.first, index))) { "DIARY_INVALID_CACHE" }.encrypted)
                }
            }.also { require(it.length == row.third) { "DIARY_INVALID_CACHE" } }
        }
    }
    override suspend fun write(ciphertext: String) = withContext(Dispatchers.IO) {
        database.withTransaction {
            mutation.check()
            val old = database.dao().document(scope, "diary-v1")?.encrypted?.let(::manifest)
            val generation = UUID.randomUUID().toString()
            // Ciphertext is ASCII; each cell stays well below Android's CursorWindow single-row limit.
            val chunks = ciphertext.chunked(384 * 1024).ifEmpty { listOf("") }
            require(chunks.size <= 4096) { "DIARY_CACHE_TOO_LARGE" }
            chunks.forEachIndexed { index, chunk ->
                database.dao().putDocument(DocumentRecord(scope, chunkKind(generation, index), chunk, 1))
            }
            database.dao().putDocument(DocumentRecord(scope, "diary-v1", prefix + JSONArray().put(generation).put(chunks.size).put(ciphertext.length), 1))
            if (old != null) repeat(old.second) { database.dao().deleteDocument(scope, chunkKind(old.first, it)) }
        }
    }
}
internal class DiaryKeystoreCipher(scope: String, owner: String) : DiaryCacheCipher {
    private val cipher = LocalCipher()
    private val aad = "$scope/diary-v1:$owner"
    override fun encrypt(plaintext: String): String = cipher.encrypt(plaintext, aad)
    override fun decrypt(ciphertext: String): String = cipher.decrypt(ciphertext, aad)
}
