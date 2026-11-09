package ru.genesis.calendar.domain

import java.time.LocalDate
import java.time.temporal.ChronoUnit

data class RecurrenceConfig(
    val enabled: Boolean = false,
    val mode: String = "genesis",
    val pattern: String = "pyata-days",
    val days: List<Int> = listOf(1),
    val interval: Int = 1,
    val rangeStart: String = "",
    val rangeEnd: String = "",
    val months: List<Int> = emptyList(),
    val pyatas: List<Int> = emptyList(),
    val calendarContext: CalendarContext? = null,
    val invalidDayPolicy: String = "skip",
)

/** Rules ported from app/task-recurrence.ts. Date iteration is civil, not elapsed 24h. */
class RecurrenceEngine(private val calendar: GenesisCalendar) {
    private val ruleCalendars = mutableMapOf<CalendarContext, GenesisCalendar>()
    fun normalize(raw: RecurrenceConfig): RecurrenceConfig {
        require(raw.mode in setOf("classic", "genesis", "lunar")) { "Unknown recurrence mode" }
        val pattern = when(raw.mode) {
            "classic" -> raw.pattern.takeIf { it in setOf("daily","weekdays","monthly","yearly") } ?: "weekdays"
            "lunar" -> raw.pattern.takeIf { it in setOf("lunar-days", "lunar-decades", "lunar-decade-days", "lunar-phases", "lunar-yearly") } ?: "lunar-days"
            else -> if (raw.pattern == "month-days") "month-days" else "pyata-days"
        }
        val dayLimit = when {
            raw.mode == "classic" -> 7
            raw.mode == "genesis" && pattern == "pyata-days" -> 5
            pattern == "lunar-decades" -> 3
            pattern == "lunar-decade-days" -> 10
            pattern == "lunar-phases" -> 2
            else -> 30
        }
        return raw.copy(pattern=pattern, days=raw.days.filter { it in 1..dayLimit }.distinct().sorted().ifEmpty { listOf(1) },
            interval=raw.interval.coerceIn(1,99), rangeStart=raw.rangeStart.takeIf { parse(it) != null } ?: "",
            rangeEnd=raw.rangeEnd.takeIf { parse(it) != null } ?: "",
            months=raw.months.filter { it in 1..(if(pattern == "lunar-yearly") 13 else 72) }.distinct().sorted(),
            pyatas=raw.pyatas.filter { it in 1..(if(pattern == "lunar-decade-days") 3 else 6) }.distinct().sorted())
    }

    fun resolve(startDate: String, raw: RecurrenceConfig): RecurrenceConfig {
        val config = normalize(raw)
        val start = parse(startDate) ?: return config
        val anchor = maxOf(start, parse(config.rangeStart) ?: start)
        if (anchor.year !in 1900..2100) return config
        // JavaScript setFullYear rolls Feb 29 to March 1 in non-leap years.
        fun shiftedYear(years: Int) = LocalDate.of(anchor.year + years, anchor.monthValue,1).plusDays(anchor.dayOfMonth.toLong() - 1)
        val maximum = minOf(shiftedYear(5).minusDays(1), LocalDate.of(2100,12,31))
        val end = (parse(config.rangeEnd) ?: shiftedYear(1).minusDays(1)).coerceIn(anchor, maximum)
        return config.copy(rangeStart=anchor.toString(), rangeEnd=end.toString())
    }

