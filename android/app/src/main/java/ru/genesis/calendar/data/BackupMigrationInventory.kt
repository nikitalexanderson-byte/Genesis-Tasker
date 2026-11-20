package ru.genesis.calendar.data

import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.security.E2eeKeys
import java.util.Base64
import java.util.UUID

/** Session inventory until the complete coordinator protects capture under the
 * NEW root. Forms use encrypted bounded spill; binary candidates stay owned
 * memory. Acknowledged input survives view disposal. No restore/write authority. */
internal class BackupMigrationInventory(private val valueMetadata:(String)->JSONObject=NativeBackupValueManifest::read,
    private val spoolFactory:((Int)->BackupFormSpool)?=null) {
    internal class File(val descriptor:String,bytes:ByteArray) {
        private val content=bytes.copyOf()
        val id=JSONObject(descriptor).getString("id")
        val length get()=content.size
        fun capture()=JSONObject().put("descriptor",JSONObject(descriptor)).put("bytes",Base64.getUrlEncoder().withoutPadding().encodeToString(content))
        fun clear(){content.fill(0)}
        override fun toString()="BackupMigrationInventory.File([redacted])"
    }
    private class View {
        var mounted=true;var publishing=false;var form:BackupFormSpool.Form?=null;var settled=false
        var values:BackupValueInventory?=null
        val files=linkedMapOf<String,File>()
    }
    private var owner:String?=null
    private var epoch:Long?=null
    private val views=linkedMapOf<String,View>()
    private var revision=0L
    private var spool:BackupFormSpool?=null
    private var valueSpool:BackupFormSpool?=null
    @Synchronized fun version()=revision
    @Synchronized internal fun retainedFormCharacters(uid:String,generation:Long):List<Int>{bind(uid,generation);return views.values.map{it.form?.characters?:it.values?.characters?.coerceAtMost(Int.MAX_VALUE.toLong())?.toInt()?:0}}
    @Synchronized internal fun valueStatistics(uid:String,generation:Long):List<BackupValueInventory.Statistics>{bind(uid,generation);return views.values.mapNotNull{it.values?.statistics()}}
    private fun bind(uid:String,generation:Long){check(owner==uid&&epoch==generation){"E2EE_ACCOUNT_CHANGED"}}
    @Synchronized fun open(uid:String,generation:Long):String {
        E2eeKeys.technical(uid);check(generation>=0){"E2EE_SCOPE_BINDING_MISMATCH"}
        if(owner==null){owner=uid;epoch=generation}else bind(uid,generation)
        check(views.size<1000){"E2EE_SOURCE_TOO_LARGE"}
        return UUID.randomUUID().toString().also{views[it]=View();revision++}
    }
    private fun view(id:String)=views[id]?.also{check(it.mounted){"BACKUP_VIEW_CLOSED"}}?:error("BACKUP_VIEW_CLOSED")
    private fun retainedBytes()=views.values.sumOf{(it.form?.memoryBytes?:0L)+it.files.values.sumOf{file->file.length.toLong()}}
    @Synchronized fun beginPublication(id:String){view(id).publishing=true;revision++}
    @Synchronized fun retainFile(id:String,file:File){
        val row=view(id);check(!row.files.containsKey(file.id)){"BACKUP_TRANSFER"}
        check(row.files.size<1000&&views.values.sumOf{it.files.size}<10000&&retainedBytes()+file.length<=48L*1024*1024){"E2EE_SOURCE_TOO_LARGE"}
        row.files[file.id]=file;revision++
    }
    @Synchronized fun publish(id:String,raw:String){
        val row=view(id);check(row.values==null){"BACKUP_TRANSFER_ORDER"};val size=backupJsonUtf8(raw).let{try{it.size}finally{it.fill(0)}}
        check(size in 1..32*1024*1024&&retainedBytes()-(row.form?.memoryBytes?:0L)+size<=48L*1024*1024){"E2EE_SOURCE_TOO_LARGE"}
        // Preserve ORIGINAL text. The shared strict parser runs before nested
        // reconciliation; JSONObject here is only a bounded reference check.
        val value=JSONObject(raw);E2eeKeys.exact(value,setOf("protocol","state","settled","file"))
        check(value.get("protocol")==1&&value.get("settled") is Boolean&&value.get("state") is JSONObject){"E2EE_ARCHIVE_SOURCE_INVALID"}
        val header=JSONObject().put("protocol",1).put("settled",value.getBoolean("settled")).put("file",value.get("file"))
        accept(row,object:BackupFormSpool.Form{
            override val characters=raw.length;override val memoryBytes=size.toLong();override val header=header
            override fun reader()=java.io.StringReader(raw)
            override fun clear()=Unit
        })
    }
    private fun checkFile(row:View,selected:JSONObject){
            E2eeKeys.exact(selected,setOf("id","name","type","size","lastModified"))
            val file=row.files[selected.getString("id")]?:error("E2EE_ARCHIVE_FILE_ORIGIN_REQUIRED")
            check(selected.get("name") is String&&selected.get("type") is String&&selected.getString("name").length<=4096&&selected.getString("type").length<=1024
                &&selected.getLong("size")==file.length.toLong()&&selected.get("lastModified") is Number){"E2EE_ARCHIVE_SOURCE_INVALID"}
            val original=JSONObject(file.descriptor)
            val name=if(original.isNull("name"))"import.genesisbackup"else original.getString("name")
            val display=buildString{for(index in name.indices){val char=name[index];append(if(char.isHighSurrogate()&&(index+1==name.length||!name[index+1].isLowSurrogate())||
                char.isLowSurrogate()&&(index==0||!name[index-1].isHighSurrogate()))'\uFFFD'else char)}}
            val type=if(original.isNull("type"))"application/octet-stream"else original.getString("type").let{if(it.any{char->char.code<32||char.code>126})""else it.lowercase(java.util.Locale.ROOT)}
            val modified=if(original.isNull("lastModified"))0L else original.getLong("lastModified")
            check(selected.getString("name")==display&&selected.getString("type")==type&&selected.getLong("lastModified")==modified){"E2EE_ARCHIVE_FILE_INTEGRITY"}
    }
    private fun accept(row:View,form:BackupFormSpool.Form){
        val value=form.header
        if(!value.isNull("file"))checkFile(row,value.getJSONObject("file"))
        val previous=row.form;row.form=form;row.settled=value.getBoolean("settled");row.publishing=false;revision++
        // A cleanup error cannot retroactively turn accepted input into a
        // rejected setter. Any leftover encrypted locator stays inert history.
        runCatching{previous?.clear()}
    }
    @Synchronized fun appendForm(id:String,transfer:String,index:Int,last:Boolean,text:String){
        val row=view(id);check(row.values==null){"BACKUP_TRANSFER_ORDER"};if(index==0){row.publishing=true;revision++}
        val storage=spool?:checkNotNull(spoolFactory){"BACKUP_FORM_STORAGE"}.invoke(BackupStoredValue.MAX).also{spool=it}
        val binding="${owner!!.length}:$owner:${epoch!!}:$id"
        storage.append(id,binding,transfer,index,last,text)?.let{form->try{accept(row,form)}catch(error:Throwable){form.clear();throw error}}
    }
    @Synchronized fun appendValue(id:String,name:String,transfer:String,index:Int,last:Boolean,text:String){
        val row=view(id);check(row.form==null){"BACKUP_TRANSFER_ORDER"}
        if(index==0){check(views.values.sumOf{it.values?.retainedCount?:0}<10000){"E2EE_SOURCE_TOO_LARGE"};row.publishing=true;revision++}
        val registry=row.values?:BackupValueInventory({
            valueSpool?:checkNotNull(spoolFactory){"BACKUP_FORM_STORAGE"}.invoke(BackupValueInventory.PHYSICAL_MAX).also{valueSpool=it}
        },id,"${owner!!.length}:$owner:${epoch!!}:$id",valueMetadata){selected->checkFile(row,selected)}.also{row.values=it}
        registry.append(name,transfer,index,last,text);revision++
    }
    @Synchronized fun publishManifest(id:String,raw:String){
        val row=view(id);check(row.form==null&&views.values.sumOf{it.values?.retainedCount?:0}<10000){"BACKUP_TRANSFER_ORDER"}
        // Even an empty state needs an authenticated manifest and its view binding.
        val registry=row.values?:BackupValueInventory({
            valueSpool?:checkNotNull(spoolFactory){"BACKUP_FORM_STORAGE"}.invoke(BackupValueInventory.PHYSICAL_MAX).also{valueSpool=it}
        },id,"${owner!!.length}:$owner:${epoch!!}:$id",valueMetadata){selected->checkFile(row,selected)}.also{row.values=it}
        registry.commit(raw);row.settled=registry.settled;row.publishing=false;revision++
    }
    @Synchronized fun detach(id:String){views[id]?.let{spool?.cancel(id);it.values?.detach();it.mounted=false;it.publishing=false;revision++}}
    @Synchronized fun capture(uid:String,generation:Long):JSONObject {
        E2eeKeys.technical(uid);if(owner!=null)bind(uid,generation)
        check(views.values.none{it.mounted&&(it.publishing||(it.form==null&&it.values?.rawManifest==null)||!it.settled)}){"E2EE_ARCHIVE_OPERATION_IN_PROGRESS"}
        // The current migration collector still materializes an aggregate.
        // Refuse BEFORE reading a large spooled form; ordinary UI adoption no
        // longer pays this migration-only memory limit. Streaming the complete
        // source is a separate, explicit release gate.
        check(views.values.all{(it.form?.characters?:0)<=32*1024*1024&&(it.values?.largestValue?:0)<=32*1024*1024}&&
            views.values.sumOf{(it.form?.characters?.toLong()?:0)+(it.values?.characters?:0)+it.files.values.sumOf{file->(file.length.toLong()+2)/3*4}}<=48L*1024*1024){"E2EE_SNAPSHOT_TOO_LARGE"}
        val v2=views.values.any{it.values!=null}
        val result=JSONObject().put("protocol",if(v2)2 else 1).put("ownerId",uid).put("sessionEpoch",generation).put("views",JSONArray(views.map{(id,row)->
            JSONObject().put("id",id).put("source","backup-panel").put("mounted",row.mounted).put("rawForm",row.form?.reader()?.use{it.readText()}?:JSONObject.NULL)
                .put("files",JSONArray(row.files.values.map{it.capture()}))
                .also{if(v2)it.put("valueForm",row.values?.capture(uid,generation)?:JSONObject.NULL)}
        }))
        val bytes=backupJsonUtf8(result.toString())
        try{check(bytes.size<=48*1024*1024){"E2EE_SNAPSHOT_TOO_LARGE"}}finally{bytes.fill(0)}
        return result
    }
    @Synchronized fun clear(){views.values.forEach{it.form?.clear();it.values?.clear();it.files.values.forEach(File::clear)};views.clear();spool?.clear();spool=null;valueSpool?.clear();valueSpool=null;owner=null;epoch=null;revision++}
    override fun toString()="BackupMigrationInventory([redacted])"
}
