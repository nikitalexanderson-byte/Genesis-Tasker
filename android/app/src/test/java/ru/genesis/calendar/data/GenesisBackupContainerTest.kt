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
}
