import { getLunarDate, getMoon, getSacredDate, isLunarFullMoon, type CalendarMode } from "./calendar-data";
import { calendarContext, isCivilDate, type CalendarContext } from "./calendar-context";

export type RecurrenceMode = "none" | "genesis" | "classic" | "lunar";
const recurrencePatterns = ["none", "daily", "weekdays", "monthly", "yearly", "pyata-days", "month-days",
  "lunar-days", "lunar-decades", "lunar-decade-days", "lunar-phases", "lunar-yearly"] as const;
export type RecurrencePattern = typeof recurrencePatterns[number];

/** The cloud reader and local reload must accept exactly the same saved patterns. */
export function isRecurrencePattern(value: unknown): value is RecurrencePattern {
  return recurrencePatterns.some(pattern => pattern === value);
}

export type RecurrenceConfig = {
  enabled: boolean;
  mode: Exclude<RecurrenceMode, "none">;
  pattern: Exclude<RecurrencePattern, "none">;
  days: number[];
  interval: number;
  rangeStart: string;
  rangeEnd: string;
  months: number[];
  pyatas: number[];
  /** Missing version is a saved legacy rule, never an implicit algorithm upgrade. */
  calendarContext?: CalendarContext;
  invalidDayPolicy?: "skip";
};

export type LunarMonthOption = {
  value: number;
  startDate: string;
  endDate: string;
};

export const MAX_RECURRENCE_OCCURRENCES = 500;

export const DEFAULT_RECURRENCE_CONFIG: RecurrenceConfig = {
  enabled: false,
  mode: "genesis",
  pattern: "pyata-days",
  days: [1],
  interval: 1,
  rangeStart: "",
  rangeEnd: "",
  months: [],
  pyatas: [],
  calendarContext: calendarContext(),
  invalidDayPolicy: "skip",
};

export const RECURRENCE_MODE_COPY = {
  genesis: {
    title: "Сакральный календарь",
    shortTitle: "Сакральный календарь",
    description: "Сакральные месяцы, пяты и дни 360-дневного круга.",
  },
  classic: {
    title: "Григорианский календарь",
    shortTitle: "Григорианский календарь",
    description: "Обычные дни, недели, месяцы и годы с синхронизацией в Google.",
  },
  lunar: {
    title: "Лунный календарь",
    shortTitle: "Лунный календарь",
    description: "Конкретные лунные месяцы и выбранные лунные дни.",
  },
} as const;

export function recurrenceModeForCalendar(calendarMode: CalendarMode): RecurrenceConfig["mode"] {
  if (calendarMode === "profane") return "classic";
  if (calendarMode === "lunar") return "lunar";
  return "genesis";
}

export function calendarModeForRecurrence(mode: RecurrenceConfig["mode"]): CalendarMode {
  if (mode === "classic") return "profane";
  if (mode === "lunar") return "lunar";
  return "sacred";
}

export function alignRecurrenceConfigWithCalendar(config: RecurrenceConfig, calendarMode: CalendarMode, startDate: string): RecurrenceConfig {
  const mode = recurrenceModeForCalendar(calendarMode);
  if (config.mode === mode) return config;
  const pattern: RecurrenceConfig["pattern"] = mode === "classic" ? "weekdays" : mode === "lunar" ? "lunar-days" : "pyata-days";
  return {
    ...config,
    mode,
    pattern,
    days: suggestedRecurrenceDays(mode, pattern, startDate, config.calendarContext ?? calendarContext({ version: 1 })),
    interval: 1,
    months: [],
    pyatas: [],
  };
}

function coversEveryTrackerDay(config: RecurrenceConfig) {
  const normalized = normalizeRecurrenceConfig(config);
  if (normalized.interval !== 1 || normalized.months.length || normalized.pyatas.length) return false;
  if (normalized.mode === "classic") {
    return normalized.pattern === "daily"
      || (normalized.pattern === "weekdays" && normalized.days.length === 7);
  }
  const expectedDays = normalized.mode === "genesis" && normalized.pattern === "pyata-days" ? 5 : 30;
  return normalized.days.length === expectedDays
    && normalized.days.every((day, index) => day === index + 1);
}

export function convertTrackerRecurrenceCalendar(config: RecurrenceConfig, calendarMode: CalendarMode, startDate: string): RecurrenceConfig {
  const everyDay = coversEveryTrackerDay(config);
  const converted = alignRecurrenceConfigWithCalendar(config, calendarMode, startDate);
  if (!everyDay || converted.mode === config.mode) return converted;
  if (converted.mode === "classic") return { ...converted, pattern: "daily", days: [1] };
  if (converted.mode === "genesis") return { ...converted, pattern: "pyata-days", days: [1, 2, 3, 4, 5] };
  return { ...converted, pattern: "lunar-days", days: Array.from({ length: 30 }, (_, index) => index + 1) };
}

