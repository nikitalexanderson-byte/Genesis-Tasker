package ru.genesis.calendar.domain

import android.content.Context
import org.json.JSONObject
import org.json.JSONArray

data class RestorationNeedContent(val risk: String, val quality: String, val intention: String,
    val action: String, val practice: String, val supportId: String, val practiceId: String)
data class RestorationMyth(val title: String, val body: String, val source: String, val url: String)
data class RestorationSectorContent(val id: String, val title: String, val field: String,
    val ambivalence: String, val myth: RestorationMyth, val needs: Map<String, RestorationNeedContent>)
data class RestorationAuxiliaryContent(val id: String, val word: String, val title: String,
    val purpose: String, val practiceId: String)
data class RestorationLetterNeed(val action: String, val practice: String)
data class RestorationLetterFocus(val risk: String, val quality: String, val needs: Map<String, RestorationLetterNeed>)
data class RestorationFramework(val title: String, val formula: String, val body: String)
data class StoicheionRestorationCatalog(val sectors: Map<String, RestorationSectorContent>,
    val auxiliaries: List<RestorationAuxiliaryContent>, val letterFoci: Map<String, RestorationLetterFocus>,
    val ui: Map<String, String>, val framework: RestorationFramework) {
    fun copy(key: String) = ui.getValue(key)
}

/** One shared authored catalog and UI dictionary are packaged from the website, without a fork. */
object StoicheionRestorationCatalogSource {
    fun load(context: Context, language: String): StoicheionRestorationCatalog {
        fun asset(name: String) = context.assets.open("originals/catalogs/$name.json")
            .bufferedReader(Charsets.UTF_8).use { it.readText() }
        val raw = asset("stoicheion-restoration-content")
        val ui = asset("stoicheion-restoration-ui")
        val practices = context.assets.open("catalogs/theokyklos.json").bufferedReader(Charsets.UTF_8).use { it.readText() }
        val values = if (language in setOf("ru", "en")) null else JSONObject(context.assets
            .open("originals/catalogs/stoicheion-restoration-locales/$language.json").bufferedReader(Charsets.UTF_8).use { it.readText() }).getJSONArray("values")
        return parse(raw, ui, language, translationMap(raw, ui, practices, language, values))
    }
    /** Match the authored web catalog's source order; JSON object iteration order is not portable. */
    fun translationMap(raw: String, uiRaw: String, practicesRaw: String, language: String, values: JSONArray?): Map<String, String> {
        // Possessive chunks avoid one recursive regex frame per character on Android's small stacks.
        val pairs = Regex("""\{\s*"ru"\s*:\s*("(?:[^"\\]++|\\.)*+")\s*,\s*"en"\s*:\s*("(?:[^"\\]++|\\.)*+")\s*\}""").findAll(raw).map {
            JSONObject("{\"v\":${it.groupValues[1]}}").getString("v") to JSONObject("{\"v\":${it.groupValues[2]}}").getString("v")
        }.toMutableList()
        val root = JSONObject(raw)
        val practices = JSONObject(practicesRaw).getJSONArray("practices")
        val auxiliaries = root.getJSONArray("auxiliaries")
        for (i in 0 until auxiliaries.length()) {
            val id = auxiliaries.getJSONObject(i).getString("practiceId")
            val practice = (0 until practices.length()).map(practices::getJSONObject).first { it.getString("id") == id }
            for (key in listOf("title", "description")) practice.getJSONObject(key).let { pairs += it.getString("ru") to it.getString("en") }
        }
        val indices = linkedMapOf<String, Int>()
        pairs.forEach { if (it.second !in indices) indices[it.second] = indices.size }
        if (values != null) require(values.length() == indices.size) { "Restoration translation catalog is out of date" }
        return buildMap {
            for ((ru, en) in pairs) {
                val translated = when (language) { "ru" -> ru; "en" -> en; else -> requireNotNull(values).getString(indices.getValue(en)) }
                put(ru, translated); put(en, translated)
            }
            val ui = JSONObject(uiRaw)
            val source = ui.getJSONObject("ru")
            val target = ui.getJSONObject(language)
            source.keys().forEach { key -> put(source.getString(key), target.getString(key)); put(ui.getJSONObject("en").getString(key), target.getString(key)) }
        }
    }
    fun parse(raw: String, uiRaw: String, language: String, translations: Map<String, String> = emptyMap()): StoicheionRestorationCatalog {
        val root = JSONObject(raw)
        val localizedLanguage = if (language == "ru") "ru" else "en"
        fun JSONObject.localized(key: String): String = getJSONObject(key).let {
            translations[it.getString("ru")] ?: it.getString(localizedLanguage)
        }
        val auxiliaryArray = root.getJSONArray("auxiliaries")
        val auxiliaries = (0 until auxiliaryArray.length()).map { index ->
            val row = auxiliaryArray.getJSONObject(index)
            RestorationAuxiliaryContent(row.getString("id"), row.getString("word"), row.localized("title"),
                row.localized("purpose"), row.getString("practiceId"))
        }
        require(auxiliaries.map { it.id } == StoicheionRestoration.supports.map { it.id })
        auxiliaries.forEach { row ->
            require(StoicheionRestoration.isopsephy(row.word) == StoicheionRestoration.supports.first { it.id == row.id }.value.toLong())
            require(row.practiceId in StoicheionRestoration.practiceIds)
        }
        val sectorArray = root.getJSONArray("sectors")
        val sectors = (0 until sectorArray.length()).map { index ->
            val row = sectorArray.getJSONObject(index)
            val myth = row.getJSONObject("myth")
            val needs = StoicheionRestoration.needs.associateWith { need ->
                val text = row.getJSONObject("needs").getJSONObject(need)
                RestorationNeedContent(text.localized("risk"), text.localized("quality"), text.localized("intention"),
                    text.localized("action"), text.localized("practice"), text.getString("supportId"), text.getString("practiceId"))
            }
            require(needs.values.all { it.practiceId in StoicheionRestoration.practiceIds &&
                it.supportId in auxiliaries.map { auxiliary -> auxiliary.id } })
            RestorationSectorContent(row.getString("id"), row.localized("title"), row.localized("field"), row.localized("ambivalence"),
                RestorationMyth(myth.localized("title"), myth.localized("body"), myth.getString("source"), myth.getString("url")), needs)
        }.associateBy { it.id }
        require(sectors.keys == StoicheionRestoration.positions.toSet())
        val focusRoot = root.getJSONObject("letterFoci")
        val foci = StoicheionRestoration.letters.associate { letter ->
            val focus = focusRoot.getJSONObject(letter.id)
            letter.id to RestorationLetterFocus(focus.localized("risk"), focus.localized("quality"),
                StoicheionRestoration.needs.associateWith { need ->
                    val guidance = focus.getJSONObject("needs").getJSONObject(need)
                    RestorationLetterNeed(guidance.localized("action"), guidance.localized("practice"))
                })
        }
        val uiRoot = JSONObject(uiRaw)
        val ui = uiRoot.optJSONObject(language) ?: uiRoot.getJSONObject("en")
        val framework = root.getJSONObject("framework")
        return StoicheionRestorationCatalog(sectors, auxiliaries, foci,
            ui.keys().asSequence().associateWith { ui.getString(it) },
            RestorationFramework(framework.localized("title"), framework.getString("formula"), framework.localized("body")))
    }
}
