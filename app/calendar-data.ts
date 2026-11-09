import source from "../references/days.txt?raw";
import { MoonPhase, SearchMoonPhase, Seasons } from "astronomy-engine";
import { addCivilDays, calendarContext, civilDateCarrier, isCivilDate, momentCivilDate, type CalendarContext } from "./calendar-context";
import { calendarPeriod, lunarDateParts, lunarMonthForDate, lunarMonthStartDate, lunarYearPeriod, newMoonMoment, sacredDateParts, sacredToCivilDate, sacredYearStartDate } from "./calendar-astronomy";
import englishDays from "./calendar-days.en.json";
import greekDays from "./calendar-days.el.json";
import germanDays from "./calendar-days.de.json";
import frenchDays from "./calendar-days.fr.json";
import spanishDays from "./calendar-days.es.json";
import italianDays from "./calendar-days.it.json";
import portugueseDays from "./calendar-days.pt.json";
import polishDays from "./calendar-days.pl.json";
import serbianDays from "./calendar-days.sr.json";
import ukrainianDays from "./calendar-days.uk.json";
import chineseDays from "./calendar-days.zh.json";
import turkishDays from "./calendar-days.tr.json";
import japaneseDays from "./calendar-days.ja.json";
import { getRuntimeLanguage, runtimeLocale, translateText, type Language } from "./i18n";
import { lunarPatronNameRu } from "./lunar-triad";

export type SacredDay = {
  id: string;
  monthIndex: number;
  day: number;
  name: string;
  description: string;
  pyata: number;
  pyataTitle: string;
};

export type SacredMonth = {
  index: number;
  roman: string;
  name: string;
  title: string;
  description: string;
  season: string;
  color: string;
  symbol: string;
  artPosition: string;
  days: SacredDay[];
};

export type SolarEvent = {
  id: "spring-equinox" | "summer-solstice" | "autumn-equinox" | "winter-solstice";
  name: string;
  shortName: string;
  kind: "equinox" | "solstice";
  symbol: string;
  date: Date;
  monthIndex: number;
  day: number;
};

export type SacredDateInfo = {
  sacredYear: number;
  monthIndex: number;
  day: number;
  dayOfYear: number;
  daysInYear: number;
  apeironDays: number;
};

export type MoonInfo = {
  age: number;
  day: number;
  phaseStep: number;
  epithet: string;
  direction: "Восходящая луна" | "Нисходящая луна";
  phase: string;
  event: string;
  illumination: number;
};

export type LunarYearInfo = {
  sacredYear: number;
  startMonthIndex: number;
  endMonthIndex: number;
  monthCount: number;
  startDate: Date;
  endDate: Date;
};

export type LunarMonthDefinition = {
  index: number;
  roman: string;
  name: string;
  title: string;
  description: string;
};

export type LunarDecade = {
  id: "growth" | "fullness" | "outflow";
  name: string;
  range: string;
};

export type LunarDateInfo = {
  year: LunarYearInfo;
  monthIndex: number;
  monthOrdinal: number;
  month: LunarMonthDefinition;
  day: number;
  monthLength: number;
  decade: LunarDecade;
  isThreshold: boolean;
};

export type CalendarMode = "profane" | "sacred" | "lunar";

export const ELEMENTS = [
  { name: "Земля", meaning: "Опора · Тело", symbol: "🜃" },
  { name: "Вода", meaning: "Эмоции · Поток", symbol: "🜄" },
  { name: "Воздух", meaning: "Интеллект · Связь", symbol: "🜁" },
  { name: "Огонь", meaning: "Воля · Действие", symbol: "🜂" },
  { name: "Эфир", meaning: "Дух · Синтез", symbol: "✦" },
] as const;

export const PYTHAGOREAN = [
  { name: "Монада", meaning: "Удержание · Стабильность", roman: "I" },
  { name: "Диада", meaning: "Разделение · Текучесть · Выбор пути", roman: "II" },
  { name: "Триада", meaning: "Одухотворение · Связь верха и низа", roman: "III" },
  { name: "Тетрада", meaning: "Справедливость · Полнота", roman: "IIII" },
  { name: "Пентада", meaning: "Всецелостность · Синтез", roman: "V" },
] as const;

