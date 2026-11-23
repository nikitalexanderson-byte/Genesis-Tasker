package ru.genesis.calendar.security

import android.app.KeyguardManager
import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.security.keystore.UserNotAuthenticatedException
import android.util.AtomicFile
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** User-presence-protected portable device keys. Existing Room/LocalCipher data stays intact.
 * Call the system credential/biometric flow before access. A background worker cannot
 * manufacture a replacement key or silently initialize empty data after invalidation.
 */
class E2eeDeviceVault(context: Context, ownerId: String, slotId: String? = null) {
    companion object { private val mutationLock get()=E2eeStorageAdmission.providerMutationLock; private const val MAX_PRIVATE = 65536 }
    private val app = context.applicationContext
    private val owner = E2eeKeys.technical(ownerId)
    private val ownerHash = MessageDigest.getInstance("SHA-256").digest(owner.toByteArray()).joinToString("") { "%02x".format(it) }
    private val slots = app.getSharedPreferences("genesis.e2ee.device-slots.v1", Context.MODE_PRIVATE)
    private val slot = (slotId ?: slots.getString(ownerHash, "").orEmpty()).also {
        check(it.isEmpty() || Regex("[a-f0-9-]{36}").matches(it)) { "E2EE_CORRUPT_DEVICE_VAULT" }
    }
    private val suffix = if (slot.isEmpty()) "" else "-$slot"
    private val alias = "genesis.e2ee.device.v1.$ownerHash$suffix"
    private val file = AtomicFile(File(app.noBackupFilesDir, "e2ee-device-$ownerHash$suffix.vault"))
    private val recovery = AtomicFile(File(app.noBackupFilesDir, "e2ee-recovery-$ownerHash$suffix.vault"))
    private fun aad() = "GENESIS-E2EE-ANDROID-VAULT\u0000v1\u0000$owner".toByteArray(Charsets.UTF_8)
    private fun key(create: Boolean): SecretKey = synchronized(mutationLock) {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return@synchronized it }
        if (!create || exists()) throw IllegalStateException("E2EE_DEVICE_KEY_UNAVAILABLE")
        if (!app.getSystemService(KeyguardManager::class.java).isDeviceSecure) throw IllegalStateException("E2EE_DEVICE_CREDENTIAL_REQUIRED")
        val builder = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256).setUserAuthenticationRequired(true).setInvalidatedByBiometricEnrollment(false)
        if (Build.VERSION.SDK_INT >= 30) builder.setUserAuthenticationParameters(300,
            KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL)
        else @Suppress("DEPRECATION") builder.setUserAuthenticationValidityDurationSeconds(300)
        KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply { init(builder.build()) }.generateKey()
    }
    fun exists(): Boolean = synchronized(mutationLock) { file.baseFile.exists() || File(file.baseFile.path + ".bak").exists() || File(file.baseFile.path + ".new").exists() }
    internal fun requireCurrentSlot(){check(slots.getString(ownerHash,"").orEmpty()==slot){"E2EE_DEVICE_KEY_UNAVAILABLE"}}
    fun save(value: ByteArray, create: Boolean = false) = synchronized(mutationLock) {
        if(create && exists())throw IllegalStateException("E2EE_DEVICE_ALREADY_EXISTS")
        if (value.size > MAX_PRIVATE) throw IllegalArgumentException("E2EE_INVALID_KEY_BUNDLE")
        val copy = value.copyOf()
        try {
            val database=File(app.noBackupFilesDir,"e2ee-records-v1.sqlite")
            val usage=if(database.exists())E2eeSqliteStorage(app).use{it.providerUsage()}
                else E2eeStorageAdmission.providerFiles(app.noBackupFilesDir,0,firstKeyProvision=create)
            val previous=if(create)null else maxOf(file.baseFile.length(),File(file.baseFile.path+".bak").length()).takeIf{it>0}
            val expectedBytes=copy.size+29 // version + 12-byte GCM IV + 16-byte tag
            val growth=E2eeStorageAdmission.writeGrowth(listOf(E2eeStorageAdmission.WriteSize(expectedBytes.toLong(),previous)))
            E2eeStorageAdmission.admit(usage,E2eeStorageAdmission.Growth(0,if(create)1 else 0,growth.writeBytes,growth.rewriteBytes),E2eeStorageAdmission.providerBudget)
            // Capacity refusal cannot create a new hardware alias or replace
            // any accepted encrypted bundle. Keystore authentication remains
            // mandatory before the first AtomicFile mutation.
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, key(create)); cipher.updateAAD(aad())
            val bytes = byteArrayOf(1) + cipher.iv + cipher.doFinal(copy)
            check(cipher.iv.size==12&&bytes.size==expectedBytes){"E2EE_INVALID_KEY_BUNDLE"}
            val output = file.startWrite()
            try { output.write(bytes); file.finishWrite(output) }
            catch (error: Exception) { file.failWrite(output); throw error }
        } catch (_: UserNotAuthenticatedException) { throw IllegalStateException("E2EE_UNLOCK_REQUIRED") }
        catch (_: KeyPermanentlyInvalidatedException) { throw IllegalStateException("E2EE_DEVICE_KEY_INVALIDATED") }
        finally { copy.fill(0) }
    }
    private fun encryptedBundle():ByteArray {
        val bytes = file.openRead().use { input ->
            val buffer = ByteArray(MAX_PRIVATE + 30); var size = 0
            try {
                while (size < buffer.size) { val read = input.read(buffer, size, buffer.size - size); if (read < 0) break; size += read }
                buffer.copyOf(size)
            }finally{buffer.fill(0)}
        }
        if (bytes.size !in 29..(MAX_PRIVATE + 29) || bytes[0] != 1.toByte()) throw IllegalStateException("E2EE_CORRUPT_DEVICE_VAULT")
        return bytes
    }
    private fun decryptBundle(bytes:ByteArray,key:SecretKey):ByteArray {
        val cipher=Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE,key,GCMParameterSpec(128,bytes.copyOfRange(1,13)))
        cipher.updateAAD(aad());return cipher.doFinal(bytes.copyOfRange(13,bytes.size))
    }
    /** Cold entry always consumes a real, current hardware authentication. */
    fun unlock(): ByteArray = synchronized(mutationLock) {
        val bytes=encryptedBundle()
        try {
            decryptBundle(bytes,key(false))
        } catch (_: UserNotAuthenticatedException) { throw IllegalStateException("E2EE_UNLOCK_REQUIRED") }
        catch (_: KeyPermanentlyInvalidatedException) { throw IllegalStateException("E2EE_DEVICE_KEY_INVALIDATED") }
        catch (error: IllegalStateException) { if (error.message == "E2EE_DEVICE_KEY_UNAVAILABLE") throw error; throw IllegalStateException("E2EE_CORRUPT_DEVICE_VAULT") }
        catch (_: Exception) { throw IllegalStateException("E2EE_CORRUPT_DEVICE_VAULT") }
        finally{bytes.fill(0)}
    }
    internal class OpenedDevice(val bytes:ByteArray,val durability:DeviceDurability){
        override fun toString()="E2eeDeviceVault.OpenedDevice([redacted])"
    }
    /** Memory-only witness for an ALREADY decrypted device. It cannot open a
     * new device or satisfy cold authentication. Slot, exact ciphertext, opaque
     * Keystore key identity and creation metadata must remain unchanged. */
    internal inner class DeviceDurability internal constructor(private var openedKey:SecretKey?,private val createdAt:Long?,private val sealedHash:ByteArray):AutoCloseable {
        private val closed=AtomicBoolean(false)
        private val broken=AtomicBoolean(false)
        fun verify()=synchronized(mutationLock){
            check(!closed.get()){"E2EE_UNLOCK_REQUIRED"};check(!broken.get()){"E2EE_DEVICE_KEY_UNAVAILABLE"}
            try{
                requireCurrentSlot()
                val store=KeyStore.getInstance("AndroidKeyStore").apply{load(null)}
                fun sameKey(){check(store.getKey(alias,null)==openedKey&&store.getCreationDate(alias)?.time==createdAt){"E2EE_DEVICE_KEY_UNAVAILABLE"}}
                sameKey();val bytes=encryptedBundle()
                try{
                    check(MessageDigest.isEqual(MessageDigest.getInstance("SHA-256").digest(bytes),sealedHash)){"E2EE_DEVICE_KEY_UNAVAILABLE"}
                    try{decryptBundle(bytes,requireNotNull(openedKey)).fill(0)}
                    catch(expired:UserNotAuthenticatedException){
                        // HAT expiry does not revoke keys already held in an
                        // admitted foreground session. Unknown key metadata
                        // cannot provide this durability proof and must refuse.
                        if(createdAt==null)throw expired
                    }
                    requireCurrentSlot();sameKey()
                    val after=encryptedBundle()
                    try{check(MessageDigest.isEqual(MessageDigest.getInstance("SHA-256").digest(after),sealedHash)){"E2EE_DEVICE_KEY_UNAVAILABLE"}}finally{after.fill(0)}
                }finally{bytes.fill(0)}
            }catch(_:UserNotAuthenticatedException){broken.set(true);throw IllegalStateException("E2EE_UNLOCK_REQUIRED")}
            catch(_:KeyPermanentlyInvalidatedException){broken.set(true);throw IllegalStateException("E2EE_DEVICE_KEY_INVALIDATED")}
            catch(error:Exception){broken.set(true);throw IllegalStateException(error.message?.takeIf{it in setOf("E2EE_DEVICE_KEY_UNAVAILABLE","E2EE_CORRUPT_DEVICE_VAULT")}?:"E2EE_DEVICE_KEY_UNAVAILABLE")}
        }
        override fun close()=synchronized(mutationLock){closed.set(true);openedKey=null;sealedHash.fill(0)}
        override fun toString()="E2eeDeviceVault.DeviceDurability([redacted])"
    }
    /** The witness is issued only AFTER actual Keystore decryption, never from
     * a remembered UI result, disk flag, recovery file or caller-supplied hash. */
    internal fun unlockForDevice():OpenedDevice=synchronized(mutationLock){
        val wire=encryptedBundle();var plain:ByteArray?=null;var witness:DeviceDurability?=null;var transferred=false
        try{
            val store=KeyStore.getInstance("AndroidKeyStore").apply{load(null)}
            val actual=store.getKey(alias,null) as? SecretKey?:error("E2EE_DEVICE_KEY_UNAVAILABLE")
            val created=store.getCreationDate(alias)?.time
            val unlocked=decryptBundle(wire,actual);plain=unlocked
            val proof=DeviceDurability(actual,created,MessageDigest.getInstance("SHA-256").digest(wire));witness=proof;proof.verify()
            OpenedDevice(unlocked,proof).also{transferred=true}
        }catch(_:UserNotAuthenticatedException){throw IllegalStateException("E2EE_UNLOCK_REQUIRED")}
        catch(_:KeyPermanentlyInvalidatedException){throw IllegalStateException("E2EE_DEVICE_KEY_INVALIDATED")}
        catch(error:Exception){throw IllegalStateException(error.message?.takeIf{it in setOf("E2EE_DEVICE_KEY_UNAVAILABLE","E2EE_CORRUPT_DEVICE_VAULT","E2EE_UNLOCK_REQUIRED","E2EE_DEVICE_KEY_INVALIDATED")}?:"E2EE_CORRUPT_DEVICE_VAULT")}
        finally{wire.fill(0);if(!transferred){plain?.fill(0);witness?.close()}}
    }
    /** Recovery is explicit and owner-bound; no key deletion, database reset or empty fallback. */
    fun recoverWithSecret(secret: ByteArray, protectedBundle: JSONObject): ByteArray =
        E2eeKeys.openBundle(owner, "device-vault", secret, protectedBundle)
    /** Independent owner-secret copy of this EXACT device bundle. This is kept
     * outside Keystore encryption so credential invalidation cannot destroy the
     * only opening capability. It is never uploaded or included in content backups. */
    internal fun retainRecovery(secret: ByteArray, kit: JSONObject, bytes: ByteArray) = synchronized(mutationLock) {
        E2eeKeys.recoverAuthority(owner, secret, kit)
        val value = E2eeFileManifestJson.readPrivateDocument(bytes)
        check(value.getString("ownerId") == owner && E2eeProductJson.same(value.getJSONObject("authorityPin"), kit.getJSONObject("authority"))) { "E2EE_AUTHORITY_CHANGED" }
        check(!File(recovery.baseFile.path + ".new").exists()) { "E2EE_RECOVERY_COPY_INCOMPLETE" }
        if (recovery.baseFile.exists() || File(recovery.baseFile.path + ".bak").exists()) {
            val previous = recovery.openRead().use { it.readBytesBounded(MAX_PRIVATE * 2) }
            try {
                val opened = recoverWithSecret(secret, E2eeFileManifestJson.readPrivateDocument(previous))
                try { check(opened.contentEquals(bytes)) { "E2EE_DEVICE_KEY_UNAVAILABLE" } } finally { opened.fill(0) }
            } finally { previous.fill(0) }
        } else {
            val sealed = E2eeKeys.protectBundle(owner, "device-vault", secret, bytes).toString().toByteArray(Charsets.UTF_8)
            try {
                val usage = E2eeSqliteStorage(app).use { it.providerUsage() }
                val growth = E2eeStorageAdmission.writeGrowth(listOf(E2eeStorageAdmission.WriteSize(sealed.size.toLong(), null)))
                E2eeStorageAdmission.admit(usage, E2eeStorageAdmission.Growth(0, 1, growth.writeBytes, growth.rewriteBytes), E2eeStorageAdmission.providerBudget)
                val output = recovery.startWrite()
                try { output.write(sealed); recovery.finishWrite(output) } catch (error: Exception) { recovery.failWrite(output); throw error }
            } finally { sealed.fill(0) }
        }
    }
    /** Explicit recovery preserves every old file, alias, root and queue. A
     * fresh hardware slot wraps the SAME authenticated device identity; server
     * directory verification still rejects a revoked device. No empty vault is created. */
    internal fun restoreHardware(secret: ByteArray, kit: JSONObject, current: () -> Unit) = synchronized(mutationLock) {
        current(); E2eeKeys.recoverAuthority(owner, secret, kit); current()
        check(exists()) { "E2EE_DEVICE_NOT_ENROLLED" }
        val sealed = recovery.openRead().use { it.readBytesBounded(MAX_PRIVATE * 2) }
        val bytes = try { recoverWithSecret(secret, E2eeFileManifestJson.readPrivateDocument(sealed)) } finally { sealed.fill(0) }
        try {
            current(); val value = E2eeFileManifestJson.readPrivateDocument(bytes)
            check(value.getString("ownerId") == owner && E2eeProductJson.same(value.getJSONObject("authorityPin"), kit.getJSONObject("authority"))) { "E2EE_AUTHORITY_CHANGED" }
            check(slots.getString(ownerHash, "").orEmpty() == slot) { "E2EE_ACCOUNT_CHANGED" }
            // Persist a resumable slot BEFORE touching hardware. Interrupted
            // attempts use it again and never replace either accepted container.
            val pendingKey = "$ownerHash:pending:$slot"
            val pending = slots.getString(pendingKey, null) ?: java.util.UUID.randomUUID().toString().also {
                check(slots.edit().putString(pendingKey, it).commit()) { "E2EE_STORAGE_UNAVAILABLE" }
            }
            val destination = E2eeDeviceVault(app, owner, pending)
            if (!destination.exists()) destination.save(bytes, create = true)
            val readback = destination.unlock()
            try { check(readback.contentEquals(bytes)) { "E2EE_DEVICE_KEY_UNAVAILABLE" } } finally { readback.fill(0) }
            destination.retainRecovery(secret, kit, bytes); current()
            check(slots.getString(ownerHash, "").orEmpty() == slot) { "E2EE_ACCOUNT_CHANGED" }
            check(slots.edit().putString(ownerHash, pending).remove(pendingKey).commit()) { "E2EE_STORAGE_UNAVAILABLE" }
            current()
        } finally { bytes.fill(0) }
    }
    private fun java.io.InputStream.readBytesBounded(maximum: Int): ByteArray {
        val output = java.io.ByteArrayOutputStream(); val buffer = ByteArray(8192)
        try { while (true) { val count = read(buffer); if (count < 0) break; check(count > 0 && output.size() + count <= maximum) { "E2EE_CORRUPT_DEVICE_VAULT" }; output.write(buffer, 0, count) }; return output.toByteArray() }
        finally { buffer.fill(0); output.reset() }
    }
    internal fun originalCustodyStorage():E2eeOriginalCustodyStorage=E2eeOriginalCustodyFiles(app)
    internal fun retainedSlots():List<Pair<String,String>> = synchronized(mutationLock){
        val rows=org.json.JSONArray(slots.getString("$ownerHash:retained","[]"));check(rows.length()<=64){"E2EE_SOURCE_HISTORY_CAPACITY"};val seen=mutableSetOf<String>();(0 until rows.length()).map{val row=rows.getJSONObject(it);E2eeKeys.exact(row,setOf("slot","deviceId"));val id=row.getString("slot");check((id.isEmpty()||Regex("[a-f0-9-]{36}").matches(id))&&seen.add(id)&&id!=slot){"E2EE_CORRUPT_DEVICE_VAULT"};id to E2eeKeys.technical(row.getString("deviceId"))}
    }
    /** Persist/read back a separate candidate slot, then atomically select it.
     * Original hardware aliases, recovery containers and database rows remain. */
    internal fun replaceIdentity(expectedDeviceId:String,current:()->Unit,create:()->ByteArray)=synchronized(mutationLock){
        current();check(slots.getString(ownerHash,"").orEmpty()==slot){"E2EE_ACCOUNT_CHANGED"};val old=unlock();try{val original=E2eeFileManifestJson.readPrivateDocument(old);check(original.getString("deviceId")==expectedDeviceId){"E2EE_DEVICE_KEY_UNAVAILABLE"}
            val history=org.json.JSONArray(slots.getString("$ownerHash:retained","[]"));check(history.length()<64){"E2EE_SOURCE_HISTORY_CAPACITY"};val pendingKey="$ownerHash:replacement:$slot";val pending=slots.getString(pendingKey,null)?:java.util.UUID.randomUUID().toString().also{check(slots.edit().putString(pendingKey,it).commit()){"E2EE_STORAGE_UNAVAILABLE"}}
            val destination=E2eeDeviceVault(app,owner,pending);if(!destination.exists()){val bytes=create();try{current();destination.save(bytes,true)}finally{bytes.fill(0)}}
            val readback=destination.unlock();try{current();val next=E2eeFileManifestJson.readPrivateDocument(readback);check(next.getString("ownerId")==owner&&next.getInt("protocol")==1&&next.getString("deviceId")!=expectedDeviceId&&E2eeProductJson.same(next.getJSONObject("authorityPin"),original.getJSONObject("authorityPin"))){"E2EE_DEVICE_KEY_UNAVAILABLE"};E2eeKeys.importDeviceKeys(next.getJSONObject("deviceKeys"));E2eeEnvelope.decode(next.getString("localRoot"),32).fill(0)}finally{readback.fill(0)}
            current();check(slots.getString(ownerHash,"").orEmpty()==slot){"E2EE_ACCOUNT_CHANGED"};history.put(JSONObject().put("slot",slot).put("deviceId",expectedDeviceId));check(slots.edit().putString("$ownerHash:retained",history.toString()).putString(ownerHash,pending).remove(pendingKey).commit()){"E2EE_STORAGE_UNAVAILABLE"};current()
        }finally{old.fill(0)}
    }
}
