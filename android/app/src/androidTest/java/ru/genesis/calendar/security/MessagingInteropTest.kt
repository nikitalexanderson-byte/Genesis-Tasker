package ru.genesis.calendar.security

import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/** Actual TS WebCrypto fixture on Android's cryptographic providers, independent from the native roundtrip tests. */
class MessagingInteropTest {
    @Test fun webCryptoMessageFileAndUnicodeBackupDecryptOnAndroid() {
        val a = JSONObject("""{"kty":"EC","crv":"P-256","x":"axfR8uEsQkf4vOblY6RA8ncDfYEt6zOg9KE5RdiYwpY","y":"T-NC4v4af5uO5-tKfA-eFivOM1drMV7Oy7ZAaDe_UfU","d":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAE"}""")
        val b = JSONObject("""{"kty":"EC","crv":"P-256","x":"fPJ7GI0DT36KUjgDBLUaw8CJaeJ38hs1pgtI_EdmmXg","y":"B3dVENuO0EApPZrGn3Qw27p9reY86YIpngS3nSJ4c9E"}""")
        val context = MessageContext("10000000-0000-0000-0000-000000000001", "20000000-0000-0000-0000-000000000002", "30000000-0000-0000-0000-000000000003", "owner-a", 1)
        val identity = MessagingCrypto.importIdentity(a)
        val key = MessagingCrypto.conversationKey(identity, b, context.conversationId, context.spaceId)
        val ids = mapOf("owner-a" to identity.keyId, "owner-b" to MessagingCrypto.fingerprint(b))
        try {
            val payload = JSONObject().put("version", 1).put("iv", "X9J3kWIjOBFRdxDJ").put("ciphertext", "S3FkXPzOq0hLuqzVGNAqmqLxeIDeZA-tMV70ZyD_ZRp1uN0uSUf5BGdBlrsv_VhyiHYSSQiWSKwDGJ9_tsE2UQ").put("keyIds", JSONObject(ids))
            assertEquals("GENESIS — личное сообщение 🔒", MessagingCrypto.decryptMessage(key, context, payload, ids))
            val file = PrivateFileMetadata("40000000-0000-0000-0000-000000000004", "fixture.txt", "text/plain", 32, "H8jXmnqivLY76f_i", 1)
            assertEquals("GENESIS private file — fixture", MessagingCrypto.decryptFile(key, context.copy(revision = 2), file, listOf("BcK_QvFVe9ZO8rn_I56KLhX8M0BPScNcYs-joylLerifq6gBLxC7UTE5MNXbi-RF")).toString(Charsets.UTF_8))
            val source = InstrumentationRegistry.getInstrumentation().context.assets.open("messaging/webcrypto-backup.json").bufferedReader().use { it.readText() }
            assertEquals(identity.keyId, MessagingCrypto.importBackup(source, "Fixture backup пароль 2026").keyId)
        } finally { key.fill(0) }
    }
}
