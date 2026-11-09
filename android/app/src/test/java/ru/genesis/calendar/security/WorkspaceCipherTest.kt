package ru.genesis.calendar.security

import java.security.GeneralSecurityException
import java.util.Base64
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class WorkspaceCipherTest {
    // Synthetic fixtures only. Generated using the WebCrypto calls in app/cloud-sync.ts.
    private val key = WorkspaceCipher.decodeKey("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=")
    private val iv = "oKGio6Slpqeoqaqr"
    private val plaintext = """{"projects":[{"id":"fixture-project","title":"GENESIS — проверка 🔒"}],"categories":[],"taskListLinks":[],"trackerSchemaVersion":1}""".toByteArray(Charsets.UTF_8)
    private val ciphertext = "nToMXyqhZ9wWFqXpXAHitxSOYzL03joY6XxDqw/ZGmu3FTPdgwAnVCvwYeozWMS8CV4VATHw+P7VftvhdfBVDmQOVdrhJTRaJFLf6BBaXpiwVoeGpqDtH4kaTPPU6W+u1NkHiXfP/PDSsnUkyeGDQ1dyW/WDGblIXa69z9EnoS6tdN0ehSfyZF42kKkoe+zZKEreyAc4p1y9IJQJqMDr"
    private val recoveryCode = "//79/Pv6+fj39vX08/Lx8O/u7ezr6uno5+bl5OPi4eA="
    private val wrappedKey = "0opi4RaSabW86QMDfz6BRo5UdnsG7WMnAlmL+yMFrSgQDotgbJ5o9BTORUuMdKXG"

    @Test fun webCiphertextDecryptsInKotlin() {
        assertArrayEquals(plaintext, WorkspaceCipher.decrypt(WorkspaceCipher.Envelope(ciphertext, iv), key))
    }

    @Test fun kotlinCiphertextMatchesWebCryptoByteForByte() {
        val actual = WorkspaceCipher.encryptWithIv(plaintext, key, Base64.getDecoder().decode(iv))
        assertEquals(ciphertext, actual.ciphertext)
        assertEquals(iv, actual.iv)
    }

    @Test fun webRecoveryUnwrapsOriginalWorkspaceKey() {
        assertArrayEquals(key, WorkspaceCipher.unwrapKey(WorkspaceCipher.Envelope(wrappedKey, iv), recoveryCode))
        val kotlinWrapped = WorkspaceCipher.encryptWithIv(key, WorkspaceCipher.decodeKey(recoveryCode), Base64.getDecoder().decode(iv))
        assertEquals(wrappedKey, kotlinWrapped.ciphertext)
    }

    @Test fun freshEncryptionUsesDifferentIvs() {
        val first = WorkspaceCipher.encrypt(plaintext, key)
        val second = WorkspaceCipher.encrypt(plaintext, key)
        assertNotEquals(first.iv, second.iv)
        assertArrayEquals(plaintext, WorkspaceCipher.decrypt(first, key))
        assertArrayEquals(plaintext, WorkspaceCipher.decrypt(second, key))
    }

    @Test fun wrongKeyAndModifiedTagOrIvAreRejected() {
        val wrongKey = key.copyOf().also { it[0] = (it[0].toInt() xor 1).toByte() }
        assertThrows(GeneralSecurityException::class.java) {
            WorkspaceCipher.decrypt(WorkspaceCipher.Envelope(ciphertext, iv), wrongKey)
        }
        val tampered = Base64.getDecoder().decode(ciphertext).also { it[it.lastIndex] = (it.last().toInt() xor 1).toByte() }
        assertThrows(GeneralSecurityException::class.java) {
            WorkspaceCipher.decrypt(WorkspaceCipher.Envelope(Base64.getEncoder().encodeToString(tampered), iv), key)
        }
        assertThrows(GeneralSecurityException::class.java) {
            WorkspaceCipher.decrypt(WorkspaceCipher.Envelope(ciphertext, "AAAAAAAAAAAAAAAA"), key)
        }
    }

    @Test fun malformedInputsAreRejectedWithoutReplacingKey() {
        assertThrows(IllegalArgumentException::class.java) { WorkspaceCipher.decodeKey("private-invalid-input") }
        assertThrows(IllegalArgumentException::class.java) { WorkspaceCipher.encrypt(plaintext, ByteArray(16)) }
        assertThrows(IllegalArgumentException::class.java) {
            WorkspaceCipher.decrypt(WorkspaceCipher.Envelope(ciphertext, "AA=="), key)
        }
        assertThrows(IllegalArgumentException::class.java) {
            WorkspaceCipher.decrypt(WorkspaceCipher.Envelope("AA==", iv), key)
        }
        assertEquals("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=", Base64.getEncoder().encodeToString(key))
    }

    @Test fun emptyPayloadRetainsAuthenticationTag() {
        val encrypted = WorkspaceCipher.encrypt(byteArrayOf(), key)
        assertEquals(16, Base64.getDecoder().decode(encrypted.ciphertext).size)
        assertArrayEquals(byteArrayOf(), WorkspaceCipher.decrypt(encrypted, key))
    }
}
