import { calendarPeriod } from "./calendar-astronomy.ts";
import { addCivilDays, calendarContext, civilDateCarrier, type CalendarContext } from "./calendar-context.ts";
import type { CalendarMode } from "./calendar-data";
import type { CalendarScale } from "./calendar-scale.ts";
export type { CalendarScale } from "./calendar-scale.ts";

export const calendarDateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export function sharedCalendarPeriod(anchor: Date, mode: CalendarMode, context: CalendarContext = calendarContext()) {
  const period = calendarPeriod(calendarDateKey(anchor), mode, "month", context), dates: Date[] = [];
  for (let value = period.start; value < period.end; value = addCivilDays(value, 1)) dates.push(civilDateCarrier(value));
  const priorDay = addCivilDays(period.start, -1);
  const previous = civilDateCarrier(mode === "sacred" ? priorDay : calendarPeriod(priorDay, mode, "month", context).start);
  return { dates, previous, next: civilDateCarrier(period.end) };
}

/** Rendering and all task/count requests use the same contiguous period window. */
export function sharedCalendarWindow(anchor: Date, mode: CalendarMode, scale: CalendarScale, context: CalendarContext = calendarContext()) {
  const periods = [sharedCalendarPeriod(anchor, mode, context)];
  if (scale === 0.25) for (let index = 1; index < 3; index++) periods.push(sharedCalendarPeriod(periods[index - 1].next, mode, context));
  return { periods, from: calendarDateKey(periods[0].dates[0]), to: calendarDateKey(periods.at(-1)!.dates.at(-1)!) };
}
