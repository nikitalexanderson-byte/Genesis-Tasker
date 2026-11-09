package ru.genesis.calendar.auth

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlin.math.roundToInt
import org.json.JSONArray
import org.json.JSONObject

/**
 * Upgrades encrypted workspace documents produced by older web clients before the
 * native codecs inspect them. The original encrypted blob remains untouched; a
 * migrated document is stored only in the account cache and is uploaded later by
 * the normal conflict-aware sync path after an explicit local change.
 */
internal object CloudWorkspaceMigration {
    const val CURRENT_SCHEMA = 16
    private val datePattern = Regex("\\d{4}-\\d{2}-\\d{2}")
    private val timePattern = Regex("(?:[01]\\d|2[0-3]):[0-5]\\d")
    private val colorPattern = Regex("#[0-9a-fA-F]{6}")
    private val modes = setOf("easy", "rhythm", "perfect")
    private val goalStatuses = setOf("open", "qualified", "perfect", "missed", "protected", "neutral", "rest", "timezone-shift")
    private val now: String get() = Instant.now().toString()
    private val today: String get() = LocalDate.now().toString()

    fun normalize(source: JSONObject): JSONObject {
        val schema = source.optInt("trackerSchemaVersion", 0)
        if (source.has("trackerSchemaVersion") && !source.isNull("trackerSchemaVersion")) {
            val declared = source.get("trackerSchemaVersion")
            require(declared is Number && declared.toDouble() == schema.toDouble()) { "Invalid cloud workspace schema" }
        }
        require(schema in 0..CURRENT_SCHEMA) { "Unsupported cloud workspace schema" }
        if (schema == 0) {
            // Before the tracker existed, the website saved projects/categories without a tracker schema.
            // Recognize that document shape explicitly; never reinterpret an unknown object as empty data.
            require(source.optJSONArray("projects") != null && source.optJSONArray("categories") != null) {
                "Unrecognized pre-tracker workspace"
            }
        }
        val document = JSONObject(source.toString())
        if (schema == CURRENT_SCHEMA) return document

        val categories = normalizeCategories(document.optJSONArray("categories"))
        val categoryIds = ids(categories)
        val projects = normalizeProjects(document.optJSONArray("projects"), categoryIds)
        val projectIds = ids(projects)
        val habits = normalizeHabits(document.optJSONArray("habits"))
        val habitIds = ids(habits)
        val sleepPlans = normalizeSleepPlans(document.optJSONArray("sleepPlans"))
        val sleepPlanIds = ids(sleepPlans)
        val completions = normalizeCompletions(
            document.optJSONArray("habitCompletions") ?: document.optJSONArray("habitEntries"), habits,
        )

        document.put("trackerSchemaVersion", CURRENT_SCHEMA)
            .put("projects", projects)
            .put("categories", categories)
            .put("taskListLinks", normalizeTaskListLinks(document.optJSONArray("taskListLinks"), projectIds))
            .put("habits", habits)
            .put("habitCompletions", completions)
            .put("sleepPlans", sleepPlans)
            .put("sleepEntries", normalizeSleepEntries(document.optJSONArray("sleepEntries"), sleepPlanIds))
            .put("moodEntries", normalizeMoodEntries(document.optJSONArray("moodEntries")))
            .put("dailyGoalRecords", normalizeDailyGoals(document.optJSONArray("dailyGoalRecords")))
            .put("rewardTransactions", normalizeRewards(document.optJSONArray("rewardTransactions")))
            .put("quests", normalizeQuests(document.optJSONArray("quests"), habitIds))
            .put("achievementUnlocks", arrayOrEmpty(document, "achievementUnlocks"))
            .put("streakFreezeTransactions", arrayOrEmpty(document, "streakFreezeTransactions"))
            .put("userProgress", normalizeProgress(document.optJSONObject("userProgress"), completions))

        listOf("habitMeasurements", "habitTimers", "addictionTrackers", "addictionEntries", "analyticsSnapshots", "hiddenDefaultTemplates").forEach {
            if (document.optJSONArray(it) == null) document.put(it, JSONArray())
        }
        if (document.optJSONObject("habitSettings") == null) document.put("habitSettings", JSONObject())
        return document
    }

