import { calendarMonthRange, formatCalendarMonthValue, getSacredDate, getSacredDay, MONTHS, type CalendarMode } from "./calendar-data";
import { translateText } from "./i18n";
import type { SharedTask } from "./cloud-sync";
import { dateSerial, ganttRange, serialDate, taskSpan, type GanttScale } from "./shared-gantt";

export type GanttPeriod = { start: number; end: number; label: string };

/** Compact display only; dates and scheduling keep their existing calendar rules. */
export function sacredGanttDate(key: string) {
  const sacred = getSacredDate(new Date(`${key}T12:00:00`));
  const month = MONTHS[sacred.monthIndex];
  const day = getSacredDay(sacred.monthIndex, sacred.day);
  const roman = ["I", "II", "III", "IIII", "V"][(sacred.day - 1) % 5];
  const name = translateText(month.name);
  const monthName = name.charAt(0) + name.slice(1).toLocaleLowerCase();
  // Apeiron days are outside the five-day cycles.
  return day.pyata ? `${roman}/${day.pyata}/${month.roman} (${monthName})` : `${sacred.day}/Ω/${month.roman} (${monthName})`;
}

function monthAt(day: number, mode: CalendarMode): GanttPeriod {
  const key = serialDate(day);
  const month = calendarMonthRange(key, mode);
  return { start: dateSerial(month.start), end: dateSerial(month.end) + 1, label: formatCalendarMonthValue(key, mode) };
}

function advanceMonth(day: number, count: number, mode: CalendarMode) {
  let month = monthAt(day, mode);
  for (let index = 0; index < Math.abs(count); index++) month = monthAt(count > 0 ? month.end : month.start - 1, mode);
  return month.start;
}

function initialCalendarGanttRange(anchor: string, scale: GanttScale, tasks: SharedTask[], mode: CalendarMode, fit = false, bounds?: {first: string | null; last: string | null}) {
  if (scale === "day" || fit && (bounds?.first || tasks.some(task => taskSpan(task)))) return ganttRange(anchor, scale, tasks, fit, bounds);
  const day = dateSerial(anchor);
  if (scale === "months") {
    const start = monthAt(day, mode).start;
    return { start, end: advanceMonth(start, 6, mode) };
  }
  if (mode === "profane") return ganttRange(anchor, scale, tasks);
  const month = monthAt(day, mode);
  if (scale === "weeks") return { start: month.start, end: month.end };
  const unit = mode === "sacred" ? 5 : 10;
  const start = month.start + Math.floor((day - month.start) / unit) * unit;
  return { start, end: start + 14 };
}

/** Keep the cell scale unchanged and reveal more periods when the workspace grows. */
export function calendarGanttRange(anchor: string, scale: GanttScale, tasks: SharedTask[], mode: CalendarMode, fit = false, minimumPeriods = 0, bounds?: {first: string | null; last: string | null}) {
  const range = initialCalendarGanttRange(anchor, scale, tasks, mode, fit, bounds);
  if (scale === "day") return range;
  const count = Math.max(0, Math.min(100, Math.ceil(minimumPeriods)));
  let periods = calendarGanttPeriods(range, scale, mode);
  if (periods.length >= count) return range;
  if (scale === "days" || scale === "weeks" && mode === "profane") {
    range.end += (count - periods.length) * (scale === "weeks" ? 7 : 1);
    return range;
  }
  while (periods.length < count) {
    range.end = monthAt(range.end, mode).end;
    periods = calendarGanttPeriods(range, scale, mode);
  }
  return { start: range.start, end: periods[count - 1].end };
}

export function shiftGanttAnchor(anchor: string, scale: GanttScale, mode: CalendarMode, direction: number) {
  const day = dateSerial(anchor);
  if (scale === "months" || scale === "weeks" && mode !== "profane") {
    return serialDate(advanceMonth(day, direction * (scale === "months" ? 6 : 1), mode));
  }
  return serialDate(day + direction * (scale === "day" ? 1 : scale === "days" ? 14 : 56));
}

/** Periods restart at each calendar month, including the short Apeiron and lunar month end. */
export function calendarGanttPeriods(range: { start: number; end: number }, scale: GanttScale, mode: CalendarMode) {
  const months: GanttPeriod[] = [];
  for (let cursor = range.start; cursor < range.end;) {
    const month = monthAt(cursor, mode);
    months.push(month);
    cursor = month.end;
  }
  if (scale === "months") return months;
  const periods: GanttPeriod[] = [];
  if (scale === "day" || scale === "days" || mode === "profane") {
    const unit = scale === "day" ? 1 / 24 : scale === "weeks" ? 7 : 1;
    const first = scale === "weeks" ? range.start - (new Date(range.start * 86400000).getUTCDay() + 6) % 7 : range.start;
    for (let index=0; first+index*unit < range.end-1e-7; index++) {
      const start=first+index*unit;
      periods.push({ start, end: start + unit, label: "" });
    }
  } else {
    const unit = mode === "sacred" ? 5 : 10;
    for (const month of months) {
      const apeiron = mode === "sacred" && getSacredDate(new Date(`${serialDate(month.start)}T12:00:00`)).monthIndex === 12;
      for (let start = month.start; start < month.end; start += apeiron ? month.end - month.start : unit) {
        const end = Math.min(month.end, start + (apeiron ? month.end - month.start : unit));
        periods.push({ start, end, label: `${start - month.start + 1}–${end - month.start}` });
      }
    }
  }
  return periods.filter(period => period.end > range.start && period.start < range.end);
}

export function calendarGanttMonths(range: { start: number; end: number }, mode: CalendarMode) {
  return calendarGanttPeriods(range, "months", mode);
}
