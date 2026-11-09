package ru.genesis.calendar.data

import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.domain.habits.*

internal object HabitTimerCodec {
    /** Android optString turns JSON null into the literal "null"; the web protocol treats it as no epoch. */
    fun epoch(document: JSONObject, field: String): String {
        if (document.isNull(field)) return ""
        val value = document.get(field)
        require(value is String) { "INVALID_HABIT_TIMER" }
        return HabitTimers.epoch(value)
    }
    private fun JSONArray.rows() = (0 until length()).map { getJSONObject(it) }
    private fun strings(rows: JSONArray) = (0 until rows.length()).map { rows.getString(it) }
    private fun whole(row: JSONObject, name: String): Long = row.getLong(name).also {
        require(it in -9_007_199_254_740_991L..9_007_199_254_740_991L && it.toDouble() == row.getDouble(name)) { "INVALID_HABIT_TIMER" }
    }
    private fun minutes(row: JSONObject, name: String): Int = whole(row, name).also {
        require(it in 0..180) { "INVALID_HABIT_TIMER" }
    }.toInt()
    fun decode(rows: JSONArray, epoch: String? = null): List<HabitTimerOperation> = HabitTimers.merge(rows.rows().map { row ->
        val plan = if (row.getString("action") == "start") row.getJSONObject("plan").let { value ->
            val zone=value.getString("timeZone")
            val context=requireNotNull(calendarContextFromJson(value.getJSONObject("context"))).let { context ->
                // Calendar wire contexts canonicalize fixed UTC aliases. Preserve the timer's original plan identity.
                if (context.timeZone!=zone && ZoneId.of(context.timeZone).normalized()==ZoneOffset.UTC && ZoneId.of(zone).normalized()==ZoneOffset.UTC)
                    context.copy(timeZone=zone) else context
            }
            HabitTimerPlan(value.getString("mode"), minutes(value, "workMinutes"), minutes(value, "breakMinutes"),
                zone, value.getString("calendarMode"), context,
                value.getString("habitTitle"), value.getString("ruleId"))
        } else null
        val allocations = if (row.getString("action") == "finish") row.getJSONArray("allocations").rows().map {
            val date = it.getString("date").also { date -> require(Regex("\\d{4}-\\d{2}-\\d{2}").matches(date)) }
            HabitTimerAllocation(LocalDate.parse(date), whole(it, "workMs"), whole(it, "value"),
                it.getString("ruleId"), it.getString("reason"))
        } else null
        HabitTimerOperation(row.getString("id"), row.getString("sessionId"), row.getString("habitId"), row.getString("owner"),
            row.getString("action"), strings(row.getJSONArray("parents")), row.getString("at"), plan, allocations,
            if (row.has("branchId")) row.getString("branchId") else null,
            if (row.has("timeOnly")) row.get("timeOnly").let { require(it is Boolean); it } else null,
            HabitTimers.epoch(if(row.isNull("epoch")) "" else row.getString("epoch")))
    }).filter { epoch == null || it.epoch == epoch }.also { HabitTimers.sessions(it) }

    fun encode(operations: List<HabitTimerOperation>): JSONArray = JSONArray(HabitTimers.merge(operations).map { op ->
        JSONObject().put("epoch", op.epoch).put("id", op.id).put("sessionId", op.sessionId).put("habitId", op.habitId).put("owner", op.owner)
            .put("action", op.action).put("parents", JSONArray(op.parents)).put("at", op.at).apply {
                op.plan?.let { plan -> put("plan", JSONObject().put("mode", plan.mode).put("workMinutes", plan.workMinutes)
                    .put("breakMinutes", plan.breakMinutes).put("timeZone", plan.timeZone).put("calendarMode", plan.calendarMode)
                    .put("context", calendarContextJson(plan.context)).put("habitTitle", plan.habitTitle).put("ruleId", plan.ruleId)) }
                op.allocations?.let { allocations -> put("allocations", JSONArray(allocations.map { value ->
                    JSONObject().put("date", value.date.toString()).put("workMs", value.workMs).put("value", value.value)
                        .put("ruleId", value.ruleId).put("reason", value.reason) })) }
                op.branchId?.let { put("branchId", it) }; op.timeOnly?.let { put("timeOnly", it) }
            }
    })
}
