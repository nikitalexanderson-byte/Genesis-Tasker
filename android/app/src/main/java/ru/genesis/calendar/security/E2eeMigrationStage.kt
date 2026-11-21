package ru.genesis.calendar.security

import org.json.JSONArray
import org.json.JSONObject
import java.io.OutputStream

/** Preflighted full registry, with no network or restore authority. */
class E2eeStagedMigrationCapture(val target:E2eeSourceStage.Target, paths:List<String>,
    val capturePath:suspend (String,OutputStream)->Unit) {
    val paths=paths.toList()
    override fun toString()="E2eeStagedMigrationCapture([redacted])"
}
class E2eeStagedMigrationOptions(val capacity:E2eeSourceStage.Capacity,val assertCurrent:()->Unit,val admit:(E2eeSourceStage.Admission)->Unit)

/** Exact v3 source reference. Legacy states keep their original source format. */
internal object E2eeMigrationStage {
    private val uuid=Regex("[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}")
    private fun invalid():Nothing=error("E2EE_CORRUPT_STAGED_MIGRATION")
    private fun ref(value:JSONObject):E2eeSourceStage.Reference {
        E2eeKeys.exact(value,setOf("stageId","manifestHash"))
        val id=value.get("stageId") as? String?:invalid();if(!uuid.matches(id))invalid()
        val hash=value.get("manifestHash") as? String?:invalid();E2eeEnvelope.decode(hash,32)
        return E2eeSourceStage.Reference(id,hash)
    }
    private fun encoded(value:E2eeSourceStage.Reference)=JSONObject().put("stageId",value.stageId).put("manifestHash",value.manifestHash)
    private fun actor(vault:E2eeSourceReadVault)=vault.localIdentity().let{JSONObject().put("ownerId",it.ownerId).put("scopeId",it.scopeId).put("deviceId",it.deviceId)}
    private fun target(value:E2eeSourceStage.Target)=JSONObject().put("ownerId",value.ownerId).put("scopeId",value.scopeId).put("kind",value.kind)
    fun validate(value:JSONObject,vault:E2eeSourceReadVault,expected:E2eeSourceStage.Target,paths:List<String>):JSONObject {
        E2eeKeys.exact(value,setOf("format","target","actor","paths","reference","history"))
        if(value.get("format")!="source-stage-v1")invalid()
        val scope=value.getJSONObject("target");E2eeKeys.exact(scope,setOf("ownerId","scopeId","kind"));val expectedTarget=target(expected)
        if(expectedTarget.keys().asSequence().any{scope.get(it)!=expectedTarget.get(it)})invalid()
        val original=value.getJSONObject("actor");E2eeKeys.exact(original,setOf("ownerId","scopeId","deviceId"));val expectedActor=actor(vault)
        if(expectedActor.keys().asSequence().any{original.get(it)!=expectedActor.get(it)})invalid()
        val registry=value.getJSONArray("paths");if(registry.length()!=paths.size||(paths.indices).any{registry.get(it)!=paths[it]})invalid()
        val current=ref(value.getJSONObject("reference"));val history=value.getJSONArray("history");if(history.length()>63)invalid()
        val seen=mutableSetOf(current.stageId)
        for(index in 0 until history.length())if(!seen.add(ref(history.getJSONObject(index)).stageId))invalid()
        return JSONObject(value.toString())
    }
    fun verify(vault:E2eeSourceReadVault,input:JSONObject,expected:E2eeSourceStage.Target,paths:List<String>,guard:()->Unit):Pair<Long,Int> {
        val current:()->Unit={guard();vault.assertOpen()};current();val value=validate(input,vault,expected,paths)
        val history=value.getJSONArray("history");val refs=(0 until history.length()).map{ref(history.getJSONObject(it))}+ref(value.getJSONObject("reference"))
        val known=E2eeSourceStage.inspect(vault,expected,current);current()
        check(known.size==refs.size&&known.indices.all{known[it].complete&&known[it].id==refs[it].stageId&&known[it].manifestHash==refs[it].manifestHash}){"E2EE_SOURCE_STAGE_HISTORY_REVIEW_REQUIRED"}
        val buffer=ByteArray(E2eeFiles.CHUNK_BYTES);var bytes=0L;var parts=0
        try{
            for(reference in refs){val opened=E2eeSourceStage.open(vault,expected,reference,current);current()
                if(opened.paths!=paths)invalid()
                for(path in opened.paths)opened.openPath(path).use{reader->while(true){current();val count=reader.read(buffer);if(count<0)break;bytes+=count;parts++;buffer.fill(0,0,count)};reader.assertComplete();current()}
            }
        }finally{buffer.fill(0)}
        check(E2eeSourceStage.inspect(vault,expected,current)==known){"E2EE_SOURCE_STAGE_BUSY"};current();return bytes to parts
    }
    fun publicationGuard(vault:UnlockedE2eeVault,input:JSONObject,expected:E2eeSourceStage.Target,paths:List<String>,guard:()->Unit):UnlockedE2eeVault.Write {
        val value=validate(input,vault,expected,paths);val history=value.getJSONArray("history")
        val refs=(0 until history.length()).map{ref(history.getJSONObject(it))}+ref(value.getJSONObject("reference"))
        return E2eeSourceStage.publicationGuard(vault,expected,refs,guard)
    }
    suspend fun capture(vault:UnlockedE2eeVault,input:E2eeStagedMigrationCapture,required:List<String>,options:E2eeStagedMigrationOptions,ensureDurableKeys:()->Unit):JSONObject {
        val scope=input.target;val paths=input.paths.toList();val capture=input.capturePath;val capacity=options.capacity;val guard=options.assertCurrent;val admit=options.admit
        val current:()->Unit={guard();vault.requireOpen()};current();E2eeKeys.technical(scope.ownerId);E2eeKeys.technical(scope.scopeId)
        check(scope.kind in setOf("personal","project","space")&&required.size in 1..20&&required.toSet().size==required.size&&paths==required){"E2EE_SOURCE_ADAPTER_REQUIRED"}
        paths.forEach(E2eeKeys::technical);ensureDurableKeys();current()
        val known=E2eeSourceStage.inspect(vault,scope,current);current()
        check(known.none{!it.complete}){"E2EE_SOURCE_STAGE_HISTORY_REVIEW_REQUIRED"}
        val history=known.map{E2eeSourceStage.Reference(it.id,it.manifestHash?:invalid())}
        fun snapshot(reference:E2eeSourceStage.Reference,previous:List<E2eeSourceStage.Reference>)=JSONObject().put("format","source-stage-v1").put("target",target(scope)).put("actor",actor(vault))
            .put("paths",JSONArray(paths)).put("reference",encoded(reference)).put("history",JSONArray().apply{previous.forEach{put(encoded(it))}})
        if(history.isNotEmpty())verify(vault,snapshot(history.last(),history.dropLast(1)),scope,paths,current)
        val stage=E2eeSourceStage.create(E2eeSourceStage.Options(vault,scope,paths,capacity,current,current,admit))
        for(path in paths){current();stage.captureSuspendPath(path){capture(path,it)};current()}
        val result=snapshot(stage.finish(),history);verify(vault,result,scope,paths,current);current();return result
    }
}
