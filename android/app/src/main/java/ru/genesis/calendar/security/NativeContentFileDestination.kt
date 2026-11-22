package ru.genesis.calendar.security

import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/** A picker carries only an encrypted-intent ID. It grants no vault read or
 * plaintext write. The unlocked product must explicitly complete a ready
 * destination with its own fresh account capability. Nothing is persisted. */
internal object NativeContentFileDestination{
    class State(val request:Request,val phase:String){override fun toString()="NativeContentFileDestination.State([redacted])"}
    class Request internal constructor(val owner:String,val intentId:String,private val ownerGuard:()->Unit):AutoCloseable{
        val id=UUID.randomUUID().toString();private val closed=AtomicBoolean();private val returned=AtomicBoolean()
        private val started=SystemClock.elapsedRealtime();private val deadline=started+120000
        private val timer=Handler(Looper.getMainLooper());private val expiry=Runnable{failed(this)}
        private val output=AtomicReference<AutoCloseable?>(null)
        private var selected:Uri?=null
        init{check(UUID.fromString(intentId).toString()==intentId&&started>=0&&started<=Long.MAX_VALUE-120000){"BACKUP_INVALID"};ownerGuard();timer.postDelayed(expiry,120000)}
        fun current(){val now=SystemClock.elapsedRealtime();check(!closed.get()&&now>=started&&now<deadline&&mutable.value?.request===this){"E2EE_FILE_DESTINATION_EXPIRED"};ownerGuard()}
        fun picking(){current();transition(this,"requested","picking")}
        fun returned(uri:Uri?){
            current();check(returned.compareAndSet(false,true)){"E2EE_FILE_DESTINATION_CHANGED"}
            if(uri==null){failed(this);return};check(uri.scheme=="content"&&uri.toString().length<=8192){"BACKUP_INVALID"}
            synchronized(this){current();selected=uri};transition(this,"picking","ready")
        }
        fun uri():Uri{synchronized(this){current();check(mutable.value?.phase in setOf("ready","io")){"E2EE_FILE_DESTINATION_CHANGED"};return requireNotNull(selected){"E2EE_FILE_DESTINATION_CHANGED"}}}
        fun attach(access:AutoCloseable){current();check(output.compareAndSet(null,access)){"E2EE_FILE_DESTINATION_BUSY"};try{current();transition(this,"ready","io")}catch(reason:Throwable){output.compareAndSet(access,null);access.close();throw reason}}
        fun detach(access:AutoCloseable){output.compareAndSet(access,null)}
        override fun close(){if(closed.compareAndSet(false,true)){timer.removeCallbacks(expiry);synchronized(this){selected=null};output.getAndSet(null)?.let{runCatching{it.close()}}}}
        override fun toString()="NativeContentFileDestination.Request([redacted])"
    }
    private val mutable=MutableStateFlow<State?>(null);val state=mutable.asStateFlow()
    @Synchronized private fun transition(request:Request,expected:String,next:String){check(mutable.value?.request===request&&mutable.value?.phase==expected){"E2EE_FILE_DESTINATION_CHANGED"};mutable.value=State(request,next)}
    fun prepare(owner:String,intentId:String,guard:()->Unit):Request{
        var created:Request?=null
        try{guard();val request=Request(owner,intentId,guard);created=request
            val old=synchronized(this){val prior=mutable.value;check(prior==null||prior.phase in setOf("ready","complete","failed")){"E2EE_FILE_DESTINATION_BUSY"};mutable.value=State(request,"requested");prior?.request}
            old?.close();return request
        }catch(reason:Throwable){created?.close();throw reason}
    }
    fun failed(request:Request){val close=synchronized(this){if(mutable.value?.request===request&&mutable.value?.phase!="complete"){mutable.value=State(request,"failed");true}else false};if(close)request.close()}
    fun complete(request:Request){synchronized(this){request.current();transition(request,"io","complete")};request.close()}
}
