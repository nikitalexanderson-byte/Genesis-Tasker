import { addCivilDays, calendarContext, civilDayNumber, isCivilDate, type CalendarContext } from "./calendar-context.ts";
import { calendarPeriod, sacredDateParts } from "./calendar-astronomy.ts";

export type HabitPeriodGoal = {
  version: 1;
  period: "week" | "month";
  metric: "days" | "entries" | "sum";
  /** days/entries are whole counts; sums use the measurement's integer thousandths. */
  target: number;
  calendar: "profane" | "sacred" | "lunar";
  context: CalendarContext;
};

export function normalizeHabitPeriodGoal(input: unknown): HabitPeriodGoal | null {
  if (input == null) return null;
  if (!input || typeof input !== "object") throw new RangeError("INVALID_HABIT_PERIOD_GOAL");
  const value = input as Partial<HabitPeriodGoal>;
  if (value.version !== 1 || !["week", "month"].includes(value.period ?? "")
    || !["days", "entries", "sum"].includes(value.metric ?? "")
    || !["profane", "sacred", "lunar"].includes(value.calendar ?? "")
    || !Number.isSafeInteger(value.target) || value.target! < 1
    || value.target! > (value.metric === "sum" ? 1_000_000_000_000 : value.metric === "days" ? 31 : 1_000_000)
    || !value.context || ![1, 2].includes(value.context.version)
    || typeof value.context.timeZone !== "string"
    || !["january", "march"].includes(value.context.gregorianYearStart))
    throw new RangeError("INVALID_HABIT_PERIOD_GOAL");
  return { version: 1, period: value.period!, metric: value.metric!, target: value.target!,
    calendar: value.calendar!, context: calendarContext(value.context) };
}

/** Half-open periods. Sacred weeks follow five-day pyatas; Apeiron is a separate short period. */
export function habitGoalPeriod(goal: HabitPeriodGoal, date: string) {
  if (!isCivilDate(date)) throw new RangeError("INVALID_CALENDAR_DATE");
  if (goal.period === "month") return calendarPeriod(date, goal.calendar, "month", goal.context);
  if (goal.calendar === "sacred") {
    const month = calendarPeriod(date, "sacred", "month", goal.context);
    const sacred = sacredDateParts(date, goal.context);
    if (sacred.monthIndex === 12) return month;
    const start = addCivilDays(date, -((sacred.day - 1) % 5));
    return { start, end: addCivilDays(start, 5) };
  }
  // The lunar grid uses the same Monday–Sunday week as the civil calendar.
  const weekday = (civilDayNumber(date) + 3) % 7;
  const start = addCivilDays(date, -((weekday + 7) % 7));
  return { start, end: addCivilDays(start, 7) };
}
