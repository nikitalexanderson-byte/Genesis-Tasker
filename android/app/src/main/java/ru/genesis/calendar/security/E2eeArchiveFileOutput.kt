package ru.genesis.calendar.security

import org.json.JSONObject
import java.security.MessageDigest
import java.util.UUID

/** A saved selection is inert content metadata, never a provider/restore grant.
 * Source values remain inside the immutable retained archive. */
internal class E2eeArchiveFileOutput(private val account:E2eeProductAccount,private val current:()->Unit){
    private val archive=E2eeContentArchive(account)
    private fun validate(value:JSONObject):JSONObject{
        E2eeKeys.exact(value,setOf("format","archiveId","section","entry","version","sha256","bytes"))
        check(value.getString("format")=="genesis-content-file-output-v1"){"BACKUP_INVALID"};E2eeKeys.technical(value.getString("archiveId"));E2eeKeys.technical(value.getString("section"));E2eeKeys.technical(value.getString("version"))
        E2eeCommands.integer(value.get("entry"));check(E2eeCommands.integer(value.get("bytes"))<=16*1024*1024){"BACKUP_TOO_LARGE"};E2eeEnvelope.decode(value.getString("sha256"),32).fill(0);return value
    }
    private fun document(id:String):E2eeDeviceDocument{check(UUID.fromString(id).toString()==id){"BACKUP_INVALID"};return E2eeDeviceDocument(account.device,"content-file-output:$id",::validate){current();account.requireOpen()}}
    private fun record(archiveId:String,sectionId:String,entry:Int,version:String):JSONObject{
        current();account.requireOpen();val payload=archive.openRetained(archiveId);current();val sections=payload.getJSONArray("sections")
        val selected=(0 until sections.length()).map{sections.getJSONObject(it)}.single{it.getString("id")==sectionId}.getJSONObject("data").getJSONArray("entries")
        check(entry in 0 until selected.length()){"BACKUP_INVALID"};val row=selected.getJSONObject(entry);val head=row.getJSONObject("current")
        if(head.getString("id")==version)return head
        val history=row.getJSONArray("history");return (0 until history.length()).map{history.getJSONObject(it)}.single{it.getString("id")==version}
    }
    fun prepare(archiveId:String,section:String,entry:Int,version:String):String{
        current();val source=record(archiveId,section,entry,version);val value=validate(JSONObject().put("format","genesis-content-file-output-v1").put("archiveId",archiveId).put("section",section).put("entry",entry).put("version",version).put("sha256",source.getString("sha256")).put("bytes",source.get("size")))
        val id=UUID.randomUUID().toString();document(id).save(value,null);current();check(E2eeProductJson.same(document(id).load()?.value,value)){"E2EE_BACKUP_UNVERIFIED"};return id
    }
    fun open(id:String):ByteArray{
        current();account.requireOpen();val intent=document(id).load()?.value?:error("BACKUP_INVALID")
        val source=record(intent.getString("archiveId"),intent.getString("section"),E2eeCommands.integer(intent.get("entry")).also{check(it<=Int.MAX_VALUE){"BACKUP_INVALID"}}.toInt(),intent.getString("version"))
        check(source.getString("sha256")==intent.getString("sha256")&&source.getLong("size")==intent.getLong("bytes")){"BACKUP_INVALID"}
        val size=source.getInt("size");val bytes=if(size==0&&source.getString("bytes")=="")ByteArray(0)else E2eeEnvelope.decode(source.getString("bytes"),size)
        try{check(bytes.size==size&&E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(bytes))==source.getString("sha256")){"BACKUP_INVALID"};current();account.requireOpen();return bytes}
        catch(reason:Throwable){bytes.fill(0);throw reason}
    }
    override fun toString()="E2eeArchiveFileOutput([redacted])"
}
