package ru.genesis.calendar.data

import org.json.JSONObject
import ru.genesis.calendar.security.*
import java.security.MessageDigest
import java.util.UUID

internal class MessengerSavedDraft(val token:String,val text:String,val edit:MessengerRow?){override fun toString()="MessengerSavedDraft([redacted])"}
internal class MessengerSavedCommand(val raw:String,val value:JSONObject,val method:String,val path:String,val body:JSONObject,val messageId:String,val revision:Long,val seq:Long,val draft:MessengerSavedDraft?,val done:Boolean,val recovery:MessengerSavedDraft?){override fun toString()="MessengerSavedCommand([redacted])"}

/** Every draft/command is bound to its original owner, conversation and kind.
 * Historical originals are inert encrypted cells, never executable imports.
 * A done/recovery marker precedes cleanup, so process death cannot send a
 * replacement operation or turn an old edit into a fresh message. */
internal class MessengerJournal(private val owner:String,private val store:MessagingStore,private val current:()->Unit){
    private fun key(kind:String,chat:MessengerChat)="messenger/$kind/${chat.id}"
    private fun uuid(value:String)=value.also{check(UUID.fromString(it).toString()==it){"MESSENGER_JOURNAL_INVALID"}}
    private fun number(value:Any,minimum:Long=0):Long=E2eeCommands.integer(value,minimum)
    private fun text(value:Any):String{check(value is String&&value.toByteArray(Charsets.UTF_8).size<=30000){"INVALID_MESSAGE"};return value}
    private fun edit(value:JSONObject):MessengerRow{
        E2eeKeys.exact(value,setOf("id","seq","senderId","revision","text"));val revision=number(value.get("revision"),1);check(revision<Int.MAX_VALUE){"MESSENGER_JOURNAL_INVALID"}
        check(value.getString("senderId")==owner){"MESSENGER_JOURNAL_INVALID"};return MessengerRow(uuid(value.getString("id")),number(value.get("seq"),1),owner,revision.toInt(),text(value.get("text")),false,false)
    }
    fun draftValue(chat:MessengerChat,draft:MessengerSavedDraft)=JSONObject().put("format","genesis-messenger-draft-v2").put("ownerId",owner).put("conversationId",chat.id).put("kind",chat.kind)
        .put("token",uuid(draft.token)).put("text",text(draft.text)).put("edit",draft.edit?.let{JSONObject().put("id",it.id).put("seq",it.seq).put("senderId",it.senderId).put("revision",it.revision).put("text",it.text)}?:JSONObject.NULL)
    fun decodeDraft(chat:MessengerChat,value:JSONObject):MessengerSavedDraft{
        E2eeKeys.exact(value,setOf("format","ownerId","conversationId","kind","token","text","edit"))
        check(value.get("format")=="genesis-messenger-draft-v2"&&value.get("ownerId")==owner&&value.get("conversationId")==chat.id&&value.get("kind")==chat.kind){"MESSENGER_JOURNAL_INVALID"}
        return MessengerSavedDraft(uuid(value.getString("token")),text(value.get("text")),if(value.isNull("edit"))null else edit(value.getJSONObject("edit")))
    }
    fun fresh(text:String="",edit:MessengerRow?=null)=MessengerSavedDraft(UUID.randomUUID().toString(),text,edit)
    fun sameDraft(chat:MessengerChat,left:MessengerSavedDraft,right:MessengerSavedDraft)=E2eeProductJson.same(draftValue(chat,left),draftValue(chat,right))
    private suspend fun archive(chat:MessengerChat,kind:String,raw:String){
        current();check(kind in setOf("draft","command")){"MESSENGER_JOURNAL_INVALID"};val bytes=raw.toByteArray(Charsets.UTF_8)
        val hash=try{E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(bytes))}finally{bytes.fill(0)};val id="messenger/$kind-history/${chat.id}/$hash"
        val previous=store.read(id);current();check(previous==null||previous==raw){"MESSENGER_JOURNAL_CONFLICT"};if(previous==null)store.write(id,raw);current();check(store.read(id)==raw){"MESSENGER_JOURNAL_UNVERIFIED"};current()
    }
    private suspend fun writeVerified(id:String,value:String){current();store.write(id,value);current();check(store.read(id)==value){"MESSENGER_JOURNAL_UNVERIFIED"};current()}
    suspend fun draft(chat:MessengerChat):MessengerSavedDraft{
        current();val raw=store.read(key("draft",chat));current();if(raw==null){val created=fresh();writeVerified(key("draft",chat),draftValue(chat,created).toString());return created}
        val value=JSONObject(raw);if(value.opt("format")=="genesis-messenger-draft-v2")return decodeDraft(chat,value)
        E2eeKeys.exact(value,setOf("text"));val adopted=fresh(text(value.get("text")));archive(chat,"draft",raw);writeVerified(key("draft",chat),draftValue(chat,adopted).toString());return adopted
    }
    suspend fun saveDraft(chat:MessengerChat,value:MessengerSavedDraft){
        current();val encoded=draftValue(chat,value).toString();decodeDraft(chat,JSONObject(encoded));val before=store.read(key("draft",chat));current();if(before==encoded)return
        if(before!=null){val prior=JSONObject(before);if(prior.opt("format")!="genesis-messenger-draft-v2"||decodeDraft(chat,prior).token!=value.token)archive(chat,"draft",before)}
        writeVerified(key("draft",chat),encoded)
    }
    private fun command(chat:MessengerChat,raw:String):MessengerSavedCommand{
        val value=JSONObject(raw);val modern=value.opt("format")=="genesis-messenger-command-v2"
        if(modern){E2eeKeys.exact(value,setOf("format","ownerId","conversationId","kind","method","path","body","sourceSeq","draft","done","receipt","recoveryDraft"))
            check(value.get("ownerId")==owner&&value.get("conversationId")==chat.id&&value.get("kind")==chat.kind&&value.get("done") is Boolean){"MESSENGER_JOURNAL_INVALID"}
        }else E2eeKeys.exact(value,setOf("method","path","body"))
        val method=value.getString("method");val path=value.getString("path");check(method in setOf("POST","PATCH","DELETE")){"MESSENGER_JOURNAL_INVALID"};val body=value.getJSONObject("body")
        val base="/conversations/${uuid(chat.id)}/messages";val id=if(method=="POST")uuid(body.getString("id"))else{check(path.startsWith("$base/")){"MESSENGER_JOURNAL_INVALID"};uuid(path.removePrefix("$base/"))}
        check(path==if(method=="POST")base else "$base/$id"){"MESSENGER_JOURNAL_INVALID"}
        val fields=if(method=="DELETE")setOf("expectedRevision")else setOf("id",if(chat.kind=="secret")"payload"else"text")+(if(method=="PATCH")setOf("expectedRevision")else emptySet())
        E2eeKeys.exact(body,fields+(if(chat.kind=="secret")setOf("deviceId")else emptySet()));if(method!="DELETE")check(body.getString("id")==id){"MESSENGER_JOURNAL_INVALID"}
        val revision=if(method=="POST")0 else number(body.get("expectedRevision"),1);check(revision<Int.MAX_VALUE){"MESSENGER_JOURNAL_INVALID"}
        if(chat.kind=="secret"){
            uuid(body.getString("deviceId"));if(method!="DELETE"){
                val payload=body.getJSONObject("payload");E2eeKeys.exact(payload,setOf("version","iv","ciphertext","keyIds"));check(payload.get("version")==1){"MESSENGER_JOURNAL_INVALID"}
                E2eeEnvelope.decode(payload.getString("iv"),12);check(MessagingCrypto.unbase64(payload.getString("ciphertext")).size in 16..32016){"MESSENGER_JOURNAL_INVALID"}
                val keys=payload.getJSONObject("keyIds");check(keys.length()==2&&keys.has(owner)){"MESSENGER_JOURNAL_INVALID"};for(key in keys.keys())check(Regex("[a-f0-9]{64}").matches(keys.getString(key))){"MESSENGER_JOURNAL_INVALID"}
            }
        }else if(method!="DELETE")text(body.get("text"))
        val origin=if(!modern||value.isNull("draft"))null else decodeDraft(chat,value.getJSONObject("draft"));val done=modern&&value.getBoolean("done")
        if(done)receipt(value.getJSONObject("receipt"),id,revision);else if(modern)check(value.isNull("receipt")){"MESSENGER_JOURNAL_INVALID"}
        val recovery=if(!modern||value.isNull("recoveryDraft"))null else decodeDraft(chat,value.getJSONObject("recoveryDraft"));check(!done||recovery==null){"MESSENGER_JOURNAL_INVALID"}
        if(origin!=null&&method!="DELETE")check((origin.edit?.id?:origin.token)==id&&(origin.edit?.revision?.toLong()?:0)==revision){"MESSENGER_JOURNAL_INVALID"}
        return MessengerSavedCommand(raw,value,method,path,body,id,revision,if(modern)number(value.get("sourceSeq"))else 0,origin,done,recovery)
    }
    fun receipt(value:JSONObject,id:String,revision:Long){E2eeKeys.exact(value,setOf("ok","id","revision"));check(value.get("ok")==true&&value.getString("id")==id&&number(value.get("revision"),1)==revision+1){"MESSENGER_RECEIPT_INVALID"}}
    suspend fun pending(chat:MessengerChat):MessengerSavedCommand?{current();val raw=store.read(key("pending",chat));current();return raw?.let{command(chat,it)}}
    suspend fun create(chat:MessengerChat,method:String,path:String,body:JSONObject,draft:MessengerSavedDraft,seq:Long):MessengerSavedCommand{
        current();check(store.read(key("pending",chat))==null){"MESSAGING_PENDING_COMMAND"};current()
        val value=JSONObject().put("format","genesis-messenger-command-v2").put("ownerId",owner).put("conversationId",chat.id).put("kind",chat.kind).put("method",method).put("path",path).put("body",body)
            .put("sourceSeq",seq).put("draft",draftValue(chat,draft)).put("done",false).put("receipt",JSONObject.NULL).put("recoveryDraft",JSONObject.NULL)
        val saved=command(chat,value.toString());writeVerified(key("pending",chat),saved.raw);return saved
    }
    private fun modern(chat:MessengerChat,old:MessengerSavedCommand):JSONObject=JSONObject().put("format","genesis-messenger-command-v2").put("ownerId",owner).put("conversationId",chat.id).put("kind",chat.kind)
        .put("method",old.method).put("path",old.path).put("body",old.body).put("sourceSeq",old.seq).put("draft",old.draft?.let{draftValue(chat,it)}?:JSONObject.NULL)
        .put("done",old.done).put("receipt",old.value.optJSONObject("receipt")?:JSONObject.NULL).put("recoveryDraft",old.recovery?.let{draftValue(chat,it)}?:JSONObject.NULL)
    private suspend fun replace(chat:MessengerChat,old:MessengerSavedCommand,value:JSONObject):MessengerSavedCommand{
        current();check(store.read(key("pending",chat))==old.raw){"MESSENGER_JOURNAL_CONFLICT"};archive(chat,"command",old.raw);val saved=command(chat,value.toString());writeVerified(key("pending",chat),saved.raw);return saved
    }
    suspend fun done(chat:MessengerChat,old:MessengerSavedCommand,result:JSONObject):MessengerSavedCommand{receipt(result,old.messageId,old.revision);return replace(chat,old,modern(chat,old).put("done",true).put("receipt",result))}
    suspend fun recover(chat:MessengerChat,old:MessengerSavedCommand,draft:MessengerSavedDraft)=replace(chat,old,modern(chat,old).put("recoveryDraft",draftValue(chat,draft)))
    suspend fun clear(chat:MessengerChat,old:MessengerSavedCommand){current();check(store.read(key("pending",chat))==old.raw){"MESSENGER_JOURNAL_CONFLICT"};check(old.done||old.recovery!=null){"MESSENGER_JOURNAL_CONFLICT"}
        archive(chat,"command",old.raw);store.delete(key("pending",chat));current();check(store.read(key("pending",chat))==null){"MESSENGER_JOURNAL_UNVERIFIED"};current()}
    override fun toString()="MessengerJournal([redacted])"
}
