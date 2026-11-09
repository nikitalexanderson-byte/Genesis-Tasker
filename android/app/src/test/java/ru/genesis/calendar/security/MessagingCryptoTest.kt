package ru.genesis.calendar.security

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/** Fixtures produced by the actual TS WebCrypto implementation, not a second native encoder. */
class MessagingCryptoTest {
    private val a = JSONObject("""{"kty":"EC","crv":"P-256","x":"axfR8uEsQkf4vOblY6RA8ncDfYEt6zOg9KE5RdiYwpY","y":"T-NC4v4af5uO5-tKfA-eFivOM1drMV7Oy7ZAaDe_UfU","d":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAE"}""")
    private val b = JSONObject("""{"kty":"EC","crv":"P-256","x":"fPJ7GI0DT36KUjgDBLUaw8CJaeJ38hs1pgtI_EdmmXg","y":"B3dVENuO0EApPZrGn3Qw27p9reY86YIpngS3nSJ4c9E","d":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAI"}""")
    private val context = MessageContext("10000000-0000-0000-0000-000000000001", "20000000-0000-0000-0000-000000000002", "30000000-0000-0000-0000-000000000003", "owner-a", 1)
    private val ids = mapOf("owner-a" to "77ec6ff4a7a726410b4a3be87397d1deaf41fdf80f3ea8d39fddaf8b45107ca2", "owner-b" to "288da2e4c8d0d72cd1702cb9212548b6066b551a239c03af2f750690409a13b5")
    private fun key() = MessagingCrypto.conversationKey(MessagingCrypto.importIdentity(a), b, context.conversationId, context.spaceId)
    @Test fun webCryptoMessageAndFingerprints() {
        assertEquals(ids["owner-a"], MessagingCrypto.fingerprint(a)); assertEquals(ids["owner-b"], MessagingCrypto.fingerprint(b))
        assertEquals("e9bd7 78fe3 0ca17 bebd7 7ed9e f74c1 cbb7d d0e60", MessagingCrypto.securityCode(ids.values.toList()))
        val payload = JSONObject().put("version", 1).put("iv", "X9J3kWIjOBFRdxDJ").put("ciphertext", "S3FkXPzOq0hLuqzVGNAqmqLxeIDeZA-tMV70ZyD_ZRp1uN0uSUf5BGdBlrsv_VhyiHYSSQiWSKwDGJ9_tsE2UQ").put("keyIds", JSONObject(ids))
        assertEquals("GENESIS — личное сообщение 🔒", MessagingCrypto.decryptMessage(key(), context, payload, ids))
        val reverse = MessagingCrypto.conversationKey(MessagingCrypto.importIdentity(b), a, context.conversationId, context.spaceId)
        assertArrayEquals(key(), reverse)
        val sealed = MessagingCrypto.encryptMessage(key(), context, "Ответ", ids)
        assertEquals("Ответ", MessagingCrypto.decryptMessage(reverse, context, sealed, ids))
        assertThrows(Exception::class.java) { MessagingCrypto.decryptMessage(key(), context.copy(revision = 2), payload, ids) }
        assertThrows(Exception::class.java) { MessagingCrypto.decryptMessage(key(), context, payload, ids + ("owner-b" to "0".repeat(64))) }
    }
    @Test fun webCryptoFileAadSurvivesMessageEdit() {
        val file = PrivateFileMetadata("40000000-0000-0000-0000-000000000004", "fixture.txt", "text/plain", 32, "H8jXmnqivLY76f_i", 1)
        val chunk = "BcK_QvFVe9ZO8rn_I56KLhX8M0BPScNcYs-joylLerifq6gBLxC7UTE5MNXbi-RF"
        assertEquals("GENESIS private file — fixture", MessagingCrypto.decryptFile(key(), context.copy(revision = 4), file, listOf(chunk)).toString(Charsets.UTF_8))
        assertThrows(Exception::class.java) { MessagingCrypto.decryptFile(key(), context.copy(senderId = "owner-b"), file, listOf(chunk)) }
    }
    @Test fun importsActualWebCryptoBackupWithUnicodePassword() {
        val source = requireNotNull(javaClass.getResourceAsStream("/messaging/webcrypto-backup.json")).bufferedReader().use { it.readText() }
        val identity = MessagingCrypto.importBackup(source, "Fixture backup пароль 2026")
        assertEquals(ids["owner-a"], identity.keyId)
        val exported = MessagingCrypto.exportBackup(identity, "Fixture backup пароль 2026")
        assertEquals(identity.keyId, MessagingCrypto.importBackup(exported, "Fixture backup пароль 2026").keyId)
        assertThrows(Exception::class.java) { MessagingCrypto.importBackup(source, "Incorrect password 2026") }
    }
    @Test fun rejectsPrivatePublicMismatchAndMalformedFiles() {
        assertThrows(Exception::class.java) { MessagingCrypto.importIdentity(JSONObject(a.toString()).put("d", b.getString("d"))) }
        val content = PrivateMessageContent("Файл", listOf(PrivateFileMetadata("40000000-0000-0000-0000-000000000004", "a.txt", "text/plain", 0, "AAAAAAAAAAAAAAAA", 1)))
        val encoded = MessagingCrypto.encodeContent(content)
        assertTrue(encoded.startsWith("{\"format\":\"genesis-private-content\"")); assertEquals(content, MessagingCrypto.content(encoded))
        assertEquals("Старое сообщение", MessagingCrypto.content("Старое сообщение").text)
        assertThrows(Exception::class.java) { MessagingCrypto.file(content.files.single().json().put("chunks", 2)) }
    }
    @Test fun chunksRoundtripAcrossBoundary() {
        val plain = ByteArray(MessagingCrypto.CHUNK_SIZE + 117) { (it % 241).toByte() }
        val sealed = MessagingCrypto.encryptFile(key(), context, "40000000-0000-0000-0000-000000000004", "fixture.bin", "application/octet-stream", plain)
        assertEquals(2, sealed.second.size); assertArrayEquals(plain, MessagingCrypto.decryptFile(key(), context, sealed.first, sealed.second))
    }
}
