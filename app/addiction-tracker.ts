import type { CalendarMode } from "./calendar-data";
import {
  defaultTrackerSchedule,
  normalizeTrackerEntity,
  normalizeTrackerSchedule,
  type TrackerEntity,
  type TrackerSchedule,
} from "./tracker-core";
import { currentAbstinenceStreak, scoreAbstinenceDay } from "./tracker-math";

export type AddictionStatus = "active" | "paused" | "archived";

export type AddictionTracker = TrackerEntity & {
  trackedBehavior: string;
  description: string;
  status: AddictionStatus;
  schedule: TrackerSchedule;
  cleanDayPoints: number;
  relapsePenalty: number;
  reminderEnabled: boolean;
  reminderTime: string;
};

export type AddictionEntry = TrackerEntity & {
  trackerId: string;
  date: string;
  cleanDay: boolean;
  relapse: boolean;
  cravingIntensity: number;
  trigger: string;
  note: string;
  timestamp: string;
  score: number;
};

export function scoreAddictionEntry(
  tracker: Pick<AddictionTracker, "cleanDayPoints" | "relapsePenalty">,
  entry: Pick<AddictionEntry, "cleanDay" | "relapse">,
) {
  return scoreAbstinenceDay(tracker.cleanDayPoints, tracker.relapsePenalty, entry.cleanDay, entry.relapse);
}

export function defaultAddictionTracker(date: string, calendarMode: CalendarMode): AddictionTracker {
  return {
    ...normalizeTrackerEntity(null, "addiction"),
    trackedBehavior: "",
    description: "",
    status: "active",
    schedule: defaultTrackerSchedule(date, calendarMode),
    cleanDayPoints: 10,
    relapsePenalty: 0,
    reminderEnabled: false,
    reminderTime: "20:00",
  };
}

export function normalizeAddictionTracker(value: Record<string, unknown>, fallbackDate: string, calendarMode: CalendarMode): AddictionTracker | null {
  if (typeof value.id !== "string" || !value.id) return null;
  const status = ["active", "paused", "archived"].includes(String(value.status))
    ? value.status as AddictionStatus
    : value.active === false ? "paused" : "active";
  const cleanDayPoints = Number(value.cleanDayPoints);
  const relapsePenalty = Number(value.relapsePenalty);
  return {
    ...normalizeTrackerEntity(value as Partial<TrackerEntity>, "addiction"),
    trackedBehavior: typeof value.trackedBehavior === "string" && value.trackedBehavior
      ? value.trackedBehavior
      : typeof value.title === "string" ? value.title : "Наблюдаемое поведение",
    description: typeof value.description === "string" ? value.description : "",
    status,
    schedule: normalizeTrackerSchedule(value.schedule as Partial<TrackerSchedule>, fallbackDate, calendarMode),
    cleanDayPoints: Number.isFinite(cleanDayPoints) ? Math.max(0, Math.round(cleanDayPoints)) : 10,
    relapsePenalty: Number.isFinite(relapsePenalty) ? Math.max(0, Math.round(relapsePenalty)) : 0,
    reminderEnabled: value.reminderEnabled === true,
    reminderTime: typeof value.reminderTime === "string" ? value.reminderTime : "20:00",
  };
}

export function normalizeAddictionEntry(value: Record<string, unknown>, trackers: Map<string, AddictionTracker>): AddictionEntry | null {
  const trackerId = typeof value.trackerId === "string" ? value.trackerId : "";
  const date = typeof value.date === "string" ? value.date : "";
  const tracker = trackers.get(trackerId);
  if (!tracker || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const relapse = value.relapse === true;
  const cleanDay = relapse ? false : value.cleanDay === true;
  return {
    ...normalizeTrackerEntity(value as Partial<TrackerEntity>, "addiction-entry"),
    trackerId,
    date,
    cleanDay,
    relapse,
    cravingIntensity: Math.max(0, Math.min(10, Math.round(Number(value.cravingIntensity) || 0))),
    trigger: typeof value.trigger === "string" ? value.trigger : "",
    note: typeof value.note === "string" ? value.note : "",
    timestamp: typeof value.timestamp === "string" && value.timestamp ? value.timestamp : new Date().toISOString(),
    score: scoreAddictionEntry(tracker, { cleanDay, relapse }),
  };
}

export function addictionStreak(entries: AddictionEntry[], trackerId: string, today: string) {
  return currentAbstinenceStreak(entries, trackerId, today);
}
