package ru.genesis.calendar.security

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** Real normal-repository adapters, kept separate from the wire coordinator. */
internal object E2eeNativeMembershipAtomicApply {
    private class Opened(val target:JSONObject,val scope:E2eeProductAccount.SharedScope,val records:E2eeSharedRecords)
    fun create(context:Context,account:E2eeProductAccount,transport:E2eeMembershipTransport,peerPorts:E2eeMembershipPeerPorts,guard:()->Unit):E2eeMembershipAtomicApply {
        val trust=E2eeSharedTrust(account)
        fun current(){guard();account.requireOpen();check(!account.offline){"E2EE_ONLINE_REQUIRED"}}
        fun open(scopeId:String,owner:String):Opened {
            current();val target=E2eeDeviceAccessContract.target(peerPorts.target(scopeId));current()
            check(target.get("scopeId")==scopeId&&target.get("ownerId")==owner&&target.get("kind") in setOf("space","project")){"E2EE_SCOPE_BINDING_MISMATCH"}
            val scope=trust.open(scopeId);current();check(scope.directory.ownerId==owner&&scope.directory.kind==target.get("kind")&&scope.directory.resourceId==target.get("resourceId")){"E2EE_SCOPE_BINDING_MISMATCH"}
            return Opened(target,scope,E2eeSharedRecords(context,account,scopeId,target.getString("kind"),target.getString("resourceId")))
        }
        val currentGuard={current()};current();return E2eeMembershipAtomicApply(account,transport,object:E2eeMembershipAtomicApply.Ports{
            override val peers=peerPorts
            override fun current()=currentGuard()
            override fun scope(packet:JSONObject,receipt:JSONObject){
                val opened=open(receipt.getString("scopeId"),packet.getJSONObject("command").getString("ownerId"));opened.scope.client.confirmMembershipRotation(packet);current()
                opened.records.get(opened.target.getString("kind"),opened.target.getString("resourceId"));current()
            }
            override fun product(packet:JSONObject,receipt:JSONObject){
                val opened=open(receipt.getString("scopeId"),packet.getJSONObject("command").getString("ownerId"));opened.records.product.confirmPrepared(receipt.getString("intentId"),receipt.getJSONObject("result"));current()
            }
            override suspend fun acl(intentId:String){
                val stager=account.membershipAtomic();val state=stager.inspect(intentId);current();val refs=state.getJSONObject("plan").getJSONArray("pages")
                for(index in 0 until refs.length()){
                    val page=stager.readPlanPage(intentId,index);current();if(page.get("kind")!="acl")continue;val changes=page.getJSONArray("items");val targets=JSONArray()
                    for(at in 0 until changes.length()){val row=changes.getJSONObject(at);targets.put(JSONObject().put("table",row.get("table")).put("key",row.get("key")))}
                    val response=transport.membershipState(targets);current();E2eeKeys.exact(response,setOf("rows"));val rows=response.getJSONArray("rows");check(rows.length()==changes.length()){"E2EE_MEMBERSHIP_READBACK_MISMATCH"}
                    for(at in 0 until rows.length()){
                        val row=rows.getJSONObject(at);val wanted=changes.getJSONObject(at);E2eeKeys.exact(row,setOf("table","key","before","beforeHash"));val table=wanted.getString("table")
                        val after=if(wanted.isNull("after"))null else JSONObject(wanted.getJSONObject("key").toString()).apply{val values=wanted.getJSONObject("after");for(key in values.keys())put(key,values.get(key))}
                        check(row.get("table")==table&&E2eeProductJson.same(row.getJSONObject("key"),wanted.getJSONObject("key"))
                            &&row.get("beforeHash")==E2eeMembershipContract.beforeHash(table,if(row.isNull("before"))null else row.getJSONObject("before"))&&row.get("beforeHash")==E2eeMembershipContract.beforeHash(table,after)){"E2EE_MEMBERSHIP_READBACK_MISMATCH"}
                    }
                }
            }
        })
    }
}
