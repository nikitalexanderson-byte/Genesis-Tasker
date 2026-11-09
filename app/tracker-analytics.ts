import type { CalendarMode } from "./calendar-data";
import { dateValuesBetween, habitDate, habitDateKey, isHabitScheduledForDate, type HabitWorkspace } from "./habits";
import { isTrackerScheduledForDate } from "./tracker-core";

export type TrackerType = "habit" | "sleep" | "mood" | "addiction";
export type AnalyticsPeriodType = "day" | "week" | "month" | "quarter" | "year";

export type TrackerAnalyticsMetrics = {
  scheduled: number;
  completed: number;
  score: number;
  qualityTotal: number;
  qualityCount: number;
  sleepTotalMinutes: number;
  sleepCount: number;
  sleepQualityTotal: number;
  sleepQualityCount: number;
  sleepDeviationTotal: number;
  sleepBedtimeMinutesTotal: number;
  sleepWakeMinutesTotal: number;
  moodTotal: number;
  moodCount: number;
  moodDistribution: number[];
  cleanDays: number;
  relapses: number;
  cravingTotal: number;
  cravingCount: number;
};

export type TrackerAnalyticsSnapshot = {
  id: string;
  trackerType: TrackerType;
  periodType: AnalyticsPeriodType;
  periodStart: string;
  periodEnd: string;
  metrics: TrackerAnalyticsMetrics;
  version: number;
  updatedAt: string;
};

function emptyMetrics(): TrackerAnalyticsMetrics {
  return {
    scheduled: 0,
    completed: 0,
    score: 0,
    qualityTotal: 0,
    qualityCount: 0,
    sleepTotalMinutes: 0,
    sleepCount: 0,
    sleepQualityTotal: 0,
    sleepQualityCount: 0,
    sleepDeviationTotal: 0,
    sleepBedtimeMinutesTotal: 0,
    sleepWakeMinutesTotal: 0,
    moodTotal: 0,
    moodCount: 0,
    moodDistribution: Array.from({ length: 12 }, () => 0),
    cleanDays: 0,
    relapses: 0,
    cravingTotal: 0,
    cravingCount: 0,
  };
}

function startOfWeek(value: string) {
  const date = habitDate(value);
  const weekday = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - weekday);
  return habitDateKey(date);
}

function endOfMonth(value: string) {
  const date = habitDate(`${value.slice(0, 7)}-01`);
  date.setMonth(date.getMonth() + 1);
  date.setDate(0);
  return habitDateKey(date);
}

function periodBounds(date: string, periodType: AnalyticsPeriodType) {
  if (periodType === "day") return { start: date, end: date };
  if (periodType === "week") {
    const start = startOfWeek(date);
    const end = habitDate(start);
    end.setDate(end.getDate() + 6);
    return { start, end: habitDateKey(end) };
  }
  if (periodType === "month") {
    const start = `${date.slice(0, 7)}-01`;
    return { start, end: endOfMonth(start) };
  }
  if (periodType === "quarter") {
    const [year, month] = date.split("-").map(Number);
    const quarterMonth = Math.floor((month - 1) / 3) * 3 + 1;
    const start = `${year}-${String(quarterMonth).padStart(2, "0")}-01`;
    const end = habitDate(start);
    end.setMonth(end.getMonth() + 3);
    end.setDate(0);
    return { start, end: habitDateKey(end) };
  }
  return { start: `${date.slice(0, 4)}-01-01`, end: `${date.slice(0, 4)}-12-31` };
}

function snapshotId(trackerType: TrackerType, periodType: AnalyticsPeriodType, periodStart: string) {
  return `${trackerType}:${periodType}:${periodStart}`;
}

function clockMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return (Number.isFinite(hours) ? hours : 0) * 60 + (Number.isFinite(minutes) ? minutes : 0);
}

