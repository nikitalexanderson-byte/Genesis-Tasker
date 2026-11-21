package ru.genesis.calendar.security

import org.json.JSONObject

/** Product persistence over the same native authenticated scope client and
 * durable editor queue as web. No legacy HTTP/key, restore or plaintext store. */
internal class E2eePrivateDocument(private val device:E2eeScopeDevice,private val client:E2eeScopeClient,scopeId:String,
    private val domain:String,private val objectId:String,private val validate:(JSONObject)->JSONObject,
    private val assertCurrent:()->Unit,private val assertWrite:()->Unit){
    class Conflict(val value:JSONObject,val revision:Long){override fun toString()="E2eePrivateDocument.Conflict([redacted])"}
    class Opened(val value:JSONObject,val serial:Long,val remoteRevision:Long,val pending:Boolean,val conflict:Conflict?=null){override fun toString()="E2eePrivateDocument.Opened([redacted])"}
    private val queue=E2eeEditorQueue(device,client,scopeId,domain,objectId)
    private fun decode(bytes:ByteArray):JSONObject{
        check(bytes.size<=E2eeFiles.MAX_FILE_BYTES){"E2EE_PRIVATE_DOCUMENT_CORRUPT"}
        // The shared strict JSON reader validates product documents before their
        // domain model is exposed; JSONObject must not silently replace names.
        val parsed=E2eeFileManifestJson.readPrivateDocument(bytes)
        return validate(parsed)
    }
    fun load(offline:Boolean=false):Opened{
        assertCurrent();device.requireOpen();if(!offline)try{queue.recoverAcknowledgement()}catch(error:IllegalStateException){if(error.message!="E2EE_CONFLICT_REVIEW_STALE")throw error};assertCurrent();val local=queue.load();assertCurrent()
        try{
            if(offline){check(local!=null){"E2EE_OFFLINE_CONTENT_UNAVAILABLE"};return Opened(decode(local.bytes),local.serial,local.remoteRevision,local.pending)}
            val remote=client.read(domain,objectId)
            if(remote==null){if(local?.pending==true&&local.remoteRevision==0L)return Opened(decode(local.bytes),local.serial,0,true);error("E2EE_PRIVATE_DOCUMENT_MISSING")};assertCurrent()
            try{val value=decode(remote.bytes);assertCurrent()
                if(local?.pending==true)return Opened(decode(local.bytes),local.serial,local.remoteRevision,true,
                    if(remote.revision==local.remoteRevision)null else Conflict(value,remote.revision))
                if(local!=null&&remote.revision==local.remoteRevision){check(local.bytes.contentEquals(remote.bytes)){"E2EE_PRIVATE_DOCUMENT_DIVERGED"};return Opened(value,local.serial,remote.revision,false)}
                val serial=queue.reconcile(remote.bytes,local?.serial,remote.revision,cache=true);assertCurrent();return Opened(value,serial,remote.revision,false)
            }finally{remote.bytes.fill(0)}
        }finally{local?.bytes?.fill(0)}
    }
    fun save(value:JSONObject,serial:Long?,remoteRevision:Long):Long{
        assertCurrent();assertWrite();val bytes=validate(JSONObject(value.toString())).toString().toByteArray(Charsets.UTF_8)
        try{return queue.stage(bytes,serial,remoteRevision).also{assertCurrent()}}finally{bytes.fill(0)}
    }
    fun merge(value:JSONObject,serial:Long?,remoteRevision:Long):Long{
        assertCurrent();assertWrite();val bytes=validate(JSONObject(value.toString())).toString().toByteArray(Charsets.UTF_8)
        try{return queue.reconcile(bytes,serial,remoteRevision).also{assertCurrent()}}finally{bytes.fill(0)}
    }
    fun flush():Long{assertCurrent();assertWrite();return queue.flush().also{assertCurrent()}}
    fun rebasePending(remoteRevision:Long):String{assertCurrent();assertWrite();return queue.rebasePending(remoteRevision).also{assertCurrent()}}
    fun reviewConflict(value:JSONObject,serial:Long,remoteRevision:Long):Long{
        assertCurrent();assertWrite();val bytes=validate(JSONObject(value.toString())).toString().toByteArray(Charsets.UTF_8)
        try{return queue.reviewConflict(bytes,serial,remoteRevision).also{assertCurrent()}}finally{bytes.fill(0)}
    }
    override fun toString()="E2eePrivateDocument([redacted])"
}
