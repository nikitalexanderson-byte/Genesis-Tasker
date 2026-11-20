package ru.genesis.calendar.data

import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/** One original view/owner/epoch only. Every acknowledged value and manifest
 * remains inert source input, including candidates never selected by a form.
 * Callers provide the memory/session fence; no network or restore port exists. */
internal class BackupValueInventory(private val storage:()->BackupFormSpool,private val view:String,private val binding:String,
    private val manifestMetadata:(String)->JSONObject,private val checkFile:(JSONObject)->Unit) {
    private class Value(val id:String,val name:String,val stored:BackupStoredValue)
    private class Manifest(val stored:BackupStoredValue)
    private val values=linkedMapOf<String,Value>()
    private val manifests=mutableListOf<Manifest>()
    private var pending:Pair<String,BackupValueTransfer>?=null
    private var submittedCharacters=0L;private var submittedChunks=0L
    val hasManifest get()=manifests.isNotEmpty()
    var settled=false;private set
    val retainedCount get()=values.size+manifests.size
    val characters get()=values.values.sumOf{it.stored.characters.toLong()}+manifests.sumOf{it.stored.characters.toLong()}
    val largestValue get()=values.values.maxOfOrNull{it.stored.characters}?:0
    data class Statistics(val values:Int,val manifests:Int,val characters:Long,val chunks:Long)
    fun statistics()=Statistics(values.size,manifests.size,submittedCharacters,submittedChunks)
    fun append(name:String,id:String,index:Int,last:Boolean,text:String,assertCurrent:()->Unit={}) {
        assertCurrent();requireName(name);check(id !in values&&retainedCount<10000){"BACKUP_TRANSFER_BUSY"}
        if(index==0){pending?.second?.clear();pending=name to BackupValueTransfer(storage(),view,"$binding:field-v2:${name.length}:$name",assertCurrent)}
        val transfer=pending?:error("BACKUP_TRANSFER_ORDER")
        check(transfer.first==name){"BACKUP_TRANSFER_ORDER"}
        val stored=transfer.second.append(id,index,last,text);submittedCharacters+=text.length;submittedChunks++
        stored?.let{
            try{assertCurrent();values[id]=Value(id,name,stored);pending=null}catch(error:Throwable){stored.clear();throw error}
        }
    }
    fun commit(raw:String,assertCurrent:()->Unit={}) {
        assertCurrent();check(raw.length in 1..32768&&retainedCount<10000){"E2EE_SOURCE_TOO_LARGE"}
        check(pending==null){"BACKUP_TRANSFER_BUSY"}
        val parsed=manifestMetadata(raw)
        check(parsed.keys().asSequence().toSet()==setOf("protocol","fields","settled","file")&&parsed.get("protocol")==2&&parsed.get("settled") is Boolean){"E2EE_ARCHIVE_SOURCE_INVALID"}
        val fields=parsed.getJSONArray("fields");check(fields.length()<=64){"E2EE_ARCHIVE_SOURCE_INVALID"};val names=mutableSetOf<String>()
        var logical=JSONObject().put("protocol",1).put("state",JSONObject()).put("settled",parsed.getBoolean("settled")).put("file",parsed.get("file")).toString().length.toLong()
        for(index in 0 until fields.length()){
            val field=fields.getJSONObject(index);check(field.keys().asSequence().toSet()==setOf("name","id")){"E2EE_ARCHIVE_SOURCE_INVALID"}
            check(field.get("name") is String&&field.get("id") is String){"E2EE_ARCHIVE_SOURCE_INVALID"}
            val name=field.getString("name");requireName(name);check(names.add(name)){"E2EE_ARCHIVE_SOURCE_INVALID"}
            val value=values[field.getString("id")]?:error("E2EE_ARCHIVE_VALUE_ORIGIN_REQUIRED")
            check(value.name==name){"E2EE_ARCHIVE_VALUE_ORIGIN_REQUIRED"}
            logical+=JSONObject.quote(name).length+1L+value.stored.characters+(if(index>0)1 else 0)
            check(logical<=BackupStoredValue.MAX){"E2EE_SOURCE_TOO_LARGE"}
        }
        if(!parsed.isNull("file"))checkFile(parsed.getJSONObject("file"))
        // Persist the ORIGINAL small manifest before acknowledging it. Its
        // ordinal in the encrypted locator distinguishes restart history.
        val transfer=BackupValueTransfer(storage(),view,"$binding:manifest-v2:${manifests.size}",assertCurrent)
        val stored=try{requireNotNull(transfer.append(UUID.randomUUID().toString(),0,true,raw))}finally{transfer.clear()}
        try{assertCurrent();manifests+=Manifest(stored);settled=parsed.getBoolean("settled")}catch(error:Throwable){stored.clear();throw error}
    }
    fun source(owner:String,epoch:Long):(BackupSourceSink)->Unit {
        val originalValues=values.values.toList();val originalManifests=manifests.toList()
        return {sink->
            sink.syntax("{\"protocol\":2,\"ownerId\":");sink.quoted(owner);sink.syntax(",\"sessionEpoch\":$epoch,\"viewId\":");sink.quoted(view)
            sink.syntax(",\"rawManifest\":")
            if(originalManifests.isEmpty())sink.syntax("null")else originalManifests.last().stored.reader().use{sink.quoted(it,32768)}
            sink.syntax(",\"rawManifests\":[")
            for((index,manifest)in originalManifests.withIndex()){if(index>0)sink.syntax(",");manifest.stored.reader().use{sink.quoted(it,32768)}}
            sink.syntax("],\"values\":[")
            for((index,value)in originalValues.withIndex()){
                if(index>0)sink.syntax(",");sink.syntax("{\"id\":");sink.quoted(value.id);sink.syntax(",\"name\":");sink.quoted(value.name)
                sink.syntax(",\"rawJson\":");value.stored.reader().use{sink.quoted(it)};sink.syntax("}")
            }
            sink.syntax("]}")
        }
    }
    fun capture(owner:String,epoch:Long):JSONObject {
        // History lives in authenticated spill, not a second retained plaintext
        // String list. Only this explicit, bounded capture materializes it.
        val history=manifests.map{manifest->manifest.stored.reader().use{it.readText()}}
        return JSONObject().put("protocol",2).put("ownerId",owner).put("sessionEpoch",epoch).put("viewId",view)
            .put("rawManifest",history.lastOrNull()?:JSONObject.NULL).put("rawManifests",JSONArray(history))
            .put("values",JSONArray(values.values.map{value->JSONObject().put("id",value.id).put("name",value.name).put("rawJson",value.stored.reader().use{it.readText()})}))
    }
    fun detach(){pending?.second?.clear();pending=null}
    fun clear(){detach();values.values.forEach{it.stored.clear()};manifests.forEach{it.stored.clear()};values.clear();manifests.clear();settled=false}
    override fun toString()="BackupValueInventory([redacted])"
    companion object {
        fun requireName(name:String){check(name.matches(Regex("[A-Za-z][A-Za-z0-9_-]{0,63}"))&&name !in setOf("__proto__","prototype","constructor")){"E2EE_ARCHIVE_SOURCE_INVALID"}}
        val PHYSICAL_MAX=BackupStoredValue.MAX+BackupStoredValue.PREFIX.length+BackupStoredValue.SUFFIX.length
    }
}
