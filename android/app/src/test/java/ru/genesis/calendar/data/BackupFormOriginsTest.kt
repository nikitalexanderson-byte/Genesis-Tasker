package ru.genesis.calendar.data

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.nio.file.Files
import java.util.Base64
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/** Synthetic restart provenance only. No adoption, restore or network port. */
class BackupFormOriginsTest {
    private val view=UUID.randomUUID().toString()
    private val binding="12:original-uid:epoch7:$view:field-v2:4:note"
    private open class Crypto:BackupFormSpool.Crypto {
        private val key=SecretKeySpec(ByteArray(32){(it+41).toByte()},"AES")
        override fun seal(value:String,aad:String):String {
            val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key);cipher.updateAAD(aad.toByteArray())
            return Base64.getEncoder().encodeToString(cipher.iv+cipher.doFinal(value.toByteArray()))
        }
        override fun open(value:String,aad:String):String {
            val bytes=Base64.getDecoder().decode(value);val cipher=Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE,key,GCMParameterSpec(128,bytes.copyOfRange(0,12)));cipher.updateAAD(aad.toByteArray())
            return cipher.doFinal(bytes.copyOfRange(12,bytes.size)).toString(Charsets.UTF_8)
        }
    }
    private fun raw(text:String)="{\"protocol\":1,\"state\":{\"note\":${JSONObject.quote(text)}},\"settled\":true,\"file\":null}"
    private fun store(root:File,crypto:BackupFormSpool.Crypto=Crypto(),sync:(File)->Unit={})=BackupFormSpool(root,crypto,{reader->
        val value=JSONObject(reader.readText());check(value.get("state") is JSONObject);value
    },syncDirectory=sync)
    private fun publish(store:BackupFormSpool,text:String,id:String=UUID.randomUUID().toString()):BackupFormSpool.Form {
        var result:BackupFormSpool.Form?=null
        text.chunked(BackupFormSpool.CHUNK).forEachIndexed{index,part->result=store.append(view,binding,id,index,(index+1)*BackupFormSpool.CHUNK>=text.length,part)}
        return requireNotNull(result)
    }
    private fun clean(root:File){root.listFiles()?.forEach{assertTrue(it.isFile);it.delete()};root.delete()}

    @Test fun originalBindingIsDurableBeforeTheFirstFrameAndIncompleteNeverMeansEmpty(){
        val root=Files.createTempDirectory("genesis-spool-origin-").toFile();val id=UUID.randomUUID().toString();var synced=false
        val delegate=Crypto();val crypto=object:BackupFormSpool.Crypto by delegate {
            override fun seal(value:String,aad:String):String {
                if(aad.endsWith("chunk:0")){assertTrue(synced);assertTrue(File(root,"$id.origin").length()>0)}
                return delegate.seal(value,aad)
            }
        }
        val original=store(root,crypto){synced=true}
        try{
            assertNull(original.append(view,binding,id,0,false,"x".repeat(BackupFormSpool.CHUNK)))
            val restarted=store(root);val origin=restarted.origins().single()
            assertEquals(binding,origin.binding);assertEquals(view,origin.view);assertEquals(id,origin.id);assertFalse(origin.complete)
            assertFalse(origin.toString().contains("original-uid"))
            assertEquals("BACKUP_FORM_INCOMPLETE",assertThrows(IllegalStateException::class.java){restarted.retained()}.message)
            assertTrue(root.listFiles()!!.all{!it.readBytes().toString(Charsets.US_ASCII).contains(binding)})
            assertEquals(2,root.listFiles()!!.size)
        }finally{original.clear();clean(root)}
    }
    @Test fun completeV1ReferenceSurvivesTheWindowBeforeEarlyOriginCleanup(){
        val root=Files.createTempDirectory("genesis-spool-origin-final-").toFile();val original=store(root);val id=UUID.randomUUID().toString()
        try{
            val text=raw("x".repeat(BackupFormSpool.CHUNK));assertNull(original.append(view,binding,id,0,false,text.take(BackupFormSpool.CHUNK)))
            val early=File(root,"$id.origin").readBytes()
            val form=requireNotNull(original.append(view,binding,id,1,true,text.substring(BackupFormSpool.CHUNK)))
            assertFalse(File(root,"$id.origin").exists());File(root,"$id.origin").writeBytes(early)
            val restarted=store(root);assertTrue(restarted.origins().single().complete)
            assertEquals(text,restarted.retained().single().second.reader().use{it.readText()})
            File(root,"$id.origin").appendText("!");assertThrows(Exception::class.java){restarted.origins()}
            assertThrows(Exception::class.java){restarted.retained()};assertTrue(File(root,"$id.bin").exists())
            form.clear();assertTrue(root.listFiles()!!.isEmpty())
        }finally{original.clear();clean(root)}
    }
    @Test fun aCompleteFooterWithoutTheFinalRefStillRemainsAnIncompleteCandidate(){
        val root=Files.createTempDirectory("genesis-spool-origin-footer-").toFile();val original=store(root);val id=UUID.randomUUID().toString()
        try{
            val text=raw("x".repeat(BackupFormSpool.CHUNK));original.append(view,binding,id,0,false,text.take(BackupFormSpool.CHUNK))
            val early=File(root,"$id.origin").readBytes();val form=requireNotNull(original.append(view,binding,id,1,true,text.substring(BackupFormSpool.CHUNK)))
            File(root,"$id.origin").writeBytes(early);assertTrue(File(root,"$id.ref").delete())
            val restarted=store(root);assertFalse(restarted.origins().single().complete)
            assertEquals("BACKUP_FORM_INCOMPLETE",assertThrows(IllegalStateException::class.java){restarted.retained()}.message)
            assertTrue(File(root,"$id.bin").exists());form.clear()
        }finally{original.clear();clean(root)}
    }
    @Test fun unknownLegacyOrUnboundFilesBlockWithoutDeletionOrRebinding(){
        for(suffix in listOf("pending","bin","index-pending","unknown")){
            val root=Files.createTempDirectory("genesis-spool-unbound-").toFile();val original=store(root)
            try{
                val file=File(root,"${UUID.randomUUID()}.$suffix");val bytes=byteArrayOf(1,2,3,4);file.writeBytes(bytes)
                assertEquals("BACKUP_FORM_UNBOUND_REMNANT",assertThrows(IllegalStateException::class.java){original.origins()}.message)
                assertThrows(IllegalStateException::class.java){original.retained()};assertArrayEquals(bytes,file.readBytes())
            }finally{original.clear();clean(root)}
        }
    }
    @Test fun originSubstitutionCannotAuthenticateAnotherRootOrCandidate(){
        val roots=List(2){Files.createTempDirectory("genesis-spool-origin-swap-").toFile()};val stores=roots.map{store(it)};val ids=List(2){UUID.randomUUID().toString()}
        try{
            for(index in 0..1)stores[index].append(view,binding,ids[index],0,false,"x".repeat(BackupFormSpool.CHUNK))
            File(roots[1],"${ids[1]}.origin").writeBytes(File(roots[0],"${ids[0]}.origin").readBytes())
            assertThrows(Exception::class.java){store(roots[1]).origins()};assertTrue(File(roots[1],"${ids[1]}.pending").exists())
            assertEquals(binding,store(roots[0]).origins().single().binding)
        }finally{stores.forEach{it.clear()};roots.forEach(::clean)}
    }
    @Test fun originEncryptionAndDirectorySyncFailureRejectOnlyTheNewCandidate(){
        for(failure in listOf("seal","sync")){
            val root=Files.createTempDirectory("genesis-spool-origin-failure-").toFile();var fail=false;val delegate=Crypto()
            val crypto=object:BackupFormSpool.Crypto by delegate {
                override fun seal(value:String,aad:String):String {if(fail&&failure=="seal"&&aad.startsWith("backup-form-spool-origin-"))error("SYNTHETIC_ORIGIN_FAILURE");return delegate.seal(value,aad)}
            }
            val original=store(root,crypto){if(fail&&failure=="sync")error("SYNTHETIC_ORIGIN_FAILURE")}
            try{
                val accepted=publish(original,raw("earlier accepted input"));fail=true
                assertEquals("SYNTHETIC_ORIGIN_FAILURE",assertThrows(IllegalStateException::class.java){publish(original,raw("new input"))}.message)
                assertEquals(raw("earlier accepted input"),accepted.reader().use{it.readText()});assertEquals(2,root.listFiles()!!.size)
                assertEquals(1,store(root).retained().size);accepted.clear()
            }finally{original.clear();clean(root)}
        }
    }
    @Test fun reusingAFinalCandidateIdCannotRemoveItsExistingProvenanceOrContent(){
        val root=Files.createTempDirectory("genesis-spool-origin-id-").toFile();val original=store(root);val id=UUID.randomUUID().toString()
        try{
            val accepted=publish(original,raw("accepted input"),id)
            assertEquals("BACKUP_TRANSFER_BUSY",assertThrows(IllegalStateException::class.java){publish(original,raw("replacement"),id)}.message)
            assertEquals(raw("accepted input"),accepted.reader().use{it.readText()});assertEquals(1,store(root).retained().size);accepted.clear()
        }finally{original.clear();clean(root)}
    }
}
