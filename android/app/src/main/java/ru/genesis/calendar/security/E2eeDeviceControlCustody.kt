package ru.genesis.calendar.security

import org.json.JSONObject
import java.security.MessageDigest
import java.time.Instant

/** Typed read-only retention: no restore, signer, retry, device approval or
 * membership authority can be reconstructed from these local originals. */
internal object E2eeDeviceControlCustody{
    private fun invalid():Nothing=error("E2EE_MIGRATION_HISTORY_REVIEW_REQUIRED")
    fun inspect(device:UnlockedE2eeDevice,vault:E2eeSourceReadVault,personalScopeId:String?,current:()->Unit,claim:(String,String,String,String)->Unit){
        fun document(id:String,validate:(JSONObject)->JSONObject,scope:(JSONObject)->String):JSONObject{
            val readIds=mutableSetOf<String>()
            val opened=E2eeDeviceDocument(device,id,validate,current,{domain,objectId->vault.read(domain,objectId).also{current();if(it!=null)readIds.add(objectId)}}).load()?:invalid();current()
            val scopeId=scope(opened.value);val row=vault.read("draft",id)?:invalid()
            try{current();if(row.serial!=opened.serial)error("E2EE_SOURCE_HISTORY_CHANGED");val descriptor=E2eeFileManifestJson.readPrivateDocument(row.bytes)
                if(descriptor.opt("format")=="genesis-device-document-v1"){
                    val prefix="device-doc:"+E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(id.toByteArray(Charsets.UTF_8)));val size=descriptor.getInt("size");val slots=descriptor.getJSONArray("slots")
                    for(part in ((size+E2eeFiles.CHUNK_BYTES-1)/E2eeFiles.CHUNK_BYTES) until slots.length()){
                        val objectId="$prefix:$part"
                        val retained=vault.read("draft",objectId)?:invalid();try{current();if(retained.serial!=slots.getLong(part)||retained.bytes.size !in 1..E2eeFiles.CHUNK_BYTES)invalid();readIds.add(objectId)}finally{retained.bytes.fill(0)}
                    }
                }
            }finally{row.bytes.fill(0)}
            for(objectId in readIds)claim("draft",objectId,scopeId,"device-control-history");return opened.value
        }
        val markers=vault.listLocal("draft",E2eePersonalDeviceEntry.MARKER);current();if(markers.any{it!=E2eePersonalDeviceEntry.MARKER})invalid()
        if(markers.isNotEmpty())document(E2eePersonalDeviceEntry.MARKER,{E2eePersonalDeviceEntry.validateMarker(it,device.ownerId)},{marker->
            val target=marker.getJSONObject("target");if(!E2eeProductJson.same(target.getJSONObject("authority"),device.authorityPin)||personalScopeId!=null&&target.get("scopeId")!=personalScopeId)invalid();target.getString("scopeId")
        })
        val restores=vault.listLocal("draft","personal-content-restore:");current();for(id in restores){val scopeId=personalScopeId?:invalid();val intentId=id.removePrefix("personal-content-restore:");E2eeKeys.technical(intentId)
            document(id,{value->E2eeKeys.exact(value,setOf("format","ownerId","intentId","backupId","source","proposal","confirmed","started","complete"));if(value.get("format")!="genesis-personal-content-restore-v1"||value.get("ownerId")!=device.ownerId||value.get("intentId")!=intentId||value.get("started") !is Boolean||value.get("complete") !is Boolean)invalid();E2eeKeys.technical(value.getString("backupId"));E2eeKeys.exact(value.getJSONObject("source"),setOf("workspace","tasks"));JSONObject(value.toString())},{scopeId})
        }
        for(prefix in listOf("shared-bulk-private:","shared-bulk-recovery:","shared-bulk-recovery-history:")){for(id in vault.listLocal("draft",prefix)){current();val scopeId=personalScopeId?:invalid();document(id,{value->if(prefix=="shared-bulk-private:"){E2eeKeys.exact(value,setOf("format","ownerId","id","input","createdAt","expiresAt","planned","state","items","errorCode"));if(value.get("format")!="genesis-private-bulk-v1"||value.get("ownerId")!=device.ownerId||id!=prefix+value.getString("id")||value.get("planned") !is Boolean||value.getJSONArray("items").length()>100000)invalid()}else{E2eeKeys.exact(value,setOf("format","ownerId","value"));if(value.get("format")!="genesis-private-bulk-recovery-v1"||value.get("ownerId")!=device.ownerId||if(prefix=="shared-bulk-recovery:")id!=prefix+"v1"else !id.removePrefix(prefix).matches(Regex("[1-9][0-9]*")))invalid();value.getJSONObject("value")};JSONObject(value.toString())},{scopeId})}}
        for(id in vault.listLocal("draft","shared-transfer-private:")){current();val scopeId=personalScopeId?:invalid();document(id,{value->E2eePrivateTransferValues.validate(null,value,device.ownerId,id.removePrefix("shared-transfer-private:"))},{scopeId})}
        val requests=vault.listLocal("draft","invitation-recipient:");current()
        for(id in requests){val scopeId=personalScopeId?:invalid();val intentId=id.removePrefix("invitation-recipient:")
            document(id,{value->
                E2eeKeys.exact(value,setOf("format","ownerId","id","accept","intentId","result"));val invitationId=E2eeKeys.technical(value.getString("id"));if(value.get("format")!="genesis-invitation-recipient-request-v1"||value.get("ownerId")!=device.ownerId||value.get("accept") !is Boolean||value.get("intentId")!=intentId)invalid()
                val bytes=E2eeCommands.canonical(JSONObject().put("format","genesis-invitation-recipient-intent-v1").put("ownerId",device.ownerId).put("id",invitationId).put("accept",value.getBoolean("accept")))
                try{if(intentId!="invitation-response:"+E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(bytes)))invalid()}finally{bytes.fill(0)}
                if(!value.isNull("result")){
                    val result=value.getJSONObject("result");E2eeKeys.exact(result,setOf("intentId","response","pendingApproval"));val response=result.getJSONObject("response");E2eeKeys.exact(response,setOf("id","scopeId","kind","resourceId","spaceId","state","acceptedAt","deviceApprovalRequired"))
                    for(key in listOf("id","scopeId","resourceId","spaceId"))E2eeKeys.technical(response.getString(key))
                    if(result.get("intentId")!=intentId||result.get("pendingApproval")!=value.get("accept")||response.get("id")!=invitationId||response.get("kind") !in setOf("space","project")||response.get("state")!=(if(value.getBoolean("accept"))"pending"else"declined")||response.get("deviceApprovalRequired")!=true)invalid()
                    if(!response.isNull("acceptedAt"))Instant.parse(response.getString("acceptedAt"))
                }
                JSONObject(value.toString())
            },{scopeId})
        }
    }
}
