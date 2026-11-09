package ru.genesis.calendar.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

internal interface MessagingStore {
    suspend fun read(key: String): String?
    suspend fun write(key: String, value: String)
    suspend fun delete(key: String)
}

/** Each file chunk, identity, draft and command has its own bounded, authenticated Room cell. */
internal class MessagingRoomStore(private val database: GenesisDatabase, private val scope: String, private val owner: String) : MessagingStore {
    private val cipher = LocalCipher()
    private fun kind(key: String): String {
        require(key.matches(Regex("[A-Za-z0-9_:/-]{1,180}")))
        return "messaging-v1/$key"
    }
    private fun aad(key: String) = "$scope/messaging-v1:$owner:$key"
    override suspend fun read(key: String): String? = withContext(Dispatchers.IO) {
        database.dao().document(scope, kind(key))?.let { cipher.decrypt(it.encrypted, aad(key)) }
    }
    override suspend fun write(key: String, value: String) = withContext(Dispatchers.IO) {
        val encrypted = cipher.encrypt(value, aad(key))
        require(encrypted.length <= 512 * 1024) { "MESSAGING_CELL_TOO_LARGE" }
        database.dao().putDocument(DocumentRecord(scope, kind(key), encrypted, 1))
    }
    override suspend fun delete(key: String) = withContext(Dispatchers.IO) { database.dao().deleteDocument(scope, kind(key)) }
}
