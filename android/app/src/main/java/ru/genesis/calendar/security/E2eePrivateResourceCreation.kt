package ru.genesis.calendar.security

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import java.time.Instant
import java.util.UUID

/** Durable private-space PREPARATION, matching web. No plaintext create,
 * completed-resource flag, membership approval or automatic command replay. */
internal class E2eePrivateResourceCreation(private val account:E2eeProductAccount,private val directory:suspend(String)->JSONObject){
    private val mutex=Mutex()
    companion object {
        private const val PREFIX="shared-resource-create:"
        private fun invalid():Nothing=error("E2EE_PRIVATE_RESOURCE_CREATE_INVALID")
        fun input(value:JSONObject):JSONObject {
            E2eeKeys.exact(value,setOf("title","description","invitations","coverImage","coverPosition"));val title=value.getString("title");val description=value.getString("description");val invitations=value.getJSONArray("invitations")
            if(value.get("title") !is String||value.get("description") !is String||title.trim().isEmpty()||title.length>120||description.length>5000||invitations.length()>20)invalid()
            if(!value.isNull("coverImage")){val image=value.getString("coverImage");if(image.length>4*1024*1024||image.isNotEmpty()&&!Regex("^data:image/(?:png|jpeg|webp);base64,").containsMatchIn(image))invalid()}
            val position=value.getJSONObject("coverPosition");E2eeKeys.exact(position,setOf("x","y"));for(key in listOf("x","y")){val raw=position.get(key) as? Number?:invalid();if(!raw.toDouble().isFinite()||raw.toDouble() !in 0.0..100.0)invalid()}
            val emails=mutableSetOf<String>();for(at in 0 until invitations.length()){val invite=invitations.getJSONObject(at);E2eeKeys.exact(invite,setOf("email","role","permissions"));val email=invite.getString("email")
                if(email.length>320||!Regex("\\S+@\\S+\\.\\S+").matches(email)||!emails.add(email.lowercase(java.util.Locale.ROOT))||invite.get("role") !in setOf("admin","member","guest"))invalid()
                val permissions=invite.getJSONObject("permissions");E2eeKeys.exact(permissions,setOf("createProjects","editTasks","organizeTasks","comment","manageProjects","inviteMembers"));if(permissions.keys().asSequence().any{permissions.get(it) !is Boolean})invalid()
            };return JSONObject(value.toString())
        }
        fun preparation(value:JSONObject,expected:JSONObject):JSONObject {
            E2eeKeys.exact(value,setOf("intentId","kind","resourceId","scopeId","spaceId","inboxId","statuses","state","bootstrapHash","directoryRevision","checkpointHash","createdAt"))
            if(listOf("intentId","resourceId","scopeId").any{value.get(it)!=expected.get(it)}||value.get("spaceId")!=expected.get("resourceId")||value.get("kind")!="space"||value.get("state")!="preparing"||E2eeCommands.integer(value.get("directoryRevision"),1)!=1L)invalid()
            Instant.parse(value.getString("createdAt"));E2eeKeys.technical(value.getString("inboxId"));E2eeEnvelope.decode(value.getString("bootstrapHash"),32);E2eeEnvelope.decode(value.getString("checkpointHash"),32);if(value.get("bootstrapHash")!=value.get("checkpointHash"))invalid()
            val statuses=value.getJSONArray("statuses");if(statuses.length()!=2)invalid();val ids=mutableSetOf<String>();for(at in 0 until statuses.length()){val status=statuses.getJSONObject(at);E2eeKeys.exact(status,setOf("id","isDone"));if(!ids.add(E2eeKeys.technical(status.getString("id")))||E2eeCommands.integer(status.get("isDone"))!=at.toLong())invalid()};return JSONObject(value.toString())
        }
    }
    private fun current(){account.requireOpen()}
    private fun document(id:String):E2eeDeviceDocument {E2eeKeys.technical(id);return E2eeDeviceDocument(account.device,PREFIX+id,{value->
        E2eeKeys.exact(value,setOf("format","ownerId","intentId","scopeId","resourceId","kind","input","createdAt","preparation","phase"))
        if(value.get("format")!="genesis-private-resource-create-v1"||value.get("ownerId")!=account.ownerId||value.get("intentId")!=id||value.get("kind")!="space"||value.get("phase") !in setOf("draft","prepared"))invalid()
        Instant.parse(value.getString("createdAt"));E2eeKeys.technical(value.getString("scopeId"));E2eeKeys.technical(value.getString("resourceId"));input(value.getJSONObject("input"))
        if(!value.isNull("preparation"))preparation(value.getJSONObject("preparation"),value)else if(value.get("phase")=="prepared")invalid();JSONObject(value.toString())
    },::current)}
    suspend fun create(value:JSONObject):String {val held=input(value);return mutex.withLock{current();val id=UUID.randomUUID().toString();val document=document(id)
        val intent=JSONObject().put("format","genesis-private-resource-create-v1").put("ownerId",account.ownerId).put("intentId",id).put("scopeId","space:${UUID.randomUUID()}").put("resourceId",UUID.randomUUID().toString())
            .put("kind","space").put("input",held).put("createdAt",Instant.now().toString()).put("preparation",JSONObject.NULL).put("phase","draft")
        document.save(intent,null);current();check(E2eeProductJson.same(document.load()?.value,intent)){"E2EE_PRIVATE_RESOURCE_CREATE_UNVERIFIED"};id
    }}
    fun inspect(id:String):JSONObject {current();val value=document(id).load()?.value?:error("E2EE_PRIVATE_RESOURCE_CREATE_REQUIRED");current();return JSONObject(value.toString())}
    fun pending():List<JSONObject>{current();val ids=account.device.vault.listLocal("draft",PREFIX);current();return ids.map{inspect(it.removePrefix(PREFIX))}}
    suspend fun prepare(id:String,secret:ByteArray,savedKit:JSONObject):Pair<JSONObject,E2eeDirectory.Verified>{
        val held=secret.copyOf();val kit=try{JSONObject(savedKit.toString())}catch(error:Throwable){held.fill(0);throw error}
        try{return mutex.withLock{current();check(!account.offline){"E2EE_ONLINE_REQUIRED"};val intent=inspect(id);val target=JSONObject().put("ownerId",account.ownerId).put("scopeId",intent.get("scopeId")).put("kind","space").put("resourceId",intent.get("resourceId"))
            val setup=E2eeScopeSetup(account.device,target,object:E2eeScopeSetupTransport{
                override suspend fun directory(scopeId:String):JSONObject=this@E2eePrivateResourceCreation.directory(scopeId)
                override suspend fun bootstrap(packet:JSONObject):JSONObject {
                    current();val receipt=preparation(account.client.executeService("resource-create-prepare",JSONObject().put("bootstrap",packet),id),intent);current();val document=document(id);val before=document.load()?:error("E2EE_LOCAL_CONFLICT")
                    check(E2eeProductJson.same(before.value.getJSONObject("input"),intent.getJSONObject("input"))){"E2EE_LOCAL_CONFLICT"}
                    if(!before.value.isNull("preparation"))check(E2eeProductJson.same(before.value.getJSONObject("preparation"),receipt)){"E2EE_IDEMPOTENCY_CONFLICT"}
                    else document.save(JSONObject(before.value.toString()).put("preparation",receipt),before.serial);current();return receipt
                }
            },::current)
            setup.prepare(held,kit,0);current();val verified=setup.submit();current();val document=document(id);val before=document.load()?:error("E2EE_PRIVATE_RESOURCE_CREATE_UNVERIFIED")
            if(before.value.isNull("preparation")||verified.state !in setOf("preparing","active")||verified.kind!="space"||verified.resourceId!=intent.getString("resourceId"))invalid()
            if(before.value.get("phase")!="prepared")document.save(JSONObject(before.value.toString()).put("phase","prepared"),before.serial);current();inspect(id) to verified
        }}finally{held.fill(0)}
    }
    override fun toString()="E2eePrivateResourceCreation([redacted])"
}
