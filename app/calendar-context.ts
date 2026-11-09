/** Shared wire contract. Date-only values are ISO civil dates, never UTC instants. */
export type CalendarContext = {
  version: 1 | 2;
  timeZone: string;
  gregorianYearStart: "january" | "march";
};

export const CALENDAR_ALGORITHM_VERSION = 2;
export const ASTRONOMY_FIRST_YEAR = 1900;
export const ASTRONOMY_LAST_YEAR = 2100;
export const CIVIL_DAY_MS = 86_400_000;

export function deviceTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** IANA zones supported by the runtime, plus UTC; no locale-dependent abbreviations. */
const canonicalZones = new Map<string, string>();
export function calendarTimeZone(value: string) {
  // Android's default UTC device zone may be serialized with this unambiguous alias.
  if (value === "GMT") value = "UTC";
  if (value !== "UTC" && !/^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)+$/.test(value)) throw new RangeError("INVALID_CALENDAR_TIME_ZONE");
  if (!canonicalZones.has(value)) canonicalZones.set(value, new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions().timeZone);
  return canonicalZones.get(value)!;
}

export function calendarContext(value: Partial<CalendarContext> = {}): CalendarContext {
  if (value.version !== undefined && value.version !== 1 && value.version !== 2) throw new RangeError("UNKNOWN_CALENDAR_VERSION");
  if (value.gregorianYearStart !== undefined && value.gregorianYearStart !== "january" && value.gregorianYearStart !== "march") throw new RangeError("INVALID_CALENDAR_YEAR_START");
  return {
    version: value.version ?? CALENDAR_ALGORITHM_VERSION,
    timeZone: calendarTimeZone(value.timeZone ?? deviceTimeZone()),
    gregorianYearStart: value.gregorianYearStart === "march" ? "march" : "january",
  };
}

export function calendarContextKey(context: CalendarContext) {
  return `${context.version}:${context.timeZone}:${context.gregorianYearStart}`;
}

export function isCivilDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function civilDayNumber(value: string) {
  if (!isCivilDate(value)) throw new RangeError("INVALID_CALENDAR_DATE");
  return Math.floor(new Date(`${value}T12:00:00Z`).getTime() / CIVIL_DAY_MS);
}

export function addCivilDays(value: string, amount: number) {
  if (!Number.isSafeInteger(amount)) throw new RangeError("INVALID_CALENDAR_OFFSET");
  return new Date((civilDayNumber(value) + amount) * CIVIL_DAY_MS).toISOString().slice(0, 10);
}

/** Date is only a carrier for the existing UI's local date fields. */
export function civilDateCarrier(value: string, hour = 12) {
  if (!isCivilDate(value)) throw new RangeError("INVALID_CALENDAR_DATE");
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(hour, 0, 0, 0);
  return date;
}

const zoneFormatters = new Map<string, Intl.DateTimeFormat>();
function wallParts(moment: Date, timeZone: string) {
  let formatter = zoneFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA-u-ca-gregory-nu-latn", {
      timeZone: calendarTimeZone(timeZone), year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    });
    zoneFormatters.set(timeZone, formatter);
  }
  return Object.fromEntries(formatter.formatToParts(moment).map(part => [part.type, part.value]));
}

/** The whole civil day containing the event belongs to the new calendar period. */
export function momentCivilDate(moment: Date, timeZone = deviceTimeZone()) {
  const parts = wallParts(moment, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function todayCivilDate(context: CalendarContext = calendarContext(), now = new Date()) {
  return momentCivilDate(now, context.timeZone);
}

/**
 * Local-wall scheduling, compatible with java.time: first instant of an overlap;
 * move a missing wall time forward by the gap. A scheduled date/time has one ID.
 * Elapsed timers add milliseconds to the returned instant instead.
 */
export function resolveCalendarWallTime(date: string, time: string, timeZone: string) {
  if (!isCivilDate(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new RangeError("INVALID_CALENDAR_DATE_TIME");
  const target = new Date(`${date}T${time}:00Z`).getTime();
  const offsets = new Set<number>();
  for (const hours of [-36, -12, 0, 12, 36]) {
    const sample = new Date(target + hours * 3_600_000);
    const parts = wallParts(sample, timeZone);
    offsets.add(new Date(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`).getTime() - sample.getTime());
  }
  const expected = `${date}T${time}:00`;
  const candidates = [...offsets].map(offset => {
    const instant = target - offset;
    const parts = wallParts(new Date(instant), timeZone);
    return { instant, wall: `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}` };
  });
  const exact = candidates.filter(candidate => candidate.wall === expected).sort((a, b) => a.instant - b.instant);
  if (exact.length) return { instant: new Date(exact[0].instant), adjustment: exact.length > 1 ? "overlap-earlier" as const : "exact" as const };
  const shifted = candidates.filter(candidate => candidate.wall > expected).sort((a, b) => a.wall.localeCompare(b.wall));
  if (!shifted.length) throw new RangeError("UNRESOLVED_CALENDAR_DATE_TIME");
  return { instant: new Date(shifted[0].instant), adjustment: "gap-forward" as const };
}
