export type HabitIntervalSchedule = {
  intervalMinutes: number;
  startTime: string;
  endTime: string;
  completionMode: "each" | "day";
};

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
export const DEFAULT_HABIT_INTERVAL: HabitIntervalSchedule = {
  intervalMinutes: 30, startTime: "09:00", endTime: "18:00", completionMode: "each",
};

export function normalizeHabitInterval(value: unknown): HabitIntervalSchedule | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<HabitIntervalSchedule>;
  if (!Number.isInteger(input.intervalMinutes) || input.intervalMinutes! < 1 || input.intervalMinutes! > 1440
    || typeof input.startTime !== "string" || !TIME_PATTERN.test(input.startTime)
    || typeof input.endTime !== "string" || !TIME_PATTERN.test(input.endTime) || input.endTime < input.startTime) return null;
  return { intervalMinutes: input.intervalMinutes!, startTime: input.startTime, endTime: input.endTime,
    completionMode: input.completionMode === "day" ? "day" : "each" };
}

export function habitIntervalTimes(value: HabitIntervalSchedule | null | undefined): string[] {
  const schedule = normalizeHabitInterval(value);
  if (!schedule) return [];
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const times: string[] = [];
  for (let minute = minutes(schedule.startTime); minute <= minutes(schedule.endTime); minute += schedule.intervalMinutes) {
    times.push(`${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`);
  }
  return times;
}

export function normalizeHabitCompletedTimes(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((time): time is string => typeof time === "string" && TIME_PATTERN.test(time)))].sort().slice(0, 1440) : [];
}

export function habitIntervalMarks(schedule: HabitIntervalSchedule | null | undefined,
  entry: { completed: boolean; completedTimes?: string[] } | null | undefined): string[] {
  const times = habitIntervalTimes(schedule);
  if (entry?.completed) return times;
  return normalizeHabitCompletedTimes(entry?.completedTimes).filter(time => times.includes(time));
}