const DAY_MS = 86_400_000;

function inputDate(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseInputDate(value: string) {
  if (!isCivilDate(value)) return null;
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function supportedRecurrenceDate(value: string) {
  return isCivilDate(value) && value >= "1900-01-01" && value <= "2100-12-31";
}

function shiftDate(date: Date, days: number) {
  const shifted = new Date(date);
  shifted.setDate(shifted.getDate() + days);
  return shifted;
}

function calendarDayNumber(date: Date) {
  return (date.getDay() + 6) % 7 + 1;
}

function utcDayNumber(date: Date) {
  return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS);
}

function mondayOf(date: Date) {
  return shiftDate(date, -(calendarDayNumber(date) - 1));
}

function monthDistance(from: Date, to: Date) {
  return (to.getFullYear() - from.getFullYear()) * 12 + to.getMonth() - from.getMonth();
}

function normalizeIntegerList(values: number[], minimum: number, maximum: number) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map((value) => Math.round(Number(value)))
    .filter((value) => value >= minimum && value <= maximum)))
    .sort((left, right) => left - right);
}

function recurrenceDayLimit(config: RecurrenceConfig) {
  if (config.mode === "classic") return 7;
  if (config.mode === "genesis" && config.pattern === "pyata-days") return 5;
  if (config.pattern === "lunar-decades") return 3;
  if (config.pattern === "lunar-decade-days") return 10;
  if (config.pattern === "lunar-phases") return 2;
  return 30;
}

function expectedPattern(config: RecurrenceConfig): RecurrenceConfig["pattern"] {
  if (config.mode === "classic") {
    return ["daily", "weekdays", "monthly", "yearly"].includes(config.pattern)
      ? config.pattern
      : "weekdays";
  }
  if (config.mode === "lunar") return ["lunar-days", "lunar-decades", "lunar-decade-days", "lunar-phases", "lunar-yearly"].includes(config.pattern)
    ? config.pattern : "lunar-days";
  return config.pattern === "month-days" ? "month-days" : "pyata-days";
}

export function recurrenceDefaultEndDate(startDate: string) {
  const start = parseInputDate(startDate) ?? new Date();
  const end = new Date(start);
  end.setFullYear(end.getFullYear() + 1);
  end.setDate(end.getDate() - 1);
  return inputDate(end) > "2100-12-31" ? "2100-12-31" : inputDate(end);
}

export function recurrenceMaximumEndDate(startDate: string) {
  const start = parseInputDate(startDate) ?? new Date();
  const end = new Date(start);
  end.setFullYear(end.getFullYear() + 5);
  end.setDate(end.getDate() - 1);
  return inputDate(end) > "2100-12-31" ? "2100-12-31" : inputDate(end);
}

export function normalizeRecurrenceConfig(config: RecurrenceConfig): RecurrenceConfig {
  const pattern = expectedPattern(config);
  const limit = recurrenceDayLimit({ ...config, pattern });
  const days = normalizeIntegerList(config.days, 1, limit);
  return {
    enabled: Boolean(config.enabled),
    mode: config.mode,
    pattern,
    days: days.length ? days : [1],
    interval: Math.min(99, Math.max(1, Math.round(Number(config.interval)) || 1)),
    rangeStart: parseInputDate(config.rangeStart) ? config.rangeStart : "",
    rangeEnd: parseInputDate(config.rangeEnd) ? config.rangeEnd : "",
    months: normalizeIntegerList(config.months, 1, pattern === "lunar-yearly" ? 13 : 72),
    pyatas: normalizeIntegerList(config.pyatas, 1, pattern === "lunar-decade-days" ? 3 : 6),
    calendarContext: calendarContext(config.calendarContext ?? { version: 1 }),
    invalidDayPolicy: "skip",
  };
}

function resolvedRecurrenceRange(startDate: string, config: RecurrenceConfig) {
  if (!supportedRecurrenceDate(startDate) || config.rangeStart && !supportedRecurrenceDate(config.rangeStart)) return null;
  const taskStart = parseInputDate(startDate);
  if (!taskStart) return null;
  const requestedStart = parseInputDate(config.rangeStart);
  const start = requestedStart && requestedStart > taskStart ? requestedStart : taskStart;
  const maximumEnd = parseInputDate(recurrenceMaximumEndDate(inputDate(start)))!;
  const requestedEnd = parseInputDate(config.rangeEnd) ?? parseInputDate(recurrenceDefaultEndDate(inputDate(start)))!;
  const end = requestedEnd < start ? start : requestedEnd > maximumEnd ? maximumEnd : requestedEnd;
  return { start, end };
}

