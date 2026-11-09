package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import ru.genesis.calendar.auth.AuthController
import ru.genesis.calendar.auth.FeatureAccess

/** Server entitlements remain the only authority; opening comparison changes no access. */
internal val LocalFeatureAccess = staticCompositionLocalOf { FeatureAccess() }
internal val LocalNativeUpgrade = staticCompositionLocalOf<((String?) -> Unit)?> { null }

internal data class NativeUpgradeActions(val feature: (String?) -> Unit, val plan: (String) -> Unit)

@Composable internal fun rememberNativeUpgrade(controller: AuthController, userId: String?, access: FeatureAccess,
    language: String, enabled: Boolean, surfaces: NativeGuidanceSurfaces? = null,
    onContext: (String) -> Unit = {}, onVisibility: (Boolean) -> Unit = {}): NativeUpgradeActions? {
    var open by rememberSaveable(userId) { mutableStateOf(false) }
    var feature by rememberSaveable(userId) { mutableStateOf<String?>(null) }
    var plan by rememberSaveable(userId) { mutableStateOf<String?>(null) }
    val latestContext by rememberUpdatedState(onContext)
    val latestVisibility by rememberUpdatedState(onVisibility)
    if (enabled && userId != null) CompositionLocalProvider(LocalNativeGuidanceSurfaces provides surfaces) {
        NativeUpgradeDialog(controller, userId, access, language, feature, open = open, initialPlan = plan,
            onGuidanceVisibility = { latestVisibility(it) }) { open = false }
    }
    return if (enabled && userId != null) remember(userId) { NativeUpgradeActions(
        feature = { requested -> plan = null; feature = requested; requested?.let(latestContext); open = true },
        plan = { requested -> if (requested in setOf("standart", "premium")) { plan = requested; feature = null; open = true } }
    ) } else null
}

internal fun isNativePlanLimit(message: String?): Boolean = message?.let {
    it == "FEATURE_SUBSCRIPTION_REQUIRED" || it.startsWith("SUBSCRIPTION_QUOTA_") || it.startsWith("Достигнут лимит тарифа.")
} == true

@Composable internal fun NativeUpgradePrompt(feature: String? = null, modifier: Modifier = Modifier) {
    val open = LocalNativeUpgrade.current ?: return
    TextButton({ open(feature) }, modifier.heightIn(min = 48.dp).testTag("upgrade-prompt-${feature ?: "plans"}")) {
        UpgradeVectorMark(Modifier.size(20.dp), MaterialTheme.colorScheme.primary)
        Spacer(Modifier.width(8.dp))
        Text(if (LocalGenesisLanguage.current == "en") "Compare plans" else "Сравнить тарифы")
    }
}

@Composable internal fun NativeAccessMessage(message: String, feature: String? = null,
    modifier: Modifier = Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        val en = LocalGenesisLanguage.current == "en"
        Text(if (message == "FEATURE_SUBSCRIPTION_REQUIRED") {
            if (en) "This feature is not included in your current plan." else "Эта функция недоступна в текущем тарифе."
        } else if (isNativePlanLimit(message)) {
            if (en) "Your plan limit has been reached. Existing data is preserved." else "Достигнут лимит тарифа. Существующие данные сохраняются."
        } else message,
            color = MaterialTheme.colorScheme.error)
        if (isNativePlanLimit(message)) NativeUpgradePrompt(feature)
        if (isNativePlanLimit(message)) NativeContextualPlanGuidance(message, feature)
    }
}

@Composable internal fun NativeFeatureGate(feature: String, message: String, content: @Composable () -> Unit) {
    if (LocalFeatureAccess.current.allows(feature)) content()
    else Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(message, style = MaterialTheme.typography.bodyMedium)
        // Disabled features such as the assistant are not sold as an upgrade.
        if (feature !in LocalFeatureAccess.current.disabledFeatures) NativeUpgradePrompt(feature)
        if (feature !in LocalFeatureAccess.current.disabledFeatures) NativeContextualPlanGuidance("FEATURE_SUBSCRIPTION_REQUIRED", feature)
    }
}
