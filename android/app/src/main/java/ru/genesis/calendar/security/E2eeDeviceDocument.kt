package ru.genesis.calendar.security

import org.json.JSONObject
import org.json.JSONArray
import java.security.MessageDigest

/** Device-only content has no transport/flush capability. Absence and corruption
 * are different results; CAS preserves edits made by another repository. */
internal class E2eeDeviceDocument(private val device:E2eeScopeDevice,private val id:String,
    private val validate:(JSONObject)->JSONObject,private val current:()->Unit,
    private val read:(String,String)->UnlockedE2eeVault.Opened?={domain,objectId->device.vault.read(domain,objectId)}){
    class Opened(val value:JSONObject,val serial:Long){override fun toString()="E2eeDeviceDocument.Opened([redacted])"}
    private val prefix="device-doc:"+E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(id.toByteArray(Charsets.UTF_8)))
    init{E2eeKeys.technical(id)}
    private fun manifest(value:JSONObject):JSONObject?{
        if(value.opt("format")!="genesis-device-document-v1")return null
        E2eeKeys.exact(value,setOf("format","size","hash","slots"));val size=E2eeCommands.integer(value.get("size"),1);val slots=value.getJSONArray("slots")
        check(size<=E2eeFiles.MAX_FILE_BYTES&&slots.length() in ((size+E2eeFiles.CHUNK_BYTES-1)/E2eeFiles.CHUNK_BYTES).toInt()..256){"E2EE_PRIVATE_DOCUMENT_CORRUPT"}
        for(index in 0 until slots.length())check(E2eeCommands.integer(slots.get(index),1)<9_007_199_254_740_991L){"E2EE_PRIVATE_DOCUMENT_CORRUPT"}
        E2eeEnvelope.decode(value.getString("hash"),32);return value
    }
    fun load():Opened?{
        current();val row=read("draft",id)?:return null
        try{current();val decoded=E2eeFileManifestJson.readPrivateDocument(row.bytes);val manifest=manifest(decoded)?:return Opened(validate(decoded),row.serial)
            val bytes=ByteArray(manifest.getInt("size"));try{
                val parts=(bytes.size+E2eeFiles.CHUNK_BYTES-1)/E2eeFiles.CHUNK_BYTES;val slots=manifest.getJSONArray("slots")
                for(part in 0 until parts){current();val value=read("draft","$prefix:$part")?:error("E2EE_PRIVATE_DOCUMENT_CORRUPT")
                    try{current();check(value.serial==slots.getLong(part)){"E2EE_LOCAL_CONFLICT"};check(value.bytes.size==minOf(E2eeFiles.CHUNK_BYTES,bytes.size-part*E2eeFiles.CHUNK_BYTES)){"E2EE_PRIVATE_DOCUMENT_CORRUPT"};value.bytes.copyInto(bytes,part*E2eeFiles.CHUNK_BYTES)}finally{value.bytes.fill(0)}}
                check(E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(bytes))==manifest.getString("hash")){"E2EE_PRIVATE_DOCUMENT_CORRUPT"};current()
                return Opened(validate(E2eeFileManifestJson.readPrivateDocument(bytes)),row.serial)
            }finally{bytes.fill(0)}
        }finally{row.bytes.fill(0)}
    }
    fun save(input:JSONObject,expected:Long?):Opened{
        current();val value=validate(JSONObject(input.toString()));val bytes=value.toString().toByteArray(Charsets.UTF_8)
        val writes=mutableListOf<UnlockedE2eeVault.Write>()
        try{check(bytes.size in 1..E2eeFiles.MAX_FILE_BYTES){"E2EE_PRIVATE_DOCUMENT_CORRUPT"};device.ensureDurableKeys();current()
            val old=device.vault.read("draft",id);val slots=try{check(old?.serial==expected){"E2EE_LOCAL_CONFLICT"};old?.let{manifest(E2eeFileManifestJson.readPrivateDocument(it.bytes))?.getJSONArray("slots")}?.let{JSONArray(it.toString())}?:JSONArray()}finally{old?.bytes?.fill(0)}
            for(part in 0 until (bytes.size+E2eeFiles.CHUNK_BYTES-1)/E2eeFiles.CHUNK_BYTES){val serial=if(part<slots.length())slots.getLong(part)else null
                writes+=UnlockedE2eeVault.Write("draft","$prefix:$part",bytes.copyOfRange(part*E2eeFiles.CHUNK_BYTES,minOf(bytes.size,(part+1)*E2eeFiles.CHUNK_BYTES)),serial);slots.put(part,(serial?:0L)+1)}
            val descriptor=JSONObject().put("format","genesis-device-document-v1").put("size",bytes.size).put("hash",E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(bytes))).put("slots",slots)
            writes+=UnlockedE2eeVault.Write("draft",id,descriptor.toString().toByteArray(Charsets.UTF_8),expected)
            current();device.vault.write(writes,current);current();return Opened(value,(expected?:0)+1)
        }finally{bytes.fill(0);writes.forEach{it.bytes.fill(0)}}
    }
    override fun toString()="E2eeDeviceDocument([redacted])"
}
