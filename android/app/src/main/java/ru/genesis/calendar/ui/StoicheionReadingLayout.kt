package ru.genesis.calendar.ui

import android.content.Context
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import org.json.JSONObject

internal data class StoicheionReadingText(val upright: String,val reversed: String,val profile: String)

internal data class StoicheionReadingSection(val heading: String, val body: String)

/** Match the website's authored section boundaries without flattening the reading into one paragraph. */
internal fun stoicheionReadingSections(content: String): List<StoicheionReadingSection> {
    val sections = mutableListOf<StoicheionReadingSection>()
    val grammar = StoicheionReadingGrammar
    for (line in content.lines()) {
        val trimmed = line.trim()
        val narrative = when {
            Regex("^(?:The )?(?:reversed|inverted) letter", RegexOption.IGNORE_CASE).containsMatchIn(trimmed) -> "Reversed position"
            Regex("^(?:In the upright position|The fullness of the incarnation in the upright position)", RegexOption.IGNORE_CASE).containsMatchIn(trimmed) -> "Upright position"
            else -> null
        }
        if (narrative != null && sections.lastOrNull()?.heading != narrative) {
            sections += StoicheionReadingSection(narrative, line); continue
        }
        val original = grammar.headings.find(trimmed)?.groupValues?.get(1)
        if (original == null) {
            if (sections.isNotEmpty()) sections[sections.lastIndex] = sections.last().copy(body = sections.last().body + "\n" + line)
            else if (trimmed.isNotEmpty()) sections += StoicheionReadingSection("", line)
            continue
        }
        val english = original.first().isLatinLetter()
        val heading = when {
            grammar.cosmogonic(original) -> if (english) "Cosmogonic profile" else "Космогонический профиль"
            grammar.magical(original) -> if (english) "Magical attunement and Root — ῥίζα" else "Магическая настройка и Корень — ῥίζα"
            grammar.practice(original) -> if (english) "Practice and magical pose" else "Практика и магическая поза"
            grammar.reversed(original) -> "Перевернутое положение"
            else -> original
        }
        var body = trimmed.drop(original.length).replace(Regex("^\\s*:\\s*"), "").trim()
        if (grammar.magical(original) && !grammar.root.containsMatchIn(original))
            body = original + if (body.isNotEmpty()) "\n$body" else ""
        body = body.replace(grammar.paragraphBreaks, "\n")
        sections += StoicheionReadingSection(heading, body)
    }
    return sections.map { it.copy(body = it.body.trim()) }
}

private fun Char.isLatinLetter() = this in 'a'..'z' || this in 'A'..'Z'

@Composable internal fun StoicheionReadingSections(content: String, modifier: Modifier = Modifier) {
    val sections = androidx.compose.runtime.remember(content) { stoicheionReadingSections(content) }
    val listLine = StoicheionReadingGrammar.listLine
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        sections.forEachIndexed { index, section ->
            Surface(Modifier.fillMaxWidth().testTag("stoicheion-reading-section-$index"), shape = AffairsLayout.shape,
                color = MaterialTheme.colorScheme.surfaceContainerLow) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    if (section.heading.isNotBlank()) Text(section.heading, Modifier.semantics { heading() },
                        style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.primary)
                    section.body.split(Regex("\\n{2,}")).filter { it.isNotBlank() }.forEach { paragraph ->
                        val lines = paragraph.lines()
                        if (lines.all { listLine.containsMatchIn(it) }) Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            lines.forEach { line -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                UntranslatedText("•", style = MaterialTheme.typography.bodyMedium)
                                Text(line.replace(Regex("^\\s*-\\s*"), ""), Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                            } }
                        } else Text(paragraph, style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
        }
    }
}
internal fun splitStoicheionReading(context: Context,id: String,content: String): StoicheionReadingText {
    val root=context.assets.open("originals/catalogs/stoicheion-reading-layout.json").bufferedReader().use{JSONObject(it.readText())}
    val spec=root.getJSONObject(id);val paragraphs=content.split(Regex("\\n\\s*\\n"))
    require(paragraphs.size==spec.getInt("paragraphs")){"STOICHEION_READING_LAYOUT_MISMATCH"}
    val upright=spec.getInt("upright");val reversed=spec.getInt("reversed")
    return StoicheionReadingText(paragraphs[upright],paragraphs[reversed],paragraphs.filterIndexed{i,_->i!=upright&&i!=reversed}.joinToString("\n\n"))
}
