package ru.genesis.calendar.security

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.AtomicFile
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.util.UUID
import ru.genesis.calendar.data.GenesisBackupContainer

/** SAF survives vault lock/process death using only an already encrypted export
 * or a chosen input URI. No recovery key, plaintext input, unlocked device or
 * account authority is persisted in this handoff. Late picker results bind an
 * exact job identity; they cannot select another account's new operation. */
internal object PrivateBackupHandoff{
    data class Job(val id:String,val ownerId:String,val kind:String,val phase:String,val sha256:String?=null,val uri:String?=null)
    private val mutable=MutableStateFlow<Job?>(null);val state=mutable.asStateFlow();private var initialized=false
    private fun manifest(context:Context)=AtomicFile(File(context.noBackupFilesDir,"private-backup-handoff-v1.json"))
    private fun artifact(context:Context,id:String):AtomicFile{
        check(UUID.fromString(id).toString()==id){"BACKUP_INVALID"};val folder=context.noBackupFilesDir.canonicalFile;val file=File(folder,"private-backup-$id.genesisbackup")
        check(file.canonicalFile.parentFile==folder){"BACKUP_INVALID"};return AtomicFile(file)
    }
    private fun json(job:Job)=JSONObject().put("protocol",1).put("id",job.id).put("ownerId",job.ownerId).put("kind",job.kind).put("phase",job.phase).put("sha256",job.sha256?:JSONObject.NULL).put("uri",job.uri?:JSONObject.NULL)
    private fun parse(value:JSONObject):Job{
        E2eeKeys.exact(value,setOf("protocol","id","ownerId","kind","phase","sha256","uri"));check(value.getInt("protocol")==1){"BACKUP_INVALID"};val id=value.getString("id");check(UUID.fromString(id).toString()==id){"BACKUP_INVALID"};val owner=E2eeKeys.technical(value.getString("ownerId"))
        val kind=value.getString("kind");val phase=value.getString("phase");check(kind in setOf("export","import")&&phase in setOf("pick","picking","writing","ready","complete","failed","cancelled")){"BACKUP_INVALID"}
        val hash=value.optString("sha256").takeUnless{value.isNull("sha256")};if(hash!=null)E2eeEnvelope.decode(hash,32)
        val uri=value.optString("uri").takeUnless{value.isNull("uri")};if(uri!=null)check(uri.length<=8192&&Uri.parse(uri).scheme=="content"){"BACKUP_INVALID"}
        check(kind!="export"||hash!=null){"BACKUP_INVALID"};return Job(id,owner,kind,phase,hash,uri)
    }
    private fun read(context:Context):Job?{
        val file=manifest(context);if(!file.baseFile.exists()&&!File(file.baseFile.path+".bak").exists()&&!File(file.baseFile.path+".new").exists())return null
        val bytes=file.openRead().use{input->readBounded(input,16384)};return try{parse(E2eeFileManifestJson.readPrivateDocument(bytes))}finally{bytes.fill(0)}
    }
    @Synchronized fun initialize(context:Context){if(!initialized){mutable.value=read(context);initialized=true}}
    private fun save(context:Context,job:Job){
        val bytes=json(job).toString().toByteArray(Charsets.UTF_8);val file=manifest(context);val output=file.startWrite()
        try{output.write(bytes);file.finishWrite(output)}catch(error:Exception){file.failWrite(output);throw error}finally{bytes.fill(0)}
        check(read(context)==job){"BACKUP_HANDOFF_UNVERIFIED"};mutable.value=job
    }
    private fun available(context:Context){initialize(context);check(mutable.value?.phase.let{it==null||it in setOf("complete","cancelled")}){"BACKUP_HANDOFF_BUSY"}}
    @Synchronized fun prepareExport(context:Context,account:E2eeProductAccount,payload:JSONObject,recovery:String):Job{
        account.requireOpen();available(context);check(payload.getString("ownerId")==account.ownerId){"E2EE_SCOPE_BINDING_MISMATCH"}
        val id=payload.getString("backupId");val file=artifact(context,id);check(!file.baseFile.exists()&&!File(file.baseFile.path+".bak").exists()&&!File(file.baseFile.path+".new").exists()){"BACKUP_HANDOFF_BUSY"}
        val sealed=GenesisBackupContainer.seal(payload,recovery).toByteArray(Charsets.UTF_8)
        try{account.requireOpen();check(android.os.StatFs(context.noBackupFilesDir.absolutePath).availableBytes>sealed.size+1024*1024L){"E2EE_STORAGE_CAPACITY"};val output=file.startWrite()
            try{output.write(sealed);file.finishWrite(output)}catch(error:Exception){file.failWrite(output);throw error}
            val expected=hash(sealed);val copied=file.openRead().use{readBounded(it,GenesisBackupContainer.MAX_FILE)};try{check(hash(copied)==expected){"BACKUP_HANDOFF_UNVERIFIED"}}finally{copied.fill(0)}
            account.requireOpen();return Job(id,account.ownerId,"export","pick",expected).also{save(context,it)}
        }finally{sealed.fill(0)}
    }
    @Synchronized fun prepareImport(context:Context,account:E2eeProductAccount):Job{account.requireOpen();available(context);return Job(UUID.randomUUID().toString(),account.ownerId,"import","pick").also{save(context,it)}}
    @Synchronized fun beginPicker(context:Context,id:String):Job?{initialize(context);val job=mutable.value?.takeIf{it.id==id&&it.phase=="pick"}?:return null;return job.copy(phase="picking").also{save(context,it)}}
    @Synchronized fun selected(context:Context,id:String,uri:Uri?):Job?{
        initialize(context);val job=mutable.value?.takeIf{it.id==id&&it.phase=="picking"}?:return null
        if(uri==null)return job.copy(phase="cancelled").also{save(context,it);if(job.kind=="export")artifact(context,id).delete()}
        check(uri.scheme=="content"&&uri.toString().length<=8192){"BACKUP_INVALID"}
        runCatching{context.contentResolver.takePersistableUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION or if(job.kind=="export")Intent.FLAG_GRANT_WRITE_URI_PERMISSION else 0)}
        return job.copy(phase=if(job.kind=="import")"ready"else"writing",uri=uri.toString()).also{save(context,it)}
    }
    /** Resume only an exact prefix of this official encrypted artifact. A
     * differently edited destination is never overwritten after a crash. */
    @Synchronized fun deliver(context:Context,id:String){
        initialize(context);val job=mutable.value?.takeIf{it.id==id&&it.kind=="export"&&it.phase=="writing"}?:return;val uri=Uri.parse(checkNotNull(job.uri));val file=artifact(context,id)
        val bytes=file.openRead().use{readBounded(it,GenesisBackupContainer.MAX_FILE)}
        try{check(hash(bytes)==job.sha256){"BACKUP_HANDOFF_UNVERIFIED"};val prior=context.contentResolver.openInputStream(uri)?.use{readBounded(it,GenesisBackupContainer.MAX_FILE)}?:error("BACKUP_HANDOFF_UNVERIFIED")
            val complete=try{check(prior.size<=bytes.size&&prior.indices.all{prior[it]==bytes[it]}){"BACKUP_DESTINATION_CHANGED"};prior.size==bytes.size}finally{prior.fill(0)}
            if(!complete)context.contentResolver.openOutputStream(uri,"wt")?.use{it.write(bytes);it.flush()}?:error("BACKUP_HANDOFF_UNVERIFIED")
            val copied=context.contentResolver.openInputStream(uri)?.use{readBounded(it,GenesisBackupContainer.MAX_FILE)}?:error("BACKUP_HANDOFF_UNVERIFIED")
            try{check(copied.size==bytes.size&&hash(copied)==job.sha256){"BACKUP_HANDOFF_UNVERIFIED"}}finally{copied.fill(0)}
            save(context,job.copy(phase="complete"));file.delete()
        }catch(error:Exception){save(context,job.copy(phase="failed"));throw error}finally{bytes.fill(0)}
    }
    @Synchronized fun imported(context:Context,id:String,account:E2eeProductAccount){account.requireOpen();val job=mutable.value?.takeIf{it.id==id&&it.ownerId==account.ownerId&&it.kind=="import"&&it.phase=="ready"}?:error("BACKUP_HANDOFF_CHANGED");save(context,job.copy(phase="complete"))}
    @Synchronized fun retry(context:Context,id:String,account:E2eeProductAccount){account.requireOpen();val job=mutable.value?.takeIf{it.id==id&&it.ownerId==account.ownerId&&it.phase in setOf("failed","picking","ready")}?:error("BACKUP_HANDOFF_CHANGED");save(context,job.copy(phase="pick",uri=null))}
    @Synchronized fun cancel(context:Context,id:String,account:E2eeProductAccount){account.requireOpen();val job=mutable.value?.takeIf{it.id==id&&it.ownerId==account.ownerId&&it.phase!="writing"}?:error("BACKUP_HANDOFF_CHANGED");save(context,job.copy(phase="cancelled"));if(job.kind=="export")artifact(context,id).delete()}
    fun readBounded(input:java.io.InputStream,maximum:Int):ByteArray{val output=java.io.ByteArrayOutputStream();val buffer=ByteArray(8192)
        try{while(true){val count=input.read(buffer);if(count<0)break;check(count>0&&output.size()+count<=maximum){"BACKUP_TOO_LARGE"};output.write(buffer,0,count)};return output.toByteArray()}finally{buffer.fill(0);output.reset()}}
    private fun hash(bytes:ByteArray)=E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(bytes))
}
