import type { Habit } from "./habits";
import { habitIntervalTimes } from "./habit-interval.ts";

const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
export function habitReminderTime(habit: Pick<Habit, "preferredTime" | "reminder" | "intervalSchedule">): string {
  if (habit.reminder.timing !== "custom" && habit.intervalSchedule) return habit.intervalSchedule.startTime;
  return habit.reminder.timing !== "custom" && timePattern.test(habit.preferredTime)
    ? habit.preferredTime : habit.reminder.time;
}

export function habitReminderTimes(habit: Pick<Habit, "preferredTime" | "reminder" | "intervalSchedule">): string[] {
  return habit.intervalSchedule && habit.reminder.timing !== "custom" ? habitIntervalTimes(habit.intervalSchedule) : [habitReminderTime(habit)];
}

export function habitReminderDateTime(date: string, time: string, minutesBefore = 0): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(year, month - 1, day, hours, minutes - Math.min(1440, Math.max(0, Math.trunc(minutesBefore))), 0, 0);
}