export const PYATA_DETAILS = [
  {
    title: "Пята Инициации",
    archetype: "Эпифания / Хаос",
    summary: "Инициация · Явление идеи",
    description: "Явление идеи. Выделение первичного импульса из пустоты. Бог месяца заявляет о себе, мы ставим цель.",
  },
  {
    title: "Пята Подготовки",
    archetype: "Эпиплос / Разделение",
    summary: "Подготовка · Сбор ресурсов",
    description: "Установление границ и «снаряжение корабля». Стихии начинают конфликтовать, выстраивается иерархия. Время подготовки ресурсов.",
  },
  {
    title: "Пята Столкновения",
    archetype: "Агон / Порядок Зевса",
    summary: "Столкновение · Преодоление хаоса",
    description: "Срединная битва. Пик сопротивления материала. Преодоление хаоса и наведение порядка в делах.",
  },
  {
    title: "Пята Кульминации",
    archetype: "Арете / Расцвет Олимпа",
    summary: "Кульминация · Расцвет замысла",
    description: "Проявление доблести. Энергия месяца достигает своего зенита. Лучшая версия реализации наших планов.",
  },
  {
    title: "Пята Плодов",
    archetype: "Ностос / Героическое деяние",
    summary: "Плоды · Оценка результатов",
    description: "Путь домой. Божественная энергия спускается на уровень человеческого действия. Сбор плодов и оценка результатов.",
  },
  {
    title: "Пята Перехода",
    archetype: "Апофеоз / Железный век",
    summary: "Переход · Передача эстафеты",
    description: "Переход в вечность и память. Угасание формы, но кристаллизация опыта. Очищение места и подготовка к передаче эстафеты следующему месяцу.",
  },
] as const;

export const PYATA_MEANINGS = PYATA_DETAILS.map((detail) => detail.summary);

const MONTH_STYLE = [
  ["Весна", "#6f9b68", "Α", "0%"],
  ["Весна", "#98a85d", "Β", "8.333%"],
  ["Весна", "#2f8f8a", "Γ", "16.666%"],
  ["Лето", "#dfa33d", "Δ", "25%"],
  ["Лето", "#c55235", "Ε", "33.333%"],
  ["Лето", "#b98535", "Ζ", "41.666%"],
  ["Осень", "#8f3f49", "Η", "50%"],
  ["Осень", "#6d5b8e", "Θ", "58.333%"],
  ["Осень", "#a34b33", "Ι", "66.666%"],
  ["Зима", "#4d7f91", "Κ", "75%"],
  ["Зима", "#718bb4", "Λ", "83.333%"],
  ["Зима", "#343f73", "Μ", "91.666%"],
  ["Вне времени", "#1f4a49", "Ω", "100%"],
] as const;

function parseCalendar(text: string): SacredMonth[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const months: SacredMonth[] = [];
  let current: SacredMonth | null = null;
  let pyata = 0;
  let pyataTitle = "";

  const nextDescription = (from: number) => {
    for (let i = from + 1; i < lines.length; i += 1) {
      const value = lines[i].trim();
      if (value) return value;
    }
    return "";
  };

  lines.forEach((rawLine, lineIndex) => {
    const line = rawLine.trim();
    if (!line) return;

    const standardMonth = line.match(
      /^МЕСЯЦ\s+([IVX]+):\s+(.+?)\s+\((.+)\)$/i,
    );
    const apeironMonth = line.match(/^13-Й МЕСЯЦ:\s+(.+?)\s+\((.+)\)$/i);

    if (standardMonth || apeironMonth) {
      const index = months.length;
      const style = MONTH_STYLE[index] ?? MONTH_STYLE[12];
      current = {
        index,
        roman: standardMonth?.[1] ?? "XIII",
        name: (standardMonth?.[2] ?? apeironMonth?.[1] ?? "").trim(),
        title: (standardMonth?.[3] ?? apeironMonth?.[2] ?? "").trim(),
        description: nextDescription(lineIndex),
        season: style[0],
        color: style[1],
        symbol: style[2],
        artPosition: style[3],
        days: [],
      };
      months.push(current);
      pyata = 0;
      pyataTitle = "";
      return;
    }

    const pyataMatch = line.match(/^Пята\s+(\d+):\s+(.+?)\s+\(/i);
    if (pyataMatch) {
      pyata = Number(pyataMatch[1]);
      pyataTitle = pyataMatch[2].trim();
      return;
    }

    if (!current || !/^\d{2}\.\d{2}(?:\.|\s)/.test(line)) return;

    const content = line.replace(
      /^\d{2}\.\d{2}(?:\.\s*|\s*\([^)]+\)\.\s*)/,
      "",
    );
    const divider = content.indexOf("—");
    if (divider < 0) return;

    const day = current.days.length + 1;
    current.days.push({
      id: `${current.index}-${day}`,
      monthIndex: current.index,
      day,
      name: content.slice(0, divider).trim(),
      description: content.slice(divider + 1).trim(),
      pyata,
      pyataTitle,
    });
  });

  if (months.length !== 13 || months.reduce((sum, month) => sum + month.days.length, 0) !== 366) {
    throw new Error("Sacred calendar source is incomplete");
  }

  return months;
}

