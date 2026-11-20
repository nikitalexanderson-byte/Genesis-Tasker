package ru.genesis.calendar.data

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import java.io.ByteArrayOutputStream

/** Field encryption: Room/WAL never contains task text. Keys never leave Android Keystore. */
class LocalCipher internal constructor(private val alias: String = DEFAULT_ALIAS,private val witnesses:LocalKeyWitnessStore?=null) {
    companion object {
        internal const val DEFAULT_ALIAS="genesis.local.v1"
        private val keyCreationLock = Any()
        @Volatile private var installedWitnesses:LocalKeyWitnessStore?=null
        @Volatile internal var initializationProblem:String?=null
            private set
        internal fun initialize(context:android.content.Context) {
            synchronized(keyCreationLock){
                installedWitnesses=LocalKeyWitnessStore(context.applicationContext)
                // Prepare before Room workers/transactions start. A first key
                // must not need a separate read connection behind its own
                // exclusive rollback-journal writer on low-memory devices.
                initializationProblem=try{LocalCipher().prepare();null}catch(error:Exception){
                    error.message?.takeIf{it in setOf("LOCAL_ENCRYPTION_KEY_LOST","LOCAL_KEY_STORAGE_UNAVAILABLE","LOCAL_KEY_OPERATION_BUSY")}
                        ?:"LOCAL_KEY_STORAGE_UNAVAILABLE"
                }
            }
        }
    }
    internal fun prepare() { ru.genesis.calendar.security.UpdateGate.requireOpen();key(create=true) }
    private fun key(create: Boolean): SecretKey = synchronized(keyCreationLock) {
        if(!create){
            val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            return@synchronized checkNotNull(store.getKey(alias,null) as? SecretKey){"Local encryption key is unavailable; existing data must not be replaced"}
        }
        val witness=witnesses?:installedWitnesses?:error("LOCAL_KEY_STORAGE_UNAVAILABLE")
        witness.withCreationPermit(alias) {
            val current=KeyStore.getInstance("AndroidKeyStore").apply{load(null)}.getKey(alias,null) as? SecretKey
            if(current!=null){witness.remember(alias);current}
            else {
                witness.requireFresh(alias)
                val generated=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
                    init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .setKeySize(256).build())
                }.generateKey()
                witness.remember(alias);generated
            }
        }
    }
    private class WipingOutput(size:Int):ByteArrayOutputStream(size){fun wipe(){buf.fill(0);reset()}}
    /** Android8 Keystore can fail authentication when a large doFinal input
     * crosses its operation streamer boundary. Feed bounded updates on BOTH
     * paths. Nothing is returned until doFinal authenticates the entire value;
     * failures wipe any provider output rather than exposing partial plaintext.
     * The existing IV+ciphertext+tag format, key and AAD are unchanged. */
    private fun finish(cipher:Cipher,input:ByteArray):ByteArray {
        val output=WipingOutput(minOf(input.size,65536))
        try{
            for(offset in input.indices step 8192){
                val part=cipher.update(input,offset,minOf(8192,input.size-offset))
                if(part!=null)try{output.write(part)}finally{part.fill(0)}
            }
            val last=cipher.doFinal()
            try{output.write(last)}finally{last.fill(0)}
            return output.toByteArray()
        }finally{output.wipe()}
    }
    fun encrypt(value: String, context: String): String {
        ru.genesis.calendar.security.UpdateGate.requireOpen()
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key(create=true))
        cipher.updateAAD(context.toByteArray(Charsets.UTF_8))
        val iv=cipher.iv
        val plain=value.toByteArray(Charsets.UTF_8)
        val sealed=try{finish(cipher,plain)}finally{plain.fill(0)}
        return try{Base64.getEncoder().encodeToString(iv+sealed)}finally{sealed.fill(0)}
    }
    fun decrypt(value: String, context: String): String {
        val bytes=Base64.getDecoder().decode(value)
        try{
            require(bytes.size>=28){"Invalid encrypted record"}
            val cipher=Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE,key(create=false),GCMParameterSpec(128,bytes.copyOfRange(0,12)))
            cipher.updateAAD(context.toByteArray(Charsets.UTF_8))
            val ciphertext=bytes.copyOfRange(12,bytes.size)
            val plain=try{finish(cipher,ciphertext)}finally{ciphertext.fill(0)}
            return try{plain.toString(Charsets.UTF_8)}finally{plain.fill(0)}
        }finally{bytes.fill(0)}
    }
}
