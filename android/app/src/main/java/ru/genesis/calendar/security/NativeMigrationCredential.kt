package ru.genesis.calendar.security

import org.json.JSONObject
import java.util.concurrent.atomic.AtomicReference

/** Memory-only custody for the user's explicit trip to the system credential
 * activity. This is neither a vault unlock nor permission to migrate. Nothing
 * is placed in an Intent, SavedStateHandle, preferences or a database.
 */
internal class NativeMigrationCredential private constructor(
    private val owner: String,
    private val view: String,
    val attempt: Long,
    private val createdAt: Long,
    private val expiresAt: Long,
    secret: ByteArray,
    kit: ByteArray,
) : AutoCloseable {
    private data class Content(val secret: ByteArray, val kit: ByteArray) {
        fun clear() { secret.fill(0); kit.fill(0) }
    }
    private val content = AtomicReference<Content?>(Content(secret, kit))

    class Opened internal constructor(val secret: ByteArray, val kit: JSONObject) : AutoCloseable {
        override fun close() { secret.fill(0) }
    }

    /** A cancelled, expired or previously claimed request cannot be reused. */
    fun claim(expectedOwner: String, expectedView: String, expectedAttempt: Long, now: Long): Opened {
        val held = content.getAndSet(null) ?: error("E2EE_CREDENTIAL_REVOKED")
        var transferred = false
        try {
            check(owner == expectedOwner && view == expectedView && attempt == expectedAttempt) { "E2EE_ACCOUNT_CHANGED" }
            check(now >= createdAt && now < expiresAt) { "E2EE_CREDENTIAL_EXPIRED" }
            val parsed = E2eeFileManifestJson.readPrivateDocument(held.kit)
            check(parsed.getString("ownerId") == owner && parsed.getInt("protocol") == 1) { "E2EE_SCOPE_BINDING_MISMATCH" }
            return Opened(held.secret, parsed).also { transferred = true }
        } finally {
            held.kit.fill(0)
            if (!transferred) held.secret.fill(0)
        }
    }

    override fun close() { content.getAndSet(null)?.clear() }

    companion object {
        const val TIMEOUT_MILLIS = 120_000L

        fun capture(owner: String, view: String, attempt: Long, secret: String, kit: JSONObject, now: Long): NativeMigrationCredential {
            check(owner.isNotBlank() && view.isNotBlank() && attempt > 0 && now >= 0 && now <= Long.MAX_VALUE - TIMEOUT_MILLIS) { "E2EE_INVALID_CREDENTIAL_REQUEST" }
            check(kit.getString("ownerId") == owner && kit.getInt("protocol") == 1) { "E2EE_SCOPE_BINDING_MISMATCH" }
            val decoded = E2eeEnvelope.decode(secret.trim(), 32)
            var encoded: ByteArray? = null
            var transferred = false
            try {
                encoded = kit.toString().toByteArray(Charsets.UTF_8)
                check(encoded.size in 1..65536) { "E2EE_INVALID_RECOVERY_KIT" }
                return NativeMigrationCredential(owner, view, attempt, now, now + TIMEOUT_MILLIS, decoded, encoded).also { transferred = true }
            } finally {
                if (!transferred) { decoded.fill(0); encoded?.fill(0) }
            }
        }
    }
}
