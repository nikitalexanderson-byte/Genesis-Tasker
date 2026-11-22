package ru.genesis.calendar.security

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** Actual pinned clients + decrypted normal records. Caller has already saved
 * full input and runs this foreground operation on IO with its original guard. */
internal object E2eeProjectCreationSelection {
    private class Opened(val trust:JSONObject,val scope:E2eeProductAccount.SharedScope,val records:E2eeSharedRecords,val index:JSONArray,val stamp:JSONArray,val coordinates:JSONObject){
        val heads=linkedMapOf<String,JSONObject>()
    }
    private fun changed():Nothing=error("E2EE_PROJECT_TOPOLOGY_CHANGED")
    private fun frame(value:E2eeDirectory.Verified)=JSONArray().put(value.ownerId).put(value.scopeId).put(value.kind).put(value.resourceId).put(value.state)
        .put(value.generation).put(value.cryptoEpoch).put(value.securityEpoch).put(value.keyId).put(value.checkpoint.revision).put(value.checkpoint.hash)
    fun capture(context:Context,account:E2eeProductAccount,input:JSONObject,guard:()->Unit):JSONObject {
        val location=E2eeProjectCreationContract.location(input);val current:()->Unit={guard();account.requireOpen()};current()
        check(!account.offline){"E2EE_ONLINE_REQUIRED"};val trust=E2eeSharedTrust(account);val known=trust.list();current()
        val opened=linkedMapOf<String,Opened>()
        fun open(kind:String,id:String):Opened {
            val key="$kind:$id";opened[key]?.let{return it}
            val pin=(0 until known.length()).map{known.getJSONObject(it)}.singleOrNull{it.get("kind")==kind&&it.get("resourceId")==id}?:error("E2EE_SHARED_FINGERPRINT_REQUIRED")
            val scope=trust.open(pin.getString("scopeId"));current();val directory=scope.directory;val own=directory.devices[account.device.deviceId]
            if(directory.ownerId!=pin.getString("ownerId")||directory.kind!=kind||directory.resourceId!=id||directory.scopeId!=pin.getString("scopeId")||directory.state!="active"
                ||!E2eeProductJson.same(directory.recoveryKit.getJSONObject("authority"),pin.getJSONObject("authority"))||own==null||own.revoked||own.userId!=account.ownerId)changed()
            val records=E2eeSharedRecords(context,account,directory.scopeId,kind,id);val index=records.index();current()
            return Opened(JSONObject(pin.toString()),scope,records,index,frame(directory),JSONObject().put("scopeId",directory.scopeId).put("generation",directory.generation)
                .put("directoryRevision",directory.checkpoint.revision).put("checkpointHash",directory.checkpoint.hash)).also{opened[key]=it}
        }
        fun head(scope:Opened,kind:String,id:String):Pair<JSONObject,JSONObject> {
            val entity=(0 until scope.index.length()).map{scope.index.getJSONObject(it)}.singleOrNull{it.get("entityId")=="$kind:$id"&&it.get("kind")==kind}?:error("E2EE_PRODUCT_ENTITY_MISSING")
            check(!entity.getBoolean("deleted")){"E2EE_PRODUCT_DELETED"};val value=scope.records.read(entity);current()
            check(!value.getBoolean("deleted")&&!value.isNull("body")){"E2EE_PRODUCT_DELETED"};val body=value.getJSONObject("body");val directory=scope.scope.directory
            if(body.get("kind")!=kind||body.get("scopeId")!=directory.scopeId||body.get("scopeKind")!=directory.kind||body.get("resourceId")!=directory.resourceId)changed()
            if(kind=="project"&&(entity.getJSONObject("metadata").getInt("protocol")!=2||!E2eeProductJson.same(entity.getJSONObject("metadata"),scope.records.domain.metadata(body))))error("E2EE_PROJECT_TOPOLOGY_REQUIRED")
            scope.heads[entity.getString("entityId")]=JSONObject(entity.toString())
            return JSONObject(scope.coordinates.toString()).put("entityId",entity.get("entityId")).put("revision",entity.get("revision")).put("payloadHash",entity.get("payloadHash")) to body
        }
        val space=open("space",location.getString("spaceId"));val spaceRoot=head(space,"space",location.getString("spaceId"));current()
        var parent:Opened?=null;var parentAnchor:JSONObject?=null
        if(!location.isNull("parentId")){parent=open("project",location.getString("parentId"));val root=head(parent,"project",location.getString("parentId"));current();val row=root.second.getJSONObject("record")
            if(row.get("space_id")!=location.get("spaceId")||E2eeCommands.integer(row.get("is_inbox"))!=0L||!row.isNull("archived_at"))changed();parentAnchor=root.first}
        var categoryAnchor:JSONObject?=null;var statusAnchor:JSONObject?=null
        if(!location.isNull("categoryId")){val category=head(space,"category",location.getString("categoryId"));current()
            if(category.second.get("table")!="shared_space_project_categories"||category.second.getJSONObject("record").get("space_id")!=location.get("spaceId"))changed();categoryAnchor=category.first}
        if(!location.isNull("boardStatusId")){val status=head(parent?:changed(),"status",location.getString("boardStatusId"));current();val row=status.second.getJSONObject("record")
            if(status.second.get("table")!="shared_project_statuses"||row.get("project_id")!=location.get("parentId")||row.getInt("is_chaos")!=0)changed();statusAnchor=status.first}
        for(value in opened.values){
            val after=value.scope.client.refresh();current();if(!E2eeProductJson.same(frame(after),value.stamp))changed()
            val index=value.records.index();current()
            for(expected in value.heads.values){val actual=(0 until index.length()).map{index.getJSONObject(it)}.singleOrNull{it.get("entityId")==expected.get("entityId")}
                if(actual==null||!E2eeProductJson.same(actual,expected))changed()}
            val final=value.scope.client.refresh();current();if(!E2eeProductJson.same(frame(final),value.stamp))changed()
        }
        val pins=trust.list();current();for(value in opened.values){
            val pin=(0 until pins.length()).map{pins.getJSONObject(it)}.singleOrNull{it.get("scopeId")==value.trust.get("scopeId")}
            if(pin==null||!E2eeProductJson.same(pin,value.trust))changed()
        }
        return E2eeProjectCreationContract.selection(JSONObject(location.toString()).put("spaceAnchor",spaceRoot.first).put("parentAnchor",parentAnchor?:JSONObject.NULL)
            .put("categoryAnchor",categoryAnchor?:JSONObject.NULL).put("statusAnchor",statusAnchor?:JSONObject.NULL))
    }
}
