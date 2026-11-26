package ru.genesis.calendar.security

import android.content.Context
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import java.io.Closeable
import java.io.InputStream
import java.io.OutputStream
import java.util.concurrent.atomic.AtomicBoolean

/** A bounded foreground capability for one selected backup URI. No vault,
 * recovery key or plaintext is retained by the persisted handoff. Closing this
 * capability cancels provider opens, closes live streams and clears owned bytes. */
internal class NativeBackupFileAccess(val job:PrivateBackupHandoff.Job,private val assertOwner:()->Unit):AutoCloseable{
    private val closed=AtomicBoolean(false);private val signal=CancellationSignal()
    private val createdAt=SystemClock.elapsedRealtime();private val deadline=createdAt+LIFETIME_MILLIS
    private val resources=mutableSetOf<Closeable>();private val buffers=mutableSetOf<ByteArray>()
    private val timer=Handler(Looper.getMainLooper());private val expiry=Runnable{close()}
    init{check(createdAt>=0&&createdAt<=Long.MAX_VALUE-LIFETIME_MILLIS){"BACKUP_HANDOFF_CHANGED"};current();timer.postDelayed(expiry,LIFETIME_MILLIS)}
    fun current(){
        val now=SystemClock.elapsedRealtime()
        check(!closed.get()&&now>=createdAt&&now<deadline){"BACKUP_HANDOFF_EXPIRED"};assertOwner()
        PrivateBackupHandoff.requireCurrent(job)
    }
    fun remainingMillis()=(deadline-SystemClock.elapsedRealtime()).coerceAtLeast(0)
    private fun <T:Closeable,R> tracked(resource:T,operation:(T)->R):R{
        synchronized(resources){if(closed.get()){resource.close();error("BACKUP_HANDOFF_CHANGED")};resources+=resource}
        try{current();return operation(resource).also{current()}}
        finally{synchronized(resources){resources.remove(resource)};runCatching{resource.close()}}
    }
    fun <T> buffer(size:Int,operation:(ByteArray)->T):T{
        current();check(size in 1..ru.genesis.calendar.data.GenesisBackupContainer.MAX_FILE+1){"BACKUP_TOO_LARGE"}
        val bytes=ByteArray(size)
        synchronized(buffers){if(closed.get()){bytes.fill(0);error("BACKUP_HANDOFF_CHANGED")};buffers+=bytes}
        try{current();return operation(bytes).also{current()}}
        finally{bytes.fill(0);synchronized(buffers){buffers.remove(bytes)}}
    }
    fun <T> local(input:InputStream,operation:(InputStream)->T)=tracked(input,operation)
    fun <T> input(context:Context,operation:(InputStream)->T):T{
        current();val uri=android.net.Uri.parse(requireNotNull(job.uri){"BACKUP_HANDOFF_CHANGED"})
        val descriptor=context.contentResolver.openFileDescriptor(uri,"r",signal)?:error("BACKUP_HANDOFF_UNVERIFIED")
        return tracked(descriptor){opened->tracked(ParcelFileDescriptor.AutoCloseInputStream(opened),operation)}
    }
    fun <T> output(context:Context,operation:(OutputStream)->T):T{
        current();check(job.kind=="export"&&job.phase=="writing"){"BACKUP_HANDOFF_CHANGED"}
        val uri=android.net.Uri.parse(requireNotNull(job.uri){"BACKUP_HANDOFF_CHANGED"})
        val descriptor=context.contentResolver.openFileDescriptor(uri,"wt",signal)?:error("BACKUP_HANDOFF_UNVERIFIED")
        return tracked(descriptor){opened->tracked(ParcelFileDescriptor.AutoCloseOutputStream(opened),operation)}
    }
    /** The callback must consume only the declared prefix; the backing array is
     * wiped on completion/background. No plaintext/provider spool is created. */
    fun <T> read(context:Context,maximum:Int,consume:(ByteArray,Int)->T):T{
        check(maximum in 1..ru.genesis.calendar.data.GenesisBackupContainer.MAX_FILE){"BACKUP_TOO_LARGE"}
        current();var bytes=ByteArray(minOf(maximum+1,65536))
        synchronized(buffers){if(closed.get()){bytes.fill(0);error("BACKUP_HANDOFF_CHANGED")};buffers+=bytes}
        try{return input(context){input->var size=0
            while(true){current()
                if(size==bytes.size){check(size<=maximum){"BACKUP_TOO_LARGE"};val next=ByteArray(minOf(maximum+1,bytes.size*2))
                    synchronized(buffers){if(closed.get()){next.fill(0);error("BACKUP_HANDOFF_CHANGED")};buffers+=next;bytes.copyInto(next);bytes.fill(0);buffers.remove(bytes);bytes=next}}
                val count=input.read(bytes,size,minOf(8192,bytes.size-size));current();if(count<0)break;check(count>0){"BACKUP_HANDOFF_UNVERIFIED"};size+=count;check(size<=maximum){"BACKUP_TOO_LARGE"}
            };check(size>0){"BACKUP_HANDOFF_UNVERIFIED"};current();consume(bytes,size).also{current()}
        }}finally{bytes.fill(0);synchronized(buffers){buffers.remove(bytes)}}
    }
    override fun close(){if(closed.compareAndSet(false,true)){
        timer.removeCallbacks(expiry)
        try{signal.cancel()}finally{
            val opened=synchronized(resources){resources.toList().also{resources.clear()}}
            opened.forEach{runCatching{it.close()}}
            synchronized(buffers){buffers.forEach{it.fill(0)};buffers.clear()}
        }
    }}
    override fun toString()="NativeBackupFileAccess([redacted])"
    companion object{const val LIFETIME_MILLIS=300_000L}
}

/** One exact two-minute system picker invocation, separate from the longer
 * admitted file IO. Process death cannot reconstitute this transient authority. */
internal class NativeBackupPicker(val job:PrivateBackupHandoff.Job,private val assertOwner:()->Unit):AutoCloseable{
    private val closed=AtomicBoolean(false);private val returned=AtomicBoolean(false)
    private val createdAt=SystemClock.elapsedRealtime();private val deadline=createdAt+LIFETIME_MILLIS
    val waiting get()=!closed.get()&&!returned.get()
    init{check(createdAt>=0&&createdAt<=Long.MAX_VALUE-LIFETIME_MILLIS){"BACKUP_HANDOFF_CHANGED"};current()}
    fun remainingMillis()=(deadline-SystemClock.elapsedRealtime()).coerceAtLeast(0)
    fun current(){val now=SystemClock.elapsedRealtime();check(!closed.get()&&now>=createdAt&&now<deadline){"BACKUP_HANDOFF_EXPIRED"};assertOwner()}
    fun returned():Boolean=returned.compareAndSet(false,true)
    fun claim(){current();check(returned.get()&&PrivateBackupHandoff.isPicking(job)){"BACKUP_HANDOFF_CHANGED"}}
    override fun close(){closed.set(true)}
    override fun toString()="NativeBackupPicker([redacted])"
    companion object{const val LIFETIME_MILLIS=120_000L}
}
