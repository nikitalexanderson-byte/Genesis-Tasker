package ru.genesis.calendar.security

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class E2eeOriginalCustodyTest {
    private fun vector():JSONObject=JSONObject(generateSequence(File(requireNotNull(System.getProperty("user.dir")))){it.parentFile}
        .map{File(it,"tests/fixtures/e2ee/original-custody-web-v1.json")}.first{it.isFile}.readText())
    private class Records(value:JSONObject):E2eeRecordStorage {
        val rows=linkedMapOf<String,E2eeLocalRecord>();var writes=0
        init{val input=value.getJSONArray("records");for(i in 0 until input.length()){val row=input.getJSONObject(i);rows[row.getString("key")]=E2eeLocalRecord(row.getLong("serial"),E2eeEnvelope.Envelope.fromJson(row.getJSONObject("envelope")))}}
        override fun get(key:String)=rows[key]
        override fun list(prefix:String)=rows.keys.filter{it.startsWith(prefix)}
        override fun commit(changes:List<E2eeStorageChange>,requireOpen:()->Unit){writes++;error("ORIGINAL_WRITE_FORBIDDEN")}
    }
    private fun open(v:JSONObject,records:E2eeRecordStorage,secret:ByteArray=E2eeEnvelope.decode(v.getString("secret"),32),pin:JSONObject=v.getJSONObject("primaryPin"),kit:JSONObject=v.getJSONObject("recoveryKit"),ref:JSONObject=v.getJSONObject("reference"),artifact:JSONObject=v.getJSONObject("artifact"),current:()->Unit={}):E2eeOriginalCustody.Reader =
        E2eeOriginalCustody.open(v.getString("ownerId"),pin,kit,secret,ref,artifact,records,current)
    private fun consume(reader:E2eeOriginalCustody.Reader,v:JSONObject){
        val t=v.getJSONObject("target");val s=v.getJSONObject("stageReference")
        reader.openStage(E2eeSourceStage.Target(t.getString("ownerId"),t.getString("scopeId"),t.getString("kind")),E2eeSourceStage.Reference(s.getString("stageId"),s.getString("manifestHash"))).use{stage->
            stage.openPath("project.content").use{input->assertArrayEquals(byteArrayOf(1,7,255.toByte()),input.readBytes());input.assertComplete()}
        }
    }
    @Test fun webOwnerCertificateAndSecretOpenOriginalStageWithOnlyPublicOldSigner(){
        val v=vector();val records=Records(v);open(v,records).use{reader->consume(reader,v);assertFalse(reader.toString().contains(v.getString("secret")))};assertEquals(0,records.writes)
    }
    @Test fun eitherChangedPrimaryPublicKeyWrongSecretAndSameOwnerProjectAuthorityRefuse(){
        val v=vector();val records=Records(v);val other=E2eeKeys.createRecoveryKit(v.getString("ownerId"))
        assertThrows(Exception::class.java){open(v,records,E2eeKeys.freshSecret())}
        for(field in listOf("signingKey","receivingKey")){val pin=JSONObject(v.getJSONObject("primaryPin").toString()).put(field,other.kit.getJSONObject("authority").get(field));assertThrows(Exception::class.java){open(v,records,pin=pin)}}
        assertThrows(Exception::class.java){open(v,records,other.secret,other.kit.getJSONObject("authority"),other.kit)};assertEquals(0,records.writes);other.secret.fill(0)
    }
    @Test fun oldDeviceSignatureAndRootSubstitutionRefuseEvenWithRecomputedArtifactHash(){
        for(change in listOf<(JSONObject)->Unit>({it.put("root",E2eeEnvelope.encode(E2eeKeys.freshSecret()))},{it.put("deviceKeys",E2eeKeys.exportPrivateKeys(E2eeKeys.generateDeviceKeys()))},
            {payload->val packet=payload.getJSONObject("certificate");payload.put("certificate",E2eeCommands.sign(packet.getJSONObject("command"),E2eeKeys.generateDeviceKeys().signing.private))},
            {it.getJSONObject("certificate").getJSONObject("command").getJSONObject("payload").getJSONObject("original").put("generation",2)})){
            val v=vector();val secret=E2eeEnvelope.decode(v.getString("secret"),32);val artifact=v.getJSONObject("artifact");val clear=E2eeKeys.openBundle(v.getString("ownerId"),E2eeOriginalCustody.PURPOSE,secret,artifact.getJSONObject("bundle"))
            val payload=try{JSONObject(clear.toString(Charsets.UTF_8))}finally{clear.fill(0)};change(payload);val bytes=payload.toString().toByteArray()
            try{artifact.put("bundle",E2eeKeys.protectBundle(v.getString("ownerId"),E2eeOriginalCustody.PURPOSE,secret,bytes))}finally{bytes.fill(0);secret.fill(0)}
            val hash=E2eeEnvelope.encode(java.security.MessageDigest.getInstance("SHA-256").digest(E2eeCommands.canonical(artifact)));val ref=v.getJSONObject("reference").put("hash",hash)
            assertThrows(Exception::class.java){open(v,Records(v),ref=ref,artifact=artifact)}
        }
    }
    @Test fun readerRevocationAndActorRetirementDenyFurtherBytesAndCompletion(){
        val v=vector();val records=Records(v);var live=true;val reader=open(v,records,current={check(live){"E2EE_ACCOUNT_CHANGED"}})
        val t=v.getJSONObject("target");val s=v.getJSONObject("stageReference");val stage=reader.openStage(E2eeSourceStage.Target(t.getString("ownerId"),t.getString("scopeId"),t.getString("kind")),E2eeSourceStage.Reference(s.getString("stageId"),s.getString("manifestHash")))
        val input=stage.openPath("project.content");assertEquals(1,input.read());live=false;assertThrows(Exception::class.java){input.read()};reader.close();assertThrows(Exception::class.java){input.assertComplete()};assertEquals(0,records.writes)
    }
    @Test fun primaryOwnerSealContainsNoOldPrivateDeviceIdentityAndCannotUseProjectPin(){
        val v=vector();val secret=E2eeEnvelope.decode(v.getString("secret"),32);val clear=E2eeKeys.openBundle(v.getString("ownerId"),E2eeOriginalCustody.PURPOSE,secret,v.getJSONObject("artifact").getJSONObject("bundle"))
        val root=try{E2eeEnvelope.decode(JSONObject(clear.toString(Charsets.UTF_8)).getString("root"),32)}finally{clear.fill(0)}
        val o=v.getJSONObject("reference").getJSONObject("original");val original=E2eeOriginalSource.Identity(o.getString("ownerId"),o.getString("scopeId"),o.getString("deviceId"),1,1,1)
        try{
            val sealed=E2eeOriginalCustody.seal(original,"local:${original.deviceId}",v.getJSONObject("reference").getString("signer"),root,v.getJSONObject("primaryPin"),v.getJSONObject("recoveryKit"),secret,{})
            val payload=E2eeKeys.openBundle(original.ownerId,E2eeOriginalCustody.PURPOSE,secret,sealed.artifact.getJSONObject("bundle"))
            try{assertEquals(setOf("protocol","root","certificate"),JSONObject(payload.toString(Charsets.UTF_8)).keys().asSequence().toSet())}finally{payload.fill(0)}
            val other=E2eeKeys.createRecoveryKit(original.ownerId)
            assertThrows(Exception::class.java){E2eeOriginalCustody.seal(original,"local:${original.deviceId}",v.getJSONObject("reference").getString("signer"),root,v.getJSONObject("primaryPin"),other.kit,other.secret,{})};other.secret.fill(0)
            open(v,Records(v),artifact=sealed.artifact,ref=sealed.reference).use{consume(it,v)}
        }finally{secret.fill(0);root.fill(0)}
    }
}
