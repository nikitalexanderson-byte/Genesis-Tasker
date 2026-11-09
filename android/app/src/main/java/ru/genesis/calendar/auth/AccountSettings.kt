package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject

data class LinkedGoogleAccount(
    val id: String,
    val email: String,
    val displayName: String,
    val isPrimary: Boolean,
    val calendarConnected: Boolean,
    val tasksConnected: Boolean,
    val provider: String = "google",
)

data class SyncRouting(
    val mode: String,
    val defaultAccountIds: List<String>,
    val categoryAccountIds: Map<String, List<String>>,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("mode", mode)
        .put("defaultAccountIds", JSONArray(defaultAccountIds))
        .put("categoryAccountIds", JSONObject().apply {
            categoryAccountIds.forEach { (categoryId, accounts) -> put(categoryId, JSONArray(accounts)) }
        })

    fun validFor(accounts: List<LinkedGoogleAccount>): Boolean {
        val validIds = accounts.map { it.id }.toSet()
        return mode in setOf("fixed", "choose", "category") &&
            defaultAccountIds.isNotEmpty() && defaultAccountIds.all { it in validIds } &&
            categoryAccountIds.values.all { values -> values.all { it in validIds } }
    }
}

data class UiVisibility(
    val hiddenMenuItems: Set<String> = emptySet(),
    val hiddenSubmenus: Set<String> = emptySet(),
    val hiddenTodayBlocks: Set<String> = emptySet(),
    val enabledCalendars: Set<String> = setOf("profane", "sacred", "lunar"),
    val sacredFeaturesEnabled: Boolean = true,
    val dreamJournalEnabled: Boolean = true,
) {
    val visibleCalendars: Set<String> get() = if (!sacredFeaturesEnabled) setOf("profane")
        else enabledCalendars.ifEmpty { setOf("profane") }
    fun toJson(): JSONObject = JSONObject()
        .put("hiddenMenuItems", JSONArray(hiddenMenuItems.toList()))
        .put("hiddenSubmenus", JSONArray(hiddenSubmenus.toList()))
        .put("hiddenTodayBlocks", JSONArray(hiddenTodayBlocks.toList()))
        .put("enabledCalendars", JSONArray(enabledCalendars.toList()))
        .put("sacredFeaturesEnabled", sacredFeaturesEnabled)
        .put("dreamJournalEnabled", dreamJournalEnabled)

    companion object {
        fun fromJson(value: JSONObject?): UiVisibility {
            if (value == null) return UiVisibility()
            fun entries(key: String): Set<String> = value.optJSONArray(key)?.strings()?.toSet() ?: emptySet()
            return UiVisibility(entries("hiddenMenuItems"), entries("hiddenSubmenus"),
                entries("hiddenTodayBlocks"), value.optJSONArray("enabledCalendars")?.strings()?.toSet()
                    ?.takeIf { it.isNotEmpty() } ?: setOf("profane", "sacred", "lunar"),
                value.optBoolean("sacredFeaturesEnabled", true),value.optBoolean("dreamJournalEnabled",true))
        }
    }
}

