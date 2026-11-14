package ru.genesis.calendar.data

import java.time.Instant
import java.time.LocalDate
import org.json.JSONObject

data class StoicheionTimelineWindow(val position: Int, val firstAt: Long, val deadline: Long, val rerolled: Boolean,
    val canReroll: Boolean) {
    fun remainingSeconds(now: Long): Int = if (rerolled || !canReroll) 0 else ((deadline - now + 999L) / 1000L).coerceIn(0L, 180L).toInt()
}

data class StoicheionTimelineState(val dayKey: String, val periodKey: String, val seed: Long,
    val revision: Long, val firstAt: Long, val cards: List<StoicheionTimelineWindow>, val clockOffset: Long) {
    fun asDraw() = StoicheionDraw("timeline", dayKey, seed, 2, firstAt, firstAt)
    fun remainingSeconds(position: Int, deviceNow: Long): Int = cards.getOrNull(position)?.remainingSeconds(deviceNow + clockOffset) ?: 0
}

internal object StoicheionTimelineWire {
    fun parse(payload: JSONObject, receivedAt: Long = System.currentTimeMillis()): StoicheionTimelineState? {
        val serverNow = Instant.parse(payload.getString("serverNow")).toEpochMilli()
        require(payload.has("timeline"))
        if (payload.isNull("timeline")) return null
        val value = payload.getJSONObject("timeline")
        val day = LocalDate.parse(value.getString("dayKey"))
        val period = LocalDate.parse(value.getString("periodKey"))
        require(period.dayOfWeek.value == 1 && !day.isBefore(period) && day.isBefore(period.plusDays(7)))
        val seed = value.getLong("seed"); val revision = value.getLong("revision")
        require(seed in 0..0xffff_ffffL && revision >= 1)
        val list = value.getJSONArray("cards")
        require(list.length() in 1..3)
        val cards = (0 until list.length()).map { index ->
            val card = list.getJSONObject(index)
            require(card.getInt("position") == index)
            val first = Instant.parse(card.getString("firstRevealedAt")).toEpochMilli()
            val deadline = Instant.parse(card.getString("rerollDeadline")).toEpochMilli()
            require(deadline <= first + 180_000L)
            StoicheionTimelineWindow(index, first, deadline, card.getBoolean("rerolled"), card.getBoolean("canReroll"))
        }
        return StoicheionTimelineState(day.toString(), period.toString(), seed, revision,
            Instant.parse(value.getString("firstDrawAt")).toEpochMilli(), cards, serverNow - receivedAt)
    }
}
