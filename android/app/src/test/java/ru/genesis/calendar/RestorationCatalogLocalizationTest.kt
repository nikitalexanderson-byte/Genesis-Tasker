package ru.genesis.calendar

import java.io.File
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.domain.StoicheionRestorationCatalogSource

class RestorationCatalogLocalizationTest {
    @Test fun longBilingualParagraphsDoNotExhaustTheParserStack() {
        val russian = "Длинный текст с кавычками \"и переносом\"\n".repeat(2_000)
        val english = "Long text with quotes \"and a newline\"\n".repeat(2_000)
        // Preserve the authored ru/en field order independently of JSONObject's key iterator.
        val pair = "{\"ru\":" + JSONObject.quote(russian) + ",\"en\":" + JSONObject.quote(english) + "}"
        val ordered = "{\"text\":$pair,\"auxiliaries\":[]}"
        val map = StoicheionRestorationCatalogSource.translationMap(ordered,
            "{\"ru\":{},\"en\":{}}", "{\"practices\":[]}", "en", null)
        assertEquals(english, map[russian])
    }

    @Test fun everyAuthoredLocaleUsesTheSameSourceIndexAndLocalizesPracticeContent() {
        val raw = File("../../app/stoicheion-restoration-content.json").readText()
        val ui = File("../../app/stoicheion-restoration-ui.json").readText()
        val practices = File("src/main/assets/catalogs/theokyklos.json").readText()
        val russian = StoicheionRestorationCatalogSource.parse(raw, ui, "ru")
        for (language in listOf("ru", "en", "de", "el", "es", "fr", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja")) {
            val values = if (language in listOf("ru", "en")) null else JSONObject(
                File("../../app/stoicheion-restoration-locales/$language.json").readText()).getJSONArray("values")
            val map = StoicheionRestorationCatalogSource.translationMap(raw, ui, practices, language, values)
            val catalog = StoicheionRestorationCatalogSource.parse(raw, ui, language, map)
            for ((id, sector) in russian.sectors) for ((need, content) in sector.needs) {
                val translated = catalog.sectors.getValue(id).needs.getValue(need)
                assertEquals("$language/$id/$need", map.getValue(content.practice), translated.practice)
                assertEquals(map.getValue(content.action), translated.action)
                assertEquals(map.getValue(content.intention), translated.intention)
            }
            assertEquals(russian.letterFoci.size, catalog.letterFoci.size)
            assertEquals(russian.auxiliaries.map { it.practiceId }, catalog.auxiliaries.map { it.practiceId })
        }
    }
}
