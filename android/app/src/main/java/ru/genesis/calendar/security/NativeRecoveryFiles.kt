package ru.genesis.calendar.security

import android.content.Context
import android.net.Uri
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import org.json.JSONObject
import java.security.MessageDigest
import java.util.Base64
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/** A not-yet-installed recovery generation. No bytes enter SavedState, Intent,
 * preferences, Room or an application temp file. Only explicit user-selected
 * destinations receive the kit and separately selected recovery secret. */
internal class NativeRecoveryMaterial private constructor(
    val owner:String,val view:String,val id:String,
    private val createdAt:Long,private val expiresAt:Long,
    private val kit:ByteArray,private val secretFile:ByteArray,
    private val assertOwner:()->Unit,
):AutoCloseable{
    private var closed=false
    private val receipts=mutableMapOf<String,String>()
    @Synchronized fun current(now:Long=SystemClock.elapsedRealtime()){
        check(!closed&&now>=createdAt&&now<expiresAt){"E2EE_RECOVERY_MATERIAL_EXPIRED"};assertOwner()
    }
    @Synchronized fun bytes(kind:String):ByteArray{
        current();return when(kind){"kit"->kit.copyOf();"secret"->secretFile.copyOf();else->error("E2EE_INVALID_RECOVERY_REQUEST")}
    }
    @Synchronized fun destination(kind:String,uri:Uri){
        current();check(kind in setOf("kit","secret")){"E2EE_INVALID_RECOVERY_REQUEST"}
        check(receipts.filterKeys{it!=kind}.values.none{it==uri.toString()}){"E2EE_RECOVERY_DESTINATION_REUSED"}
    }
    @Synchronized fun saved(kind:String,uri:Uri){destination(kind,uri);receipts[kind]=uri.toString()}
    @Synchronized fun complete():Boolean{current();return receipts.keys.containsAll(setOf("kit","secret"))}
    @Synchronized override fun close(){if(!closed){closed=true;kit.fill(0);secretFile.fill(0);receipts.clear()}}
    override fun toString()="NativeRecoveryMaterial([redacted])"
    companion object{
        const val LIFETIME_MILLIS=600_000L
        fun capture(owner:String,view:String,kit:JSONObject,secret:ByteArray,assertOwner:()->Unit):NativeRecoveryMaterial{
            assertOwner();check(secret.size==32&&kit.getString("ownerId")==owner&&kit.getInt("protocol")==1){"E2EE_SCOPE_BINDING_MISMATCH"}
            val now=SystemClock.elapsedRealtime();check(now>=0&&now<=Long.MAX_VALUE-LIFETIME_MILLIS){"E2EE_INVALID_RECOVERY_REQUEST"}
            val encodedKit=kit.toString(2).toByteArray(Charsets.UTF_8)
            val encodedSecret=Base64.getUrlEncoder().withoutPadding().encode(secret)
            var file:ByteArray?=null;var transferred=false
            try{
                check(encodedKit.size in 1..65536){"E2EE_INVALID_RECOVERY_KIT"}
                val saved=encodedSecret.copyOf(encodedSecret.size+1);file=saved;saved[saved.lastIndex]=10
                assertOwner();return NativeRecoveryMaterial(owner,view,UUID.randomUUID().toString(),now,now+LIFETIME_MILLIS,encodedKit,saved,assertOwner).also{transferred=true}
            }finally{encodedSecret.fill(0);if(!transferred){encodedKit.fill(0);file?.fill(0)}}
        }
    }
}

/** One exact picker invocation. A keyed ActivityResult launcher must capture
 * this object, never read whichever request happens to be pending later. */
