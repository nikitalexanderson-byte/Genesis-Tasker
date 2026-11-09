import { presentWebReminder } from "./web-reminder-presentation.ts";
import { habitNotificationMessage, notificationCopyIndex } from "./habit-notification-message.ts";
import { habitReminderDateTime } from "./habit-reminder-time.ts";
import type { Language } from "./i18n";
import { privateDeviceAccessBlocked } from "./local-sign-out.ts";
export type HabitNotificationTone = "calm" | "heroic" | "ironic";

export type HabitNotificationSettings = {
  enabled: boolean;
  motivational: boolean;
  tone: HabitNotificationTone;
  dailyGoalTime: string;
  quietHoursStart: string;
  quietHoursEnd: string;
};

export type HabitNotificationPermission = NotificationPermission | "unsupported";

export type HabitNotificationCandidate = {
  id: string;
  kind: "habit" | "habit-group" | "daily-goal" | "perfect-day";
  variant: "concise" | "context";
  scheduledAt: string;
  title: string;
  body: string;
};

export type HabitNotificationPlanInput = {
  date: string;
  now: Date;
  language: Language;
  settings: HabitNotificationSettings;
  habits: Array<{
    id: string;
    title: string;
    emoji: string;
    priority: number;
    reminderTime: string;
    minutesBefore?: number;
    allowDuringQuietHours?: boolean;
    date?: string;
  }>;
  dailyGoal: {
    scheduled: number;
    completed: number;
    target: number;
    currentStreak: number;
  };
  xpToNextRank?: number | null;
};

type HabitNotificationTelemetryEvent = {
  notificationId: string;
  kind: HabitNotificationCandidate["kind"];
  variant: HabitNotificationCandidate["variant"];
  event: "delivered" | "opened" | "disabled";
  occurredAt: string;
};

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const TELEMETRY_KEY = "genesis-habit-notification-metrics-v1";
const DELIVERED_KEY = "genesis-habit-notifications-delivered-v1";

export const DEFAULT_HABIT_NOTIFICATION_SETTINGS: HabitNotificationSettings = {
  enabled: false,
  motivational: true,
  tone: "calm",
  dailyGoalTime: "20:30",
  quietHoursStart: "22:00",
  quietHoursEnd: "07:30",
};

function normalizedTime(value: unknown, fallback: string) {
  return typeof value === "string" && TIME_PATTERN.test(value) ? value : fallback;
}

export function normalizeHabitNotificationSettings(value: Partial<HabitNotificationSettings> | null | undefined): HabitNotificationSettings {
  const tone = ["calm", "heroic", "ironic"].includes(String(value?.tone))
    ? value!.tone as HabitNotificationTone
    : DEFAULT_HABIT_NOTIFICATION_SETTINGS.tone;
  return {
    enabled: value?.enabled === true,
    motivational: value?.motivational !== false,
    tone,
    dailyGoalTime: normalizedTime(value?.dailyGoalTime, DEFAULT_HABIT_NOTIFICATION_SETTINGS.dailyGoalTime),
    quietHoursStart: normalizedTime(value?.quietHoursStart, DEFAULT_HABIT_NOTIFICATION_SETTINGS.quietHoursStart),
    quietHoursEnd: normalizedTime(value?.quietHoursEnd, DEFAULT_HABIT_NOTIFICATION_SETTINGS.quietHoursEnd),
  };
}