    private fun arrayOrEmpty(root: JSONObject, name: String) = root.optJSONArray(name) ?: JSONArray()
    private fun ids(rows: JSONArray): Set<String> = (0 until rows.length()).mapNotNull {
        rows.optJSONObject(it)?.optString("id")?.takeIf(String::isNotBlank)
    }.toSet()
    private fun JSONArray.objects() = (0 until length()).mapNotNull(::optJSONObject)
    private fun jsonArray(values: Iterable<JSONObject>) = JSONArray().apply { values.forEach(::put) }
    private fun validDate(value: String?) = value?.takeIf { datePattern.matches(it) }
    private fun validTime(value: String?, fallback: String) = value?.takeIf { timePattern.matches(it) } ?: fallback
    private fun JSONObject.nonBlank(name: String, fallback: String) = optString(name).takeIf { it.isNotBlank() && it != "null" } ?: fallback
    private fun JSONObject.nullable(name: String): String? = if (!has(name) || isNull(name)) null else optString(name).takeIf { it.isNotBlank() && it != "null" }
    private fun safeCount(value: Any?) = when (value) {
        is Number -> value.toDouble().takeIf(Double::isFinite)?.roundToInt() ?: 0
        else -> value?.toString()?.toDoubleOrNull()?.takeIf(Double::isFinite)?.roundToInt() ?: 0
    }.coerceAtLeast(0)

    private fun entity(source: JSONObject, prefix: String): JSONObject {
        val timestamp = source.nonBlank("updatedAt", source.nonBlank("createdAt", now))
        val id = source.nonBlank("id", "$prefix-${timestamp.hashCode().toUInt()}")
        return JSONObject(source.toString()).put("id", id)
            .put("createdAt", source.nonBlank("createdAt", timestamp))
            .put("updatedAt", timestamp)
            .put("version", source.optInt("version", 1).coerceAtLeast(1))
            .put("syncState", source.optString("syncState").takeIf { it in setOf("local", "pending", "synced") } ?: "local")
    }

    private fun normalizeCategories(rows: JSONArray?) = jsonArray(rows?.objects().orEmpty().mapNotNull { source ->
        val id = source.optString("id").trim().takeIf(String::isNotBlank) ?: return@mapNotNull null
        JSONObject(source.toString()).put("id", id).put("name", source.nonBlank("name", id))
            .put("color", source.optString("color").takeIf(colorPattern::matches) ?: "#bb8f4a")
            .put("position", source.optInt("position", 0).coerceAtLeast(0))
    }.distinctBy { it.getString("id") })

    private fun normalizeProjects(rows: JSONArray?, categoryIds: Set<String>): JSONArray {
        val sources = rows?.objects().orEmpty().mapNotNull { source ->
            val id = source.optString("id").trim().takeIf(String::isNotBlank) ?: return@mapNotNull null
            JSONObject(source.toString()).put("id", id)
        }.distinctBy { it.getString("id") }
        val projectIds = sources.map { it.getString("id") }.toSet()
        return jsonArray(sources.map { source ->
            val parent = source.nullable("parentId")?.takeIf { it in projectIds && it != source.getString("id") }
            val category = source.nullable("categoryId")?.takeIf(categoryIds::contains)
            source.put("parentId", parent ?: JSONObject.NULL).put("categoryId", category ?: JSONObject.NULL)
                .put("title", source.nonBlank("title", "Проект"))
                .put("description", source.optString("description").takeUnless { it == "null" } ?: "")
                .put("tags", source.optJSONArray("tags") ?: JSONArray())
                .put("status", source.optString("status").takeIf { it in setOf("active", "completed", "archived") } ?: "active")
                .put("position", source.optInt("position", 0).coerceAtLeast(0))
        })
    }

