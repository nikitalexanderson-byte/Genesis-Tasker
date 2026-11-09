import { SearchMoonPhase } from "astronomy-engine";

export type MoonReminderSettings = { full: number[]; new: number[] };
export type PlannedMoonReminder = { kind: "full" | "new"; eventDate: string; leadDays: number; at: Date; key: string };
export const MOON_SETTINGS_CHANGED = "genesis:moon-reminders-changed";
const storageKey = (accountId: string) => `genesis-moon-reminders-v1:${accountId}`;
export function normalizeMoonReminderSettings(value: unknown): MoonReminderSettings {
  const source = value && typeof value === "object" ? value as Partial<MoonReminderSettings> : {};
  const days = (values: unknown) => Array.isArray(values)
    ? [...new Set(values.filter((day): day is number => Number.isInteger(day) && day >= 1 && day <= 3))].sort() : [];
  return { full: days(source.full), new: days(source.new) };
}
export function readMoonReminderSettings(accountId: string): MoonReminderSettings {
  try { return normalizeMoonReminderSettings(JSON.parse(localStorage.getItem(storageKey(accountId)) || "null")); }
  catch { return { full: [], new: [] }; }
}
export function saveMoonReminderSettings(accountId: string, settings: MoonReminderSettings) {
  localStorage.setItem(storageKey(accountId), JSON.stringify(normalizeMoonReminderSettings(settings)));
  window.dispatchEvent(new Event(MOON_SETTINGS_CHANGED));
}
const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** Matches Android: each selected phase/lead gets its own reminder at 09:00 device time. */
export function planMoonReminders(after: Date, settings: MoonReminderSettings, horizonDays = 120): PlannedMoonReminder[] {
  const horizon = after.getTime() + horizonDays * 86_400_000;
  const result: PlannedMoonReminder[] = [];
  for (const kind of ["full", "new"] as const) {
    const leads = normalizeMoonReminderSettings(settings)[kind];
    if (!leads.length) continue;
    let cursor = new Date(after.getTime() - 86_400_000);
    while (cursor.getTime() <= horizon + 4 * 86_400_000) {
      const phase = SearchMoonPhase(kind === "full" ? 180 : 0, cursor, 40);
      if (!phase) break;
      const event = phase.date;
      for (const leadDays of leads) {
        const at = new Date(event.getFullYear(), event.getMonth(), event.getDate() - leadDays, 9);
        if (at.getTime() > after.getTime() && at.getTime() <= horizon) {
          const eventDate = dateKey(event);
          result.push({ kind, eventDate, leadDays, at, key: `${kind}/${eventDate}/${leadDays}` });
        }
      }
      cursor = new Date(event.getTime() + 86_400_000);
    }
  }
  return result.sort((a, b) => a.at.getTime() - b.at.getTime());
}
