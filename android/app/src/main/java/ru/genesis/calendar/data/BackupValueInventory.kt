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
    private class Manifest(val raw:String,val stored:BackupStoredValue)
    private val values=linkedMapOf<String,Value>()
    private val manifests=mutableListOf<Manifest>()
    private var pending:Pair<String,BackupValueTransfer>?=null
    private var submittedCharacters=0L;private var submittedChunks=0L
    var rawManifest:String?=null;private set
    var settled=false;private set
    val retainedCount get()=values.size+manifests.size
    val characters get()=values.values.sumOf{it.stored.characters.toLong()}+manifests.sumOf{it.raw.length.toLong()}
    val largestValue get()=values.values.maxOfOrNull{it.stored.characters}?:0
    data class Statistics(val values:Int,val manifests:Int,val characters:Long,val chunks:Long)
    fun statistics()=Statistics(values.size,manifests.size,submittedCharacters,submittedChunks)
    fun append(name:String,id:String,index:Int,last:Boolean,text:String) {
        requireName(name);check(id !in values&&retainedCount<10000){"BACKUP_TRANSFER_BUSY"}
        if(index==0){pending?.second?.clear();pending=name to BackupValueTransfer(storage(),view,"$binding:field-v2:${name.length}:$name")}
        val transfer=pending?:error("BACKUP_TRANSFER_ORDER")
        check(transfer.first==name){"BACKUP_TRANSFER_ORDER"}
        val stored=transfer.second.append(id,index,last,text);submittedCharacters+=text.length;submittedChunks++
        stored?.let{
            values[id]=Value(id,name,stored);pending=null
        }
    }
    fun commit(raw:String) {
        check(raw.length in 1..32768&&retainedCount<10000){"E2EE_SOURCE_TOO_LARGE"}
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
        val transfer=BackupValueTransfer(storage(),view,"$binding:manifest-v2:${manifests.size}")
        val stored=try{requireNotNull(transfer.append(UUID.randomUUID().toString(),0,true,raw))}finally{transfer.clear()}
        manifests+=Manifest(raw,stored);rawManifest=raw;settled=parsed.getBoolean("settled")
    }
    fun capture(owner:String,epoch:Long):JSONObject=JSONObject().put("protocol",2).put("ownerId",owner).put("sessionEpoch",epoch).put("viewId",view)
        .put("rawManifest",rawManifest?:JSONObject.NULL)
        .put("rawManifests",JSONArray(manifests.map{manifest->manifest.stored.reader().use{source->source.readText()}.also{check(it==manifest.raw){"BACKUP_FORM_INTEGRITY"}}}))
        .put("values",JSONArray(values.values.map{value->JSONObject().put("id",value.id).put("name",value.name).put("rawJson",value.stored.reader().use{it.readText()})}))
    fun detach(){pending?.second?.clear();pending=null}
    fun clear(){detach();values.values.forEach{it.stored.clear()};manifests.forEach{it.stored.clear()};values.clear();manifests.clear();rawManifest=null;settled=false}
    override fun toString()="BackupValueInventory([redacted])"
    companion object {
        fun requireName(name:String){check(name.matches(Regex("[A-Za-z][A-Za-z0-9_-]{0,63}"))&&name !in setOf("__proto__","prototype","constructor")){"E2EE_ARCHIVE_SOURCE_INVALID"}}
        val PHYSICAL_MAX=BackupStoredValue.MAX+BackupStoredValue.PREFIX.length+BackupStoredValue.SUFFIX.length
    }
}
