package ru.genesis.calendar.ui

import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.time.temporal.WeekFields
import java.util.Locale
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.GenesisCalendar
import ru.genesis.calendar.domain.SacredCatalog
import ru.genesis.calendar.domain.lunarPatronForDay

internal data class TodayLunarHeroContext(val monthTitle: String, val progress: String)

internal data class TodayHeroCopy(val eyebrow: String, val month: String, val title: String,
    val subtitle: String?, val description: String, val details: List<String>,
    val footerDate: String, val imagePath: String, val badge: String?,
    val lunarContext: TodayLunarHeroContext? = null)

internal fun gregorianYearPosition(date: LocalDate, language: String = "ru"): String {
    val week = date.get(WeekFields.ISO.weekOfWeekBasedYear())
    return if (language == "en") "Week of the year · $week\n${date.dayOfYear} of ${date.lengthOfYear()} days in the year"
        else "Неделя года · $week\n${date.dayOfYear} из ${date.lengthOfYear()} дней года"
}

private data class WeekdayPatron(val patronage: String, val deity: String, val bodyParts: String)

/** The same three mode-specific hero texts used by the web today view. */
private val weekdayPatrons = listOf(
    WeekdayPatron("День Аполлона", "Аполлон (или Гелиос) — бог света, истины, искусств, порядка и самого источника жизни.",
        "Сердце, позвоночник и правый глаз. Солнце — центральный «мотор» макрокосма, а в человеке эту роль играет сердце; позвоночник выражает внутренний стержень и прямую осанку, дарованную божественным светом."),
    WeekdayPatron("День Луны — Селены, Гекаты и Артемиды", "Селена, Геката и Артемида — богини ночного светила, интуиции, циклов и скрытой природы вещей.",
        "Желудок, грудь, матка, левый глаз и все жидкости организма — лимфа и слизь. В античной традиции Луна отвечает за питание, усвоение и материнскую заботу о теле."),
    WeekdayPatron("День Ареса", "Арес — бог яростной, неукротимой войны, физической силы и первобытного драйва.",
        "Голова, лицо, кровеносная система и мышцы. Арес управляет жаром тела, кровью как носителем жизненной энергии и мускулатурой, которая позволяет действовать и сражаться."),
    WeekdayPatron("День Гермеса", "Гермес — вестник богов, покровитель торговли, интеллекта, речи и связи между мирами.",
        "Руки, плечи, лёгкие, язык и нервная система. Гермес отвечает за коммуникацию, дыхание и обмен с внешним миром, мелкую моторику и передачу сигналов по телу."),
    WeekdayPatron("День Зевса и Геры", "Зевс — царь богов, громовержец, символ закона, расширения, изобилия и высшей власти; Гера хранит царственный союз, порядок и достоинство.",
        "Печень, бёдра и тазобедренные суставы. В древности печень считалась вместилищем высших эмоций и источником кровотворения, а мощные бёдра — символом опоры и физической силы."),
    WeekdayPatron("День Афродиты, Гестии и Диониса", "Афродита — богиня любви, красоты, гармонии и влечения. День также открывает путь Гестии, хранительницы очага, или Диониса — силы трансгрессии, растворения и экстаза; каждый выбирает любовь, семейный круг или дионисийское веселье.",
        "Горло, почки, кожа и женские репродуктивные органы. Афродита отвечает за фильтрацию и баланс, внешнюю привлекательность и осязание, а также за голос, который очаровывает."),
    WeekdayPatron("День Кроноса, Аида и Посейдона", "Кронос, титан и отец Зевса, — владыка времени, ограничений, структуры и неизбежной судьбы.",
        "Кости, зубы, суставы, селезёнка и кожа как граница. Кронос управляет самым твёрдым, долговременным и кристаллизованным в организме — внутренним каркасом, на котором держится всё остальное.")
)

private val weekdayArt = listOf("weekday-0-sunday-apollo.webp", "weekday-1-monday-lunar-goddesses.webp",
    "weekday-2-tuesday-ares.webp", "weekday-3-wednesday-hermes.webp",
    "weekday-4-thursday-zeus-hera.webp", "weekday-5-friday-aphrodite-hestia-dionysus.webp",
    "weekday-6-saturday-cronus.webp")

internal fun todayHeroCopy(date: LocalDate, mode: CalendarMode, calendar: GenesisCalendar,
    language: String = "ru"): TodayHeroCopy {
    val locale = Locale.forLanguageTag(language)
    val sacred = calendar.sacredDate(date)
    val month = SacredCatalog.months[sacred.monthIndex]
    val day = month.days.first { it.day == sacred.day }
    val sacredArt = "day-art-v1/month-${(sacred.monthIndex + 1).toString().padStart(2, '0')}/day-${sacred.day.toString().padStart(2, '0')}.webp"
    val gregorianDate = date.format(DateTimeFormatter.ofPattern("EEEE, d MMMM yyyy", locale))
    val solar = calendar.solarEvent(date)?.let { "${it.symbol} ${it.name}" }
    return when (mode) {
        CalendarMode.SACRED -> {
            val match = Regex("^(.*?)\\s*(\\([^()]+\\))$").matchEntire(day.name)
            TodayHeroCopy("${month.season.uppercase(locale)} · ${month.roman} МЕСЯЦ",
                month.name, match?.groupValues?.get(1) ?: day.name,
                match?.groupValues?.get(2), day.description, emptyList(), gregorianDate,
                sacredArt, solar)
        }
        CalendarMode.LUNAR -> {
            val lunar = calendar.lunarDate(date)
            val moon = calendar.moonInfo(date)
            val progress = "${lunar.decade} · ${lunar.day} из ${lunar.monthLength} дней"
            TodayHeroCopy("ЛУННЫЙ КАЛЕНДАРЬ · ${lunar.month.roman} МЕСЯЦ", lunar.month.name,
                "${lunar.day} лунный день", if (lunar.isThreshold) "Рубеж лунного месяца" else null,
                lunar.month.description,
                listOf(lunar.month.title, progress),
                gregorianDate, lunarPatronForDay(lunar.day).artPath, moon.event.takeIf { it.isNotBlank() },
                lunarContext = TodayLunarHeroContext(lunar.month.title, progress))
        }
        CalendarMode.PROFANE -> {
            val index = date.dayOfWeek.value % 7
            val patron = weekdayPatrons[index]
            TodayHeroCopy("ГРИГОРИАНСКИЙ КАЛЕНДАРЬ · ${date.year} ГОД",
                date.month.getDisplayName(TextStyle.FULL_STANDALONE, locale),
                date.dayOfWeek.getDisplayName(TextStyle.FULL, locale).replaceFirstChar { it.uppercase(locale) },
                date.format(DateTimeFormatter.ofPattern("d MMMM yyyy", locale)), patron.patronage,
                listOf(patron.deity, "Части тела: ${patron.bodyParts}"),
                calendar.formatDate(date, CalendarMode.SACRED), "weekday-art/${weekdayArt[index]}", solar)
        }
    }
}
