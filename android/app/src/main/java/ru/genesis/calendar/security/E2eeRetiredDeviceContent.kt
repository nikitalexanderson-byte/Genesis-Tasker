package ru.genesis.calendar.security

import android.content.Context
import org.json.JSONObject
import org.json.JSONArray
import java.io.Closeable
import java.security.MessageDigest

/** Separately admitted historical reader; no old signing private key is
 * imported. Its only output is authenticated content from the typed catalogue. */
internal class E2eeRetiredDeviceContent private constructor(private val storage:E2eeSqliteStorage,private val local:UnlockedE2eeVault,private var material:E2eeKeys.ReadKeys?,
    override val ownerId:String,override val deviceId:String,pin:JSONObject,private val guard:()->Unit):E2eeDeviceReadView,Closeable{
    private val pinValue=pin.toString();private var closed=false
    override val authorityPin:JSONObject get()=JSONObject(pinValue)
    override val vault:E2eeDeviceReadVault get()=local
    override fun requireOpen(){guard();check(!closed){"E2EE_UNLOCK_REQUIRED"};local.assertOpen()}
    override fun readKeys():E2eeKeys.ReadKeys{requireOpen();return requireNotNull(material)}
    override fun readSavedDirectory(scopeId:String,onVerified:((E2eeDirectory.Verified)->Unit)?):E2eeDirectory.Verified?{
        requireOpen();E2eeKeys.technical(scopeId);val id="directory-"+E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(scopeId.toByteArray(Charsets.UTF_8)));val row=local.read("key-check",id)?:return null
        try{requireOpen();val value=E2eeFileManifestJson.readPrivateDocument(row.bytes);val checkpoint=value.getJSONObject("checkpoint");return E2eeDirectory.verify(value.getString("ownerId"),scopeId,value.getJSONObject("pin"),value.getJSONArray("events"),E2eeDirectory.Checkpoint(checkpoint.getLong("revision"),checkpoint.getString("hash")),onVerified)}finally{row.bytes.fill(0)}
    }
    fun catalogue(inventory:E2eePrivatePaths):E2eeMigrationOwnershipCatalogue.Handle{requireOpen();return E2eeMigrationOwnershipCatalogue.open(E2eeMigrationOwnershipCatalogue.Options(this,inventory,
        ru.genesis.calendar.auth.E2eeRemoteOriginal.Capacity(128L*1024*1024,10000,1000,10000,128*1024*1024),::requireOpen,{requireOpen();E2eeStorageAdmission.admit(storage.providerUsage(),E2eeStorageAdmission.Growth(0,0,0,0),E2eeStorageAdmission.providerBudget)}))}
    fun capture(inventory:E2eePrivatePaths):JSONObject=catalogue(inventory).use{catalogue->
        val maximum=ru.genesis.calendar.data.GenesisBackupContainer.MAX_PLAIN;val entries=mutableListOf<JSONObject>();var used=0L
        fun append(entry:JSONObject){requireOpen();used+=entry.toString().toByteArray(Charsets.UTF_8).size;check(used<=maximum-65536&&entries.size<10000){"BACKUP_TOO_LARGE"};entries+=entry}
        for(key in local.listLocal("draft","editor:")){
            requireOpen();val before=local.read("draft",key)?:error("E2EE_BACKUP_CAPTURE_CHANGED")
            try{val state=E2eeFileManifestJson.readPrivateDocument(before.bytes);val scopeId=state.getString("scopeId");val scope=catalogue.scope(scopeId);val domain=state.getString("domain");val objectId=state.getString("objectId")
                val expected="editor:"+E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest("$scopeId\u0000$domain\u0000$objectId".toByteArray(Charsets.UTF_8)));check(expected==key){"E2EE_CORRUPT_EDITOR"};val queue=E2eeEditorQueue.readOnly(local,scopeId,domain,objectId);val head=queue.load()?:error("E2EE_BACKUP_CAPTURE_CHANGED");check(head.serial==before.serial){"E2EE_BACKUP_CAPTURE_CHANGED"}
                val latest=try{E2eeContentArchive.snapshot("current",head.bytes,head.filename,head.mediaType)}finally{head.bytes.fill(0)};val history=JSONArray();var historyBytes=0L;var cursor:JSONObject?=null;val seen=mutableSetOf<String>()
                while(true){requireOpen();val page=queue.historyPage(cursor);val drafts=page.getJSONArray("drafts");for(at in 0 until drafts.length()){val draft=drafts.getJSONObject(at);check(used+historyBytes+draft.getLong("size")*4/3+8192<=maximum-65536){"BACKUP_TOO_LARGE"};val opened=queue.openHistory(draft.getString("id"),cursor);try{val value=E2eeContentArchive.snapshot(draft.getString("id"),opened.bytes,opened.filename,opened.mediaType);historyBytes+=value.toString().toByteArray(Charsets.UTF_8).size;history.put(value)}finally{opened.bytes.fill(0)}};val next=page.optJSONObject("cursor")?:break;check(seen.add(next.getString("id"))){"E2EE_EDITOR_HISTORY_CORRUPT"};cursor=next}
                val after=local.read("draft",key);try{check(after!=null&&after.serial==before.serial&&after.bytes.contentEquals(before.bytes)){"E2EE_BACKUP_CAPTURE_CHANGED"}}finally{after?.bytes?.fill(0)}
                append(JSONObject().put("placement","editor").put("scope",JSONObject().put("scopeId",scopeId).put("ownerId",scope.target.ownerId).put("kind",scope.target.kind).put("resourceId",scope.resourceId)).put("domain",domain).put("objectId",objectId).put("pending",head.pending).put("current",latest).put("history",history))
            }finally{before.bytes.fill(0)}
        }
        val ids=mutableSetOf<String>();for(prefix in listOf("personal-","shared-","product-","mindmap-","membership-","domain-content-restore:","external-google-copy:","imported-legacy-content:"))for(id in local.listLocal("draft",prefix)){
            requireOpen();if(!E2eeContentArchive.deviceContent(id)||!ids.add(id))continue;val document=E2eeDeviceDocument(null,id,{it},::requireOpen,local::read);val before=document.load()?:error("E2EE_BACKUP_CAPTURE_CHANGED");val bytes=before.value.toString().toByteArray(Charsets.UTF_8)
            try{val value=E2eeContentArchive.snapshot("current",bytes);check(document.load()?.serial==before.serial){"E2EE_BACKUP_CAPTURE_CHANGED"};append(JSONObject().put("placement","device").put("scope",JSONObject.NULL).put("domain","draft").put("objectId",id).put("pending",true).put("current",value).put("history",JSONArray()))}finally{bytes.fill(0)}
        }
        for(item in catalogue.contents()){requireOpen();val size=item.getLong("size");check(used+size*4/3+8192<=maximum-65536&&size<=Int.MAX_VALUE){"BACKUP_TOO_LARGE"};val bytes=ByteArray(size.toInt());var at=0
            try{val metadata=catalogue.readContent(item.getString("id")){chunk->requireOpen();check(chunk.size<=bytes.size-at){"BACKUP_INVALID"};chunk.copyInto(bytes,at);at+=chunk.size};check(at==bytes.size){"BACKUP_INVALID"};val value=E2eeContentArchive.snapshot(item.getString("id"),bytes,metadata.getString("filename"),metadata.getString("mediaType"));check(value.get("sha256")==item.get("sha256")){"BACKUP_INVALID"};append(JSONObject().put("placement","remote").put("scope",item.getJSONObject("scope")).put("domain",item.get("domain")).put("objectId",item.get("id")).put("pending",true).put("current",value).put("history",JSONArray()))}finally{bytes.fill(0)}
        }
        catalogue.assertUnchanged();requireOpen();val at=java.time.Instant.now().toString();val sections=JSONArray();for(module in listOf("workspace","mindmaps","diary","stoicheion","aurora","physis","shared-drafts")){val rows=entries.filter{E2eeContentArchive.group(it)==module};if(rows.isNotEmpty())sections.put(JSONObject().put("id",module).put("source","device").put("completeness","partial").put("capturedAt",at).put("revision",JSONObject.NULL).put("count",rows.size).put("pending",rows.count{it.getBoolean("pending")}).put("notices",JSONArray(listOf("CONTENT_ONLY_HISTORY_NOT_EXECUTABLE","RETIRED_DEVICE_LOCAL_CONTENT_ONLY"))).put("data",JSONObject().put("format","genesis-content-only-v1").put("execution","history-only").put("entries",JSONArray(rows))))}
        E2eeContentArchive.validate(JSONObject().put("schema",1).put("backupId",java.util.UUID.randomUUID().toString()).put("source","device_snapshot").put("ownerId",ownerId).put("createdAt",at).put("client","android").put("billingEvidence",JSONObject.NULL).put("sections",sections))
    }
    override fun close(){if(closed)return;closed=true;local.lock();material=null;storage.close()}
    override fun toString()="E2eeRetiredDeviceContent([redacted])"
    companion object{
        fun list(context:Context,ownerId:String)=E2eeDeviceVault(context,ownerId).retainedSlots()
        fun open(context:Context,ownerId:String,slot:String,guard:()->Unit):E2eeRetiredDeviceContent{
            guard();val entry=list(context,ownerId).singleOrNull{it.first==slot}?:error("E2EE_RETIRED_DEVICE_REQUIRED");val bytes=E2eeDeviceVault(context,ownerId,slot).unlock();var storage:E2eeSqliteStorage?=null
            try{guard();val saved=E2eeFileManifestJson.readPrivateDocument(bytes);E2eeKeys.exact(saved,setOf("protocol","ownerId","deviceId","localKeyId","localRoot","deviceKeys","authorityPin"));check(saved.getInt("protocol")==1&&saved.getString("ownerId")==ownerId&&saved.getString("deviceId")==entry.second&&saved.getString("localKeyId")=="local:${entry.second}"){"E2EE_CORRUPT_DEVICE_VAULT"}
                val keyValues=saved.getJSONObject("deviceKeys");E2eeKeys.exact(keyValues,setOf("signingKey","receivingKey","signingPrivate","receivingPrivate"));keyValues.remove("signingPrivate");val keys=E2eeKeys.importReadKeys(keyValues);saved.remove("deviceKeys");val raw=E2eeEnvelope.decode(saved.getString("localRoot"),32);saved.remove("localRoot");val root=try{E2eeEnvelope.importRoot(raw)}finally{raw.fill(0)};guard();val provider=E2eeSqliteStorage(context,false);storage=provider
                val readOnly=object:E2eeRecordStorage{override fun get(key:String)=provider.get(key);override fun list(prefix:String)=provider.list(prefix);override fun commit(changes:List<E2eeStorageChange>,requireOpen:()->Unit):Unit=error("E2EE_HISTORY_NOT_EXECUTABLE")}
                val local=UnlockedE2eeVault(readOnly,UnlockedE2eeVault.Scope(ownerId,"device:${entry.second}",entry.second,1,1,1,"local:${entry.second}",null,mapOf("local:${entry.second}" to root)){if(it==entry.second)keys.signer else null})
                return E2eeRetiredDeviceContent(provider,local,keys,ownerId,entry.second,saved.getJSONObject("authorityPin"),guard).also{it.requireOpen()}
            }catch(error:Throwable){storage?.close();throw error}finally{bytes.fill(0)}
        }
    }
}
