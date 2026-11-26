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

class BackupFormValuesTest {
    private class Rig {
        val root=Files.createTempDirectory("genesis-form-value-test-").toFile()
        val view=UUID.randomUUID().toString();val owned=mutableListOf<BackupStoredValue>()
        private val key=SecretKeySpec(ByteArray(32){(it+11).toByte()},"AES")
        val spool=BackupFormSpool(root,object:BackupFormSpool.Crypto{
            override fun seal(value:String,aad:String):String {
                val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key);cipher.updateAAD(aad.toByteArray())
                return Base64.getEncoder().encodeToString(cipher.iv+cipher.doFinal(value.toByteArray()))
            }
            override fun open(value:String,aad:String):String {
                val bytes=Base64.getDecoder().decode(value);val cipher=Cipher.getInstance("AES/GCM/NoPadding")
                cipher.init(Cipher.DECRYPT_MODE,key,GCMParameterSpec(128,bytes.copyOfRange(0,12)));cipher.updateAAD(aad.toByteArray())
                return cipher.doFinal(bytes.copyOfRange(12,bytes.size)).toString(Charsets.UTF_8)
            }
        },{reader->
            // Native JsonReader skips the value; its ORIGINAL duplicate names
            // must reach the shared strict source parser. JVM org.json's newer
            // default rejects nested duplicates before this framing test can
            // observe preservation. This test-only projection is never emitted.
            // Compile against Android's JSONObject API, instantiate only the
            // JVM test dependency's configurable constructor at test runtime.
            val configuration=org.json.JSONParserConfiguration().withOverwriteDuplicateKey(true)
            val value=JSONObject::class.java.getConstructor(String::class.java,org.json.JSONParserConfiguration::class.java)
                .newInstance(reader.readText(),configuration)
            check(value.get("protocol")==1&&value.get("state") is JSONObject&&value.getBoolean("settled")&&value.isNull("file"));value
        })
        val transfer=BackupValueTransfer(spool,view,"original-owner:epoch7:$view")
        fun write(raw:String):BackupStoredValue {
            val id=UUID.randomUUID().toString();var result:BackupStoredValue?=null
            raw.chunked(BackupFormSpool.CHUNK).forEachIndexed{index,part->result=transfer.append(id,index,(index+1)*BackupFormSpool.CHUNK>=raw.length,part)}
            return requireNotNull(result).also{owned+=it}
        }
        fun clear(){transfer.clear();owned.forEach{it.clear()};spool.clear();root.delete()}
    }
    @Test fun exactRawJsonValuesRoundtripWithNoObjectProjectionAndNoExecutableManifest(){
        val r=Rig();try{
            for(raw in listOf("0","false","null","\"\"","[]","{}","{\"duplicate\":1,\"duplicate\":2}"," \n{ \"key\": \" exact input \" }\n")){
                val value=r.write(raw);assertEquals(raw.length,value.characters);assertEquals(raw,value.reader().use{it.readText()});assertFalse(value.toString().contains("exact input"))
            }
        }finally{r.clear()}
    }
    @Test fun transportAndEncryptedFrameBoundariesPreserveSplitSurrogatesAndOriginalEscapes(){
        val r=Rig();try{
            val raw="\""+"x".repeat(BackupFormSpool.CHUNK-2)+"\uD83D\uDE00\\uD800\""
            assertTrue(raw[BackupFormSpool.CHUNK-1].isHighSurrogate());assertTrue(raw[BackupFormSpool.CHUNK].isLowSurrogate())
            val value=r.write(raw);assertEquals(raw,value.reader().use{it.readText()});assertTrue(r.root.listFiles()!!.all{!it.readBytes().toString(Charsets.US_ASCII).contains("\\uD800")})
        }finally{r.clear()}
    }
    @Test fun interruptedOrOutOfOrderCandidateCannotReplaceAnAcceptedValue(){
        val r=Rig();try{
            val accepted=r.write("\"accepted\"");val id=UUID.randomUUID().toString()
            assertNull(r.transfer.append(id,0,false," ".repeat(BackupFormSpool.CHUNK)))
            assertThrows(IllegalStateException::class.java){r.transfer.append(id,2,true,"null")}
            assertEquals("\"accepted\"",accepted.reader().use{it.readText()});assertEquals(2,r.root.listFiles()!!.size)
            val next=r.write("\"replacement\"");assertEquals("\"replacement\"",next.reader().use{it.readText()})
        }finally{r.clear()}
    }
    @Test fun invalidFinalJsonAndTruncatedFooterAreNotValidSourceValues(){
        val r=Rig();try{
            assertThrows(Exception::class.java){r.write("{unfinished")};assertTrue(r.root.listFiles()!!.isEmpty())
            val value=r.write("{\"exact\":true}");val path=r.root.listFiles()!!.single{it.name.endsWith(".bin")};val bytes=path.readBytes();path.writeBytes(bytes.copyOf(bytes.size-1))
            assertThrows(Exception::class.java){value.reader().use{it.readText()}}
        }finally{r.clear()}
    }
}
