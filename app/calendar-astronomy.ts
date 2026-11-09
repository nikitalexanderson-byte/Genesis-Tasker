import { SearchMoonPhase, Seasons } from "astronomy-engine";
import {
  addCivilDays, calendarContext, calendarContextKey, civilDayNumber, momentCivilDate,
  ASTRONOMY_FIRST_YEAR, ASTRONOMY_LAST_YEAR, CIVIL_DAY_MS, type CalendarContext,
} from "./calendar-context.ts";

export const MOON_CYCLE_DAYS = 29.53058867;
export const MOON_REFERENCE_MOMENT = Date.UTC(2000, 0, 6, 18, 14);
const newMoons = new Map<number, number>();
const equinoxes = new Map<number, number>();
const lunarYears = new Map<string, ReturnType<typeof calculateLunarYear>>();

/** Boundary years surround the documented 1900–2100 civil-date range. */
function boundaryYear(year: number) {
  if (!Number.isInteger(year) || year < ASTRONOMY_FIRST_YEAR - 2 || year > ASTRONOMY_LAST_YEAR + 2) throw new RangeError("CALENDAR_OUTSIDE_EPHEMERIS");
}

export function springEquinoxMoment(year: number) {
  boundaryYear(year);
  if (!equinoxes.has(year)) equinoxes.set(year, Seasons(year).mar_equinox.date.getTime());
  return new Date(equinoxes.get(year)!);
}

export function sacredYearStartDate(year: number, context: CalendarContext = calendarContext()) {
  boundaryYear(year);
  return context.version === 1 ? `${year}-03-20` : momentCivilDate(springEquinoxMoment(year), context.timeZone);
}

export function sacredDateParts(date: string, context: CalendarContext = calendarContext()) {
  const dayNumber = civilDayNumber(date);
  const civilYear = Number(date.slice(0, 4));
  const sacredYear = date >= sacredYearStartDate(civilYear, context) ? civilYear : civilYear - 1;
  const start = civilDayNumber(sacredYearStartDate(sacredYear, context));
  const daysInYear = civilDayNumber(sacredYearStartDate(sacredYear + 1, context)) - start;
  const dayOfYear = dayNumber - start;
  return { sacredYear, monthIndex: dayOfYear < 360 ? Math.floor(dayOfYear / 30) : 12,
    day: dayOfYear < 360 ? dayOfYear % 30 + 1 : dayOfYear - 359,
    dayOfYear, daysInYear, apeironDays: daysInYear - 360 };
}

export function sacredToCivilDate(year: number, month: number, day: number, context: CalendarContext = calendarContext()) {
  const start = sacredYearStartDate(year, context);
  const length = month === 12 ? civilDayNumber(sacredYearStartDate(year + 1, context)) - civilDayNumber(start) - 360 : 30;
  if (!Number.isInteger(month) || month < 0 || month > 12 || !Number.isInteger(day) || day < 1 || day > length) throw new RangeError("INVALID_SACRED_DAY");
  return addCivilDays(start, month * 30 + day - 1);
}

export function newMoonMoment(index: number) {
  if (!Number.isInteger(index)) throw new RangeError("INVALID_LUNAR_MONTH");
  if (!newMoons.has(index)) {
    const approximate = MOON_REFERENCE_MOMENT + index * MOON_CYCLE_DAYS * CIVIL_DAY_MS;
    boundaryYear(new Date(approximate).getUTCFullYear());
    const found = SearchMoonPhase(0, new Date(approximate - 2.5 * CIVIL_DAY_MS), 5);
    if (!found) throw new RangeError("LUNAR_MONTH_UNAVAILABLE");
    newMoons.set(index, found.date.getTime());
  }
  return new Date(newMoons.get(index)!);
}

export function lunarMonthStartDate(index: number, context: CalendarContext = calendarContext()) {
  return momentCivilDate(newMoonMoment(index), context.timeZone);
}

/** Compare instants first: an earlier moon on the equinox's local day is excluded. */
export function firstLunarMonthAfterSpringEquinox(year: number) {
  const spring = springEquinoxMoment(year);
  const first = SearchMoonPhase(0, new Date(spring.getTime() + 1), 40);
  if (!first || first.date.getTime() <= spring.getTime()) throw new RangeError("LUNAR_YEAR_UNAVAILABLE");
  return Math.round((first.date.getTime() - MOON_REFERENCE_MOMENT) / (MOON_CYCLE_DAYS * CIVIL_DAY_MS));
}

