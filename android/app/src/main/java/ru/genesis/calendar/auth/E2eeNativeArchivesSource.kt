package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.data.LocalCipher
import ru.genesis.calendar.data.DiaryKeystoreCipher
import ru.genesis.calendar.security.*
import java.nio.ByteBuffer
import java.time.Instant
import java.util.Base64

/** Materialize local Keystore layers before protecting the complete capture.
 * Old account keys live only in this native protected input, never in WebView,
 * remote archive objects or an executable restore queue. */
internal class E2eeNativeArchivesSource(private val ownerId:String,private val scopeId:String,
    private val captureRaw:suspend ()->ByteArray,private val assertCurrent:()->Unit,
    private val legacyArchives:suspend (E2eeMigrationSourceContext)->JSONObject,
    private val reconciler:E2eePersonalSourceReconciler,
    private val legacyPhysis:(suspend(E2eeMigrationSourceContext)->JSONObject)?=null,
    private val independentUnlock:suspend(JSONObject)->E2eePhysisCredential?={null}):E2eePrivatePathAdapter {
    override val id="personal.archives"
    private val account=CloudAccountSnapshot.scopeFor(ownerId)
    private val cipher=LocalCipher()
    private val maximum=64*1024*1024
    init{E2eeKeys.technical(ownerId);E2eeKeys.technical(scopeId)}
    private fun parse(raw:ByteArray):JSONObject {
        check(raw.size in 1..maximum){"E2EE_ARCHIVE_SOURCE_INVALID"}
        return JSONObject(Charsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(raw)).toString())
    }
    private fun key(encoded:String):ByteArray {
        check(encoded.length==44){"E2EE_LEGACY_KEY_UNAVAILABLE"}
        val bytes=try{WorkspaceCipher.decodeKey(encoded)}catch(_:IllegalArgumentException){error("E2EE_LEGACY_KEY_UNAVAILABLE")}
        if(Base64.getEncoder().encodeToString(bytes)!=encoded){bytes.fill(0);error("E2EE_LEGACY_KEY_UNAVAILABLE")};return bytes
    }
    private fun localState(raw:String,keys:MutableSet<String>):JSONObject {
        assertCurrent();val value=JSONObject(raw)
        if(value.optString("format")!="native-protected-state-v1"){
            // A safety copy may be a previously materialized portable backup.
            check(value.getInt("schema")==1&&value.getString("ownerId")==ownerId&&value.isNull("billingEvidence")){"E2EE_ARCHIVE_FORMAT_UNSUPPORTED"}
            return JSONObject().put("portableBackup",value).put("execution","history-only")
        }
        check(value.getString("scope")==account){"E2EE_SCOPE_BINDING_MISMATCH"}
        val rows=value.getJSONArray("documents");check(rows.length()<=10000){"E2EE_SOURCE_TOO_LARGE"}
        val docs=linkedMapOf<String,JSONObject>()
        for(i in 0 until rows.length()){val row=rows.getJSONObject(i);check(docs.put(row.getString("kind"),row)==null){"E2EE_ARCHIVE_SOURCE_INVALID"}}
        val materialized=JSONArray();val handled=mutableSetOf<String>()
        val diaryGroups=linkedMapOf<String,MutableMap<Int,String>>()
        for((kind,row) in docs){
            val match=Regex("diary-v1/([a-f0-9-]{36})/(0|[1-9][0-9]{0,3})").matchEntire(kind)
            if(match!=null){check(diaryGroups.getOrPut(match.groupValues[1]){linkedMapOf()}.put(match.groupValues[2].toInt(),row.getString("encrypted"))==null){"E2EE_ARCHIVE_SOURCE_INVALID"};handled+=kind}
        }
        val assembled=linkedMapOf<String,String>()
        for((generation,parts) in diaryGroups){
            check(parts.size in 1..4096&&parts.keys==(0 until parts.size).toSet()){"E2EE_ARCHIVE_NATIVE_HISTORY_REVIEW_REQUIRED"}
            val encrypted=(0 until parts.size).joinToString(""){parts.getValue(it)}
            check(encrypted.length<=maximum){"E2EE_SOURCE_TOO_LARGE"};assembled[generation]=encrypted
            materialized.put(JSONObject().put("source","diary-v1/$generation").put("rawDocument",DiaryKeystoreCipher(account,ownerId).decrypt(encrypted)))
        }
        docs["diary-v1"]?.let{row->
            val root=row.getString("encrypted");val prefix="genesis-diary-chunks-v1:"
            val encrypted=if(root.startsWith(prefix)){
                val manifest=JSONArray(root.removePrefix(prefix));check(manifest.length()==3){"E2EE_ARCHIVE_SOURCE_INVALID"}
                val generation=manifest.getString(0);val encrypted=assembled[generation]?:error("E2EE_ARCHIVE_NATIVE_HISTORY_REVIEW_REQUIRED")
                check(diaryGroups[generation]?.size==manifest.getInt(1)&&encrypted.length==manifest.getInt(2)){"E2EE_ARCHIVE_NATIVE_HISTORY_REVIEW_REQUIRED"};encrypted
            }else root
            materialized.put(JSONObject().put("source","diary-v1").put("rawDocument",DiaryKeystoreCipher(account,ownerId).decrypt(encrypted)));handled+="diary-v1"
        }
        for((kind,row) in docs){
            if(kind in handled)continue
            if(kind=="account-entry"){materialized.put(JSONObject().put("source",kind).put("excludedAuthority",true));continue}
            val context=if(kind=="aurora-account-key")"$account/aurora/$ownerId/account-key" else if(kind.startsWith("aurora-"))"$account/aurora/$ownerId/$kind"
                else if(kind.startsWith("advice-cache-history-v2:"))"$account/advice-cache-v2" else "$account/$kind"
            val plain=cipher.decrypt(row.getString("encrypted"),context);assertCurrent()
            if(kind=="aurora-account-key"){key(plain).fill(0);keys+=plain;continue}
            materialized.put(JSONObject().put("source",kind).put("revision",row.getLong("revision")).put("rawDocument",plain))
        }
        val tasks=JSONArray();val originalTasks=value.getJSONArray("tasks")
        check(originalTasks.length()<=10000){"E2EE_SOURCE_TOO_LARGE"}
        for(i in 0 until originalTasks.length()){val row=originalTasks.getJSONObject(i);val id=row.getString("id")
            tasks.put(JSONObject().put("id",id).put("revision",row.getLong("revision")).put("deleted",row.getBoolean("deleted"))
                .put("rawDocument",cipher.decrypt(row.getString("encrypted"),"$account/$id")));assertCurrent()}
        return JSONObject().put("format","genesis-native-archive-content-v1").put("capturedAt",value.getString("capturedAt"))
            .put("documents",materialized).put("tasks",tasks).put("preferences",value.getJSONObject("preferences"))
            .put("outbox",value.getJSONArray("outbox")).put("execution","history-only")
    }
    override suspend fun captureLocal():ByteArray {
        assertCurrent();val raw=captureRaw()
        try{
            val input=parse(raw);check(input.get("ownerId")==ownerId&&input.get("scopeId")==scopeId&&input.isNull("pendingGeneration")){"E2EE_SCOPE_BINDING_MISMATCH"}
            val keys=linkedSetOf<String>();val histories=JSONArray()
            histories.put(JSONObject().put("source","current-protected-state").put("value",localState(input.getString("protectedState"),keys)))
            val safety=input.getJSONArray("safety");val groups=linkedMapOf<String,MutableMap<Int,String>>();val roots=linkedMapOf<String,JSONObject>()
            for(i in 0 until safety.length()){val row=safety.getJSONObject(i);check(row.get("scope")==account){"E2EE_SCOPE_BINDING_MISMATCH"};val kind=row.getString("kind")
                val match=Regex("(backup-safety:[A-Za-z0-9_.:+-]{1,256})/chunk/(0|[1-9][0-9]{0,3})").matchEntire(kind)
                if(match!=null){check(groups.getOrPut(match.groupValues[1]){linkedMapOf()}.put(match.groupValues[2].toInt(),row.getString("encrypted"))==null){"E2EE_ARCHIVE_SOURCE_INVALID"}}
                else{check(kind.startsWith("backup-safety:")&&roots.put(kind,JSONObject(row.getString("encrypted")))==null){"E2EE_ARCHIVE_SOURCE_INVALID"}}
            }
            for(kind in (groups.keys+roots.keys).sorted()){
                val parts=groups[kind]?:error("E2EE_ARCHIVE_NATIVE_HISTORY_REVIEW_REQUIRED");check(parts.size in 1..4096&&parts.keys==(0 until parts.size).toSet()){"E2EE_ARCHIVE_NATIVE_HISTORY_REVIEW_REQUIRED"}
                val encrypted=(0 until parts.size).joinToString(""){parts.getValue(it)};check(encrypted.length<=maximum*4L/3+40){"E2EE_SOURCE_TOO_LARGE"}
                roots[kind]?.let{check(it.getInt("chunks")==parts.size&&it.getInt("length")==encrypted.length){"E2EE_ARCHIVE_NATIVE_HISTORY_REVIEW_REQUIRED"}}
                val plain=cipher.decrypt(encrypted,"$account/$kind");assertCurrent()
                histories.put(JSONObject().put("source",kind).put("value",localState(plain,keys)))
            }
            // Forms and file bytes are retained independently of old cipher aliases.
            // The shared strict reader validates the original form/value JSON.
            histories.put(JSONObject().put("source","native-forms").put("value",input.getJSONObject("forms")))
            if(!input.isNull("history"))histories.put(JSONObject().put("source","backup-history").put("value",input.getString("history")))
            val portable=JSONObject().put("protocol",2).put("ownerId",ownerId).put("scopeId",scopeId).put("capturedAt",input.getString("capturedAt"))
                .put("generation",input.getLong("generation")).put("platform","android").put("histories",histories)
            val output=JSONObject().put("protocol",1).put("ownerId",ownerId).put("scopeId",scopeId).put("original",input).put("portable",portable).put("oldKeys",JSONArray(keys.toList()))
                .toString().toByteArray(Charsets.UTF_8)
            try{assertCurrent();check(output.size<=maximum){"E2EE_SNAPSHOT_TOO_LARGE"};return output}catch(error:Throwable){output.fill(0);throw error}
        }finally{raw.fill(0)}
    }
    private fun snapshot(raw:ByteArray):JSONObject=parse(raw).also{value->
        E2eeKeys.exact(value,setOf("protocol","ownerId","scopeId","original","portable","oldKeys"))
        check(value.getInt("protocol")==1&&value.get("ownerId")==ownerId&&value.get("scopeId")==scopeId){"E2EE_SCOPE_BINDING_MISMATCH"}
        check(value.getJSONArray("oldKeys").length()<=1000){"E2EE_SOURCE_TOO_LARGE"}
    }
    override suspend fun reconcile(local:ByteArray,previous:List<ByteArray>):E2eePathReconciliation=error("E2EE_SCOPE_BINDING_MISMATCH")
    override suspend fun reconcile(local:ByteArray,previous:List<ByteArray>,context:E2eeMigrationSourceContext?):E2eePathReconciliation {
        assertCurrent();val lease=requireNotNull(context){"E2EE_SCOPE_BINDING_MISMATCH"};check(lease.ownerId==ownerId&&lease.scopeId==scopeId){"E2EE_SCOPE_BINDING_MISMATCH"}
        check(previous.size<=32&&local.size+previous.sumOf{it.size.toLong()}<=E2eeMigrationSources.BYTE_BUDGET){"E2EE_MIGRATION_HISTORY_LIMIT"}
        val snapshots=listOf(snapshot(local))+previous.map(::snapshot);val remote=legacyArchives(lease);assertCurrent()
        val keys=mutableListOf<ByteArray>();var physis:E2eeLegacyPhysis.Reader?=null;var physisVersion:Long?=null
        try{
            for(capture in snapshots){val retained=capture.getJSONArray("oldKeys");for(i in 0 until retained.length())keys+=key(retained.getString(i))}
            val legacy=remote.getJSONObject("legacyKey");if(legacy.getString("keyMode")=="account")keys+=key(legacy.getString("key"))else check(legacy.isNull("key")){"E2EE_KEY_BRIDGE_FORBIDDEN"}
            val safeRemote=JSONObject(remote.toString());safeRemote.getJSONObject("legacyKey").put("key",JSONObject.NULL)
            val originals=linkedMapOf<String,MutableSet<Pair<String,String>>>();val physisOriginals=linkedMapOf<String,MutableList<JSONObject>>()
            fun retain(purpose:String,row:JSONObject){originals.getOrPut(purpose){linkedSetOf()}.add(row.getString("iv") to row.getString("ciphertext"))}
            for(table in listOf("stages","safety")){val rows=remote.getJSONArray(table);for(i in 0 until rows.length()){
                val row=JSONObject(rows.getString(i))
                if(table=="stages"){val operations=JSONArray(row.getString("payload_json"));for(j in 0 until operations.length()){
                    val op=operations.getJSONObject(j);val id=op.optString("id");val purpose=when(op.getString("section")){"workspace"->"workspace";"mindmaps"->"map:$id";"diary"->"diary-note:v1:$id";"stoicheion"->"stoicheion-workspace:v1";"aurora"->"aurora-workspace:v1";"recovered-tasks"->"recovered-task:v1:$id";else->error("E2EE_ARCHIVE_FORMAT_UNSUPPORTED")};retain(purpose,op.getJSONObject("input"))
                }}else{val tables=JSONObject(row.getString("snapshot_json"));for(name in tables.keys()){val records=tables.getJSONArray(name);for(j in 0 until records.length()){
                    val record=records.getJSONObject(j)
                    if(name=="physis_records"&&!record.isNull("envelope_json")){
                        val packet=JSONObject(record.getString("envelope_json"));val identity=record.getString("id")+":"+packet.getLong("keyVersion")
                        physisOriginals.getOrPut(identity){mutableListOf()}.add(packet)
                    }
                    if(!record.has("iv"))continue
                    val purpose=when(name){"workspace_blobs"->"workspace";"personal_mindmaps"->"map:${record.getString("id")}";"personal_mindmap_versions"->"map:${record.getString("map_id")}";"personal_diary_notes"->"diary-note:v1:${record.getString("id")}";"stoicheion_workspaces"->"stoicheion-workspace:v1";"aurora_workspaces"->"aurora-workspace:v1";"personal_recovered_tasks"->"recovered-task:v1:${record.getString("id")}";else->error("E2EE_ARCHIVE_FORMAT_UNSUPPORTED")};retain(purpose,record)
                }}}
            }}
            fun retainPlan(plan:JSONObject){val operations=plan.getJSONArray("operations");for(i in 0 until operations.length()){
                val op=operations.getJSONObject(i);val id=op.optString("id");val purpose=when(op.getString("section")){"workspace"->"workspace";"mindmaps"->"map:$id";"diary"->"diary-note:v1:$id";"stoicheion"->"stoicheion-workspace:v1";"aurora"->"aurora-workspace:v1";"recovered-tasks"->"recovered-task:v1:$id";else->error("E2EE_ARCHIVE_FORMAT_UNSUPPORTED")};retain(purpose,op.getJSONObject("input"))
            }}
            for(capture in snapshots){val views=capture.getJSONObject("original").getJSONObject("forms").getJSONArray("views")
                for(i in 0 until views.length()){val view=views.getJSONObject(i)
                    if(!view.isNull("rawForm")){val state=JSONObject(view.getString("rawForm")).getJSONObject("state");state.optJSONObject("plan")?.let(::retainPlan)}
                    view.optJSONObject("valueForm")?.getJSONArray("values")?.let{values->for(j in 0 until values.length()){val row=values.getJSONObject(j);if(row.getString("name")=="plan"&&row.getString("rawJson")!="null")retainPlan(JSONObject(row.getString("rawJson")))}}
                }
            }
            // Raw originals go only to the common validator, without oldKeys.
            fun bridge(capture:JSONObject)=JSONObject(capture.getJSONObject("portable").toString()).put("nativeOriginal",capture.getJSONObject("original"))
            val result=reconciler.reconcile(bridge(snapshots[0]),snapshots.drop(1).map(::bridge),lease,safeRemote,assertCurrent){envelope,purpose->
                assertCurrent();E2eeKeys.exact(envelope,setOf("iv","ciphertext"));val pair=envelope.getString("iv") to envelope.getString("ciphertext")
                if(purpose.startsWith("archive-physis:")){
                    val match=Regex("archive-physis:([a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}):([1-9][0-9]{0,15})").matchEntire(purpose)?:error("E2EE_ARCHIVE_SOURCE_INVALID")
                    val identity=match.groupValues[1]+":"+match.groupValues[2]
                    val packet=physisOriginals[identity]?.find{it.getString("iv")==pair.first&&it.getString("ciphertext")==pair.second}?:error("E2EE_ARCHIVE_SOURCE_INVALID")
                    if(physis==null){
                        val source=requireNotNull(legacyPhysis){"E2EE_ARCHIVE_PHYSIS_UNLOCK_REQUIRED"}(lease);assertCurrent()
                        check(source.get("ownerId")==ownerId&&source.get("scopeId")==scopeId&&source.get("sourceHash")==lease.sourceHash&&source.get("migrationId")==lease.migrationId&&source.getLong("fence")==lease.fence){"E2EE_SCOPE_BINDING_MISMATCH"}
                        val owners=source.getJSONArray("owners");check(owners.length()==1&&!owners.getJSONObject(0).isNull("vault_json")){"E2EE_ARCHIVE_PHYSIS_UNLOCK_REQUIRED"}
                        val raw=owners.getJSONObject(0).getString("vault_json").toByteArray(Charsets.UTF_8)
                        val vault=try{check(raw.size<=8192){"E2EE_ARCHIVE_SOURCE_INVALID"};E2eeFileManifestJson.readPrivateDocument(raw)}finally{raw.fill(0)}
                        physisVersion=vault.getLong("keyVersion")
                        val old=source.getJSONObject("legacyKey");if(old.get("keyMode")=="account")keys+=key(old.getString("key"))
                        if(vault.getInt("version")==2){for(key in keys)try{physis=E2eeLegacyPhysis.unlockAccount(ownerId,vault,key,assertCurrent);break}catch(error:IllegalStateException){assertCurrent();if(error.message!="E2EE_PHYSIS_UNLOCK_REQUIRED")throw error}}
                        else{val credential=independentUnlock(vault)?:error("E2EE_ARCHIVE_PHYSIS_UNLOCK_REQUIRED")
                            try{physis=E2eeLegacyPhysis.unlockIndependent(ownerId,vault,credential.method,credential.secret,assertCurrent)}finally{credential.close()}}
                    }
                    check(physisVersion?.toString()==match.groupValues[2]){"E2EE_ARCHIVE_PHYSIS_UNLOCK_REQUIRED"}
                    requireNotNull(physis){"E2EE_ARCHIVE_PHYSIS_UNLOCK_REQUIRED"}.readRecord(ownerId,match.groupValues[1],packet)
                }else{
                check(originals[purpose]?.contains(pair)==true){"E2EE_ARCHIVE_SOURCE_INVALID"};var opened:ByteArray?=null
                val aad=if(purpose=="workspace")byteArrayOf()else "genesis-mindmap-v1:$ownerId:$purpose".toByteArray(Charsets.UTF_8)
                for(key in keys)try{opened=WorkspaceCipher.decrypt(WorkspaceCipher.Envelope(pair.second,pair.first),key,aad);break}catch(_:java.security.GeneralSecurityException){/* Captured old keys only. */}
                val plain=opened?:error(if(keys.isEmpty())"E2EE_LEGACY_KEY_UNAVAILABLE"else "E2EE_ARCHIVE_CONTENT_CORRUPT")
                try{assertCurrent();Charsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(plain)).toString()}finally{plain.fill(0)}
                }
            }
            try{assertCurrent();check(result.localContent.isEmpty()&&result.content.all{it.domain=="local-snapshot"&&(it.objectId=="personal-archive-index-v1"||it.objectId.matches(Regex("personal-archive:[a-f0-9-]{36}")))}){"E2EE_KEY_BRIDGE_FORBIDDEN"};return result}
            catch(error:Throwable){(result.content+result.localContent).forEach{it.bytes.fill(0)};throw error}
        }finally{physis?.close();keys.forEach{it.fill(0)}}
    }
    override fun toString()="E2eeNativeArchivesSource([redacted])"
}
