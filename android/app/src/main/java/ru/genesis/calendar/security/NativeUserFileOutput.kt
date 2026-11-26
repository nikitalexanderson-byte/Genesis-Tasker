package ru.genesis.calendar.security

import android.content.Context
import android.net.Uri
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import java.io.Closeable
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean

/** One explicit, unlocked, foreground plaintext output. No plaintext spool or
 * persisted URI/grant. The caller owns the source bytes; close cancels provider
 * IO and wipes that buffer, even if an account locks while a provider blocks. */
internal class NativeUserFileOutput(private val source:ByteArray,private val currentOwner:()->Unit):AutoCloseable{
    private val closed=AtomicBoolean();private val signal=CancellationSignal();private val resources=mutableSetOf<Closeable>()
    private val buffers=mutableSetOf<ByteArray>();private val started=SystemClock.elapsedRealtime();private val deadline=started+300000
    private val timer=Handler(Looper.getMainLooper());private val expiry=Runnable{close()}
    init{check(source.size<=16*1024*1024){"BACKUP_TOO_LARGE"};current();timer.postDelayed(expiry,300000)}
    fun current(){val now=SystemClock.elapsedRealtime();check(!closed.get()&&now>=started&&now<deadline){"E2EE_FILE_OUTPUT_EXPIRED"};currentOwner()}
    private fun <T:Closeable,R> tracked(resource:T,operation:(T)->R):R{
        synchronized(resources){if(closed.get()){resource.close();error("E2EE_FILE_OUTPUT_EXPIRED")};resources+=resource}
        try{current();return operation(resource).also{current()}}finally{synchronized(resources){resources.remove(resource)};runCatching{resource.close()}}
    }
    private fun scan(context:Context,uri:Uri,prefix:Boolean):Pair<Int,ByteArray>{
        current();val fd=context.contentResolver.openFileDescriptor(uri,"r",signal)?:error("FILE_READ_FAILED")
        return tracked(fd){descriptor->tracked(ParcelFileDescriptor.AutoCloseInputStream(descriptor)){input->
            val scratch=ByteArray(8192);synchronized(buffers){if(closed.get()){scratch.fill(0);error("E2EE_FILE_OUTPUT_EXPIRED")};buffers+=scratch}
            try{val hash=MessageDigest.getInstance("SHA-256");var offset=0
                while(true){current();val count=input.read(scratch);current();if(count<0)break;check(count>0&&count<=source.size-offset){"FILE_WRITE_FAILED"}
                    if(prefix)for(at in 0 until count)check(scratch[at]==source[offset+at]){"FILE_WRITE_FAILED"};hash.update(scratch,0,count);offset+=count;scratch.fill(0)
                };offset to hash.digest()
            }finally{scratch.fill(0);synchronized(buffers){buffers.remove(scratch)}}
        }}
    }
    fun write(context:Context,uri:Uri){
        current();check(uri.scheme=="content"&&uri.toString().length<=8192){"BACKUP_INVALID"}
        val existing=scan(context,uri,true);existing.second.fill(0);current()
        val fd=context.contentResolver.openFileDescriptor(uri,"wt",signal)?:error("FILE_WRITE_FAILED")
        tracked(fd){descriptor->tracked(ParcelFileDescriptor.AutoCloseOutputStream(descriptor)){output->var offset=0
            while(offset<source.size){current();val count=minOf(8192,source.size-offset);output.write(source,offset,count);offset+=count};output.flush();current()
        }}
        val expected=MessageDigest.getInstance("SHA-256").digest(source);val saved=scan(context,uri,false)
        try{current();check(saved.first==source.size&&MessageDigest.isEqual(expected,saved.second)){"FILE_WRITE_FAILED"}}finally{expected.fill(0);saved.second.fill(0)}
    }
    override fun close(){if(closed.compareAndSet(false,true)){
        timer.removeCallbacks(expiry);source.fill(0);synchronized(buffers){buffers.forEach{it.fill(0)};buffers.clear()}
        try{signal.cancel()}finally{val opened=synchronized(resources){resources.toList().also{resources.clear()}};opened.forEach{runCatching{it.close()}}}
    }}
    override fun toString()="NativeUserFileOutput([redacted])"
}