export function calculateTrackerSnapshot(
  workspace: HabitWorkspace,
  trackerType: TrackerType,
  periodType: AnalyticsPeriodType,
  date: string,
  calendarMode: CalendarMode,
): TrackerAnalyticsSnapshot {
  const { start, end } = periodBounds(date, periodType);
  const metrics = emptyMetrics();

  if (trackerType === "habit") {
    const dates = dateValuesBetween(start, end);
    const completions = workspace.habitCompletions.filter((entry) => entry.date >= start && entry.date <= end);
    metrics.scheduled = dates.reduce((sum, value) => sum + workspace.habits.filter((habit) => isHabitScheduledForDate(habit, value, calendarMode)).length, 0);
    metrics.completed = completions.filter((entry) => entry.completed).length;
    metrics.score = completions.reduce((sum, entry) => sum + Math.max(0, entry.score), 0);
    completions.forEach((entry) => {
      if (entry.completed && entry.qualityValue !== null) {
        metrics.qualityTotal += entry.qualityValue;
        metrics.qualityCount += 1;
      }
    });
  } else if (trackerType === "sleep") {
    const entries = workspace.sleepEntries.filter((entry) => entry.date >= start && entry.date <= end);
    metrics.completed = entries.filter((entry) => entry.fellAsleepAt && entry.wokeAt).length;
    metrics.score = entries.reduce((sum, entry) => sum + entry.score, 0);
    entries.forEach((entry) => {
      if (entry.durationMinutes > 0) {
        metrics.sleepTotalMinutes += entry.durationMinutes;
        metrics.sleepCount += 1;
      }
      if (entry.quality !== null) {
        metrics.sleepQualityTotal += entry.quality;
        metrics.sleepQualityCount += 1;
      }
      if (entry.fellAsleepAt && entry.wokeAt) {
        metrics.sleepDeviationTotal += entry.deviationMinutes;
        metrics.sleepBedtimeMinutesTotal += clockMinutes(entry.fellAsleepAt);
        metrics.sleepWakeMinutesTotal += clockMinutes(entry.wokeAt);
      }
    });
  } else if (trackerType === "mood") {
    const entries = workspace.moodEntries.filter((entry) => entry.date >= start && entry.date <= end);
    metrics.moodCount = entries.length;
    metrics.moodTotal = entries.reduce((sum, entry) => sum + entry.moodValue, 0);
    entries.forEach((entry) => { metrics.moodDistribution[entry.moodValue + 5] += 1; });
  } else {
    const dates = dateValuesBetween(start, end);
    const entries = workspace.addictionEntries.filter((entry) => entry.date >= start && entry.date <= end);
    metrics.scheduled = dates.reduce((sum, value) => sum + workspace.addictionTrackers.filter((tracker) => tracker.status === "active" && isTrackerScheduledForDate(tracker.schedule, value, calendarMode)).length, 0);
    metrics.completed = entries.length;
    metrics.score = entries.reduce((sum, entry) => sum + entry.score, 0);
    metrics.cleanDays = entries.filter((entry) => entry.cleanDay && !entry.relapse).length;
    metrics.relapses = entries.filter((entry) => entry.relapse).length;
    metrics.cravingTotal = entries.reduce((sum, entry) => sum + entry.cravingIntensity, 0);
    metrics.cravingCount = entries.length;
  }

  return {
    id: snapshotId(trackerType, periodType, start),
    trackerType,
    periodType,
    periodStart: start,
    periodEnd: end,
    metrics,
    version: 1,
    updatedAt: new Date().toISOString(),
  };
}

function entryVersions(workspace: HabitWorkspace) {
  const map = new Map<string, string>();
  const groups = [workspace.habitCompletions, workspace.sleepEntries, workspace.moodEntries, workspace.addictionEntries];
  groups.flat().forEach((entry) => map.set(entry.id, `${entry.updatedAt}:${entry.version}:${"date" in entry ? entry.date : ""}`));
  return map;
}

export function changedTrackerDates(previous: HabitWorkspace, next: HabitWorkspace) {
  const previousVersions = entryVersions(previous);
  const nextVersions = entryVersions(next);
  const dates = new Set<string>();
  const groups = [previous.habitCompletions, previous.sleepEntries, previous.moodEntries, previous.addictionEntries, next.habitCompletions, next.sleepEntries, next.moodEntries, next.addictionEntries];
  groups.flat().forEach((entry) => {
    const previousValue = previousVersions.get(entry.id);
    const nextValue = nextVersions.get(entry.id);
    if (previousValue !== nextValue && "date" in entry && typeof entry.date === "string") dates.add(entry.date);
  });
  return dates;
}

export function refreshTrackerAnalytics(
  workspace: HabitWorkspace,
  dates: Iterable<string>,
  calendarMode: CalendarMode,
) {
  const snapshots = new Map(workspace.analyticsSnapshots.map((snapshot) => [snapshot.id, snapshot]));
  const requests = new Map<string, { trackerType: TrackerType; periodType: AnalyticsPeriodType; date: string }>();
  for (const date of dates) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    (["habit", "sleep", "mood", "addiction"] as TrackerType[]).forEach((trackerType) => {
      (["day", "week", "month", "quarter", "year"] as AnalyticsPeriodType[]).forEach((periodType) => {
        const bounds = periodBounds(date, periodType);
        const id = snapshotId(trackerType, periodType, bounds.start);
        requests.set(id, { trackerType, periodType, date });
      });
    });
  }
  requests.forEach((request, id) => {
    const next = calculateTrackerSnapshot(workspace, request.trackerType, request.periodType, request.date, calendarMode);
    const previous = snapshots.get(id);
    snapshots.set(id, { ...next, version: (previous?.version ?? 0) + 1 });
  });
  return { ...workspace, analyticsSnapshots: Array.from(snapshots.values()) };
}

export function ensureTrackerAnalytics(workspace: HabitWorkspace, calendarMode: CalendarMode) {
  if (workspace.analyticsSnapshots.length) return workspace;
  const dates = new Set<string>([habitDateKey(new Date())]);
  workspace.habitCompletions.forEach((entry) => dates.add(entry.date));
  workspace.sleepEntries.forEach((entry) => dates.add(entry.date));
  workspace.moodEntries.forEach((entry) => dates.add(entry.date));
  workspace.addictionEntries.forEach((entry) => dates.add(entry.date));
  return refreshTrackerAnalytics(workspace, dates, calendarMode);
}

export function trackerSnapshot(
  workspace: HabitWorkspace,
  trackerType: TrackerType,
  periodType: AnalyticsPeriodType,
  date: string,
  calendarMode: CalendarMode,
) {
  const { start } = periodBounds(date, periodType);
  return workspace.analyticsSnapshots.find((snapshot) => snapshot.id === snapshotId(trackerType, periodType, start))
    ?? calculateTrackerSnapshot(workspace, trackerType, periodType, date, calendarMode);
}
