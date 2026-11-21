package ru.genesis.calendar.security

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.security.Signature
import java.util.UUID

internal interface E2eeAccountTransport:E2eeScopeTransport{
    val membership:E2eeMembershipTransport? get()=null
    fun status():JSONObject
    fun challenge(scopeId:String,deviceId:String,keys:JSONObject):JSONObject
}
/** Foreground capability, independent of Google identity. Existing hardware
 * bundles are never replaced on an unlock or enrollment failure. */
internal class E2eeProductAccount private constructor(val ownerId:String,val device:UnlockedE2eeDevice,
    val client:E2eeScopeClient,val directory:E2eeDirectory.Verified,private val assertCurrent:()->Unit,private val transport:E2eeAccountTransport,val offline:Boolean=false){
    private var closed=false
    class SharedScope(val client:E2eeScopeClient,val directory:E2eeDirectory.Verified){override fun toString()="E2eeProductAccount.SharedScope([redacted])"}
    private val shared=mutableMapOf<String,SharedScope>()
    fun requireOpen(){UpdateGate.requireOpen();check(!closed){"E2EE_UNLOCK_REQUIRED"};assertCurrent();device.requireOpen()}
    fun scopeSummaries():JSONArray{requireOpen();check(!offline){"E2EE_ONLINE_REQUIRED"};val value=transport.status();requireOpen();E2eeKeys.exact(value,setOf("pilotAllowed","cryptoProtocol","scopes"));check(value.get("pilotAllowed") is Boolean&&value.getInt("cryptoProtocol")==1){"E2EE_INVALID_RESPONSE"};val scopes=value.getJSONArray("scopes");check(scopes.length()<=4096){"E2EE_INVALID_RESPONSE"};val seen=mutableSetOf<String>()
        for(at in 0 until scopes.length()){val row=scopes.getJSONObject(at);E2eeKeys.exact(row,setOf("scopeId","kind","resourceId","state"));check(seen.add(E2eeKeys.technical(row.getString("scopeId")))&&row.getString("kind") in setOf("personal","project","space")&&row.getString("state") in setOf("preparing","uploading","verified","active","retirement")){"E2EE_INVALID_RESPONSE"};E2eeKeys.technical(row.getString("resourceId"))};return JSONArray(scopes.toString())}
    @Synchronized fun close(){if(!closed){closed=true;shared.values.forEach{it.client.close()};shared.clear();client.close();device.lock()}}
    fun proposeSharedTrust(scopeId:String):JSONObject{
        requireOpen();val scopes=scopeSummaries();val scope=(0 until scopes.length()).map{scopes.getJSONObject(it)}.singleOrNull{it.getString("scopeId")==scopeId&&it.getString("kind")!="personal"}?:error("E2EE_SCOPE_BINDING_MISMATCH")
        val response=transport.directory(scopeId);requireOpen();val events=response.getJSONArray("events");check(events.length()>0){"E2EE_DIRECTORY_REQUIRED"}
        val first=events.getJSONObject(0).getJSONObject("command");check(first.getString("action")=="bootstrap"&&first.getString("scopeId")==scopeId){"E2EE_SCOPE_BINDING_MISMATCH"}
        val pin=first.getJSONObject("payload").getJSONObject("recoveryKit").getJSONObject("authority");val directory=E2eeDirectory.verify(first.getString("ownerId"),scopeId,pin,events);requireOpen()
        check(directory.kind==scope.getString("kind")&&directory.resourceId==scope.getString("resourceId")){"E2EE_SCOPE_BINDING_MISMATCH"}
        val proposal=JSONObject().put("scopeId",scopeId).put("ownerId",directory.ownerId).put("kind",directory.kind).put("resourceId",directory.resourceId).put("authority",directory.recoveryKit.getJSONObject("authority"))
        return JSONObject().put("proposal",proposal).put("fingerprint",E2eeSharedTrust.fingerprint(proposal)).also{requireOpen()}
    }
    @Synchronized fun openSharedScope(scopeId:String,kind:String,resourceId:String,scopeOwner:String,pin:JSONObject):SharedScope{
        requireOpen();check(kind in setOf("project","space")){"E2EE_SCOPE_BINDING_MISMATCH"};E2eeKeys.technical(scopeId);E2eeKeys.technical(resourceId);E2eeKeys.technical(scopeOwner)
        shared[scopeId]?.let{existing->val known=existing.directory;check(known.kind==kind&&known.resourceId==resourceId&&known.ownerId==scopeOwner&&E2eeProductJson.same(known.recoveryKit.getJSONObject("authority"),pin)){"E2EE_SCOPE_BINDING_MISMATCH"}
            val directory=if(offline)existing.client.hydrateOffline()else existing.client.refresh();requireOpen();return SharedScope(existing.client,directory).also{shared[scopeId]=it}}
        val peer=E2eeScopeClient(device,scopeOwner,scopeId,pin,transport);val verified=if(offline)peer.hydrateOffline()else peer.refresh();requireOpen()
        check(verified.scopeId==scopeId&&verified.kind==kind&&verified.resourceId==resourceId&&verified.ownerId==scopeOwner&&verified.state=="active"){"E2EE_SCOPE_BINDING_MISMATCH"}
        return SharedScope(peer,verified).also{shared.remove(scopeId)?.client?.close();shared[scopeId]=it}
    }
    @Synchronized fun sharedScope(scopeId:String,kind:String,resourceId:String):SharedScope{requireOpen();val value=shared[scopeId]?:error("E2EE_SHARED_SCOPE_UNLOCK_REQUIRED")
        check(value.directory.kind==kind&&value.directory.resourceId==resourceId){"E2EE_SCOPE_BINDING_MISMATCH"};return value}
    @Synchronized fun membership():E2eeMembershipProduct{
        requireOpen();check(!offline){"E2EE_REFRESH_REQUIRED"};val channel=transport.membership?:error("E2EE_MEMBERSHIP_TRANSPORT_REQUIRED")
        return E2eeMembershipProduct(device,client,channel,{scopeId->requireOpen();val scope=shared[scopeId]?:error("E2EE_SHARED_SCOPE_UNLOCK_REQUIRED");scope.client.refresh();requireOpen();scope.client},::requireOpen)
    }
    override fun toString()="E2eeProductAccount([redacted])"
    companion object{
        fun open(context:Context,owner:String,transport:E2eeAccountTransport,current:()->Unit,secret:ByteArray?=null,kit:JSONObject?=null,restoreHardware:Boolean=false):E2eeProductAccount{
            E2eeKeys.technical(owner);current();val persistence=E2eeDeviceVault(context,owner);val existed=persistence.exists();var device:UnlockedE2eeDevice?=null
            val held=secret?.copyOf()
            try{
                if(restoreHardware){check(existed&&held?.size==32&&kit!=null){"E2EE_RECOVERY_KIT_REQUIRED"};persistence.restoreHardware(requireNotNull(held),requireNotNull(kit),current);current()}
                device=if(existed)UnlockedE2eeDevice.unlock(context,owner)else{
                    check(held?.size==32&&kit!=null){"E2EE_RECOVERY_KIT_REQUIRED"};UnlockedE2eeDevice.provision(context,owner,requireNotNull(held),requireNotNull(kit))}
                current();val status=transport.status();current();E2eeKeys.exact(status,setOf("pilotAllowed","cryptoProtocol","scopes"))
                check(status.getInt("cryptoProtocol")==1&&status.get("pilotAllowed") is Boolean){"E2EE_INVALID_RESPONSE"}
                val scopes=status.getJSONArray("scopes");check(scopes.length()<=4096){"E2EE_INVALID_RESPONSE"}
                val personal=(0 until scopes.length()).map{scopes.getJSONObject(it)}.filter{it.getString("kind")=="personal"&&it.getString("resourceId")==owner}
                check(personal.size==1){"E2EE_PERSONAL_SCOPE_REQUIRED"};val scope=personal.single().getString("scopeId");E2eeKeys.technical(scope)
                val candidate=requireNotNull(device)
                if(held!=null&&kit!=null)candidate.retainDeviceRecovery(held,kit,current)
                if(!existed||candidate.savedDirectory(scope)==null){check(held?.size==32&&kit!=null){"E2EE_RECOVERY_KIT_REQUIRED"};recoverEnrollment(owner,scope,candidate,transport,requireNotNull(held),requireNotNull(kit),current)}
                val client=E2eeScopeClient(candidate,owner,scope,candidate.authorityPin,transport);val directory=client.refresh();current()
                check(directory.ownerId==owner&&directory.kind=="personal"&&directory.resourceId==owner&&directory.state=="active"){"E2EE_MIGRATION_RESUME_REQUIRED"}
                val old=candidate.vault.read("key-check","product-account-index-v1");val bytes=JSONObject().put("protocol",1).put("ownerId",owner).put("personal",personal.single()).toString().toByteArray(Charsets.UTF_8)
                try{candidate.vault.write(listOf(UnlockedE2eeVault.Write("key-check","product-account-index-v1",bytes,old?.serial)));current()}finally{old?.bytes?.fill(0);bytes.fill(0)}
                return E2eeProductAccount(owner,candidate,client,directory,current,transport)
            }catch(error:Throwable){device?.lock();throw error}finally{held?.fill(0)}
        }
        fun openOffline(context:Context,owner:String,transport:E2eeAccountTransport,current:()->Unit):E2eeProductAccount{
            current();val device=UnlockedE2eeDevice.unlock(context,owner)
            try{
                val row=device.vault.read("key-check","product-account-index-v1")?:error("E2EE_OFFLINE_CONTENT_UNAVAILABLE");val scope:String
                try{val value=E2eeFileManifestJson.readPrivateDocument(row.bytes);E2eeKeys.exact(value,setOf("protocol","ownerId","personal"));check(value.getInt("protocol")==1&&value.getString("ownerId")==owner){"E2EE_SCOPE_BINDING_MISMATCH"}
                    val personal=value.getJSONObject("personal");E2eeKeys.exact(personal,setOf("scopeId","kind","resourceId","state"));check(personal.getString("kind")=="personal"&&personal.getString("resourceId")==owner){"E2EE_SCOPE_BINDING_MISMATCH"};scope=E2eeKeys.technical(personal.getString("scopeId"))
                }finally{row.bytes.fill(0)}
                val client=E2eeScopeClient(device,owner,scope,device.authorityPin,transport);val directory=client.hydrateOffline();current()
                check(directory.ownerId==owner&&directory.kind=="personal"&&directory.resourceId==owner&&directory.state=="active"){"E2EE_SCOPE_BINDING_MISMATCH"}
                return E2eeProductAccount(owner,device,client,directory,current,transport,offline=true)
            }catch(error:Throwable){device.lock();throw error}
        }
        private fun recoverEnrollment(owner:String,scope:String,device:UnlockedE2eeDevice,transport:E2eeAccountTransport,secret:ByteArray,kit:JSONObject,current:()->Unit){
            val authority=E2eeKeys.recoverAuthority(owner,secret,kit);current()
            check(E2eeCommands.canonical(kit.getJSONObject("authority")).contentEquals(E2eeCommands.canonical(device.authorityPin))){"E2EE_AUTHORITY_CHANGED"}
            val id="enrollment:$scope";val saved=device.vault.read("outbox",id)
            try{
                val packet=run{
                    val frames=linkedMapOf<Long,E2eeDirectory.Verified>();val response=transport.directory(scope);current()
                    val directory=E2eeDirectory.verify(owner,scope,device.authorityPin,response.getJSONArray("events"),onVerified={frame->frames[frame.cryptoEpoch]=frame});current()
                    val keys=E2eeKeys.publicKeys(device.keys());val known=directory.devices[device.deviceId]
                    if(known!=null){check(!known.revoked){"E2EE_REVOKED_DEVICE"};check(known.userId==owner&&known.signingKey==keys.getString("signingKey")&&known.receivingKey==keys.getString("receivingKey")){"E2EE_UNTRUSTED_DEVICE"}
                        device.rememberDirectory(scope,device.authorityPin,response.getJSONArray("events"));current();return}
                    if(saved!=null){val command=E2eeFileManifestJson.readPrivateDocument(saved.bytes).getJSONObject("command")
                        check(command.getString("action")=="enroll"&&command.getString("deviceId")=="recovery"&&command.getString("ownerId")==owner&&command.getString("scopeId")==scope){"E2EE_CORRUPT_OUTBOX"}}
                    val challenge=transport.challenge(scope,device.deviceId,keys);current()
                    E2eeKeys.exact(challenge,setOf("id","scopeId","userId","role","sessionHash","deviceId","signingKey","receivingKey","nonce","expiresAt"))
                    check(challenge.getString("scopeId")==scope&&challenge.getString("userId")==owner&&challenge.getString("role")=="owner"&&challenge.getString("deviceId")==device.deviceId
                        &&challenge.getString("signingKey")==keys.getString("signingKey")&&challenge.getString("receivingKey")==keys.getString("receivingKey")&&challenge.getLong("expiresAt")*1000>System.currentTimeMillis()){"E2EE_CHALLENGE_INVALID"}
                    val proofBytes="GENESIS-E2EE-ENROLLMENT\u0000v1\u0000".toByteArray(Charsets.UTF_8)+E2eeCommands.canonical(challenge)
                    val selfProof=Signature.getInstance("SHA256withECDSA").run{initSign(device.keys().signing.private);update(proofBytes);E2eeEnvelope.encode(E2eeEnvelope.derToP1363(sign()))}
                    fun grant(frame:E2eeDirectory.Verified):JSONObject{
                        val root=E2eeKeys.openRoot(frame.recoveryCapsule,authority.receiving,E2eeKeys.RootRecipient(owner,scope,frame.cryptoEpoch,frame.keyId,"recovery"));val raw=root.encoded
                        try{return E2eeKeys.sealRoot(raw,keys.getString("receivingKey"),E2eeKeys.RootRecipient(owner,scope,frame.cryptoEpoch,frame.keyId,device.deviceId))}finally{raw.fill(0)}
                    }
                    val histories=JSONArray();for(frame in frames.values)if(frame.cryptoEpoch<directory.cryptoEpoch)histories.put(JSONObject().put("cryptoEpoch",frame.cryptoEpoch).put("keyId",frame.keyId).put("capsule",grant(frame)))
                    val command=JSONObject().put("protocol",1).put("ownerId",owner).put("scopeId",scope).put("deviceId","recovery").put("action","enroll")
                        .put("expectedRevision",directory.checkpoint.revision).put("checkpointHash",directory.checkpoint.hash).put("securityEpoch",directory.securityEpoch).put("operationId",UUID.randomUUID().toString())
                        .put("payload",JSONObject().put("challenge",challenge).put("capsule",grant(directory)).put("historyCapsules",histories).put("selfProof",selfProof))
                    val signed=E2eeCommands.sign(command,authority.signing.private);current();val bytes=signed.toString().toByteArray(Charsets.UTF_8)
                    try{val writes=mutableListOf<UnlockedE2eeVault.Write>();if(saved!=null)writes+=UnlockedE2eeVault.Write("local-snapshot","$id:attempt:${saved.serial}",saved.bytes,null)
                        writes+=UnlockedE2eeVault.Write("outbox",id,bytes,saved?.serial);device.vault.write(writes)}finally{bytes.fill(0)};signed
                }
                current();var deliveryFailure:Exception?=null;try{transport.command(packet)}catch(error:Exception){if(error is kotlinx.coroutines.CancellationException)throw error;deliveryFailure=error};current();val response=transport.directory(scope);current()
                val directory=device.rememberDirectory(scope,device.authorityPin,response.getJSONArray("events"));current();val enrolled=directory.devices[device.deviceId];val keys=E2eeKeys.publicKeys(device.keys())
                if(enrolled==null||enrolled.revoked||enrolled.userId!=owner||enrolled.signingKey!=keys.getString("signingKey")||enrolled.receivingKey!=keys.getString("receivingKey"))throw deliveryFailure?:IllegalStateException("E2EE_UNTRUSTED_DEVICE")
            }finally{saved?.bytes?.fill(0)}
        }
    }
}
