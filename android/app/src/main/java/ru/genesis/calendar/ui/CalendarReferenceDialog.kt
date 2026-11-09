package ru.genesis.calendar.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import ru.genesis.calendar.ui.Dialog
import androidx.compose.ui.window.DialogProperties
import ru.genesis.calendar.domain.CalendarMode

private data class CalendarReferenceSection(
    val symbol: String,
    val title: String,
    val paragraphs: List<String>,
)

@Composable
internal fun CalendarReferenceDialog(mode: CalendarMode, onDismiss: () -> Unit) {
    val english = LocalGenesisLanguage.current == "en"
    fun copy(russian: String, englishText: String) = if (english) englishText else russian
    val title = when (mode) {
        CalendarMode.PROFANE -> copy("Григорианский календарь", "Gregorian calendar")
        CalendarMode.SACRED -> copy("Сакральный календарь", "Sacred calendar")
        CalendarMode.LUNAR -> copy("Лунный календарь", "Lunar calendar")
    }
    val sections = when (mode) {
        CalendarMode.PROFANE -> listOf(
            CalendarReferenceSection("♄", copy("Гражданская система времени", "Civil system of time"), listOf(
                copy("Современный григорианский календарь — гражданская система с многослойной историей. Его месяцы и счёт года унаследованы от Рима.",
                    "The modern Gregorian calendar is a civil system with a layered history. Its months and year count came from Rome."),
                copy("Предпосылки семидневной недели восходят к Древнему Вавилону: вавилонская астрология придала особое значение семи видимым небесным светилам. В Рим семидневный ритм пришёл по двум линиям — иудейской субботней и греко-римской планетарной. Дни недели получили небесных покровителей — Солнце, Луну, Марс, Меркурий, Юпитер, Венеру и Сатурн.",
                    "The seven-day week reaches back to Babylonian astrology and its seven visible heavenly bodies. Rome received that rhythm through the Jewish Sabbath and Greco-Roman planetary tradition, giving the weekdays their celestial patrons."),
            )),
            CalendarReferenceSection("Ⅰ", copy("Почему год начинается 1 января", "Why the year begins on January 1"), listOf(
                copy("Январь связывали с Янусом, богом дверей, переходов и начал. В 153 году до н. э. вступление консулов в должность перенесли на 1 января; поскольку годы называли именами консулов, этот день стал гражданским началом года. Реформа Юлия Цезаря закрепила традицию.",
                    "January was linked to Janus, god of doors, transitions, and beginnings. In 153 BCE the consuls began office on January 1; because years were named for them, that day became the civil opening of the year. Julius Caesar's reform established the tradition."),
                copy("В 1582 году папа Григорий XIII ввёл названную его именем реформу, чтобы исправить накопившееся смещение юлианского календаря и вернуть весеннее равноденствие к церковному расчёту Пасхи.",
                    "In 1582 Pope Gregory XIII introduced the reform that bears his name to correct the Julian drift and restore the spring equinox used in the Church's Easter calculation."),
            )),
            CalendarReferenceSection("⌛", copy("Смысл в системе GENESIS", "Meaning in GENESIS"), listOf(
                copy("В символической системе GENESIS покровителем этого летоисчисления выступает Кронос — образ времени, меры, предела и неумолимого хода циклов.",
                    "In GENESIS, Cronus presides over this chronology as an image of time, measure, limits, and the course of cycles."),
                copy("Суббота понимается как сакральный день обязательного покоя: время прекращать обычный труд, восстанавливать тело и возвращаться к внутренней тишине. Эта практика созвучна иудейскому Шаббату — седьмому дню, посвящённому Богу и свободному от работы.",
                    "Saturday is a sacred day of rest: a time to stop ordinary work, restore the body, and return to inner quiet, resonating with the Jewish Sabbath."),
            )),
        )
        CalendarMode.LUNAR -> listOf(
            CalendarReferenceSection("☾", copy("Живой ритм Луны", "The living rhythm of the Moon"), listOf(
                copy("Лунный год начинается в день первого точного новолуния после весеннего равноденствия и включает 12 или 13 лунных месяцев по 29 или 30 суток.",
                    "The lunar year begins at the first exact new moon after the spring equinox and contains 12 or 13 lunar months of 29 or 30 days."),
                copy("В системе GENESIS это магический «женский» год: его внутренняя ткань определяется не месяцами и неделями солнечного года, а ростом, полнотой и исходом Луны. Весеннее равноденствие служит ежегодной точкой настройки; условия для практик рождаются внутри самих лунных месяцев.",
                    "In GENESIS this is a magical feminine year, shaped by the Moon's growth, fullness, and waning rather than the months and weeks of the solar year. The spring equinox is its annual tuning point."),
            )),
            CalendarReferenceSection("◯", copy("Месяцы и сезоны", "Months and seasons"), listOf(
                copy("Каждый месяц начинается в точный момент новолуния. Его сутки следуют фазам Луны, а вставочный тринадцатый месяц при необходимости удерживает лунный круг рядом с солнечными сезонами.",
                    "Each month begins at the exact new moon. Its days follow the Moon's phases, while an intercalary thirteenth month keeps the lunar cycle near the solar seasons when needed."),
                copy("Это современная символическая система GENESIS, а не реконструкция единого древнегреческого календаря. Её античная опора — образ Селены как небесного знака для людей и полнота Луны в середине месяца в Гомеровом гимне; греческие лунно-солнечные календари действительно удерживали месяцы рядом с сезонами при помощи вставочного месяца.",
                    "This is a modern GENESIS symbolic system, not a reconstruction of a single ancient Greek calendar. It draws on Selene and the Moon's fullness at mid-month; Greek lunisolar calendars kept months near the seasons with an intercalary month."),
            )),
        )
        CalendarMode.SACRED -> listOf(
            CalendarReferenceSection("☉", copy("Солнечный календарь", "Solar calendar"), listOf(
                copy("Год GENESIS начинается в день весеннего равноденствия и раскрывается через двенадцать месяцев. Каждый месяц несёт собственный образ, цвет, стихию и смысл — не просто отрезок времени, а отдельную ступень годового пути.",
                    "The GENESIS year begins on the spring equinox and unfolds through twelve months. Each month carries its own image, color, element, and meaning—a distinct stage of the annual path."),
                copy("В каждом месяце ровно 30 дней. Вместо привычных недель время собрано в шесть пят: коротких пятидневных ритмов, где нечётные и чётные пяты сменяют друг друга. Так солнечная мера года соединяется с живым лунным дыханием.",
                    "Each month has exactly 30 days, arranged into six five-day rhythms instead of ordinary weeks. The solar measure of the year meets the living breath of the Moon."),
                copy("Равноденствия и солнцестояния образуют четыре праздничные опоры. После завершения двенадцатого месяца наступает Апейрон — несколько дней вне обычного счёта, пространство тишины перед новым весенним началом.",
                    "The equinoxes and solstices form four festive supports. After the twelfth month comes Apeiron: several days outside ordinary counting, a quiet space before the new spring beginning."),
            )),
            CalendarReferenceSection("✦", copy("Сакральная геометрия времени", "Sacred geometry of time"), listOf(
                copy("Почему наш год начинается в день весеннего равноденствия? Почему в месяце ровно 30 дней, разбитых на 6 «пят» (пятидневок), а самих месяцев 12, плюс «скрытый» 13-й месяц?",
                    "Why does the year begin on the spring equinox? Why does each month contain 30 days arranged into six pentads, with twelve months plus a hidden thirteenth?"),
                copy("Это не случайность. Это классическая сакральная геометрия времени, где каждый день — шаг в процессе эволюции духа. Разберём эту структуру через оптику античной теологии Пифагора, Гесиода и Гомера.",
                    "This is sacred geometry of time, where every day is a step in the evolution of spirit. We can read it through Pythagoras, Hesiod, and Homer."),
            )),
            CalendarReferenceSection("🌱", copy("Почему год начинается в весеннее равноденствие?", "Why does the year begin at the spring equinox?"), listOf(
                copy("20 марта — это точка преодоления инерции зимы. Это первый день месяца Арейос (Арес), время прорыва, отделения бытия от небытия и победы света над тьмой. 12 месяцев — полный солярный круг, совершенный цикл развития идеи от её зарождения весной до полного растворения в пустоте (Зофос) в конце зимы. Оставшиеся 5–6 дней года — Апейрон, время чистого Хаоса вне времени, когда старый мир рухнул, а новый ещё не рождён.",
                    "March 20 overcomes winter's inertia and opens Areios. Twelve months complete the solar circle; the remaining five or six days are Apeiron, pure Chaos outside time between the old world and the unborn new one."),
            )),
            CalendarReferenceSection("🖐", copy("Пентада: 5 стихий и геометрия восхождения", "Pentad: five elements and the geometry of ascent"), listOf(
                copy("Каждая Пята (5 дней) — микрокосм, отражающий процесс «Анабасиса», восхождения души от плотной материи к чистому свету. Дни идут в строгом порядке: Земля — Вода — Воздух — Огонь — Эфир.",
                    "Each Pentad is a microcosm of the soul's ascent from dense matter to pure light: Earth, Water, Air, Fire, and Aether."),
                copy("Пифагор — геометрия плотности. Мир строится от стабильного к тонкому. Земля — статика (куб), Вода — текучесть, Воздух — форма. Огонь стоит выше Воздуха, потому что он активен и трансформирует элементы. Эфир — квинтэссенция, венец творения.",
                    "Pythagoras gives a geometry of density: the world rises from stable Earth through Water and Air to transforming Fire and the quintessence of Aether."),
                copy("Гесиод — хронология творения. В «Теогонии» путь идёт от тяжести к сиянию: сначала Хаос и твёрдая Земля, затем Вода, Небо и чистый Свет. Огонь — инструмент богов, стоящий над стихиями.",
                    "Hesiod gives a chronology of creation, moving from Chaos and solid Earth through Water and Sky to pure Light; Fire is the gods' transforming instrument."),
                copy("Гомер — раздел мира. Аид получил недра, Посейдон — море, Зевс — высокое небо. Движение всегда идёт снизу вверх. Успех любого дела требует пройти эти пять шагов: от «заземления» идеи до её «одухотворения» в эфире.",
                    "Homer divides the world among the underworld, sea, and high sky. Every undertaking must pass these five steps, from grounding an idea to spiritualizing it in Aether."),
            )),
            CalendarReferenceSection("🎲", copy("Гексада: 6 Пят и Куб Событий", "Hexad: six Pentads and the Cube of Events"), listOf(
                copy("Если Пята — инструмент стихий, то Гексада (число 6) — рамка времени, в которой этот инструмент действует. Шесть пят образуют 30 дней месяца.",
                    "If the Pentad is the elemental instrument, the Hexad is its frame in time. Six Pentads form a 30-day month."),
                copy("Для пифагорейцев 6 — первое совершенное число (1 + 2 + 3 = 6), число сотворения мира и гармонии. Это также число граней куба, самой устойчивой фигуры. Шесть Пят — шесть сторон «событийного куба» месяца. Пока не пройдёшь все шесть, не увидишь объёмную картину.",
                    "For the Pythagoreans, six is the first perfect number and the number of the cube's faces. Six Pentads are the six sides of the month's event cube; only the complete passage reveals the whole."),
                copy("У Гесиода это шесть поколений теогонии и веков творения. У Гомера — шесть граней эпического «Агона», пути героя.",
                    "Hesiod sees six generations and ages of creation; Homer gives six faces to the heroic path."),
            )),
        )
    }

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxWidth()
            .testTag("calendar-reference-dialog-${mode.wireValue}"),
            shape = AffairsLayout.shape, color = MaterialTheme.colorScheme.surface) {
            LazyColumn(contentPadding = PaddingValues(AffairsLayout.gutter),
                verticalArrangement = Arrangement.spacedBy(12.dp)) {
                item {
                    EditorDialogHeader(title, "calendar-reference-close", onDismiss)
                }
                sections.forEach { section ->
                    item { CalendarReferenceSectionCard(section) }
                }
                item {
                    Button(onClick = onDismiss, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                        Text(copy("Закрыть", "Close"))
                    }
                }
            }
        }
    }
}

@Composable
private fun CalendarReferenceSectionCard(section: CalendarReferenceSection) {
    Surface(Modifier.fillMaxWidth(), shape = AffairsLayout.shape, color = MaterialTheme.colorScheme.surfaceContainerLow,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
        Column(Modifier.padding(AffairsLayout.gutter), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(section.symbol, style = MaterialTheme.typography.headlineSmall)
            Text(section.title, Modifier.semantics { heading() },
                style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.primary)
            section.paragraphs.forEach {
                Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