    fun matches(startDate: String, raw: RecurrenceConfig, dateValue: String, ignoreRangeEnd: Boolean = false): Boolean {
        val template = parse(startDate) ?: return false
        val date = parse(dateValue) ?: return false
        val config = normalize(raw)
        if (!config.enabled) return date == template
        if (template.year !in 1900..2100 || date.year !in 1900..2100) return false
        val context = config.calendarContext ?: CalendarContext(version=1, timeZone=calendar.zoneId.id)
        val ruleCalendar = ruleCalendars.getOrPut(context) { GenesisCalendar(java.time.ZoneId.of(context.timeZone), context.version, context.gregorianYearStart) }
        val anchor = maxOf(template, parse(config.rangeStart) ?: template)
        if (anchor.year !in 1900..2100) return false
        if (date < anchor || (!ignoreRangeEnd && parse(config.rangeEnd)?.let { date > it } == true)) return false
        return when(config.mode) {
            "classic" -> when(config.pattern) {
                "daily" -> ChronoUnit.DAYS.between(anchor,date) % config.interval == 0L
                "weekdays" -> ChronoUnit.WEEKS.between(monday(anchor), monday(date)) % config.interval == 0L && date.dayOfWeek.value in config.days
                "monthly" -> ((date.year-anchor.year)*12 + date.monthValue-anchor.monthValue) % config.interval == 0 && date.dayOfMonth == template.dayOfMonth
                else -> (date.year-anchor.year) % config.interval == 0 && date.monthValue == template.monthValue && date.dayOfMonth == template.dayOfMonth
            }
            "genesis" -> {
                val sacred = ruleCalendar.sacredDate(date)
                sacred.monthIndex < 12 && (config.months.isEmpty() || sacred.monthIndex+1 in config.months) &&
                    if(config.pattern == "pyata-days") {
                        (config.pyatas.isEmpty() || (sacred.day-1)/5+1 in config.pyatas) && (sacred.day-1)%5+1 in config.days
                    } else sacred.day in config.days
            }
            else -> {
                val lunar = ruleCalendar.lunarDate(date)
                val matchingDay = when(config.pattern) {
                    "lunar-decades" -> (lunar.day-1)/10+1 in config.days
                    "lunar-decade-days" -> (config.pyatas.isEmpty() || (lunar.day-1)/10+1 in config.pyatas) && (lunar.day-1)%10+1 in config.days
                    "lunar-phases" -> (1 in config.days && lunar.day == 1) || (2 in config.days && ruleCalendar.isLunarFullMoon(date))
                    else -> lunar.day in config.days
                }
                matchingDay && if(config.pattern == "lunar-yearly") lunar.monthOrdinal in config.months
                    else config.months.isEmpty() || lunar.monthIndex-ruleCalendar.lunarMonthIndex(anchor)+1 in config.months
            }
        }
    }

    fun buildDates(startDate: String, raw: RecurrenceConfig): List<String> {
        val template = parse(startDate) ?: return emptyList()
        val config = resolve(startDate, raw)
        if (!config.enabled) return listOf(template.toString())
        val start = parse(config.rangeStart) ?: return emptyList()
        val end = parse(config.rangeEnd) ?: return emptyList()
        if (template.year !in 1900..2100 || start.year !in 1900..2100) return emptyList()
        return CalendarRange(start,end).dates().filter { matches(startDate, config, it.toString()) }.map(LocalDate::toString)
    }

    /** Port of recurrenceDatesForTask: already-materialized series/Google Tasks are not
     * expanded twice, exclusions remove occurrences, and the web fallback is preserved.
     */
    fun datesForTask(dueDate: String, config: RecurrenceConfig, googleTaskListId: String? = null,
        recurrenceSeriesId: String? = null, excludedDates: Set<String> = emptySet()): List<String> {
        if (parse(dueDate) == null) return emptyList()
        if (!googleTaskListId.isNullOrEmpty() || !recurrenceSeriesId.isNullOrEmpty() || !config.enabled) return listOf(dueDate)
        val dates = buildDates(dueDate,config).filterNot { it in excludedDates }
        return dates.ifEmpty { if (dueDate in excludedDates) emptyList() else listOf(dueDate) }
    }

    private fun monday(date: LocalDate) = date.minusDays((date.dayOfWeek.value-1).toLong())
    private fun parse(value: String): LocalDate? = if (!Regex("\\d{4}-\\d{2}-\\d{2}").matches(value)) null else runCatching { LocalDate.parse(value) }.getOrNull()
}
