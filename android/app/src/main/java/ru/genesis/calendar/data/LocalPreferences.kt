package ru.genesis.calendar.data

import android.content.Context
import androidx.datastore.preferences.core.*
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import org.json.JSONObject
import ru.genesis.calendar.domain.CalendarMode

private val Context.genesisPreferences by preferencesDataStore("genesis_preferences")
data class UiPreferences(val display: CalendarMode = CalendarMode.PROFANE,
    val input: CalendarMode = CalendarMode.PROFANE, val use24: Boolean = true,
    val divinationDisabled: Boolean = false, val language: String = "ru",
    val weekStartsOnSunday: Boolean = true, val wideNavigationOnLeft: Boolean = true,
    val navigationLabels: Boolean = false, val navigationAutoScroll: Boolean = false,
    val gregorianYearStartsInMarch: Boolean = false, val regionalSeasonArt: Boolean = false,
    val regionSource: String = "device", val manualRegionZone: String = "",
    val ipRegionZone: String = "", val ipRegionLabel: String = "",
    val fullMoonLeadDays: Set<Int> = emptySet(), val newMoonLeadDays: Set<Int> = emptySet(),
    val showMissedTasksToday: Boolean = true,
    val menuSwipeEnabled: Boolean = true, val menuSwipeSubmenus: Boolean = true,
    val settingsMenuLabels: Boolean = false, val updateRemindersEnabled: Boolean = true,
    val menuThreadsEnabled: Boolean = false,
    val settingsSubmenuEnabled: Boolean = true, val theme: String? = null, val darkPalette: String = "green",
    val todayBlockOrder: String = "", val weatherTemperatureUnit: String = "celsius", val weatherPressureUnit: String = "hpa",
    val todayHiddenBlocks: String = "")