data class AccountSettings(
    val accounts: List<LinkedGoogleAccount>,
    val routing: SyncRouting,
    val multiAccountEnabled: Boolean,
    val theme: String,
    val themeRevision: Int,
    val calendarMode: String,
    val taskCalendarMode: String,
    val timeFormat: String,
    val divinationDisabled: Boolean,
    val language: String,
    val isAdmin: Boolean = false,
    val weekStart: String = "monday",
    val gregorianYearStart: String = "january",
    val authProvider: String = "google",
    val calendarConnected: Boolean = false,
    val sharedProjectsEligible: Boolean = false,
    val sharedProjectsLifetimeAccess: Boolean = false,
    val sharedProjectsEnabled: Boolean = false,
    val uiVisibility: UiVisibility = UiVisibility(),
    val advicePreferences: AdvicePreferences = AdvicePreferences(),
    val adviceAvailableCategories: List<String> = listOf("aretology", "hestiology"),
    val adviceCatalogAvailable: Boolean = true,
    val featureAccess: FeatureAccess = FeatureAccess(),
    val adviceCollectionsReady: List<String> = listOf("aurora"),
    val trial: TrialAccess? = null,
    internal val profileReceipt: LiveAccountReceipt? = null,
    val darkPalette: String = "green",
    val emailVerification: EmailVerificationStatus = EmailVerificationStatus(),
) {
    companion object {
        fun fromResponse(response: JSONObject, trialProof: TrialLiveProof? = null,
            profileReceipt: LiveAccountReceipt? = null): AccountSettings? {
            if (response.isNull("user")) return null
            val user = response.getJSONObject("user")
            val hasTrialField = user.has("trial") && !user.isNull("trial")
            val rawTrial = user.optJSONObject("trial")
            val profileTrial = runCatching { TrialAccess.fromJson(rawTrial) }.getOrNull()
            val proof = trialProof?.takeIf { it.userId == user.optString("uid") }
            val decodedAccess = if (hasTrialField && user.optJSONObject("featureAccess") == null)
                FeatureAccess.unverifiedAccount() else FeatureAccess.fromJson(user.optJSONObject("featureAccess"), proof)
            // Independently evaluated serverNow may cross a second; the immutable window must agree.
            val agrees = !hasTrialField && decodedAccess.trial == null || profileTrial != null &&
                decodedAccess.trial?.copy(serverNow = profileTrial.serverNow) == profileTrial
            val access = if (agrees) decodedAccess else decodedAccess.copy(trialProof = null)
            val provider = user.optString("authProvider", "google")
            val array = if (provider == "google") user.getJSONArray("googleAccounts")
                else user.optJSONArray("linkedAccounts") ?: user.getJSONArray("googleAccounts")
            val accounts = (0 until array.length()).map { index ->
                val item = array.getJSONObject(index)
                LinkedGoogleAccount(
                    id = item.getString("id"),
                    email = item.getString("email"),
                    displayName = item.optString("displayName"),
                    isPrimary = item.optBoolean("isPrimary"),
                    calendarConnected = item.optBoolean("calendarConnected"),
                    tasksConnected = item.optBoolean(if (provider == "google") "googleTasksImportReady" else "tasksConnected"),
                    provider = item.optString("provider", provider),
                )
            }
            val route = user.getJSONObject("syncRouting")
            val categoryValue = route.opt("categoryAccountIds")
            val categoryMap = when (categoryValue) {
                is JSONObject -> categoryValue
                // Servers before 2.2.1 encoded an empty PHP map as []. Accept only
                // that legacy empty shape while keeping malformed populated arrays invalid.
                is JSONArray -> if (categoryValue.length() == 0) JSONObject()
                    else throw IllegalArgumentException("Invalid category account routing")
                null, JSONObject.NULL -> JSONObject()
                else -> throw IllegalArgumentException("Invalid category account routing")
            }
            val categories = categoryMap.keys().asSequence().associateWith { key -> categoryMap.getJSONArray(key).strings() }
            val routing = SyncRouting(route.getString("mode"), route.getJSONArray("defaultAccountIds").strings(), categories)
            require(accounts.isNotEmpty() && routing.validFor(accounts)) { "Invalid account routing" }
            return AccountSettings(accounts, routing, user.optBoolean("multiAccountEnabled"),
                user.optString("theme", "standart"), user.optInt("themeRevision", 0),
                user.optString("calendarMode", "profane"), user.optString("taskCalendarMode", "profane"),
                user.optString("timeFormat", "24h"), user.optBoolean("stoicheionDivinationDisabled"),
                user.optString("language", "ru"), user.optBoolean("isAdmin"), user.optString("weekStart", "monday"),
                user.optString("gregorianYearStart", "january"),
                user.optString("authProvider", "google"), user.optBoolean("calendarConnected"),
                user.optBoolean("sharedProjectsEligible"), user.optBoolean("sharedProjectsLifetimeAccess"),
                user.optBoolean("sharedProjectsEnabled"),
                UiVisibility.fromJson(user.optJSONObject("uiVisibility")),
                AdvicePreferences.fromJson(user.optJSONObject("advicePreferences")),
                user.optJSONArray("adviceAvailableCategories")?.strings()?.filter { it in adviceCategories } ?: listOf("aretology", "hestiology"),
                user.optBoolean("adviceCatalogAvailable", true),
                access,
                user.optJSONArray("adviceCollectionsReady")?.strings()?.filter { it in adviceCollections } ?: listOf("aurora"),
                profileTrial ?: access.trial, profileReceipt?.takeIf { it.userId == user.optString("uid") },
                user.optString("darkPalette", "green").takeIf { it in setOf("green","burgundy","blue","violet") } ?: "green",
                EmailVerificationStatus.fromJson(user.optJSONObject("emailVerification")))
        }
    }
}

private fun JSONArray.strings(): List<String> = (0 until length()).map { getString(it) }
