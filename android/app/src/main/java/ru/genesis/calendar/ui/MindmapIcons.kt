package ru.genesis.calendar.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.data.MindmapNode

/** Exactly the website's presentation.icon field; keep root images/alignment and unknown extensions. */
internal fun MindmapNode.mindmapIcon(): String? = JSONObject(extensions).optJSONObject("presentation")
    ?.optString("icon")?.takeIf { Regex("[a-z0-9-]{1,60}").matches(it) }
internal fun MindmapNode.withMindmapIcon(icon: String?): MindmapNode {
    require(icon == null || Regex("[a-z0-9-]{1,60}").matches(icon))
    val extra = JSONObject(extensions)
    val presentation = JSONObject(extra.optJSONObject("presentation")?.toString() ?: "{}")
    if (icon == null) presentation.remove("icon") else presentation.put("icon", icon)
    if (presentation.length() == 0) extra.remove("presentation") else extra.put("presentation", presentation)
    return copy(extensions = extra.toString())
}

@Composable internal fun MindmapGlyph(icon: String, modifier: Modifier = Modifier.size(24.dp), ink: Color = LocalContentColor.current) {
    val context = LocalContext.current
    var bitmap by remember(icon) { mutableStateOf<android.graphics.Bitmap?>(null) }
    LaunchedEffect(icon) {
        bitmap = withContext(Dispatchers.IO) { runCatching {
            context.assets.open("originals/mindmap-icons/$icon.png").use(android.graphics.BitmapFactory::decodeStream)
        }.getOrNull() }
    }
    bitmap?.let { Image(it.asImageBitmap(), null, modifier.testTag("mindmap-glyph-$icon"), colorFilter = ColorFilter.tint(ink)) }
}

@Composable internal fun MindmapIconPicker(selected: String?, enabled: Boolean, onChoose: (String?) -> Unit) {
    val context = LocalContext.current
    val language = LocalGenesisLanguage.current
    val catalog = remember { JSONArray(context.assets.open("originals/catalogs/mindmap-icon-catalog.json").bufferedReader().use { it.readText() }) }
    val names = remember { JSONObject(context.assets.open("originals/catalogs/mindmap-icon-names.json").bufferedReader().use { it.readText() }) }
    val allCopy = remember { JSONObject(context.assets.open("originals/catalogs/mindmap-feature-copy.json").bufferedReader().use { it.readText() }) }
    val copy = allCopy.optJSONObject(language) ?: allCopy.getJSONObject("en")
    val labels = names.optJSONArray(language) ?: names.getJSONArray("en")
    var open by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    TextButton({ open = !open }, enabled = enabled, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("mindmap-icon-picker")) {
        selected?.let { MindmapGlyph(it, Modifier.padding(end = 8.dp).size(24.dp)) }
        UntranslatedText(copy.getString("icon"), Modifier.weight(1f))
        AffairsActionIcon(if (open) AffairsAction.COLLAPSE else AffairsAction.EXPAND)
    }
    if (open) {
        AffairsSearchField(query, { query = it.take(80) }, copy.getString("search"), Modifier.testTag("mindmap-icon-search"))
        TextButton({ onChoose(null); open = false }, enabled = enabled) { UntranslatedText(copy.getString("none")) }
        val icons = (0 until catalog.length()).map(catalog::getJSONObject).filter {
            labels.getString(it.getInt("index")).contains(query, true) || it.getString("id").contains(query, true)
        }
        if (icons.isEmpty()) UntranslatedText(copy.getString("empty"))
        LazyVerticalGrid(GridCells.Adaptive(48.dp), Modifier.fillMaxWidth().height(240.dp)) {
            items(icons, key = { it.getString("id") }) { entry ->
                val id = entry.getString("id")
                OutlinedIconButton({ onChoose(id); open = false }, enabled = enabled, shape = AffairsLayout.controlShape,
                    border = selectedControlBorder(selected == id,enabled),
                    colors = IconButtonDefaults.outlinedIconButtonColors(containerColor = selectedControlContainer(selected == id,enabled),
                        contentColor = MaterialTheme.colorScheme.onSurface),
                    modifier = Modifier.size(48.dp).testTag("mindmap-icon-$id").semantics {
                        contentDescription = copy.getString("select") + " " + labels.getString(entry.getInt("index"))
                        this.selected = selected == id
                    }) { MindmapGlyph(id) }
            }
        }
    }
}
