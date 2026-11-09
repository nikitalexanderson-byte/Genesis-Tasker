import { formatTimeValue, type TimeFormat } from "./time-format.ts";

export const MAX_TASK_REMINDERS = 5;
export const MAX_REMINDER_MINUTES = 40_320;

export type RelativeTaskReminder = {
  kind: "relative";
  minutes: number;
};

export type AbsoluteTaskReminder = {
  kind: "absolute";
  at: string;
};

export type TaskReminder = RelativeTaskReminder | AbsoluteTaskReminder;

export function taskReminderKey(reminder: TaskReminder) {
  return reminder.kind === "relative" ? `relative:${reminder.minutes}` : `absolute:${reminder.at}`;
}

export function normalizeTaskReminders(value: unknown, legacyReminderMinutes: unknown = null): TaskReminder[] {
  const source = Array.isArray(value) ? value : [];
  const result: TaskReminder[] = [];
  const seen = new Set<string>();

  for (const candidate of source) {
    if (!candidate || typeof candidate !== "object") continue;
    const raw = candidate as Partial<TaskReminder> & { minutes?: unknown; at?: unknown };
    let reminder: TaskReminder | null = null;

    if (raw.kind === "relative") {
      const minutes = Number(raw.minutes);
      if (Number.isInteger(minutes) && minutes >= 0 && minutes <= MAX_REMINDER_MINUTES) {
        reminder = { kind: "relative", minutes };
      }
    } else if (raw.kind === "absolute" && typeof raw.at === "string" && raw.at.length <= 64) {
      const timestamp = Date.parse(raw.at);
      if (Number.isFinite(timestamp)) reminder = { kind: "absolute", at: new Date(timestamp).toISOString() };
    }

    if (!reminder) continue;
    const key = taskReminderKey(reminder);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(reminder);
    if (result.length >= MAX_TASK_REMINDERS) break;
  }

  if (result.length === 0 && legacyReminderMinutes !== null && legacyReminderMinutes !== "") {
    const minutes = Number(legacyReminderMinutes);
    if (Number.isInteger(minutes) && minutes >= 0 && minutes <= MAX_REMINDER_MINUTES) {
      result.push({ kind: "relative", minutes });
    }
  }

  return result;
}

export function legacyReminderMinutes(reminders: TaskReminder[]) {
  return reminders.find((reminder): reminder is RelativeTaskReminder => reminder.kind === "relative")?.minutes ?? null;
}

export function reminderMinutesBeforeTask(reminder: TaskReminder, taskDate: string, taskTime: string) {
  if (reminder.kind === "relative") return reminder.minutes;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(taskDate)) return null;
  const start = new Date(`${taskDate}T${/^\d{2}:\d{2}$/.test(taskTime) ? taskTime : "00:00"}:00`);
  const reminderAt = new Date(reminder.at);
  if (Number.isNaN(start.getTime()) || Number.isNaN(reminderAt.getTime())) return null;
  return Math.round((start.getTime() - reminderAt.getTime()) / 60_000);
}

function russianUnit(value: number, forms: [string, string, string]) {
  const mod100 = Math.abs(value) % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 19) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

export function formatRelativeReminder(minutes: number, locale: string) {
  const units: Array<{ divisor: number; ru: [string, string, string]; en: [string, string] }> = [
    { divisor: 10_080, ru: ["неделю", "недели", "недель"], en: ["week", "weeks"] },
    { divisor: 1_440, ru: ["день", "дня", "дней"], en: ["day", "days"] },
    { divisor: 60, ru: ["час", "часа", "часов"], en: ["hour", "hours"] },
    { divisor: 1, ru: ["минуту", "минуты", "минут"], en: ["minute", "minutes"] },
  ];
  const unit = units.find((item) => minutes >= item.divisor && minutes % item.divisor === 0) ?? units.at(-1)!;
  const value = minutes / unit.divisor;
  const language = locale.split(/[-_]/)[0];
  if (language === "ru") return `За ${value} ${russianUnit(value, unit.ru)}`;
  if (language === "en") return `${value} ${value === 1 ? unit.en[0] : unit.en[1]} before`;
  const name = unit.divisor === 10080 ? "week" : unit.divisor === 1440 ? "day" : unit.divisor === 60 ? "hour" : "minute";
  const caseForms: Record<string, Record<string, [string,string,string]>> = {
    uk: {week:["тиждень","тижні","тижнів"],day:["день","дні","днів"],hour:["годину","години","годин"],minute:["хвилину","хвилини","хвилин"]},
    sr: {week:["недељу","недеље","недеља"],day:["дан","дана","дана"],hour:["сат","сата","сати"],minute:["минут","минута","минута"]},
    pl: {week:["tydzień","tygodnie","tygodni"],day:["dzień","dni","dni"],hour:["godzinę","godziny","godzin"],minute:["minutę","minuty","minut"]},
  };
  const quantity = caseForms[language] ? `${value} ${russianUnit(value,caseForms[language][name])}`
    : new Intl.NumberFormat(locale, {style:"unit",unit:name,unitDisplay:"long"}).format(value);
  if (language === "uk") return `За ${quantity}`;
  if (language === "zh") return `提前${quantity}`;
  if (language === "ja") return `${quantity}前`;
  const before: Record<string,string> = {el:"πριν",de:"vorher",fr:"avant",es:"antes",it:"prima",pt:"antes",pl:"wcześniej",sr:"раније",tr:"önce"};
  return `${quantity} ${before[language] ?? "before"}`;
}

export function formatTaskReminder(reminder: TaskReminder, locale: string, timeFormat: TimeFormat = "24h") {
  if (reminder.kind === "relative") return formatRelativeReminder(reminder.minutes, locale);
  const date = new Date(reminder.at);
  if (Number.isNaN(date.getTime())) return reminder.at;
  const dateLabel = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
  const timeLabel = formatTimeValue(`${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`, timeFormat);
  return `${dateLabel}, ${timeLabel}`;
}