internal class NativeRecoveryFileRequest private constructor(
    val owner:String,val view:String,val kind:String,val materialId:String?,
    val filename:String?,private val bytes:ByteArray?,
    private val createdAt:Long,private val expiresAt:Long,
    private val material:NativeRecoveryMaterial?,private val assertCurrent:()->Unit,
):AutoCloseable{
    val id=UUID.randomUUID().toString()
    val writing get()=kind!="read"
    private val returned=AtomicBoolean(false)
    private val claimed=AtomicBoolean(false)
    private val closed=AtomicBoolean(false)
    private val signal=CancellationSignal()
    private val descriptor=AtomicReference<ParcelFileDescriptor?>(null)
    val waitingForPicker get()=!closed.get()&&!returned.get()
    fun remainingMillis()=(expiresAt-SystemClock.elapsedRealtime()).coerceAtLeast(0)
    fun current(){
        val now=SystemClock.elapsedRealtime()
        check(!closed.get()&&now>=createdAt&&now<expiresAt){"E2EE_RECOVERY_REQUEST_EXPIRED"}
        assertCurrent();material?.current(now)
    }
    fun pickerReturned()=returned.compareAndSet(false,true)
    fun claim(expectedOwner:String,expectedView:String){
        current();check(owner==expectedOwner&&view==expectedView&&returned.get()&&claimed.compareAndSet(false,true)){"E2EE_RECOVERY_REQUEST_CHANGED"}
    }
    private fun <T> file(context:Context,uri:Uri,mode:String,operation:(ParcelFileDescriptor)->T):T{
        current();val opened=context.contentResolver.openFileDescriptor(uri,mode,signal)?:error("E2EE_STORAGE_UNAVAILABLE")
        if(!descriptor.compareAndSet(null,opened)){opened.close();error("E2EE_RECOVERY_REQUEST_CHANGED")}
        try{current();return operation(opened)}
        finally{descriptor.compareAndSet(opened,null);runCatching{opened.close()}}
    }
    private fun read(context:Context,uri:Uri,maximum:Int):ByteArray=file(context,uri,"r"){opened->
        ParcelFileDescriptor.AutoCloseInputStream(opened).use{input->
            val buffer=ByteArray(maximum+1);var count=0
            try{
                while(count<buffer.size){current();val size=input.read(buffer,count,minOf(8192,buffer.size-count));current()
                    if(size<0)break;check(size>0){"E2EE_STORAGE_UNAVAILABLE"};count+=size}
                check(count<=maximum){"E2EE_INVALID_RECOVERY_KIT"};buffer.copyOf(count)
            }finally{buffer.fill(0)}
        }
    }
    /** Called on IO after resumed admission. A background/expiry/dispose closes
     * the provider descriptor and cancels pending opens. Providers may still
     * have received a partial file; such a file never receives a saved receipt. */
    fun transfer(context:Context,uri:Uri):JSONObject?{
        current();check(claimed.get()&&uri.scheme=="content"&&uri.toString().length<=8192){"E2EE_INVALID_RECOVERY_REQUEST"}
        if(!writing){
            val input=read(context,uri,65536)
            try{current();check(input.isNotEmpty()){"E2EE_INVALID_RECOVERY_KIT"};val parsed=E2eeFileManifestJson.readPrivateDocument(input)
                check(parsed.getString("ownerId")==owner&&parsed.getInt("protocol")==1){"E2EE_SCOPE_BINDING_MISMATCH"};current();return parsed
            }finally{input.fill(0)}
        }
        material?.destination(kind,uri);val expected=requireNotNull(bytes)
        file(context,uri,"wt"){opened->ParcelFileDescriptor.AutoCloseOutputStream(opened).use{output->
            var offset=0;while(offset<expected.size){current();val size=minOf(8192,expected.size-offset);output.write(expected,offset,size);current();offset+=size};output.flush();current()
        }}
        val copied=read(context,uri,expected.size)
        try{check(MessageDigest.isEqual(copied,expected)){"E2EE_RECOVERY_UNVERIFIED"};current()}finally{copied.fill(0)}
        return null
    }
    override fun close(){if(closed.compareAndSet(false,true)){signal.cancel();runCatching{descriptor.getAndSet(null)?.close()};bytes?.fill(0)}}
    override fun toString()="NativeRecoveryFileRequest([redacted])"
    companion object{
        const val TIMEOUT_MILLIS=120_000L
        private fun deadline():Pair<Long,Long>{val now=SystemClock.elapsedRealtime();check(now>=0&&now<=Long.MAX_VALUE-TIMEOUT_MILLIS){"E2EE_INVALID_RECOVERY_REQUEST"};return now to now+TIMEOUT_MILLIS}
        fun read(owner:String,view:String,current:()->Unit):NativeRecoveryFileRequest{
            current();val (now,until)=deadline();return NativeRecoveryFileRequest(owner,view,"read",null,null,null,now,until,null,current)
        }
        fun write(material:NativeRecoveryMaterial,kind:String,current:()->Unit):NativeRecoveryFileRequest{
            current();material.current();val bytes=material.bytes(kind);var transferred=false
            try{val (now,until)=deadline();val name=when(kind){"kit"->"genesis-recovery-${material.id}.json";"secret"->"genesis-recovery-secret-${material.id}.txt";else->error("E2EE_INVALID_RECOVERY_REQUEST")}
                return NativeRecoveryFileRequest(material.owner,material.view,kind,material.id,name,bytes,now,until,material,current).also{transferred=true}
            }finally{if(!transferred)bytes.fill(0)}
        }
    }
}
