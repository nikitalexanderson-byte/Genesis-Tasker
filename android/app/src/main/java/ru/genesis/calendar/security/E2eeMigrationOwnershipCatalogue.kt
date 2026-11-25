package ru.genesis.calendar.security

import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.auth.E2eeRemoteOriginal
import java.io.Closeable

/** Account-wide read-only ownership proof. Namespace membership is discovery,
 * never admission; every discovered owner/role must have its own full proof. */
internal object E2eeMigrationOwnershipCatalogue {
    class Options(val device:E2eeDeviceReadView,val inventory:E2eePrivatePaths,val originalCapacity:E2eeRemoteOriginal.Capacity,
        val assertCurrent:()->Unit,val admit:(E2eeMigrationHistory.Admission)->Unit)
    class Scope(val target:E2eeSourceStage.Target,val resourceId:String,val stateId:String,val root:JSONObject?,val ancestors:List<JSONObject>,val serial:Long?,val hash:String?) {
        fun sourceScope()=E2eeRetainedSourceHistory.Scope(target,stateId,root?:error("E2EE_SNAPSHOT_REQUIRED"),ancestors)
        override fun toString()="E2eeMigrationOwnershipCatalogue.Scope([redacted])"
    }
    private class Row(val domain:String,val id:String,val serial:Long,val hash:String,val bytes:Int)
    private class State(val value:JSONObject,val serial:Long,val hash:String)
    private class Role(val scopeId:String,val name:String)
    private fun invalid():Nothing=error("E2EE_MIGRATION_HISTORY_REVIEW_REQUIRED")
    private fun number(value:JSONObject,name:String,min:Long=0)=E2eeCommands.integer(value.get(name),min)
    private fun hash(bytes:ByteArray)=E2eeRetainedMigrationProof.hash(bytes)
    private fun same(a:Any,b:Any)=E2eeRetainedMigrationProof.same(a,b)
    private fun rows(array:JSONArray)=E2eeRetainedMigrationProof.rows(array)
    private fun strings(array:JSONArray)=E2eeRetainedMigrationProof.strings(array)
    private val stateIdPattern=Regex("migration:[A-Za-z0-9_-]{43}")
    private val uuid=Regex("[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}")
    private val sourceBodySuffix=Regex(":source:[0-9]+$|:private:[0-9]+:[0-9]+$")
    private val sourceBodyPrefix=Regex("^(?:source-stage|remote-original):[^:]+:[^:]+:p:")
    fun open(options:Options)=Handle(options)
    class Handle internal constructor(private val options:Options):Closeable {
        private val device=options.device;private val base=device.vault;private val actor=base.localIdentity()
        private var closed=false;private var totalBytes=0L;private var metadataBytes=0L;private var roleContext:String?=null
        private val records=linkedMapOf<Pair<String,String>,Row>();private val roles=mutableMapOf<Pair<String,String>,Role>();private val metadataRows=mutableSetOf<Pair<String,String>>()
        private val lists=linkedMapOf<Pair<String,String>,List<String>>();private val directories=linkedMapOf<String,Pair<String,String>>();private val scopeRows=linkedMapOf<String,Scope>()
        private val states=mutableMapOf<String,Pair<Scope,JSONObject>>();private val frames=mutableMapOf<String,E2eeDirectory.Verified>();private val originals=mutableMapOf<String,MutableSet<String>>()
        private lateinit var copyIds:List<String>;private lateinit var sourceIds:List<String>;private lateinit var outputIds:Pair<List<String>,List<String>>;private lateinit var stateRoles:List<String>
        private lateinit var jobHistory:List<String>;private lateinit var controlHistory:List<String>
        private fun current(){options.assertCurrent();device.requireOpen();base.assertOpen();check(!closed){"E2EE_MIGRATION_HISTORY_CLOSED"};if(base.localIdentity()!=actor)invalid()}
        private fun claim(domain:String,id:String,scope:String,role:String){
            E2eeKeys.technical(id);E2eeKeys.technical(scope);val coordinate=domain to id;val old=roles[coordinate]
            if(old!=null&&(old.scopeId!=scope||old.name!=role&&old.name!="authenticated-source"&&role!="authenticated-source"))invalid()
            if(old==null||old.name=="authenticated-source")roles[coordinate]=Role(scope,role)
            if(domain=="outbox"&&role !in setOf("authenticated-source","product-cipher")&&metadataRows.add(coordinate))metadataBytes+=records[coordinate]?.bytes?:0
        }
        private fun <T> asSource(scope:String,operation:()->T):T{val old=roleContext;roleContext=scope;return try{operation()}finally{roleContext=old}}
        private val view=object:E2eeSourceReadVault {
            override fun assertOpen()=current()
            override fun localIdentity()=actor
            override fun listLocal(domain:String,objectPrefix:String):List<String>{
                current();val ids=base.listLocal(domain,objectPrefix).sorted();current();val key=domain to objectPrefix;val old=lists[key]
                if(old!=null&&old!=ids)error("E2EE_SOURCE_HISTORY_CHANGED");lists.putIfAbsent(key,ids.toList());return ids
            }
            override fun read(domain:String,objectId:String):UnlockedE2eeVault.Opened? {
                current();val row=base.read(domain,objectId);current();val coordinate=domain to objectId;val old=records[coordinate]
                if(row==null){if(old!=null)error("E2EE_SOURCE_HISTORY_CHANGED");return null}
                try{
                    val digest=hash(row.bytes);if(old!=null){if(old.serial!=row.serial||old.hash!=digest||old.bytes!=row.bytes.size)error("E2EE_SOURCE_HISTORY_CHANGED")}
                    else{
                        if(records.size>=E2eeStorageAdmission.providerBudget.maximumRecords+E2eeStorageAdmission.providerBudget.maximumKeyRecords)error("E2EE_SOURCE_HISTORY_CAPACITY");totalBytes+=row.bytes.size;records[coordinate]=Row(domain,objectId,row.serial,digest,row.bytes.size)
                        val body=domain in setOf("outbox","draft")||domain=="local-snapshot"&&(sourceBodySuffix.containsMatchIn(objectId)
                            ||sourceBodyPrefix.containsMatchIn(objectId))
                        if(!body){metadataRows+=coordinate;metadataBytes+=row.bytes.size}
                    }
                    roleContext?.let{claim(domain,objectId,it,"authenticated-source")};return row
                }catch(error:Throwable){row.bytes.fill(0);throw error}
            }
        }
        private val values=E2eeRetainedMigrationValues(view,::current)
        private fun raw(id:String,domain:String="local-snapshot"):State {
            val row=view.read(domain,id)?:invalid()
            return try{current();State(if(domain=="key-check")E2eeFileManifestJson.readPrivateDocument(row.bytes)else E2eeFileManifestJson.readMigrationHistory(row.bytes),row.serial,hash(row.bytes))}finally{row.bytes.fill(0)}
        }
        private fun state(id:String,target:E2eeSourceStage.Target):State {
            val row=view.read("local-snapshot",id)?:invalid()
            return try{current();val paths=options.inventory.required(target.kind);State(E2eeMigrationStateCodec.read(row.bytes,view,target,paths.map{it.id},paths.flatMap{it.domains}.toSet()),row.serial,hash(row.bytes))}
            catch(error:org.json.JSONException){throw IllegalStateException("E2EE_SOURCE_HISTORY_INVALID",error)}finally{row.bytes.fill(0)}
        }
        private fun originalRead(scope:Scope)=E2eeRemoteOriginal.ReadOptions(view,E2eeRemoteOriginal.Target(scope.target.ownerId,scope.target.scopeId,scope.target.kind),options.originalCapacity,::current)
        private fun root(scope:Scope,frame:E2eeDirectory.Verified)=E2eeKeys.openRoot((frame.devices[actor.deviceId]?:invalid()).capsule,device.readKeys().receiving,
            E2eeKeys.RootRecipient(scope.target.ownerId,scope.target.scopeId,frame.cryptoEpoch,frame.keyId,actor.deviceId)).also{current()}
        private fun legacy(scope:Scope,value:JSONObject,frame:E2eeDirectory.Verified){
            val secret=root(scope,frame);val own=frame.devices[actor.deviceId]?:invalid();val signer=E2eeDirectory.signingKey(own.signingKey)
            asSource(scope.target.scopeId){E2eeRetainedMigrationProof.legacyPlan(view,scope.target,value,frame,secret,options.inventory,::current)}
            values.add(scope.target,scope.resourceId,value.getString("migrationId"),value.getString("migrationId"),secret,signer,value.getJSONArray("plan"),value.getJSONArray("logical"),value.optJSONArray("local")?:JSONArray())
        }
        private fun modern(scope:Scope,value:JSONObject,frame:E2eeDirectory.Verified){
            val anchor=E2eeRetainedMigrationProof.anchor(value);if(anchor!=frame.checkpoint)invalid();val own=frame.devices[actor.deviceId]?:invalid();val paths=options.inventory.required(scope.target.kind).map{it.id}
            E2eeMigrationStage.validate(value.getJSONObject("source"),view,scope.target,paths)
            val owned=E2eeMigrationOwnership.validate(value.getJSONObject("ownership"),E2eeMigrationOwnership.Expected(value.getString("migrationId"),scope.target,actor,value.get("sourceHash") as? String,value.optJSONObject("lease"),anchor.hash,anchor.revision))
            if(owned.get("signer")!=own.signingKey||number(owned,"securityEpoch",1)!=frame.securityEpoch)invalid()
            val signer=E2eeRetainedMigrationProof.controls(value,frame,actor,::current);val preparation=owned.getJSONObject("sourceState");val original=state(preparation.getString("objectId"),scope.target)
            if(original.serial!=1L||original.hash!=preparation.get("hash")||number(original.value,"protocol")!=3L||original.value.get("phase")!="preparing"
                ||E2eeRetainedMigrationProof.anchor(original.value)!=anchor||!same(E2eeRetainedMigrationProof.binding(original.value),E2eeRetainedMigrationProof.binding(value)))invalid()
            claim("local-snapshot",preparation.getString("objectId"),scope.target.scopeId,"preparation")
            if(number(value,"protocol")==5L){val adopted=value.getJSONObject("adopted");val saved=state(adopted.getString("stateId"),scope.target)
                if(adopted.get("stateId")!="${value.getString("migrationId")}:adoption:${adopted.getJSONObject("reference").getString("attemptId")}"||saved.serial!=1L||saved.hash!=adopted.get("stateHash")||number(saved.value,"protocol")!=4L
                    ||E2eeRetainedMigrationProof.anchor(saved.value)!=anchor||saved.value.get("sourceHash")!=value.get("sourceHash")||!same(saved.value.getJSONObject("ownership"),owned)||!same(E2eeRetainedMigrationProof.binding(saved.value),E2eeRetainedMigrationProof.binding(value)))invalid()
                E2eeRetainedMigrationProof.controls(saved.value,frame,actor,::current);claim("local-snapshot",adopted.getString("stateId"),scope.target.scopeId,"adoption")
            }
            val read=originalRead(scope)
            val expectedOriginals=linkedMapOf<String,JSONObject>()
            for(entry in rows(owned.getJSONArray("originals"))){
                val lease=value.optJSONObject("lease")?:invalid();val registration=entry.getJSONObject("registration");val id=registration.getString("id")
                E2eeRemoteOriginal.authenticateRegistration(registration,entry.getJSONObject("packet"),signer,read,number(lease,"generation",1));current()
                if(expectedOriginals.put(id,entry)!=null)invalid()
            }
            val proofs=asSource(scope.target.scopeId){E2eeRemoteOriginal.verifyOriginals(read,expectedOriginals.keys){descriptor->
                val expected=expectedOriginals[descriptor.registration.id]?:invalid()
                if(!same(descriptor.registration.toJson(),expected.getJSONObject("registration")))invalid();current()
            }}.associateBy{it.id};current()
            for((id,entry)in expectedOriginals){
                val proof=proofs[id]
                if(proof==null){if(entry.has("completion")&&!entry.isNull("completion"))invalid()}
                else{
                    if(entry.has("completion")&&!entry.isNull("completion")){val expected=entry.getJSONObject("completion");if(!proof.complete||!same(expected,JSONObject().put("id",proof.id).put("manifestHash",proof.manifestHash).put("rawHash",proof.rawHash).put("size",proof.size)))invalid()}
                    originals.getOrPut(scope.target.scopeId){mutableSetOf()}.add(id)
                }
            }
            var adoptedFound=number(value,"protocol")!=5L
            if(number(owned,"protocol")==3L)for(plan in rows(owned.getJSONArray("plans"))){
                val context=E2eeEnvelope.Context.fromJson(plan.getJSONObject("context"));val ctx=context.toJson()
                if(number(ctx,"cryptoEpoch",1)!=frame.cryptoEpoch||number(ctx,"securityEpoch",1)!=frame.securityEpoch||ctx.get("keyId")!=frame.keyId||value.isNull("sourceHash"))invalid()
                val planRoot=root(scope,frame);val readPlan=E2eeContentPlan.ReadOptions(view,planRoot,signer,context,scope.target,value.getString("migrationId"),value.getString("sourceHash"),paths,options.inventory,::current)
                val completion=plan.optJSONObject("completion")?.let{E2eeContentPlan.Reference(it.getString("attemptId"),it.getString("manifestHash"))}
                val inspected=asSource(scope.target.scopeId){E2eeContentPlan.inspect(readPlan,plan.getString("attemptId"),completion)};current();inspected.metadataIds.forEach{claim("local-snapshot",it,scope.target.scopeId,"content-plan")}
                val retained=asSource(scope.target.scopeId){E2eeContentPlan.retainedValues(readPlan,plan.getString("attemptId"),completion)};current()
                values.add(scope.target,scope.resourceId,value.getString("migrationId"),plan.getString("attemptId"),planRoot,signer,retained.getJSONArray("plan"),retained.getJSONArray("logical"),retained.getJSONArray("local"))
                inspected.reference?.let{reference->val manifest=asSource(scope.target.scopeId){E2eeContentPlan.open(readPlan,reference).manifest}
                    if(number(value,"protocol")==5L&&plan.get("attemptId")==value.getJSONObject("adopted").getJSONObject("reference").get("attemptId")){
                        if(completion==null||completion!=reference||!same(value.getJSONArray("plan"),manifest.getJSONArray("plan"))||!same(value.getJSONArray("logical"),manifest.getJSONArray("logical"))||!same(value.getJSONArray("local"),manifest.getJSONArray("local")))invalid();adoptedFound=true
                    }
                }
            }
            if(!adoptedFound)invalid()
        }
        init {
            try{
                current();val ids=view.listLocal("local-snapshot","migration:");val currentStates=ids.associateWith{if(!stateIdPattern.matches(it))invalid();raw(it)}
                for(id in view.listLocal("key-check","directory-")){val saved=raw(id,"key-check").value;E2eeKeys.exact(saved,setOf("ownerId","pin","checkpoint","events"));val events=saved.getJSONArray("events");if(events.length()<1)invalid()
                    val scope=E2eeKeys.technical(events.getJSONObject(0).getJSONObject("command").getString("scopeId"));val owner=E2eeKeys.technical(saved.getString("ownerId"));if(id!="directory-"+hash(scope.toByteArray(Charsets.UTF_8))||directories.put(scope,id to owner)!=null)invalid()
                }
                for((scopeId,saved)in directories){
                    val id="migration:"+hash(scopeId.toByteArray(Charsets.UTF_8));val initial=currentStates[id];val rawRoot=initial?.value;val ancestorIds=rawRoot?.let{strings(it.getJSONArray("ancestors"))}?:emptyList();if(ancestorIds.size>32)invalid()
                    val rawAncestors=ancestorIds.map{raw(it)};val needed=(rawAncestors.map{E2eeRetainedMigrationProof.anchor(it.value).revision}+listOfNotNull(rawRoot?.let{E2eeRetainedMigrationProof.anchor(it).revision})).toSet();val retainedFrames=mutableMapOf<Long,E2eeDirectory.Verified>()
                    val latest=device.readSavedDirectory(scopeId){frame->if(frame.checkpoint.revision in needed)retainedFrames[frame.checkpoint.revision]=frame}?:invalid();current();if(latest.ownerId!=saved.second)invalid()
                    val target=E2eeSourceStage.Target(latest.ownerId,scopeId,latest.kind);val root=initial?.let{state(id,target)};val ancestors=ancestorIds.map{state(it,target).also{old->if(old.serial!=1L)invalid()}.value}
                    for((index,old)in ancestors.withIndex())if(old.get("phase")!="cancelled"||ancestorIds[index]!="${old.getString("migrationId")}:archive"||strings(old.getJSONArray("ancestors"))!=ancestorIds.take(index))invalid()
                    val scope=Scope(target,latest.resourceId,id,root?.value,ancestors,root?.serial,root?.hash);scopeRows[scopeId]=scope;claim("key-check",saved.first,scopeId,"directory");if(root!=null)claim("local-snapshot",id,scopeId,"current")
                    for(value in ancestors+listOfNotNull(root?.value)){
                        val migration=value.getString("migrationId");if(states.put(migration,scope to value)!=null)invalid();val anchor=E2eeRetainedMigrationProof.anchor(value);val frame=retainedFrames[anchor.revision]?:invalid()
                        if(frame.checkpoint!=anchor||frame.ownerId!=target.ownerId||frame.scopeId!=target.scopeId||frame.kind!=target.kind)invalid();frames[migration]=frame
                        E2eeRetainedMigrationProof.controls(value,frame,actor,::current)
                        if(value!==root?.value)claim("local-snapshot","$migration:archive",scopeId,"archive")
                        if(number(value,"protocol") in setOf(4L,5L))modern(scope,value,frame)else if(number(value,"protocol") in setOf(1L,2L))legacy(scope,value,frame)
                    }
                    asSource(scopeId){val stages=E2eeSourceStage.inspect(view,target,::current);current();if(root==null&&stages.isNotEmpty()){val own=latest.devices[actor.deviceId]?:invalid();if(own.revoked||own.role!="owner"||own.userId!=actor.ownerId)invalid()}
                        for(stage in stages){
                            // Custody of every sealed prefix part; this is
                            // deliberately not a complete logical source.
                            if(!stage.complete){if(E2eeSourceStage.authenticateInterrupted(view,target,stage.id,::current)!=options.inventory.required(target.kind).map{it.id})invalid();continue}
                            val opened=E2eeSourceStage.open(view,target,E2eeSourceStage.Reference(stage.id,stage.manifestHash?:invalid()),::current)
                            if(opened.paths!=options.inventory.required(target.kind).map{it.id})invalid();for(path in opened.paths)opened.openPath(path).use{stream->E2eeRetainedMigrationProof.drain(stream,::current);stream.assertComplete()}
                        }
                        for(value in ancestors+listOfNotNull(root?.value))if(number(value,"protocol")>=3L){val snapshot=value.getJSONObject("source");val refs=rows(snapshot.getJSONArray("history"))+snapshot.getJSONObject("reference");if(refs.size>stages.size||refs.indices.any{refs[it].get("stageId")!=stages[it].id||refs[it].get("manifestHash")!=stages[it].manifestHash})invalid()}
                    }
                    for(value in ancestors+listOfNotNull(root?.value))if(number(value,"protocol") in setOf(1L,2L))asSource(scopeId){
                        val reference=E2eeLegacySnapshotStream.Reference(value.getString("migrationId"),number(value,"snapshotSize",1).toInt(),number(value,"snapshotParts",1).toInt(),value.getString("snapshotHash"));val paths=options.inventory.required(target.kind).map{it.id}
                        val opened=E2eeLegacySnapshotStream.open(E2eeLegacySnapshotStream.Options(view,target,paths,reference,options.inventory,::current));try{for(path in paths)opened.openPath(path).use{stream->E2eeRetainedMigrationProof.drain(stream,::current);stream.assertComplete()}}finally{opened.close()}
                    }
                }
                if(scopeRows.values.count{it.root!=null}!=currentStates.size)invalid()
                copyIds=base.listMigrationHistoryCopies().sorted();sourceIds=base.listMigrationOriginalParts();outputIds=base.listMigrationPlanOutputs();stateRoles=base.listMigrationStateRoles();jobHistory=base.listProductJobHistory();controlHistory=base.listProductControlHistory();current()
                val personal=scopeRows.values.filter{it.target.kind=="personal"&&it.target.ownerId==actor.ownerId}.singleOrNull()?.target?.scopeId
                E2eeRetainedProductCustody.inspect(E2eeRetainedProductCustody.Options(device,view,options.inventory,outputIds.first,copyIds,jobHistory,controlHistory,personal,::current,
                    {domain,id->roles.containsKey(domain to id)},::claim,{scopeId,select->val expected=directories[scopeId]?:invalid();var found:E2eeDirectory.Verified?=null
                        val latest=device.readSavedDirectory(scopeId){if(select(it))found=it}?:invalid();current();if(latest.ownerId!=expected.second)invalid();found?:invalid()}))
                E2eeDeviceControlCustody.inspect(device,view,personal,::current,::claim)
                val counts=mutableMapOf<String,Int>()
                for(id in copyIds){if(roles["local-snapshot" to id]?.name in setOf("archive","product-job"))continue;val at=id.lastIndexOf(":cancel:");if(at<1)invalid();val migration=id.substring(0,at);val known=states[migration]?:invalid();if(!uuid.matches(id.substring(at+8)))invalid()
                    val raw=state(id,known.first.target);val value=raw.value;if(raw.serial!=1L||value.get("phase")=="active"||number(value,"protocol")!=number(known.second,"protocol")||!same(E2eeRetainedMigrationProof.binding(value),E2eeRetainedMigrationProof.binding(known.second)))invalid()
                    val frame=frames[migration]?:invalid();E2eeRetainedMigrationProof.controls(value,frame,actor,::current);if(number(value,"protocol") in setOf(4L,5L))modern(known.first,value,frame)else if(number(value,"protocol") in setOf(1L,2L))legacy(known.first,value,frame)
                    claim("local-snapshot",id,known.first.target.scopeId,"cancel-copy");counts[migration]=(counts[migration]?:0)+1
                }
                for((id,known)in states)if(known.second.get("phase")=="cancelled"&&number(known.second,"protocol") in setOf(1L,2L,3L)&&!counts.containsKey(id))invalid()
                for(scope in scopeRows.values)asSource(scope.target.scopeId){if(E2eeRemoteOriginal.listOriginals(originalRead(scope)).any{it.id !in (originals[scope.target.scopeId]?:emptySet())})invalid()}
                for(prefix in listOf("remote-original:","remote-original-catalog:","content-plan:","source-stage:","source-stage-catalog:"))for(id in view.listLocal("local-snapshot",prefix))if(!roles.containsKey("local-snapshot" to id))invalid()
                for(id in sourceIds+outputIds.second+stateRoles+jobHistory+controlHistory)if(!roles.containsKey("local-snapshot" to id))invalid();for(id in outputIds.first)if(!roles.containsKey("outbox" to id))invalid()
                options.admit(usage());assertUnchanged()
            }catch(error:Throwable){close();throw error}
        }
        fun usage():E2eeMigrationHistory.Admission {current();check(metadataBytes<=Int.MAX_VALUE){"E2EE_SOURCE_HISTORY_CAPACITY"};return E2eeMigrationHistory.Admission(totalBytes,records.size,metadataBytes.toInt(),scopeRows.size)}
        fun scope(id:String):Scope {current();val value=scopeRows[id]?:invalid();return Scope(value.target.copy(),value.resourceId,value.stateId,value.root?.let{JSONObject(it.toString())},value.ancestors.map{JSONObject(it.toString())},value.serial,value.hash)}
        fun contents():List<JSONObject>{current();return values.contents()}
        fun readContent(id:String,write:(ByteArray)->Unit):JSONObject {current();assertUnchanged();val metadata=values.read(id,write);assertUnchanged();current();return metadata}
        fun captureContents(visit: (JSONObject, ((ByteArray) -> Unit) -> JSONObject) -> Unit) {
            assertUnchanged()
            for (item in values.contents()) {
                current()
                val id = item.getString("id")
                var active = true
                try {
                    visit(item) { write ->
                        check(active) { "E2EE_MIGRATION_HISTORY_CLOSED" }
                        values.read(id, write)
                    }
                } finally {
                    active = false
                }
            }
            assertUnchanged()
            current()
        }
        fun assertUnchanged(){
            current();for(row in records.values){val actual=base.read(row.domain,row.id);try{current();if(actual==null||actual.serial!=row.serial||actual.bytes.size!=row.bytes||hash(actual.bytes)!=row.hash)error("E2EE_SOURCE_HISTORY_CHANGED")}finally{actual?.bytes?.fill(0)}}
            for((key,expected)in lists){val actual=base.listLocal(key.first,key.second).sorted();current();if(actual!=expected)error("E2EE_SOURCE_HISTORY_CHANGED")}
            if(base.listMigrationHistoryCopies().sorted()!=copyIds||base.listMigrationOriginalParts().sorted()!=sourceIds.sorted()||base.listMigrationStateRoles().sorted()!=stateRoles.sorted()
                ||base.listProductJobHistory().sorted()!=jobHistory.sorted()||base.listProductControlHistory().sorted()!=controlHistory.sorted())error("E2EE_SOURCE_HISTORY_CHANGED")
            val outputs=base.listMigrationPlanOutputs();current();if(outputs.first.sorted()!=outputIds.first.sorted()||outputs.second.sorted()!=outputIds.second.sorted())error("E2EE_SOURCE_HISTORY_CHANGED")
        }
        override fun close(){closed=true;values.close();records.clear();roles.clear();metadataRows.clear();lists.clear();scopeRows.clear();states.clear();frames.clear();originals.clear();directories.clear()}
        override fun toString()="E2eeMigrationOwnershipCatalogue.Handle([redacted])"
    }
}