    private fun normalizeTaskListLinks(rows: JSONArray?, projectIds: Set<String>) = jsonArray(
        rows?.objects().orEmpty().mapNotNull { source ->
            val id = source.optString("taskListId").trim().takeIf(String::isNotBlank) ?: return@mapNotNull null
            JSONObject(source.toString()).put("taskListId", id).put(
                "projectId", source.nullable("projectId")?.takeIf(projectIds::contains) ?: JSONObject.NULL,
            )
        }.distinctBy { it.getString("taskListId") },
    )

    private fun normalizeSchedule(source: JSONObject?, fallbackDate: String): JSONObject {
        val schedule = source ?: JSONObject()
        val start = validDate(schedule.optString("startDate")) ?: fallbackDate
        val end = validDate(schedule.optString("endDate"))?.takeIf { it >= start }
        val legacyCalendar = schedule.optString("calendarMode")
        val fallbackMode = when (legacyCalendar) { "profane" -> "classic"; "lunar" -> "lunar"; else -> "genesis" }
        val recurrence = schedule.optJSONObject("recurrence") ?: JSONObject()
        val mode = recurrence.optString("mode").takeIf { it in setOf("classic", "genesis", "lunar") } ?: fallbackMode
        val cadence = schedule.optString("cadence", "daily")
        val pattern = recurrence.optString("pattern").takeIf(String::isNotBlank) ?: when (mode) {
            "classic" -> if (cadence == "weekly") "weekdays" else cadence
            "lunar" -> "lunar-days"
            else -> if (cadence == "monthly") "month-days" else "pyata-days"
        }
        val timezone = schedule.optString("timezone").takeIf { runCatching { ZoneId.of(it) }.isSuccess } ?: ZoneId.systemDefault().id
        val days = recurrence.optJSONArray("days") ?: schedule.optJSONArray("days") ?: JSONArray().put(1)
        return JSONObject(schedule.toString()).put("startDate", start).put("endDate", end ?: JSONObject.NULL)
            .put("timezone", timezone).put("recurrence", JSONObject(recurrence.toString())
                .put("enabled", if (recurrence.has("enabled")) recurrence.optBoolean("enabled") else true)
                .put("mode", mode).put("pattern", pattern).put("days", days)
                .put("interval", recurrence.optInt("interval", schedule.optInt("interval", 1)).coerceAtLeast(1))
                .put("rangeStart", start).put("rangeEnd", end ?: "")
                .put("months", recurrence.optJSONArray("months") ?: JSONArray())
                .put("pyatas", recurrence.optJSONArray("pyatas") ?: JSONArray()))
    }

    private fun normalizeHabits(rows: JSONArray?): JSONArray = jsonArray(rows?.objects().orEmpty().mapNotNull { source ->
        val id = source.optString("id").trim().takeIf(String::isNotBlank) ?: return@mapNotNull null
        val title = source.optString("title").trim().takeIf(String::isNotBlank) ?: return@mapNotNull null
        if (source.optString("kind") in setOf("negative", "sleep", "wake")) return@mapNotNull null
        val fallback = validDate(source.optString("createdDate"))
            ?: validDate(source.optJSONObject("schedule")?.optString("startDate")) ?: today
        val scoring = source.optString("scoringMode").takeIf { it in setOf("none", "binary", "quality-ten", "quality-bipolar") }
            ?: when { source.optBoolean("scoringEnabled", true).not() || source.optString("kind") == "monitor" -> "none"
                source.optString("qualityScale") == "ten" -> "quality-ten"
                source.optString("qualityScale") == "bipolar" -> "quality-bipolar"
                else -> "binary" }
        val reminder = source.optJSONObject("reminder") ?: JSONObject()
        entity(source, "habit").put("id", id).put("title", title).put("createdDate", fallback)
            .put("schedule", normalizeSchedule(source.optJSONObject("schedule"), fallback))
            .put("description", source.optString("description").takeUnless { it == "null" } ?: "")
            .put("emoji", source.nonBlank("emoji", "✨")).put("priority", source.optInt("priority", 5).coerceIn(1, 10))
            .put("isKeyHabit", source.optBoolean("isKeyHabit"))
            .put("ritualId", source.optString("ritualId").takeIf { it in setOf("morning", "day", "evening") } ?: "none")
            .put("ritualName", source.optString("ritualName").takeUnless { it == "null" } ?: "")
            .put("color", source.optString("color").takeIf(colorPattern::matches) ?: "#bb8f4a")
            .put("active", if (source.has("active")) source.optBoolean("active") else true)
            .put("sourceTemplateId", source.nullable("sourceTemplateId") ?: JSONObject.NULL)
            .put("sacredPracticeId", source.nullable("sacredPracticeId") ?: JSONObject.NULL)
            .put("sacredSectorId", source.nullable("sacredSectorId") ?: JSONObject.NULL)
            .put("preferredTime", source.optString("preferredTime").takeIf(timePattern::matches) ?: "")
            .put("scoringMode", scoring)
            .put("qualityScale", when (scoring) { "quality-ten" -> "ten"; "quality-bipolar" -> "bipolar"; else -> "none" })
            .put("reminder", JSONObject(reminder.toString())
                .put("enabled", reminder.optBoolean("enabled"))
                .put("time", validTime(reminder.optString("time"), "09:00"))
                .put("syncToGoogleTasks", reminder.optBoolean("syncToGoogleTasks") || reminder.optBoolean("syncToGoogle"))
                .put("showInGoogleCalendar", reminder.optBoolean("showInGoogleCalendar"))
                .put("googleTaskId", reminder.nullable("googleTaskId") ?: JSONObject.NULL)
                .put("googleEventId", reminder.nullable("googleEventId") ?: JSONObject.NULL))
    }.distinctBy { it.getString("id") })

