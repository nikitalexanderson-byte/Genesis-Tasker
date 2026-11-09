package ru.genesis.calendar.ui

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.domain.*
import ru.genesis.calendar.domain.habits.Habit
import java.util.concurrent.ConcurrentHashMap

private val restorationLanguages = listOf("ru", "en", "de", "el", "es", "fr", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja")
private data class DisplayRestorationCatalog(val content: StoicheionRestorationCatalog,
    val practices: TheokyklosCatalog, val letterNames: Map<String, String>)
private val displayRestorationCatalogs = ConcurrentHashMap<String, DisplayRestorationCatalog>()

private fun displayRestorationCatalog(context: Context, language: String) = displayRestorationCatalogs.getOrPut(language) {
    val original = JSONArray(context.assets.open("stoicheion.json").bufferedReader().use { it.readText() })
    val localized = if (language == "ru") null else JSONObject(context.assets.open("originals/i18n/catalog-translations/$language.json")
        .bufferedReader().use { it.readText() }).getJSONObject("stoicheion")
    DisplayRestorationCatalog(StoicheionRestorationCatalogSource.load(context, language), TheokyklosCatalogSource.load(context, language),
        (0 until original.length()).associate { i -> original.getJSONObject(i).let { row ->
            val id = row.getString("id"); id to (localized?.getJSONObject(id)?.getString("name") ?: row.getString("name"))
        } })
}

private fun restorationParagraphs(snapshot: StoicheionRestorationSnapshot, catalog: DisplayRestorationCatalog, language: String): List<String> {
    val content = catalog.content
    val need = content.sectors.getValue(snapshot.sectorId).needs.getValue(snapshot.need)
    val focus = content.letterFoci.getValue(snapshot.letterId).needs.getValue(snapshot.need)
    val helpers = content.auxiliaries.filter { it.id in snapshot.supportIds }.map { auxiliary ->
        val practice = catalog.practices.practices.first { it.id == auxiliary.practiceId }
        if (language == "en") "${practice.title.en}: ${practice.description.en}" else "${practice.title.ru}: ${practice.description.ru}"
    }
    val resource = StoicheionRestoration.lettersById.getValue(snapshot.resourceLetterId)
    return listOf(need.action, focus.action) + helpers + listOf(need.practice, focus.practice,
        "${resource.symbol} · ${catalog.letterNames.getValue(resource.id)}: ${content.letterFoci.getValue(resource.id).quality}", need.intention)
}

/** Only exact authored paragraphs are translated. No stored snapshot or personal wording is rewritten. */
internal fun restorationDisplay(context: Context, habit: Habit, language: String): Pair<String, String> {
    val snapshot = habit.stoicheionRestoration ?: return habit.title to habit.description
    val target = displayRestorationCatalog(context, language)
    val targetParts = restorationParagraphs(snapshot, target, language)
    val title = target.content.copy("title") + " · " + target.letterNames.getValue(snapshot.letterId)
    val targetPractice = target.practices.practices.first { it.id == snapshot.practiceId }
    val targetPracticeTitle = if (language == "en") targetPractice.title.en else targetPractice.title.ru
    val replacements = buildMap {
        restorationLanguages.forEach { sourceLanguage ->
            val source = displayRestorationCatalog(context, sourceLanguage)
            restorationParagraphs(snapshot, source, sourceLanguage).forEachIndexed { index, text -> put(text, targetParts[index]) }
            put(source.content.copy("title") + " · " + source.letterNames.getValue(snapshot.letterId), title)
            val practice = source.practices.practices.first { it.id == snapshot.practiceId }
            put(if (sourceLanguage == "en") practice.title.en else practice.title.ru, targetPracticeTitle)
        }
    }
    return (replacements[habit.title] ?: habit.title) to habit.description.split("\n\n").joinToString("\n\n") { replacements[it] ?: it }
}

@Composable
internal fun restorationHabitDisplay(habit: Habit): Pair<String, String> {
    val context = LocalContext.current.applicationContext
    val language = LocalGenesisLanguage.current
    return remember(habit, language) { runCatching { restorationDisplay(context, habit, language) }.getOrDefault(habit.title to habit.description) }
}

@Composable
internal fun habitDisplayDescription(habit: Habit): String =
    if (habit.stoicheionRestoration == null) habit.description else restorationHabitDisplay(habit).second
