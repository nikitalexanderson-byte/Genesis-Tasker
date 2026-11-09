package ru.genesis.calendar.data

import java.time.Instant
import java.time.LocalDate
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.domain.RestorationDrawCard
import ru.genesis.calendar.domain.StoicheionRestoration
import ru.genesis.calendar.domain.StoicheionRestorationSnapshot

/** Malformed optional metadata is ignored without making the containing habit unreadable. */
internal object StoicheionRestorationCodec {
    private fun JSONObject.text(key: String) = get(key) as? String ?: error("Invalid text")
    private fun JSONObject.integer(key: String): Long {
        val value = get(key) as? Number ?: error("Invalid number")
        return value.toLong().also { require(value.toDouble() == it.toDouble()) }
    }
    private fun date(value: String): String {
        require(Regex("\\d{4}-\\d{2}-\\d{2}").matches(value) && LocalDate.parse(value).toString() == value)
        return value
    }
    fun decode(input: JSONObject?): StoicheionRestorationSnapshot? = runCatching {
        val value = requireNotNull(input)
        require(value.integer("version") == 1L)
        val sourceDate = date(value.text("sourceDate"))
        val startedDate = date(value.text("startedDate"))
        val startedAt = value.text("startedAt").also { Instant.parse(it) }
        val excludeStartDate = value.opt("excludeStartDate") == true
        val seed = value.integer("sourceSeed").also { require(it in 0..0xffff_ffffL) }
        val sectorId = value.text("sectorId").also { require(it in StoicheionRestoration.positions) }
        val letterId = value.text("letterId")
        val need = value.text("need").also { require(it in StoicheionRestoration.needs) }
        val cardsArray = value.getJSONArray("cards").also { require(it.length() == 9) }
        val cards = (0 until cardsArray.length()).map { index ->
            val card = cardsArray.getJSONObject(index)
            RestorationDrawCard(card.text("letterId").also { require(it in StoicheionRestoration.lettersById) },
                card.get("reversed") as? Boolean ?: error("Invalid orientation"))
        }
        require(cards.map { it.letterId }.distinct().size == 9)
        val selected = cards[StoicheionRestoration.positions.indexOf(sectorId)]
        require(selected.reversed && selected.letterId == letterId)
        val total = cards.sumOf { StoicheionRestoration.lettersById.getValue(it.letterId).value }
        val supportsArray = value.getJSONArray("supportIds").also { require(it.length() <= 5) }
        val supportIds = (0 until supportsArray.length()).map { supportsArray.get(it) as? String ?: error("Invalid support") }
        val equation = StoicheionRestoration.equation(StoicheionRestoration.lettersById.getValue(letterId).value, total, supportIds)
        require(value.integer("spreadTotal") == total.toLong() && value.integer("pythmen") == equation.target.toLong())
        val resourceId = value.text("resourceLetterId").also { id -> require(equation.candidates.any { it.id == id }) }
        val practiceId = value.text("practiceId").also { require(it in StoicheionRestoration.practiceIds) }
        val cycleId = value.text("cycleId").also { require(it == StoicheionRestoration.cycleId(sourceDate, seed, sectorId, letterId)) }
        fun bounded(key: String, max: Int) = (value.opt(key) as? String).orEmpty().trim().take(max)
        val intention = bounded("intention", 500).also { require(it.isNotBlank()) }
        val action = bounded("action", 1600).also { require(it.isNotBlank()) }
        val practiceText = bounded("practiceText", 1600).also { require(it.isNotBlank()) }
        StoicheionRestorationSnapshot(cycleId = cycleId, startedAt = startedAt, startedDate = startedDate,
            sourceDate = sourceDate, sourceSeed = seed, cards = cards, sectorId = sectorId, letterId = letterId,
            need = need, supportIds = equation.supports.map { it.id }, resourceLetterId = resourceId,
            practiceId = practiceId, spreadTotal = total, pythmen = equation.target, intention = intention,
            action = action, practiceText = practiceText, reflection = bounded("reflection", 2000), excludeStartDate = excludeStartDate)
    }.getOrNull()

    fun encode(value: StoicheionRestorationSnapshot): JSONObject = JSONObject().put("version", value.version)
        .put("cycleId", value.cycleId).put("startedAt", value.startedAt).put("startedDate", value.startedDate)
        .put("sourceDate", value.sourceDate).put("sourceSeed", value.sourceSeed)
        .put("cards", JSONArray(value.cards.map { JSONObject().put("letterId", it.letterId).put("reversed", it.reversed) }))
        .put("sectorId", value.sectorId).put("letterId", value.letterId).put("need", value.need)
        .put("supportIds", JSONArray(value.supportIds)).put("resourceLetterId", value.resourceLetterId)
        .put("practiceId", value.practiceId).put("spreadTotal", value.spreadTotal).put("pythmen", value.pythmen)
        .put("intention", value.intention).put("action", value.action).put("practiceText", value.practiceText)
        .put("reflection", value.reflection).apply { if (value.excludeStartDate) put("excludeStartDate", true) }
}
