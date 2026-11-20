package ru.genesis.calendar.data

import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.File
import java.security.KeyStore
import java.util.Base64
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Distinguish an old Keystore streaming boundary from a file/AAD/reader bug.
 * Only a uniquely owned synthetic alias and public synthetic text are used. */
class LocalCipherSpoolCompatibilityTest {
    private fun bounded(value:ByteArray,cipher:Cipher):ByteArray {
        val output=ByteArrayOutputStream()
        for(offset in value.indices step 8192)cipher.update(value,offset,minOf(8192,value.size-offset))?.let(output::write)
        cipher.doFinal()?.let(output::write);return output.toByteArray()
    }
    @Test fun actualKeystoreBoundaryDiagnosticsForSpoolFrameSizes(){
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val alias="genesis.qa.spool.${UUID.randomUUID()}";val local=LocalCipher(alias)
        val rows=JSONArray();val aad="public-synthetic-spool-probe"
        try{
            local.encrypt("initialize owned alias",aad)
            val key=KeyStore.getInstance("AndroidKeyStore").apply{load(null)}.getKey(alias,null) as SecretKey
            for(size in listOf(10924,21848,43692,65536,131072,349528)){
                val text="x".repeat(size)
                fun encryptBounded():String {
                    val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key);cipher.updateAAD(aad.toByteArray())
                    return Base64.getEncoder().encodeToString(cipher.iv+bounded(text.toByteArray(),cipher))
                }
                fun decryptBounded(encoded:String):String {
                    val bytes=Base64.getDecoder().decode(encoded);val cipher=Cipher.getInstance("AES/GCM/NoPadding")
                    cipher.init(Cipher.DECRYPT_MODE,key,GCMParameterSpec(128,bytes.copyOfRange(0,12)));cipher.updateAAD(aad.toByteArray())
                    return bounded(bytes.copyOfRange(12,bytes.size),cipher).toString(Charsets.UTF_8)
                }
                val ordinary=local.encrypt(text,aad);val streamed=encryptBounded()
                rows.put(JSONObject().put("size",size).put("ordinary",runCatching{local.decrypt(ordinary,aad)==text}.getOrDefault(false))
                    .put("boundedEncryption",runCatching{local.decrypt(streamed,aad)==text}.getOrDefault(false))
                    .put("boundedDecryption",runCatching{decryptBounded(ordinary)==text}.getOrDefault(false))
                    .put("boundedBoth",runCatching{decryptBounded(streamed)==text}.getOrDefault(false)))
                assertThrows(Exception::class.java){local.decrypt(ordinary,"$aad-foreign")}
                val corrupted=Base64.getDecoder().decode(ordinary);corrupted[corrupted.lastIndex]=(corrupted.last().toInt()xor 1).toByte()
                assertThrows(Exception::class.java){local.decrypt(Base64.getEncoder().encodeToString(corrupted),aad)}
            }
            File(context.getExternalFilesDir(null),"backup336-keystore-boundary-proof.json").writeText(JSONObject().put("synthetic",true).put("rows",rows).toString(2))
            for(index in 0 until rows.length())for(mode in listOf("ordinary","boundedEncryption","boundedDecryption","boundedBoth"))
                assertTrue("$mode frame size ${rows.getJSONObject(index).getInt("size")}",rows.getJSONObject(index).getBoolean(mode))
        }finally{KeyStore.getInstance("AndroidKeyStore").apply{load(null)}.deleteEntry(alias)}
    }
}
