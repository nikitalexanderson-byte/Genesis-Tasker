package ru.genesis.calendar.data

import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.util.UUID

/** Actual Android Keystore and directory fsync. Synthetic process-loss windows,
 * not a reboot/power-loss fault-injection or complete archive acceptance. */
class NativeBackupFormOriginsTest {
    private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
    private val view=UUID.randomUUID().toString()
    private val binding="synthetic-origin-owner:epoch7:$view:field-v2:4:note"
    private fun store(root:File):BackupFormSpool {
        val cipher=LocalCipher()
        return BackupFormSpool(root,object:BackupFormSpool.Crypto {
            override fun seal(value:String,aad:String)=cipher.encrypt(value,aad)
            override fun open(value:String,aad:String)=cipher.decrypt(value,aad)
        },NativeBackupFormMetadata::read,syncDirectory=::syncNativeBackupDirectory)
    }
    private fun root()=File(context.noBackupFilesDir,"origins-synthetic-${UUID.randomUUID()}")
    private fun clean(root:File){root.listFiles()?.forEach{assertTrue(it.isFile);it.delete()};root.delete()}
    @Test fun aRestartKeepsTheOriginalPartialBindingAndRefusesCompleteHistory(){
        val root=root();val original=store(root);val id=UUID.randomUUID().toString()
        try{
            original.append(view,binding,id,0,false,"x".repeat(BackupFormSpool.CHUNK))
            val restarted=store(root);val origin=restarted.origins().single()
            assertEquals(binding,origin.binding);assertEquals(view,origin.view);assertEquals(id,origin.id);assertFalse(origin.complete)
            assertEquals("BACKUP_FORM_INCOMPLETE",assertThrows(IllegalStateException::class.java){restarted.retained()}.message)
            assertTrue(File(root,"$id.pending").length()>BackupFormSpool.CHUNK)
            assertTrue(root.listFiles()!!.all{!it.readBytes().toString(Charsets.US_ASCII).contains(binding)})
        }finally{original.clear();clean(root)}
    }
    @Test fun completedOldReferenceAndMatchingOriginSurviveTheFinalCleanupWindow(){
        val root=root();val original=store(root);val id=UUID.randomUUID().toString()
        try{
            val raw="{\"protocol\":1,\"state\":{\"note\":\"${"x".repeat(BackupFormSpool.CHUNK)}\"},\"settled\":true,\"file\":null}"
            original.append(view,binding,id,0,false,raw.take(BackupFormSpool.CHUNK));val early=File(root,"$id.origin").readBytes()
            val form=requireNotNull(original.append(view,binding,id,1,true,raw.substring(BackupFormSpool.CHUNK)))
            File(root,"$id.origin").writeBytes(early);val restarted=store(root)
            assertTrue(restarted.origins().single().complete);assertEquals(raw,restarted.retained().single().second.reader().use{it.readText()})
            File(root,"$id.origin").appendText("!");assertThrows(Exception::class.java){restarted.retained()};assertTrue(File(root,"$id.bin").exists())
            form.clear()
        }finally{original.clear();clean(root)}
    }
    @Test fun unknownOldRemnantCannotBeSweptOrReportedAsAnEmptyHistory(){
        val root=root();assertTrue(root.mkdir());val original=store(root);val file=File(root,"${UUID.randomUUID()}.pending")
        try{
            val bytes=byteArrayOf(1,2,3,4);file.writeBytes(bytes)
            assertEquals("BACKUP_FORM_UNBOUND_REMNANT",assertThrows(IllegalStateException::class.java){original.origins()}.message)
            assertThrows(IllegalStateException::class.java){original.retained()};assertArrayEquals(bytes,file.readBytes())
            File(context.getExternalFilesDir(null),"backup336-origins-proof.json").writeText(JSONObject().put("synthetic",true)
                .put("originalPartialBinding",true).put("completedV1Compatibility",true).put("unknownRemnantsBlock",true)
                .put("scope","Keystore/directory-sync and synthetic restart windows; no power-loss or coordinator acceptance").toString(2))
        }finally{original.clear();clean(root)}
    }
}