function minutesFromTime(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function localDateTime(date: string, time: string) {
  const [year, month, day] = date.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(year, month - 1, day, hours, minutes, 0, 0);
}

export function isHabitNotificationQuietTime(time: string, settings: HabitNotificationSettings) {
  const value = minutesFromTime(time);
  const start = minutesFromTime(settings.quietHoursStart);
  const end = minutesFromTime(settings.quietHoursEnd);
  if (start === end) return false;
  return start < end ? value >= start && value < end : value >= start || value < end;
}

function notificationVariant(seed: string): HabitNotificationCandidate["variant"] {
  const checksum = Array.from(seed).reduce((total, character) => total + character.charCodeAt(0), 0);
  return checksum % 2 ? "context" : "concise";
}

function dailyGoalCopy(input: HabitNotificationPlanInput, remaining: number, perfectRemaining: number, variant: HabitNotificationCandidate["variant"]) {
  const count = remaining || perfectRemaining;
  const body = habitNotificationMessage(input.settings.tone, "goal", `${input.date}:goal`, input.language, "", count);
  const context = variant === "context" && input.dailyGoal.currentStreak > 0 &&
    (input.language === "ru" || input.language === "en")
    ? input.language === "en" ? ` Your current streak is ${input.dailyGoal.currentStreak} days.` : ` Текущая серия: ${input.dailyGoal.currentStreak} дн.` : "";
  return { title: "GENESIS", body: body + context };
}

export function buildHabitNotificationPlan(input: HabitNotificationPlanInput): HabitNotificationCandidate[] {
  if (!input.settings.enabled) return [];
  const earliestAllowed = input.now.getTime() - 5 * 60_000;
  const candidates: HabitNotificationCandidate[] = input.habits.flatMap((habit) => {
    if (!TIME_PATTERN.test(habit.reminderTime)) return [];
    const date = habit.date ?? input.date;
    const scheduled = habitReminderDateTime(date, habit.reminderTime, habit.minutesBefore);
    const time = `${String(scheduled.getHours()).padStart(2, "0")}:${String(scheduled.getMinutes()).padStart(2, "0")}`;
    if (scheduled.getTime() < earliestAllowed || !habit.allowDuringQuietHours && isHabitNotificationQuietTime(time, input.settings)) return [];
    const id = `notification:${date}:habit:${time}:${notificationCopyIndex(habit.id, 4294967295)}`;
    return [{ id, kind: "habit" as const, variant: notificationVariant(id), scheduledAt: scheduled.toISOString(),
      title: habit.title, body: habitNotificationMessage(input.settings.tone, "habit",
        `${date}:${habit.id}:${scheduled.getTime()}`, input.language, `«${habit.title}»`) }];
  });
  const remaining = Math.max(0, input.dailyGoal.target - input.dailyGoal.completed);
  const perfectRemaining = Math.max(0, input.dailyGoal.scheduled - input.dailyGoal.completed);
  const achievable = input.dailyGoal.completed + perfectRemaining >= input.dailyGoal.target;
  if (input.settings.motivational && achievable && (remaining > 0 || perfectRemaining === 1) &&
      !isHabitNotificationQuietTime(input.settings.dailyGoalTime, input.settings)) {
    const scheduled = localDateTime(input.date, input.settings.dailyGoalTime);
    if (scheduled.getTime() >= earliestAllowed) {
      const kind = remaining > 0 ? "daily-goal" as const : "perfect-day" as const;
      const id = `notification:${input.date}:${kind}:${input.settings.dailyGoalTime}`;
      const variant = notificationVariant(id);
      candidates.push({ id, kind, variant, scheduledAt: scheduled.toISOString(), ...dailyGoalCopy(input, remaining, perfectRemaining, variant) });
    }
  }
  return candidates.sort((left, right) => left.scheduledAt.localeCompare(right.scheduledAt));
}
function readTelemetry(): HabitNotificationTelemetryEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(TELEMETRY_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((entry) => entry && typeof entry.notificationId === "string").slice(-120) : [];
  } catch {
    return [];
  }
}

function recordTelemetry(candidate: Pick<HabitNotificationCandidate, "id" | "kind" | "variant">, event: HabitNotificationTelemetryEvent["event"]) {
  if (typeof window === "undefined" || privateDeviceAccessBlocked()) return;
  const metrics = [...readTelemetry(), { notificationId: candidate.id, kind: candidate.kind, variant: candidate.variant, event, occurredAt: new Date().toISOString() }].slice(-120);
  window.localStorage.setItem(TELEMETRY_KEY, JSON.stringify(metrics));
}

function deliveredIds() {
  if (typeof window === "undefined") return new Set<string>();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DELIVERED_KEY) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string").slice(-60) : []);
  } catch {
    return new Set<string>();
  }
}

export function hasNotificationFatigue() {
  const metrics = readTelemetry();
  const opened = new Set(metrics.filter((entry) => entry.event === "opened").map((entry) => entry.notificationId));
  const ignored = metrics.filter((entry) => entry.event === "delivered" && !opened.has(entry.notificationId));
  return ignored.slice(-3).length >= 3;
}

