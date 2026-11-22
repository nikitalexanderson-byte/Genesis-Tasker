package ru.genesis.calendar.security

import android.content.Context
import android.net.Uri
import android.util.AtomicFile
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONObject
import java.io.File
import java.io.InputStream
import java.security.MessageDigest
import java.util.UUID
import ru.genesis.calendar.data.GenesisBackupContainer

/** Durable ciphertext/technical locator only. Every picker attempt has its own
 * identity; active provider IO additionally needs a transient foreground owner
 * capability. Neither a persisted URI nor a matching UID recreates that grant. */
internal object PrivateBackupHandoff{
    data class Job(val id:String,val ownerId:String,val kind:String,val phase:String,val sha256:String?=null,val uri:String?=null,
        val attemptId:String,val scopeId:String?,val generation:Long?)
    private val mutable=MutableStateFlow<Job?>(null);val state=mutable.asStateFlow();private var initialized=false;private var usable=true
    private fun uuid(value:String)=value.also{check(UUID.fromString(it).toString()==it){"BACKUP_INVALID"}}
    private fun manifest(context:Context)=AtomicFile(File(context.noBackupFilesDir,"private-backup-handoff-v1.json"))
    private fun artifact(context:Context,id:String):AtomicFile{
        uuid(id);val folder=context.noBackupFilesDir.canonicalFile;val file=File(folder,"private-backup-$id.genesisbackup")
        check(file.canonicalFile.parentFile==folder){"BACKUP_INVALID"};return AtomicFile(file)
    }
    private fun json(job:Job)=JSONObject().put("protocol",2).put("id",job.id).put("ownerId",job.ownerId).put("kind",job.kind).put("phase",job.phase)
        .put("sha256",job.sha256?:JSONObject.NULL).put("uri",job.uri?:JSONObject.NULL).put("attemptId",job.attemptId)
        .put("scopeId",job.scopeId?:JSONObject.NULL).put("generation",job.generation?:JSONObject.NULL)
    private fun parse(value:JSONObject):Job{
        val protocol=value.getInt("protocol");check(protocol in setOf(1,2)){"BACKUP_INVALID"}
        E2eeKeys.exact(value,setOf("protocol","id","ownerId","kind","phase","sha256","uri")+(if(protocol==2)setOf("attemptId","scopeId","generation")else emptySet()))
        val id=uuid(value.getString("id"));val owner=E2eeKeys.technical(value.getString("ownerId"))
        val kind=value.getString("kind");val phase=value.getString("phase")
        check(kind in setOf("export","import")&&phase in setOf("sealing","pick","picking","writing","ready","complete","failed","cancelled")){"BACKUP_INVALID"}
        val hash=if(value.isNull("sha256"))null else value.getString("sha256").also{E2eeEnvelope.decode(it,32).fill(0)}
        val uri=if(value.isNull("uri"))null else value.getString("uri").also{check(it.length<=8192&&Uri.parse(it).scheme=="content"){"BACKUP_INVALID"}}
        check(kind!="export"||hash!=null||phase in setOf("sealing","failed","cancelled")){"BACKUP_INVALID"}
        check(kind!="import"||hash==null&&phase !in setOf("sealing","writing")){"BACKUP_INVALID"}
        check(kind!="export"||phase!="ready"){"BACKUP_INVALID"}
        check(phase !in setOf("ready","writing")||uri!=null){"BACKUP_INVALID"}
        if(protocol==1)return Job(id,owner,kind,if(phase in setOf("complete","cancelled"))phase else "failed",hash,uri,id,null,null)
        val scope=if(value.isNull("scopeId"))null else E2eeKeys.technical(value.getString("scopeId"))
        val generation=if(value.isNull("generation"))null else E2eeCommands.integer(value.get("generation"),1)
        check((scope==null)==(generation==null)&&(scope!=null||phase in setOf("failed","complete","cancelled"))){"BACKUP_INVALID"}
        return Job(id,owner,kind,phase,hash,uri,uuid(value.getString("attemptId")),scope,generation)
    }
    private fun read(context:Context):Job?{
        val file=manifest(context);if(!file.baseFile.exists()&&!File(file.baseFile.path+".bak").exists()&&!File(file.baseFile.path+".new").exists())return null
        val bytes=file.openRead().use{readBounded(it,16384)};return try{parse(E2eeFileManifestJson.readPrivateDocument(bytes))}finally{bytes.fill(0)}
    }
    @Synchronized fun initialize(context:Context){if(!initialized){
        check(usable){"BACKUP_HANDOFF_UNVERIFIED"};val saved=read(context)
        // No provider operation resumes automatically from durable metadata.
        // A fresh unlocked retry rotates the attempt before another picker.
        if(saved?.phase in setOf("sealing","pick","picking","writing"))save(context,requireNotNull(saved).copy(phase="failed"))else mutable.value=saved
        initialized=true
    }}
    private fun save(context:Context,job:Job){
        check(usable){"BACKUP_HANDOFF_UNVERIFIED"}
        try{
            val bytes=json(job).toString().toByteArray(Charsets.UTF_8);val file=manifest(context);val output=file.startWrite()
            try{output.write(bytes);file.finishWrite(output)}catch(error:Exception){file.failWrite(output);throw error}finally{bytes.fill(0)}
            check(read(context)==job){"BACKUP_HANDOFF_UNVERIFIED"};mutable.value=job
        }catch(error:Exception){usable=false;throw error}
    }
    private fun available(context:Context){initialize(context);check(usable){"BACKUP_HANDOFF_UNVERIFIED"};check(mutable.value?.phase.let{it==null||it in setOf("complete","cancelled")}){"BACKUP_HANDOFF_BUSY"}}
    @Synchronized fun requireCurrent(job:Job){check(initialized&&usable&&mutable.value==job){"BACKUP_HANDOFF_CHANGED"}}
    @Synchronized fun isPicking(job:Job):Boolean=usable&&mutable.value==job.copy(phase="picking")
    private fun assertAccount(job:Job,account:E2eeProductAccount){account.requireOpen();check(job.ownerId==account.ownerId&&job.scopeId==account.directory.scopeId&&job.generation==account.directory.generation){"BACKUP_HANDOFF_CHANGED"}}
    private fun reserve(context:Context,account:E2eeProductAccount,id:String,kind:String,phase:String):Job=synchronized(this){
        account.requireOpen();available(context)
        Job(uuid(id),account.ownerId,kind,phase,attemptId=UUID.randomUUID().toString(),scopeId=account.directory.scopeId,generation=account.directory.generation).also{save(context,it)}
    }
    fun prepareExport(context:Context,account:E2eeProductAccount,payload:JSONObject,recovery:String,assertCurrent:()->Unit):Job{
        assertCurrent();account.requireOpen();check(payload.getString("ownerId")==account.ownerId){"E2EE_SCOPE_BINDING_MISMATCH"}
        val file=artifact(context,payload.getString("backupId"))
        check(!file.baseFile.exists()&&!File(file.baseFile.path+".bak").exists()&&!File(file.baseFile.path+".new").exists()){"BACKUP_HANDOFF_BUSY"}
        val job=reserve(context,account,payload.getString("backupId"),"export","sealing")
        fun current(){assertCurrent();assertAccount(job,account);requireCurrent(job)}
        var sealed:ByteArray?=null
        try{
            current();val bytes=GenesisBackupContainer.seal(payload,recovery).toByteArray(Charsets.UTF_8);sealed=bytes;current()
            check(android.os.StatFs(context.noBackupFilesDir.absolutePath).availableBytes>bytes.size+1024*1024L){"E2EE_STORAGE_CAPACITY"}
            val output=file.startWrite()
            try{var offset=0;while(offset<bytes.size){current();val count=minOf(8192,bytes.size-offset);output.write(bytes,offset,count);offset+=count};current();file.finishWrite(output)}
            catch(error:Exception){file.failWrite(output);throw error}
            val expected=hash(bytes);val copied=file.openRead().use{readBounded(it,GenesisBackupContainer.MAX_FILE)}
            try{current();check(copied.size==bytes.size&&hash(copied)==expected){"BACKUP_HANDOFF_UNVERIFIED"}}finally{copied.fill(0)}
            return synchronized(this){current();job.copy(phase="pick",sha256=expected).also{save(context,it)}}
        }catch(error:Exception){failed(context,job);throw error}finally{sealed?.fill(0)}
    }
    /** An already verified encrypted cloud file enters the same bounded SAF
     * custody. A fresh delivery ID avoids replacing an earlier local artifact. */
    fun prepareEncryptedExport(context:Context,account:E2eeProductAccount,text:String,assertCurrent:()->Unit):Job{
        assertCurrent();account.requireOpen();val bytes=text.toByteArray(Charsets.UTF_8)
        try{
            check(bytes.size in 1..GenesisBackupContainer.MAX_FILE){"BACKUP_TOO_LARGE"};val header=E2eeFileManifestJson.readPrivateDocument(bytes)
            E2eeKeys.exact(header,setOf("format","schema","backupId","algorithm","wrappedKey","iv","ciphertext","sha256"))
            check(header.getString("format")=="genesisbackup"&&header.get("schema")==1&&header.getString("algorithm")=="A256GCM+A256KW"){"BACKUP_INVALID"};uuid(header.getString("backupId"))
            val id=UUID.randomUUID().toString();val job=reserve(context,account,id,"export","sealing");val file=artifact(context,id)
            fun current(){assertCurrent();assertAccount(job,account);requireCurrent(job)}
            try{
                current();check(android.os.StatFs(context.noBackupFilesDir.absolutePath).availableBytes>bytes.size+1024*1024L){"E2EE_STORAGE_CAPACITY"}
                val output=file.startWrite();try{var at=0;while(at<bytes.size){current();val count=minOf(8192,bytes.size-at);output.write(bytes,at,count);at+=count};current();file.finishWrite(output)}catch(error:Exception){file.failWrite(output);throw error}
                val expected=hash(bytes);val copied=file.openRead().use{readBounded(it,GenesisBackupContainer.MAX_FILE)}
                try{current();check(copied.size==bytes.size&&hash(copied)==expected){"BACKUP_HANDOFF_UNVERIFIED"}}finally{copied.fill(0)}
                return synchronized(this){current();job.copy(phase="pick",sha256=expected).also{save(context,it)}}
            }catch(error:Exception){failed(context,job);throw error}
        }finally{bytes.fill(0)}
    }
    fun prepareImport(context:Context,account:E2eeProductAccount)=reserve(context,account,UUID.randomUUID().toString(),"import","pick")
    /** Historical content is already authenticated by the read-only catalogue.
     * Only independently encrypted bytes survive the credential/SAF transition. */
    fun prepareRetiredExport(context:Context,ownerId:String,deviceId:String,payload:JSONObject,recovery:String,guard:()->Unit):Job{
        guard();E2eeKeys.technical(ownerId);E2eeKeys.technical(deviceId);val verified=E2eeContentArchive.validate(payload);check(verified.getString("ownerId")==ownerId&&verified.isNull("billingEvidence")){"E2EE_SCOPE_BINDING_MISMATCH"}
        val job=synchronized(this){guard();available(context);Job(UUID.randomUUID().toString(),ownerId,"export","sealing",attemptId=UUID.randomUUID().toString(),scopeId="device:$deviceId",generation=1).also{save(context,it)}};val file=artifact(context,job.id)
        fun current(){guard();requireCurrent(job)}
        var bytes:ByteArray?=null;try{current();val sealed=GenesisBackupContainer.seal(verified,recovery).toByteArray(Charsets.UTF_8);bytes=sealed;current();check(android.os.StatFs(context.noBackupFilesDir.absolutePath).availableBytes>sealed.size+1024*1024L){"E2EE_STORAGE_CAPACITY"};val output=file.startWrite();try{var at=0;while(at<sealed.size){current();val size=minOf(8192,sealed.size-at);output.write(sealed,at,size);at+=size};current();file.finishWrite(output)}catch(error:Exception){file.failWrite(output);throw error}
            val digest=hash(sealed);val readback=file.openRead().use{readBounded(it,GenesisBackupContainer.MAX_FILE)};try{current();check(readback.size==sealed.size&&hash(readback)==digest){"BACKUP_HANDOFF_UNVERIFIED"}}finally{readback.fill(0)};return synchronized(this){current();job.copy(phase="pick",sha256=digest).also{save(context,it)}}
        }catch(error:Exception){failed(context,job);throw error}finally{bytes?.fill(0)}
    }
    @Synchronized fun beginPicker(context:Context,job:Job):Job{
        initialize(context);requireCurrent(job);check(job.phase=="pick"){"BACKUP_HANDOFF_CHANGED"};return job.copy(phase="picking").also{save(context,it)}
    }
    @Synchronized fun selected(context:Context,job:Job,uri:Uri?):Job{
        check(isPicking(job)){"BACKUP_HANDOFF_CHANGED"};val picking=job.copy(phase="picking")
        if(uri==null)return picking.copy(phase="cancelled",uri=null).also{save(context,it);if(job.kind=="export")artifact(context,job.id).delete()}
        check(uri.scheme=="content"&&uri.toString().length<=8192){"BACKUP_INVALID"}
        return picking.copy(phase=if(job.kind=="import")"ready"else"writing",uri=uri.toString()).also{save(context,it)}
    }
    /** Exact same-attempt failure is deny-only metadata. It neither deletes the
     * artifact nor changes a later attempt/account's current operation. */
    @Synchronized fun failed(context:Context,job:Job){val current=mutable.value
        if(usable&&current?.id==job.id&&current.attemptId==job.attemptId&&current.phase !in setOf("complete","cancelled","failed"))save(context,current.copy(phase="failed"))
    }
    /** Stream the encrypted artifact and authenticate full readback. A retry
     * accepts only an exact existing prefix, never an unrelated destination. */
    fun deliver(context:Context,job:Job,access:NativeBackupFileAccess){
        check(job.kind=="export"&&job.phase=="writing"&&access.job==job){"BACKUP_HANDOFF_CHANGED"};access.current()
        val file=artifact(context,job.id)
        try{
            fun scan(input:InputStream):Pair<Int,String>{val digest=MessageDigest.getInstance("SHA-256");var size=0
                access.buffer(8192){buffer->while(true){access.current();val count=input.read(buffer);access.current();if(count<0)break
                    check(count>0&&size<=GenesisBackupContainer.MAX_FILE-count){"BACKUP_TOO_LARGE"};size+=count;digest.update(buffer,0,count);buffer.fill(0,0,count)}}
                return Pair(size,E2eeEnvelope.encode(digest.digest()))
            }
            val expected=access.local(file.openRead()){scan(it)};check(expected.first>0&&expected.second==job.sha256){"BACKUP_HANDOFF_UNVERIFIED"}
            val prefix=access.local(file.openRead()){source->access.input(context){prior->access.buffer(8192){buffer->access.buffer(8192){original->
                var size=0
                while(true){access.current();val count=prior.read(buffer);access.current();if(count<0)break
                    check(count>0&&size<=expected.first-count){"BACKUP_DESTINATION_CHANGED"};var offset=0
                    while(offset<count){access.current();val read=source.read(original,offset,count-offset);access.current();check(read>0){"BACKUP_HANDOFF_UNVERIFIED"};offset+=read}
                    check((0 until count).all{buffer[it]==original[it]}){"BACKUP_DESTINATION_CHANGED"};size+=count;buffer.fill(0,0,count);original.fill(0,0,count)
                };size
            }}}}
            if(prefix<expected.first)access.local(file.openRead()){source->access.output(context){output->access.buffer(8192){buffer->
                var size=0
                while(true){access.current();val count=source.read(buffer);access.current();if(count<0)break
                    check(count>0&&size<=expected.first-count){"BACKUP_HANDOFF_UNVERIFIED"};output.write(buffer,0,count);access.current();size+=count;buffer.fill(0,0,count)}
                check(size==expected.first){"BACKUP_HANDOFF_UNVERIFIED"};output.flush();access.current()
            }}}
            val copied=access.input(context){scan(it)};check(copied==expected){"BACKUP_HANDOFF_UNVERIFIED"}
            synchronized(this){access.current();save(context,job.copy(phase="complete"))};file.delete()
        }catch(error:Exception){failed(context,job);throw error}
    }
    @Synchronized fun requireImport(job:Job,account:E2eeProductAccount){assertAccount(job,account);requireCurrent(job);check(job.kind=="import"&&job.phase=="ready"){"BACKUP_HANDOFF_CHANGED"}}
    @Synchronized fun imported(context:Context,job:Job,account:E2eeProductAccount){requireImport(job,account);save(context,job.copy(phase="complete"))}
    @Synchronized fun retry(context:Context,job:Job,account:E2eeProductAccount){
        requireCurrent(job);check(job.phase in setOf("failed","picking","ready")){"BACKUP_HANDOFF_CHANGED"};assertAccount(job,account)
        check(job.kind!="export"||job.sha256!=null){"BACKUP_HANDOFF_UNVERIFIED"}
        save(context,job.copy(phase="pick",uri=null,attemptId=UUID.randomUUID().toString()))
    }
    @Synchronized fun cancel(context:Context,job:Job,account:E2eeProductAccount){
        account.requireOpen();requireCurrent(job);check(job.ownerId==account.ownerId&&job.phase !in setOf("sealing","writing","complete","cancelled")){"BACKUP_HANDOFF_CHANGED"}
        // Cancellation grants no content authority, including for a failed old
        // generation. It only retires this exact technical job and ciphertext.
        save(context,job.copy(phase="cancelled",uri=null));if(job.kind=="export")artifact(context,job.id).delete()
    }
    private fun readBounded(input:InputStream,maximum:Int):ByteArray{
        val bytes=ByteArray(maximum+1);var size=0
        try{while(size<bytes.size){val count=input.read(bytes,size,minOf(8192,bytes.size-size));if(count<0)break;check(count>0){"BACKUP_INVALID"};size+=count}
            check(size<=maximum){"BACKUP_TOO_LARGE"};return bytes.copyOf(size)}finally{bytes.fill(0)}
    }
    private fun hash(bytes:ByteArray)=E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(bytes))
}
