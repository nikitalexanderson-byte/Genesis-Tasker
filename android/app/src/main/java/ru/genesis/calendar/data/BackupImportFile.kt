package ru.genesis.calendar.data

import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.security.MessageDigest
import java.util.Base64
import java.util.UUID

/** A bounded original byte transfer, never decoded as text. No URI/path enters
 * the offline renderer. Provider metadata absence is explicit, not invented. */
internal class BackupImportFile(bytes:ByteArray,private val name:String?,private val type:String?,
    private val lastModified:Long?,private val declaredSize:Long?) {
    val id:String=UUID.randomUUID().toString()
    private val content:ByteArray
    private val hash:String
    private var retired=false
    init{
        require(bytes.size<=GenesisBackupContainer.MAX_FILE){"BACKUP_TOO_LARGE"}
        require((name==null||name.length<=4096)&&(type==null||type.length<=1024)
            &&listOf(lastModified,declaredSize).all{it==null||it in -9007199254740991L..9007199254740991L}){"BACKUP_FILE_METADATA"}
        content=bytes.copyOf();hash=MessageDigest.getInstance("SHA-256").digest(content).joinToString(""){"%02x".format(it)}
    }
    @Synchronized fun descriptor():JSONObject {
        check(!retired){"BACKUP_TRANSFER"}
        return JSONObject().put("protocol",1).put("id",id).put("length",content.size).put("name",name?:JSONObject.NULL)
            .put("type",type?:JSONObject.NULL).put("lastModified",lastModified?:JSONObject.NULL)
            .put("declaredSize",declaredSize?:JSONObject.NULL).put("sha256",hash)
    }
    @Synchronized fun chunk(expectedId:String,offset:Int):JSONObject {
        check(!retired&&expectedId==id&&offset>=0&&offset<content.size&&offset%CHUNK==0){"BACKUP_TRANSFER"}
        val next=minOf(offset+CHUNK,content.size);val part=content.copyOfRange(offset,next)
        return try{JSONObject().put("id",id).put("offset",offset).put("bytes",Base64.getUrlEncoder().withoutPadding().encodeToString(part))
            .put("nextOffset",next).put("eof",next==content.size)}finally{part.fill(0)}
    }
    @Synchronized fun clear(){retired=true;content.fill(0)}
    @Synchronized fun migrationCopy():BackupMigrationInventory.File {
        check(!retired){"BACKUP_TRANSFER"};return BackupMigrationInventory.File(descriptor().toString(),content)
    }
    override fun toString()="BackupImportFile([redacted])"
    companion object {
        const val CHUNK=98304
        private class WipingBuffer:ByteArrayOutputStream(){fun wipe(){buf.fill(0);reset()}}
        fun read(input:InputStream,name:String?,type:String?,lastModified:Long?,declaredSize:Long?,assertCurrent:()->Unit):BackupImportFile {
            val output=WipingBuffer();val buffer=ByteArray(65536)
            try{
                assertCurrent()
                while(true){val count=input.read(buffer);assertCurrent();if(count<0)break
                    check(count>0){"BACKUP_TRANSFER"};require(output.size().toLong()+count<=GenesisBackupContainer.MAX_FILE){"BACKUP_TOO_LARGE"};output.write(buffer,0,count)}
                val bytes=output.toByteArray()
                return try{assertCurrent();BackupImportFile(bytes,name,type,lastModified,declaredSize)}finally{bytes.fill(0)}
            }finally{buffer.fill(0);output.wipe()}
        }
    }
}
