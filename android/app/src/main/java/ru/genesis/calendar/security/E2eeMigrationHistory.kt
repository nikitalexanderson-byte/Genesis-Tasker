package ru.genesis.calendar.security

import org.json.JSONObject
import java.io.Closeable
import java.io.InputStream
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean

/** Same-original-actor, read-only coordinator input. This grants no custody,
 * recovered identity, remote source, content-plan publication or transport. */
internal object E2eeMigrationHistory {
    data class Capacity(val maximumBytes:Long,val maximumParts:Int,val maximumMetadataBytes:Int)
    data class Admission(val bytes:Long,val parts:Int,val metadataBytes:Int,val sources:Int)
    class Options(val capacity:Capacity,val assertCurrent:()->Unit,val admit:(Admission)->Unit)
    data class Receipt(val stateId:String,val serial:Long,val totals:Admission)
    private data class Metadata(val id:String,val serial:Long,val hash:String)
    private data class State(val value:JSONObject,val serial:Long,val hash:String)
    private data class Binding(val protocol:Long,val migrationId:String,val ancestors:List<String>,val stages:List<E2eeSourceStage.Reference>?,val legacy:E2eeLegacySnapshotStream.Reference?)
    private fun invalid():Nothing=error("E2EE_SOURCE_HISTORY_INVALID")
    private fun hash(bytes:ByteArray)=E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(bytes))
    private fun refs(value:JSONObject):List<E2eeSourceStage.Reference> {
        val history=value.getJSONArray("history");return ((0 until history.length()).map{history.getJSONObject(it)}+value.getJSONObject("reference"))
            .map{E2eeSourceStage.Reference(it.getString("stageId"),it.getString("manifestHash"))}
    }
    private fun strings(value:JSONObject,name:String)=value.getJSONArray(name).let{list->(0 until list.length()).map{list.getString(it)}}
    fun open(vault:UnlockedE2eeVault,target:E2eeSourceStage.Target,required:List<String>,stateId:String,inventory:E2eePrivatePaths,
        decode:(ByteArray)->JSONObject,options:Options):Handle=Handle(vault,target.copy(),required.toList(),stateId,inventory,decode,options,vault::listMigrationOriginalParts,vault::listMigrationHistoryCopies)
    /** An exact, authenticated prepared-metadata view. No prefix filtering or
     * writer/signing capability is added to the old source reader. */
    fun openPrepared(vault:E2eeSourceReadVault,target:E2eeSourceStage.Target,required:List<String>,stateId:String,inventory:E2eePrivatePaths,
        decode:(ByteArray)->JSONObject,options:Options,originalParts:()->List<String>,historyCopies:()->List<String>,inspectContentPlans:((List<String>)->Admission)?=null):Handle=
        Handle(vault,target.copy(),required.toList(),stateId,inventory,decode,options,originalParts,historyCopies,inspectContentPlans)

    class Handle internal constructor(private val vault:E2eeSourceReadVault,private val target:E2eeSourceStage.Target,private val paths:List<String>,
        private val stateId:String,private val inventory:E2eePrivatePaths,private val decode:(ByteArray)->JSONObject,inputOptions:Options,
        private val originalParts:()->List<String>,private val historyCopies:()->List<String>,private val inspectContentPlans:((List<String>)->Admission)?=null):Closeable {
        private val capacity=inputOptions.capacity.copy();private val guard=inputOptions.assertCurrent;private val admit=inputOptions.admit
        private val closed=AtomicBoolean(false);private val failed=AtomicBoolean(false);private val checking=AtomicBoolean(false)
        private val active=mutableSetOf<Reader>();private val completed=mutableSetOf<String>();private val metadata=mutableListOf<Metadata>()
        private val legacy=mutableListOf<E2eeLegacySnapshotStream.Handle>();private val originals=mutableListOf<E2eeLegacySnapshotStream.Reference>()
        private val knownMigrations=mutableSetOf<String>()
        private var copies:List<String> = emptyList()
        private var metadataBytes=0;private val serial:Long;private val snapshot:JSONObject
        private val totals:Admission;val input:E2eeStagedSourceInput
        private var derived=Admission(0,0,0,0)
        private fun usage(base:Admission=totals):Admission {
            val value=Admission(base.bytes+derived.bytes,base.parts+derived.parts,base.metadataBytes+derived.metadataBytes,base.sources+derived.sources)
            check(value.bytes<=capacity.maximumBytes&&value.parts<=capacity.maximumParts&&value.metadataBytes<=capacity.maximumMetadataBytes&&value.sources<=96){"E2EE_SOURCE_HISTORY_CAPACITY"}
            return value
        }
        private fun current(){guard();vault.assertOpen();check(!closed.get()){"E2EE_SOURCE_HISTORY_CLOSED"}}
        private fun readState(id:String,remember:Boolean=true):State {
            current();E2eeKeys.technical(id);val row=vault.read("local-snapshot",id)?:invalid()
            try{
                current();if(row.serial<1||row.bytes.size !in 1..16*1024*1024)invalid()
                if(remember){metadataBytes+=row.bytes.size;check(metadataBytes<=capacity.maximumMetadataBytes){"E2EE_SOURCE_HISTORY_CAPACITY"}}
                E2eeFileManifestJson.readMigrationHistory(row.bytes)
                val state=decode(row.bytes);val digest=hash(row.bytes);current();if(remember)metadata+=Metadata(id,row.serial,digest)
                return State(state,row.serial,digest)
            }finally{row.bytes.fill(0)}
        }
        private fun inspectLegacy(){
            current();val expected=originals.flatMap{ref->(0 until ref.snapshotParts).map{"${ref.migrationId}:source:$it"}}.toSet()
            val ids=originalParts();current()
            check(ids.none{it !in expected}){"E2EE_SOURCE_HISTORY_REVIEW_REQUIRED"}
            val actualCopies=historyCopies().sorted();current();check(actualCopies==copies){"E2EE_SOURCE_HISTORY_CHANGED"}
            val plans=vault.listLocal("local-snapshot","content-plan:");current()
            if(inspectContentPlans==null)check(plans.isEmpty()){"E2EE_SOURCE_HISTORY_PLAN_REVIEW_REQUIRED"}
            else{derived=inspectContentPlans.invoke(plans);current();check(derived.bytes>=0&&derived.parts>=0&&derived.metadataBytes>=0&&derived.sources>=0){"E2EE_SOURCE_HISTORY_INVALID"}}
            for(id in knownMigrations){val uploads=vault.listLocal("outbox","$id:");current();val local=vault.listLocal("local-snapshot","$id:private:");current()
                check(uploads.isEmpty()&&local.isEmpty()){"E2EE_SOURCE_HISTORY_PLAN_REVIEW_REQUIRED"}}
        }
        private fun binding(state:JSONObject):Binding {
            val protocol=E2eeCommands.integer(state.get("protocol"));val migration=E2eeKeys.technical(state.getString("migrationId"))
            return if(protocol==3L)Binding(protocol,migration,strings(state,"ancestors"),refs(E2eeMigrationStage.validate(state.getJSONObject("source"),vault,target,paths)),null)
            else Binding(protocol,migration,strings(state,"ancestors"),null,E2eeLegacySnapshotStream.captureReference(E2eeLegacySnapshotStream.Reference(migration,
                E2eeCommands.integer(state.get("snapshotSize")).also{if(it>E2eeFiles.MAX_FILE_BYTES)invalid()}.toInt(),
                E2eeCommands.integer(state.get("snapshotParts")).also{if(it>256)invalid()}.toInt(),state.getString("snapshotHash"))))
        }
        private fun requireSourceOnly(state:JSONObject){
            check(!state.optBoolean("planned",false)&&state.getJSONArray("plan").length()==0&&state.getJSONArray("logical").length()==0&&(state.optJSONArray("local")?.length()?:0)==0
                &&listOf("sourceHash","lease","pending","resuming").all{state.isNull(it)}){"E2EE_SOURCE_HISTORY_PLAN_REVIEW_REQUIRED"}
        }
        init {
            try{
                current();check(capacity.maximumBytes in 1..9007199254740991L&&capacity.maximumParts in 1..10000&&capacity.maximumMetadataBytes in 1..128*1024*1024){"E2EE_SOURCE_HISTORY_CAPACITY"}
                check(paths==inventory.required(target.kind).map{it.id}){"E2EE_SOURCE_ADAPTER_REQUIRED"}
                if(stateId!="migration:"+hash(target.scopeId.toByteArray(Charsets.UTF_8)))invalid()
                val initial=readState(stateId);serial=initial.serial;val state=initial.value
                check(E2eeCommands.integer(state.get("protocol"))==3L&&state.get("phase")=="preparing"){"E2EE_STAGED_SOURCE_REQUIRED"}
                snapshot=E2eeMigrationStage.validate(state.getJSONObject("source"),vault,target,paths);val references=refs(snapshot)
                val seen=mutableSetOf(state.getString("migrationId"));val ancestors=strings(state,"ancestors");if(ancestors.size>32)invalid()
                val bindings=mutableMapOf(state.getString("migrationId") to binding(state))
                for(id in ancestors){E2eeKeys.technical(id);if(!id.endsWith(":archive"))invalid();E2eeKeys.technical(id.dropLast(8))}
                for((index,id)in ancestors.withIndex()){
                    val archive=readState(id);val old=archive.value;val migration=E2eeKeys.technical(old.getString("migrationId"))
                    if(archive.serial!=1L||id!="$migration:archive"||old.get("phase")!="cancelled"||!seen.add(migration)||strings(old,"ancestors")!=ancestors.take(index))invalid()
                    requireSourceOnly(old);bindings[migration]=binding(old)
                    if(E2eeCommands.integer(old.get("protocol"))==3L){
                        val declared=refs(E2eeMigrationStage.validate(old.getJSONObject("source"),vault,target,paths));val at=references.indexOfFirst{it.stageId==declared.last().stageId}
                        if(at<0||declared!=references.take(at+1))invalid()
                    }else originals+=E2eeLegacySnapshotStream.captureReference(E2eeLegacySnapshotStream.Reference(migration,
                        E2eeCommands.integer(old.get("snapshotSize")).also{if(it>E2eeFiles.MAX_FILE_BYTES)invalid()}.toInt(),
                        E2eeCommands.integer(old.get("snapshotParts")).also{if(it>256)invalid()}.toInt(),old.getString("snapshotHash")))
                }
                // Preflight all original metadata roles before any copy body.
                copies=historyCopies().sorted();current();val counts=mutableMapOf<String,Int>();val cancelled=mutableListOf<Pair<String,String>>()
                for(id in copies){
                    if(id in ancestors)continue
                    val at=id.lastIndexOf(":cancel:");if(at<1)error("E2EE_SOURCE_HISTORY_REVIEW_REQUIRED")
                    val migration=id.substring(0,at);val nonce=id.substring(at+8)
                    check(migration in bindings&&Regex("[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}").matches(nonce)){"E2EE_SOURCE_HISTORY_REVIEW_REQUIRED"}
                    cancelled+=id to migration;counts[migration]=(counts[migration]?:0)+1
                }
                check(ancestors.all{it.dropLast(8) in counts}){"E2EE_SOURCE_HISTORY_REVIEW_REQUIRED"}
                for((id,migration)in cancelled){val copy=readState(id);current();if(copy.serial!=1L||copy.value.get("phase")=="active"||binding(copy.value)!=bindings[migration])invalid();requireSourceOnly(copy.value)}
                knownMigrations+=seen;inspectLegacy();val stages=references.map{ref->ref to E2eeSourceStage.open(vault,target,ref,::current)}
                if(stages.any{it.second.paths!=paths})invalid()
                val bytes=originals.sumOf{it.snapshotSize.toLong()}+stages.sumOf{it.second.storageUsage.first}
                val parts=originals.sumOf{it.snapshotParts}+stages.sumOf{it.second.storageUsage.second}
                check(bytes<=capacity.maximumBytes&&parts<=capacity.maximumParts&&stages.size+originals.size<=96){"E2EE_SOURCE_HISTORY_CAPACITY"}
                totals=Admission(bytes,parts,metadataBytes,stages.size+originals.size);admit(usage());current()
                E2eeMigrationStage.verify(vault,snapshot,target,paths,::current);current()
                for(ref in originals){legacy+=E2eeLegacySnapshotStream.open(E2eeLegacySnapshotStream.Options(vault,target,paths,ref,inventory,::current));current()}
                val previous=mutableListOf<E2eeStagedHistory>()
                for((index,ref)in originals.withIndex())previous+=source("legacy:"+hash(ref.migrationId.toByteArray(Charsets.UTF_8))){path->
                    val raw=legacy[index].openPath(path);E2eeStagedPathReader(raw,raw::assertComplete)}
                for((ref,opened)in stages.dropLast(1))previous+=source("stage:${ref.stageId}"){path->val raw=opened.openPath(path);E2eeStagedPathReader(raw,raw::assertComplete)}
                val (last,opened)=stages.last();input=E2eeStagedSourceInput(source("stage:${last.stageId}"){path->val raw=opened.openPath(path);E2eeStagedPathReader(raw,raw::assertComplete)},previous.toList())
                verifyMetadata();inspectLegacy();current()
            }catch(error:Throwable){try{close()}catch(cleanup:Throwable){if(cleanup!==error)error.addSuppressed(cleanup)};throw error}
        }
        private fun source(id:String,factory:(String)->E2eeStagedPathReader)=E2eeStagedHistory(id,target.copy(),paths.toList()){path->
            current();check(path in paths){"E2EE_SOURCE_STAGE_PATH"}
            val reader=synchronized(active){
                if(checking.get()||active.isNotEmpty()){failed.set(true);error("E2EE_SOURCE_INPUT_BUSY")}
                Reader(id,path,factory).also{active+=it}
            };E2eeStagedPathReader(reader,reader::assertComplete)
        }
        private inner class Reader(private val sourceId:String,private val path:String,private val factory:(String)->E2eeStagedPathReader):InputStream() {
            private var raw:E2eeStagedPathReader?=null;private var ended=false;private var released=false;private val revoked=AtomicBoolean(false)
            private fun checkCurrent(){current();check(!revoked.get()){"E2EE_SOURCE_HISTORY_CLOSED"}}
            private fun release(){if(released)return;released=true;try{raw?.input?.close()}finally{if(!ended)failed.set(true);synchronized(active){active.remove(this)}}}
            override fun read():Int {val one=ByteArray(1);return try{if(read(one,0,1)<0)-1 else one[0].toInt()and 255}finally{one.fill(0)}}
            @Synchronized override fun read(output:ByteArray,offset:Int,length:Int):Int {
                require(offset>=0&&length>=0&&offset<=output.size-length);checkCurrent();if(length==0)return 0;if(ended)return -1;val maximum=minOf(length,E2eeFiles.CHUNK_BYTES)
                try{
                    val source=raw?:factory(path).also{raw=it};checkCurrent();val count=source.input.read(output,offset,maximum);checkCurrent()
                    if(count<0){source.assertComplete();checkCurrent();ended=true;synchronized(completed){completed+="$sourceId\u0000$path"};release();return -1}
                    check(count in 1..maximum){"E2EE_INVALID_SOURCE_STREAM"};return count
                }catch(error:Throwable){output.fill(0,offset,offset+maximum);failed.set(true);try{release()}catch(cleanup:Throwable){if(cleanup!==error)error.addSuppressed(cleanup)};throw error}
            }
            @Synchronized fun assertComplete(){checkCurrent();check(ended&&!failed.get()){"E2EE_SOURCE_INPUT_EOF_REQUIRED"}}
            override fun close(){revoked.set(true);synchronized(this){release()}}
        }
        private fun verifyMetadata(){for(expected in metadata){val actual=readState(expected.id,false);check(actual.serial==expected.serial&&actual.hash==expected.hash){"E2EE_SOURCE_HISTORY_CHANGED"}}}
        /** Metadata only, within this same checked history/fence. This does not
         * grant a new body/EOF proof or permission to skip any history role. */
        fun assertMetadataUnchanged():Admission {
            current();check(checking.compareAndSet(false,true)){"E2EE_SOURCE_INPUT_BUSY"}
            try{
                check(!failed.get()&&synchronized(active){active.isEmpty()}){"E2EE_SOURCE_INPUT_EOF_REQUIRED"}
                verifyMetadata();inspectLegacy()
                val references=refs(snapshot);val known=E2eeSourceStage.inspect(vault,target,::current);current()
                check(known.size==references.size&&known.indices.all{known[it].complete&&known[it].id==references[it].stageId&&known[it].manifestHash==references[it].manifestHash}){"E2EE_SOURCE_HISTORY_CHANGED"}
                val value=usage();admit(value);current();return value
            }catch(error:Throwable){failed.set(true);throw error}finally{checking.set(false)}
        }
        fun assertCompleteAndUnchanged():Receipt {
            current();check(checking.compareAndSet(false,true)){"E2EE_SOURCE_INPUT_BUSY"}
            try{
                check(!failed.get()&&synchronized(active){active.isEmpty()}&&(listOf(input.current)+input.previous).all{source->paths.all{path->synchronized(completed){"${source.id}\u0000$path" in completed}}}){"E2EE_SOURCE_INPUT_EOF_REQUIRED"}
                E2eeMigrationStage.verify(vault,snapshot,target,paths,::current);current()
                for(ref in originals){E2eeLegacySnapshotStream.open(E2eeLegacySnapshotStream.Options(vault,target,paths,ref,inventory,::current)).close();current()}
                inspectLegacy();verifyMetadata();val value=usage();admit(value);current();return Receipt(stateId,serial,value)
            }catch(error:Throwable){failed.set(true);throw error}finally{checking.set(false)}
        }
        override fun close(){
            closed.set(true);var failure:Throwable?=null
            for(source in legacy)try{source.close()}catch(error:Throwable){if(failure==null)failure=error else if(failure!==error)failure.addSuppressed(error)}
            for(reader in synchronized(active){active.toList()})try{reader.close()}catch(error:Throwable){if(failure==null)failure=error else if(failure!==error)failure.addSuppressed(error)}
            failure?.let{throw it}
        }
        override fun toString()="E2eeMigrationHistory.Handle([redacted])"
    }
}
