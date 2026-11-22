package ru.genesis.calendar.security

import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.security.Signature

/** Explicit read-only decoders for the normal product outboxes encountered
 * while migrating another scope. There is no transport or command executor. */
internal object E2eeRetainedProductCustody {
    class Options(val device:E2eeDeviceReadView,val vault:E2eeSourceReadVault,val inventory:E2eePrivatePaths,val outbox:List<String>,val copies:List<String>,
        val jobHistory:List<String>,val controlHistory:List<String>,val personalScopeId:String?,val current:()->Unit,
        val claimed:(String,String)->Boolean,val claim:(String,String,String,String)->Unit,
        val directory:(String,(E2eeDirectory.Verified)->Boolean)->E2eeDirectory.Verified)
    private fun invalid():Nothing=error("E2EE_PRODUCT_CUSTODY_REVIEW_REQUIRED")
    private fun number(value:JSONObject,key:String,min:Long=0,max:Long=9007199254740991)=E2eeCommands.integer(value.get(key),min).also{if(it>max)invalid()}
    private fun rows(array:JSONArray)=E2eeRetainedMigrationProof.rows(array)
    private fun strings(array:JSONArray)=E2eeRetainedMigrationProof.strings(array)
    private fun same(a:Any,b:Any)=E2eeRetainedMigrationProof.same(a,b)
    private fun hash(value:String)=E2eeRetainedMigrationProof.hash(value.toByteArray(Charsets.UTF_8))
    private val uuid=Regex("[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}")
    private class Packet(val command:JSONObject,val frame:E2eeDirectory.Verified)
    private class Header(val id:String,val context:JSONObject,val hash:String)
    private class Group(val context:JSONObject,val size:Long,val hash:String,val filename:String,val mediaType:String,val headers:List<Header>)
    fun inspect(options:Options){Reader(options).run()}
    private class Reader(private val options:Options){
        private val device=options.device;private val vault=options.vault;private val actor=vault.localIdentity();private val groups=mutableMapOf<String,MutableList<String>>();private val proofs=mutableMapOf<String,Group>()
        private val atomicStates=mutableMapOf<String,JSONObject>()
        private val atomicPacketManifests=mutableMapOf<String,JSONObject>()
        private val atomicApplies=mutableMapOf<String,JSONObject>()
        private fun current(){options.current();device.requireOpen();if(vault.localIdentity()!=actor)invalid()}
        private fun claim(domain:String,id:String,scope:String,role:String)=options.claim(domain,id,scope,role)
        private fun metadata(domain:String,id:String,immutable:Boolean=false):JSONObject {
            current();val row=vault.read(domain,id)?:invalid();return try{current();if(immutable&&row.serial!=1L)invalid();E2eeFileManifestJson.readMigrationHistory(row.bytes)}finally{row.bytes.fill(0)}
        }
        private fun packet(value:JSONObject):Packet {
            E2eeKeys.exact(value,setOf("command","signature"));val command=value.getJSONObject("command");val deviceId=command.getString("deviceId");if(deviceId !in setOf(actor.deviceId,"recovery"))invalid()
            val frame=options.directory(command.getString("scopeId")){it.checkpoint.revision==number(command,"expectedRevision")&&it.checkpoint.hash==command.get("checkpointHash")&&it.securityEpoch==number(command,"securityEpoch",1)};current()
            if(frame.ownerId!=command.get("ownerId"))invalid();val own=frame.devices[actor.deviceId]
            val key=if(deviceId=="recovery")frame.recoveryKit.getJSONObject("authority").getString("signingKey")else {if(own==null||own.revoked||own.userId!=actor.ownerId)invalid();own.signingKey}
            E2eeCommands.verify(value,E2eeDirectory.signingKey(key));current();return Packet(command,frame)
        }
        private fun roles(value:JSONArray):List<JSONObject>{if(value.length()>256)invalid();val ids=mutableSetOf<String>();return rows(value).onEach{row->E2eeKeys.exact(row,setOf("deviceId","role"));if(!ids.add(E2eeKeys.technical(row.getString("deviceId")))||!row.isNull("role")&&row.get("role") !in setOf("owner","writer","commenter","reader"))invalid()}}
        private fun capsule(value:JSONObject){E2eeKeys.exact(value,setOf("suite","enc","ciphertext"));if(value.get("suite")!=E2eeKeys.HPKE_SUITE)invalid();E2eeEnvelope.decode(value.getString("enc"),65);E2eeEnvelope.decode(value.getString("ciphertext"),48)}
        private fun rotation(value:JSONObject):Packet {
            val checked=packet(value);val command=checked.command;val frame=checked.frame;val payload=command.getJSONObject("payload")
            if(command.get("action")!="rotate-membership"||command.get("deviceId")!=actor.deviceId||frame.kind=="personal"||frame.ownerId!=actor.ownerId||frame.devices[actor.deviceId]?.role!="owner")invalid()
            E2eeKeys.exact(payload,setOf("membershipHash","revokedDeviceIds","roleChanges","cryptoEpoch","securityEpoch","keyId","capsules","recoveryCapsule","retiredManifestHash","retiredObjectCount"));E2eeEnvelope.decode(payload.getString("membershipHash"),32);E2eeEnvelope.decode(payload.getString("retiredManifestHash"),32);number(payload,"retiredObjectCount",0,10000);E2eeKeys.technical(payload.getString("keyId"))
            if(number(payload,"cryptoEpoch",1)!=frame.cryptoEpoch+1||number(payload,"securityEpoch",1)!=frame.securityEpoch+1)invalid()
            val changes=roles(payload.getJSONArray("roleChanges"));val removed=strings(payload.getJSONArray("revokedDeviceIds"));removed.forEach{E2eeKeys.technical(it)};val live=frame.devices.values.filter{!it.revoked}
            if(removed.toSet().size!=removed.size||changes.size+removed.size!=live.size||(changes.map{it.getString("deviceId")}+removed).toSet().size!=live.size)invalid()
            for(known in live){val change=changes.singleOrNull{it.get("deviceId")==known.deviceId};if(change==null&&known.deviceId !in removed||known.userId==frame.ownerId&&change?.opt("role")!="owner"||known.userId!=frame.ownerId&&change?.opt("role")=="owner")invalid()}
            val capsules=rows(payload.getJSONArray("capsules"));if(changes.any{it.isNull("role")}||capsules.size!=changes.size)invalid();val recipients=mutableSetOf<String>()
            for(entry in capsules){E2eeKeys.exact(entry,setOf("deviceId","capsule"));val id=E2eeKeys.technical(entry.getString("deviceId"));if(!recipients.add(id)||changes.none{it.get("deviceId")==id})invalid();capsule(entry.getJSONObject("capsule"))}
            capsule(payload.getJSONObject("recoveryCapsule"));val own=capsules.singleOrNull{it.get("deviceId")==actor.deviceId}?:invalid()
            E2eeKeys.openRoot(own.getJSONObject("capsule"),device.readKeys().receiving,E2eeKeys.RootRecipient(frame.ownerId,frame.scopeId,number(payload,"cryptoEpoch",1),payload.getString("keyId"),actor.deviceId));current();return checked
        }
        private fun group(id:String):Group {
            proofs[id]?.let{return it};val names=groups[id]?.sortedBy{it.substringAfterLast(':').toInt()}?:invalid();if(names.isEmpty()||names.withIndex().any{it.value!="$id:cipher:${it.index}"})invalid()
            val headers=names.map{name->val envelope=E2eeEnvelope.Envelope.fromJson(metadata("outbox",name,true));Header(name,envelope.context.toJson(),E2eeEnvelope.payloadHash(envelope))};val last=headers.last();val context=last.context
            val frame=options.directory(context.getString("scopeId")){it.cryptoEpoch==number(context,"cryptoEpoch",1)&&it.securityEpoch==number(context,"securityEpoch",1)&&it.keyId==context.get("keyId")&&it.generation==number(context,"dataGeneration",1)};current()
            val own=frame.devices[actor.deviceId]?:invalid();if(own.userId!=actor.ownerId||context.get("ownerId")!=frame.ownerId||context.get("deviceId")!=actor.deviceId||number(context,"writerProtocol",1)!=9L||number(context,"schemaVersion",1)!=1L||options.inventory.required(frame.kind).none{context.get("domain") in it.domains})invalid()
            val signer=E2eeDirectory.contentSigningKey(frame,context);val root=E2eeKeys.openRoot(own.capsule,device.readKeys().receiving,E2eeKeys.RootRecipient(frame.ownerId,frame.scopeId,frame.cryptoEpoch,frame.keyId,actor.deviceId));current()
            val byId=mutableMapOf<String,Header>();val used=mutableSetOf<String>()
            for(header in headers){val c=header.context;if(listOf("ownerId","scopeId","deviceId","cryptoEpoch","securityEpoch","keyId","dataGeneration","writerProtocol","schemaVersion").any{c.get(it)!=context.get(it)}||header!==last&&(c.get("domain")!="attachment"||number(c,"revision",1)!=1L)||byId.put(c.getString("domain")+"\u0000"+c.getString("objectId"),header)!=null)invalid()}
            fun load(header:Header):E2eeEnvelope.Envelope {val envelope=E2eeEnvelope.Envelope.fromJson(metadata("outbox",header.id,true));if(!same(envelope.context.toJson(),header.context)||E2eeEnvelope.payloadHash(envelope)!=header.hash)invalid();claim("outbox",header.id,frame.scopeId,"product-cipher");current();return envelope}
            val manifest=load(last);val digest=MessageDigest.getInstance("SHA-256");var size=0L;var filename="";var mediaType="application/json"
            if(context.get("domain")=="shared-comment"){if(headers.size!=1)invalid();val bytes=E2eeEnvelope.open(root,signer,manifest.context,manifest);try{current();if(bytes.size>65536)invalid();size=bytes.size.toLong();digest.update(bytes)}finally{bytes.fill(0)}}
            else {val opened=E2eeFiles.openStream(root,signer,manifest.context,manifest,{objectId->val chunk=byId["attachment\u0000$objectId"]?:invalid();if(chunk===last||!used.add(chunk.id))invalid();load(chunk)},::current){bytes->current();size+=bytes.size;digest.update(bytes)};filename=opened.filename;mediaType=opened.mediaType}
            if(used.size!=headers.size-1)invalid();val plaintextHash=E2eeEnvelope.encode(digest.digest());val parts=((size+E2eeFiles.CHUNK_BYTES-1)/E2eeFiles.CHUNK_BYTES).toInt();val expected=(0 until parts).map{"$id:$it"};if(vault.listLocal("draft","$id:").sorted()!=expected.sorted())invalid()
            val draftHash=MessageDigest.getInstance("SHA-256");var draftSize=0L
            for(at in 0 until parts){current();val name="$id:$at";val row=vault.read("draft",name)?:invalid();try{current();if(row.serial!=1L||row.bytes.size.toLong()!=minOf(E2eeFiles.CHUNK_BYTES.toLong(),size-draftSize))invalid();draftHash.update(row.bytes);draftSize+=row.bytes.size;claim("draft",name,frame.scopeId,"product-draft")}finally{row.bytes.fill(0)}}
            if(draftSize!=size||E2eeEnvelope.encode(draftHash.digest())!=plaintextHash)invalid();return Group(context,size,plaintextHash,filename,mediaType,headers).also{proofs[id]=it}
        }
        private fun job(value:JSONObject,id:String,domain:String){
            E2eeKeys.exact(value,setOf("protocol","scopeId","domain","objectId","generation","cryptoEpoch","keyId","expected","size","metadata","draftId","draftParts","plan","uploaded","pending","cancelling","complete")+(if(value.has("originId"))setOf("originId")else emptySet()))
            val draft=value.getString("draftId");val plan=rows(value.getJSONArray("plan"));if(value.getInt("protocol")!=1||!uuid.matches(draft)||plan.size !in 1..258||value.get("complete") !is Boolean)invalid()
            val uploaded=number(value,"uploaded",0,plan.size.toLong());val size=number(value,"size",0,E2eeFiles.MAX_FILE_BYTES.toLong());number(value,"expected");number(value,"generation",1);number(value,"cryptoEpoch",1);listOf("scopeId","objectId","keyId").forEach{E2eeKeys.technical(value.getString(it))}
            if(number(value,"draftParts")!=(size+E2eeFiles.CHUNK_BYTES-1)/E2eeFiles.CHUNK_BYTES||value.getBoolean("complete")!=(uploaded==plan.size.toLong())||value.getBoolean("complete")&&(!value.isNull("pending")||!value.isNull("cancelling")))invalid()
            if(value.has("originId")&&!value.isNull("originId"))E2eeKeys.technical(value.getString("originId"));val metadata=value.getJSONObject("metadata");E2eeKeys.exact(metadata,setOf("filename","mediaType"));if(metadata.getString("filename").length>512||metadata.getString("mediaType").length>128)invalid()
            val proof=group(draft);if(listOf("scopeId","domain","objectId","keyId").any{value.get(it)!=proof.context.get(it)}||number(value,"cryptoEpoch",1)!=number(proof.context,"cryptoEpoch",1)||number(value,"generation",1)!=number(proof.context,"dataGeneration",1)||number(value,"expected")+1!=number(proof.context,"revision",1)||size!=proof.size||metadata.get("filename")!=proof.filename||metadata.get("mediaType")!=proof.mediaType||plan.size!=proof.headers.size)invalid()
            for((at,item)in plan.withIndex()){E2eeKeys.exact(item,setOf("recordId","hash","expected"));if(item.get("recordId")!="$draft:cipher:$at"||item.get("hash")!=proof.headers[at].hash||number(item,"expected")!=(if(at==plan.lastIndex)number(value,"expected")else 0L))invalid()}
            if(domain=="outbox"){if(id!="job:"+hash(value.getString("scopeId")+"\u0000"+value.getString("domain")+"\u0000"+value.getString("objectId")))invalid()}
            else if(!Regex("$draft:(?:rebase|completed|cancel):[a-f0-9-]{36}").matches(id)||!uuid.matches(id.substringAfterLast(':')))invalid()
            (if(value.isNull("pending"))null else value.getJSONObject("pending"))?.let{pending->val checked=packet(pending);val command=checked.command;val payload=command.getJSONObject("payload");E2eeKeys.exact(payload,setOf("envelope","expectedObjectRevision","migrationId","fence"));val item=plan.getOrNull(uploaded.toInt())?:invalid();val envelope=E2eeEnvelope.Envelope.fromJson(payload.getJSONObject("envelope"))
                if(command.get("action")!="put"||command.get("deviceId")!=actor.deviceId||command.get("scopeId")!=value.get("scopeId")||!payload.isNull("migrationId")||number(payload,"fence")!=0L||number(payload,"expectedObjectRevision")!=number(item,"expected")||envelope.context.toJson().get("operationId")!=command.get("operationId")||E2eeEnvelope.payloadHash(envelope)!=item.get("hash"))invalid()}
            (if(value.isNull("cancelling"))null else value.getJSONObject("cancelling"))?.let{val cancel=packet(it);val payload=cancel.command.getJSONObject("payload");E2eeKeys.exact(payload,setOf("original"));if(value.isNull("pending")||cancel.command.get("action")!="cancel-put"||cancel.command.get("scopeId")!=value.get("scopeId")||!same(payload.getJSONObject("original"),value.getJSONObject("pending")))invalid()}
            claim(domain,id,value.getString("scopeId"),"product-job")
        }
        private fun service(command:JSONObject,frame:E2eeDirectory.Verified){
            val action=command.getString("action");val payload=command.getJSONObject("payload")
            when(action){
                "shared-invitations-issue"->{
                    E2eeKeys.exact(payload,setOf("intentId","invitations"));val invitations=rows(payload.getJSONArray("invitations"));if(invitations.size !in 1..20)invalid();val ids=mutableSetOf<String>();val emails=mutableSetOf<String>()
                    if(frame.kind !in setOf("space","project"))invalid();val space=frame.kind=="space"
                    for(row in invitations){E2eeKeys.exact(row,setOf("id","email","role")+(if(space)setOf("permissions")else emptySet()));val email=row.getString("email");val pattern=if(space)"\\S+@(?:gmail|googlemail)\\.com"else"\\S+@\\S+\\.\\S+";val roles=if(space)setOf("admin","member","guest")else setOf("manager","member","commenter","viewer")
                        if(!ids.add(E2eeKeys.technical(row.getString("id")))||email.length>320||!Regex(pattern,RegexOption.IGNORE_CASE).matches(email)||!emails.add(email.lowercase(java.util.Locale.ROOT))||row.get("role") !in roles)invalid()
                        if(space&&!row.isNull("permissions")){val permissions=row.getJSONObject("permissions");E2eeKeys.exact(permissions,setOf("createProjects","editTasks","organizeTasks","comment","manageProjects","inviteMembers"));if(permissions.keys().asSequence().any{permissions.get(it) !is Boolean})invalid()}}
                }
                "shared-invitation-respond"->{E2eeKeys.exact(payload,setOf("intentId","id","accept"));E2eeKeys.technical(payload.getString("id"));if(frame.kind!="personal"||frame.ownerId!=actor.ownerId||payload.get("accept") !is Boolean)invalid()}
                "shared-invitation-revoke"->{E2eeKeys.exact(payload,setOf("intentId","id"));E2eeKeys.technical(payload.getString("id"))}
                "resource-create-prepare","resource-create-resolve"->{
                    val original=if(action=="resource-create-resolve"){
                        E2eeKeys.exact(payload,setOf("intentId","original"));payload.getJSONObject("original").also{E2eeKeys.exact(it,setOf("intentId","bootstrap","topology"));E2eeKeys.technical(it.getString("intentId"));if(payload.get("intentId")!="resource-create-resolve:"+it.getString("intentId"))invalid()}
                    }else payload
                    E2eeKeys.exact(original,if(original.has("topology"))setOf("intentId","bootstrap","topology")else setOf("intentId","bootstrap"));val initial=original.getJSONObject("bootstrap");val child=initial.getJSONObject("command")
                    val kind=child.getJSONObject("payload").getString("kind")
                    if(kind !in setOf("space","project")||(kind=="project")!=original.has("topology")||action=="resource-create-resolve"&&kind!="project")invalid()
                    if(kind=="project")E2eeProjectCreationContract.topology(original.getJSONObject("topology"),actor.ownerId)
                    if(child.get("action")!="bootstrap"||child.get("ownerId")!=actor.ownerId||child.get("deviceId")!=actor.deviceId||number(child,"expectedRevision")!=0L||child.get("checkpointHash")!="genesis"||number(child,"securityEpoch",1)!=1L)invalid()
                    val fresh=E2eeDirectory.verify(actor.ownerId,child.getString("scopeId"),frame.recoveryKit.getJSONObject("authority"),JSONArray().put(initial));current();val own=fresh.devices[actor.deviceId]?:invalid();val keys=device.readKeys().publicKeys
                    if(fresh.kind!=kind||fresh.generation!=1L||own.signingKey!=keys.get("signingKey")||own.receivingKey!=keys.get("receivingKey"))invalid()
                }
                "product-commit"->{E2eeKeys.exact(payload,setOf("intentId","operations"));val operations=rows(payload.getJSONArray("operations"));if(operations.size !in 1..100)invalid();operations.forEach{E2eeProductContract.operation(it)}}
                "product-approve"->{E2eeKeys.exact(payload,setOf("intentId","proposalId","entityId","baseRevision","payloadHash"));listOf("proposalId","entityId").forEach{E2eeKeys.technical(payload.getString(it))};number(payload,"baseRevision");E2eeEnvelope.decode(payload.getString("payloadHash"),32)}
                "product-bootstrap-start"->{E2eeKeys.exact(payload,setOf("intentId","bootstrapId","sourceManifestHash","expectedCount"));E2eeKeys.technical(payload.getString("bootstrapId"));E2eeEnvelope.decode(payload.getString("sourceManifestHash"),32);number(payload,"expectedCount",0,10000)}
                "product-bootstrap-stage"->{E2eeKeys.exact(payload,setOf("intentId","bootstrapId","partIndex","items"));E2eeKeys.technical(payload.getString("bootstrapId"));number(payload,"partIndex",0,9999);val items=rows(payload.getJSONArray("items"));if(items.size !in 1..100)invalid();for(item in items){E2eeKeys.exact(item,setOf("operation","authorId"));E2eeProductContract.operation(item.getJSONObject("operation"));E2eeKeys.technical(item.getString("authorId"))}}
                "product-bootstrap-complete"->{E2eeKeys.exact(payload,setOf("intentId","bootstrapId","parts","expectedCount"));E2eeKeys.technical(payload.getString("bootstrapId"));number(payload,"expectedCount",0,10000);val parts=rows(payload.getJSONArray("parts"));if(parts.size>10000)invalid();for(part in parts){E2eeKeys.exact(part,setOf("partIndex","proofHash"));number(part,"partIndex",0,9999);E2eeEnvelope.decode(part.getString("proofHash"),32)}}
                "advice-issue"->{E2eeKeys.exact(payload,setOf("intentId","dayKey","collection","expectedCount","objectId","payloadHash"));E2eeKeys.technical(payload.getString("dayKey"));number(payload,"expectedCount",0,8);E2eeEnvelope.decode(payload.getString("payloadHash"),32);if(payload.get("collection") !in setOf("aurora","philosophers")||payload.get("objectId")!="advice-live:"+payload.getString("intentId"))invalid()}
                "stoicheion-grant"->{E2eeKeys.exact(payload,setOf("intentId","kind","action","position","expectedRevision","periodKey","objectId","payloadHash"));number(payload,"expectedRevision");E2eeKeys.technical(payload.getString("periodKey"));E2eeEnvelope.decode(payload.getString("payloadHash"),32);if(!payload.isNull("position"))number(payload,"position",0,8);if(payload.get("kind") !in setOf("daily","spread","timeline")||payload.get("action") !in setOf("draw","spread-card","reveal","reroll")||payload.get("objectId")!="stoicheion-live:"+payload.getString("intentId"))invalid()}
                else->invalid()
            }
        }
        private fun control(value:JSONObject,id:String,domain:String){
            val base=if(domain=="outbox")id else id.substringBeforeLast(":attempt:",id);if(domain!="outbox"&&(base==id||!Regex("[1-9][0-9]*").matches(id.substringAfterLast(':'))))invalid()
            val checked=packet(value);val command=checked.command;val frame=checked.frame;val payload=command.getJSONObject("payload")
            when{
                base.startsWith("service:")->{E2eeKeys.technical(payload.getString("intentId"));if(command.get("deviceId")!=actor.deviceId||base!="service:"+hash(command.getString("action")+"\u0000"+payload.getString("intentId")))invalid();service(command,frame)}
                base.startsWith("membership-product:")->{E2eeKeys.exact(payload,setOf("intentId","membershipHash","operations"));E2eeKeys.technical(payload.getString("intentId"));E2eeEnvelope.decode(payload.getString("membershipHash"),32)
                    if(command.get("action")!="product-commit-bound"||command.get("deviceId")!=actor.deviceId||base!="membership-product:"+hash(command.getString("scopeId")+"\u0000"+payload.getString("intentId")))invalid()
                    val operations=rows(payload.getJSONArray("operations"));if(operations.size !in 1..100)invalid();operations.forEach{E2eeProductContract.operation(it)}}
                base.startsWith("aurora-manifest:")->{E2eeKeys.exact(payload,setOf("id","methodVersion","objectId","payloadHash"));E2eeKeys.technical(payload.getString("id"));E2eeKeys.technical(payload.getString("objectId"));E2eeEnvelope.decode(payload.getString("payloadHash"),32);payload.getString("methodVersion");if(base!="aurora-manifest:"+payload.getString("id")||command.get("action")!="aurora-result"||command.get("deviceId")!=actor.deviceId)invalid()}
                base.startsWith("enrollment:")->{
                    if(base!="enrollment:"+command.getString("scopeId")||command.get("action")!="enroll"||command.get("deviceId")!="recovery")invalid();E2eeKeys.exact(payload,setOf("challenge","capsule","historyCapsules","selfProof"));val challenge=payload.getJSONObject("challenge")
                    E2eeKeys.exact(challenge,setOf("id","scopeId","userId","role","sessionHash","deviceId","signingKey","receivingKey","nonce","expiresAt"));val ownKeys=device.readKeys().publicKeys
                    if(challenge.get("scopeId")!=command.get("scopeId")||challenge.get("userId")!=actor.ownerId||challenge.get("deviceId")!=actor.deviceId||challenge.get("signingKey")!=ownKeys.get("signingKey")||challenge.get("receivingKey")!=ownKeys.get("receivingKey")||challenge.get("role") !in setOf("owner","writer","commenter","reader"))invalid();number(challenge,"expiresAt",1);if(!Regex("[a-f0-9]{64}").matches(challenge.getString("sessionHash")))invalid()
                    val prefix="GENESIS-E2EE-ENROLLMENT\u0000v1\u0000".toByteArray(Charsets.UTF_8);val body=E2eeCommands.canonical(challenge);val proof=prefix+body
                    try{val signature=E2eeEnvelope.decode(payload.getString("selfProof"),64);val verifier=Signature.getInstance("SHA256withECDSA");verifier.initVerify(device.readKeys().signer);verifier.update(proof);if(!verifier.verify(E2eeEnvelope.p1363ToDer(signature)))invalid();current()}finally{body.fill(0);proof.fill(0)}
                    E2eeKeys.openRoot(payload.getJSONObject("capsule"),device.readKeys().receiving,E2eeKeys.RootRecipient(frame.ownerId,frame.scopeId,frame.cryptoEpoch,frame.keyId,actor.deviceId));current()
                    for(history in rows(payload.getJSONArray("historyCapsules"))){E2eeKeys.exact(history,setOf("cryptoEpoch","keyId","capsule"));val epoch=number(history,"cryptoEpoch",1,frame.cryptoEpoch-1);E2eeKeys.technical(history.getString("keyId"));E2eeKeys.openRoot(history.getJSONObject("capsule"),device.readKeys().receiving,E2eeKeys.RootRecipient(frame.ownerId,frame.scopeId,epoch,history.getString("keyId"),actor.deviceId));current()}
                }
                else->invalid()
            };claim(domain,id,frame.scopeId,"product-control")
        }
        private fun membership(value:JSONObject,id:String){
            E2eeKeys.exact(value,setOf("protocol","ownerId","intentId","scopeIds","changes","preview","review","batch","result")+(if(value.has("hashFormat"))setOf("hashFormat")else emptySet())+(if(value.has("ownerApprovals"))setOf("ownerApprovals")else emptySet()));val intent=E2eeKeys.technical(value.getString("intentId"));val scopes=strings(value.getJSONArray("scopeIds"));scopes.forEach{E2eeKeys.technical(it)};val changes=rows(value.getJSONArray("changes"))
            if(value.getInt("protocol")!=1||value.get("ownerId")!=actor.ownerId||id!="membership:$intent"||scopes.size>256||scopes!=scopes.toSet().sorted()||changes.size !in 1..200)invalid()
            E2eeMembershipContract.changes(value.getJSONArray("changes"),true)
            if(!value.has("hashFormat")||E2eeMembershipContract.grantReviewRequired(value.getJSONArray("changes"))){if(listOf("preview","review","batch","result").any{!value.isNull(it)}||value.has("ownerApprovals")&&value.getJSONArray("ownerApprovals").length()!=0)invalid();claim("outbox",id,options.personalScopeId?:invalid(),"membership-plan");return}
            if(value.get("hashFormat")!=E2eeMembershipContract.HASH_FORMAT)invalid()
            val changeHash=E2eeMembershipContract.changeHash(actor.ownerId,intent,value.getJSONArray("changes"),value.getJSONArray("scopeIds"))
            fun request()=E2eeMembershipExchange.request(JSONObject().put("format","genesis-membership-review-v1").put("hashFormat",E2eeMembershipContract.HASH_FORMAT).put("actorId",value.get("ownerId")).put("intentId",intent).put("scopeIds",value.get("scopeIds")).put("changes",value.get("changes")).put("preview",value.get("preview")))
            fun peer(raw:JSONObject):JSONObject {
                val source=request();val approval=E2eeMembershipExchange.approval(raw,source);val plan=rows(source.getJSONObject("preview").getJSONArray("scopePlans")).single{it.get("scopeId")==approval.get("scopeId")}
                val frame=options.directory(plan.getString("scopeId")){it.checkpoint.revision==number(plan,"directoryRevision",1)&&it.checkpoint.hash==plan.get("checkpointHash")&&it.cryptoEpoch==number(plan,"cryptoEpoch",1)&&it.securityEpoch==number(plan,"securityEpoch",1)};current()
                if(frame.ownerId!=plan.get("ownerId")||frame.kind!=plan.get("kind")||frame.resourceId!=plan.get("resourceId"))invalid();val packet=approval.getJSONObject("packet");val signer=frame.devices[packet.getJSONObject("command").getString("deviceId")]?:invalid()
                if(signer.revoked||signer.userId!=plan.get("ownerId")||signer.role!="owner")invalid();E2eeCommands.verify(packet,E2eeDirectory.signingKey(signer.signingKey));current()
                val live=frame.devices.values.filter{!it.revoked};val roles=rows(plan.getJSONArray("roles"));if(live.size!=roles.size)invalid()
                for(device in live){val role=roles.singleOrNull{it.get("deviceId")==device.deviceId}?:invalid();if(device.userId==frame.ownerId&&role.get("role")!="owner"||device.userId!=frame.ownerId&&role.get("role")=="owner")invalid()}
                return approval
            }
            if(value.has("ownerApprovals")){val approvals=rows(value.getJSONArray("ownerApprovals"));if(approvals.size>256)invalid();val seen=mutableSetOf<String>()
                for(row in approvals){E2eeKeys.exact(row,setOf("approval","verified"));if(row.get("verified") !is Boolean)invalid();val approval=E2eeMembershipExchange.approval(row.getJSONObject("approval"),request());if(!seen.add(approval.getString("scopeId")))invalid();if(row.getBoolean("verified"))peer(approval)}
            }
            (if(value.isNull("preview"))null else value.getJSONObject("preview"))?.let{preview->E2eeKeys.exact(preview,setOf("intentId","changeHash","scopePlans"));val plans=rows(preview.getJSONArray("scopePlans"));if(preview.get("intentId")!=intent||preview.get("changeHash")!=changeHash||plans.map{it.getString("scopeId")}.sorted()!=scopes)invalid()
                for(plan in plans){E2eeKeys.exact(plan,setOf("scopeId","ownerId","kind","resourceId","directoryRevision","checkpointHash","cryptoEpoch","securityEpoch","roles","manifest"));val frame=options.directory(plan.getString("scopeId")){it.checkpoint.revision==number(plan,"directoryRevision",1)&&it.checkpoint.hash==plan.get("checkpointHash")&&it.cryptoEpoch==number(plan,"cryptoEpoch",1)&&it.securityEpoch==number(plan,"securityEpoch",1)};current();if(frame.ownerId!=plan.get("ownerId")||frame.kind!=plan.get("kind")||frame.resourceId!=plan.get("resourceId"))invalid();roles(plan.getJSONArray("roles"));val manifest=plan.getJSONObject("manifest");E2eeKeys.exact(manifest,setOf("manifestHash","objectCount"));E2eeEnvelope.decode(manifest.getString("manifestHash"),32);number(manifest,"objectCount",0,10000)}
            }
            (if(value.isNull("review"))null else value.getJSONArray("review"))?.let{review->val preview=value.getJSONObject("preview");val plans=rows(preview.getJSONArray("scopePlans"));val reviews=rows(review);if(reviews.map{it.getString("scopeId")}.sorted()!=scopes)invalid();for(row in reviews){E2eeKeys.exact(row,setOf("scopeId","roles"));roles(row.getJSONArray("roles"));val plan=plans.singleOrNull{it.get("scopeId")==row.get("scopeId")}?:invalid();if(!same(row.getJSONArray("roles"),plan.getJSONArray("roles")))invalid()}}
            (if(value.isNull("batch"))null else value.getJSONObject("batch"))?.let{batch->E2eeKeys.exact(batch,setOf("intentId","changes","authorization","rotations"));if(value.isNull("review")||batch.get("intentId")!=intent||!same(E2eeMembershipContract.projection(batch.getJSONArray("changes")),E2eeMembershipContract.projection(value.getJSONArray("changes"))))invalid();val authority=packet(batch.getJSONObject("authorization"));val payload=authority.command.getJSONObject("payload");E2eeKeys.exact(payload,setOf("intentId","changeHash"));if(authority.command.get("action")!="membership-authorize"||authority.frame.kind!="personal"||authority.frame.ownerId!=actor.ownerId||payload.get("intentId")!=intent||payload.get("changeHash")!=changeHash)invalid()
                val actual=rows(batch.getJSONArray("rotations")).map{packet->val c=packet.getJSONObject("command")
                    if(c.get("deviceId")==actor.deviceId&&c.get("ownerId")==actor.ownerId){val checked=rotation(packet);if(checked.command.getJSONObject("payload").get("membershipHash")!=changeHash)invalid();checked.frame.scopeId}
                    else{val imported=rows(value.optJSONArray("ownerApprovals")?:JSONArray()).singleOrNull{row->row.getBoolean("verified")&&row.getJSONObject("approval").get("scopeId")==c.get("scopeId")&&same(row.getJSONObject("approval").getJSONObject("packet"),packet)}?:invalid();peer(imported.getJSONObject("approval")).getString("scopeId")}
                };if(actual.sorted()!=scopes)invalid()
            }
            (if(value.isNull("result"))null else value.getJSONObject("result"))?.let{if(value.isNull("batch")||it.get("intentId")!=intent||it.get("changeHash")!=changeHash)invalid()};claim("outbox",id,options.personalScopeId?:invalid(),"membership-plan")
        }
        private fun atomicState(intent:String):JSONObject {
            atomicStates[intent]?.let{return it};val scope=options.personalScopeId?:invalid();val id=E2eeMembershipAtomicContract.localId(actor.ownerId,intent)
            val state=E2eeMembershipAtomicContract.localState(metadata("outbox",id),actor.ownerId);val plan=state.getJSONObject("plan")
            if(plan.get("intentId")!=intent)invalid();atomicStates[intent]=state;claim("outbox",id,scope,"membership-atomic-stage")
            if(state.getBoolean("ready"))for(index in 0 until plan.getJSONArray("pages").length()){
                val pageId=E2eeMembershipAtomicContract.pageId(actor.ownerId,intent,index);E2eeMembershipAtomicContract.localPageMatches(state,metadata("outbox",pageId,true));current();claim("outbox",pageId,scope,"membership-atomic-page")
            };return state
        }
        private fun atomicSigned(state:JSONObject,page:JSONObject){
            val kind=page.getString("kind");if(kind !in setOf("rotation-packets","product-packets"))invalid();val plan=state.getJSONObject("plan");val change=E2eeMembershipAtomicContract.changeHash(plan)
            for(signed in rows(page.getJSONArray("items"))){val command=signed.getJSONObject("command");val payload=command.getJSONObject("payload");val scope=command.getString("scopeId")
                val frame=options.directory(scope){it.checkpoint.revision==number(command,"expectedRevision")&&it.checkpoint.hash==command.get("checkpointHash")&&it.securityEpoch==number(command,"securityEpoch",1)};current()
                val signer=frame.devices[command.getString("deviceId")]?:invalid();if(frame.ownerId!=command.get("ownerId")||scope !in strings(plan.getJSONArray("scopeIds"))||signer.revoked||payload.get("membershipHash")!=change)invalid()
                E2eeCommands.verify(signed,E2eeDirectory.signingKey(signer.signingKey));current()
                if(kind=="product-packets"){
                    E2eeKeys.exact(payload,setOf("intentId","membershipHash","operations"));E2eeKeys.technical(payload.getString("intentId"));val operations=rows(payload.getJSONArray("operations"))
                    if(signer.role !in setOf("owner","writer")||operations.size !in 1..100)invalid();for(operation in operations)if(E2eeProductContract.operation(operation).get("action")=="propose-complete")invalid();continue
                }
                if(signer.userId!=frame.ownerId||signer.role!="owner")invalid();E2eeKeys.exact(payload,setOf("membershipHash","revokedDeviceIds","roleChanges","cryptoEpoch","securityEpoch","keyId","capsules","recoveryCapsule","retiredManifestHash","retiredObjectCount"))
                E2eeKeys.technical(payload.getString("keyId"));E2eeEnvelope.decode(payload.getString("retiredManifestHash"),32);number(payload,"retiredObjectCount",0,10000)
                if(number(payload,"cryptoEpoch",1)!=frame.cryptoEpoch+1||number(payload,"securityEpoch",1)!=frame.securityEpoch+1)invalid()
                val changes=roles(payload.getJSONArray("roleChanges"));val removed=strings(payload.getJSONArray("revokedDeviceIds"));removed.forEach{E2eeKeys.technical(it)};val live=frame.devices.values.filter{!it.revoked}
                if(changes.any{it.isNull("role")}||changes.size+removed.size!=live.size||(changes.map{it.getString("deviceId")}+removed).toSet().size!=live.size)invalid()
                for(device in live){val change=changes.singleOrNull{it.get("deviceId")==device.deviceId};if(change==null&&device.deviceId !in removed||device.userId==frame.ownerId&&change?.opt("role")!="owner"||device.userId!=frame.ownerId&&change?.opt("role")=="owner")invalid()}
                val capsules=rows(payload.getJSONArray("capsules"));if(capsules.size!=changes.size)invalid();val recipients=mutableSetOf<String>()
                for(row in capsules){E2eeKeys.exact(row,setOf("deviceId","capsule"));if(!recipients.add(E2eeKeys.technical(row.getString("deviceId")))||changes.none{it.get("deviceId")==row.get("deviceId")})invalid();capsule(row.getJSONObject("capsule"))};capsule(payload.getJSONObject("recoveryCapsule"))
            }
        }
        private fun atomicPackets(state:JSONObject):JSONObject {
            val intent=state.getJSONObject("plan").getString("intentId");atomicPacketManifests[intent]?.let{return it};val scope=options.personalScopeId?:invalid();if(!state.getBoolean("ready"))invalid()
            val id=E2eeMembershipAtomicContract.packetsId(actor.ownerId,intent);val manifest=E2eeMembershipAtomicContract.localPackets(metadata("outbox",id),state)
            atomicPacketManifests[intent]=manifest;claim("outbox",id,scope,"membership-atomic-packets")
            if(manifest.getBoolean("ready")){
                val plan=state.getJSONObject("plan");val binding=E2eeMembershipAtomicContract.PacketBindings(plan)
                for(index in 0 until plan.getJSONArray("pages").length())binding.planPage(E2eeMembershipAtomicContract.localPageMatches(state,metadata("outbox",E2eeMembershipAtomicContract.pageId(actor.ownerId,intent,index),true)).getJSONObject("page"))
                for(index in 0 until manifest.getJSONArray("pages").length()){
                    val pageId=E2eeMembershipAtomicContract.packetPageId(actor.ownerId,intent,index);val page=E2eeMembershipAtomicContract.localPacketPageMatches(manifest,metadata("outbox",pageId,true)).getJSONObject("page")
                    binding.packetPage(page);atomicSigned(state,page);claim("outbox",pageId,scope,"membership-atomic-packet-page")
                };binding.complete()
            };return manifest
        }
        private fun atomicReceiptId(intent:String,index:Int)="membership-atomic-receipt-page:"+E2eeMembershipAtomicContract.stem(actor.ownerId,intent)+":"+index
        private fun atomicReceipt(value:JSONObject,id:String,apply:JSONObject):JSONObject {
            E2eeKeys.exact(value,setOf("format","ownerId","intentId","planHash","batchHash","index","page"));val index=number(value,"index",0,9999).toInt();val page=E2eeMembershipAtomicReceipts.page(value.getJSONObject("page"))
            if(apply.isNull("receipt"))invalid();val refs=apply.getJSONObject("receipt").getJSONArray("pages")
            if(value.get("format")!="genesis-membership-local-receipt-page-v2"||value.get("ownerId")!=actor.ownerId||listOf("intentId","planHash","batchHash").any{value.get(it)!=apply.get(it)}||id!=atomicReceiptId(apply.getString("intentId"),index)||index>=refs.length()||!same(E2eeMembershipAtomicReceipts.ref(index,page),refs.getJSONObject(index)))invalid()
            claim("outbox",id,options.personalScopeId?:invalid(),"membership-atomic-receipt-page");return page
        }
        private fun atomicApply(intent:String):JSONObject {
            atomicApplies[intent]?.let{return it};val scope=options.personalScopeId?:invalid();val id=E2eeMembershipAtomicApply.localId(actor.ownerId,intent)
            val apply=E2eeMembershipAtomicApply.validate(metadata("outbox",id),actor.ownerId);val state=atomicState(intent);val manifest=atomicPackets(state);val plan=state.getJSONObject("plan")
            if(apply.get("intentId")!=intent||apply.get("planHash")!=state.get("planHash")||apply.get("batchHash")!=manifest.get("batchHash")||!manifest.getBoolean("ready"))invalid()
            if(!apply.isNull("receipt"))E2eeMembershipAtomicReceipts.header(apply.getJSONObject("receipt"),plan,manifest.getJSONArray("pages"));atomicApplies[intent]=apply;claim("outbox",id,scope,"membership-atomic-apply")
            if(apply.getBoolean("complete")){
                if(apply.isNull("receipt")||state.getBoolean("cancelled"))invalid();val rotations=mutableMapOf<String,JSONObject>();val products=mutableMapOf<String,JSONObject>()
                for(index in 0 until manifest.getJSONArray("pages").length()){
                    val page=E2eeMembershipAtomicContract.localPacketPageMatches(manifest,metadata("outbox",E2eeMembershipAtomicContract.packetPageId(actor.ownerId,intent,index),true)).getJSONObject("page")
                    if(page.get("kind") !in setOf("rotation-packets","product-packets"))invalid();for(packet in rows(page.getJSONArray("items"))){val command=packet.getJSONObject("command");if(page.get("kind")=="rotation-packets")rotations[command.getString("scopeId")]=packet else products[command.getString("scopeId")+"\u0000"+command.getJSONObject("payload").getString("intentId")]=packet}
                }
                val scopes=mutableSetOf<String>();val seenProducts=mutableSetOf<String>();val receiptRefs=apply.getJSONObject("receipt").getJSONArray("pages")
                for(index in 0 until receiptRefs.length()){
                    val pageId=atomicReceiptId(intent,index);val page=atomicReceipt(metadata("outbox",pageId,true),pageId,apply)
                    for(row in rows(page.getJSONArray("items")))if(page.get("kind")=="scopes"){
                        val scopeId=row.getString("scopeId");val signed=rotations[scopeId]?:invalid();if(!scopes.add(scopeId))invalid();val command=signed.getJSONObject("command");val payload=command.getJSONObject("payload");val result=row.getJSONObject("result");val checkpoint=hash(command.getString("checkpointHash")+"\u0000"+E2eeCommands.hash(command))
                        val frame=options.directory(scopeId){it.checkpoint.revision==number(command,"expectedRevision")+1&&it.checkpoint.hash==checkpoint&&it.membershipHash==payload.get("membershipHash")};current()
                        if(row.get("ownerId")!=command.get("ownerId")||number(result,"directoryRevision",1)!=number(command,"expectedRevision")+1||result.get("checkpointHash")!=checkpoint||number(result,"cryptoEpoch",1)!=number(payload,"cryptoEpoch",1)
                            ||number(result,"securityEpoch",1)!=number(payload,"securityEpoch",1)||frame.cryptoEpoch!=number(payload,"cryptoEpoch",1)||frame.securityEpoch!=number(payload,"securityEpoch",1)||result.getBoolean("signInRequired")!=(payload.getJSONArray("revokedDeviceIds").length()>0))invalid()
                    }else{
                        val key=row.getString("scopeId")+"\u0000"+row.getString("intentId");val signed=products[key]?:invalid();if(!seenProducts.add(key))invalid();val command=signed.getJSONObject("command");val scopeId=command.getString("scopeId")
                        val frame=options.directory(scopeId){it.checkpoint.revision==number(command,"expectedRevision")&&it.checkpoint.hash==command.get("checkpointHash")&&it.securityEpoch==number(command,"securityEpoch",1)};current()
                        if(frame.devices[command.getString("deviceId")]?.userId!=row.get("actorId"))invalid();val accepted=options.directory(scopeId){it.checkpoint.revision==number(command,"expectedRevision")+1&&it.membershipHash==command.getJSONObject("payload").get("membershipHash")};current();if(accepted.cryptoEpoch!=frame.cryptoEpoch+1)invalid()
                        val operations=rows(command.getJSONObject("payload").getJSONArray("operations"));val results=rows(row.getJSONObject("result").getJSONArray("results"));if(operations.size!=results.size)invalid()
                        for(operation in operations){val result=results.singleOrNull{it.get("entityId")==operation.get("entityId")}?:invalid();if(number(result,"revision",1)!=number(operation,"expectedRevision")+1||result.get("payloadHash")!=operation.get("payloadHash"))invalid()}
                    }
                }
                if(scopes.sorted()!=strings(plan.getJSONArray("scopeIds"))||seenProducts.size!=products.size)invalid()
            };return apply
        }
        private fun atomic(value:JSONObject,id:String){
            val scope=options.personalScopeId?:invalid()
            when{
                id.startsWith("membership-atomic-v2:")->{val state=E2eeMembershipAtomicContract.localState(value,actor.ownerId);val intent=state.getJSONObject("plan").getString("intentId");if(id!=E2eeMembershipAtomicContract.localId(actor.ownerId,intent))invalid();atomicState(intent)}
                id.startsWith("membership-atomic-page:")->{val row=E2eeMembershipAtomicContract.localPage(value,actor.ownerId);val intent=row.getString("intentId");val state=atomicState(intent);if(id!=E2eeMembershipAtomicContract.pageId(actor.ownerId,intent,number(row,"index",0,9999).toInt()))invalid();E2eeMembershipAtomicContract.localPageMatches(state,value);E2eeMembershipAtomicContract.localPageMatches(state,metadata("outbox",id,true));claim("outbox",id,scope,"membership-atomic-page")}
                id.startsWith("membership-atomic-packets:")->{val intent=E2eeKeys.technical(value.getString("intentId"));val state=atomicState(intent);if(id!=E2eeMembershipAtomicContract.packetsId(actor.ownerId,intent))invalid();atomicPackets(state)}
                id.startsWith("membership-atomic-packet-page:")->{val intent=E2eeKeys.technical(value.getString("intentId"));val state=atomicState(intent);val manifest=atomicPackets(state);val checked=E2eeMembershipAtomicContract.localPacketPageMatches(manifest,metadata("outbox",id,true));if(id!=E2eeMembershipAtomicContract.packetPageId(actor.ownerId,intent,number(checked,"index",0,9999).toInt()))invalid();atomicSigned(state,checked.getJSONObject("page"));claim("outbox",id,scope,"membership-atomic-packet-page")}
                id.startsWith("membership-atomic-apply:")->{val apply=E2eeMembershipAtomicApply.validate(value,actor.ownerId);val intent=apply.getString("intentId");if(id!=E2eeMembershipAtomicApply.localId(actor.ownerId,intent))invalid();atomicApply(intent)}
                id.startsWith("membership-atomic-apply-request:")->{E2eeKeys.exact(value,setOf("format","ownerId","action","payload","packet"));val action=value.getString("action");val payload=E2eeMembershipAtomicReceipts.payload(action,value.getJSONObject("payload"));val apply=atomicApply(payload.getString("intentId"))
                    if(value.get("format")!="genesis-membership-apply-request-v2"||value.get("ownerId")!=actor.ownerId||payload.get("planHash")!=apply.get("planHash")||payload.get("batchHash")!=apply.get("batchHash")||id!=E2eeMembershipAtomicApply.requestId(actor.ownerId,action,payload)||!same(metadata("outbox",id,true),value))invalid()
                    if(action=="membership-atomic-commit"&&!apply.getBoolean("started")||action=="membership-atomic-receipt-page"&&(apply.isNull("receipt")||number(payload,"index",0,9999)>=apply.getJSONObject("receipt").getJSONArray("pages").length()))invalid()
                    val checked=packet(value.getJSONObject("packet"));current();if(checked.command.get("deviceId")!=actor.deviceId||checked.frame.scopeId!=scope||checked.frame.kind!="personal"||checked.frame.ownerId!=actor.ownerId||checked.frame.devices[actor.deviceId]?.role!="owner"||checked.command.get("action")!=action||!same(checked.command.getJSONObject("payload"),payload))invalid()
                    claim("outbox",id,scope,"membership-atomic-apply-control")
                }
                id.startsWith("membership-atomic-receipt-page:")->{val intent=E2eeKeys.technical(value.getString("intentId"));val apply=atomicApply(intent);atomicReceipt(metadata("outbox",id,true),id,apply)}
                else->{val request=E2eeMembershipAtomicContract.localRequest(value,actor.ownerId);val action=request.getString("action");val payload=request.getJSONObject("payload");val state=atomicState(payload.getString("intentId"))
                    if(id!=E2eeMembershipAtomicContract.requestId(actor.ownerId,action,payload)||payload.get("planHash")!=state.get("planHash")||!same(metadata("outbox",id,true),value))invalid()
                    if(action=="membership-atomic-page"){
                        val index=number(payload,"index",0,9999).toInt();val manifest=if(payload.get("phase")=="packets")atomicPackets(state)else null;val refs=manifest?.getJSONArray("pages")?:state.getJSONObject("plan").getJSONArray("pages")
                        if(!state.getBoolean("ready")||manifest!=null&&!manifest.getBoolean("ready")||index>=refs.length()||refs.getJSONObject(index).get("pageHash")!=payload.get("pageHash"))invalid()
                    }else if(action=="membership-atomic-seal"){
                        val manifest=atomicPackets(state);if(!manifest.getBoolean("ready")||payload.get("batchHash")!=manifest.get("batchHash"))invalid()
                    }else if(action=="membership-atomic-preview"&&(!state.getBoolean("ready")||number(payload,"after")>state.getJSONObject("plan").getJSONArray("scopeIds").length())
                        ||action=="membership-atomic-begin"&&!state.getBoolean("ready")||action=="membership-atomic-cancel"&&!state.getBoolean("cancelRequested"))invalid()
                    val checked=packet(request.getJSONObject("packet"));current()
                    if(checked.command.get("deviceId")!=actor.deviceId||checked.frame.scopeId!=scope||checked.frame.kind!="personal"||checked.frame.ownerId!=actor.ownerId||checked.frame.devices[actor.deviceId]?.role!="owner")invalid()
                    claim("outbox",id,scope,"membership-atomic-control")
                }
            }
        }
        fun run(){
            current();for(id in options.outbox)if(!options.claimed("outbox",id)){val match=Regex("([a-f0-9-]{36}):cipher:(0|[1-9][0-9]*)").matchEntire(id)?:continue;val draft=match.groupValues[1];if(!uuid.matches(draft)||match.groupValues[2].toInt()>257)invalid();groups.getOrPut(draft){mutableListOf()}.add(id)}
            for(id in options.outbox)if(!options.claimed("outbox",id)&&id.startsWith("job:"))job(metadata("outbox",id),id,"outbox")
            for(id in (options.copies+options.jobHistory).toSet())if(!options.claimed("local-snapshot",id)){val value=metadata("local-snapshot",id,true);if(value.has("draftId")&&value.has("scopeId")&&value.has("plan"))job(value,id,"local-snapshot")}
            // An older completed writer may have lost its mutable header. Full
            // signed file + exact protected draft proves inert content only.
            for(id in groups.keys)group(id)
            for(id in options.controlHistory)if(!options.claimed("local-snapshot",id))control(metadata("local-snapshot",id,true),id,"local-snapshot")
            for(id in options.outbox){if(options.claimed("outbox",id))continue;val value=metadata("outbox",id)
                when{
                    id.startsWith("service:")||id.startsWith("membership-product:")||id.startsWith("enrollment:")||id.startsWith("aurora-manifest:")->control(value,id,"outbox")
                    id in setOf("advice-pending-v1","advice-policy-v1")->{val scope=options.personalScopeId?:invalid();val frame=options.directory(scope){true};if(frame.kind!="personal")invalid();E2eeProductCustodyCells.advice(id,value,actor.ownerId,scope);claim("outbox",id,scope,"advice-job")}
                    Regex("stoicheion-job:(daily|spread|timeline)").matches(id)->{val scope=value.getJSONObject("content").getString("scopeId");val frame=options.directory(scope){true};if(frame.kind!="personal")invalid();E2eeProductCustodyCells.stoicheion(value,actor.ownerId,scope,id.substringAfter(':'));claim("outbox",id,scope,"stoicheion-job")}
                    listOf("membership-atomic-v2:","membership-atomic-page:","membership-atomic-request:","membership-atomic-packets:","membership-atomic-packet-page:","membership-atomic-apply:","membership-atomic-apply-request:","membership-atomic-receipt-page:").any{id.startsWith(it)}->atomic(value,id)
                    id.startsWith("membership:")->membership(value,id)
                    id.startsWith("rotation:")->{E2eeKeys.exact(value,setOf("protocol","roles","manifest","packet"));if(value.getInt("protocol")!=1)invalid();val checked=rotation(value.getJSONObject("packet"));val payload=checked.command.getJSONObject("payload");if(id!="rotation:"+hash(checked.frame.scopeId+"\u0000"+payload.getString("membershipHash")))invalid()
                        val expected=rows(payload.getJSONArray("roleChanges"))+strings(payload.getJSONArray("revokedDeviceIds")).map{JSONObject().put("deviceId",it).put("role",JSONObject.NULL)}
                        if(!same(JSONArray(roles(value.getJSONArray("roles")).sortedBy{it.getString("deviceId")}),JSONArray(expected.sortedBy{it.getString("deviceId")})))invalid();val manifest=value.getJSONObject("manifest");E2eeKeys.exact(manifest,setOf("manifestHash","objectCount"));if(manifest.get("manifestHash")!=payload.get("retiredManifestHash")||manifest.get("objectCount")!=payload.get("retiredObjectCount"))invalid();claim("outbox",id,checked.frame.scopeId,"membership-rotation")}
                }
            }
        }
    }
}
