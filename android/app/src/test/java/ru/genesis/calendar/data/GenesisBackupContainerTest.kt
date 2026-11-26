package ru.genesis.calendar.data

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/** Synthetic web fixture, no account/session/store credentials. Native suite awaits build permission. */
class GenesisBackupContainerTest {
    private fun fixture(): JSONObject = JSONObject(requireNotNull(javaClass.classLoader).getResourceAsStream("backups/web-v1.json")!!.bufferedReader().use { it.readText() })
    @Test fun webFileDecryptsWithIndependentUserKey() {
        val input=fixture()
        val payload=GenesisBackupContainer.open(input.getJSONObject("file").toString(),input.getString("key"))
        assertEquals(1,payload.getInt("schema"));assertEquals("device_snapshot",payload.getString("source"))
        assertTrue(payload.getJSONArray("sections").getJSONObject(0).getJSONObject("data").getJSONObject("document").has("tasks"))
    }
    @Test fun androidRoundTripUsesNewKeysAndRejectsTampering() {
        val input=fixture();val key=input.getString("key")
        val payload=GenesisBackupContainer.open(input.getJSONObject("file").toString(),key).put("client","android")
        val first=GenesisBackupContainer.seal(payload,key);val second=GenesisBackupContainer.seal(payload,key)
        assertNotEquals(JSONObject(first).getString("wrappedKey"),JSONObject(second).getString("wrappedKey"))
        assertEquals("android",GenesisBackupContainer.open(first,key).getString("client"))
        assertTrue(runCatching { GenesisBackupContainer.open(first,GenesisBackupContainer.newRecoveryKey()) }.isFailure)
        assertTrue(runCatching { GenesisBackupContainer.open(JSONObject(first).put("schema",2).toString(),key) }.isFailure)
        assertTrue(runCatching { GenesisBackupContainer.open(JSONObject(first).put("sha256","0".repeat(64)).toString(),key) }.isFailure)
    }
    @Test fun bothExactHistoricalAadEncodingsAreReadableAndNewAuthenticatedHeaderIsCanonical(){
        val input=JSONObject(requireNotNull(javaClass.classLoader).getResourceAsStream("backup-portability-v1.json")!!.bufferedReader().use{it.readText()})
        val files=input.getJSONObject("files");val canonical=files.getJSONObject("canonical");assertTrue(canonical.getString("wrappedKey").contains('/'))
        assertEquals(input.getString("canonicalAad"),GenesisBackupContainer.authenticatedHeader(canonical.getString("backupId"),canonical.getString("wrappedKey")).toString(Charsets.UTF_8))
        assertEquals(input.getString("androidLegacyAad"),GenesisBackupContainer.authenticatedHeader(canonical.getString("backupId"),canonical.getString("wrappedKey"),true).toString(Charsets.UTF_8))
        for(name in listOf("canonical","androidLegacy")){
            val file=files.getJSONObject(name);assertEquals(input.getJSONObject("payload").getString("ownerId"),GenesisBackupContainer.open(file.toString(),input.getString("recoveryKey")).getString("ownerId"))
            assertThrows(Exception::class.java){GenesisBackupContainer.open(JSONObject(file.toString()).put("backupId",java.util.UUID.randomUUID().toString()).toString(),input.getString("recoveryKey"))}
        }
    }
}
