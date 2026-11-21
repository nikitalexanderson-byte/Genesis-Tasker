package ru.genesis.calendar.auth

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.data.GenesisDatabase
import ru.genesis.calendar.data.LocalCipher
import ru.genesis.calendar.data.withTransaction

/** Remaining native private work, including closed editors, all journal copies,
 * expired team caches and Room's member-owned shared-map stores. No old command
 * is replayed and no authority/session/account-key document enters the result. */
internal object NativeLocalWorkInventory{
    suspend fun capture(context:Context,database:GenesisDatabase,owner:String,kind:String,resource:String,
        mounted:JSONObject,assertCurrent:()->Unit):JSONObject{
        val account=CloudAccountSnapshot.scopeFor(owner);val cipher=LocalCipher();assertCurrent()
        val raw=PlanningDraftStore.captureMigration(context,owner,assertCurrent)+SharedOfflineStore(context).captureMigration(owner,assertCurrent)
        val entries=JSONArray();var size=0L
        fun add(store:String,key:String,original:String,plain:String,space:String?,project:String?){
            if(kind=="project"&&project!=resource||kind=="space"&&(space!=resource||project!=null&&project!=resource))return
            assertCurrent();size+=original.length+plain.toByteArray(Charsets.UTF_8).size;check(size<=64L*1024*1024&&entries.length()<10000){"E2EE_SOURCE_TOO_LARGE"}
            entries.put(JSONObject().put("store",store).put("key",key).put("raw",original)
                .put("content",JSONObject().put("rawDocument",plain).put("execution","history-only")).put("spaceId",space?:JSONObject.NULL).put("projectId",project?:JSONObject.NULL))
        }
        fun identity(value:JSONObject?,name:String,objectName:String):String?{
            val candidates=listOfNotNull(value?.optString(name)?.takeIf{it.isNotEmpty()},value?.optJSONObject(objectName)?.optString("id")?.takeIf{it.isNotEmpty()},
                value?.optJSONObject("payload")?.optString(name)?.takeIf{it.isNotEmpty()},value?.optJSONObject("payload")?.optJSONObject(objectName)?.optString("id")?.takeIf{it.isNotEmpty()}).toSet()
            check(candidates.size<=1){"E2EE_SCOPE_BINDING_MISMATCH"};return candidates.firstOrNull()
        }
        for(row in raw){val plain=row.getString("rawDocument");val parsed=org.json.JSONTokener(plain).nextValue();val value=parsed as? JSONObject
            val project=identity(value,"projectId","project");val space=identity(value,"spaceId","space")
            if(kind=="personal"||project==resource||space==resource)add(row.getString("store"),row.getString("key"),row.getString("encrypted"),plain,space,project)
        }
        database.withTransaction{assertCurrent();val dao=database.dao();val scopes=dao.migrationDocumentScopes(account,"$account:shared-mindmaps:")
            check(scopes.size<=10000){"E2EE_SOURCE_TOO_LARGE"}
            for(scope in scopes){
                val shared=scope.startsWith("$account:shared-mindmaps:");val space=if(shared)scope.removePrefix("$account:shared-mindmaps:")else null
                for(row in dao.backupDocuments(scope)){
                    val selected=if(shared)true else row.kind in setOf("assistant-plan-v1","admin-ad-draft-v1","shared-mindmap-conversions")||row.kind.startsWith("shared-")
                    if(!selected)continue
                    val aad=if(row.kind in setOf("assistant-plan-v1","admin-ad-draft-v1"))"$scope/${row.kind}/$owner"else "$scope/${row.kind}"
                    val plain=cipher.decrypt(row.encrypted,aad);assertCurrent()
                    // An entire space cache must stay in the member's personal
                    // retained work. Per-resource server sources use exact grants.
                    if(kind=="personal")add("Room:$scope",row.kind,row.encrypted,plain,space,null)
                }
            };assertCurrent()
        }
        val editors=JSONArray();val values=mounted.optJSONArray("editors")?:JSONArray()
        for(i in 0 until values.length()){val value=values.getJSONObject(i);check(value.getString("ownerId")==owner){"E2EE_SCOPE_BINDING_MISMATCH"}
            if(kind=="personal"||kind=="project"&&value.optString("projectId")==resource||kind=="space"&&value.optString("spaceId")==resource&&value.optString("projectId")==resource)editors.put(value)}
        assertCurrent();return JSONObject().put("platform","android").put("inventoryVersion",1).put("entries",entries).put("editors",editors)
    }
}