export function resolveRecurrenceConfig(startDate: string, rawConfig: RecurrenceConfig) {
  const config = normalizeRecurrenceConfig(rawConfig);
  const range = resolvedRecurrenceRange(startDate, config);
  return range
    ? { ...config, rangeStart: inputDate(range.start), rangeEnd: inputDate(range.end) }
    : config;
}

export function suggestedRecurrenceDays(
  mode: RecurrenceConfig["mode"],
  pattern: RecurrenceConfig["pattern"],
  startDate: string,
  context: CalendarContext = calendarContext(),
) {
  const date = parseInputDate(startDate) ?? new Date();
  if (mode === "classic") return [calendarDayNumber(date)];
  if (mode === "lunar") {
    const lunarDay = getLunarDate(date, context).day;
    if (pattern === "lunar-decades") return [Math.floor((lunarDay - 1) / 10) + 1];
    if (pattern === "lunar-decade-days") return [((lunarDay - 1) % 10) + 1];
    if (pattern === "lunar-phases") return [1];
    return [lunarDay];
  }
  const sacred = getSacredDate(date, context);
  return [pattern === "month-days" ? Math.min(30, sacred.day) : ((sacred.day - 1) % 5) + 1];
}

export function lunarMonthOptions(startDate: string, endDate: string, context: CalendarContext = calendarContext()): LunarMonthOption[] {
  if (!supportedRecurrenceDate(startDate)) return [];
  const start = parseInputDate(startDate);
  const end = parseInputDate(endDate > "2100-12-31" ? "2100-12-31" : endDate);
  if (!start || !end || end < start) return [];

  const options: LunarMonthOption[] = [];
  let value = 1;
  let monthStart = new Date(start);
  let previousDay = getMoon(start, context).day;

  for (let cursor = shiftDate(start, 1); cursor <= end; cursor = shiftDate(cursor, 1)) {
    const lunarDay = getMoon(cursor, context).day;
    if (lunarDay < previousDay) {
      options.push({
        value,
        startDate: inputDate(monthStart),
        endDate: inputDate(shiftDate(cursor, -1)),
      });
      value += 1;
      monthStart = new Date(cursor);
    }
    previousDay = lunarDay;
  }

  options.push({ value, startDate: inputDate(monthStart), endDate: inputDate(end) });
  return options;
}