async function showCandidate(candidate: HabitNotificationCandidate, appBase: string) {
  if (privateDeviceAccessBlocked()) return;
  const options: NotificationOptions = {
    body: candidate.body,
    tag: `genesis-${candidate.id}`,
    icon: `${appBase}/mindmap-icons/repeat-2.png`,
    badge: `${appBase}/mindmap-icons/repeat-2.png`,
    data: { genesisNotificationId: candidate.id, kind: candidate.kind, variant: candidate.variant, url: `${appBase || "/"}#today` },
  };
  const registration = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
  if (privateDeviceAccessBlocked()) return;
  options.silent = presentWebReminder("habit", candidate.title, candidate.body);
  if (document.hidden) {
    if (registration) await registration.showNotification(candidate.title, options);
    else new Notification(candidate.title, options);
  }
  if (privateDeviceAccessBlocked()) {
    const shown = await registration?.getNotifications({ tag: options.tag });
    shown?.forEach((notification) => notification.close());
    return;
  }
  const delivered = deliveredIds();
  delivered.add(candidate.id);
  window.localStorage.setItem(DELIVERED_KEY, JSON.stringify(Array.from(delivered).slice(-60)));
  recordTelemetry(candidate, "delivered");
}

export function habitNotificationPermission(): HabitNotificationPermission {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

export async function requestHabitNotificationPermission(): Promise<HabitNotificationPermission> {
  if (habitNotificationPermission() === "unsupported") return "unsupported";
  return Notification.requestPermission();
}

export function scheduleHabitNotifications(candidates: readonly HabitNotificationCandidate[], appBase = "") {
  if (typeof window === "undefined" || privateDeviceAccessBlocked() || habitNotificationPermission() !== "granted") return () => undefined;
  const delivered = deliveredIds();
  const fatigue = hasNotificationFatigue();
  const timers = candidates.flatMap((candidate) => {
    if (delivered.has(candidate.id) || (fatigue && ["daily-goal", "perfect-day"].includes(candidate.kind))) return [];
    const delay = Math.max(0, new Date(candidate.scheduledAt).getTime() - Date.now());
    if (delay > 24 * 60 * 60_000) return [];
    return [window.setTimeout(() => void showCandidate(candidate, appBase), delay)];
  });
  return () => timers.forEach((timer) => window.clearTimeout(timer));
}

export function observeHabitNotificationClicks() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return () => undefined;
  const listener = (event: MessageEvent) => {
    const payload = event.data as { type?: string; notificationId?: string; kind?: HabitNotificationCandidate["kind"]; variant?: HabitNotificationCandidate["variant"] };
    if (payload?.type !== "GENESIS_NOTIFICATION_OPENED" || !payload.notificationId || !payload.kind || !payload.variant) return;
    recordTelemetry({ id: payload.notificationId, kind: payload.kind, variant: payload.variant }, "opened");
  };
  navigator.serviceWorker.addEventListener("message", listener);
  return () => navigator.serviceWorker.removeEventListener("message", listener);
}

export function recordHabitNotificationsDisabled() {
  recordTelemetry({ id: `notification-disabled:${new Date().toISOString().slice(0, 10)}`, kind: "daily-goal", variant: "concise" }, "disabled");
}

export function recordHabitReminderTelemetry(event:"delivered"|"opened",id:string,goal=false) {
  recordTelemetry({id,kind:goal?"daily-goal":"habit",variant:"concise"},event);
}

export function suggestHabitReminderTime(completions: readonly { completed: boolean; updatedAt: string }[], currentTime: string) {
  const times = completions
    .filter((entry) => entry.completed && !Number.isNaN(Date.parse(entry.updatedAt)))
    .slice(-30)
    .map((entry) => {
      const value = new Date(entry.updatedAt);
      return value.getHours() * 60 + value.getMinutes();
    })
    .sort((left, right) => left - right);
  if (times.length < 4 || !TIME_PATTERN.test(currentTime)) return null;
  const median = times[Math.floor(times.length / 2)];
  if (Math.abs(median - minutesFromTime(currentTime)) < 30) return null;
  return { time: `${String(Math.floor(median / 60)).padStart(2, "0")}:${String(median % 60).padStart(2, "0")}`, sampleSize: times.length };
}
