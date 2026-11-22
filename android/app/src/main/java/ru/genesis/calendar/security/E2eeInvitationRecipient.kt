package ru.genesis.calendar.security

import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.time.Instant

/** Normal recipient routing uses the active personal signing device. A saved
 * response is consent only and never imports membership, device trust or keys. */
internal class E2eeInvitationRecipient(private val account:E2eeProductAccount,private val guard:()->Unit){
    private val client=account.client
    private fun current(){guard();account.requireOpen();check(!account.offline){"E2EE_ONLINE_REQUIRED"}}
    private fun invalid():Nothing=error("E2EE_INVITATION_RESPONSE_INVALID")
    private fun same(a:Any,b:Any)=E2eeProductJson.same(a,b)
    private fun intent(id:String,accept:Boolean):String{E2eeKeys.technical(id);val bytes=E2eeCommands.canonical(JSONObject().put("format","genesis-invitation-recipient-intent-v1").put("ownerId",account.ownerId).put("id",id).put("accept",accept));return try{"invitation-response:"+E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(bytes))}finally{bytes.fill(0)}}
    private fun response(value:JSONObject,id:String):JSONObject{
        E2eeKeys.exact(value,setOf("id","scopeId","kind","resourceId","spaceId","state","acceptedAt","deviceApprovalRequired"));for(key in listOf("id","scopeId","resourceId","spaceId"))E2eeKeys.technical(value.getString(key))
        if(value.get("id")!=id||value.get("kind") !in setOf("space","project")||value.get("state") !in setOf("unanswered","pending","declined","admitted","expired","unavailable")||value.get("deviceApprovalRequired")!=true)invalid();if(!value.isNull("acceptedAt"))Instant.parse(value.getString("acceptedAt"));return JSONObject(value.toString())
    }
    private fun document(id:String)=E2eeDeviceDocument(account.device,"invitation-recipient:$id",{value->
        E2eeKeys.exact(value,setOf("format","ownerId","id","accept","intentId","result"));if(value.get("format")!="genesis-invitation-recipient-request-v1"||value.get("ownerId")!=account.ownerId||value.get("accept") !is Boolean||value.get("intentId")!=id||intent(value.getString("id"),value.getBoolean("accept"))!=id||!value.isNull("result")&&value.opt("result") !is JSONObject)invalid();JSONObject(value.toString())
    },::current)
    @Synchronized fun list():JSONArray{current();val result=JSONArray();var after=""
        while(true){val page=client.readSharedInvitationPage(after,50);current();E2eeKeys.exact(page,setOf("invitations","nextAfter","checkpointHash","directoryRevision"));val items=page.getJSONArray("invitations");if(items.length()>50)invalid();var previous=after
            for(index in 0 until items.length()){val row=items.getJSONObject(index);E2eeKeys.exact(row,setOf("id","role","expiresAt","scope","spaceTitle","projectTitle","inviterName","encrypted","pendingApproval","admitted","deviceApprovalRequired"));val id=E2eeKeys.technical(row.getString("id"));val scope=row.getString("scope");val roles=if(scope=="space")setOf("admin","member","guest")else setOf("manager","member","commenter","viewer")
                if(id<=previous||scope !in setOf("space","project")||row.get("role") !in roles||listOf("spaceTitle","projectTitle","inviterName").any{row.getString(it).length>2000}||listOf("encrypted","pendingApproval","admitted","deviceApprovalRequired").any{row.get(it) !is Boolean}||row.getBoolean("encrypted")&&row.getString("projectTitle").isNotEmpty())invalid();Instant.parse(row.getString("expiresAt"));previous=id;result.put(JSONObject(row.toString()));if(result.length()>10000)error("E2EE_INVITATION_LIST_TOO_LARGE")
            }
            if(page.isNull("nextAfter"))return result;val next=page.getString("nextAfter");if(items.length()!=50||next!=previous||previous<=after)invalid();after=next
        }
    }
    @Synchronized fun respond(id:String,accept:Boolean):JSONObject{current();val intent=intent(id,accept);val store=document(intent);var saved=store.load();current();val value:JSONObject
        if(saved==null){value=JSONObject().put("format","genesis-invitation-recipient-request-v1").put("ownerId",account.ownerId).put("id",id).put("accept",accept).put("intentId",intent).put("result",JSONObject.NULL);val written=store.save(value,null);current();val observed=store.load();current();check(observed!=null&&observed.serial==written.serial&&same(observed.value,value)){"E2EE_LOCAL_CONFLICT"};saved=observed}else value=saved.value
        if(value.get("id")!=id||value.get("accept")!=accept)error("E2EE_IDEMPOTENCY_CONFLICT");val receipt=if(value.isNull("result"))client.executeService("shared-invitation-respond",JSONObject().put("id",id).put("accept",accept),intent)else value.getJSONObject("result");current();E2eeKeys.exact(receipt,setOf("intentId","response","pendingApproval"));val original=response(receipt.getJSONObject("response"),id)
        if(receipt.get("intentId")!=intent||receipt.get("pendingApproval")!=accept||original.get("state")!=(if(accept)"pending"else"declined"))invalid();val read=client.readSharedInvitationResponse(id);current();E2eeKeys.exact(read,setOf("response","checkpointHash","directoryRevision"));val state=response(read.getJSONObject("response"),id)
        if(listOf("scopeId","kind","resourceId","spaceId","acceptedAt").any{!same(state.get(it),original.get(it))}||state.get("state") !in (if(accept)setOf("pending","admitted")else setOf("declined")))error("E2EE_INVITATION_RESPONSE_CHANGED")
        if(value.isNull("result")){val before=requireNotNull(saved);val next=JSONObject(value.toString()).put("result",receipt);val written=store.save(next,before.serial);current();val after=store.load();current();check(written.serial==before.serial+1&&after!=null&&after.serial==written.serial&&same(after.value,next)){"E2EE_LOCAL_CONFLICT"}}
        return if(accept)JSONObject().put("projectId",if(state.get("kind")=="project")state.get("resourceId")else"").put("spaceId",state.get("spaceId")).put("pendingApproval",state.get("state")=="pending").put("admitted",state.get("state")=="admitted").put("deviceApprovalRequired",true).put("invitationId",id)else JSONObject().put("ok",true)
    }
}