class LocalPreferences(private val context: Context, private val scope: String) {
    private val mutation=ru.genesis.calendar.auth.NativeBackupMutationGuard(scope)
    private fun isPrivateScope()=ru.genesis.calendar.security.NativePrivateProducts.isProtected(scope)
    private fun raw(values:Preferences)=JSONObject().apply{values.asMap().forEach{(key,value)->if(key.name.startsWith("$scope:"))put(key.name.removePrefix("$scope:"),value.toString())}}
    private suspend fun privateState(seed:Preferences?=null,change:((JSONObject)->Unit)?=null):JSONObject {
        val app=context.applicationContext as ru.genesis.calendar.GenesisApplication
        if(app.workspaceScope!=scope)throw CancellationException("E2EE_ACCOUNT_CHANGED")
        return try{ru.genesis.calendar.security.NativePrivateProducts.uiPreferences(scope,raw(seed?:context.genesisPreferences.data.first()),change)}
        catch(error:Exception){
            if(error is CancellationException)throw error
            if(app.workspaceScope==scope&&ru.genesis.calendar.security.NativePrivateProducts.isOpen(scope))ru.genesis.calendar.security.NativePrivateProducts.lock()
            throw CancellationException("E2EE_UI_PREFERENCES_CLOSED").apply{initCause(error)}
        }
    }
    private suspend fun legacyWrite(operation:suspend (()->Unit)->Unit){
        val app=context.applicationContext as? ru.genesis.calendar.GenesisApplication;val epoch=app?.workspaceEpoch
        fun current(){mutation.check();if(scope.startsWith("account-")&&(app?.workspaceScope!=scope||app?.workspaceEpoch!=epoch))throw CancellationException("E2EE_ACCOUNT_CHANGED")}
        try{if(scope.startsWith("account-")){val owner=checkNotNull(app);NativeLegacyOperationPermit.run(owner.database,scope,::current){operation(::current);current()}}else{current();operation(::current);current()}}
        catch(error:ru.genesis.calendar.auth.AuthApiError){if(error.code!="E2EE_LOCAL_LEGACY_TRANSPORT_FORBIDDEN")throw error;throw CancellationException(error.code)}
    }
    internal suspend fun backupRaw(): JSONObject {
        val values=context.genesisPreferences.data.first()
        return JSONObject().apply { values.asMap().forEach { (key,value) ->
            if(key.name.startsWith("$scope:"))put(key.name.removePrefix("$scope:"),value.toString())
        } }
    }
    internal suspend fun holdPending(expected: JSONObject) {
        context.genesisPreferences.edit { values ->
            for(name in names) {
                val field="pending:$name"
                check(values[pendingKey(name)]==expected.optString(field).takeIf { expected.has(field) }) { "BACKUP_LOCAL_CHANGED" }
            }
            names.forEach { values.remove(pendingKey(it)) }
        }
    }
    private fun moonLeadDays(value: String?): Set<Int> = value.orEmpty().split(',')
        .mapNotNull { it.trim().toIntOrNull()?.takeIf { day -> day in 1..3 } }.toSet()
    private fun key(name: String) = stringPreferencesKey("$scope:$name")
    private fun pendingKey(name: String) = stringPreferencesKey("$scope:pending:$name")
    private val names = setOf("display", "input", "time", "weekStart", "gregorianYearStart",
        "language", "stoicheionDivinationDisabled", "sharedProjectsEnabled", "theme", "themeRevision", "darkPalette")
    internal val selectedLanguage = context.genesisPreferences.data.map {
        WelcomeLanguagePreference(it[key("language")]?.takeIf { value -> value in publicLanguages })
    }
    /** Exact two device-local reminder values, including absent or invalid old
     * values. Ordinary UiPreferences parsing normalizes malformed lead lists. */
    internal suspend fun reminderMigrationRaw():JSONObject {
        val values=context.genesisPreferences.data.first().asMap()
        return JSONObject().apply{for(name in listOf("fullMoonLeadDays","newMoonLeadDays")){
            val value=values.entries.firstOrNull{it.key.name=="$scope:$name"}?.value
            put(name,value?:JSONObject.NULL)
        }}
    }
    val pending = combine(context.genesisPreferences.data,ru.genesis.calendar.security.NativePrivateProducts.revision){values,_->
        if(isPrivateScope()){
            if(!ru.genesis.calendar.security.NativePrivateProducts.isOpen(scope))emptyMap()
            else privateState(values).getJSONObject("pending").let{pending->pending.keys().asSequence().associateWith{pending.getString(it)}}
        }else names.mapNotNull{name->values[pendingKey(name)]?.let{name to it}}.toMap()
    }.flowOn(Dispatchers.IO)
    private fun decode(it:Preferences)=UiPreferences(CalendarMode.fromWire(it[key("display")] ?: "profane"), CalendarMode.fromWire(it[key("input")] ?: "profane"),
            it[key("time")] != "12h", it[key("stoicheionDivinationDisabled")] == "true",
            it[key("language")].takeIf { value -> value in setOf("ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja") }
                ?: if (scope == "welcome") welcomeLanguageForDevice() else "ru",
            it[key("weekStart")] != "monday", it[key("wideNavigation")] != "top",
            it[key("navigationLabels")] == "text", it[key("navigationAutoScroll")] == "true",
            it[key("gregorianYearStart")] == "march", it[key("seasonArtMode")] == "regional",
            it[key("regionSource")].takeIf { value -> value in setOf("device", "ip", "manual") } ?: "device",
            it[key("manualRegionZone")] ?: "", it[key("ipRegionZone")] ?: "",
            it[key("ipRegionLabel")] ?: "",
            moonLeadDays(it[key("fullMoonLeadDays")]), moonLeadDays(it[key("newMoonLeadDays")]),
            it[key("showMissedTasksToday")] != "false",
            it[key("menuSwipeEnabled")] != "false", it[key("menuSwipeSubmenus")] != "false",
            it[key("settingsMenuLabels")] == "text",
            it[key("updateRemindersEnabled")] != "false",
            it[key("menuThreadsEnabled")] == "true",
            it[key("settingsSubmenuEnabled")] != "false",
            it[key("theme")]?.takeIf { value -> value in setOf("standart", "standart-dark", "experimental", "experimental-dark") },
            it[key("darkPalette")]?.takeIf { value -> value in setOf("green", "burgundy", "blue", "violet") } ?: "green",
            it[key("todayBlockOrder")] ?: "",
            it[key("weatherTemperatureUnit")]?.takeIf { value -> value in setOf("celsius", "fahrenheit") } ?: "celsius",
            it[key("weatherPressureUnit")]?.takeIf { value -> value in setOf("hpa", "mmhg") } ?: "hpa",
            it[key("todayHiddenBlocks")] ?: "")
    val values=combine(context.genesisPreferences.data,ru.genesis.calendar.security.NativePrivateProducts.revision){legacy,_->
        if(!isPrivateScope())decode(legacy)
        else if(!ru.genesis.calendar.security.NativePrivateProducts.isOpen(scope))UiPreferences()
        else {
            val state=privateState(legacy).getJSONObject("values")
            val projection=mutablePreferencesOf()
            for(name in state.keys())projection[key(name)]=state.getString(name)
            decode(projection)
        }
    }.flowOn(Dispatchers.IO)
    suspend fun set(name: String, value: String) {
        if(isPrivateScope()){privateState(change={it.getJSONObject("values").put(name,value)});return}
        val save:suspend (()->Unit)->Unit={guard->legacyWrite{current->context.genesisPreferences.edit { current();guard();mutation.check();it[key(name)] = value }};Unit}
        if(name in setOf("fullMoonLeadDays","newMoonLeadDays"))ru.genesis.calendar.reminders.legacyReminderOperation(context,scope,save) else save({})
    }
    suspend fun initializeNewAccount() {
        if(isPrivateScope())return
        legacyWrite{current->context.genesisPreferences.edit { prefs ->
            current()
            mutation.check()
            mapOf("display" to "profane", "input" to "profane", "weekStart" to "monday",
                "navigationLabels" to "icons", "menuSwipeEnabled" to "true",
                "menuSwipeSubmenus" to "true", "settingsMenuLabels" to "icons",
                "settingsSubmenuEnabled" to "true", "menuThreadsEnabled" to "false",
                "regionSource" to "device").forEach { (name, value) ->
                if (prefs[key(name)] == null) prefs[key(name)] = value
            }
        }}
    }
    suspend fun setPending(name: String, value: String) {
        require(name in names && name !in setOf("theme", "themeRevision"))
        if(isPrivateScope()){privateState(change={it.getJSONObject("values").put(name,value);it.getJSONObject("pending").put(name,value)});return}
        legacyWrite{current->context.genesisPreferences.edit { current();mutation.check();it[key(name)] = value; it[pendingKey(name)] = value }}
    }
    suspend fun setPendingTheme(value: String, expectedRevision: Int) {
        require(value in setOf("standart", "standart-dark") && expectedRevision >= 0)
        if(isPrivateScope()){privateState(change={it.getJSONObject("values").put("theme",value);it.getJSONObject("pending").put("theme",value).put("themeRevision",expectedRevision.toString())});return}
        legacyWrite{current->context.genesisPreferences.edit {
            current()
            mutation.check()
            it[key("theme")] = value
            it[pendingKey("theme")] = value
            it[pendingKey("themeRevision")] = expectedRevision.toString()
        }}
    }
    suspend fun setRemote(name: String, value: String) {
        if(isPrivateScope()){
            // An identity projection arriving after lock has no write authority.
            if(!ru.genesis.calendar.security.NativePrivateProducts.isOpen(scope))return
            privateState(change={if(!it.getJSONObject("pending").has(name))it.getJSONObject("values").put(name,value)});return
        }
        legacyWrite{current->context.genesisPreferences.edit { current();mutation.check();if (it[pendingKey(name)] == null) it[key(name)] = value }}
    }
    suspend fun acknowledge(changes: Map<String, String>) {
        if(isPrivateScope()){privateState(change={state->val pending=state.getJSONObject("pending")
            if(changes.containsKey("theme")&&changes.containsKey("themeRevision")&&pending.opt("theme")==changes["theme"]&&pending.opt("themeRevision")==changes["themeRevision"]){pending.remove("theme");pending.remove("themeRevision")}
            changes.filterKeys{it !in setOf("theme","themeRevision")}.forEach{(name,value)->if(pending.opt(name)==value)pending.remove(name)}
        });return}
        legacyWrite{current->context.genesisPreferences.edit { prefs ->
            current()
            mutation.check()
            // The same color chosen after a new pull is a different CAS operation.
            if (changes.containsKey("theme") && changes.containsKey("themeRevision") &&
                prefs[pendingKey("theme")] == changes["theme"] &&
                prefs[pendingKey("themeRevision")] == changes["themeRevision"]) {
                prefs.remove(pendingKey("theme")); prefs.remove(pendingKey("themeRevision"))
            }
            changes.filterKeys { it !in setOf("theme", "themeRevision") }.forEach { (name, value) ->
                if (prefs[pendingKey(name)] == value) prefs.remove(pendingKey(name))
            }
        }}
    }
}
