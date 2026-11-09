package ru.genesis.calendar.auth

import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import ru.genesis.calendar.ui.LocalNativeUpgrade
import ru.genesis.calendar.ui.NativeUpgradeDialog
import ru.genesis.calendar.ui.OutlinedButton
import ru.genesis.calendar.ui.Text
import ru.genesis.calendar.ui.UpgradeVectorMark
import ru.genesis.calendar.ui.nativePlanName
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Account settings and the sidebar open the same comparison and verified checkout. */
@Composable internal fun BillingPanel(controller: AuthController, userId: String, email: String,
    access: FeatureAccess, language: String) {
    val en = language == "en"
    val openUpgrade = LocalNativeUpgrade.current
    var comparisonOpen by rememberSaveable(userId) { mutableStateOf(false) }
    val currentAccess = access.currentAccess()
    val plan = access.currentPlan()
    val planLabel = if (access.trialActive()) requireNotNull(access.trial?.label) else nativePlanName(plan)
    Column(Modifier.fillMaxWidth().testTag("billing-panel"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(if (en) "Plan and access" else "Тариф и доступ", style = MaterialTheme.typography.titleMedium)
        Text((if (en) "Current plan: " else "Ваш тариф: ") + planLabel,
            style = MaterialTheme.typography.titleSmall, modifier = Modifier.testTag("billing-current-plan"))
        if (!currentAccess.lifetimePremium && plan != "free") currentAccess.validUntil?.let { expiry ->
            Text((if (en) "Access until: " else "Доступ до: ") + expiry.atZone(ZoneId.systemDefault())
                .format(DateTimeFormatter.ofPattern("d MMM yyyy", Locale.forLanguageTag(language))),
                style = MaterialTheme.typography.bodySmall)
        }
        Text((if (en) "Primary Google account: " else "Основной Google-аккаунт: ") + email, style = MaterialTheme.typography.bodySmall)
        Text(if (en) "Purchases belong to this account. Linked Google accounts share access and keep their sync connections."
            else "Покупки принадлежат этому аккаунту. Подключённые Google-аккаунты используют общий доступ и сохраняют свои подключения синхронизации.",
            style = MaterialTheme.typography.bodySmall)
        OutlinedButton({ if (openUpgrade != null) openUpgrade(null) else comparisonOpen = true },
            Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("billing-compare")) {
            UpgradeVectorMark(Modifier.size(20.dp), MaterialTheme.colorScheme.primary)
            Spacer(Modifier.width(8.dp))
            Text(if (en) "Compare plans" else "Сравнить тарифы")
        }
    }
    if (openUpgrade == null) NativeUpgradeDialog(controller, userId, access, language, open = comparisonOpen) { comparisonOpen = false }
}
