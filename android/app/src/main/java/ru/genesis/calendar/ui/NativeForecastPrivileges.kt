package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.HorizontalDivider
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import org.json.JSONObject

@Composable internal fun NativeForecastPrivileges(users: List<JSONObject>, busy: Boolean,
    onChange: (String, Boolean, Int) -> Unit, modifier: Modifier = Modifier) {
    val copy = modelingServiceCopy()
    var search by remember { mutableStateOf("") }
    val matches = users.filter { (it.optString("displayName") + " " + it.optString("email")).contains(search.trim(), ignoreCase = true) }
    Column(modifier.fillMaxWidth().testTag("admin-forecast-privileges"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        UntranslatedText(copy.getString("privilegeHelp"), style = MaterialTheme.typography.bodyMedium)
        OutlinedTextField(search, { search = it }, enabled = !busy, singleLine = true,
            label = { UntranslatedText(copy.getString("searchUser")) }, modifier = Modifier.fillMaxWidth().testTag("admin-forecast-search"))
        LazyColumn(Modifier.weight(1f, fill = false).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            items(matches, key = { it.getString("id") }) { user ->
                Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    UntranslatedText(user.optString("displayName").ifBlank { user.getString("email") }, style = MaterialTheme.typography.titleSmall)
                    UntranslatedText(user.getString("email"), style = MaterialTheme.typography.bodySmall)
                    if (user.optBoolean("forecastElitePlus")) UntranslatedText("Elite+", color = MaterialTheme.colorScheme.primary)
                    OutlinedButton(onClick = { onChange(user.getString("id"), !user.optBoolean("forecastElitePlus"), user.optInt("forecastPrivilegeRevision")) },
                        enabled = !busy, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("admin-forecast-${user.getString("id")}")) {
                        UntranslatedText(copy.getString(if (user.optBoolean("forecastElitePlus")) "revoke" else "grant"))
                    }
                    HorizontalDivider()
                }
            }
        }
    }
}
