package ru.genesis.calendar.security

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

internal interface E2eePersonalDeviceEntryPorts{
    val transport:E2eeScopeTransport
    fun challenge(target:JSONObject,deviceId:String,keys:JSONObject,requestId:String):JSONObject
}
/** A pre-enrollment candidate, never an unlocked product account. The caller
 * must admit foreground credential use and retain lifecycle/session guards. */
internal class E2eePersonalDeviceEntry private constructor(private val device:UnlockedE2eeDevice,targetInput:JSONObject,
    private val ports:E2eePersonalDeviceEntryPorts,private val guard:()->Unit){
    private val encodedTarget=targetInput.toString();private var closed=false
    fun target()=JSONObject(encodedTarget)
    private fun current(){guard();check(!closed){"E2EE_UNLOCK_REQUIRED"};device.requireOpen()}
    private val document=E2eeDeviceDocument(device,MARKER,{validateMarker(it,device.ownerId,target())},::current)
    private val access=E2eeDeviceAccess.candidate(device,object:E2eeDeviceAccessPorts{
        override fun target(scopeId:String):JSONObject{current();val target=this@E2eePersonalDeviceEntry.target();check(target.get("scopeId")==scopeId){"E2EE_SCOPE_BINDING_MISMATCH"};return target}
        override fun client(target:JSONObject):E2eeScopeClient=error("E2EE_OWNER_REQUIRED")
        override fun directory(scopeId:String)=ports.transport.directory(scopeId).also{current()}
        override fun challenge(target:JSONObject,deviceId:String,keys:JSONObject,requestId:String)=ports.challenge(target,deviceId,keys,requestId).also{current()}
        override fun command(packet:JSONObject)=ports.transport.command(packet).also{current()}
        override fun open(target:JSONObject){current();check(E2eeProductJson.same(target,this@E2eePersonalDeviceEntry.target())){"E2EE_SCOPE_BINDING_MISMATCH"};val client=E2eeScopeClient(device,device.ownerId,target.getString("scopeId"),target.getJSONObject("authority"),ports.transport)
            try{val directory=client.refresh();current();check(directory.kind=="personal"&&directory.resourceId==device.ownerId&&directory.state=="active"){"E2EE_SCOPE_BINDING_MISMATCH"}}finally{client.close()}}
    },::current)
    private fun active():Pair<String,E2eeDeviceDocument.Opened>{val marker=document.load()?:error("E2EE_DEVICE_ACCESS_REQUIRED");current();val ids=marker.value.getJSONArray("attemptIds");val id=ids.getString(ids.length()-1);access.create(target().getString("scopeId"),id);current();return id to marker}
    @Synchronized fun request():JSONObject{current();val(id,_)=active();return access.request(id).also{current()}}
    @Synchronized fun newRequest():JSONObject{current();val(id,marker)=active();val previous=access.inspect(id);check(previous.isNull("approval")){"E2EE_DEVICE_PREVIOUS_OUTCOME_REQUIRED"};val ids=JSONArray(marker.value.getJSONArray("attemptIds").toString());check(ids.length()<64){"E2EE_SOURCE_HISTORY_CAPACITY"}
        val next=UUID.randomUUID().toString();ids.put(next);document.save(JSONObject(marker.value.toString()).put("attemptIds",ids),marker.serial);current();access.create(target().getString("scopeId"),next);return access.request(next).also{current()}}
    @Synchronized fun submit(approval:JSONObject?=null):JSONObject{current();val(id,_)=active();if(approval!=null){access.stageApproval(id,approval);current()};return access.submit(id).also{current()}}
    @Synchronized fun close(){closed=true;device.lock()}
    override fun toString()="E2eePersonalDeviceEntry([redacted])"
    companion object {
        const val MARKER="personal-device-entry:v1"
        fun validateMarker(value:JSONObject,owner:String,expected:JSONObject?=null):JSONObject{
            E2eeKeys.exact(value,setOf("format","ownerId","target","attemptIds"));val target=E2eeDeviceAccessContract.target(value.getJSONObject("target"));val ids=value.getJSONArray("attemptIds");val seen=mutableSetOf<String>()
            check(value.get("format")=="genesis-personal-device-entry-v1"&&value.get("ownerId")==owner&&target.get("kind")=="personal"&&target.get("ownerId")==owner&&(expected==null||E2eeProductJson.same(target,expected))&&ids.length() in 1..64){"E2EE_DEVICE_ACCESS_INVALID"}
            for(index in 0 until ids.length())check(seen.add(E2eeKeys.technical(ids.getString(index)))){"E2EE_DEVICE_ACCESS_INVALID"};return JSONObject(value.toString())
        }
        fun begin(context:Context,compared:E2eeComparedPersonalDeviceTarget,ports:E2eePersonalDeviceEntryPorts,current:()->Unit):E2eePersonalDeviceEntry{
            current();val target=compared.target();val owner=target.getString("ownerId");val response=ports.transport.directory(target.getString("scopeId"));current();val directory=E2eeDirectory.verify(owner,target.getString("scopeId"),target.getJSONObject("authority"),response.getJSONArray("events"));current()
            check(directory.kind=="personal"&&directory.resourceId==owner&&directory.state=="active"){"E2EE_SCOPE_BINDING_MISMATCH"};var device:UnlockedE2eeDevice?=null
            try{device=if(E2eeDeviceVault(context,owner).exists())UnlockedE2eeDevice.unlock(context,owner)else UnlockedE2eeDevice.provisionCandidate(context,compared,current);current();check(E2eeProductJson.same(device.authorityPin,target.getJSONObject("authority"))){"E2EE_AUTHORITY_CHANGED"}
                val entry=E2eePersonalDeviceEntry(device,target,ports,current);val saved=entry.document.load();entry.current();if(saved==null){check(device.savedDirectory(target.getString("scopeId"))==null){"E2EE_DEVICE_ALREADY_ENROLLED"};entry.document.save(JSONObject().put("format","genesis-personal-device-entry-v1").put("ownerId",owner).put("target",target).put("attemptIds",JSONArray().put(UUID.randomUUID().toString())),null);entry.current()};return entry
            }catch(error:Throwable){device?.lock();throw error}
        }
        fun resume(context:Context,owner:String,ports:E2eePersonalDeviceEntryPorts,current:()->Unit):E2eePersonalDeviceEntry{
            current();val device=UnlockedE2eeDevice.unlock(context,owner)
            try{current();val marker=E2eeDeviceDocument(device,MARKER,{validateMarker(it,owner)},{current();device.requireOpen()}).load()?:error("E2EE_DEVICE_ACCESS_REQUIRED");current();val target=marker.value.getJSONObject("target");check(E2eeProductJson.same(target.getJSONObject("authority"),device.authorityPin)){"E2EE_AUTHORITY_CHANGED"};return E2eePersonalDeviceEntry(device,target,ports,current).also{it.current()}
            }catch(error:Throwable){device.lock();throw error}
        }
        fun replaceRevoked(context:Context,compared:E2eeComparedPersonalDeviceTarget,ports:E2eePersonalDeviceEntryPorts,current:()->Unit):E2eePersonalDeviceEntry{
            current();val response=ports.transport.directory(compared.target().getString("scopeId"));current();val candidate=UnlockedE2eeDevice.replaceRevoked(context,compared,response.getJSONArray("events"),current);candidate.lock();current();return begin(context,compared,ports,current)
        }
    }
}
