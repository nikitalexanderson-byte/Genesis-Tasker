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

class BackupFormSpoolTest {
    private val view=UUID.randomUUID().toString()
    private val binding="owner:original-epoch:$view"
    private class Crypto:BackupFormSpool.Crypto {
        private val key=SecretKeySpec(ByteArray(32){(it+17).toByte()},"AES")
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
    private fun raw(value:String)="{\"protocol\":1,\"state\":{\"input\":${JSONObject.quote(value)}},\"settled\":true,\"file\":null}"
    private fun spool(root:File,quota:Long=768L*1024*1024)=BackupFormSpool(root,Crypto(),{reader->
        val value=JSONObject(reader.readText());check(value.get("state") is JSONObject)
        JSONObject().put("protocol",1).put("settled",value.getBoolean("settled")).put("file",value.get("file"))
    },quota=quota)
    private fun publish(store:BackupFormSpool,text:String,id:String=UUID.randomUUID().toString()):BackupFormSpool.Form {
        var form:BackupFormSpool.Form?=null
        text.chunked(BackupFormSpool.CHUNK).forEachIndexed{index,part->form=store.append(view,binding,id,index,(index+1)*BackupFormSpool.CHUNK>=text.length,part)}
        return requireNotNull(form)
    }
    @Test fun exactCodeUnitsCrossFrameBoundariesAndNeverReachPlaintextDisk(){
        val root=Files.createTempDirectory("genesis-form-spool-test-").toFile();val store=spool(root)
        try{
            val text=raw("original secret " + "α".repeat(BackupFormSpool.CHUNK-53)+"\uD83D\uDE00\uD800\u0000\uFEFF")
            val form=publish(store,text);assertEquals(0L,form.memoryBytes);assertEquals(text,form.reader().use{it.readText()});assertEquals(text.length,form.characters)
            assertTrue(form.header.getBoolean("settled"));assertTrue(root.listFiles()!!.all{!it.readBytes().toString(Charsets.US_ASCII).contains("original secret")})
            assertFalse(form.toString().contains("original"));form.clear();assertTrue(root.listFiles()!!.isEmpty())
        }finally{store.clear();root.delete()}
    }
    @Test fun footerTruncationTrailingBytesAndCiphertextMutationAreRefused(){
        for(kind in listOf("tail","truncated","mutated")){
            val root=Files.createTempDirectory("genesis-form-spool-test-").toFile();val store=spool(root)
            try{
                val form=publish(store,raw("exact"));val path=root.listFiles()!!.single{it.name.endsWith(".bin")};val original=path.readBytes()
                when(kind){"tail"->path.appendBytes(byteArrayOf(7));"truncated"->path.writeBytes(original.copyOf(original.size-1));else->{original[12]=if(original[12]==65.toByte())66 else 65;path.writeBytes(original)}}
                assertThrows(Exception::class.java){form.reader().use{it.readText()}};form.clear()
            }finally{store.clear();root.delete()}
        }
    }
    @Test fun scopeOrBlobSubstitutionCannotAuthenticateAnotherAcceptedForm(){
        val root=Files.createTempDirectory("genesis-form-spool-test-").toFile();val store=spool(root)
        try{
            val a=publish(store,raw("first"));val first=root.listFiles()!!.single{it.name.endsWith(".bin")}
            val b=publish(store,raw("other"));val second=root.listFiles()!!.first{it.name.endsWith(".bin")&&it!=first}
            second.writeBytes(first.readBytes());assertThrows(Exception::class.java){b.reader().use{it.readText()}}
            assertTrue(a.reader().use{it.readText()}.contains("first"));a.clear();b.clear()
        }finally{store.clear();root.delete()}
    }
    @Test fun orderingFailureAndReplacementNeverDiscardThePreviousAcceptedForm(){
        val root=Files.createTempDirectory("genesis-form-spool-test-").toFile();val store=spool(root)
        try{
            val first=publish(store,raw("accepted"));val id=UUID.randomUUID().toString()
            assertNull(store.append(view,binding,id,0,false," ".repeat(BackupFormSpool.CHUNK)))
            assertThrows(IllegalStateException::class.java){store.append(view,binding,id,2,true,"{}")}
            assertEquals(raw("accepted"),first.reader().use{it.readText()})
            assertEquals(2,root.listFiles()!!.size)
            val next=publish(store,raw("replacement"));assertEquals(raw("replacement"),next.reader().use{it.readText()});first.clear();next.clear()
        }finally{store.clear();root.delete()}
    }
    @Test fun quotaFailureAndAbandonedPartialAreBoundedAndLeaveAcceptedInputIntact(){
        val root=Files.createTempDirectory("genesis-form-spool-test-").toFile();val store=spool(root,10_000)
        try{
            val first=publish(store,raw("accepted"))
            assertThrows(IllegalStateException::class.java){publish(store,raw("x".repeat(10_000)))}
            assertEquals(raw("accepted"),first.reader().use{it.readText()});assertEquals(2,root.listFiles()!!.size)
            store.cancel(view);first.clear()
        }finally{store.clear();root.delete()}
    }
    @Test fun invalidFinalMetadataCannotBecomeAnAcknowledgedForm(){
        val root=Files.createTempDirectory("genesis-form-spool-test-").toFile();val store=spool(root)
        try{val first=publish(store,raw("accepted"));assertThrows(Exception::class.java){publish(store,"{}")}
            assertEquals(raw("accepted"),first.reader().use{it.readText()});assertEquals(2,root.listFiles()!!.size);first.clear()
        }finally{store.clear();root.delete()}
    }
    @Test fun encryptedRestartLocatorsRetainTheExactBindingWithoutResumingAnOperation(){
        val root=Files.createTempDirectory("genesis-form-spool-test-").toFile();val store=spool(root)
        try{
            val source=raw("accepted before process loss");val original=publish(store,source)
            val restarted=spool(root);val sources=restarted.retained();assertEquals(1,sources.size);assertEquals(binding,sources.single().first)
            assertEquals(source,sources.single().second.reader().use{it.readText()});assertTrue(sources.single().second.header.getBoolean("settled"))
            val ref=root.listFiles()!!.single{it.name.endsWith(".ref")};ref.appendText("!")
            assertThrows(Exception::class.java){restarted.retained()};original.clear();restarted.clear()
        }finally{store.clear();root.delete()}
    }
}
