package ru.genesis.calendar.security

import org.json.JSONObject
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import java.util.UUID

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
    private val assertOwner:()->Unit,
    private val offline:Boolean=false,
    private val restoreHardware:Boolean=false,
) : AutoCloseable {
    val id=UUID.randomUUID().toString()
    val ownerId get()=owner
    val viewId get()=view
    val isOffline get()=offline
    private data class Content(val secret: ByteArray, val kit: ByteArray) {
        fun clear() { secret.fill(0); kit.fill(0) }
    }
    private val content = AtomicReference<Content?>(Content(secret, kit))
    private val closed=AtomicBoolean(false)
    val waitingForCredential get()=!closed.get()&&content.get()!=null
    fun remainingMillis()=(expiresAt-android.os.SystemClock.elapsedRealtime()).coerceAtLeast(0)

    class Opened internal constructor(val secret: ByteArray, val kit: JSONObject?,val offline:Boolean,val restoreHardware:Boolean) : AutoCloseable {
        override fun close() { secret.fill(0) }
        override fun toString()="NativeMigrationCredential.Opened([redacted])"
    }

    /** The admission deadline does not cap a subsequently admitted migration.
     * Its original owner/session and explicit foreground guard still apply. */
    fun current(){check(!closed.get()){"E2EE_CREDENTIAL_REVOKED"};assertOwner()}

    /** A cancelled, expired or previously claimed request cannot be reused. */
    fun claim(expectedOwner: String, expectedView: String, expectedAttempt: Long, now: Long): Opened {
        val held = content.getAndSet(null) ?: error("E2EE_CREDENTIAL_REVOKED")
        var transferred = false
        try {
            current()
            check(owner == expectedOwner && view == expectedView && attempt == expectedAttempt) { "E2EE_ACCOUNT_CHANGED" }
            check(now >= createdAt && now < expiresAt) { "E2EE_CREDENTIAL_EXPIRED" }
            val parsed = if(held.kit.isEmpty())null else E2eeFileManifestJson.readPrivateDocument(held.kit)
            if(parsed!=null)check(parsed.getString("ownerId") == owner && parsed.getInt("protocol") == 1) { "E2EE_SCOPE_BINDING_MISMATCH" }
            check((held.secret.isEmpty()&&parsed==null)||(held.secret.size==32&&parsed!=null)){"E2EE_RECOVERY_KIT_REQUIRED"}
            current();return Opened(held.secret, parsed,offline,restoreHardware).also { transferred = true }
        } finally {
            held.kit.fill(0)
            if (!transferred) held.secret.fill(0)
        }
    }

    override fun close() { closed.set(true);content.getAndSet(null)?.clear() }
    override fun toString()="NativeMigrationCredential([redacted])"

    companion object {
        const val TIMEOUT_MILLIS = 120_000L

        fun capture(owner: String, view: String, attempt: Long, secret: String, kit: JSONObject, now: Long,assertOwner:()->Unit): NativeMigrationCredential =
            create(owner,view,attempt,secret,kit,now,assertOwner,false,false,true)

        fun captureVault(owner:String,view:String,attempt:Long,secret:String,kit:JSONObject?,offline:Boolean,restoreHardware:Boolean,now:Long,assertOwner:()->Unit):NativeMigrationCredential{
            check(!offline||!restoreHardware){"E2EE_INVALID_CREDENTIAL_REQUEST"}
            return create(owner,view,attempt,if(offline)""else secret,if(offline)null else kit,now,assertOwner,offline,restoreHardware,false)
        }
        private fun create(owner:String,view:String,attempt:Long,secret:String,kit:JSONObject?,now:Long,assertOwner:()->Unit,offline:Boolean,restoreHardware:Boolean,required:Boolean):NativeMigrationCredential{
            assertOwner()
            check(owner.isNotBlank() && view.isNotBlank() && attempt > 0 && now >= 0 && now <= Long.MAX_VALUE - TIMEOUT_MILLIS) { "E2EE_INVALID_CREDENTIAL_REQUEST" }
            check((secret.isNotBlank()&&kit!=null)||(!required&&secret.isBlank()&&kit==null)){"E2EE_RECOVERY_KIT_REQUIRED"}
            check(!restoreHardware||(secret.isNotBlank()&&kit!=null)){"E2EE_RECOVERY_KIT_REQUIRED"}
            if(kit!=null)check(kit.getString("ownerId") == owner && kit.getInt("protocol") == 1) { "E2EE_SCOPE_BINDING_MISMATCH" }
            val decoded = if(secret.isBlank())ByteArray(0)else E2eeEnvelope.decode(secret.trim(), 32)
            var encoded: ByteArray? = null
            var transferred = false
            try {
                encoded = kit?.toString()?.toByteArray(Charsets.UTF_8)?:ByteArray(0)
                check(encoded.size<=65536&&(kit==null||encoded.isNotEmpty())) { "E2EE_INVALID_RECOVERY_KIT" }
                assertOwner();return NativeMigrationCredential(owner, view, attempt, now, now + TIMEOUT_MILLIS, decoded, encoded,assertOwner,offline,restoreHardware).also { transferred = true }
            } finally {
                if (!transferred) { decoded.fill(0); encoded?.fill(0) }
            }
        }
    }
}