    private fun normalizeCompletions(rows: JSONArray?, habits: JSONArray): JSONArray {
        val byId = habits.objects().associateBy { it.getString("id") }
        return jsonArray(rows?.objects().orEmpty().mapNotNull { source ->
        val habitId = source.optString("habitId")
        val habit = byId[habitId] ?: return@mapNotNull null
        val date = validDate(source.optString("date")) ?: return@mapNotNull null
        val completed = source.optBoolean("completed")
        val quality = when { !source.isNull("qualityValue") -> source.optDouble("qualityValue")
            !source.isNull("quality") -> source.optDouble("quality"); else -> Double.NaN }
        val score = if (source.has("score")) safeCount(source.opt("score")) else when {
            !completed || habit.optString("scoringMode") == "none" -> 0
            habit.optString("scoringMode") == "quality-ten" -> (if (quality.isFinite()) quality else 5.0).roundToInt().coerceIn(1, 10)
            habit.optString("scoringMode") == "quality-bipolar" -> (10 + 2 * (if (quality.isFinite()) quality else 0.0).roundToInt().coerceIn(-5, 5)).coerceIn(0, 20)
            else -> 10
        }
        entity(source, "habit-completion").put("habitId", habitId).put("date", date)
            .put("completed", completed)
            .put("qualityConfirmedAt", source.optString("qualityConfirmedAt").takeUnless { it.isBlank() || it == "null" } ?: JSONObject.NULL)
            .put("qualityValue", quality.takeIf(Double::isFinite) ?: JSONObject.NULL)
            .put("score", score).put("xpAwarded", safeCount(source.opt("xpAwarded")).coerceAtLeast(score).coerceAtMost(20))
            .put("note", source.optString("note").takeUnless { it == "null" } ?: "")
        }.distinctBy { "${it.getString("habitId")}:${it.getString("date")}" })
    }

