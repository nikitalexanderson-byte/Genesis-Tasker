package ru.genesis.calendar.data

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayOutputStream

class BackupInventorySourceTest {
    private val owner="inventory-stream-test-owner"
    private class Output:ByteArrayOutputStream(){var closed=false;var flushed=false;override fun close(){closed=true};override fun flush(){flushed=true}}
    @Test fun sourceKeepsOriginalFormAndProviderTextWithoutClosingTheCallerOutput(){
        val memory=BackupMigrationInventory();val view=memory.open(owner,7);val input=BackupImportFile(byteArrayOf(0,-1,0xc3.toByte(),0x28),"\uFEFFbad\uD800name","APPLICATION/JSON",null,null)
        try{
            val file=input.migrationCopy();val descriptor=file.descriptor;memory.retainFile(view,file)
            val raw=" \n{\"protocol\":1,\"state\":{\"private\":1,\"another\":2,\"raw\":\"literal\uDFFFunit\"},\"settled\":true,\"file\":null}\r\n"
            memory.publish(view,raw);memory.detach(view);val output=Output();memory.source(owner,7).writeTo(output)
            val result=JSONObject(output.toString(Charsets.UTF_8.name()));assertEquals(3,result.getInt("protocol"));assertEquals(owner,result.getString("ownerId"));assertEquals(7,result.getInt("sessionEpoch"))
            val row=result.getJSONArray("views").getJSONObject(0);assertEquals(raw,row.getString("rawForm"));assertTrue(row.isNull("valueForm"));assertFalse(row.getBoolean("mounted"))
            assertEquals(descriptor,row.getJSONArray("files").getJSONObject(0).getString("rawDescriptor"));assertEquals("AP_DKA",row.getJSONArray("files").getJSONObject(0).getString("bytes"))
            assertFalse(output.closed);assertFalse(output.flushed);assertFalse(memory.source(owner,7).toString().contains(owner))
        }finally{input.clear();memory.clear()}
    }
    @Test fun changingTheInventoryAfterCatalogCaptureRefusesWithoutRemovingTheCurrentInput(){
        val memory=BackupMigrationInventory();val view=memory.open(owner,7)
        try{
            val raw="{\"protocol\":1,\"state\":{\"note\":\"original input\"},\"settled\":true,\"file\":null}";memory.publish(view,raw)
            val source=memory.source(owner,7);memory.detach(view);val output=Output()
            assertEquals("E2EE_ARCHIVE_CAPTURE_CHANGED",assertThrows(IllegalStateException::class.java){source.writeTo(output)}.message)
            assertEquals(0,output.size());assertEquals(raw,memory.capture(owner,7).getJSONArray("views").getJSONObject(0).getString("rawForm"));assertFalse(output.closed)
        }finally{memory.clear()}
    }
    @Test fun clearingAndReopeningTheSameUidAndEpochCannotRebindAnOldSource(){
        val memory=BackupMigrationInventory();val view=memory.open(owner,7)
        try{
            memory.publish(view,"{\"protocol\":1,\"state\":{},\"settled\":true,\"file\":null}");val source=memory.source(owner,7)
            memory.clear();val next=memory.open(owner,7);memory.publish(next,"{\"protocol\":1,\"state\":{\"new\":true},\"settled\":true,\"file\":null}")
            assertEquals("E2EE_ACCOUNT_CHANGED",assertThrows(IllegalStateException::class.java){source.writeTo(Output())}.message)
            assertTrue(memory.capture(owner,7).getJSONArray("views").getJSONObject(0).getString("rawForm").contains("new"))
        }finally{memory.clear()}
    }
    @Test fun originalActorRetirementDuringWriteLeavesOnlyCallerOwnedPartialOutput(){
        val memory=BackupMigrationInventory();val view=memory.open(owner,7);var current=true;var calls=0
        try{
            val raw="{\"protocol\":1,\"state\":{\"note\":\"original input\"},\"settled\":true,\"file\":null}";memory.publish(view,raw)
            val source=memory.source(owner,7){check(current){"E2EE_ACCOUNT_CHANGED"};if(++calls>8)current=false};val output=Output()
            assertEquals("E2EE_ACCOUNT_CHANGED",assertThrows(IllegalStateException::class.java){source.writeTo(output)}.message)
            assertTrue(output.size()>0);assertFalse(output.closed);assertFalse(output.flushed);assertThrows(Exception::class.java){JSONObject(output.toString(Charsets.UTF_8.name()))}
            assertEquals(raw,memory.capture(owner,7).getJSONArray("views").getJSONObject(0).getString("rawForm"))
        }finally{memory.clear()}
    }
}
