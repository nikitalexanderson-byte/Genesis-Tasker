package ru.genesis.calendar.data

import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.security.*
import java.security.MessageDigest
import java.time.Instant
import java.util.UUID

internal object MessagingDraftValues{
    fun encode(value:MessagingDraft)=JSONObject().put("version",1).put("id",value.id).put("text",value.text).put("files",JSONArray(value.files.map{it.json()})).put("revision",value.revision).put("seq",value.seq)
    fun read(value:JSONObject):MessagingDraft{
        E2eeKeys.exact(value,setOf("version","id","text","files","revision","seq"));check(value.get("version")==1&&value.get("text") is String&&value.getString("text").toByteArray(Charsets.UTF_8).size<=30000){"MESSAGING_INVALID_DRAFT"}
        val id=value.getString("id");check(UUID.fromString(id).toString()==id){"MESSAGING_INVALID_DRAFT"};val files=value.getJSONArray("files");check(files.length()<=5){"TOO_MANY_PRIVATE_FILES"}
        val items=(0 until files.length()).map{val file=files.getJSONObject(it);E2eeKeys.exact(file,setOf("id","name","type","size","iv","chunks"));MessagingCrypto.file(file)};check(items.map{it.id}.toSet().size==items.size){"MESSAGING_INVALID_DRAFT"}
        return MessagingDraft(id,value.getString("text"),items,E2eeCommands.integer(value.get("revision")),E2eeCommands.integer(value.get("seq")))
    }
    fun same(left:MessagingDraft,right:MessagingDraft)=E2eeProductJson.same(encode(left),encode(right))
}

internal class MessagingFileIntakeInfo(val id:String,val conversationId:String,val draftId:String,val names:List<String>,val sourceCount:Int?,val applied:Int,val retained:Boolean,val complete:Boolean,val savedDraftIds:List<String>){override fun toString()="MessagingFileIntakeInfo([redacted])"}

/** Protected source material precedes every chunk write. No provider URI, vault
 * key or executable HTTP request is stored. Incomplete sources are explicit;
 * reselecting the same bytes resumes the exact nonce/ciphertext, never a new job.
 * The repository holds its account/conversation mutex around these methods. */