    private fun normalizeProgress(source: JSONObject?, completions: JSONArray): JSONObject {
        val progress = JSONObject(source?.toString() ?: "{}")
        val awarded = completions.objects().sumOf { safeCount(it.opt("xpAwarded")) }
        val lifetime = safeCount(progress.opt("lifetimeXp")).coerceAtLeast(awarded)
        val current = safeCount(progress.opt("currentStreak"))
        return progress.put("lifetimeXp", lifetime).put("laurelsBalance", safeCount(progress.opt("laurelsBalance")))
            .put("currentRankId", progress.nullable("currentRankId") ?: JSONObject.NULL)
            .put("hiddenHeroicPathRevealedAt", progress.nullable("hiddenHeroicPathRevealedAt") ?: JSONObject.NULL)
            .put("currentStreak", current).put("longestStreak", safeCount(progress.opt("longestStreak")).coerceAtLeast(current))
            .put("lastQualifiedDate", validDate(progress.optString("lastQualifiedDate")) ?: JSONObject.NULL)
            .put("streakGoalMode", progress.optString("streakGoalMode").takeIf(modes::contains) ?: "rhythm")
            .put("streakFreezeCount", safeCount(progress.opt("streakFreezeCount")).coerceAtMost(2))
            .put("rhythmScore", safeCount(progress.opt("rhythmScore")).coerceAtMost(100))
            .put("updatedAt", progress.nonBlank("updatedAt", now))
    }

    private fun normalizeDailyGoals(rows: JSONArray?) = jsonArray(rows?.objects().orEmpty().mapNotNull { source ->
        val date = validDate(source.optString("date")) ?: return@mapNotNull null
        val mode = source.optString("mode").takeIf(modes::contains) ?: return@mapNotNull null
        val status = source.optString("status").takeIf(goalStatuses::contains) ?: return@mapNotNull null
        val scheduled = safeCount(source.opt("scheduledCount"))
        JSONObject(source.toString()).put("date", date).put("mode", mode)
            .put("timezone", source.nonBlank("timezone", "UTC"))
            .put("scheduledCount", scheduled).put("completedCount", safeCount(source.opt("completedCount")).coerceAtMost(scheduled))
            .put("targetCount", safeCount(source.opt("targetCount")).coerceAtMost(scheduled))
            .put("status", status).put("updatedAt", source.optString("updatedAt").takeUnless { it == "null" } ?: "")
    }.distinctBy { it.getString("date") })

    private fun normalizeRewards(rows: JSONArray?) = jsonArray(rows?.objects().orEmpty().mapNotNull { source ->
        val key = source.optString("idempotencyKey").trim().takeIf(String::isNotBlank) ?: return@mapNotNull null
        val sourceId = source.optString("sourceId").trim().takeIf(String::isNotBlank) ?: return@mapNotNull null
        JSONObject(source.toString()).put("id", source.nonBlank("id", "reward:$key"))
            .put("amount", source.optInt("amount", 0)).put("reason", source.nonBlank("reason", "daily-goal"))
            .put("sourceId", sourceId).put("idempotencyKey", key).put("createdAt", source.optString("createdAt"))
            .put("userId", "self").put("currency", "laurels")
    }.distinctBy { it.getString("idempotencyKey") })

    private fun normalizeSleepPlans(rows: JSONArray?) = jsonArray(rows?.objects().orEmpty().mapNotNull { source ->
        val id = source.optString("id").trim().takeIf(String::isNotBlank) ?: return@mapNotNull null
        val fallback = validDate(source.optJSONObject("schedule")?.optString("startDate")) ?: today
        entity(source, "sleep-plan").put("id", id).put("title", source.nonBlank("title", "Сон и пробуждение"))
            .put("active", if (source.has("active")) source.optBoolean("active") else true)
            .put("schedule", normalizeSchedule(source.optJSONObject("schedule"), fallback))
            .put("targetBedtime", validTime(source.optString("targetBedtime"), "23:00"))
            .put("targetWakeTime", validTime(source.optString("targetWakeTime"), "07:00"))
            .put("qualityEnabled", if (source.has("qualityEnabled")) source.optBoolean("qualityEnabled") else true)
            .put("scoringEnabled", source.optBoolean("scoringEnabled"))
            .put("reminderEnabled", source.optBoolean("reminderEnabled",false))
            .put("reminderMinutesBefore", source.optInt("reminderMinutesBefore",15).coerceIn(0,180))
            .put("rules", jsonArray(source.optJSONArray("rules")?.objects().orEmpty().mapNotNull { rule ->
                val ruleId = rule.optString("id").takeIf(String::isNotBlank) ?: return@mapNotNull null
                JSONObject(rule.toString()).put("id", ruleId)
                    .put("field", rule.optString("field").takeIf { it in setOf("bedtime", "wake") } ?: "bedtime")
                    .put("operator", rule.optString("operator").takeIf { it in setOf("on-or-before", "after") } ?: "on-or-before")
                    .put("threshold", validTime(rule.optString("threshold"), "23:00"))
                    .put("points", rule.optDouble("points", 0.0))
            }))
    }.distinctBy { it.getString("id") })

