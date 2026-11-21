package ru.genesis.calendar.data

import org.json.JSONObject
import ru.genesis.calendar.security.*

/** The bundled engine validates the complete Aurora model on both sides of
 * this narrow native port. Only domain content crosses it, never a vault key. */
internal class NativePrivateAurora(private val scope:String,private val owner:String){
    private val account=NativePrivateProducts.account(scope,owner)
    private fun check(){account.requireOpen();check(NativePrivateProducts.account(scope,owner)===account){"E2EE_ACCOUNT_CHANGED"}}
    private fun read(id:String):JSONObject{check();val row=account.client.read("aurora",id)?:error("E2EE_AURORA_SOURCE_INVALID")
        try{check();return E2eeFileManifestJson.readPrivateDocument(row.bytes)}finally{row.bytes.fill(0)}}
    private fun validate(value:JSONObject):JSONObject{
        val names=value.keys().asSequence().toSet();check(names.containsAll(setOf("version","ownerId","sessions","removed"))
            &&names.all{it in setOf("version","ownerId","activeSessionId","sessions","removed","learning")}
            &&value.get("version")==1&&value.get("ownerId")==owner){"E2EE_SCOPE_BINDING_MISMATCH"}
        val sessions=value.getJSONArray("sessions");val removed=value.getJSONArray("removed");check(sessions.length()<=100&&removed.length()<=10000){"AURORA_INVALID_DOCUMENT_OWNER"}
        val ids=mutableSetOf<String>();for(index in 0 until sessions.length()){val row=sessions.getJSONObject(index);val id=row.getString("id")
            check(id.isNotEmpty()&&id.length<=150&&ids.add(id)&&row.get("ownerId")==owner&&row.get("version")==1){"AURORA_INVALID_SESSION"}}
        val deleted=mutableSetOf<String>();for(index in 0 until removed.length()){val row=removed.getJSONObject(index);val id=row.getString("id")
            check(id.isNotEmpty()&&id.length<=150&&id !in ids&&deleted.add(id)&&DiaryNote.validDate(row.opt("removedAt"))){"AURORA_INVALID_DELETION"}}
        return JSONObject(value.toString())
    }
    private val document=E2eeFeatureDocument(account,"aurora","personal-aurora-live-v1",::validate,{
        val seed=read("personal-aurora-workspace-v1");E2eeKeys.exact(seed,setOf("protocol","ownerId","document","resultIds"))
        check(seed.get("protocol")==1&&seed.get("ownerId")==owner){"E2EE_SCOPE_BINDING_MISMATCH"};validate(seed.getJSONObject("document"))},::check)
    fun document(method:String,payload:JSONObject):JSONObject{check();return when(method){
        "read"->document.read(payload.optBoolean("refresh",true));"write"->document.write(payload.getJSONObject("document"))
        "resolve"->document.resolve(payload.getJSONObject("document"),E2eeCommands.integer(payload.get("revision"),1));"flush"->document.flush()
        else->error("AURORA_METHOD_INVALID")}}
    private fun resultId(id:String):String{check(id.matches(Regex("[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}"))){"AURORA_RESULT_MISMATCH"};return id}
    private fun result(id:String)=E2eePrivateDocument(account.device,account.client,account.directory.scopeId,"aurora","aurora-result-live:${resultId(id)}",{value->
        E2eeKeys.exact(value,setOf("protocol","ownerId","id","solution"));check(value.get("protocol")==1&&value.get("ownerId")==owner&&value.get("id")==id){"AURORA_RESULT_MISMATCH"};value},::check,::check)
    @Synchronized fun sealResult(id:String,solution:JSONObject):JSONObject{check();val value=JSONObject().put("protocol",1).put("ownerId",owner).put("id",resultId(id)).put("solution",JSONObject(solution.toString()))
        result(id).save(value,null,0);check();return JSONObject().put("kind","aurora-e2ee-reference-v1").put("objectId","aurora-result-live:$id")}
    @Synchronized fun localResult(manifest:JSONObject):JSONObject{
        check();check(!account.offline){"E2EE_ONLINE_REQUIRED"};val id=resultId(manifest.getString("id"));val record=result(id)
        val opened=try{record.load()}catch(error:IllegalStateException){
            if(error.message!="E2EE_PRIVATE_DOCUMENT_MISSING")throw error
            check(!manifest.has("kind")){"E2EE_AURORA_RESULT_MISSING"};val original=read("aurora-result:$id")
            E2eeKeys.exact(original,setOf("protocol","ownerId","id","methodVersion","contextHash","forecastHashes","solution","createdAt"))
            check(original.get("protocol")==1&&original.get("ownerId")==owner&&original.get("id")==id&&original.get("methodVersion")==manifest.get("methodVersion")
                &&original.get("contextHash")==manifest.get("contextHash")&&E2eeProductJson.same(original.get("forecastHashes"),manifest.get("forecastHashes"))){"AURORA_RESULT_MISMATCH"}
            record.save(JSONObject().put("protocol",1).put("ownerId",owner).put("id",id).put("solution",original.getJSONObject("solution")),null,0);record.load(true)
        }
        check(opened.conflict==null&&opened.remoteRevision<=1){"AURORA_RESULT_IMMUTABLE"};return JSONObject(opened.value.getJSONObject("solution").toString())
    }
    @Synchronized fun publishResult(id:String,method:String):JSONObject{check();check(!account.offline){"E2EE_ONLINE_REQUIRED"};val record=result(resultId(id));val opened=record.load()
        check(opened.conflict==null&&opened.remoteRevision<=1){"AURORA_RESULT_IMMUTABLE"};if(opened.pending)record.flush();check();account.client.prepareAuroraResult(id,method);check();return JSONObject()}
    @Synchronized fun openResult(id:String,reference:JSONObject):JSONObject{
        check();resultId(id);E2eeKeys.exact(reference,setOf("kind","scopeId","generation","objectId","revision","payloadHash"))
        check(reference.get("kind")=="aurora-e2ee-reference-v1"&&reference.get("scopeId")==account.directory.scopeId&&reference.getLong("generation")==account.directory.generation
            &&reference.get("objectId")=="aurora-result-live:$id"&&reference.getLong("revision")==1L){"AURORA_RESULT_MISMATCH"}
        account.client.assertObjectReference("aurora","aurora-result-live:$id",1,reference.getString("payloadHash"));check();val opened=result(id).load()
        check(!opened.pending&&opened.conflict==null&&opened.remoteRevision==1L){"AURORA_RESULT_IMMUTABLE"};return JSONObject(opened.value.getJSONObject("solution").toString())
    }
    override fun toString()="NativePrivateAurora([redacted])"
}