function calculateLunarYear(year: number, context: CalendarContext) {
  const startMonthIndex = firstLunarMonthAfterSpringEquinox(year);
  const endMonthIndex = firstLunarMonthAfterSpringEquinox(year + 1);
  return { sacredYear: year, startMonthIndex, endMonthIndex, monthCount: endMonthIndex - startMonthIndex,
    start: lunarMonthStartDate(startMonthIndex, context), end: lunarMonthStartDate(endMonthIndex, context) };
}

export function lunarYearPeriod(year: number, context: CalendarContext = calendarContext()) {
  const key = `${calendarContextKey(context)}:${year}`;
  if (!lunarYears.has(key)) lunarYears.set(key, calculateLunarYear(year, context));
  return { ...lunarYears.get(key)! };
}

export function lunarMonthForDate(date: string, context: CalendarContext = calendarContext()) {
  const day = civilDayNumber(date);
  let index = Math.floor((day * CIVIL_DAY_MS - MOON_REFERENCE_MOMENT) / (MOON_CYCLE_DAYS * CIVIL_DAY_MS));
  while (date < lunarMonthStartDate(index, context)) index--;
  while (date >= lunarMonthStartDate(index + 1, context)) index++;
  return index;
}

export function lunarDateParts(date: string, context: CalendarContext = calendarContext()) {
  const yearNumber = Number(date.slice(0, 4));
  const candidate = lunarYearPeriod(yearNumber, context);
  const year = date >= candidate.start ? candidate : lunarYearPeriod(yearNumber - 1, context);
  const monthIndex = lunarMonthForDate(date, context);
  const start = civilDayNumber(lunarMonthStartDate(monthIndex, context));
  return { year, monthIndex, monthOrdinal: monthIndex - year.startMonthIndex + 1,
    day: civilDayNumber(date) - start + 1, monthLength: civilDayNumber(lunarMonthStartDate(monthIndex + 1, context)) - start };
}

export type CalendarPeriod = { start: string; end: string };
type PeriodCalendar = "profane" | "sacred" | "lunar";

/** All internal periods are half-open. Adapters alone expose legacy inclusive ends. */
export function calendarPeriod(date: string, mode: PeriodCalendar, unit: "month" | "quarter" | "year", context: CalendarContext = calendarContext()): CalendarPeriod {
  civilDayNumber(date);
  if (mode === "sacred") {
    const sacred = sacredDateParts(date, context);
    if (unit === "year") return { start: sacredYearStartDate(sacred.sacredYear, context), end: sacredYearStartDate(sacred.sacredYear + 1, context) };
    // Keep the existing product's 3-month groups and separate Apeiron period.
    const first = unit === "quarter" ? Math.floor(sacred.monthIndex / 3) * 3 : sacred.monthIndex;
    const next = first + (unit === "quarter" ? 3 : 1);
    return { start: sacredToCivilDate(sacred.sacredYear, first, 1, context), end: next < 13 ? sacredToCivilDate(sacred.sacredYear, next, 1, context) : sacredYearStartDate(sacred.sacredYear + 1, context) };
  }
  if (mode === "lunar") {
    const lunar = lunarDateParts(date, context);
    if (unit === "year") return { start: lunar.year.start, end: lunar.year.end };
    const first = unit === "quarter" ? lunar.year.startMonthIndex + Math.floor((lunar.monthOrdinal - 1) / 3) * 3 : lunar.monthIndex;
    const next = Math.min(first + (unit === "quarter" ? 3 : 1), lunar.year.endMonthIndex);
    return { start: lunarMonthStartDate(first, context), end: lunarMonthStartDate(next, context) };
  }
  const year = Number(date.slice(0, 4)), month = Number(date.slice(5, 7)) - 1;
  const startMonth = context.gregorianYearStart === "march" ? 2 : 0;
  const yearStart = year - (month < startMonth ? 1 : 0);
  const relativeMonth = (month - startMonth + 12) % 12;
  const first = unit === "year" ? 0 : unit === "quarter" ? Math.floor(relativeMonth / 3) * 3 : relativeMonth;
  const value = (offset: number) => `${yearStart + Math.floor((startMonth + offset) / 12)}-${String((startMonth + offset) % 12 + 1).padStart(2, "0")}-01`;
  return { start: value(first), end: value(first + (unit === "year" ? 12 : unit === "quarter" ? 3 : 1)) };
}
