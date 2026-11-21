package ru.genesis.calendar.security

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import java.io.InputStream

/** Local bounded input/output loans. All operations, including calls made from
 * another thread, are revoked and drained before the whole-job fence ends. */
internal class E2eeContentPlanningSession(val sources:E2eeStagedSourceInput,originals:List<E2eeStreamedPlanningOriginal>,
    private val guard:()->Unit,
    private val read:(String,(InputStream)->Unit,()->Unit)->Unit,
    private val write:(String,E2eeContentPlan.Record,()->Unit)->Unit) {
    val originals:List<E2eeStreamedPlanningOriginal> = java.util.Collections.unmodifiableList(originals.toList())
    private val gate=Any();private var live=true;private var accepting=true;private var reading=false;private var writing=false
    private var pending=0;private var failure:Throwable?=null;private var drained:CompletableDeferred<Unit>?=null
    fun assertCurrent(){guard();synchronized(gate){check(live){"E2EE_CONTENT_SESSION_CLOSED"}}}
    private fun borrow(role:String,operation:()->Unit){
        var entered=false
        try{
            assertCurrent();synchronized(gate){
                check(accepting){"E2EE_CONTENT_SESSION_CLOSED"}
                check(if(role=="read")!reading else !writing){"E2EE_CONTENT_SESSION_BUSY"}
                if(role=="read")reading=true else writing=true;pending++;entered=true
            };operation();assertCurrent()
        }catch(error:Throwable){synchronized(gate){if(failure==null)failure=error};throw error}
        finally{if(entered)synchronized(gate){if(role=="read")reading=false else writing=false;pending--;if(pending==0)drained?.complete(Unit)}}
    }
    fun withOriginal(id:String,consume:(InputStream)->Unit)=borrow("read"){read(id,consume,::assertCurrent)}
    fun emit(path:String,record:E2eeContentPlan.Record)=borrow("write"){write(path,record,::assertCurrent)}
    fun finishInput(){
        assertCurrent();synchronized(gate){accepting=false;check(pending==0){"E2EE_CONTENT_SESSION_NOT_AWAITED"};failure?.let{throw it}}
    }
    suspend fun closeAndDrain(){
        val wait=synchronized(gate){accepting=false;live=false;if(pending==0)null else CompletableDeferred<Unit>().also{drained=it}}
        if(wait!=null)withContext(NonCancellable){wait.await()}
    }
    override fun toString()="E2eeContentPlanningSession([redacted])"
}