internal class MessagingFileIntake(private val owner:String,private val store:MessagingStore,private val current:()->Unit){
    private val key="file-intakes-v1"
    private fun hash(bytes:ByteArray)=MessagingCrypto.base64(MessageDigest.getInstance("SHA-256").digest(bytes))
    private fun chunkHash(value:String):String{val bytes=value.toByteArray(Charsets.UTF_8);return try{hash(bytes)}finally{bytes.fill(0)}}
    private fun uuid(value:String)=value.also{check(UUID.fromString(it).toString()==it){"MESSAGING_FILE_INTAKE_INVALID"}}
    private fun pick(value:JSONObject):JSONObject{
        E2eeKeys.exact(value,setOf("id","ownerId","conversationId","spaceId","peerId","keyIds","draft","sourceCount","entries","retained","complete","createdAt","savedDrafts"))
        uuid(value.getString("id"));uuid(value.getString("conversationId"));uuid(value.getString("spaceId"));E2eeKeys.technical(value.getString("peerId"))
        check(value.get("ownerId")==owner&&value.get("retained") is Boolean&&value.get("complete") is Boolean){"MESSAGING_FILE_INTAKE_INVALID"};Instant.parse(value.getString("createdAt"))
        val draft=MessagingDraftValues.read(value.getJSONObject("draft"));val keys=value.getJSONObject("keyIds");E2eeKeys.exact(keys,setOf(owner,value.getString("peerId")))
        val savedDrafts=value.getJSONArray("savedDrafts");check(savedDrafts.length()<=16){"MESSAGING_FILE_INTAKE_LIMIT"};val draftIds=mutableSetOf<String>()
        for(at in 0 until savedDrafts.length()){val saved=savedDrafts.getJSONObject(at);E2eeKeys.exact(saved,setOf("id","draft"));check(draftIds.add(uuid(saved.getString("id")))){"MESSAGING_FILE_INTAKE_INVALID"};MessagingDraftValues.read(saved.getJSONObject("draft"))}
        for(id in keys.keys())check(keys.get(id) is String&&Regex("[a-f0-9]{64}").matches(keys.getString(id))){"MESSAGING_FILE_INTAKE_INVALID"}
        val count=if(value.isNull("sourceCount"))null else E2eeCommands.integer(value.get("sourceCount"),1).also{check(it<=5){"MESSAGING_FILE_INTAKE_INVALID"}}.toInt();val entries=value.getJSONArray("entries")
        check(count==null&&entries.length()==0||count!=null&&count<=5-draft.files.size&&entries.length()<=count){"MESSAGING_FILE_INTAKE_INVALID"}
        var interrupted=false;val files=mutableSetOf<String>();draft.files.forEach{files+=it.id}
        for(at in 0 until entries.length()){
            val entry=entries.getJSONObject(at);E2eeKeys.exact(entry,setOf("file","sourceHash","chunkHashes","applied"));val file=MessagingCrypto.file(entry.getJSONObject("file"))
            check(files.add(file.id)&&entry.get("applied") is Boolean&&!interrupted){"MESSAGING_FILE_INTAKE_INVALID"};E2eeEnvelope.decode(entry.getString("sourceHash"),32)
            val hashes=entry.getJSONArray("chunkHashes");check(hashes.length()==file.chunks){"MESSAGING_FILE_INTAKE_INVALID"};for(part in 0 until hashes.length())E2eeEnvelope.decode(hashes.getString(part),32)
            if(!entry.getBoolean("applied"))interrupted=true
        }
        check(!value.getBoolean("complete")||count!=null&&entries.length()==count&&!interrupted){"MESSAGING_FILE_INTAKE_INVALID"};return value
    }
    private suspend fun load():MutableList<JSONObject>{
        current();val raw=store.read(key);current();if(raw==null)return mutableListOf()
        val value=JSONObject(raw);E2eeKeys.exact(value,setOf("protocol","ownerId","intakes"));check(value.get("protocol")==1&&value.get("ownerId")==owner){"MESSAGING_FILE_INTAKE_INVALID"}
        val rows=value.getJSONArray("intakes");check(rows.length()<=64){"MESSAGING_FILE_INTAKE_LIMIT"};val result=(0 until rows.length()).map{pick(rows.getJSONObject(it))}.toMutableList()
        check(result.map{it.getString("id")}.toSet().size==result.size){"MESSAGING_FILE_INTAKE_INVALID"};return result
    }
    private suspend fun save(rows:List<JSONObject>){
        current();check(rows.size<=64){"MESSAGING_FILE_INTAKE_LIMIT"};rows.forEach(::pick);val value=JSONObject().put("protocol",1).put("ownerId",owner).put("intakes",JSONArray(rows));val encoded=value.toString()
        check(encoded.toByteArray(Charsets.UTF_8).size<=300*1024){"MESSAGING_FILE_INTAKE_LIMIT"};store.write(key,encoded);current()
        check(store.read(key)?.let{E2eeProductJson.same(JSONObject(it),value)}==true){"MESSAGING_FILE_INTAKE_UNVERIFIED"};current()
    }
    private fun found(rows:List<JSONObject>,id:String)=rows.singleOrNull{it.getString("id")==uuid(id)}?:error("MESSAGING_FILE_INTAKE_REQUIRED")
    suspend fun target(id:String):JSONObject{val value=found(load(),id);current();return JSONObject(value.toString())}
    suspend fun create(conversation:MessagingNotice,draft:MessagingDraft,keyIds:Map<String,String>):String{
        current();check(draft.files.size<5){"TOO_MANY_PRIVATE_FILES"};val rows=load();val id=UUID.randomUUID().toString()
        check(rows.none{it.getString("conversationId")==conversation.id&&MessagingDraftValues.read(it.getJSONObject("draft")).id==draft.id&&!it.getBoolean("complete")&&!it.getBoolean("retained")}){"MESSAGING_FILE_INTAKE_PENDING"}
        rows+=JSONObject().put("id",id).put("ownerId",owner).put("conversationId",conversation.id).put("spaceId",conversation.spaceId).put("peerId",conversation.peerId).put("keyIds",JSONObject(keyIds))
            .put("draft",MessagingDraftValues.encode(draft)).put("sourceCount",JSONObject.NULL).put("entries",JSONArray()).put("retained",false).put("complete",false).put("createdAt",Instant.now().toString()).put("savedDrafts",JSONArray())
        save(rows);return id
    }
    private fun projection(value:JSONObject,count:Int):MessagingDraft{val original=MessagingDraftValues.read(value.getJSONObject("draft"));val entries=value.getJSONArray("entries")
        check(count in 0..entries.length()){ "MESSAGING_FILE_INTAKE_INVALID" };return original.copy(files=original.files+(0 until count).map{MessagingCrypto.file(entries.getJSONObject(it).getJSONObject("file"))})}
    fun assertBinding(value:JSONObject,conversation:MessagingNotice,keyIds:Map<String,String>){
        current();check(value.getString("conversationId")==conversation.id&&value.getString("spaceId")==conversation.spaceId&&value.getString("peerId")==conversation.peerId
            &&E2eeProductJson.same(value.getJSONObject("keyIds"),JSONObject(keyIds))){"MESSAGING_FILE_SOURCE_CHANGED"}
    }
    suspend fun begin(id:String,count:Int,draft:MessagingDraft){
        val rows=load();val value=found(rows,id);val entries=value.getJSONArray("entries");val applied=(0 until entries.length()).count{entries.getJSONObject(it).getBoolean("applied")}
        check(MessagingDraftValues.same(draft,projection(value,applied))||entries.length()>applied&&MessagingDraftValues.same(draft,projection(value,applied+1))){"MESSAGING_FILE_DRAFT_CHANGED"}
        check(!value.getBoolean("retained")&&count in 1..5-MessagingDraftValues.read(value.getJSONObject("draft")).files.size
            &&(value.isNull("sourceCount")||value.getInt("sourceCount")==count)){"MESSAGING_FILE_SOURCE_CHANGED"}
        if(value.isNull("sourceCount")){value.put("sourceCount",count);save(rows)}
    }
    suspend fun stage(id:String,index:Int,name:String,type:String,data:ByteArray,keyBytes:ByteArray,draft:MessagingDraft,writeDraft:suspend(MessagingDraft)->Unit){
        current();val rows=load();val value=found(rows,id);val entries=value.getJSONArray("entries");val sourceHash=hash(data)
        check(!value.getBoolean("retained")&&!value.isNull("sourceCount")&&index in 0 until value.getInt("sourceCount")&&index<=entries.length()){"MESSAGING_FILE_SOURCE_CHANGED"}
        val original=MessagingDraftValues.read(value.getJSONObject("draft"));val context=MessageContext(value.getString("spaceId"),value.getString("conversationId"),original.id,owner,original.revision+1)
        val entry:JSONObject;val file:PrivateFileMetadata;val chunks:List<String>
        if(index==entries.length()){
            check(MessagingDraftValues.same(draft,projection(value,index))){"MESSAGING_FILE_DRAFT_CHANGED"}
            val encrypted=MessagingCrypto.encryptFile(keyBytes,context,UUID.randomUUID().toString(),name,type,data);current();file=encrypted.first;chunks=encrypted.second
            entry=JSONObject().put("file",file.json()).put("sourceHash",sourceHash).put("chunkHashes",JSONArray(chunks.map(::chunkHash))).put("applied",false);entries.put(entry);save(rows)
        }else{
            entry=entries.getJSONObject(index);file=MessagingCrypto.file(entry.getJSONObject("file"));check(file.name==name.take(255)&&file.type==type&&entry.getString("sourceHash")==sourceHash){"MESSAGING_FILE_SOURCE_CHANGED"}
            chunks=MessagingCrypto.replayFile(keyBytes,context,file,entry.getString("sourceHash"),data);current()
        }
        val hashes=entry.getJSONArray("chunkHashes");check(chunks.size==file.chunks){"MESSAGING_FILE_INTAKE_UNVERIFIED"}
        for(part in chunks.indices){current();val chunk=chunks[part];check(chunkHash(chunk)==hashes.getString(part)){"MESSAGING_FILE_INTAKE_UNVERIFIED"};val cell="file/${file.id}/$part"
            val previous=store.read(cell);current();check(previous==null||previous==chunk){"MESSAGING_FILE_INTAKE_UNVERIFIED"};if(previous==null)store.write(cell,chunk);current()
            check(store.read(cell)==chunk){"MESSAGING_FILE_INTAKE_UNVERIFIED"};current()
        }
        if(entry.getBoolean("applied")){val applied=(0 until entries.length()).count{entries.getJSONObject(it).getBoolean("applied")}
            check(MessagingDraftValues.same(draft,projection(value,applied))||entries.length()>applied&&MessagingDraftValues.same(draft,projection(value,applied+1))){"MESSAGING_FILE_DRAFT_CHANGED"};return}
        val before=projection(value,index);val after=projection(value,index+1);check(MessagingDraftValues.same(draft,before)||MessagingDraftValues.same(draft,after)){"MESSAGING_FILE_DRAFT_CHANGED"}
        if(!MessagingDraftValues.same(draft,after))writeDraft(after);current();entry.put("applied",true)
        if(entries.length()==value.getInt("sourceCount"))value.put("complete",true);save(rows)
    }
    suspend fun retain(id:String){val rows=load();val value=found(rows,id);check(!value.getBoolean("complete")){"MESSAGING_FILE_INTAKE_INVALID"};value.put("retained",true);save(rows)}
    suspend fun resume(id:String,draft:MessagingDraft){val rows=load();val value=found(rows,id);val entries=value.getJSONArray("entries");val applied=(0 until entries.length()).count{entries.getJSONObject(it).getBoolean("applied")}
        check(!value.getBoolean("complete")&&(MessagingDraftValues.same(draft,projection(value,applied))||entries.length()>applied&&MessagingDraftValues.same(draft,projection(value,applied+1)))){"MESSAGING_FILE_DRAFT_CHANGED"};if(value.getBoolean("retained")){value.put("retained",false);save(rows)}}
    suspend fun restoreDraft(id:String,currentDraft:MessagingDraft,savedId:String?,writeDraft:suspend(MessagingDraft)->Unit){
        val rows=load();val value=found(rows,id);check(!value.getBoolean("complete")||savedId!=null){"MESSAGING_FILE_INTAKE_INVALID"};val saved=value.getJSONArray("savedDrafts")
        val next=if(savedId==null){val entries=value.getJSONArray("entries");projection(value,(0 until entries.length()).count{entries.getJSONObject(it).getBoolean("applied")})}
            else MessagingDraftValues.read((0 until saved.length()).map{saved.getJSONObject(it)}.singleOrNull{it.getString("id")==uuid(savedId)}?.getJSONObject("draft")?:error("MESSAGING_FILE_DRAFT_CHANGED"))
        if(!MessagingDraftValues.same(currentDraft,next)){
            if((0 until saved.length()).none{MessagingDraftValues.same(currentDraft,MessagingDraftValues.read(saved.getJSONObject(it).getJSONObject("draft")))}){
                check(saved.length()<16){"MESSAGING_FILE_INTAKE_LIMIT"};saved.put(JSONObject().put("id",UUID.randomUUID().toString()).put("draft",MessagingDraftValues.encode(currentDraft)));save(rows)
            }
            writeDraft(next);current()
        }
        value.put("retained",savedId!=null);save(rows)
    }
    suspend fun retainsFile(id:String)=load().any{value->val entries=value.getJSONArray("entries");val saved=value.getJSONArray("savedDrafts")
        MessagingDraftValues.read(value.getJSONObject("draft")).files.any{it.id==id}||(0 until entries.length()).any{entries.getJSONObject(it).getJSONObject("file").getString("id")==id}
            ||(0 until saved.length()).any{MessagingDraftValues.read(saved.getJSONObject(it).getJSONObject("draft")).files.any{it.id==id}}}
    suspend fun pending(conversation:String):List<MessagingFileIntakeInfo>{return load().filter{it.getString("conversationId")==conversation&&(!it.getBoolean("complete")||it.getJSONArray("savedDrafts").length()>0)}.map{value->val entries=value.getJSONArray("entries")
        MessagingFileIntakeInfo(value.getString("id"),conversation,MessagingDraftValues.read(value.getJSONObject("draft")).id,(0 until entries.length()).map{entries.getJSONObject(it).getJSONObject("file").getString("name")},if(value.isNull("sourceCount"))null else value.getInt("sourceCount"),(0 until entries.length()).count{entries.getJSONObject(it).getBoolean("applied")},value.getBoolean("retained")||value.getBoolean("complete"),value.getBoolean("complete"),(0 until value.getJSONArray("savedDrafts").length()).map{value.getJSONArray("savedDrafts").getJSONObject(it).getString("id")} )}}
    override fun toString()="MessagingFileIntake([redacted])"
}
