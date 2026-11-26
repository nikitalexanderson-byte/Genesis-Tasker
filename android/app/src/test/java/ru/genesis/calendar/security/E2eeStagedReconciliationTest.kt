package ru.genesis.calendar.security

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancel
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.io.InputStream

class E2eeStagedReconciliationTest {
    private val inventory by lazy { val file=generateSequence(File(requireNotNull(System.getProperty("user.dir")))){it.parentFile}
        .map{File(it,"contracts/e2ee/private-paths-v1.json")}.first{it.isFile};E2eePrivatePaths(JSONObject(file.readText())) }
    private inner class Rig {
        val context=E2eeMigrationSourceContext("owner","project:streamed","migration-streamed",1,"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",2)
        val target=E2eeSourceStage.Target(context.ownerId,context.scopeId,"project");val paths=inventory.required("project")
        val sources=E2eeMigrationSources(context.ownerId,context.scopeId,"project",inventory);val calls=mutableListOf<String>();var live=true
        val current:()->Unit={check(live){"E2EE_ACCOUNT_CHANGED"}}
        fun history(id:String)=E2eeStagedHistory(id,target,paths.map{it.id}){path->calls+="open:$id:$path";var ended=false
            val stream=object:InputStream(){private var at=0;override fun read():Int=if(at++==0){if(id=="current")1 else 2}else{-1.also{ended=true}}}
            E2eeStagedPathReader(stream){check(ended){"E2EE_SOURCE_STAGE_EOF_REQUIRED"}}}
        var input=E2eeStagedSourceInput(history("current"),listOf(history("history")))
        fun register(replace:(suspend(E2eePrivatePaths.Path,E2eeReconciliationPathInput,List<E2eeReconciliationPathInput>,suspend(E2eeContentPlan.Record)->Unit)->Boolean)?=null){
            for(path in paths)sources.registerStagedReconciler(object:E2eeStagedPathReconciler{
                override val id=path.id
                override suspend fun reconcile(current:E2eeReconciliationPathInput,previous:List<E2eeReconciliationPathInput>,context:E2eeMigrationSourceContext,emit:suspend(E2eeContentPlan.Record)->Unit):Boolean {
                    if(replace?.invoke(path,current,previous,emit)==true)return true
                    var sum=read(current);for(source in previous)sum+=read(source);emit(record(path,sum));return true
                }
            })
        }
        fun record(path:E2eePrivatePaths.Path,value:Int=3,id:String=path.id)=E2eeContentPlan.Record("remote",path.domains.first(),id,1,byteArrayOf(value.toByte()).inputStream())
        suspend fun reconcile(sink:suspend(String,E2eeContentPlan.Record)->Unit={_,record->record.source.use{while(it.read()>=0){}}})=
            sources.reconcileStaged(input,context,sink,current)
    }
    private fun read(source:E2eeReconciliationPathInput):Int=source.open().use{reader->
        var sum=0;while(true){val next=reader.input.read();if(next<0)break;sum+=next};reader.assertComplete();assertEquals(-1,reader.input.read());reader.assertComplete();sum}
    private suspend fun refuses(code:String="E2EE_",body:suspend()->Unit):Throwable {
        try{body()}catch(error:Exception){assertTrue("Expected $code, got ${error.message}",error.message.orEmpty().contains(code));return error};error("Forbidden reconciliation accepted")
    }
    @Test fun everyCurrentAndHistoryPathAuthenticatesEofAndOutputsAreSequential()=runBlocking {
        val f=Rig();f.register();val values=mutableListOf<Int>();val coverage=f.reconcile{_,record->values+=record.source.use{it.read()}}
        assertEquals(f.paths.map{it.id to true},coverage);assertEquals(List(6){3},values);assertEquals(12,f.calls.size)
    }
    @Test fun fullRegistryAndHistoryBindingRefuseBeforeAnyInputOrOutput()=runBlocking {
        val f=Rig();var outputs=0;refuses{f.reconcile{_,_->outputs++}};assertTrue(f.calls.isEmpty());f.register()
        val original=f.input
        for(bad in listOf(E2eeStagedHistory("current",f.target.copy(ownerId="foreign"),f.paths.map{it.id},original.current.openPath),
            E2eeStagedHistory("current",f.target,f.paths.drop(1).map{it.id},original.current.openPath))){f.input=E2eeStagedSourceInput(bad,original.previous);refuses{f.reconcile{_,_->outputs++}}}
        f.input=E2eeStagedSourceInput(original.current,listOf(original.current));refuses{f.reconcile{_,_->outputs++}};assertEquals(0,outputs);assertTrue(f.calls.isEmpty())
    }
    @Test fun completeReconciliationPlanIsCapturedBeforeTheCallerCanObtainKeysOrALease()=runBlocking {
        val f=Rig();refuses("STAGED_RECONCILER_REQUIRED"){f.sources.stagedReconciliation()};assertTrue(f.calls.isEmpty());f.register()
        val runner=f.sources.stagedReconciliation();assertEquals(6,runner.run(f.input,f.context,{_,_->},f.current).size);assertEquals(12,f.calls.size)
    }
    @Test fun unsafeNumericLeaseAndExcessiveHistoriesRefuseBeforeReading()=runBlocking {
        val f=Rig();f.register()
        val unsafe=E2eeMigrationSourceContext(f.context.ownerId,f.context.scopeId,f.context.migrationId,Long.MAX_VALUE,f.context.sourceHash,2)
        refuses{f.sources.reconcileStaged(f.input,unsafe,{_,_->},f.current)}
        f.input=E2eeStagedSourceInput(f.input.current,List(96){f.history("history-$it")});refuses("HISTORY_INVALID"){f.reconcile()};assertTrue(f.calls.isEmpty())
    }
    @Test fun unopenedOrClosedPrefixesCannotBecomeCompleteHistory()=runBlocking {
        for(prefix in listOf(false,true)){val f=Rig();f.register{path,current,previous,_->if(path.id!=f.paths.first().id)false else{
            read(current);if(prefix)previous.first().open().use{assertEquals(2,it.input.read())};true}}
            refuses("EOF_REQUIRED"){f.reconcile()}}
    }
    @Test fun duplicateAndCaughtSinkErrorsPoisonTheReconciliation()=runBlocking {
        for(duplicate in listOf(false,true)){val f=Rig();var outputs=0
            f.register{path,current,previous,emit->if(path.id!=f.paths.first().id)false else{read(current);read(previous.first());
                if(duplicate){emit(f.record(path));refuses("INVALID_SOURCE_RESULT"){emit(f.record(path))}}else refuses("NO_SPACE"){emit(f.record(path))};true}}
            refuses(if(duplicate)"INVALID_SOURCE_RESULT" else "NO_SPACE"){f.reconcile{_,_->outputs++;if(!duplicate)error("E2EE_NO_SPACE")}}
            assertEquals(1,outputs)
        }
    }
    @Test fun concurrentOutputRefusesEvenIfTheAdapterCatchesIt()=runBlocking {
        val f=Rig();val scope=CoroutineScope(SupervisorJob()+Dispatchers.Default);val entered=CompletableDeferred<Unit>();val release=CompletableDeferred<Unit>();var outputs=0
        try{
            f.register{path,current,previous,emit->if(path.id!=f.paths.first().id)false else{
                read(current);read(previous.first());val first=scope.async(start=CoroutineStart.UNDISPATCHED){emit(f.record(path))};entered.await()
                refuses("OUTPUT_BUSY"){emit(f.record(path,id="second"))};release.complete(Unit);first.await();true}}
            refuses("OUTPUT_BUSY"){f.reconcile{_,_->outputs++;entered.complete(Unit);release.await()}};assertEquals(1,outputs)
        }finally{release.complete(Unit);scope.cancel()}
    }
    @Test fun unawaitedSinkMustSettleButCannotReturnCompleteCoverage()=runBlocking {
        val f=Rig();val scope=CoroutineScope(SupervisorJob()+Dispatchers.Default);val entered=CompletableDeferred<Unit>();val release=CompletableDeferred<Unit>();var settled=false
        try{
            f.register{path,current,previous,emit->if(path.id!=f.paths.first().id)false else{
                read(current);read(previous.first());scope.launch(start=CoroutineStart.UNDISPATCHED){emit(f.record(path))};entered.await();true}}
            val result=async(start=CoroutineStart.UNDISPATCHED){refuses("OUTPUT_NOT_AWAITED"){f.reconcile{_,_->entered.complete(Unit);release.await();settled=true}}}
            entered.await();assertFalse(settled);assertFalse(result.isCompleted);release.complete(Unit);result.await();assertTrue(settled)
        }finally{release.complete(Unit);scope.cancel()}
    }
    @Test fun failedAndCancelledReconciliationClosesEveryOriginalWithoutMaskingThePrimaryFailure()=runBlocking {
        for(cancelled in listOf(false,true)){val f=Rig();var closed=0;val entered=CompletableDeferred<Unit>();var observed:Throwable?=null
            fun history(id:String)=E2eeStagedHistory(id,f.target,f.paths.map{it.id}){E2eeStagedPathReader(object:InputStream(){override fun read()=1
                override fun close(){closed++;error("CLOSE_FAILED")}}){}}
            f.input=E2eeStagedSourceInput(history("current"),listOf(history("history")))
            f.register{path,current,previous,_->if(path.id!=f.paths.first().id)false else{
                assertEquals(1,current.open().input.read());assertEquals(1,previous.first().open().input.read());entered.complete(Unit)
                if(cancelled)awaitCancellation()else error("ORIGINAL_FAILURE")}}
            if(cancelled){val job=launch(start=CoroutineStart.UNDISPATCHED){try{f.reconcile()}catch(error:Throwable){observed=error;throw error}}
                entered.await();job.cancelAndJoin();assertTrue(observed is kotlinx.coroutines.CancellationException)
            }else refuses("ORIGINAL_FAILURE"){f.reconcile()}
            assertEquals(2,closed)
        }
    }
    @Test fun retirementInsideTheFactoryClosesItsReturnedCapabilityBeforeAnyByteEscapes()=runBlocking {
        val f=Rig();var closed=0;var reads=0;val original=f.input.current
        f.input=E2eeStagedSourceInput(E2eeStagedHistory(original.id,original.target,original.paths){f.live=false;E2eeStagedPathReader(object:InputStream(){override fun read():Int{reads++;return 9};override fun close(){closed++}}){}},f.input.previous)
        f.register();refuses("ACCOUNT_CHANGED"){f.reconcile()};assertEquals(0,reads);assertEquals(1,closed)
    }
    @Test fun explicitReaderClosureRevokesEvenAnEarlierEofReceipt()=runBlocking {
        val f=Rig();f.register{path,current,previous,_->if(path.id!=f.paths.first().id)false else{
            val reader=current.open();while(reader.input.read()>=0){};reader.assertComplete();reader.close();refuses("CLOSED"){reader.assertComplete()};read(previous.first());true}}
        assertEquals(6,f.reconcile().size)
    }
}
