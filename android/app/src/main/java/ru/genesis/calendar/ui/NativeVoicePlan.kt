package ru.genesis.calendar.ui

import java.time.LocalDate
import java.time.LocalTime
import java.util.Locale
import ru.genesis.calendar.data.GenesisProject
import ru.genesis.calendar.data.GoogleTaskList

internal data class NativeVoiceTask(
    val title: String,
    val date: LocalDate,
    val time: String = "",
    val priority: Int = 5,
    val reminderMinutes: Int = 0,
    val projectId: String? = null,
    val taskListId: String? = null,
    val tags: List<String> = emptyList(),
)

/** Local fallback for the same task grammar as the website. Recognition is handled by Android. */
internal fun parseNativeVoicePlan(command: String, today: LocalDate, projects: List<GenesisProject>,
    lists: List<GoogleTaskList>): List<NativeVoiceTask> {
    require(command.isNotBlank()) { "Произнесите или напишите задачу." }
    val months = mapOf("января" to 1,"февраля" to 2,"марта" to 3,"апреля" to 4,"мая" to 5,
        "июня" to 6,"июля" to 7,"августа" to 8,"сентября" to 9,"октября" to 10,"ноября" to 11,
        "декабря" to 12,"january" to 1,"february" to 2,"march" to 3,"april" to 4,
        "may" to 5,"june" to 6,"july" to 7,"august" to 8,"september" to 9,
        "october" to 10,"november" to 11,"december" to 12)
    val weekdays = mapOf("понедельник" to 1,"вторник" to 2,"среду" to 3,"четверг" to 4,
        "пятницу" to 5,"субботу" to 6,"воскресенье" to 7,"monday" to 1,"tuesday" to 2,
        "wednesday" to 3,"thursday" to 4,"friday" to 5,"saturday" to 6,"sunday" to 7)
    return command.split(Regex("[;\n]+"),10).map(String::trim).filter(String::isNotBlank).map { segment ->
        var text=segment.replace(Regex("\\s+")," ").trim()
        fun take(pattern: Regex): MatchResult? = pattern.find(text)?.also { match ->
            text=(text.substring(0,match.range.first)+" "+text.substring(match.range.last+1))
                .replace(Regex("\\s+")," ").trim()
        }
        val tags=Regex("#[\\p{L}\\p{N}_-]+").findAll(text).map { it.value.drop(1) }.take(6).toList()
        text=text.replace(Regex("#[\\p{L}\\p{N}_-]+")," ")
        fun knownProject(): String? {
            for (project in projects.sortedByDescending { it.title.length }) {
                val name=Regex.escape(project.title)
                if(take(Regex("(?iu)(?:в|во|для|in|into|for)\\s+(?:проекте?|project)\\s+[«\\\"']?$name[»\\\"']?(?=\\s|$|[,.;])"))!=null)
                    return project.id
            }
            return null
        }
        fun knownList(): String? {
            for (list in lists.sortedByDescending { it.title.length }) {
                val name=Regex.escape(list.title)
                if(take(Regex("(?iu)(?:в|in)\\s+(?:списке?|(?:task\\s+)?list)\\s+[«\\\"']?$name[»\\\"']?(?=\\s|$|[,.;])"))!=null)
                    return list.id
            }
            return null
        }
        val projectId=knownProject()
        val listId=knownList()
        val priority=take(Regex("(?iu)(?:приоритет|priority)\\s*(?:p)?\\s*(10|[1-9])"))?.groupValues?.get(1)?.toInt() ?: 5
        val reminder=take(Regex("(?iu)(?:напомни\\s+)?за\\s+(\\d{1,4})\\s*(?:минут[уы]?|мин|minutes?|mins?)"))
            ?.groupValues?.get(1)?.toInt()?.coerceIn(0,40_320) ?: 0
        var date=today
        val relative=take(Regex("(?iu)(?:^|\\s)(?:на\\s+|on\\s+)?(послезавтра|day after tomorrow|завтра|tomorrow|сегодня|today)(?=\\s|$|[,.;])"))
        if(relative!=null) date=today.plusDays(when(relative.groupValues[1].lowercase(Locale.ROOT)) {
            "послезавтра","day after tomorrow" -> 2; "завтра","tomorrow" -> 1; else -> 0
        }) else {
            val iso=take(Regex("(?iu)(?:^|\\s)(?:на\\s+|on\\s+)?(\\d{4}-\\d{2}-\\d{2})(?=\\s|$|[,.;])"))
            if(iso!=null) date=runCatching { LocalDate.parse(iso.groupValues[1]) }.getOrElse { today }
            else {
                val numeric=take(Regex("(?iu)(?:^|\\s)(?:на\\s+|on\\s+)?(\\d{1,2})[./](\\d{1,2})(?:[./](\\d{2}|\\d{4}))?(?=\\s|$|[,.;])"))
                if(numeric!=null) {
                    val day=numeric.groupValues[1].toInt();val month=numeric.groupValues[2].toInt()
                    val rawYear=numeric.groupValues[3].toIntOrNull()
                    val year=rawYear?.let { if(it<100)2000+it else it } ?: today.year
                    date=runCatching { LocalDate.of(year,month,day) }.getOrElse { today }
                    if(rawYear==null && date<today) date=runCatching { date.plusYears(1) }.getOrElse { today }
                } else {
                    val monthPattern=months.keys.joinToString("|")
                    val named=take(Regex("(?iu)(?:^|\\s)(?:на\\s+|on\\s+)?(\\d{1,2})\\s+($monthPattern)(?:\\s+(\\d{4}))?(?=\\s|$|[,.;])"))
                    if(named!=null) {
                        val year=named.groupValues[3].toIntOrNull() ?: today.year
                        date=runCatching { LocalDate.of(year,months.getValue(named.groupValues[2].lowercase(Locale.ROOT)),named.groupValues[1].toInt()) }
                            .getOrElse { today }
                        if(named.groupValues[3].isEmpty() && date<today) date=date.plusYears(1)
                    } else {
                        val weekday=take(Regex("(?iu)(?:^|\\s)(?:(?:в|на|on|next)\\s+)?(${weekdays.keys.joinToString("|")})(?=\\s|$|[,.;])"))
                        if(weekday!=null) {
                            val day=weekdays.getValue(weekday.groupValues[1].lowercase(Locale.ROOT))
                            date=today.plusDays(((day-today.dayOfWeek.value+7)%7).let { if(it==0)7 else it }.toLong())
                        }
                    }
                }
            }
        }
        val clock=take(Regex("(?iu)(?:^|\\s)(?:(?:в|at)\\s*)?(\\d{1,2})[:.](\\d{2})\\s*(утра|дня|вечера|ночи|am|pm)?(?=\\s|$|[,.;])"))
            ?: take(Regex("(?iu)(?:^|\\s)(?:в|at)\\s+(\\d{1,2})\\s*(утра|дня|вечера|ночи|am|pm)?(?=\\s|$|[,.;])"))
        val time=clock?.let {
            var hour=it.groupValues[1].toInt()
            val minute=it.groupValues.getOrNull(2)?.toIntOrNull() ?: 0
            val period=it.groupValues.last().lowercase(Locale.ROOT)
            if(period in setOf("дня","вечера","pm") && hour<12) hour+=12
            if(period in setOf("ночи","утра","am") && hour==12) hour=0
            runCatching { LocalTime.of(hour,minute).toString() }.getOrNull()
        } ?: ""
        val title=text.replace(Regex("(?iu)^(?:(?:ну|пожалуйста|please)\\s*[,—-]?\\s*)*(?:(?:мне\\s+)?(?:нужно|надо)\\s+)?(?:создай|создать|добавь|добавить|запиши|записать|запланируй|запланировать|поставь|напомни|create|add|schedule|plan|make|remind)(?:\\s+мне)?(?:\\s+(?:новую?\\s+)?(?:задач[а-яё]*|напоминан[а-яё]*|a\\s+task|task|reminder))?\\s*[,.:;—-]?\\s*"),"")
            .replace(Regex("(?iu)^(?:задач[а-яё]*|напоминан[а-яё]*|task|reminder)\\s*[:—-]\\s*"),"")
            .replace(Regex("(?iu)^(?:(?:под|с)\\s+названием|по\\s+имени|(?:назови|назвать)(?:\\s+(?:е[её]|задачу))?|которую\\s+назови|название(?:\\s+задачи)?|которая\\s+называется|with\\s+(?:the\\s+)?(?:title|name)|named|called)\\s*[:—,-]?\\s*"),"")
            .trim(' ','«','»','"','.',',','!','?')
        require(title.isNotBlank() && title.lowercase(Locale.ROOT) !in setOf("задача","task","напоминание","reminder")) {
            "Произнесите или напишите название задачи."
        }
        NativeVoiceTask(title.take(300),date,time,priority,reminder,projectId,listId,tags)
    }
}
