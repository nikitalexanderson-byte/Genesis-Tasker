package ru.genesis.calendar.domain.habits

import java.time.LocalDate
import org.json.JSONArray
import org.json.JSONObject

object HabitHistoryCodec {
    private fun whole(value: JSONObject, key: String) = value.getInt(key).also { require(value.get(key) is Number && value.getDouble(key) == it.toDouble()) }
    private fun strings(value: JSONArray) = (0 until value.length()).map { value.getString(it) }
    private fun entity(value: TrackerEntity) = JSONObject().put("id", value.id).put("createdAt", value.createdAt)
        .put("updatedAt", value.updatedAt).put("version", value.version).put("syncState", value.syncState)
    private fun entity(value: JSONObject) = TrackerEntity(value.getString("id"), value.getString("createdAt"),
        value.getString("updatedAt"), whole(value, "version"), value.getString("syncState"))
    private fun nullable(value: JSONObject, key: String) = if (value.isNull(key)) null else value.getString(key)
    private fun value(value: HabitHistoryValue) = JSONObject().put("completed", value.completed)
        .put("completedTimes", JSONArray(value.completedTimes)).put("qualityValue", value.qualityValue ?: JSONObject.NULL)
        .put("qualityConfirmedAt", value.qualityConfirmedAt ?: JSONObject.NULL).put("note", value.note)
        .apply { value.skippedAt?.let { put("skippedAt",it) } }
    private fun value(value: JSONObject) = HabitHistoryValue(value.getBoolean("completed").also { require(value.get("completed") is Boolean) }, strings(value.optJSONArray("completedTimes") ?: JSONArray()),
        if (value.isNull("qualityValue")) null else value.getDouble("qualityValue"), nullable(value, "qualityConfirmedAt"), value.getString("note"),nullable(value,"skippedAt"))
    private fun completion(value: HabitCompletion) = entity(value.entity).put("habitId", value.habitId).put("date", value.date.toString())
        .put("completed", value.completed).put("completedTimes", JSONArray(value.completedTimes))
        .put("qualityValue", value.qualityValue ?: JSONObject.NULL).put("qualityConfirmedAt", value.qualityConfirmedAt ?: JSONObject.NULL)
        .put("score", value.score).put("xpAwarded", value.xpAwarded).put("note", value.note).apply { value.skippedAt?.let { put("skippedAt",it) } }
    private fun completion(json: JSONObject): HabitCompletion {
        val value = value(json)
        return HabitCompletion(entity(json), json.getString("habitId"), LocalDate.parse(json.getString("date")), value.completed,
            value.qualityValue, whole(json, "score"), whole(json, "xpAwarded"), value.note, value.qualityConfirmedAt, value.completedTimes,value.skippedAt)
    }
    fun encode(rows: List<HabitHistoryEdit>) = JSONArray(rows.map { row -> entity(row.entity).put("habitId", row.habitId)
        .put("date", row.date.toString()).put("ruleId", row.ruleId).put("epoch", row.epoch).put("replaces", JSONArray(row.replaces))
        .put("value", value(row.value)).put("baseline", row.baseline?.let(::completion) ?: JSONObject.NULL).put("source", row.source) })
    fun decode(array: JSONArray, epoch: String): List<HabitHistoryEdit> = HabitHistory.merge((0 until array.length()).map { index ->
        val row = array.getJSONObject(index)
        HabitHistoryEdit(entity(row), row.getString("habitId"), LocalDate.parse(row.getString("date")), row.getString("ruleId"),
            row.getString("epoch"), strings(row.getJSONArray("replaces")), value(row.getJSONObject("value")),
            if (row.isNull("baseline")) null else completion(row.getJSONObject("baseline")), row.getString("source"))
    }).filter { it.epoch == epoch }
    fun command(row: JSONObject): HabitHistoryCommand {
        val input = row.optJSONObject("measurement")?.let { item ->
            val amount = if(item.isNull("value")) null else item.getLong("value").also {
                require(item.get("value") is Number && item.getDouble("value") == it.toDouble()) { "INVALID_HABIT_HISTORY" }
            }
            HabitHistoryMeasurement(amount,nullable(item,"entryId"),strings(item.optJSONArray("replaces") ?: JSONArray()),item.getString("note"))
        }
        return HabitHistoryCommand(row.getString("id"),row.getString("at"),row.getString("habitId"),LocalDate.parse(row.getString("date")),
            row.getString("ruleId"),strings(row.getJSONArray("heads")),value(row.getJSONObject("value")),input)
    }
}
