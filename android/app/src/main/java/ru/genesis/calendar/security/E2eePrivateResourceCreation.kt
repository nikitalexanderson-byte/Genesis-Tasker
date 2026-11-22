package ru.genesis.calendar.security

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import org.json.JSONArray
import java.time.Instant
import java.util.UUID

/** Durable private-space creation, matching web. Only the actual transition,
 * initial private-value readback and pending-invitation issuance can finish the
 * composed product flow. No recipient key/membership trust is granted here. */
internal class E2eePrivateResourceCreation(private val account:E2eeProductAccount,private val directory:suspend(String)->JSONObject,private val guard:()->Unit={}){
    private val mutex=Mutex()
    companion object {
        private const val PREFIX="shared-resource-create:"
        private val phases=listOf("draft","prepared","migrated","values","invitations","complete")
        private fun invalid():Nothing=error("E2EE_PRIVATE_RESOURCE_CREATE_INVALID")
        fun input(value:JSONObject):JSONObject {
            E2eeKeys.exact(value,setOf("title","description","invitations","coverImage","coverPosition"));val title=value.getString("title");val description=value.getString("description");val invitations=value.getJSONArray("invitations")
            if(value.get("title") !is String||value.get("description") !is String||title.trim().isEmpty()||title.length>160||description.length>5000||invitations.length()>20)invalid()
            if(!value.isNull("coverImage")){val image=value.getString("coverImage");if(image.length>4*1024*1024||image.isNotEmpty()&&!Regex("^data:image/(?:png|jpeg|webp);base64,").containsMatchIn(image))invalid()}
            val position=value.getJSONObject("coverPosition");E2eeKeys.exact(position,setOf("x","y"));for(key in listOf("x","y")){val raw=position.get(key) as? Number?:invalid();if(!raw.toDouble().isFinite()||raw.toDouble() !in 0.0..100.0)invalid()}
            val emails=mutableSetOf<String>();for(at in 0 until invitations.length()){val invite=invitations.getJSONObject(at);E2eeKeys.exact(invite,setOf("email","role","permissions"));val email=invite.getString("email")
                if(email.length>320||!Regex("\\S+@(?:gmail|googlemail)\\.com",RegexOption.IGNORE_CASE).matches(email)||!emails.add(email.lowercase(java.util.Locale.ROOT))||invite.get("role") !in setOf("admin","member","guest"))invalid()
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
    private fun current(){guard();account.requireOpen()}
    private fun document(id:String):E2eeDeviceDocument {E2eeKeys.technical(id);return E2eeDeviceDocument(account.device,PREFIX+id,{value->
        E2eeKeys.exact(value,setOf("format","ownerId","intentId","scopeId","resourceId","kind","input","createdAt","preparation","phase"))
        if(value.get("format")!="genesis-private-resource-create-v1"||value.get("ownerId")!=account.ownerId||value.get("intentId")!=id||value.get("kind")!="space"||value.get("phase") !in phases)invalid()
        Instant.parse(value.getString("createdAt"));E2eeKeys.technical(value.getString("scopeId"));E2eeKeys.technical(value.getString("resourceId"));input(value.getJSONObject("input"))
        if(!value.isNull("preparation"))preparation(value.getJSONObject("preparation"),value)else if(value.get("phase")!="draft")invalid();JSONObject(value.toString())
    },::current)}
    suspend fun create(value:JSONObject):String {val held=input(value);return mutex.withLock{current();val id=UUID.randomUUID().toString();val document=document(id)
        val intent=JSONObject().put("format","genesis-private-resource-create-v1").put("ownerId",account.ownerId).put("intentId",id).put("scopeId","space:${UUID.randomUUID()}").put("resourceId",UUID.randomUUID().toString())
            .put("kind","space").put("input",held).put("createdAt",Instant.now().toString()).put("preparation",JSONObject.NULL).put("phase","draft")
        document.save(intent,null);current();check(E2eeProductJson.same(document.load()?.value,intent)){"E2EE_PRIVATE_RESOURCE_CREATE_UNVERIFIED"};id
    }}
    fun inspect(id:String):JSONObject {current();val value=document(id).load()?.value?:error("E2EE_PRIVATE_RESOURCE_CREATE_REQUIRED");current();return JSONObject(value.toString())}
    fun pending():List<JSONObject>{current();val ids=account.device.vault.listLocal("draft",PREFIX);current();return ids.map{inspect(it.removePrefix(PREFIX))}.filter{it.getString("phase")!="complete"}}
    suspend fun advance(id:String,phase:String):JSONObject=mutex.withLock{
        current();check(phase in phases){"E2EE_PRIVATE_RESOURCE_CREATE_INVALID"};val document=document(id);val before=document.load()?:error("E2EE_PRIVATE_RESOURCE_CREATE_REQUIRED")
        val at=phases.indexOf(before.value.getString("phase"));val next=phases.indexOf(phase);if(next<=at)return@withLock before.value
        check(next==at+1&&!before.value.isNull("preparation")){"E2EE_PRIVATE_RESOURCE_CREATE_UNVERIFIED"}
        document.save(JSONObject(before.value.toString()).put("phase",phase),before.serial);current();inspect(id)
    }
    suspend fun issueInvitations(id:String):Unit=mutex.withLock{
        current();val intent=inspect(id);check(phases.indexOf(intent.getString("phase"))>=phases.indexOf("values")){"E2EE_PRIVATE_RESOURCE_CREATE_UNVERIFIED"}
        val input=intent.getJSONObject("input").getJSONArray("invitations");if(input.length()==0)return@withLock
        val invitations=JSONArray();val ids=mutableListOf<String>()
        for(at in 0 until input.length()){
            val raw=java.security.MessageDigest.getInstance("SHA-256").digest("GENESIS-PRIVATE-INVITATION\u0000v1\u0000${intent.getString("ownerId")}\u0000$id\u0000$at".toByteArray(Charsets.UTF_8))
            raw[6]=((raw[6].toInt() and 15) or 80).toByte();raw[8]=((raw[8].toInt() and 63) or 128).toByte();val hex=raw.take(16).joinToString(""){"%02x".format(it.toInt() and 255)}
            val invitationId="${hex.substring(0,8)}-${hex.substring(8,12)}-${hex.substring(12,16)}-${hex.substring(16,20)}-${hex.substring(20)}";ids+=invitationId
            val row=input.getJSONObject(at);invitations.put(JSONObject().put("id",invitationId).put("email",row.getString("email").trim().lowercase(java.util.Locale.ROOT)).put("role",row.get("role")).put("permissions",row.get("permissions")))
        }
        val scope=account.sharedScope(intent.getString("scopeId"),"space",intent.getString("resourceId"));val requestId="resource-create-invitations:$id"
        val receipt=scope.client.executeService("shared-invitations-issue",JSONObject().put("invitations",invitations),requestId);current();E2eeKeys.exact(receipt,setOf("intentId","invitations","deviceApprovalRequired"))
        check(receipt.getString("intentId")==requestId&&receipt.get("deviceApprovalRequired")==true&&receipt.getJSONArray("invitations").length()==ids.size){"E2EE_INVALID_RECEIPT"}
        for(at in ids.indices){val row=receipt.getJSONArray("invitations").getJSONObject(at);E2eeKeys.exact(row,setOf("id","expiresAt"));check(row.getString("id")==ids[at]){"E2EE_INVALID_RECEIPT"};Instant.parse(row.getString("expiresAt"))}
        val response=scope.client.readInvitationState(ids);current();E2eeKeys.exact(response,setOf("invitations","checkpointHash","directoryRevision"));val rows=response.getJSONArray("invitations");check(rows.length()==ids.size){"E2EE_INVALID_RESPONSE"}
        for(at in ids.indices){val row=rows.getJSONObject(at);val expected=invitations.getJSONObject(at);E2eeKeys.exact(row,setOf("id","email","role","permissions","createdBy","state"))
            check(listOf("id","email","role").all{row.get(it)==expected.get(it)}&&row.get("createdBy")==account.ownerId&&E2eeProductJson.same(row.get("permissions"),expected.get("permissions"))&&row.get("state") in setOf("pending","consumed")){"E2EE_RECIPIENT_REVIEW_REQUIRED"}}
    }
    suspend fun applyInitialValues(id:String,records:E2eeSharedRecords):JSONObject=mutex.withLock{
        current();val intent=inspect(id);check(phases.indexOf(intent.getString("phase"))>=phases.indexOf("migrated")&&records.domain.scopeId==intent.getString("scopeId")
            &&records.domain.scopeKind=="space"&&records.domain.resourceId==intent.getString("resourceId")){"E2EE_MIGRATION_UNVERIFIED"}
        val source=records.sourceTable("shared_spaces");current();check(source.length()==1&&source.getJSONObject(0).get("id")==intent.get("resourceId")){"E2EE_PRIVATE_SEED_REQUIRED"}
        val input=intent.getJSONObject("input");val position=input.getJSONObject("coverPosition")
        val record=JSONObject(source.getJSONObject(0).toString()).put("title",input.getString("title").trim()).put("description",input.get("description"))
            .put("cover_image",input.get("coverImage")).put("cover_x",position.get("x")).put("cover_y",position.get("y")).put("updated_at",intent.getJSONObject("preparation").get("createdAt")).put("revision",2)
        val body=JSONObject().put("format","genesis-shared-record-v1").put("kind","space").put("scopeId",intent.get("scopeId")).put("scopeKind","space").put("resourceId",intent.get("resourceId"))
            .put("table","shared_spaces").put("record",record).put("related",JSONObject()).put("execution","live")
        val domain=records.domain;val request="resource-create-values:$id"
        records.product.stage(JSONArray().put(JSONObject().put("action","update").put("entityId",domain.recordKey("space",record)).put("kind","space").put("expectedRevision",1)
            .put("parentId",domain.parent(body)).put("metadata",domain.metadata(body)).put("body",body)),request);current();records.flush(request);current()
        val read=records.get("space",intent.getString("resourceId"));current();check(!read.getBoolean("deleted")&&read.getLong("revision")==2L&&E2eeProductJson.same(read.getJSONObject("body"),body)){"E2EE_PRIVATE_RESOURCE_CREATE_UNVERIFIED"};intent
    }
    suspend fun prepare(id:String,secret:ByteArray,savedKit:JSONObject):Pair<JSONObject,E2eeDirectory.Verified>{
        val held=secret.copyOf();val kit=try{JSONObject(savedKit.toString())}catch(error:Throwable){held.fill(0);throw error}
        try{return mutex.withLock{current();check(!account.offline){"E2EE_ONLINE_REQUIRED"};val intent=inspect(id);val target=JSONObject().put("ownerId",account.ownerId).put("scopeId",intent.get("scopeId")).put("kind","space").put("resourceId",intent.get("resourceId"))
            var resolved:JSONObject?=null;val transport=object:E2eeScopeSetupTransport{
                override suspend fun directory(scopeId:String):JSONObject=this@E2eePrivateResourceCreation.directory(scopeId)
                override suspend fun bootstrap(packet:JSONObject):JSONObject {
                    resolved?.let{return JSONObject(it.toString())}
                    current();val receipt=preparation(account.client.executeService("resource-create-prepare",JSONObject().put("bootstrap",packet),id),intent);current()
                    check(receipt.get("bootstrapHash")==E2eeCommands.hash(packet.getJSONObject("command"))){"E2EE_INVALID_RECEIPT"};val document=document(id);val before=document.load()?:error("E2EE_LOCAL_CONFLICT")
                    check(E2eeProductJson.same(before.value.getJSONObject("input"),intent.getJSONObject("input"))){"E2EE_LOCAL_CONFLICT"}
                    if(!before.value.isNull("preparation"))check(E2eeProductJson.same(before.value.getJSONObject("preparation"),receipt)){"E2EE_IDEMPOTENCY_CONFLICT"}
                    else document.save(JSONObject(before.value.toString()).put("preparation",receipt),before.serial);current();resolved=JSONObject(receipt.toString());return receipt
                }
            }
            val setup=E2eeScopeSetup(account.device,target,transport,::current);val packet=setup.prepare(held,kit,0);current()
            if(intent.isNull("preparation"))transport.bootstrap(packet)else check(intent.getJSONObject("preparation").get("bootstrapHash")==E2eeCommands.hash(packet.getJSONObject("command"))){"E2EE_INVALID_RECEIPT"}
            current();val verified=setup.submit();current();val document=document(id);val before=document.load()?:error("E2EE_PRIVATE_RESOURCE_CREATE_UNVERIFIED")
            if(before.value.isNull("preparation")||verified.state !in setOf("preparing","uploading","verified","active")||verified.kind!="space"||verified.resourceId!=intent.getString("resourceId"))invalid()
            if(before.value.get("phase")=="draft")document.save(JSONObject(before.value.toString()).put("phase","prepared"),before.serial);current();inspect(id) to verified
        }}finally{held.fill(0)}
    }
    override fun toString()="E2eePrivateResourceCreation([redacted])"
}
