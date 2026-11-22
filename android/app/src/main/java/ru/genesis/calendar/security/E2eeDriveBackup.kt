package ru.genesis.calendar.security

import org.json.JSONObject
import java.security.MessageDigest
import java.util.UUID
import ru.genesis.calendar.auth.ForegroundAccountCall
import ru.genesis.calendar.auth.PrivateDriveGateway
import ru.genesis.calendar.data.GenesisBackupContainer

/** Blocking foreground product; the UI invokes it on IO. Persisted jobs contain
 * only the independently encrypted file and technical identifiers, wrapped by
 * the current device root. No recovery key or executable restore authority. */
internal class E2eeDriveBackup(private val account:E2eeProductAccount,private val gateway:PrivateDriveGateway,
    private val call:ForegroundAccountCall,private val assertCurrent:()->Unit){
    class Status(val enabled:Boolean,val connectionId:String?){override fun toString()="E2eeDriveBackup.Status([redacted])"}
    class File(val fileId:String,val backupId:String,val sha256:String,val bytes:Int,val createdAt:String){override fun toString()="E2eeDriveBackup.File([redacted])"}
    class Page(val files:List<File>,val next:String?){override fun toString()="E2eeDriveBackup.Page([redacted])"}
    companion object{
        const val CONSENT="encrypted-drive-backup-336-v1"
        private const val PREFIX="drive-backup-upload:"
        private fun uuid(value:String)=value.also{check(UUID.fromString(it).toString()==it){"DRIVE_INVALID_RESPONSE"}}
        private fun hash(value:String)=value.also{check(it.matches(Regex("[a-f0-9]{64}"))){"DRIVE_INVALID_RESPONSE"}}
        private fun fileId(value:String)=value.also{check(it.matches(Regex("[A-Za-z0-9_-]{10,200}"))){"DRIVE_INVALID_RESPONSE"}}
        private fun size(value:Any):Int=E2eeCommands.integer(value,1).also{check(it<=GenesisBackupContainer.MAX_FILE){"DRIVE_INVALID_RESPONSE"}}.toInt()
        private fun digest(bytes:ByteArray)=MessageDigest.getInstance("SHA-256").digest(bytes).joinToString(""){"%02x".format(it)}
        private fun receipt(value:JSONObject):JSONObject{
            E2eeKeys.exact(value,setOf("operationId","fileId","sha256","bytes","verified"));uuid(value.getString("operationId"));fileId(value.getString("fileId"));hash(value.getString("sha256"));size(value.get("bytes"));check(value.get("verified")==true){"DRIVE_INVALID_RESPONSE"};return value
        }
        private fun validate(value:JSONObject):JSONObject{
            E2eeKeys.exact(value,setOf("protocol","operationId","connectionId","backupId","sha256","bytes","file","receipt"));check(value.get("protocol")==1){"DRIVE_INVALID_RESPONSE"}
            listOf("operationId","connectionId","backupId").forEach{uuid(value.getString(it))};hash(value.getString("sha256"));val count=size(value.get("bytes"))
            val bytes=value.getString("file").toByteArray(Charsets.UTF_8);try{check(bytes.size==count&&digest(bytes)==value.getString("sha256")){"DRIVE_INVALID_RESPONSE"}}finally{bytes.fill(0)}
            if(!value.isNull("receipt")){val result=receipt(value.getJSONObject("receipt"));check(result.getString("operationId")==value.getString("operationId")&&result.getString("sha256")==value.getString("sha256")&&result.getInt("bytes")==count){"DRIVE_INVALID_RESPONSE"}}
            return value
        }
    }
    private fun current(){assertCurrent();account.requireOpen();gateway.current()}
    private fun request(path:String,body:JSONObject?=null):JSONObject{current();return gateway.request(path,body,call).also{current()}}
    private fun document(id:String)=E2eeDeviceDocument(account.device,PREFIX+uuid(id),::validate,::current)
    private fun read(id:String):E2eeDeviceDocument.Opened{current();return requireNotNull(document(id).load()){"DRIVE_INTENT_MISSING"}.also{current();check(it.value.getString("operationId")==id){"DRIVE_INVALID_RESPONSE"}}}
    fun status():Status{
        val value=request("status");E2eeKeys.exact(value,setOf("enabled","connectionId","consentVersion"));check(value.get("enabled") is Boolean&&value.getString("consentVersion")==CONSENT){"DRIVE_INVALID_RESPONSE"}
        return Status(value.getBoolean("enabled"),if(value.isNull("connectionId"))null else uuid(value.getString("connectionId")))
    }
    private fun connected(id:String){val state=status();check(state.enabled&&state.connectionId==id){"DRIVE_CONNECTION_CHANGED"}}
    fun disconnect(){status().connectionId?.let{id->request("disconnect",JSONObject().put("connectionId",id))}}
    fun stage(file:String):String{
        current();val bytes=file.toByteArray(Charsets.UTF_8)
        try{check(bytes.size in 1..GenesisBackupContainer.MAX_FILE){"BACKUP_TOO_LARGE"};val header=E2eeFileManifestJson.readPrivateDocument(bytes)
            E2eeKeys.exact(header,setOf("format","schema","backupId","algorithm","wrappedKey","iv","ciphertext","sha256"))
            check(header.getString("format")=="genesisbackup"&&header.get("schema")==1&&header.getString("algorithm")=="A256GCM+A256KW"){"DRIVE_INVALID_RESPONSE"}
            val state=status();check(state.enabled&&state.connectionId!=null){"DRIVE_CONNECTION_REQUIRED"};val id=UUID.randomUUID().toString()
            val value=JSONObject().put("protocol",1).put("operationId",id).put("connectionId",state.connectionId).put("backupId",uuid(header.getString("backupId")))
                .put("sha256",digest(bytes)).put("bytes",bytes.size).put("file",file).put("receipt",JSONObject.NULL)
            current();document(id).save(value,null);current();check(read(id).value.getString("file")==file){"E2EE_BACKUP_UNVERIFIED"};return id
        }finally{bytes.fill(0)}
    }
    fun retry(id:String){
        val row=read(id).value;val connection=row.getString("connectionId");connected(connection)
        val input=JSONObject();listOf("connectionId","operationId","backupId","sha256","bytes").forEach{input.put(it,row.get(it))}
        val prepared=request("prepare",input);E2eeKeys.exact(prepared,setOf("fileId","operationId"));val external=fileId(prepared.getString("fileId"));check(prepared.getString("operationId")==id){"DRIVE_INVALID_RESPONSE"}
        val result=receipt(request("commit",JSONObject(input.toString()).put("file",row.getString("file"))))
        check(result.getString("operationId")==id&&result.getString("fileId")==external&&result.getString("sha256")==row.getString("sha256")&&result.getInt("bytes")==row.getInt("bytes")){"DRIVE_INVALID_RESPONSE"}
        val file=File(external,row.getString("backupId"),row.getString("sha256"),row.getInt("bytes"),"");download(file,connection);connected(connection)
        val latest=read(id);if(!latest.value.isNull("receipt")){
            val old=latest.value.getJSONObject("receipt");listOf("operationId","fileId","sha256","bytes","verified").forEach{check(old.get(it)==result.get(it)){"DRIVE_INVALID_RESPONSE"}};return
        }
        document(id).save(JSONObject(row.toString()).put("receipt",result),latest.serial);current();val saved=read(id).value.getJSONObject("receipt")
        listOf("operationId","fileId","sha256","bytes","verified").forEach{check(saved.get(it)==result.get(it)){"E2EE_BACKUP_UNVERIFIED"}}
    }
    fun pending():List<String>{current();val ids=account.device.vault.listLocal("draft",PREFIX);current();return ids.map{it.removePrefix(PREFIX)}.filter{read(it).value.isNull("receipt")}.also{current()}}
    fun stagedFile(id:String):String=read(id).value.getString("file").also{current()}
    fun list(token:String?=null):Page{
        check(token==null||token.length in 1..2048){"DRIVE_INVALID_RESPONSE"};val state=status();val connection=requireNotNull(state.connectionId){"DRIVE_CONNECTION_REQUIRED"};check(state.enabled){"DRIVE_CONNECTION_REQUIRED"}
        val value=request("list",JSONObject().put("connectionId",connection).put("pageToken",token?:JSONObject.NULL));E2eeKeys.exact(value,setOf("files","nextPageToken"));val rows=value.getJSONArray("files");check(rows.length()<=100){"DRIVE_INVALID_RESPONSE"}
        val seen=hashSetOf<String>();val files=(0 until rows.length()).map{index->val row=rows.getJSONObject(index);E2eeKeys.exact(row,setOf("fileId","backupId","sha256","bytes","createdAt"));val id=fileId(row.getString("fileId"));check(seen.add(id)){"DRIVE_INVALID_RESPONSE"}
            val at=row.getString("createdAt");java.time.Instant.parse(at);File(id,uuid(row.getString("backupId")),hash(row.getString("sha256")),size(row.get("bytes")),at)}
        val next=if(value.isNull("nextPageToken"))null else value.getString("nextPageToken").also{check(it.length in 1..2048){"DRIVE_INVALID_RESPONSE"}};return Page(files,next)
    }
    fun download(file:File,expectedConnection:String?=null):String{
        current();fileId(file.fileId);uuid(file.backupId);hash(file.sha256);size(file.bytes);val state=status();val connection=requireNotNull(state.connectionId){"DRIVE_CONNECTION_REQUIRED"}
        check(state.enabled&&(expectedConnection==null||connection==expectedConnection)){"DRIVE_CONNECTION_CHANGED"}
        val value=request("download",JSONObject().put("connectionId",connection).put("fileId",file.fileId));E2eeKeys.exact(value,setOf("fileId","sha256","bytes","file"))
        check(value.getString("fileId")==file.fileId&&value.getString("sha256")==file.sha256&&size(value.get("bytes"))==file.bytes){"DRIVE_INVALID_RESPONSE"};val text=value.getString("file");val bytes=text.toByteArray(Charsets.UTF_8)
        try{check(bytes.size==file.bytes&&digest(bytes)==file.sha256){"DRIVE_READBACK_FAILED"};val header=E2eeFileManifestJson.readPrivateDocument(bytes)
            E2eeKeys.exact(header,setOf("format","schema","backupId","algorithm","wrappedKey","iv","ciphertext","sha256"));check(header.getString("format")=="genesisbackup"&&header.get("schema")==1&&header.getString("algorithm")=="A256GCM+A256KW"&&header.getString("backupId")==file.backupId){"DRIVE_INVALID_RESPONSE"}
            current();return text
        }finally{bytes.fill(0)}
    }
    override fun toString()="E2eeDriveBackup([redacted])"
}
