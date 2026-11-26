package ru.genesis.calendar.security

import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest

/** Device-only normalized content, never an upload envelope. Its manifest,
 * filenames and plaintext digests remain inside the encrypted local journal. */
internal object E2eeMigrationLocal {
    class Entry(val domain:String,val objectId:String,val recordId:String,val parts:Int,val size:Int,
        val plaintextHash:String,val filename:String,val mediaType:String) {
        override fun toString()="E2eeMigrationLocal.Entry([redacted])"
    }
    class Plan(val entries:JSONArray,val writes:List<UnlockedE2eeVault.Write>) {
        override fun toString()="E2eeMigrationLocal.Plan([redacted])"
    }
    private fun hash(bytes:ByteArray)=E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(bytes))
    private fun text(row:JSONObject,key:String)=row.get(key) as? String?:error("E2EE_CORRUPT_LOCAL_CONTENT")
    fun validate(rows:JSONArray,migrationId:String,allowed:Set<String>):List<Entry> {
        E2eeKeys.technical(migrationId);check(rows.length()<=10000){"E2EE_CORRUPT_LOCAL_CONTENT"}
        val result=mutableListOf<Entry>();val seen=mutableSetOf<String>();var total=0L
        for(index in 0 until rows.length()){
            val row=rows.getJSONObject(index)
            E2eeKeys.exact(row,setOf("domain","objectId","recordId","parts","size","plaintextHash","filename","mediaType"))
            val domain=text(row,"domain");val id=E2eeKeys.technical(text(row,"objectId"));val record=text(row,"recordId")
            val size=E2eeCommands.integer(row.get("size"));val parts=E2eeCommands.integer(row.get("parts"))
            val filename=text(row,"filename");val mediaType=text(row,"mediaType");val digest=text(row,"plaintextHash")
            check(domain in allowed&&record=="$migrationId:private:$index"&&size<=E2eeFiles.MAX_FILE_BYTES
                &&parts==(size+E2eeFiles.CHUNK_BYTES-1)/E2eeFiles.CHUNK_BYTES&&filename.length<=512&&mediaType.length<=128
                &&seen.add("$domain\u0000$id")){"E2EE_CORRUPT_LOCAL_CONTENT"}
            E2eeEnvelope.decode(digest,32);total+=size;check(total<=E2eeMigrationSources.BYTE_BUDGET){"E2EE_CORRUPT_LOCAL_CONTENT"}
            result+=Entry(domain,id,record,parts.toInt(),size.toInt(),digest,filename,mediaType)
        }
        return result
    }
    fun plan(migrationId:String,records:List<E2eeMigrationContent>):Plan {
        E2eeKeys.technical(migrationId);val entries=JSONArray();val writes=mutableListOf<UnlockedE2eeVault.Write>()
        try{
            check(records.size<=10000&&records.sumOf{it.bytes.size.toLong()}<=E2eeMigrationSources.BYTE_BUDGET){"E2EE_MIGRATION_TOO_LARGE"}
            records.forEachIndexed{index,item->
                check(item.bytes.size<=E2eeFiles.MAX_FILE_BYTES&&item.filename.length<=512&&item.mediaType.length<=128){"E2EE_INVALID_SOURCE_RESULT"}
                E2eeKeys.technical(item.objectId)
                val id="$migrationId:private:$index";val parts=(item.bytes.size+E2eeFiles.CHUNK_BYTES-1)/E2eeFiles.CHUNK_BYTES
                entries.put(JSONObject().put("domain",item.domain).put("objectId",item.objectId).put("recordId",id).put("parts",parts)
                    .put("size",item.bytes.size).put("plaintextHash",hash(item.bytes)).put("filename",item.filename).put("mediaType",item.mediaType))
                for(part in 0 until parts)writes+=UnlockedE2eeVault.Write("local-snapshot","$id:$part",
                    item.bytes.copyOfRange(part*E2eeFiles.CHUNK_BYTES,minOf(item.bytes.size,(part+1)*E2eeFiles.CHUNK_BYTES)),null)
            }
            return Plan(entries,writes)
        }catch(error:Throwable){writes.forEach{it.bytes.fill(0)};throw error}
    }
    fun open(vault:UnlockedE2eeVault,item:Entry):E2eeMigrationContent {
        vault.requireOpen();check(item.size in 0..E2eeFiles.MAX_FILE_BYTES&&item.parts==(item.size+E2eeFiles.CHUNK_BYTES-1)/E2eeFiles.CHUNK_BYTES){"E2EE_CORRUPT_LOCAL_CONTENT"}
        val bytes=ByteArray(item.size);var offset=0
        try{
            for(part in 0 until item.parts){
                val row=vault.read("local-snapshot","${item.recordId}:$part")?:error("E2EE_CORRUPT_LOCAL_CONTENT")
                try{
                    check(row.bytes.size==minOf(E2eeFiles.CHUNK_BYTES,bytes.size-offset)){"E2EE_CORRUPT_LOCAL_CONTENT"}
                    row.bytes.copyInto(bytes,offset);offset+=row.bytes.size
                }finally{row.bytes.fill(0)}
            }
            check(offset==bytes.size&&hash(bytes)==item.plaintextHash){"E2EE_CORRUPT_LOCAL_CONTENT"};vault.requireOpen()
            return E2eeMigrationContent(item.domain,item.objectId,bytes,item.filename,item.mediaType)
        }catch(error:Throwable){bytes.fill(0);throw error}
    }
}
