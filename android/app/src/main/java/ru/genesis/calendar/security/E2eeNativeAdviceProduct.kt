package ru.genesis.calendar.security

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.time.LocalDate
import ru.genesis.calendar.auth.NativeAdvicePublicCatalogues
import ru.genesis.calendar.ui.NativeAdviceProductRuntime

/** Account-owned content ports for the common bundled product engine. No
 * arbitrary path, external origin, root, token, ACL or entitlement import port. */
internal class E2eeNativeAdviceProduct(context:Context,private val account:E2eeProductAccount){
    private val runtime=NativeAdviceProductRuntime(context);private val mutex=Mutex()
    private val catalogues=NativeAdvicePublicCatalogues({context.assets.open("originals/catalogs/public-advice-editions-v1.json").use{it.readBytes()}},metadataPinBytes={context.assets.open("originals/catalogs/public-advice-metadata-v1.json").use{it.readBytes()}})
    private val documents=mutableMapOf<String,E2eeFeatureDocument>();private val seeds=mutableMapOf<String,JSONObject>()
    private fun current(){account.requireOpen()}
    private fun validate(value:JSONObject):JSONObject{check(value.getInt("protocol")==1&&value.getString("ownerId")==account.ownerId){"E2EE_SCOPE_BINDING_MISMATCH"};return JSONObject(value.toString())}
    private fun featureId(id:String):String{check(id=="personal-advice-live-index-v1"||id.matches(Regex("personal-advice-live-day:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}"))){"E2EE_ADVICE_CONTENT_INVALID"};return id}
    private fun versionId(id:String):String{check(id.matches(Regex("advice-live:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}"))){"E2EE_ADVICE_CONTENT_INVALID"};return id}
    private fun version(id:String)=E2eePrivateDocument(account.device,account.client,account.directory.scopeId,"workspace",versionId(id),{value->validate(value);check(value.getString("scopeId")==account.directory.scopeId&&"advice-live:${value.getString("intentId")}"==id){"E2EE_SCOPE_BINDING_MISMATCH"};LocalDate.parse(value.getString("dayKey"));check(value.getInt("slot") in 1..9&&value.getJSONObject("entry").getString("collection") in setOf("aurora","philosophers"));value},::current,::current)
    private fun localId(id:String):String{check(id in setOf("advice-pending-v1","advice-policy-v1")){"E2EE_ADVICE_CONTENT_INVALID"};return id}
    fun hasPending():Boolean{current();val row=account.device.vault.read("outbox","advice-pending-v1")?:return false
        try{val value=E2eeFileManifestJson.readPrivateDocument(row.bytes);validate(value);check(value.get("complete") is Boolean){"E2EE_CORRUPT_OUTBOX"};return !value.getBoolean("complete")}finally{row.bytes.fill(0)}}
    private fun readLocal(id:String):Any{val row=account.device.vault.read("outbox",localId(id))?:return JSONObject.NULL
        try{return JSONObject().put("serial",row.serial).put("value",E2eeFileManifestJson.readPrivateDocument(row.bytes))}finally{row.bytes.fill(0)}}
    private suspend fun call(method:String,payload:JSONObject):Any{current();return when(method){
        "publicBytes"->{E2eeKeys.exact(payload,setOf("path"));val bytes=catalogues.read(payload.getString("path"),::current);try{E2eeEnvelope.encode(bytes)}finally{bytes.fill(0)}}
        "original"->{E2eeKeys.exact(payload,setOf("id"));val id=payload.getString("id");check(id=="personal-advice-history-index-v1"||id.matches(Regex("personal-advice-day:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}"))){"E2EE_ADVICE_CONTENT_INVALID"}
            val document=E2eePrivateDocument(account.device,account.client,account.directory.scopeId,"workspace",id,::validate,::current,::current);val view=document.load(account.offline);check(!view.pending&&view.conflict==null){"E2EE_ADVICE_HISTORY_REVIEW_REQUIRED"};view.value}
        "feature"->{val id=featureId(payload.getString("id"));val action=payload.getString("action");payload.optJSONObject("seed")?.let{seeds[id]=validate(it)}
            val document=documents.getOrPut(id){E2eeFeatureDocument(account,"workspace",id,::validate,{seeds[id]?.let{JSONObject(it.toString())}?:error("E2EE_PRIVATE_SEED_REQUIRED")},::current)}
            when(action){"read"->document.read(payload.optBoolean("refresh",true));"write"->document.write(validate(payload.getJSONObject("document")));"resolve"->document.resolve(validate(payload.getJSONObject("document")),E2eeCommands.integer(payload.get("revision"),1));"flush"->document.flush();else->error("E2EE_ADVICE_METHOD_INVALID")}}
        "policy"->{E2eeKeys.exact(payload,emptySet());check(!account.offline){"E2EE_ONLINE_REQUIRED"};account.client.readAdvicePolicy()}
        "readIssue"->{E2eeKeys.exact(payload,setOf("reference"));val ref=payload.getJSONObject("reference");E2eeKeys.exact(ref,setOf("objectId","payloadHash"));val id=versionId(ref.getString("objectId"));E2eeEnvelope.decode(ref.getString("payloadHash"),32)
            if(!account.offline)account.client.assertObjectReference("workspace",id,1,ref.getString("payloadHash"));val view=version(id).load(account.offline);check(!view.pending&&view.conflict==null&&view.remoteRevision==1L){"E2EE_ADVICE_CONTENT_INVALID"};view.value}
        "prepareIssue"->{E2eeKeys.exact(payload,setOf("issue"));check(!account.offline){"E2EE_ONLINE_REQUIRED"};val value=validate(payload.getJSONObject("issue"));val id=versionId("advice-live:${value.getString("intentId")}");val document=version(id)
            val view=try{document.load()}catch(error:IllegalStateException){if(error.message!="E2EE_PRIVATE_DOCUMENT_MISSING")throw error;document.save(value,null,0);document.load(true)}
            check(view.conflict==null&&view.remoteRevision<=1&&E2eeProductJson.same(view.value,value)){"E2EE_ADVICE_CONTENT_INVALID"};if(view.pending)document.flush()
            val ref=account.client.objectReference("workspace",id);JSONObject().put("objectId",id).put("payloadHash",ref.get("payloadHash"))}
        "publishIssue"->{E2eeKeys.exact(payload,setOf("issue","reference"));check(!account.offline){"E2EE_ONLINE_REQUIRED"};val value=validate(payload.getJSONObject("issue"));val id=versionId("advice-live:${value.getString("intentId")}");val ref=payload.getJSONObject("reference");check(ref.getString("objectId")==id){"E2EE_OBJECT_REFERENCE_MISMATCH"}
            account.client.assertObjectReference("workspace",id,1,ref.getString("payloadHash"));account.client.executeService("advice-issue",JSONObject().put("dayKey",value.get("dayKey")).put("collection",value.getJSONObject("entry").get("collection")).put("expectedCount",value.getInt("slot")-1).put("objectId",id).put("payloadHash",ref.get("payloadHash")),value.getString("intentId"))}
        "localRead"->{E2eeKeys.exact(payload,setOf("id"));readLocal(payload.getString("id"))}
        "localWrite"->{E2eeKeys.exact(payload,setOf("id","value","expected"));val id=localId(payload.getString("id"));val value=payload.getJSONObject("value");if(id=="advice-pending-v1")validate(value);val serial=if(payload.isNull("expected"))null else E2eeCommands.integer(payload.get("expected"),1);val bytes=value.toString().toByteArray(Charsets.UTF_8)
            try{account.device.vault.write(listOf(UnlockedE2eeVault.Write("outbox",id,bytes,serial)));if(id=="advice-pending-v1")NativePrivateProducts.changed(ru.genesis.calendar.auth.CloudAccountSnapshot.scopeFor(account.ownerId))}finally{bytes.fill(0)};true}
        "archivePending"->{E2eeKeys.exact(payload,setOf("intentId","value"));val intent=E2eeKeys.technical(payload.getString("intentId"));val value=validate(payload.getJSONObject("value"));check(value.getJSONObject("issue").getString("intentId")==intent){"E2EE_SCOPE_BINDING_MISMATCH"};val id="advice-history:$intent";val old=account.device.vault.read("local-snapshot",id)
            if(old!=null){try{check(E2eeProductJson.same(E2eeFileManifestJson.readPrivateDocument(old.bytes),value)){"E2EE_CORRUPT_OUTBOX"}}finally{old.bytes.fill(0)}}
            else{val bytes=value.toString().toByteArray(Charsets.UTF_8);try{account.device.vault.write(listOf(UnlockedE2eeVault.Write("local-snapshot",id,bytes,null)))}finally{bytes.fill(0)}};true}
        else->error("E2EE_ADVICE_METHOD_INVALID")
    }.also{current()}}
    suspend fun execute(action:String,args:JSONObject,language:String,preferences:JSONObject):JSONObject=withContext(Dispatchers.IO){mutex.withLock{current();check(action in setOf("today","record","saved","resume")){"E2EE_ADVICE_METHOD_INVALID"}
        runtime.execute(JSONObject().put("protocol",1).put("mode","advice-product-v1").put("ownerId",account.ownerId).put("scopeId",account.directory.scopeId).put("offline",account.offline)
            .put("language",language).put("preferences",preferences).put("action",action).put("args",args),::current,::call).also{current()}}}
    override fun toString()="E2eeNativeAdviceProduct([redacted])"
}
