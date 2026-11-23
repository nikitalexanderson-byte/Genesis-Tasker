package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.data.DocumentRecord
import ru.genesis.calendar.data.LocalCipher

/** A previously imported account can open its encrypted local data before the network is available.
 * This cache is never used as a credential or as proof for a server request. */
internal class CachedAccountEntry(private val app: GenesisApplication) {
    data class Entry(val identity: ServerIdentity, val settings: AccountSettings)
    private val kind = "account-entry"
    private fun metadataScope(scope:String)="$scope:public-profile-v1"
    suspend fun read(scope: String): Entry? {
        if (!scope.startsWith("account-")) return null
        val protected=ru.genesis.calendar.security.NativePrivateProducts.isProtected(scope)
        val record = (if(protected)app.database.dao().document(metadataScope(scope),kind)else null)?:app.database.dao().document(scope, kind) ?: return null
        return runCatching {
            val response = JSONObject(LocalCipher().decrypt(record.encrypted, "${record.scope}/$kind"))
            // AuthProtocol derives private routing only from the explicit mode.
            // Adopt the persisted deny marker before decoding an older cache;
            // a stale identity must not expose legacy UI while the vault is locked.
            if(protected)response.getJSONObject("user").put("privatePreferencesMode","e2ee")
            val identity = AuthProtocol.identity(response) ?: return null
            require(CloudAccountSnapshot.scopeFor(identity.uid) == scope)
            if(protected||identity.privateVault){val user=response.getJSONObject("user");user.remove("advicePreferences");user.remove("uiVisibility");user.remove("syncRouting");user.put("privatePreferencesMode","e2ee")}
            Entry(identity, AccountSettings.fromResponse(response) ?: return null)
        }.getOrNull()
    }
    suspend fun save(identity: ServerIdentity, settings: AccountSettings) {
        val scope = CloudAccountSnapshot.scopeFor(identity.uid)
        val user = JSONObject().put("uid", identity.uid).put("email", identity.email).put("displayName", identity.displayName)
            .put("googleAccounts", JSONArray().apply { settings.accounts.filter { it.provider == "google" }.forEach { account -> put(JSONObject()
                .put("id", account.id).put("email", account.email).put("displayName", account.displayName)
                .put("isPrimary", account.isPrimary).put("calendarConnected", account.calendarConnected)
                .put("googleTasksImportReady", account.tasksConnected)) } })
            .put("linkedAccounts", JSONArray().apply { settings.accounts.filter { it.provider != "google" }.forEach { account -> put(JSONObject()
                .put("id", account.id).put("email", account.email).put("displayName", account.displayName)
                .put("isPrimary", account.isPrimary).put("provider", account.provider)
                .put("calendarConnected", account.calendarConnected).put("tasksConnected", account.tasksConnected)) } })
            .put("syncRouting", settings.routing.toJson()).put("multiAccountEnabled", settings.multiAccountEnabled)
            // Preserve metadata for explanation, never the transient live trial proof.
            .put("subscriptionPlan",settings.featureAccess.declaredPlan).put("featureAccess",settings.featureAccess.json())
            .put("trial",settings.trial?.json() ?: JSONObject.NULL)
            .put("adviceCollectionsReady",JSONArray(settings.adviceCollectionsReady))
            .put("advicePreferences",settings.advicePreferences.toJson())
            .put("adviceAvailableCategories",JSONArray(settings.adviceAvailableCategories))
            .put("adviceCatalogAvailable",settings.adviceCatalogAvailable)
            .put("theme", settings.theme).put("themeRevision", settings.themeRevision).put("darkPalette", settings.darkPalette)
            .put("emailVerification", settings.emailVerification.toJson())
            .put("calendarMode", settings.calendarMode).put("taskCalendarMode", settings.taskCalendarMode)
            .put("timeFormat", settings.timeFormat).put("weekStart", settings.weekStart)
            .put("stoicheionDivinationDisabled", settings.divinationDisabled)
            .put("language", settings.language).put("authProvider", settings.authProvider)
            .put("calendarConnected", settings.calendarConnected)
            .put("sharedProjectsEligible", settings.sharedProjectsEligible)
            .put("sharedProjectsLifetimeAccess", settings.sharedProjectsLifetimeAccess)
            .put("sharedProjectsEnabled", settings.sharedProjectsEnabled)
        if(identity.privateVault){user.put("privatePreferencesMode","e2ee");user.remove("advicePreferences");user.remove("uiVisibility");user.remove("syncRouting")}
        val target=if(identity.privateVault)metadataScope(scope)else scope
        val encoded = LocalCipher().encrypt(JSONObject().put("user", user).toString(), "$target/$kind")
        app.database.dao().putDocument(DocumentRecord(target, kind, encoded, System.currentTimeMillis()))
    }
    suspend fun clear(scope: String) {app.database.dao().deleteDocument(metadataScope(scope),kind)
        if(!ru.genesis.calendar.security.NativePrivateProducts.isProtected(scope))app.database.dao().deleteDocument(scope, kind) }
}
