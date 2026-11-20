package ru.genesis.calendar.data

import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.util.UUID

class GenesisBackupPortabilityTest {
    private val instrumentation get()=InstrumentationRegistry.getInstrumentation()
    private fun fixture()=JSONObject(instrumentation.context.assets.open("backup-portability-v1.json").bufferedReader().use{it.readText()})
    @Test fun exactCanonicalAndHistoricalAndroidHeadersAuthenticateOnTheActualProvider(){
        val input=fixture();val files=input.getJSONObject("files");val canonical=files.getJSONObject("canonical");val wrapped=canonical.getString("wrappedKey")
        assertTrue(wrapped.contains('/'))
        assertEquals(input.getString("canonicalAad"),GenesisBackupContainer.authenticatedHeader(canonical.getString("backupId"),wrapped).toString(Charsets.UTF_8))
        assertEquals(input.getString("androidLegacyAad"),GenesisBackupContainer.authenticatedHeader(canonical.getString("backupId"),wrapped,true).toString(Charsets.UTF_8))
        for(name in listOf("canonical","androidLegacy")){
            val file=files.getJSONObject(name);val opened=GenesisBackupContainer.open(file.toString(),input.getString("recoveryKey"))
            assertEquals(input.getJSONObject("payload").getString("ownerId"),opened.getString("ownerId"));assertEquals("Portable synthetic note α Ω",opened.getJSONArray("sections").getJSONObject(0).getJSONObject("data").getJSONObject("document").getJSONArray("tasks").getJSONObject(0).getString("title"))
            assertThrows(Exception::class.java){GenesisBackupContainer.open(JSONObject(file.toString()).put("backupId",UUID.randomUUID().toString()).toString(),input.getString("recoveryKey"))}
            assertThrows(Exception::class.java){GenesisBackupContainer.open(file.toString(),java.util.Base64.getEncoder().encodeToString(ByteArray(32){-1}))}
        }
    }
    @Test fun newlySealedNativeArchiveWithSolidusRemainsPortableToTheCommonWebCryptoReader(){
        val input=fixture();var sealed="";var attempts=0
        while(attempts++<64){sealed=GenesisBackupContainer.seal(input.getJSONObject("payload"),input.getString("recoveryKey"));if(JSONObject(sealed).getString("wrappedKey").contains('/'))break}
        val file=JSONObject(sealed);assertTrue(file.getString("wrappedKey").contains('/'));assertEquals(input.getJSONObject("payload").getString("ownerId"),GenesisBackupContainer.open(sealed,input.getString("recoveryKey")).getString("ownerId"))
        val platformHeader=JSONArray(listOf("genesisbackup",1,file.getString("backupId"),"A256GCM+A256KW",file.getString("wrappedKey"))).toString()
        File(instrumentation.targetContext.getExternalFilesDir(null),"backup336-portability-native-output.json").writeText(JSONObject().put("synthetic",true).put("protocol",1).put("file",file)
            .put("platformEscapesSolidus",platformHeader.contains("\\/")).toString())
    }
}
