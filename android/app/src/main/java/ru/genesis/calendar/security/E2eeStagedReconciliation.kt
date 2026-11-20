package ru.genesis.calendar.security

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import java.io.Closeable
import java.io.InputStream
import java.util.concurrent.atomic.AtomicBoolean

internal class E2eeStagedPathReader(val input:InputStream,val assertComplete:()->Unit)
internal class E2eeStagedHistory(val id:String,val target:E2eeSourceStage.Target,val paths:List<String>,val openPath:(String)->E2eeStagedPathReader)
internal class E2eeStagedSourceInput(val current:E2eeStagedHistory,val previous:List<E2eeStagedHistory>)
internal class E2eeReconciliationPathInput(val sourceId:String,val open:()->Reader) {
    interface Reader:Closeable {val input:InputStream;fun assertComplete()}
    override fun toString()="E2eeReconciliationPathInput([redacted])"
}
internal interface E2eeStagedPathReconciler {
    val id:String
    suspend fun reconcile(current:E2eeReconciliationPathInput,previous:List<E2eeReconciliationPathInput>,context:E2eeMigrationSourceContext,
        emit:suspend(E2eeContentPlan.Record)->Unit):Boolean
}
internal fun interface E2eeStagedReconciliationPlan {
    suspend fun run(input:E2eeStagedSourceInput,context:E2eeMigrationSourceContext,emit:suspend(String,E2eeContentPlan.Record)->Unit,assertCurrent:()->Unit):List<Pair<String,Boolean>>
}

/** Sequential semantic output into a caller's protected quarantine. Factories
 * must come from authenticated complete coordinator history/custody; this layer
 * cannot discover omitted originals, grant authority or activate migration. */
