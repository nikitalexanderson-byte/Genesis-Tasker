package ru.genesis.calendar.security

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.MessageDigest

class E2eeMigrationOwnershipTest {
    private fun vector():JSONObject {
        val file=generateSequence(File(requireNotNull(System.getProperty("user.dir")))){it.parentFile}
            .map{File(it,"tests/fixtures/e2ee-streamed-ownership-v1.json")}.first{it.isFile}
        return JSONObject(file.readText())
    }
    private fun expected(value:JSONObject):E2eeMigrationOwnership.Expected {
        val target=value.getJSONObject("target");val actor=value.getJSONObject("actor")
        return E2eeMigrationOwnership.Expected(value.getString("migrationId"),E2eeSourceStage.Target(target.getString("ownerId"),target.getString("scopeId"),target.getString("kind")),
            UnlockedE2eeVault.LocalIdentity(actor.getString("ownerId"),actor.getString("scopeId"),actor.getString("deviceId")),
            value.get("sourceHash") as? String,if(value.isNull("lease"))null else value.getJSONObject("lease"),value.getString("checkpointHash"),value.getLong("directoryRevision"))
    }
    private fun hash(bytes:ByteArray)=E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(bytes))
    private fun refused(operation:()->Unit){try{operation();fail("Unbound ownership accepted")}catch(error:Exception){assertTrue(error.message.orEmpty(),error.message.orEmpty().startsWith("E2EE_"))}}
    @Test fun v2RequiresExplicitCompletionWithoutChangingTheStrictV1Reader(){
        val source=vector();val expected=expected(source.getJSONObject("expected"));val value=source.getJSONObject("ownership")
        E2eeMigrationOwnership.validate(value,expected);value.put("protocol",2)
        val entry=value.getJSONArray("originals").getJSONObject(0);refused{E2eeMigrationOwnership.validate(value,expected)}
        entry.put("completion",JSONObject.NULL);assertTrue(E2eeMigrationOwnership.validate(value,expected).getJSONArray("originals").getJSONObject(0).isNull("completion"))
        val ref=JSONObject().put("id",entry.getJSONObject("registration").get("id")).put("manifestHash",E2eeEnvelope.encode(ByteArray(32)))
            .put("rawHash",E2eeEnvelope.encode(ByteArray(32){1})).put("size",0)
        entry.put("completion",ref);E2eeMigrationOwnership.validate(value,expected)
        value.put("protocol",1);refused{E2eeMigrationOwnership.validate(value,expected)}
    }
    @Test fun v2CompletionIsExactMetadataAndNeverSubstitutesForAnOriginalBodyProof(){
        for(mode in listOf("id","size","hash","unknown")){
            val source=vector();val value=source.getJSONObject("ownership").put("protocol",2);val entry=value.getJSONArray("originals").getJSONObject(0)
            val ref=JSONObject().put("id",entry.getJSONObject("registration").get("id")).put("manifestHash",E2eeEnvelope.encode(ByteArray(32)))
                .put("rawHash",E2eeEnvelope.encode(ByteArray(32){1})).put("size",0)
            when(mode){"id"->ref.put("id",java.util.UUID.randomUUID().toString());"size"->ref.put("size",-1);"hash"->ref.put("rawHash","invalid");else->ref.put("bodyVerified",true)}
            entry.put("completion",ref);refused{E2eeMigrationOwnership.validate(value,expected(source.getJSONObject("expected")))}
        }
    }
    @Test fun canonicalPublicVectorAndRequestSignatureMatchWeb(){
        val source=vector();val value=E2eeMigrationOwnership.validate(source.getJSONObject("ownership"),expected(source.getJSONObject("expected")))
        assertEquals(source.get("ownershipCanonicalHash"),hash(E2eeCommands.canonical(value)))
        E2eeCommands.verify(value.getJSONArray("originals").getJSONObject(0).getJSONObject("packet"),E2eeDirectory.signingKey(value.getString("signer")))
        source.getJSONObject("ownership").put("attemptId","mutated")
        assertEquals("20000000-0000-4000-8000-000000000002",value.getString("attemptId"))
    }
    @Test fun actorSourceDirectoryAndGenerationCannotRebindSavedRequest(){
        for(mode in listOf("actor","sourceHash","checkpointHash","migrationId","directoryRevision","generation")){
            val source=vector();val binding=source.getJSONObject("expected")
            when(mode){
                "actor"->binding.getJSONObject("actor").put("deviceId","different-device")
                "generation"->binding.getJSONObject("lease").put("generation",99)
                "directoryRevision"->binding.put(mode,99)
                "migrationId"->binding.put(mode,"50000000-0000-4000-8000-000000000005")
                else->binding.put(mode,hash("DIFFERENT SYNTHETIC BINDING".toByteArray()))
            }
            refused{E2eeMigrationOwnership.validate(source.getJSONObject("ownership"),expected(binding))}
        }
    }
    @Test fun earlierFenceRemainsOwnedAfterRenewalButFutureFenceAndDuplicatesRefuse(){
        val source=vector();val binding=source.getJSONObject("expected");val value=source.getJSONObject("ownership")
        binding.getJSONObject("lease").put("fence",8);E2eeMigrationOwnership.validate(value,expected(binding))
        binding.getJSONObject("lease").put("fence",5);refused{E2eeMigrationOwnership.validate(value,expected(binding))}
        binding.getJSONObject("lease").put("fence",6);value.getJSONArray("originals").put(value.getJSONArray("originals").getJSONObject(0))
        refused{E2eeMigrationOwnership.validate(value,expected(binding))}
    }
    @Test fun packetBytesUnknownRolesAndOriginalCapsCannotBeNormalizedAway(){
        for(mode in listOf("packet","unknown","limit","oversize","source-copy")){
            val source=vector();val value=source.getJSONObject("ownership");val originals=value.getJSONArray("originals");val entry=originals.getJSONObject(0)
            when(mode){
                "packet"->entry.getJSONObject("packet").put("signature",E2eeEnvelope.encode(ByteArray(64)))
                "unknown"->entry.getJSONObject("registration").put("bodyVerified",true)
                "limit"->value.put("originals",JSONArray().apply{repeat(1001){put(entry)}})
                "source-copy"->value.getJSONObject("sourceState").put("objectId","other:preparation:3")
                "oversize"->{val packet=entry.getJSONObject("packet");packet.getJSONObject("command").getJSONObject("payload").put("unknown","x".repeat(128*1024));entry.getJSONObject("registration").getJSONObject("binding").put("packetHash",hash(E2eeCommands.canonical(packet)))}
            }
            refused{E2eeMigrationOwnership.validate(value,expected(source.getJSONObject("expected")))}
        }
    }
    @Test fun ownedRequestRequiresLeaseAndSourceButStructureAloneDoesNotAuthenticateSigner(){
        for(field in listOf("lease","sourceHash")){
            val source=vector();source.getJSONObject("expected").put(field,JSONObject.NULL)
            refused{E2eeMigrationOwnership.validate(source.getJSONObject("ownership"),expected(source.getJSONObject("expected")))}
        }
        val source=vector();val value=source.getJSONObject("ownership");val entry=value.getJSONArray("originals").getJSONObject(0);val packet=entry.getJSONObject("packet")
        packet.put("signature",E2eeEnvelope.encode(ByteArray(64)));entry.getJSONObject("registration").getJSONObject("binding").put("packetHash",hash(E2eeCommands.canonical(packet)))
        E2eeMigrationOwnership.validate(value,expected(source.getJSONObject("expected")))
        refused{E2eeCommands.verify(packet,E2eeDirectory.signingKey(value.getString("signer")))}
    }
}