    private fun normalizeSleepEntries(rows: JSONArray?, planIds: Set<String>) = jsonArray(rows?.objects().orEmpty().mapNotNull { source ->
        val planId = source.optString("planId").takeIf(planIds::contains) ?: return@mapNotNull null
        val date = validDate(source.optString("date")) ?: return@mapNotNull null
        entity(source, "sleep-entry").put("planId", planId).put("date", date)
            .put("fellAsleepAt", source.optString("fellAsleepAt").takeIf(timePattern::matches) ?: JSONObject.NULL)
            .put("wokeAt", source.optString("wokeAt").takeIf(timePattern::matches) ?: JSONObject.NULL)
            .put("durationMinutes", if (source.isNull("durationMinutes")) JSONObject.NULL else safeCount(source.opt("durationMinutes")))
            .put("quality", if (source.isNull("quality")) JSONObject.NULL else safeCount(source.opt("quality")).coerceIn(1, 10))
            .put("deviationMinutes", if (source.isNull("deviationMinutes")) JSONObject.NULL else safeCount(source.opt("deviationMinutes")))
            .put("note", source.optString("note").takeUnless { it == "null" } ?: "").put("score", source.optDouble("score", 0.0))
    }.distinctBy { it.getString("id") })

    private fun normalizeMoodEntries(rows: JSONArray?) = jsonArray(rows?.objects().orEmpty().mapIndexedNotNull { index, source ->
        val date = validDate(source.optString("date")) ?: return@mapIndexedNotNull null
        val legacy = mapOf("overwhelmed" to -5, "empty" to -4, "angry" to -3, "irritated" to -2, "anxious" to -2,
            "sad" to -3, "tired" to -1, "neutral" to 0, "tender" to 1, "curious" to 2, "grateful" to 3,
            "confident" to 3, "focused" to 2, "calm" to 1, "joy" to 4, "radiant" to 5, "custom" to 0)
        val mood = if (source.has("moodValue")) source.optInt("moodValue") else legacy[source.optString("moodId")] ?: 0
        entity(source, "mood-$date-$index").put("date", date)
            .put("recordedAt", source.nonBlank("recordedAt", source.nonBlank("updatedAt", now)))
            .put("moodValue", mood.coerceIn(-5, 6))
            .put("note", source.optString("note").takeUnless { it == "null" } ?: source.optString("custom"))
            .put("tags", source.optJSONArray("tags") ?: JSONArray())
            .put("customLabel", source.optString("customLabel").take(40))
            .put("customEmoji", source.optString("customEmoji").take(16))
    }.distinctBy { it.getString("id") })

    private fun normalizeQuests(rows: JSONArray?, habitIds: Set<String>) = jsonArray(rows?.objects().orEmpty().mapNotNull { source ->
        val start = validDate(source.optString("startDate")) ?: return@mapNotNull null
        val end = validDate(source.optString("endDate")) ?: return@mapNotNull null
        entity(source, "quest").put("cadence", source.nonBlank("cadence", "daily"))
            .put("kind", source.nonBlank("kind", "completions"))
            .put("habitId", source.nullable("habitId")?.takeIf(habitIds::contains) ?: JSONObject.NULL)
            .put("startDate", start).put("endDate", end).put("target", safeCount(source.opt("target")).coerceAtLeast(1))
            .put("progress", safeCount(source.opt("progress"))).put("rewardLaurels", safeCount(source.opt("rewardLaurels")))
            .put("completedAt", source.nullable("completedAt") ?: JSONObject.NULL)
    }.distinctBy { it.getString("id") })
}