internal object E2eeStagedReconciliation {
    private class Tracked(sourceId:String,private val factory:()->E2eeStagedPathReader,private val guard:()->Unit) {
        private val closed=AtomicBoolean(false);private val complete=AtomicBoolean(false);private val failed=AtomicBoolean(false)
        private val readers=mutableSetOf<Reader>()
        val input=E2eeReconciliationPathInput(sourceId,::open)
        private fun current(){guard();check(!closed.get()){"E2EE_STAGED_RECONCILIATION_CLOSED"}}
        private fun open():Reader {current();return synchronized(readers){current();check(readers.isEmpty()){"E2EE_SOURCE_INPUT_BUSY"};Reader().also{readers+=it}}}
        fun assertComplete(){current();check(complete.get()&&!failed.get()&&synchronized(readers){readers.isEmpty()}){"E2EE_SOURCE_INPUT_EOF_REQUIRED"}}
        fun close(){closed.set(true);val active=synchronized(readers){readers.toList()};closeAll(active)}
        private inner class Reader:InputStream(),E2eeReconciliationPathInput.Reader {
            private var raw:E2eeStagedPathReader?=null;private var ended=false;private var released=false;private val revoked=AtomicBoolean(false)
            override val input:InputStream get()=this
            private fun checkCurrent(){current();check(!revoked.get()){"E2EE_STAGED_RECONCILIATION_CLOSED"}}
            private fun release(){if(!released){released=true;try{raw?.input?.close()}finally{if(!ended)failed.set(true);synchronized(readers){readers.remove(this)}}}}
            override fun read():Int {val one=ByteArray(1);return try{if(read(one,0,1)<0)-1 else one[0].toInt() and 255}finally{one.fill(0)}}
            @Synchronized override fun read(output:ByteArray,offset:Int,length:Int):Int {
                require(offset>=0&&length>=0&&offset<=output.size-length);checkCurrent();if(length==0)return 0;if(ended)return -1
                val requested=minOf(length,E2eeFiles.CHUNK_BYTES)
                try{
                    val source=raw?:factory().also{raw=it};checkCurrent();val count=source.input.read(output,offset,requested);checkCurrent()
                    if(count<0){source.assertComplete();checkCurrent();ended=true;complete.set(true);release();return -1}
                    check(count in 1..requested){"E2EE_INVALID_SOURCE_STREAM"};return count
                }catch(error:Throwable){output.fill(0,offset,offset+requested);failed.set(true);try{release()}catch(cleanup:Throwable){if(cleanup!==error)error.addSuppressed(cleanup)};throw error}
            }
            @Synchronized override fun assertComplete(){checkCurrent();check(ended&&!failed.get()){"E2EE_SOURCE_INPUT_EOF_REQUIRED"}}
            override fun close(){revoked.set(true);synchronized(this){release()}}
        }
    }
    private fun closeAll(readers:List<Closeable>){
        var failure:Throwable?=null
        for(reader in readers)try{reader.close()}catch(error:Throwable){if(failure==null)failure=error else if(failure!==error)failure.addSuppressed(error)}
        failure?.let{throw it}
    }
    suspend fun run(ownerId:String,scopeId:String,kind:String,inventory:List<E2eePrivatePaths.Path>,registered:Map<String,E2eeStagedPathReconciler>,
        input:E2eeStagedSourceInput,lease:E2eeMigrationSourceContext,emit:suspend(String,E2eeContentPlan.Record)->Unit,assertCurrent:()->Unit):List<Pair<String,Boolean>> {
        assertCurrent();check(lease.ownerId==ownerId&&lease.scopeId==scopeId&&lease.fence>0&&lease.generation>0){"E2EE_SCOPE_BINDING_MISMATCH"}
        E2eeCommands.integer(lease.fence,1);E2eeCommands.integer(lease.generation,1);check(input.previous.size<=95){"E2EE_SOURCE_HISTORY_INVALID"}
        E2eeKeys.technical(lease.migrationId);E2eeEnvelope.decode(lease.sourceHash,32)
        val context=E2eeMigrationSourceContext(lease.ownerId,lease.scopeId,lease.migrationId,lease.fence,lease.sourceHash,lease.generation)
        val paths=inventory.map{E2eePrivatePaths.Path(it.id,it.scope,it.domains.toSet())}
        val sources=(listOf(input.current)+input.previous).map{E2eeStagedHistory(it.id,it.target.copy(),it.paths.toList(),it.openPath)}
        check(sources.size in 1..96&&sources.map{it.id}.toSet().size==sources.size){"E2EE_SOURCE_HISTORY_INVALID"}
        for(source in sources){E2eeKeys.technical(source.id);check(source.target.ownerId==ownerId&&source.target.scopeId==scopeId&&source.target.kind==kind&&source.paths==paths.map{it.id}){"E2EE_SCOPE_BINDING_MISMATCH"}}
        // Capture every callback before the first source or sink await.
        val adapters=paths.map{path->val adapter=registered[path.id]?:error("E2EE_STAGED_RECONCILER_REQUIRED");path to adapter::reconcile}
        val coverage=mutableListOf<Pair<String,Boolean>>();val seen=mutableSetOf<String>();var records=0
        for((path,reconcile)in adapters){
            assertCurrent();val tracked=sources.map{source->Tracked(source.id,{source.openPath(path.id)},assertCurrent)}
            val gate=Any();var active=true;var pending:CompletableDeferred<Unit>?=null;var failure:Throwable?=null
            val sink:suspend(E2eeContentPlan.Record)->Unit={record->
                val completion=synchronized(gate){
                    try{assertCurrent();check(active){"E2EE_STAGED_RECONCILIATION_CLOSED"};check(pending?.isCompleted!=false){"E2EE_SOURCE_OUTPUT_BUSY"}
                        E2eeKeys.technical(record.objectId);check(record.domain in path.domains&&record.placement in setOf("remote","local")&&record.size in 0..E2eeFiles.MAX_FILE_BYTES
                        &&(record.domain!="shared-comment"||record.size<=65536)&&seen.add(record.domain+"\u0000"+record.objectId)&&++records<=10000){"E2EE_INVALID_SOURCE_RESULT"}}
                    catch(error:Throwable){if(failure==null)failure=error;throw error}
                    CompletableDeferred<Unit>().also{pending=it}
                }
                try{emit(path.id,record);assertCurrent()}catch(error:Throwable){synchronized(gate){if(failure==null)failure=error};throw error}
                finally{synchronized(gate){completion.complete(Unit)}}
            }
            var rejected:Throwable?=null
            try{
                val complete=reconcile(tracked.first().input,tracked.drop(1).map{it.input},context,sink);assertCurrent()
                val (leaked,last)=synchronized(gate){active=false;(pending?.isCompleted==false) to pending}
                last?.await();if(leaked)error("E2EE_SOURCE_OUTPUT_NOT_AWAITED");synchronized(gate){failure}?.let{throw it}
                check(complete){"E2EE_INCOMPLETE_COVERAGE"};tracked.forEach{it.assertComplete()};coverage+=path.id to true
            }catch(error:Throwable){rejected=error;throw error}
            finally{
                val last=synchronized(gate){active=false;pending}
                withContext(NonCancellable){
                    var cleanup:Throwable?=null
                    try{last?.await()}catch(error:Throwable){cleanup=error}
                    for(source in tracked)try{source.close()}catch(error:Throwable){if(cleanup==null)cleanup=error else if(cleanup!==error)cleanup.addSuppressed(error)}
                    cleanup?.let{error->if(rejected==null)throw error else if(rejected!==error)rejected.addSuppressed(error)}
                }
            }
        }
        assertCurrent();return coverage
    }
}
