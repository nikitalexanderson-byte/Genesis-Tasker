package ru.genesis.calendar.data

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.InputStream
import java.security.MessageDigest
import java.util.Base64

class BackupImportFileTest {
    @Test fun originalBinaryBytesAndProviderMetadataSurviveFragmentsWithoutUtf8Decoding(){
        val original=ByteArray(BackupImportFile.CHUNK*2+13){(it%256).toByte()};val bytes=original.copyOf()
        val file=BackupImportFile.read(ByteArrayInputStream(bytes),"исходный-α.genesisbackup","APPLICATION/JSON",1700000000123L,bytes.size.toLong()+1,{})
        bytes.fill(0);val info=file.descriptor();assertEquals(original.size,info.getInt("length"));assertEquals("исходный-α.genesisbackup",info.getString("name"))
        assertEquals("APPLICATION/JSON",info.getString("type"));assertEquals(1700000000123L,info.getLong("lastModified"));assertEquals(original.size.toLong()+1,info.getLong("declaredSize"))
        assertEquals(MessageDigest.getInstance("SHA-256").digest(original).joinToString(""){"%02x".format(it)},info.getString("sha256"))
        val joined=java.io.ByteArrayOutputStream();var offset=0
        while(offset<original.size){val part=file.chunk(file.id,offset);val next=minOf(offset+BackupImportFile.CHUNK,original.size)
            assertEquals(offset,part.getInt("offset"));assertEquals(next,part.getInt("nextOffset"));assertEquals(next==original.size,part.getBoolean("eof"))
            joined.write(Base64.getUrlDecoder().decode(part.getString("bytes")));offset=next}
        assertArrayEquals(original,joined.toByteArray());assertFalse(file.toString().contains("исходный"));file.clear()
    }
    @Test fun absentMetadataAndEmptyFileAreExplicitAndCleanupRetiresAllReadPorts(){
        val file=BackupImportFile(byteArrayOf(),null,null,null,null);val info=file.descriptor();assertEquals(0,info.getInt("length"))
        for(field in listOf("name","type","lastModified","declaredSize"))assertTrue(info.isNull(field))
        assertEquals("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",info.getString("sha256"))
        assertThrows(IllegalStateException::class.java){file.chunk(file.id,0)};file.clear();file.clear()
        assertThrows(IllegalStateException::class.java){file.descriptor()}
    }
    @Test fun wrongTransferIdsOffsetsBoundsAndOversizeInputAreRefused(){
        val file=BackupImportFile(byteArrayOf(0,-1,0xc3.toByte(),0x28),"test",null,null,null)
        for(offset in listOf(-1,1,4,Int.MAX_VALUE))assertThrows(IllegalStateException::class.java){file.chunk(file.id,offset)}
        assertThrows(IllegalStateException::class.java){file.chunk("foreign",0)}
        assertThrows(IllegalArgumentException::class.java){BackupImportFile(ByteArray(GenesisBackupContainer.MAX_FILE+1),null,null,null,null)}
        assertThrows(IllegalArgumentException::class.java){BackupImportFile(byteArrayOf(),"x".repeat(4097),null,null,null)}
        file.clear();assertThrows(IllegalStateException::class.java){file.chunk(file.id,0)}
    }
    @Test fun keyLossDuringReadAndFailedStreamNeverPublishAnEmptyOrPartialFile(){
        var reads=0;val changed=object:ByteArrayInputStream(byteArrayOf(0,-1,3)){
            override fun read(buffer:ByteArray,off:Int,len:Int):Int{reads++;return super.read(buffer,off,len)}}
        assertThrows(IllegalStateException::class.java){BackupImportFile.read(changed,null,null,null,null,{check(reads==0){"BACKUP_OWNER"}})}
        val failed=object:InputStream(){override fun read():Int=throw java.io.IOException("unavailable selected file")}
        assertThrows(java.io.IOException::class.java){BackupImportFile.read(failed,null,null,null,null,{})}
    }
}
