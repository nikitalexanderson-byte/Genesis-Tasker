package ru.genesis.calendar.security

import org.json.JSONArray
import org.json.JSONObject
import java.io.Closeable
import java.security.MessageDigest
import java.security.PublicKey
import javax.crypto.SecretKey

/** Memory-only user content catalogue. No roots, controls, directory pins,
 * grants, enrollment or raw HTTP originals are returned to archive callers. */
internal class E2eeRetainedMigrationValues(private val vault:E2eeSourceReadVault,private val guard:()->Unit):Closeable {
    private class Entry(val descriptor:JSONObject,val read:((ByteArray)->Unit)->JSONObject)
    private val entries=linkedMapOf<String,Entry>();private var closed=false;private var reading=false
    private fun current(){guard();vault.assertOpen();check(!closed){"E2EE_MIGRATION_HISTORY_CLOSED"}}
    private fun invalid():Nothing=error("E2EE_MIGRATION_HISTORY_REVIEW_REQUIRED")
    private fun number(value:JSONObject,key:String)=E2eeCommands.integer(value.get(key))
    private fun rows(value:JSONArray)=E2eeRetainedMigrationProof.rows(value)
    fun add(target:E2eeSourceStage.Target,resourceId:String,migration:String,attempt:String,root:SecretKey,signer:PublicKey,plan:JSONArray,logical:JSONArray,local:JSONArray){
        current();val records=rows(JSONArray(plan.toString())).associateBy{it.getString("domain")+"\u0000"+it.getString("objectId")}
        fun load(item:JSONObject):E2eeEnvelope.Envelope {
            current();val row=vault.read("outbox",item.getString("recordId"))?:invalid()
            try{current();if(row.serial!=1L)invalid();val envelope=E2eeEnvelope.Envelope.fromJson(E2eeFileManifestJson.readMigrationHistory(row.bytes));val context=envelope.context.toJson()
                if(context.get("ownerId")!=target.ownerId||context.get("scopeId")!=target.scopeId||context.get("domain")!=item.get("domain")||context.get("objectId")!=item.get("objectId")||E2eeEnvelope.payloadHash(envelope)!=item.get("hash"))invalid();current();return envelope
            }finally{row.bytes.fill(0)}
        }
        fun register(placement:String,value:JSONObject,open:((ByteArray)->Unit)->JSONObject){
            val coordinate=JSONArray().put(target.scopeId).put(migration).put(attempt).put(placement).put(value.get("domain")).put(value.get("objectId"))
            val canonical=E2eeCommands.canonical(coordinate);val id="retained:"+E2eeRetainedMigrationProof.hash(canonical);canonical.fill(0)
            val scope=JSONObject().put("ownerId",target.ownerId).put("scopeId",target.scopeId).put("kind",target.kind).put("resourceId",resourceId)
            val descriptor=JSONObject().put("id",id).put("scope",scope).put("migrationId",migration).put("attemptId",attempt).put("placement",placement).put("domain",value.get("domain")).put("objectId",value.get("objectId")).put("size",value.get("size")).put("sha256",value.get("plaintextHash"))
            val old=entries[id];if(old!=null){if(!E2eeProductJson.same(old.descriptor,descriptor))invalid();return}
            entries[id]=Entry(descriptor){write->val hash=MessageDigest.getInstance("SHA-256");var size=0L
                val metadata=open{bytes->current();size+=bytes.size;if(size>number(value,"size"))invalid();hash.update(bytes);write(bytes);current()};current()
                if(size!=number(value,"size")||E2eeEnvelope.encode(hash.digest())!=value.get("plaintextHash"))invalid();metadata
            }
        }
        for(value in rows(JSONArray(logical.toString()))){val descriptor=records[value.getString("domain")+"\u0000"+value.getString("objectId")]?:invalid()
            register("remote",value){write->val envelope=load(descriptor)
                if(value.get("domain")=="shared-comment"){val bytes=E2eeEnvelope.open(root,signer,envelope.context,envelope);try{current();write(bytes);current();JSONObject().put("filename","").put("mediaType","application/json")}finally{bytes.fill(0)}}
                else{val opened=E2eeFiles.openStream(root,signer,envelope.context,envelope,{id->load(records["attachment\u0000$id"]?:invalid())},::current,write);current()
                    if(opened.size!=number(value,"size")||value.has("filename")&&value.get("filename")!=opened.filename||value.has("mediaType")&&value.get("mediaType")!=opened.mediaType)invalid();JSONObject().put("filename",opened.filename).put("mediaType",opened.mediaType)
                }
            }
        }
        for(value in rows(JSONArray(local.toString())))register("local",value){write->var size=0L
            for(at in 0 until number(value,"parts").toInt()){current();val row=vault.read("local-snapshot",value.getString("recordId")+":$at")?:invalid()
                try{current();if(row.serial!=1L||row.bytes.size.toLong()!=minOf(E2eeFiles.CHUNK_BYTES.toLong(),number(value,"size")-size))invalid();size+=row.bytes.size;write(row.bytes);current()}finally{row.bytes.fill(0)}
            }
            if(size!=number(value,"size"))invalid();JSONObject().put("filename",value.get("filename")).put("mediaType",value.get("mediaType"))
        }
    }
    fun contents():List<JSONObject>{current();return entries.values.map{JSONObject(it.descriptor.toString())}}
    @Synchronized fun read(id:String,write:(ByteArray)->Unit):JSONObject {current();check(!reading){"E2EE_SOURCE_INPUT_BUSY"};val entry=entries[id]?:invalid();reading=true;return try{entry.read(write).also{current()}}finally{reading=false}}
    override fun close(){closed=true;entries.clear()}
    override fun toString()="E2eeRetainedMigrationValues([redacted])"
}
