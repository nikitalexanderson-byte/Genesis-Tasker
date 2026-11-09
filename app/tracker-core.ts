import type { CalendarMode } from "./calendar-data";
import { calendarContext } from "./calendar-context";
import {
  normalizeRecurrenceConfig,
  recurrenceMatchesDate,
  recurrenceModeForCalendar,
  suggestedRecurrenceDays,
  type RecurrenceConfig,
} from "./task-recurrence";

export type TrackerSyncState = "local" | "pending" | "synced";

export type TrackerEntity = {
  id: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  syncState: TrackerSyncState;
};

export type TrackerSchedule = {
  startDate: string;
  endDate: string | null;
  timezone: string;
  recurrence: RecurrenceConfig;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function trackerId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
export function trackerTimestamp() {
  return new Date().toISOString();
}

export function trackerTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function newTrackerEntity(prefix: string): TrackerEntity {
  const now = trackerTimestamp();
  return { id: trackerId(prefix), createdAt: now, updatedAt: now, version: 1, syncState: "local" };
}

export function normalizeTrackerEntity(
  value: Partial<TrackerEntity> | null | undefined,
  prefix: string,
): TrackerEntity {
  const fallback = newTrackerEntity(prefix);
  return {
    id: typeof value?.id === "string" && value.id ? value.id : fallback.id,
    createdAt: typeof value?.createdAt === "string" && value.createdAt ? value.createdAt : fallback.createdAt,
    updatedAt: typeof value?.updatedAt === "string" && value.updatedAt ? value.updatedAt : fallback.updatedAt,
    version: Math.max(1, Math.round(Number(value?.version) || 1)),
    syncState: ["local", "pending", "synced"].includes(value?.syncState ?? "")
      ? value!.syncState as TrackerSyncState
      : "local",
  };
}

export function defaultTrackerRecurrence(date: string, calendarMode: CalendarMode): RecurrenceConfig {
  const mode = recurrenceModeForCalendar(calendarMode);
  const pattern = mode === "classic" ? "daily" : mode === "lunar" ? "lunar-days" : "pyata-days";
  return {
    enabled: true,
    mode,
    pattern,
    days: suggestedRecurrenceDays(mode, pattern, date),
    interval: 1,
    rangeStart: date,
    rangeEnd: "",
    months: [],
    pyatas: [],
    calendarContext: calendarContext(),
    invalidDayPolicy: "skip",
  };
}

export function defaultTrackerSchedule(date: string, calendarMode: CalendarMode): TrackerSchedule {
  return {
    startDate: date,
    endDate: null,
    timezone: trackerTimeZone(),
    recurrence: defaultTrackerRecurrence(date, calendarMode),
  };
}

export function normalizeTrackerSchedule(
  value: Partial<TrackerSchedule> | null | undefined,
  fallbackDate: string,
  calendarMode: CalendarMode,
): TrackerSchedule {
  const startDate = DATE_PATTERN.test(value?.startDate ?? "") ? value!.startDate! : fallbackDate;
  const endDate = DATE_PATTERN.test(value?.endDate ?? "") && value!.endDate! >= startDate ? value!.endDate! : null;
  const fallback = defaultTrackerRecurrence(startDate, calendarMode);
  // A saved tracker schedule owns its calendar mode. Re-aligning it with the
  // account's temporarily loaded mode used to replace saved weekdays with the
  // start day's value (commonly Friday) during app startup.
  const recurrence = value?.recurrence && typeof value.recurrence === "object"
    ? normalizeRecurrenceConfig({ ...fallback, ...value.recurrence,
        calendarContext: value.recurrence.calendarContext ?? calendarContext({ version: 1, timeZone: value.timezone || trackerTimeZone() }),
      })
    : fallback;
  return {
    startDate,
    endDate,
    timezone: typeof value?.timezone === "string" && value.timezone ? value.timezone : trackerTimeZone(),
    recurrence: {
      ...recurrence,
      enabled: value?.recurrence?.enabled ?? true,
      rangeStart: startDate,
      rangeEnd: endDate ?? "",
    },
  };
}

export function isTrackerScheduledForDate(
  schedule: TrackerSchedule,
  date: string,
  calendarMode: CalendarMode,
) {
  void calendarMode;
  if (date < schedule.startDate || (schedule.endDate && date > schedule.endDate)) return false;
  const recurrence = normalizeRecurrenceConfig(schedule.recurrence);
  return recurrenceMatchesDate(
    schedule.startDate,
    { ...recurrence, rangeStart: schedule.startDate, rangeEnd: schedule.endDate ?? "" },
    date,
    { ignoreRangeEnd: schedule.endDate === null },
  );
}

export function markTrackerEntityChanged<T extends TrackerEntity>(entity: T): T {
  return {
    ...entity,
    updatedAt: trackerTimestamp(),
    version: entity.version + 1,
    syncState: "pending",
  };
}
