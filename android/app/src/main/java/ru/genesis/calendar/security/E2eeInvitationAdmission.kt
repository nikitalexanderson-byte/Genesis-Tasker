package ru.genesis.calendar.security

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** Pending records are routing, never device/capsule authority. Admission
 * always enters the complete ordinary durable membership review. */
internal class E2eeInvitationAdmission(private val context:Context,private val account:E2eeProductAccount,private val guard:()->Unit){
    private fun current(){guard();account.requireOpen();check(!account.offline){"E2EE_ONLINE_REQUIRED"}}
    @Synchronized fun list():JSONArray{
        current();val trust=E2eeSharedTrust(account);val pins=trust.list();current();val result=JSONArray()
        for(at in 0 until pins.length()){
            val directory=trust.open(pins.getJSONObject(at).getString("scopeId")).directory;current()
            if(directory.ownerId!=account.ownerId||directory.state!="active")continue
            check(directory.kind in setOf("space","project")){"E2EE_SCOPE_BINDING_MISMATCH"}
            val records=E2eeSharedRecords(context,account,directory.scopeId,directory.kind,directory.resourceId)
            val root=records.get(directory.kind,directory.resourceId);current();val title=root.getJSONObject("body").getJSONObject("record").optString("title",directory.resourceId)
            val client=account.sharedScope(directory.scopeId,directory.kind,directory.resourceId).client;var after=""
            while(true){
                val page=client.readPendingInvitationPage(after,50);current();E2eeKeys.exact(page,setOf("responses","nextAfter","checkpointHash","directoryRevision"))
                val rows=page.getJSONArray("responses");check(rows.length()<=50){"E2EE_INVITATION_RESPONSE_INVALID"};var previous=after
                for(index in 0 until rows.length()){
                    val operation=rows.getJSONObject(index)
                    E2eeMembershipAtomicContract.page(JSONObject().put("kind","operation").put("items",JSONArray().put(operation)))
                    check(operation.get("kind")=="invitation-admit"&&operation.get("invitationKind")==directory.kind&&operation.get("resourceId")==directory.resourceId&&operation.getString("invitationId")>previous){"E2EE_INVITATION_RESPONSE_INVALID"}
                    previous=operation.getString("invitationId");result.put(JSONObject().put("scopeId",directory.scopeId).put("title",title).put("operation",JSONObject(operation.toString())))
                    check(result.length()<=10000){"E2EE_INVITATION_LIST_TOO_LARGE"}
                }
                if(page.isNull("nextAfter"))break
                check(rows.length()==50&&page.getString("nextAfter")==previous&&previous>after){"E2EE_INVITATION_RESPONSE_INVALID"};after=previous
            }
        }
        return result
    }
}
