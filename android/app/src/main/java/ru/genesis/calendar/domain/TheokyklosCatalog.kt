package ru.genesis.calendar.domain

import android.content.Context
import org.json.JSONObject

data class TheokyklosText(val ru: String, val en: String)
data class TheokyklosWord(val greek: String, val pronunciation: TheokyklosText, val meaning: TheokyklosText)
data class TheokyklosSector(
    val id: String,
    val group: String,
    val angle: Int?,
    val symbol: String,
    val short: TheokyklosText,
    val title: TheokyklosText,
    val patrons: TheokyklosText,
    val essence: TheokyklosText,
    val description: TheokyklosText,
    val words: List<TheokyklosWord>,
    val art: String,
    val symbolArt: String,
    val color: String,
)
data class TheokyklosPractice(
    val id: String,
    val sectorId: String,
    val emoji: String,
    val title: TheokyklosText,
    val description: TheokyklosText,
    val myth: TheokyklosText,
    val suggestedTime: String,
    val priority: Int,
    val color: String,
    val previousTitles: List<String> = emptyList(),
) {
    fun displayTitle(saved: String, english: Boolean): String =
        if (saved in previousTitles) (if (english) title.en else title.ru) else saved
}
data class StoicheionSectorGuidance(val sectorId: String, val upright: TheokyklosText,
    val reversed: TheokyklosText)
data class TheokyklosCatalog(val sectors: List<TheokyklosSector>, val practices: List<TheokyklosPractice>,
    val stoicheionGuidance: List<StoicheionSectorGuidance>) {
    val byId: Map<String, TheokyklosSector> = sectors.associateBy { it.id }
    val guidanceById: Map<String, StoicheionSectorGuidance> = stoicheionGuidance.associateBy { it.sectorId }
    fun practicesFor(sectorId: String) = practices.filter { it.sectorId == sectorId }
}

/** Exported from the website's theokyklos-data.ts, assets.ts and sacred-practices.ts. */
object TheokyklosCatalogSource {
    val ids = listOf("north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest",
        "zenith", "nadir", "hearth", "center", "entrance", "exit")

    fun load(context: Context): TheokyklosCatalog = load(context, "ru")

    fun load(context: Context, language: String): TheokyklosCatalog {
        val locale = if (language == "ru") null else
            JSONObject(context.assets.open("originals/i18n/catalog-translations/$language.json")
                .bufferedReader(Charsets.UTF_8).use { it.readText() })
        val translated = if (language == "en") null else locale?.getJSONObject("theokyklos")
        val words = locale?.getJSONObject("theokyklosWords")
        return context.assets.open("catalogs/theokyklos.json")
            .bufferedReader(Charsets.UTF_8).use { parse(it.readText(), translated, words) }
    }

    fun parse(raw: String): TheokyklosCatalog = parse(raw, null, null)

    fun parse(raw: String, translated: JSONObject?, localizedWords: JSONObject?): TheokyklosCatalog {
        val document = JSONObject(raw)
        require(document.getInt("schemaVersion") == 1) { "Unsupported Theokyklos catalog" }
        fun text(value: JSONObject): TheokyklosText {
            val russian = value.getString("ru")
            val english = value.getString("en")
            return TheokyklosText(if (translated == null) formatGreekTerms(russian, "ru") else translated.getString(russian), formatGreekTerms(english, "en"))
        }
        val segments = document.getJSONArray("segments")
        val sectors = (0 until segments.length()).map { index ->
            val value = segments.getJSONObject(index)
            val words = value.getJSONArray("words")
            TheokyklosSector(
                id = value.getString("id"), group = value.getString("group"),
                angle = if(value.has("angle")) value.getInt("angle") else null,
                symbol = value.getString("symbol"), short = text(value.getJSONObject("short")),
                title = text(value.getJSONObject("title")), patrons = text(value.getJSONObject("patrons")),
                essence = text(value.getJSONObject("essence")), description = text(value.getJSONObject("description")),
                words = (0 until words.length()).map { wordIndex ->
                    val word = words.getJSONObject(wordIndex)
                    val greek = word.getString("greek")
                    TheokyklosWord(localizedWords?.getString(greek) ?: word.getJSONObject("pronunciation").getString("ru"), text(word.getJSONObject("pronunciation")),
                        text(word.getJSONObject("meaning")))
                },
                art = value.getString("art"), symbolArt = value.getString("symbolArt"),
                color = value.getString("color"),
            )
        }
        require(sectors.map { it.id } == ids && sectors.all { it.words.size == 4 }) {
            "Theokyklos must include all 14 sectors and their sacred words"
        }
        val practicesArray = document.getJSONArray("practices")
        val practices = (0 until practicesArray.length()).map { index ->
            val value = practicesArray.getJSONObject(index)
            TheokyklosPractice(
                id = value.getString("id"), sectorId = value.getString("sectorId"),
                emoji = value.getString("emoji"), title = text(value.getJSONObject("title")),
                description = text(value.getJSONObject("description")), myth = text(value.getJSONObject("myth")),
                suggestedTime = value.getString("suggestedTime"), priority = value.getInt("priority"),
                color = value.getString("color"),
                previousTitles = value.optJSONArray("previousTitles")?.let { titles ->
                    (0 until titles.length()).map { titles.getString(it) }
                }.orEmpty(),
            )
        }
        require(practices.map { it.id }.toSet().size == practices.size &&
            practices.all { it.sectorId in ids }) { "Invalid Theokyklos practices" }
        val guidanceArray = document.getJSONArray("stoicheionGuidance")
        val guidance = (0 until guidanceArray.length()).map { index ->
            val value = guidanceArray.getJSONObject(index)
            StoicheionSectorGuidance(value.getString("sectorId"), text(value.getJSONObject("upright")),
                text(value.getJSONObject("reversed")))
        }
        require(guidance.map { it.sectorId }.toSet() == (ids.take(8) + "center").toSet() &&
            guidance.size == 9) { "Stoicheion guidance must cover nine sectors" }
        return TheokyklosCatalog(sectors, practices, guidance)
    }
}
