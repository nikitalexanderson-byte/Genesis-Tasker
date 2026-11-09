package ru.genesis.calendar.data

import java.time.LocalDate
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.domain.habits.HabitLifecycle
import ru.genesis.calendar.domain.habits.HabitLifecycleEvent

/** Strict shared wire format. Unknown or damaged journals cannot become an empty history. */
internal object HabitLifecycleCodec {
    fun encode(events: List<HabitLifecycleEvent>): JSONArray = JSONArray(HabitLifecycle.merge(events).map { row ->
        JSONObject().put("id",row.id).put("habitId",row.habitId).put("at",row.at).put("date",row.date.toString())
            .put("action",row.action).put("status",row.status).put("replaces",JSONArray(row.replaces))
            .put("baselineActive",row.baselineActive).apply { row.selectedId?.let { put("selectedId",it) } }
            .apply { row.automaticPoints?.let { put("automaticPoints",it) } }
    })
    fun decode(rows: JSONArray): List<HabitLifecycleEvent> = HabitLifecycle.merge((0 until rows.length()).map { index ->
        val row=rows.getJSONObject(index)
        require(row.get("baselineActive") is Boolean) { "INVALID_HABIT_LIFECYCLE" }
        HabitLifecycleEvent(row.getString("id"),row.getString("habitId"),row.getString("at"),LocalDate.parse(row.getString("date")),
            row.getString("action"),row.getString("status"),row.getJSONArray("replaces").let { ids ->
                (0 until ids.length()).map { (ids.get(it) as? String) ?: error("INVALID_HABIT_LIFECYCLE") }
            },row.getBoolean("baselineActive"),if(row.has("selectedId")) row.getString("selectedId") else null,
            if(row.has("automaticPoints")) row.getString("automaticPoints") else null)
    })
}