export const MONTHS = parseCalendar(source);

export const LUNAR_MONTHS: readonly LunarMonthDefinition[] = [
  { index: 0, roman: "I", name: "Генезион", title: "Месяц Рождения и Замысла", description: "Время формулировать цели на год. Энергия чистого потенциала: начинания ещё невидимы, но их внутренний импульс уже задан." },
  { index: 1, roman: "II", name: "Агонион", title: "Месяц Преодоления", description: "Первые трудности на пути реализации замысла. Время приложения усилий, здоровой конкуренции и тренировки воли." },
  { index: 2, roman: "III", name: "Эвризион", title: "Месяц Открытий", description: "Время инсайтов и первых результатов работы. Пройдя сопротивление, система обнаруживает новые решения и возможности." },
  { index: 3, roman: "IV", name: "Кинонион", title: "Месяц Связей", description: "Время социальной активности, укрепления отношений, переговоров и союзов. Фокус естественно смещается с «Я» на «Мы»." },
  { index: 4, roman: "V", name: "Акмеон", title: "Месяц Вершины", description: "Точка максимальной продуктивности и раскрытия потенциала. Время воплощать намерение и принимать плоды собственных действий." },
  { index: 5, roman: "VI", name: "Критион", title: "Месяц Переоценки", description: "Экватор года и время трезвого взгляда на достигнутое: распознать ошибки, сохранить существенное и отсечь лишнее." },
  { index: 6, roman: "VII", name: "Практион", title: "Месяц Усердия", description: "После переоценки приходит время упорной, рутинной, но осмысленной работы и внедрения новых правил в повседневность." },
  { index: 7, roman: "VIII", name: "Софион", title: "Месяц Мудрости", description: "Время передачи опыта, обучения и философского размышления. Накопленное знание становится действующей силой." },
  { index: 8, roman: "IX", name: "Катартион", title: "Месяц Очищения", description: "Подготовка к завершению цикла: освобождение от долгов, старых обид и ненужных вещей, духовная и физическая уборка." },
  { index: 9, roman: "X", name: "Мнемонион", title: "Месяц Памяти", description: "Обращение к прошлому. Время вспоминать предков и наставников, благодарить их и подводить исторические итоги года." },
  { index: 10, roman: "XI", name: "Эремион", title: "Месяц Тишины", description: "Время уединения, медитации и глубокого внутреннего покоя, когда внешняя активность уступает место вниманию к себе." },
  { index: 11, roman: "XII", name: "Телейон", title: "Месяц Завершения", description: "Окончательная точка цикла: завершение начатого, подведение итогов и освобождение пространства перед новым рождением." },
  { index: 12, roman: "XIII", name: "Апорион", title: "Вставочный месяц · Вне Времени", description: "Сакральная пауза перед новым циклом. Период неопределённости и творческого хаоса, когда старые правила уже не действуют, а новые ещё не проявились." },
] as const;

export const LUNAR_DECADES: readonly LunarDecade[] = [
  { id: "growth", name: "Декада Роста", range: "1–10 сутки" },
  { id: "fullness", name: "Декада Полноты", range: "11–20 сутки" },
  { id: "outflow", name: "Декада Исхода", range: "21 сутки — Рубеж" },
] as const;

const ENGLISH_DAYS = englishDays as readonly Pick<SacredDay, "name" | "description">[];

export const DAY_MS = 86_400_000;
export const MOON_CYCLE = 29.53058867;
export const MOON_EPOCH = Date.UTC(2000, 0, 6, 18, 14);


