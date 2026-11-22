package ru.genesis.calendar.security

import android.content.Context
import android.net.Uri
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONObject
import java.io.Closeable
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/** Transient handoff of an ALREADY encrypted independent message-key file.
 * No password, private key, vault capability or provider URI is persisted.
 * Process death/expiry requires a new explicit picker; original keys/files stay. */
internal object NativeMessageKeyTransfer{
    class State(val request:Request,val phase:String){override fun toString()="NativeMessageKeyTransfer.State([redacted])"}
    private val mutable=MutableStateFlow<State?>(null);val state=mutable.asStateFlow()
    private const val MAXIMUM=16384
    class Request internal constructor(val owner:String,val kind:String,source:ByteArray?,private val ownerGuard:()->Unit):AutoCloseable{
        val id=UUID.randomUUID().toString();private val closed=AtomicBoolean();private val returned=AtomicBoolean()
        private val bytes=AtomicReference(source);private val signal=CancellationSignal();private val resources=mutableSetOf<Closeable>()
        private val buffers=mutableSetOf<ByteArray>()
        private val started=SystemClock.elapsedRealtime();private val deadline=started+120000
        private val handler=Handler(Looper.getMainLooper());private val expiry=Runnable{failed(this)}
        init{ownerGuard();check(started>=0&&started<=Long.MAX_VALUE-120000){"MESSAGING_FILE_EXPIRED"};handler.postDelayed(expiry,120000)}
        fun current(){val now=SystemClock.elapsedRealtime();check(!closed.get()&&now>=started&&now<deadline&&mutable.value?.request===this){"MESSAGING_FILE_EXPIRED"};ownerGuard()}
        fun remainingMillis()=(deadline-SystemClock.elapsedRealtime()).coerceAtLeast(0)
        fun picking(){current();transition(this,"requested","picking")}
        fun returned():Boolean{current();return returned.compareAndSet(false,true)}
        fun encryptedSource(foreground:()->Unit):String{current();foreground();check(kind=="import"&&mutable.value?.phase=="ready"){"MESSAGING_FILE_CHANGED"};return requireNotNull(bytes.get()).toString(Charsets.UTF_8).also{current();foreground()}}
        private fun <T:Closeable,R> tracked(resource:T,operation:(T)->R):R{
            synchronized(resources){if(closed.get()){resource.close();error("MESSAGING_FILE_CHANGED")};resources+=resource}
            try{current();return operation(resource).also{current()}}finally{synchronized(resources){resources.remove(resource)};runCatching{resource.close()}}
        }
        private fun read(context:Context,uri:Uri,foreground:()->Unit):ByteArray{
            current();foreground();val descriptor=context.contentResolver.openFileDescriptor(uri,"r",signal)?:error("FILE_READ_FAILED")
            return tracked(descriptor){fd->tracked(ParcelFileDescriptor.AutoCloseInputStream(fd)){input->
                val held=ByteArray(MAXIMUM+1);synchronized(buffers){if(closed.get()){held.fill(0);error("MESSAGING_FILE_CHANGED")};buffers+=held};try{var count=0
                    while(count<held.size){current();foreground();val next=input.read(held,count,minOf(4096,held.size-count));current();foreground();if(next<0)break;check(next>0){"FILE_READ_FAILED"};count+=next}
                    check(count<=MAXIMUM){"INVALID_BACKUP"};held.copyOf(count).also{copy->synchronized(buffers){if(closed.get()){copy.fill(0);error("MESSAGING_FILE_CHANGED")};buffers+=copy}}
                }finally{held.fill(0);synchronized(buffers){buffers.remove(held)}}
            }}
        }
        fun deliver(context:Context,uri:Uri,foreground:()->Unit){
            current();foreground();check(uri.scheme=="content"&&uri.toString().length<=8192){"MESSAGING_FILE_CHANGED"};transition(this,"picking","io")
            if(kind=="import"){
                val copied=read(context,uri,foreground);var retained=false
                try{check(copied.isNotEmpty()){ "INVALID_BACKUP" };validate(copied,false);current();foreground();check(bytes.compareAndSet(null,copied)){"MESSAGING_FILE_CHANGED"};retained=true;transition(this,"io","ready")}
                finally{if(!retained)copied.fill(0);synchronized(buffers){buffers.remove(copied)}}
            }else{
                val source=requireNotNull(bytes.get());val prefix=read(context,uri,foreground)
                try{check(prefix.size<=source.size&&prefix.indices.all{prefix[it]==source[it]}){"FILE_WRITE_FAILED"}}finally{prefix.fill(0);synchronized(buffers){buffers.remove(prefix)}}
                current();foreground();val descriptor=context.contentResolver.openFileDescriptor(uri,"wt",signal)?:error("FILE_WRITE_FAILED")
                tracked(descriptor){fd->tracked(ParcelFileDescriptor.AutoCloseOutputStream(fd)){output->var at=0
                    while(at<source.size){current();foreground();val count=minOf(4096,source.size-at);output.write(source,at,count);at+=count};output.flush();current();foreground()
                }}
                val copy=read(context,uri,foreground);try{check(copy.contentEquals(source)){"FILE_WRITE_FAILED"};current();foreground();transition(this,"io","complete");close()}finally{copy.fill(0);synchronized(buffers){buffers.remove(copy)}}
            }
        }
        override fun close(){if(closed.compareAndSet(false,true)){
            handler.removeCallbacks(expiry);bytes.getAndSet(null)?.fill(0)
            synchronized(buffers){buffers.forEach{it.fill(0)};buffers.clear()}
            try{signal.cancel()}finally{val active=synchronized(resources){resources.toList().also{resources.clear()}};active.forEach{runCatching{it.close()}}}
        }}
        override fun toString()="NativeMessageKeyTransfer.Request([redacted])"
    }
    private fun validate(source:ByteArray,export:Boolean){
        check(source.size in 1..MAXIMUM){"INVALID_BACKUP"};val value=E2eeFileManifestJson.readPrivateDocument(source)
        check(value.opt("format")=="genesis-messaging-key"){"INVALID_BACKUP"}
        if(value.opt("version")==2){
            E2eeKeys.exact(value,setOf("format","version","archive"));val bytes=value.getString("archive").toByteArray(Charsets.UTF_8)
            try{val archive=E2eeFileManifestJson.readPrivateDocument(bytes);E2eeKeys.exact(archive,setOf("format","schema","backupId","algorithm","wrappedKey","iv","ciphertext","sha256"))
                check(archive.getString("format")=="genesisbackup"&&archive.get("schema")==1&&archive.getString("algorithm")=="A256GCM+A256KW"){"INVALID_BACKUP"}
                check(UUID.fromString(archive.getString("backupId")).toString()==archive.getString("backupId")){"INVALID_BACKUP"}
                for((field,count)in listOf("iv" to 12,"wrappedKey" to 40,"ciphertext" to -1)){
                    check(archive.get(field) is String){"INVALID_BACKUP"};val encoded=archive.getString(field);val decoded=java.util.Base64.getDecoder().decode(encoded)
                    try{check(decoded.size<=MAXIMUM&&(if(count<0)decoded.size>=16 else decoded.size==count)&&java.util.Base64.getEncoder().encodeToString(decoded)==encoded){"INVALID_BACKUP"}
                        if(field=="ciphertext"){val digest=java.security.MessageDigest.getInstance("SHA-256").digest(decoded).joinToString(""){"%02x".format(it)};check(archive.get("sha256")==digest){"INVALID_BACKUP"}}
                    }finally{decoded.fill(0)}
                }
            }finally{bytes.fill(0)}
        }else{check(!export&&value.opt("version")==1&&source.size<=4000){"INVALID_BACKUP"};E2eeKeys.exact(value,setOf("format","version","salt","iv","ciphertext"))
            for((field,count)in listOf("salt" to 16,"iv" to 12,"ciphertext" to -1)){
                check(value.get(field) is String){"INVALID_BACKUP"};val decoded=MessagingCrypto.unbase64(value.getString(field));try{check(if(count<0)decoded.size in 16..4000 else decoded.size==count){"INVALID_BACKUP"}}finally{decoded.fill(0)}
            }
        }
    }
    @Synchronized private fun transition(request:Request,expected:String,next:String){check(mutable.value?.request===request&&mutable.value?.phase==expected){"MESSAGING_FILE_CHANGED"};mutable.value=State(request,next)}
    private fun prepare(owner:String,kind:String,source:ByteArray?,guard:()->Unit):Request{
        var created:Request?=null
        try{guard();val request=Request(owner,kind,source,guard);created=request
            val old=synchronized(this){val prior=mutable.value;check(prior==null||prior.phase in setOf("ready","complete","failed")){"MESSAGING_FILE_BUSY"};mutable.value=State(request,"requested");prior?.request}
            old?.close();return request
        }catch(error:Throwable){created?.close();source?.fill(0);throw error}
    }
    fun prepareExport(owner:String,source:String,guard:()->Unit):Request{check(source.length<=MAXIMUM){"INVALID_BACKUP"};val bytes=source.toByteArray(Charsets.UTF_8);try{validate(bytes,true);return prepare(owner,"export",bytes,guard)}catch(error:Throwable){bytes.fill(0);throw error}}
    fun prepareImport(owner:String,guard:()->Unit)=prepare(owner,"import",null,guard)
    fun failed(request:Request){val close=synchronized(this){if(mutable.value?.request===request&&mutable.value?.phase!="complete"){mutable.value=State(request,"failed");true}else false};if(close)request.close()}
    fun consumed(request:Request){synchronized(this){request.current();transition(request,"ready","complete")};request.close()}
}
