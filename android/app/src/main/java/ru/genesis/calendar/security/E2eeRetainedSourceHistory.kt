package ru.genesis.calendar.security

import org.json.JSONArray
import org.json.JSONObject
import java.io.Closeable
import java.io.InputStream
import java.util.concurrent.atomic.AtomicBoolean

/** Exact source tuples obtained from the full authenticated ownership graph.
 * Plans/other scopes are authenticated by verify; no raw state is rewritten
 * into fabricated v3 JSON and no global inventory is filtered. */
internal object E2eeRetainedSourceHistory {
    class Scope(val target:E2eeSourceStage.Target,val stateId:String,val root:JSONObject,val ancestors:List<JSONObject>) {
        override fun toString()="E2eeRetainedSourceHistory.Scope([redacted])"
    }
    private fun bindings(scope:Scope)=JSONArray().put(scope.stateId).put(JSONObject().put("ownerId",scope.target.ownerId).put("scopeId",scope.target.scopeId).put("kind",scope.target.kind))
        .put(JSONArray((scope.ancestors+scope.root).map(E2eeRetainedMigrationProof::binding)))
    fun sameSources(left:Scope,right:Scope)=E2eeRetainedMigrationProof.same(bindings(left),bindings(right))
    class Handle(private val vault:E2eeSourceReadVault,inputScope:Scope,inventory:E2eePrivatePaths,private val guard:()->Unit,private val serial:()->Long,
        private val verify:()->E2eeMigrationHistory.Admission):Closeable {
        private val scope=Scope(inputScope.target.copy(),inputScope.stateId,JSONObject(inputScope.root.toString()),inputScope.ancestors.map{JSONObject(it.toString())})
        private val paths=inventory.required(scope.target.kind).map{it.id}
        private val closed=AtomicBoolean(false);private val failed=AtomicBoolean(false);private val checking=AtomicBoolean(false)
        private val active=mutableSetOf<Reader>();private val completed=mutableSetOf<String>();private val legacy=mutableListOf<E2eeLegacySnapshotStream.Handle>()
        private val sources=mutableListOf<E2eeStagedHistory>();val input:E2eeStagedSourceInput
        private fun current(){guard();vault.assertOpen();check(!closed.get()){"E2EE_SOURCE_HISTORY_CLOSED"}}
        private inner class Reader(private val id:String,private val path:String,private val factory:()->E2eeStagedPathReader):InputStream() {
            private var raw:E2eeStagedPathReader?=null;private var ended=false;private var retired=false;private val buffer=ByteArray(E2eeFiles.CHUNK_BYTES)
            @Synchronized override fun read():Int {val one=ByteArray(1);return try{if(read(one,0,1)<0)-1 else one[0].toInt()and 255}finally{one.fill(0)}}
            @Synchronized override fun read(out:ByteArray,offset:Int,length:Int):Int {
                require(offset>=0&&length>=0&&offset<=out.size-length);if(length==0){current();return 0}
                try{
                    current();check(!retired){"E2EE_SOURCE_HISTORY_CLOSED"};if(ended)return -1
                    val opened=raw?:factory().also{raw=it};current();val count=opened.input.read(buffer,0,minOf(buffer.size,length));current()
                    if(count<0){opened.assertComplete();current();ended=true;synchronized(completed){completed.add("$id\u0000$path")};return -1}
                    check(count>0){"E2EE_INVALID_SOURCE_STREAM"};buffer.copyInto(out,offset,0,count);return count
                }catch(error:Throwable){failed.set(true);out.fill(0,offset,offset+length);throw error}finally{buffer.fill(0)}
            }
            @Synchronized fun assertComplete(){current();check(ended&&!failed.get()){"E2EE_SOURCE_INPUT_EOF_REQUIRED"}}
            @Synchronized override fun close(){if(retired)return;retired=true;buffer.fill(0);try{raw?.input?.close()}finally{if(!ended)failed.set(true);synchronized(active){active.remove(this)}}}
        }
        private fun source(id:String,factory:(String)->E2eeStagedPathReader)=E2eeStagedHistory(id,scope.target.copy(),paths.toList()){path->
            current();check(path in paths){"E2EE_SOURCE_STAGE_PATH"}
            synchronized(active){if(checking.get()||active.isNotEmpty()){failed.set(true);error("E2EE_SOURCE_INPUT_BUSY")};val reader=Reader(id,path){factory(path)};active+=reader;E2eeStagedPathReader(reader,reader::assertComplete)}
        }
        init {
            try{
                current();check(E2eeCommands.integer(scope.root.get("protocol"))>=3){"E2EE_STAGED_SOURCE_REQUIRED"}
                val snapshot=E2eeMigrationStage.validate(scope.root.getJSONObject("source"),vault,scope.target,paths)
                for(state in scope.ancestors)if(E2eeCommands.integer(state.get("protocol")) in setOf(1L,2L)){
                    val reference=E2eeLegacySnapshotStream.Reference(state.getString("migrationId"),E2eeCommands.integer(state.get("snapshotSize"),1).toInt(),E2eeCommands.integer(state.get("snapshotParts"),1).toInt(),state.getString("snapshotHash"))
                    val opened=E2eeLegacySnapshotStream.open(E2eeLegacySnapshotStream.Options(vault,scope.target,paths,reference,inventory,::current));current();legacy+=opened
                    sources+=source("legacy:"+reference.migrationId){path->val reader=opened.openPath(path);E2eeStagedPathReader(reader,reader::assertComplete)}
                }
                val refs=E2eeRetainedMigrationProof.rows(snapshot.getJSONArray("history"))+snapshot.getJSONObject("reference")
                for(ref in refs){val reference=E2eeSourceStage.Reference(ref.getString("stageId"),ref.getString("manifestHash"));val opened=E2eeSourceStage.open(vault,scope.target,reference,::current);current();check(opened.paths==paths){"E2EE_SOURCE_HISTORY_INVALID"}
                    sources+=source("stage:"+reference.stageId){path->val reader=opened.openPath(path);E2eeStagedPathReader(reader,reader::assertComplete)}
                }
                check(sources.size in 1..96&&sources.map{it.id}.toSet().size==sources.size){"E2EE_SOURCE_HISTORY_LIMIT"}
                input=E2eeStagedSourceInput(sources.last(),sources.dropLast(1));assert(false)
            }catch(error:Throwable){try{close()}catch(cleanup:Throwable){if(cleanup!==error)error.addSuppressed(cleanup)};throw error}
        }
        private fun assert(complete:Boolean):E2eeMigrationHistory.Receipt {
            current();check(checking.compareAndSet(false,true)){"E2EE_SOURCE_INPUT_BUSY"}
            try{
                check(!failed.get()&&synchronized(active){active.isEmpty()}&&(!complete||synchronized(completed){sources.all{source->paths.all{"${source.id}\u0000$it" in completed}}})){"E2EE_SOURCE_INPUT_EOF_REQUIRED"}
                val totals=verify();current();return E2eeMigrationHistory.Receipt(scope.stateId,serial(),totals)
            }catch(error:Throwable){failed.set(true);throw error}finally{checking.set(false)}
        }
        fun assertMetadataUnchanged():E2eeMigrationHistory.Admission=assert(false).totals
        fun assertCompleteAndUnchanged():E2eeMigrationHistory.Receipt=assert(true)
        override fun close(){if(!closed.compareAndSet(false,true))return;var reason:Throwable?=null
            for(reader in synchronized(active){active.toList()})try{reader.close()}catch(error:Throwable){if(reason==null)reason=error else if(reason!==error)reason.addSuppressed(error)}
            for(reader in legacy)try{reader.close()}catch(error:Throwable){if(reason==null)reason=error else if(reason!==error)reason.addSuppressed(error)}
            reason?.let{throw it}
        }
        override fun toString()="E2eeRetainedSourceHistory.Handle([redacted])"
    }
}
