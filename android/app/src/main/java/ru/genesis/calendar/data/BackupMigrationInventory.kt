package ru.genesis.calendar.data

import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.security.E2eeKeys
import java.util.Base64
import java.util.UUID

/** Process/session memory only until the complete coordinator protects capture
 * under the NEW root. Every acknowledged input survives view disposal, including
 * uncertain operations and original selected bytes. No restore/write/IO port. */
internal class BackupMigrationInventory {
    internal class File(val descriptor:String,bytes:ByteArray) {
        private val content=bytes.copyOf()
        val id=JSONObject(descriptor).getString("id")
        val length get()=content.size
        fun capture()=JSONObject().put("descriptor",JSONObject(descriptor)).put("bytes",Base64.getUrlEncoder().withoutPadding().encodeToString(content))
        fun clear(){content.fill(0)}
        override fun toString()="BackupMigrationInventory.File([redacted])"
    }
    private class View {
        var mounted=true;var publishing=false;var raw:String?=null;var rawBytes=0;var settled=false
        val files=linkedMapOf<String,File>()
    }
    private var owner:String?=null
    private var epoch:Long?=null
    private val views=linkedMapOf<String,View>()
    private var revision=0L
    @Synchronized fun version()=revision
    private fun bind(uid:String,generation:Long){check(owner==uid&&epoch==generation){"E2EE_ACCOUNT_CHANGED"}}
    @Synchronized fun open(uid:String,generation:Long):String {
        E2eeKeys.technical(uid);check(generation>=0){"E2EE_SCOPE_BINDING_MISMATCH"}
        if(owner==null){owner=uid;epoch=generation}else bind(uid,generation)
        check(views.size<1000){"E2EE_SOURCE_TOO_LARGE"}
        return UUID.randomUUID().toString().also{views[it]=View();revision++}
    }
    private fun view(id:String)=views[id]?.also{check(it.mounted){"BACKUP_VIEW_CLOSED"}}?:error("BACKUP_VIEW_CLOSED")
    private fun retainedBytes()=views.values.sumOf{it.rawBytes.toLong()+it.files.values.sumOf{file->file.length.toLong()}}
    @Synchronized fun beginPublication(id:String){view(id).publishing=true;revision++}
    @Synchronized fun retainFile(id:String,file:File){
        val row=view(id);check(!row.files.containsKey(file.id)){"BACKUP_TRANSFER"}
        check(row.files.size<1000&&views.values.sumOf{it.files.size}<10000&&retainedBytes()+file.length<=48L*1024*1024){"E2EE_SOURCE_TOO_LARGE"}
        row.files[file.id]=file;revision++
    }
    @Synchronized fun publish(id:String,raw:String){
        val row=view(id);val size=raw.toByteArray(Charsets.UTF_8).let{try{it.size}finally{it.fill(0)}}
        check(size in 1..32*1024*1024&&retainedBytes()-row.rawBytes+size<=48L*1024*1024){"E2EE_SOURCE_TOO_LARGE"}
        // Preserve ORIGINAL text. The shared strict parser runs before nested
        // reconciliation; JSONObject here is only a bounded reference check.
        val value=JSONObject(raw);E2eeKeys.exact(value,setOf("protocol","state","settled","file"))
        check(value.get("protocol")==1&&value.get("settled") is Boolean&&value.get("state") is JSONObject){"E2EE_ARCHIVE_SOURCE_INVALID"}
        if(!value.isNull("file")){
            val selected=value.getJSONObject("file");E2eeKeys.exact(selected,setOf("id","name","type","size","lastModified"))
            val file=row.files[selected.getString("id")]?:error("E2EE_ARCHIVE_FILE_ORIGIN_REQUIRED")
            check(selected.get("name") is String&&selected.get("type") is String&&selected.getString("name").length<=4096&&selected.getString("type").length<=1024
                &&selected.getLong("size")==file.length.toLong()&&selected.get("lastModified") is Number){"E2EE_ARCHIVE_SOURCE_INVALID"}
        }
        row.raw=raw;row.rawBytes=size;row.settled=value.getBoolean("settled");row.publishing=false;revision++
    }
    @Synchronized fun detach(id:String){views[id]?.let{it.mounted=false;it.publishing=false;revision++}}
    @Synchronized fun capture(uid:String,generation:Long):JSONObject {
        E2eeKeys.technical(uid);if(owner!=null)bind(uid,generation)
        check(views.values.none{it.mounted&&(it.publishing||it.raw==null||!it.settled)}){"E2EE_ARCHIVE_OPERATION_IN_PROGRESS"}
        val result=JSONObject().put("protocol",1).put("ownerId",uid).put("sessionEpoch",generation).put("views",JSONArray(views.map{(id,row)->
            JSONObject().put("id",id).put("source","backup-panel").put("mounted",row.mounted).put("rawForm",row.raw?:JSONObject.NULL)
                .put("files",JSONArray(row.files.values.map{it.capture()}))
        }))
        val bytes=result.toString().toByteArray(Charsets.UTF_8)
        try{check(bytes.size<=48*1024*1024){"E2EE_SNAPSHOT_TOO_LARGE"}}finally{bytes.fill(0)}
        return result
    }
    @Synchronized fun clear(){views.values.forEach{it.files.values.forEach(File::clear)};views.clear();owner=null;epoch=null;revision++}
    override fun toString()="BackupMigrationInventory([redacted])"
}