export function recurrenceMatchesDate(
  startDate: string,
  rawConfig: RecurrenceConfig,
  dateValue: string,
  options: { ignoreRangeEnd?: boolean } = {},
) {
  const taskStart = parseInputDate(startDate);
  const candidate = parseInputDate(dateValue);
  if (!taskStart || !candidate) return false;
  const config = normalizeRecurrenceConfig(rawConfig);
  if (!config.enabled) return dateValue === startDate;
  if (!supportedRecurrenceDate(startDate) || !supportedRecurrenceDate(dateValue) || config.rangeStart && !supportedRecurrenceDate(config.rangeStart)) return false;

  const requestedStart = parseInputDate(config.rangeStart);
  const anchor = requestedStart && requestedStart > taskStart ? requestedStart : taskStart;
  const requestedEnd = parseInputDate(config.rangeEnd);
  if (candidate < anchor || (!options.ignoreRangeEnd && requestedEnd && candidate > requestedEnd)) return false;

  const selectedDays = new Set(config.days);
  const selectedMonths = new Set(config.months);
  const selectedPyatas = new Set(config.pyatas);

  if (config.mode === "classic") {
    if (config.pattern === "daily") {
      return (utcDayNumber(candidate) - utcDayNumber(anchor)) % config.interval === 0;
    }
    if (config.pattern === "weekdays") {
      const weekIndex = Math.floor((utcDayNumber(mondayOf(candidate)) - utcDayNumber(mondayOf(anchor))) / 7);
      return weekIndex >= 0 && weekIndex % config.interval === 0 && selectedDays.has(calendarDayNumber(candidate));
    }
    if (config.pattern === "monthly") {
      const monthsFromStart = monthDistance(anchor, candidate);
      return monthsFromStart >= 0 && monthsFromStart % config.interval === 0 && candidate.getDate() === taskStart.getDate();
    }
    const yearsFromStart = candidate.getFullYear() - anchor.getFullYear();
    return yearsFromStart >= 0
      && yearsFromStart % config.interval === 0
      && candidate.getMonth() === taskStart.getMonth()
      && candidate.getDate() === taskStart.getDate();
  }

  if (config.mode === "genesis") {
    const sacred = getSacredDate(candidate, config.calendarContext);
    if (sacred.monthIndex >= 12 || (selectedMonths.size && !selectedMonths.has(sacred.monthIndex + 1))) return false;
    if (config.pattern === "pyata-days") {
      const pyata = Math.floor((sacred.day - 1) / 5) + 1;
      return (!selectedPyatas.size || selectedPyatas.has(pyata)) && selectedDays.has(((sacred.day - 1) % 5) + 1);
    }
    return selectedDays.has(sacred.day);
  }

  const lunar = getLunarDate(candidate, config.calendarContext);
  const lunarDay = lunar.day;
  const matchesDay = config.pattern === "lunar-decades" ? selectedDays.has(Math.floor((lunarDay - 1) / 10) + 1)
    : config.pattern === "lunar-decade-days" ? (!selectedPyatas.size || selectedPyatas.has(Math.floor((lunarDay - 1) / 10) + 1)) && selectedDays.has(((lunarDay - 1) % 10) + 1)
    : config.pattern === "lunar-phases" ? (selectedDays.has(1) && lunarDay === 1) || (selectedDays.has(2) && isLunarFullMoon(candidate, config.calendarContext))
    : selectedDays.has(lunarDay);
  if (!matchesDay) return false;
  if (config.pattern === "lunar-yearly") return selectedMonths.has(lunar.monthOrdinal);
  if (!selectedMonths.size) return true;
  let lunarMonth = 1;
  let previousDay = getMoon(anchor, config.calendarContext).day;
  for (let cursor = shiftDate(anchor, 1); cursor <= candidate; cursor = shiftDate(cursor, 1)) {
    const day = getMoon(cursor, config.calendarContext).day;
    if (day < previousDay) lunarMonth += 1;
    previousDay = day;
  }
  return selectedMonths.has(lunarMonth);
}

export function buildRecurrenceDates(startDate: string, rawConfig: RecurrenceConfig) {
  const config = resolveRecurrenceConfig(startDate, rawConfig);
  const range = resolvedRecurrenceRange(startDate, config);
  if (!range) return [];
  if (!config.enabled) return [startDate];

  const selectedDays = new Set(config.days);
  const selectedMonths = new Set(config.months);
  const selectedPyatas = new Set(config.pyatas);
  const dates: string[] = [];
  const firstWeekMonday = mondayOf(range.start);
  const templateDate = parseInputDate(startDate) ?? range.start;
  let lunarMonth = 1;
  let previousLunarDay = getMoon(range.start, config.calendarContext).day;

  for (let cursor = new Date(range.start); cursor <= range.end; cursor = shiftDate(cursor, 1)) {
    let matches = false;

    if (config.mode === "classic") {
      if (config.pattern === "daily") {
        const dayOffset = utcDayNumber(cursor) - utcDayNumber(range.start);
        matches = dayOffset % config.interval === 0;
      } else if (config.pattern === "weekdays") {
        const weekIndex = Math.floor((utcDayNumber(mondayOf(cursor)) - utcDayNumber(firstWeekMonday)) / 7);
        matches = weekIndex % config.interval === 0 && selectedDays.has(calendarDayNumber(cursor));
      } else if (config.pattern === "monthly") {
        const monthsFromStart = monthDistance(range.start, cursor);
        matches = monthsFromStart % config.interval === 0 && cursor.getDate() === templateDate.getDate();
      } else {
        const yearsFromStart = cursor.getFullYear() - range.start.getFullYear();
        matches = yearsFromStart % config.interval === 0
          && cursor.getMonth() === templateDate.getMonth()
          && cursor.getDate() === templateDate.getDate();
      }
    } else if (config.mode === "lunar") {
      const lunarDay = getMoon(cursor, config.calendarContext).day;
      if (cursor > range.start && lunarDay < previousLunarDay) lunarMonth += 1;
      previousLunarDay = lunarDay;
      const lunar = getLunarDate(cursor, config.calendarContext);
      const matchesDay = config.pattern === "lunar-decades" ? selectedDays.has(Math.floor((lunar.day - 1) / 10) + 1)
        : config.pattern === "lunar-decade-days" ? (!selectedPyatas.size || selectedPyatas.has(Math.floor((lunar.day - 1) / 10) + 1)) && selectedDays.has(((lunar.day - 1) % 10) + 1)
        : config.pattern === "lunar-phases" ? (selectedDays.has(1) && lunar.day === 1) || (selectedDays.has(2) && isLunarFullMoon(cursor, config.calendarContext))
        : selectedDays.has(lunar.day);
      matches = matchesDay && (config.pattern === "lunar-yearly"
        ? selectedMonths.has(lunar.monthOrdinal) : selectedMonths.size === 0 || selectedMonths.has(lunarMonth));
    } else {
      const sacred = getSacredDate(cursor, config.calendarContext);
      if (sacred.monthIndex < 12 && (selectedMonths.size === 0 || selectedMonths.has(sacred.monthIndex + 1))) {
        if (config.pattern === "pyata-days") {
          const pyata = Math.floor((sacred.day - 1) / 5) + 1;
          matches = (selectedPyatas.size === 0 || selectedPyatas.has(pyata))
            && selectedDays.has(((sacred.day - 1) % 5) + 1);
        } else {
          matches = selectedDays.has(sacred.day);
        }
      }
    }

    if (matches) dates.push(inputDate(cursor));
  }

  return dates;
}

