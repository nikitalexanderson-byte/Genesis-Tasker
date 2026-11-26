package ru.genesis.calendar.data

import org.json.JSONObject
import java.io.*
import java.security.MessageDigest
import java.util.Base64

/** Only bounded authenticated frames reach private no-backup storage. UTF16
 * code units are encoded explicitly: a transport boundary may split a pair,
 * and even an unpaired surrogate must not be replaced by a charset encoder. */
internal class BackupFormSpool(private val root:File,private val crypto:Crypto,
    private val metadata:(Reader)->JSONObject,private val maximum:Int=96*1024*1024,
    private val quota:Long=768L*1024*1024,private val otherBytes:()->Long={0L},private val quotaMonitor:Any=Any(),
    private val syncDirectory:(File)->Unit={}) {
    internal interface Crypto { fun seal(value:String,aad:String):String;fun open(value:String,aad:String):String }
    internal interface Form {
        val characters:Int
        val memoryBytes:Long
        val header:JSONObject
        fun reader():Reader
        fun clear()
    }
    /** Authenticated provenance only. An incomplete origin is inert input,
     * never a Form, permission to resume, or evidence of an empty history. */
    internal class Origin(val binding:String,val view:String,val id:String,val complete:Boolean) {
        override fun toString()="BackupFormSpool.Origin([redacted])"
    }
    private class Pending(val binding:String,val id:String,val view:String,val file:File,val stream:FileOutputStream) {
        val output=DataOutputStream(stream.buffered());val hash=MessageDigest.getInstance("SHA-256")
        var characters=0;var chunks=0
    }
    private val pending=linkedMapOf<String,Pending>()
    private var retired=false
    private val uuid=Regex("[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}")
    private fun requireRoot(){
        check(!retired){"BACKUP_VIEW_CLOSED"};val existed=root.exists()
        check(root.isDirectory||root.mkdirs()){"BACKUP_FORM_STORAGE"};check(!java.nio.file.Files.isSymbolicLink(root.toPath())){"BACKUP_FORM_STORAGE"}
        if(!existed){syncDirectory(root.parentFile);syncDirectory(root)}
    }
    private fun owned(file:File):File { check(file.canonicalFile.parentFile==root.canonicalFile&&!java.nio.file.Files.isSymbolicLink(file.toPath())){"BACKUP_FORM_STORAGE"};return file }
    private fun used():Long=otherBytes()+(root.listFiles()?.sumOf{file->if(file.isFile&&!java.nio.file.Files.isSymbolicLink(file.toPath()))file.length()else 0L}?:0L)
    private fun record(out:DataOutputStream,value:String){
        val bytes=value.toByteArray(Charsets.US_ASCII)
        try{check(bytes.size in 1..FRAME){"BACKUP_FORM_STORAGE"};out.writeInt(bytes.size);out.write(bytes)}finally{bytes.fill(0)}
    }
    private fun record(input:DataInputStream,length:Int=input.readInt()):String {
        check(length in 1..FRAME){"BACKUP_FORM_INTEGRITY"};val bytes=ByteArray(length)
        return try{input.readFully(bytes);bytes.toString(Charsets.US_ASCII)}finally{bytes.fill(0)}
    }
    private fun aad(binding:String,id:String,part:String)="backup-form-spool-v1:${binding.length}:$binding:$id:$part"
    private fun digest(hash:MessageDigest)=hash.digest().joinToString(""){"%02x".format(it)}
    private fun discard(value:Pending){runCatching{value.output.close()};owned(value.file).delete();owned(File(root,"${value.id}.origin")).delete()}
    private fun originAad(id:String)="backup-form-spool-origin-v1:${root.name}:$id"
    private fun persistOrigin(value:Pending){
        val locator=JSONObject().put("protocol",1).put("binding",value.binding).put("view",value.view).put("id",value.id)
        val bytes=crypto.seal(locator.toString(),originAad(value.id)).toByteArray(Charsets.US_ASCII)
        try{
            check(bytes.size in 1..16384){"BACKUP_FORM_STORAGE"}
            synchronized(quotaMonitor){
                check(used()+bytes.size<=quota){"BACKUP_FORM_QUOTA"}
                val file=owned(File(root,"${value.id}.origin"));check(file.createNewFile()){"BACKUP_TRANSFER_BUSY"}
                FileOutputStream(file).use{it.write(bytes);it.fd.sync()};syncDirectory(root)
            }
        }finally{bytes.fill(0)}
    }
    @Synchronized fun append(view:String,binding:String,id:String,index:Int,last:Boolean,text:String,assertCurrent:()->Unit={}):Form? {
        assertCurrent();requireRoot();check(uuid.matches(view)&&uuid.matches(id)&&binding.length in 1..4096&&index in 0..maximum/CHUNK&&text.length<=CHUNK){"BACKUP_TRANSFER_INVALID"}
        if(index==0){
            // A new publication explicitly abandons only this view's incomplete
            // candidates, never the preceding acknowledged form.
            pending.values.filter{it.view==view&&it.id!=id}.toList().forEach{pending.remove(it.id);discard(it)}
            check(id !in pending&&pending.size<2){"BACKUP_TRANSFER_BUSY"}
            check(listOf("origin","pending","bin","ref","index-pending").none{owned(File(root,"$id.$it")).exists()}){"BACKUP_TRANSFER_BUSY"}
            val file=owned(File(root,"$id.pending"));check(file.createNewFile()){"BACKUP_TRANSFER_BUSY"}
            val stream=try{FileOutputStream(file)}catch(error:Throwable){file.delete();throw error}
            val value=Pending(binding,id,view,file,stream)
            try{
                value.output.writeInt(MAGIC);value.output.flush()
                // Persist the ORIGINAL binding before any input chunk can be
                // acknowledged. A process can die before the final .ref exists.
                persistOrigin(value);pending[id]=value
            }catch(error:Throwable){discard(value);throw error}
        }
        val value=pending[id]?:error("BACKUP_TRANSFER_ORDER")
        try{
            check(value.view==view&&value.binding==binding&&value.chunks==index&&value.characters.toLong()+text.length<=maximum&&
                (last||text.length==CHUNK)&&text.isNotEmpty()){"BACKUP_TRANSFER_ORDER"}
            val bytes=ByteArray(text.length*2)
            try{
                text.forEachIndexed{at,char->bytes[at*2]=(char.code ushr 8).toByte();bytes[at*2+1]=char.code.toByte()}
                value.hash.update(bytes)
                val encrypted=crypto.seal(Base64.getEncoder().encodeToString(bytes),aad(binding,id,"chunk:$index"))
                assertCurrent()
                // Quota is shared across native form/value/binary sessions.
                // Check and flush one bounded frame atomically; crypto and
                // full metadata readback never hold this shared monitor.
                synchronized(quotaMonitor){
                    check(used()+encrypted.length+4+(if(value.chunks==0)4 else 0)<=quota){"BACKUP_FORM_QUOTA"}
                    record(value.output,encrypted);value.output.flush()
                }
                // Acknowledging a non-final chunk must not depend on a later
                // footer's fsync. No whole form/binary buffer is retained here.
                value.stream.fd.sync();assertCurrent()
            }finally{bytes.fill(0)}
            value.characters+=text.length;value.chunks++
            if(!last)return null
            val sha=digest(value.hash)
            val footer=JSONObject().put("protocol",1).put("characters",value.characters).put("chunks",value.chunks).put("sha256",sha)
            val encryptedFooter=crypto.seal(footer.toString(),aad(binding,id,"footer"))
            assertCurrent()
            synchronized(quotaMonitor){
                check(used()+encryptedFooter.length+8<=quota){"BACKUP_FORM_QUOTA"}
                value.output.writeInt(0);record(value.output,encryptedFooter);value.output.flush()
            }
            value.stream.fd.sync();value.output.close()
            pending.remove(id)
            val file=owned(File(root,"$id.bin"));check(!file.exists()&&value.file.renameTo(file)){"BACKUP_FORM_STORAGE"}
            val result=Stored(file,binding,id,value.characters,value.chunks,sha)
            try{
                // Final metadata validation drains the complete encrypted
                // source. Retirement must interrupt that read too, so account
                // clear never waits for an entire large candidate to decrypt.
                result.header=object:FilterReader(result.reader()){
                    override fun read(target:CharArray,start:Int,length:Int):Int {
                        assertCurrent();return super.read(target,start,length).also{assertCurrent()}
                    }
                    override fun read():Int {assertCurrent();return super.read().also{assertCurrent()}}
                }.use(metadata)
                assertCurrent()
                // A crash must not leave an acknowledged encrypted form whose
                // AAD binding exists only in lost process memory. This encrypted
                // locator preserves that binding for the complete source reader.
                // It is inert history, never permission to resume an operation.
                val locator=JSONObject().put("protocol",1).put("binding",binding).put("view",view).put("id",id)
                    .put("characters",value.characters).put("chunks",value.chunks).put("sha256",sha)
                val bytes=crypto.seal(locator.toString(),"backup-form-spool-index-v1:${root.name}:$id").toByteArray(Charsets.US_ASCII)
                val temporary=owned(File(root,"$id.index-pending"));val target=owned(File(root,"$id.ref"))
                try{
                    assertCurrent()
                    synchronized(quotaMonitor){
                        check(used()+bytes.size<=quota){"BACKUP_FORM_QUOTA"};check(temporary.createNewFile()&&!target.exists()){"BACKUP_FORM_STORAGE"}
                        FileOutputStream(temporary).use{it.write(bytes);it.fd.sync()};check(temporary.renameTo(target)){"BACKUP_FORM_STORAGE"};syncDirectory(root)
                    }
                }finally{bytes.fill(0);temporary.delete()}
                assertCurrent()
                // The complete ref is durable first. A leftover matching origin
                // after a crash/cleanup refusal is valid inert provenance.
                runCatching{if(owned(File(root,"$id.origin")).delete())syncDirectory(root)}
                return result
            }catch(error:Throwable){result.clear();throw error}
        }catch(error:Throwable){pending.remove(id);discard(value);throw error}
    }
    private inner class Stored(private val file:File,private val binding:String,private val id:String,
        override val characters:Int,private val chunks:Int,private val sha:String):Form {
        override val memoryBytes=0L
        override lateinit var header:JSONObject
        override fun reader():Reader {
            requireRoot();val raw=DataInputStream(BufferedInputStream(FileInputStream(owned(file))))
            try{check(raw.readInt()==MAGIC){"BACKUP_FORM_INTEGRITY"}}catch(error:Throwable){raw.close();throw error}
            return object:Reader(){
                private var data=ByteArray(0);private var offset=0;private var count=0;private var total=0;private var done=false;private var closed=false
                private val hash=MessageDigest.getInstance("SHA-256")
                private fun next():Boolean {
                    data.fill(0);data=ByteArray(0);offset=0
                    val length=raw.readInt()
                    if(length==0){
                        val footer=JSONObject(crypto.open(record(raw),aad(binding,id,"footer")))
                        check(footer.keys().asSequence().toSet()==setOf("protocol","characters","chunks","sha256")&&footer.get("protocol")==1&&
                            footer.getInt("characters")==total&&footer.getInt("chunks")==count&&footer.getString("sha256")==sha&&
                            total==characters&&count==chunks&&digest(hash)==sha&&raw.read()==-1){"BACKUP_FORM_INTEGRITY"}
                        done=true;return false
                    }
                    check(count<chunks){"BACKUP_FORM_INTEGRITY"}
                    data=Base64.getDecoder().decode(crypto.open(record(raw,length),aad(binding,id,"chunk:${count++}")))
                    check(data.isNotEmpty()&&data.size<=CHUNK*2&&data.size%2==0&&total.toLong()+data.size/2<=characters&&
                        (count==chunks||data.size==CHUNK*2)){"BACKUP_FORM_INTEGRITY"}
                    total+=data.size/2;hash.update(data);return true
                }
                override fun read(target:CharArray,start:Int,length:Int):Int {
                    check(!closed){"BACKUP_FORM_INTEGRITY"};require(start>=0&&length>=0&&start+length<=target.size)
                    if(length==0)return 0;if(done)return -1
                    if(offset==data.size&&!next())return -1
                    val size=minOf(length,(data.size-offset)/2)
                    for(at in 0 until size){target[start+at]=(((data[offset].toInt()and 255)shl 8)or(data[offset+1].toInt()and 255)).toChar();offset+=2}
                    return size
                }
                override fun close(){if(!closed){closed=true;data.fill(0);raw.close()}}
            }
        }
        override fun clear(){owned(file).delete();owned(File(root,"$id.ref")).delete();owned(File(root,"$id.origin")).delete()}
        override fun toString()="BackupFormSpool.Form([redacted])"
    }
    @Synchronized fun cancel(view:String){pending.values.filter{it.view==view}.toList().forEach{pending.remove(it.id);discard(it)}}
    private fun reference(file:File,id:String):JSONObject {
        check(owned(file).length() in 1..16384){"BACKUP_FORM_INTEGRITY"}
        val value=JSONObject(crypto.open(file.readText(Charsets.US_ASCII),"backup-form-spool-index-v1:${root.name}:$id"))
        check(value.keys().asSequence().toSet()==setOf("protocol","binding","view","id","characters","chunks","sha256")&&
            value.get("protocol")==1&&value.getString("id")==id&&uuid.matches(value.getString("view"))&&
            value.getString("binding").length in 1..4096&&value.getInt("characters") in 1..maximum&&
            value.getInt("chunks")== (value.getInt("characters")+CHUNK-1)/CHUNK&&value.getString("sha256").matches(Regex("[a-f0-9]{64}"))){"BACKUP_FORM_INTEGRITY"}
        return value
    }
    /** Small restart catalog only; no bulk reads or reattachment to a session.
     * Unknown legacy remnants are retained and explicitly block, never swept. */
    @Synchronized fun origins():List<Origin> {
        requireRoot();val files=root.listFiles()?:error("BACKUP_FORM_STORAGE");check(files.size<=30000){"E2EE_SOURCE_TOO_LARGE"}
        val groups=linkedMapOf<String,MutableSet<String>>()
        for(file in files){
            check(owned(file).isFile){"BACKUP_FORM_STORAGE"}
            val id=file.name.substringBefore('.');val suffix=file.name.substringAfter('.',"")
            check(uuid.matches(id)&&suffix in setOf("ref","origin","pending","bin","index-pending")){"BACKUP_FORM_UNBOUND_REMNANT"}
            groups.getOrPut(id){mutableSetOf()}.add(suffix)
        }
        check(groups.size<=10000){"E2EE_SOURCE_TOO_LARGE"}
        return groups.map{(id,names)->
            check("pending" !in names||"bin" !in names){"BACKUP_FORM_INTEGRITY"}
            val complete=if("ref" in names){check("bin" in names&&"pending" !in names){"BACKUP_FORM_INTEGRITY"};reference(File(root,"$id.ref"),id)}else null
            val early=if("origin" in names){
                val file=owned(File(root,"$id.origin"));check(file.length() in 1..16384){"BACKUP_FORM_INTEGRITY"}
                JSONObject(crypto.open(file.readText(Charsets.US_ASCII),originAad(id))).also{value->
                    check(value.keys().asSequence().toSet()==setOf("protocol","binding","view","id")&&value.get("protocol")==1&&
                        value.getString("id")==id&&uuid.matches(value.getString("view"))&&value.getString("binding").length in 1..4096){"BACKUP_FORM_INTEGRITY"}
                }
            }else null
            check(complete!=null||early!=null){"BACKUP_FORM_UNBOUND_REMNANT"}
            if(complete!=null&&early!=null)check(complete.getString("binding")==early.getString("binding")&&complete.getString("view")==early.getString("view")){"BACKUP_FORM_INTEGRITY"}
            val value=requireNotNull(complete?:early);Origin(value.getString("binding"),value.getString("view"),id,complete!=null)
        }
    }
    /** Read-only restart inventory. Callers still need owner filtering, durable
     * fencing, old-key capture and new-root materialization before activation. */
    @Synchronized fun retained():List<Pair<String,Form>> {
        requireRoot()
        val catalog=origins();check(catalog.all{it.complete}){"BACKUP_FORM_INCOMPLETE"}
        return catalog.map{origin->
            val id=origin.id;val value=reference(File(root,"$id.ref"),id)
            val form=Stored(owned(File(root,"$id.bin")),value.getString("binding"),id,value.getInt("characters"),value.getInt("chunks"),value.getString("sha256"))
            form.header=form.reader().use(metadata);value.getString("binding") to form
        }
    }
    @Synchronized fun clear(){pending.values.toList().forEach(::discard);pending.clear();retired=true;root.delete()}
    companion object { const val CHUNK=131072;private const val FRAME=1_048_576;private const val MAGIC=0x47424631 }
    override fun toString()="BackupFormSpool([redacted])"
}
