package ru.genesis.calendar.security

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class E2eeStorageAdmissionTest {
    private fun vector():JSONObject {
        val file=generateSequence(File(requireNotNull(System.getProperty("user.dir")))){it.parentFile}
            .map{File(it,"tests/fixtures/e2ee-storage-admission-v1.json")}.first{it.isFile}
        return JSONObject(file.readText())
    }
    @Test fun allCapacityVectorsAgreeWithWebIncludingOverflowAndKnownFullProvider(){
        val cases=vector().getJSONArray("cases")
        for(index in 0 until cases.length()){
            val row=cases.getJSONObject(index);val usage=row.getJSONObject("usage");val growth=row.getJSONObject("growth");val budget=row.getJSONObject("budget")
            try{
                val receipt=E2eeStorageAdmission.admit(E2eeStorageAdmission.Usage(usage.getLong("records"),usage.getLong("keyRecords"),usage.getLong("usageBytes"),usage.getLong("quotaBytes")),
                    E2eeStorageAdmission.Growth(growth.getLong("records"),growth.getLong("keyRecords"),growth.getLong("writeBytes"),growth.getLong("rewriteBytes")),
                    E2eeStorageAdmission.Budget(budget.getLong("maximumRecords"),budget.getLong("maximumKeyRecords"),budget.getLong("maximumUsageBytes"),budget.getLong("safetyBytes")))
                assertFalse(row.getString("id"),row.has("error"));val expected=row.getJSONObject("expected")
                assertEquals(expected.getLong("records"),receipt.records);assertEquals(expected.getLong("keyRecords"),receipt.keyRecords);assertEquals(expected.getLong("peakBytes"),receipt.peakBytes)
            }catch(error:Exception){assertEquals(row.getString("id"),row.getString("error"),error.message)}
        }
    }
    @Test fun arithmeticNeverWrapsLongOrProducesAnUnsafeJsInteger(){
        for(values in listOf(longArrayOf(Long.MAX_VALUE),longArrayOf(9007199254740991,1),longArrayOf(-1))){
            try{E2eeStorageAdmission.add(*values);fail("Invalid byte budget accepted")}catch(error:Exception){assertEquals("E2EE_STORAGE_ADMISSION_INVALID",error.message)}
        }
    }
    @Test fun alternateMemoryStorageCannotGrantProviderCapacity(){
        var reads=0;val storage=object:E2eeRecordStorage {
            override fun get(key:String):E2eeLocalRecord?{reads++;error("UNREACHABLE")}
            override fun list(prefix:String):List<String>{reads++;error("UNREACHABLE")}
            override fun commit(changes:List<E2eeStorageChange>,requireOpen:()->Unit){error("UNREACHABLE")}
        }
        val keys=E2eeKeys.generateDeviceKeys();val raw=E2eeKeys.freshSecret();val root=try{E2eeEnvelope.importRoot(raw)}finally{raw.fill(0)}
        val vault=UnlockedE2eeVault(storage,UnlockedE2eeVault.Scope("owner","device:one","one",1,1,1,"root",keys.signing.private,mapOf("root" to root)){keys.signing.public})
        try{vault.providerUsage();fail("Alternate provider accepted")}catch(error:Exception){assertEquals("E2EE_STORAGE_PROVIDER_REQUIRED",error.message)}finally{vault.lock()}
        assertEquals(0,reads)
    }
}
