package ru.genesis.calendar.auth

import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.data.DocumentRecord
import ru.genesis.calendar.data.LocalCipher
import ru.genesis.calendar.security.NativePrivateProducts
import java.util.UUID

/** Real Room/Keystore cache projection. The persisted private deny marker must
 * survive an older account-entry row without granting any unlocked capability. */
class CachedAccountEntryDeviceTest {
    private val app get()=InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
    private fun owner():String {
        check(BuildConfig.DEBUG&&app.packageName=="ru.genesis.calendar.qa1103.debug")
        return "cache-private-${UUID.randomUUID()}".also{app.activateAccount(it)}
    }
    private fun profile(owner:String)=JSONObject().put("user",JSONObject()
        .put("uid",owner).put("email","cache@example.invalid").put("displayName","Synthetic cache")
        .put("authProvider","google").put("language","en")
        .put("googleAccounts",JSONArray().put(JSONObject().put("id",owner).put("email","cache@example.invalid").put("isPrimary",true)))
        .put("syncRouting",JSONObject().put("mode","fixed").put("defaultAccountIds",JSONArray().put(owner)).put("categoryAccountIds",JSONObject())))

    @Test fun olderCacheAdoptsPrivateRoutingBeforeIdentityAndKeepsTheOriginalRow()=runBlocking(Dispatchers.IO) {
        val owner=owner();val scope=CloudAccountSnapshot.scopeFor(owner);val cache=CachedAccountEntry(app);val body=profile(owner)
        cache.save(requireNotNull(AuthProtocol.identity(body)),requireNotNull(AccountSettings.fromResponse(body)))
        val before=requireNotNull(app.database.dao().document(scope,"account-entry"))
        NativePrivateProducts.protect(app,owner)
        val entry=requireNotNull(CachedAccountEntry(app).read(scope))
        assertEquals(owner,entry.identity.uid);assertTrue(entry.identity.privateVault)
        assertFalse("An identity hint never opens the private product",NativePrivateProducts.isOpen(scope))
        assertEquals(before,app.database.dao().document(scope,"account-entry"))
    }

    @Test fun privatePublicCacheColdReadsWithoutPrivatePreferencesOrLegacyOverwrite()=runBlocking(Dispatchers.IO) {
        val owner=owner();val scope=CloudAccountSnapshot.scopeFor(owner);val cache=CachedAccountEntry(app);val body=profile(owner)
        val settings=requireNotNull(AccountSettings.fromResponse(body));cache.save(requireNotNull(AuthProtocol.identity(body)),settings)
        val original=requireNotNull(app.database.dao().document(scope,"account-entry"))
        // Use the real active SQL fence, including its descendant deny triggers.
        // Public identity metadata must remain independent without an exemption.
        app.database.openHelper.writableDatabase.execSQL(
            "INSERT INTO e2ee_legacy_fences(scope,ownerId,remoteScopeId,phase,token) VALUES(?,?,?,?,?)",
            arrayOf(scope,owner,"cache-remote-${UUID.randomUUID()}","active",UUID.randomUUID().toString()))
        NativePrivateProducts.protect(app,owner);body.getJSONObject("user").put("privatePreferencesMode","e2ee")
        cache.save(requireNotNull(AuthProtocol.identity(body)),settings)
        val record=requireNotNull(app.database.dao().document("public-profile-v1:$scope","account-entry"))
        val publicUser=JSONObject(LocalCipher().decrypt(record.encrypted,"${record.scope}/account-entry")).getJSONObject("user")
        assertEquals("e2ee",publicUser.getString("privatePreferencesMode"))
        for(name in listOf("advicePreferences","uiVisibility","syncRouting"))assertFalse(name,publicUser.has(name))
        assertTrue(requireNotNull(CachedAccountEntry(app).read(scope)).identity.privateVault)
        assertFalse(NativePrivateProducts.isOpen(scope));assertEquals(original,app.database.dao().document(scope,"account-entry"))
        for(blockedScope in listOf(scope,"$scope:public-profile-v1")) {
            val failure=runCatching {app.database.dao().putDocument(original.copy(scope=blockedScope,revision=2))}.exceptionOrNull()
            assertNotNull("The private namespace remains fenced",failure)
            assertTrue(generateSequence(failure){it.cause}.any{it.message?.contains("E2EE_LOCAL_LEGACY_WRITE_FORBIDDEN")==true})
        }
        cache.clear(scope)
        assertNull(app.database.dao().document("public-profile-v1:$scope","account-entry"))
        assertEquals(original,app.database.dao().document(scope,"account-entry"))
    }

    @Test fun privateMarkerCannotRebindAnotherOwnersEncryptedCache()=runBlocking(Dispatchers.IO) {
        val owner=owner();val scope=CloudAccountSnapshot.scopeFor(owner)
        val raw=profile("foreign-${UUID.randomUUID()}").toString()
        val original=DocumentRecord(scope,"account-entry",LocalCipher().encrypt(raw,"$scope/account-entry"),1)
        app.database.dao().putDocument(original);NativePrivateProducts.protect(app,owner)
        assertNull(CachedAccountEntry(app).read(scope));assertFalse(NativePrivateProducts.isOpen(scope))
        assertEquals(original,app.database.dao().document(scope,"account-entry"))
    }
}