export function recurrenceConfigFromTask(task: {
  recurrence?: string;
  recurrenceMode?: RecurrenceMode;
  recurrencePattern?: RecurrencePattern;
  recurrenceDays?: number[];
  recurrenceInterval?: number;
  recurrenceStartDate?: string | null;
  recurrenceEndDate?: string | null;
  recurrenceMonths?: number[];
  recurrencePyatas?: number[];
  recurrenceContext?: CalendarContext;
  recurrenceInvalidDayPolicy?: "skip";
}): RecurrenceConfig {
  const mode = ["genesis", "classic", "lunar"].includes(task.recurrenceMode ?? "")
    ? task.recurrenceMode as RecurrenceConfig["mode"]
    : task.recurrence && task.recurrence !== "none" ? "classic" : "genesis";
  const legacyClassicPattern = task.recurrence === "daily"
    ? "daily"
    : task.recurrence === "monthly"
      ? "monthly"
      : task.recurrence === "yearly" ? "yearly" : "weekdays";
  const defaultPattern = mode === "classic" ? legacyClassicPattern : mode === "lunar" ? "lunar-days" : "pyata-days";
  return normalizeRecurrenceConfig({
    enabled: (task.recurrenceMode !== undefined && task.recurrenceMode !== "none") || Boolean(task.recurrence && task.recurrence !== "none"),
    mode,
    calendarContext: task.recurrenceContext ?? calendarContext({ version: 1 }),
    invalidDayPolicy: task.recurrenceInvalidDayPolicy ?? "skip",
    pattern: task.recurrencePattern && task.recurrencePattern !== "none" ? task.recurrencePattern : defaultPattern,
    days: Array.isArray(task.recurrenceDays) ? task.recurrenceDays : [1],
    interval: task.recurrenceInterval ?? 1,
    rangeStart: task.recurrenceStartDate ?? "",
    rangeEnd: task.recurrenceEndDate ?? "",
    months: Array.isArray(task.recurrenceMonths) ? task.recurrenceMonths : [],
    pyatas: Array.isArray(task.recurrencePyatas) ? task.recurrencePyatas : [],
  });
}

export function recurrenceDatesForTask(task: {
  dueDate: string;
  googleTaskListId?: string | null;
  recurrenceSeriesId?: string | null;
  recurrence?: string;
  recurrenceMode?: RecurrenceMode;
  recurrencePattern?: RecurrencePattern;
  recurrenceDays?: number[];
  recurrenceInterval?: number;
  recurrenceStartDate?: string | null;
  recurrenceEndDate?: string | null;
  recurrenceMonths?: number[];
  recurrencePyatas?: number[];
  recurrenceContext?: CalendarContext;
  recurrenceInvalidDayPolicy?: "skip";
  recurrenceExcludedDates?: string[];
}) {
  if (!parseInputDate(task.dueDate)) return [];
  if (task.googleTaskListId || task.recurrenceSeriesId) return [task.dueDate];
  const config = recurrenceConfigFromTask(task);
  if (!config.enabled) return [task.dueDate];
  const excludedDates = new Set(Array.isArray(task.recurrenceExcludedDates) ? task.recurrenceExcludedDates : []);
  const dates = buildRecurrenceDates(task.dueDate, config).filter((date) => !excludedDates.has(date));
  return dates.length ? dates : excludedDates.has(task.dueDate) ? [] : [task.dueDate];
}
