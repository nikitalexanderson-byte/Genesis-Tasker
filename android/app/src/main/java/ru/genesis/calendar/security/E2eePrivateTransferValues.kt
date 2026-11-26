package ru.genesis.calendar.security

import android.content.Context
import org.json.JSONObject
import java.time.Instant

/** Local transfer history is typed retained content. Reading it never grants
 * destination access, restores a signer, or executes an imported operation. */
internal object E2eePrivateTransferValues{
    fun validate(context:Context?,value:JSONObject,owner:String,id:String):JSONObject{
        E2eeKeys.exact(value,setOf("format","ownerId","input","createdAt","source","destination","records","files","copied","verified","retired","complete"))
        check(value.get("format")=="genesis-private-transfer-v1"&&value.get("ownerId")==owner){"E2EE_TRANSFER_INVALID"}
        val input=value.getJSONObject("input");E2eeKeys.exact(input,setOf("requestId","sourceProjectId","destinationProjectId","rootTaskId","expectedRevision","statusId")+if(input.has("rootPatch"))setOf("rootPatch")else emptySet())
        for(key in listOf("requestId","sourceProjectId","destinationProjectId","rootTaskId"))E2eeKeys.technical(input.getString(key));if(input.getString("statusId").isNotEmpty())E2eeKeys.technical(input.getString("statusId"))
        if(input.has("rootPatch")){val patch=input.getJSONObject("rootPatch");check(patch.keys().asSequence().all{it in setOf("position","startDate","dueDate","startTime","endTime")}){"E2EE_TRANSFER_INVALID"}
            for(key in patch.keys())if(key=="position"){val number=patch.get(key);check(number is Number&&number.toDouble().isFinite()&&kotlin.math.abs(number.toDouble())<=1e12){"E2EE_TRANSFER_INVALID"}}else check(patch.isNull(key)||patch.get(key) is String&&patch.getString(key).length<=10){"E2EE_TRANSFER_INVALID"}}
        check(input.get("requestId")==id&&input.get("sourceProjectId")!=input.get("destinationProjectId")){"E2EE_TRANSFER_INVALID"};E2eeCommands.integer(input.get("expectedRevision"),1);Instant.parse(value.getString("createdAt"))
        for(key in listOf("copied","verified","retired","complete"))check(value.get(key) is Boolean){"E2EE_TRANSFER_INVALID"}
        fun domain(binding:JSONObject,project:String):E2eeSharedRecordDomain?{E2eeKeys.exact(binding,setOf("scopeId","kind","resourceId"));check(binding.get("kind")=="project"&&binding.get("resourceId")==project){"E2EE_SCOPE_BINDING_MISMATCH"};E2eeKeys.technical(binding.getString("scopeId"));return context?.let{E2eeSharedRecordDomain(it,binding.getString("scopeId"),"project",project)}}
        if(!value.isNull("source")){val source=value.getJSONObject("source");E2eeKeys.exact(source,setOf("binding","context","versions"));val parser=domain(source.getJSONObject("binding"),input.getString("sourceProjectId"));source.getJSONObject("context");val versions=source.getJSONArray("versions");check(versions.length()<=100000){"E2EE_TRANSFER_INVALID"}
            for(at in 0 until versions.length()){val version=versions.getJSONObject(at);E2eeKeys.exact(version,setOf("protocol","scopeId","entityId","kind","revision","parentId","deleted","metadata","body"));check(version.get("protocol")==1&&version.get("scopeId")==source.getJSONObject("binding").get("scopeId")&&version.get("deleted") is Boolean){"E2EE_SCOPE_BINDING_MISMATCH"};E2eeCommands.integer(version.get("revision"),1);E2eeProductContract.metadata(version.getString("kind"),version.getJSONObject("metadata"));if(!version.getBoolean("deleted"))parser?.validate(version.getString("kind"),version.getJSONObject("body"),version)}
        }
        val destination=if(value.isNull("destination"))null else domain(value.getJSONObject("destination"),input.getString("destinationProjectId"))
        if(!value.isNull("records")){check(!value.isNull("destination")){"E2EE_TRANSFER_INVALID"};val parser=destination;val records=value.getJSONArray("records");check(records.length() in 1..100){"E2EE_TRANSFER_INVALID"};for(at in 0 until records.length()){val record=records.getJSONObject(at);parser?.validate(record.getString("kind"),record)}}
        val files=value.getJSONArray("files");check(files.length()<=600){"E2EE_TRANSFER_INVALID"};for(at in 0 until files.length()){val file=files.getJSONObject(at);E2eeKeys.exact(file,setOf("source","destination","complete"));check(file.get("complete") is Boolean){"E2EE_TRANSFER_INVALID"}
            for(key in listOf("source","destination")){val reference=file.getJSONObject(key);E2eeKeys.exact(reference,setOf("objectId","size","filename","mediaType"));E2eeKeys.technical(reference.getString("objectId"));check(E2eeCommands.integer(reference.get("size"),1)<=E2eeFiles.MAX_FILE_BYTES&&reference.getString("filename").length<=512&&reference.getString("mediaType").length<=128){"E2EE_TRANSFER_INVALID"}}
            for(key in listOf("size","filename","mediaType"))check(file.getJSONObject("source").get(key)==file.getJSONObject("destination").get(key)){"E2EE_TRANSFER_INVALID"}
        }
        check((!value.getBoolean("complete")||value.getBoolean("copied")&&value.getBoolean("verified")&&value.getBoolean("retired"))&&(!value.getBoolean("retired")||value.getBoolean("verified"))&&(!value.getBoolean("verified")||value.getBoolean("copied"))&&(!value.getBoolean("copied")||!value.isNull("records"))){"E2EE_TRANSFER_INVALID"}
        return JSONObject(value.toString())
    }
}
