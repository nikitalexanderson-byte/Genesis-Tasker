package ru.genesis.calendar.data

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.Base64

class BackupMigrationInventoryTest {
    private val owner="native-form-owner"
    private fun raw(settled:Boolean=true,file:JSONObject?=null)=JSONObject().put("protocol",1).put("state",JSONObject().put("key"," exact input ").put("operationId","uncertain-original").put("zero",0).put("confirmed",false))
        .put("settled",settled).put("file",file?:JSONObject.NULL).toString()
    @Test fun acknowledgedOriginalFormAndEveryBinaryCandidateSurviveViewDisposal(){
        val memory=BackupMigrationInventory();val view=memory.open(owner,4);val bytes=byteArrayOf(0,-1,0xc3.toByte(),0x28)
        val file=BackupImportFile(bytes,"исходный.genesisbackup","APPLICATION/JSON",1234L,null);val retained=file.migrationCopy();memory.retainFile(view,retained)
        val selected=JSONObject().put("id",file.id).put("name","исходный.genesisbackup").put("type","application/json").put("size",4).put("lastModified",1234)
        val original=" \n"+raw(file=selected)+"\n";memory.publish(view,original);file.clear();bytes.fill(0);memory.detach(view)
        val captured=memory.capture(owner,4).getJSONArray("views").getJSONObject(0);assertEquals(original,captured.getString("rawForm"));assertFalse(captured.getBoolean("mounted"))
        val capturedFile=captured.getJSONArray("files").getJSONObject(0);assertEquals("APPLICATION/JSON",capturedFile.getJSONObject("descriptor").getString("type"))
        assertArrayEquals(byteArrayOf(0,-1,0xc3.toByte(),0x28),Base64.getUrlDecoder().decode(capturedFile.getString("bytes")));assertFalse(memory.toString().contains("exact"));memory.clear()
    }
    @Test fun distinctDetachedAndMountedBranchesRemainSeparateWithUncertainOperations(){
        val memory=BackupMigrationInventory();val first=memory.open(owner,2);memory.publish(first,raw(false));memory.detach(first)
        val second=memory.open(owner,2);memory.publish(second,raw());val captured=memory.capture(owner,2).getJSONArray("views")
        assertEquals(2,captured.length());assertFalse(JSONObject(captured.getJSONObject(0).getString("rawForm")).getBoolean("settled"));assertTrue(captured.getJSONObject(1).getBoolean("mounted"));memory.clear()
    }
    @Test fun mountedWorkAndPartialPublicationsNeverBecomeAnEmptyOrCompleteCapture(){
        val memory=BackupMigrationInventory();val view=memory.open(owner,1)
        assertThrows(IllegalStateException::class.java){memory.capture(owner,1)};memory.publish(view,raw(false));assertThrows(IllegalStateException::class.java){memory.capture(owner,1)}
        memory.publish(view,raw());val previous=memory.capture(owner,1).toString();memory.beginPublication(view)
        assertThrows(IllegalStateException::class.java){memory.capture(owner,1)};memory.detach(view)
        assertEquals(JSONObject(previous).getJSONArray("views").getJSONObject(0).getString("rawForm"),memory.capture(owner,1).getJSONArray("views").getJSONObject(0).getString("rawForm"));memory.clear()
    }
    @Test fun unknownFileReferencesMalformedFormsAndForeignEpochsCannotReplaceAcceptedState(){
        val memory=BackupMigrationInventory();val view=memory.open(owner,3);memory.publish(view,raw());val before=memory.capture(owner,3).toString()
        for(value in listOf("{}",raw().replace("\"protocol\":1","\"protocol\":2"),raw().replace("\"settled\":true","\"settled\":7"),raw(file=JSONObject().put("id","missing").put("name","a").put("type","").put("size",0).put("lastModified",0)))){
            assertThrows(Exception::class.java){memory.publish(view,value)};assertEquals(before,memory.capture(owner,3).toString())
        }
        assertThrows(IllegalStateException::class.java){memory.capture("other-owner",3)};assertThrows(IllegalStateException::class.java){memory.capture(owner,4)};memory.clear()
    }
    @Test fun clearedSessionWipesOwnedBuffersAndRejectsStaleViewTokensEvenForTheSameUid(){
        val memory=BackupMigrationInventory();val view=memory.open(owner,7);val file=BackupImportFile(byteArrayOf(4,3,2,1),null,null,null,null).migrationCopy()
        memory.retainFile(view,file);memory.publish(view,raw());val before=memory.version();memory.clear();assertTrue(memory.version()>before)
        assertThrows(IllegalStateException::class.java){file.capture()}
        val next=memory.open(owner,9);memory.publish(next,raw());assertThrows(IllegalStateException::class.java){memory.publish(view,raw())};assertEquals(1,memory.capture(owner,9).getJSONArray("views").length());memory.clear()
    }
}