function utcDay(date: Date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

export function getSacredYearStart(date: Date, context: CalendarContext = calendarContext()) {
  return civilDateCarrier(sacredYearStartDate(getSacredDate(date, context).sacredYear, context), 0);
}

export function getSacredDate(date: Date, context: CalendarContext = calendarContext()): SacredDateInfo {
  return sacredDateParts(calendarDateValue(date), context);
}

export function getGregorianDate(sacredYear: number, monthIndex: number, day: number, context: CalendarContext = calendarContext()) {
  return civilDateCarrier(sacredToCivilDate(sacredYear, monthIndex, day, context), 0);
}

export function formatGregorian(date: Date, long = false) {
  return new Intl.DateTimeFormat(runtimeLocale(), {
    day: "numeric",
    month: long ? "long" : "short",
    year: long ? "numeric" : undefined,
    weekday: long ? "long" : "short",
  }).format(date);
}

export function getMoon(date: Date, context: CalendarContext = calendarContext()): MoonInfo {
  const phaseAngle = MoonPhase(date);
  const fraction = phaseAngle / 360;
  const index = lunarMonthIndex(date, context);
  const monthStart = getLunarMonthStart(index, context);
  const age = Math.max(0, Math.round((utcDay(date) - utcDay(monthStart)) / DAY_MS));
  const day = age + 1;
  const phaseIndex = Math.round(fraction * 8) % 8;
  const phaseNames = [
    "Новолуние",
    "Молодой серп",
    "Первая четверть",
    "Растущая луна",
    "Полнолуние",
    "Убывающая луна",
    "Последняя четверть",
    "Старый серп",
  ];
  const isNewMoon = day === 1;
  const isFullMoon = Math.abs(phaseAngle - 180) <= 18;
  const isWaxing = phaseAngle < 180;
  const epithet = lunarPatronNameRu(day);
  const direction = isWaxing && !isNewMoon ? "Восходящая луна" : "Нисходящая луна";
  const event = isNewMoon
    ? "Новолуние"
    : isFullMoon
      ? "Полнолуние"
      : "";

  return {
    age,
    day,
    phaseStep: Math.round(fraction * 30) % 30,
    epithet,
    direction,
    phase: phaseNames[phaseIndex],
    event,
    illumination: Math.round(((1 - Math.cos(2 * Math.PI * fraction)) / 2) * 100),
  };
}

export function lunarMonthIndex(date: Date, context: CalendarContext = calendarContext()) {
  return lunarMonthForDate(calendarDateValue(date), context);
}

export function getLunarMonthDates(index: number, context: CalendarContext = calendarContext()) {
  const start = lunarMonthStartDate(index, context);
  const end = lunarMonthStartDate(index + 1, context);
  const dates: Date[] = [];
  for (let value = start; value < end; value = addCivilDays(value, 1)) dates.push(civilDateCarrier(value));
  return dates;
}

export function getLunarMonthStart(index: number, context: CalendarContext = calendarContext()) {
  return civilDateCarrier(lunarMonthStartDate(index, context));
}

export function isLunarFullMoon(date: Date, context: CalendarContext = calendarContext()) {
  const fullMoon = SearchMoonPhase(180, newMoonMoment(lunarMonthIndex(date, context)), 30);
  return Boolean(fullMoon && momentCivilDate(fullMoon.date, context.timeZone) === calendarDateValue(date));
}

export function getLunarYear(sacredYear: number, context: CalendarContext = calendarContext()): LunarYearInfo {
  const year = lunarYearPeriod(sacredYear, context);
  return { sacredYear, startMonthIndex: year.startMonthIndex, endMonthIndex: year.endMonthIndex,
    monthCount: year.monthCount, startDate: civilDateCarrier(year.start), endDate: civilDateCarrier(year.end) };
}

export function getLunarYearForDate(date: Date, context: CalendarContext = calendarContext()) {
  const candidate = getLunarYear(date.getFullYear(), context);
  return calendarDateValue(date) >= calendarDateValue(candidate.startDate) ? candidate : getLunarYear(date.getFullYear() - 1, context);
}

export function getLunarMonthDefinition(monthOrdinal: number) {
  return LUNAR_MONTHS[Math.min(Math.max(monthOrdinal - 1, 0), LUNAR_MONTHS.length - 1)];
}

export function getLunarDecade(day: number) {
  if (day <= 10) return LUNAR_DECADES[0];
  if (day <= 20) return LUNAR_DECADES[1];
  return LUNAR_DECADES[2];
}

export function getLunarDate(date: Date, context: CalendarContext = calendarContext()): LunarDateInfo {
  const lunar = lunarDateParts(calendarDateValue(date), context);
  return { year: getLunarYear(lunar.year.sacredYear, context), monthIndex: lunar.monthIndex,
    monthOrdinal: lunar.monthOrdinal, month: getLunarMonthDefinition(lunar.monthOrdinal),
    day: lunar.day, monthLength: lunar.monthLength, decade: getLunarDecade(lunar.day), isThreshold: lunar.day === lunar.monthLength };
}

export function formatSacredDate(date: Date, long = false, context: CalendarContext = calendarContext()) {
  const sacred = getSacredDate(date, context);
  const month = MONTHS[sacred.monthIndex];
  const day = getSacredDay(sacred.monthIndex, sacred.day);
  if (!long) return `${sacred.day} · ${translateText(month.name)}`;
  return translateText(`${day.name} · ${sacred.day} день · Пята ${day.pyata || "Ω"} · ${month.name} ${sacred.sacredYear}`, undefined, true);
}

export function formatLunarDate(date: Date, long = false, context: CalendarContext = calendarContext()) {
  const moon = getMoon(date, context);
  const lunar = getLunarDate(date, context);
  return translateText(long
    ? `${lunar.month.name} · ${lunar.day} лунный день · ${lunar.isThreshold ? "Рубеж" : lunar.decade.name} · ${moon.phase}`
    : `${lunar.day} · ${lunar.month.name}`, undefined, true);
}

export function formatCalendarDate(date: Date, mode: CalendarMode, long = false, context: CalendarContext = calendarContext()) {
  if (mode === "sacred") return formatSacredDate(date, long, context);
  if (mode === "lunar") return formatLunarDate(date, long, context);
  return formatGregorian(date, long);
}



export function parseCalendarDateValue(value: string) {
  const normalized = value.slice(0, 10);
  return isCivilDate(normalized) ? civilDateCarrier(normalized) : null;
}

export function calendarDateValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function formatCalendarDateValue(value: string, mode: CalendarMode, long = false, context: CalendarContext = calendarContext()) {
  const date = parseCalendarDateValue(value);
  return date ? formatCalendarDate(date, mode, long, context) : value;
}

function inclusiveCalendarRange(value: string, mode: CalendarMode, unit: "month" | "quarter" | "year", context: CalendarContext) {
  const date = parseCalendarDateValue(value) ?? new Date();
  const range = calendarPeriod(calendarDateValue(date), mode, unit, context);
  return { start: range.start, end: addCivilDays(range.end, -1) };
}

export function calendarYearRange(value: string, mode: CalendarMode, context: CalendarContext = calendarContext()) {
  return inclusiveCalendarRange(value, mode, "year", context);
}

export function calendarMonthRange(value: string, mode: CalendarMode, context: CalendarContext = calendarContext()) {
  return inclusiveCalendarRange(value, mode, "month", context);
}

export function calendarQuarterRange(value: string, mode: CalendarMode, context: CalendarContext = calendarContext()) {
  return inclusiveCalendarRange(value, mode, "quarter", context);
}

export function calendarYearLabel(value: string, mode: CalendarMode, context: CalendarContext = calendarContext()) {
  if (!parseCalendarDateValue(value)) return value.slice(0, 4);
  const range = calendarYearRange(value, mode, context);
  const year = range.start.slice(0, 4), endYear = range.end.slice(0, 4);
  return year === endYear ? year : `${year}–${endYear}`;
}

export function calendarMonthKey(value: string, mode: CalendarMode, context: CalendarContext = calendarContext()) {
  const date = parseCalendarDateValue(value);
  if (!date) return value.slice(0, 7);
  if (mode === "sacred") {
    const sacred = getSacredDate(date, context);
    return `sacred:${sacred.sacredYear}:${sacred.monthIndex}`;
  }
  if (mode === "lunar") return `lunar:${lunarMonthIndex(date, context)}`;
  return value.slice(0, 7);
}

export function formatCalendarMonthValue(value: string, mode: CalendarMode, context: CalendarContext = calendarContext()) {
  const date = parseCalendarDateValue(value);
  if (!date) return value;
  if (mode === "sacred") {
    const sacred = getSacredDate(date, context);
    return `${translateText(MONTHS[sacred.monthIndex].name)} · ${sacred.sacredYear}`;
  }
  if (mode === "lunar") {
    const lunar = getLunarDate(date, context);
    return `${translateText(lunar.month.name)} · ${lunar.year.sacredYear}–${lunar.year.sacredYear + 1}`;
  }
  return new Intl.DateTimeFormat(runtimeLocale(), { month: "long", year: "numeric" }).format(date);
}

export function normalizeCalendarDateNote(note: string, mode: CalendarMode) {
  const normalized = note.trim();
  if (!normalized || mode === "profane" || /^Профан(?:ская|ическая) дата:/iu.test(normalized)) return "";

  const heading = translateText(mode === "sacred"
    ? "Дата по сакральному календарю"
    : "Дата по лунному календарю");
  const localized = translateText(normalized, undefined, true);
  const acceptedHeadings = mode === "sacred"
    ? ["Дата по сакральному календарю", "Sacred calendar date"]
    : ["Дата по лунному календарю", "Lunar calendar date"];
  return acceptedHeadings.some((value) => localized.startsWith(`${value}:`))
    ? localized
    : `${heading}:\n${localized}`;
}

export function calendarDateNote(date: Date, mode: CalendarMode) {
  if (mode === "sacred") {
    const sacred = getSacredDate(date);
    const month = MONTHS[sacred.monthIndex];
    const day = getSacredDay(sacred.monthIndex, sacred.day);
    return normalizeCalendarDateNote([
      `День: ${day.name} (${sacred.day})`,
      `Пята: ${day.pyata || "Ω"}${day.pyataTitle ? ` — ${day.pyataTitle}` : ""}`,
      `Месяц: ${month.name} — ${month.title}`,
    ].join("\n"), mode);
  }
  if (mode === "lunar") {
    const moon = getMoon(date);
    return normalizeCalendarDateNote([
      `Лунный день: ${moon.day}`,
      `Фаза: ${moon.phase}`,
      `Луна: ${moon.epithet} · ${moon.direction}`,
    ].join("\n"), mode);
  }
  return "";
}

export function getSacredDay(monthIndex: number, day: number, language: Language = getRuntimeLanguage()) {
  const sacredDay = MONTHS[monthIndex]?.days[day - 1] ?? MONTHS[12].days[0];
  if (language === "ru") return sacredDay;
  const index = monthIndex < 12 ? (monthIndex * 30) + day - 1 : 360 + day - 1;
  const catalog = {en:ENGLISH_DAYS,el:greekDays,de:germanDays,fr:frenchDays,es:spanishDays,
    it:italianDays,pt:portugueseDays,pl:polishDays,sr:serbianDays,uk:ukrainianDays,
    zh:chineseDays,tr:turkishDays,ja:japaneseDays}[language];
  const localizedDay = catalog[index];
  return localizedDay ? { ...sacredDay, ...localizedDay } : sacredDay;
}

export function getDayElement(monthIndex: number, day: number) {
  return monthIndex === 12 ? ELEMENTS[4] : ELEMENTS[(day - 1) % 5];
}

export function getPythagorean(monthIndex: number, day: number) {
  return monthIndex === 12 ? null : PYTHAGOREAN[(day - 1) % 5];
}

export function dateKey(monthIndex: number, day: number) {
  return `${monthIndex}-${day}`;
}

const SOLAR_DEFINITIONS = [
  { id: "spring-equinox", name: "Весеннее равноденствие", shortName: "Равноденствие", kind: "equinox", symbol: "☼", seasonKey: "mar_equinox" },
  { id: "summer-solstice", name: "Летнее солнцестояние", shortName: "Солнцестояние", kind: "solstice", symbol: "✺", seasonKey: "jun_solstice" },
  { id: "autumn-equinox", name: "Осеннее равноденствие", shortName: "Равноденствие", kind: "equinox", symbol: "☉", seasonKey: "sep_equinox" },
  { id: "winter-solstice", name: "Зимнее солнцестояние", shortName: "Солнцестояние", kind: "solstice", symbol: "✹", seasonKey: "dec_solstice" },
] as const;

export function getSolarEvents(sacredYear: number): SolarEvent[] {
  const seasons = Seasons(sacredYear);
  return SOLAR_DEFINITIONS.map((definition) => {
    const date = new Date(seasons[definition.seasonKey].date);
    const sacred = getSacredDate(date);
    return {
      id: definition.id,
      name: definition.name,
      shortName: definition.shortName,
      kind: definition.kind,
      symbol: definition.symbol,
      date,
      monthIndex: sacred.monthIndex,
      day: sacred.day,
    };
  });
}

export function formatSolarEventTime(date: Date, locale = runtimeLocale()) {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

export function getSolarEvent(sacredYear: number, monthIndex: number, day: number) {
  return getSolarEvents(sacredYear).find((event) => event.monthIndex === monthIndex && event.day === day) ?? null;
}
