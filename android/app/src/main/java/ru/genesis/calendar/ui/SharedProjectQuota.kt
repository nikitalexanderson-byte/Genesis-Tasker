package ru.genesis.calendar.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import org.json.JSONObject

/** An invitation uses the space owner's server quota, never the member's personal count. */
internal fun sharedRootProjectSlotAvailable(quota: JSONObject?): Boolean =
    quota == null || !quota.has("remaining") || quota.isNull("remaining") || quota.optInt("remaining") > 0

@Composable internal fun SharedProjectQuotaDescription(quota: JSONObject?, english: Boolean) {
    val usage = quota?.takeIf { it.has("count") && it.has("limit") && !it.isNull("limit") }
        ?.let { "${it.optInt("count")} / ${it.optInt("limit")}. " }.orEmpty()
    Text(usage + if (english)
        "Top-level projects share the workspace owner's allowance across all their workspaces. Subprojects are unlimited. A new workspace needs a free project slot."
    else "Проекты первого уровня используют общий лимит владельца во всех его пространствах. Подпроекты не ограничены. Для нового пространства нужен свободный слот проекта.",
        modifier = Modifier.testTag("shared-owner-project-quota"), style = MaterialTheme.typography.bodySmall)
}
