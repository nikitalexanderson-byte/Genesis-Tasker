package ru.genesis.calendar.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

internal interface MessagingStore {
    suspend fun read(key: String): String?
    suspend fun write(key: String, value: String)
    suspend fun delete(key: String)
}

/** Each file chunk, identity, draft and command has its own bounded, authenticated Room cell. */
internal class MessagingRoomStore(private val database: GenesisDatabase, private val scope: String, private val owner: String,
    private val assertOwner:()->Unit={ru.genesis.calendar.security.UpdateGate.requireOpen()}) : MessagingStore {
    private val cipher = LocalCipher()
    private fun kind(key: String): String {
        require(key.matches(Regex("[A-Za-z0-9_:/-]{1,180}")))
        return "messaging-v1/$key"
    }
    private fun aad(key: String) = "$scope/messaging-v1:$owner:$key"
    private suspend fun original(key:String):String?{assertOwner();val row=database.dao().document(scope,kind(key));assertOwner();return row?.let{cipher.decrypt(it.encrypted,aad(key)).also{assertOwner()}}}
    private fun protected()=ru.genesis.calendar.security.NativePrivateProducts.isProtected(scope)
    private fun privateCell(key:String):ru.genesis.calendar.security.NativePrivateLocalCell{assertOwner();kind(key);return ru.genesis.calendar.security.NativePrivateLocalCell(scope,owner,"messaging-v1",key,assertOwner)}
    override suspend fun read(key: String): String? = withContext(Dispatchers.IO) {
        assertOwner();(if(protected())privateCell(key).load{original(key)}else original(key)).also{assertOwner()}
    }
    override suspend fun write(key: String, value: String) = withContext(Dispatchers.IO) {
        assertOwner();if(protected()){require(value.toByteArray(Charsets.UTF_8).size<=512*1024){"MESSAGING_CELL_TOO_LARGE"};privateCell(key).save(value){original(key)};assertOwner();return@withContext}
        val encrypted = cipher.encrypt(value, aad(key))
        require(encrypted.length <= 512 * 1024) { "MESSAGING_CELL_TOO_LARGE" }
        assertOwner();database.dao().putDocument(DocumentRecord(scope, kind(key), encrypted, 1));assertOwner()
    }
    override suspend fun delete(key: String) = withContext(Dispatchers.IO) { assertOwner();ru.genesis.calendar.security.UpdateGate.requireOpen();if(protected())privateCell(key).save(null){original(key)}else database.dao().deleteDocument(scope, kind(key));assertOwner() }
}
