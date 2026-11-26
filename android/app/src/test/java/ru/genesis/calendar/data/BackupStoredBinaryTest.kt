package ru.genesis.calendar.data

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.nio.file.Files
import java.util.Base64
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

class BackupStoredBinaryTest {
    private class Rig {
        val root=Files.createTempDirectory("genesis-binary-spill-").toFile();val view=UUID.randomUUID().toString()
        val values=mutableListOf<BackupStoredBinary>();private val key=SecretKeySpec(ByteArray(32){(it+29).toByte()},"AES")
        val spool=BackupFormSpool(root,object:BackupFormSpool.Crypto{
            override fun seal(value:String,aad:String):String {val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key);cipher.updateAAD(aad.toByteArray())
                return Base64.getEncoder().encodeToString(cipher.iv+cipher.doFinal(value.toByteArray()))}
            override fun open(value:String,aad:String):String {val bytes=Base64.getDecoder().decode(value);val cipher=Cipher.getInstance("AES/GCM/NoPadding")
                cipher.init(Cipher.DECRYPT_MODE,key,GCMParameterSpec(128,bytes.copyOfRange(0,12)));cipher.updateAAD(aad.toByteArray());return cipher.doFinal(bytes.copyOfRange(12,bytes.size)).toString(Charsets.UTF_8)}
        },{source->val value=JSONObject(source.readText());check(value.get("state") is JSONObject);value},maximum=BackupValueInventory.PHYSICAL_MAX)
        fun store(bytes:ByteArray,raw:String=descriptor(bytes)):BackupStoredBinary=BackupStoredBinary.store(spool,view,"original-owner:epoch7:$view",raw,bytes,{JSONObject(it)}).also{values+=it}
        fun clear(){values.forEach{it.clear()};spool.clear();assertTrue(root.listFiles()?.isEmpty()!=false);root.delete()}
    }
    companion object {
        private fun descriptor(bytes:ByteArray):String {val file=BackupImportFile(bytes,"\uFEFForiginal-\uD800-name","APPLICATION/JSON",null,999L)
            return try{" \n"+file.descriptor().toString()+"\r\n"}finally{file.clear()}}
    }
    @Test fun arbitraryBinaryLengthsAndOriginalProviderUtf16RoundtripWithoutTextDecoding(){
        val r=Rig();try{
            for(size in listOf(0,1,2,3,98303,98304,98305,256*1024+1)){
                val bytes=ByteArray(size){((it*37+131)and 255).toByte()};val raw=descriptor(bytes);val value=r.store(bytes,raw)
                assertEquals(raw,value.descriptor);assertEquals(size,value.length);assertArrayEquals(bytes,value.bytes());assertFalse(value.toString().contains("original"))
                assertTrue(r.root.listFiles()!!.all{!it.readBytes().toString(Charsets.US_ASCII).contains("original")});bytes.fill(0)
            }
        }finally{r.clear()}
    }
    @Test fun truncatedOrChangedAuthenticatedFileCannotReturnCompleteBytesAndNeverErasesAnotherCandidate(){
        val r=Rig();try{
            val earlier=r.store(byteArrayOf(7,8,9));val value=r.store(ByteArray(200000){(it and 255).toByte()})
            val path=r.root.listFiles()!!.single{it.name=="${value.id}.bin"};val original=path.readBytes();path.writeBytes(original.copyOf(original.size-1))
            assertThrows(Exception::class.java){value.bytes()};assertArrayEquals(byteArrayOf(7,8,9),earlier.bytes())
        }finally{r.clear()}
    }
    @Test fun descriptorOrDigestSubstitutionRefusesBeforeAnyEncryptedPublication(){
        val r=Rig();try{
            val bytes=byteArrayOf(0,-1,0xc3.toByte(),0x28);val original=JSONObject(descriptor(bytes))
            for(change in listOf<(JSONObject)->Unit>({it.put("length",5)},{it.put("sha256","0".repeat(64))},{it.put("protocol",2)},{it.put("id","foreign/path")},{it.put("length",4.5)})){
                val raw=JSONObject(original.toString()).also(change).toString();assertThrows(Exception::class.java){r.store(bytes,raw)};assertTrue(r.root.listFiles().isNullOrEmpty())
            }
        }finally{r.clear()}
    }
    @Test fun originalSessionChecksCanAbortBeforePublicationOrDuringReadWithoutReturningPartialBytes(){
        val r=Rig();try{
            val bytes=ByteArray(250000){(it*17).toByte()};var checks=0
            assertThrows(IllegalStateException::class.java){BackupStoredBinary.store(r.spool,r.view,"owner:epoch7",descriptor(bytes),bytes,{JSONObject(it)}){if(++checks==4)error("E2EE_ACCOUNT_CHANGED")}}
            assertTrue(r.root.listFiles().isNullOrEmpty());val value=r.store(bytes);checks=0
            assertThrows(IllegalStateException::class.java){value.bytes{if(++checks==5)error("E2EE_ACCOUNT_CHANGED")}}
            assertArrayEquals(bytes,value.bytes());bytes.fill(0)
        }finally{r.clear()}
    }
}
