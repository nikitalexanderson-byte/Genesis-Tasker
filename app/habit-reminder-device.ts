export const habitReminderDeviceStorageKey = (userId: string) => `genesis.habit-reminder.device.${userId}`;
export const habitReminderFrequencyKey = (userId: string) => `genesis.habit-reminder.frequency.${userId}`;
export type HabitReminderFrequency = { maxPerDay: number; snoozeMinutes: number };
export const DEFAULT_HABIT_REMINDER_FREQUENCY: HabitReminderFrequency = { maxPerDay: 128, snoozeMinutes: 10 };
export function habitReminderDeviceKey(userId: string) {
  const key = habitReminderDeviceStorageKey(userId);
  let device = localStorage.getItem(key);
  if (!device) { device = crypto.randomUUID(); localStorage.setItem(key, device); }
  return device;
}
export function habitReminderFrequency(userId: string): HabitReminderFrequency {
  try {
    const value = JSON.parse(localStorage.getItem(habitReminderFrequencyKey(userId)) || "null");
    return { maxPerDay: [4, 12, 24, 64, 128].includes(value?.maxPerDay) ? value.maxPerDay : 128,
      snoozeMinutes: [5, 10, 15, 30, 60].includes(value?.snoozeMinutes) ? value.snoozeMinutes : 10 };
  } catch { return DEFAULT_HABIT_REMINDER_FREQUENCY; }
}
