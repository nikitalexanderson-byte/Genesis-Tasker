import messages from "./habit-notification-copy.json" with { type: "json" };
import localized from "./habit-notification-l10n.json" with { type: "json" };
import type { HabitNotificationTone } from "./habit-notifications";
import type { Language } from "./i18n";

export function notificationCopyIndex(seed: string, length: number): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index++) hash = Math.imul(hash ^ seed.charCodeAt(index), 16777619) >>> 0;
  return hash % length;
}

export function habitNotificationMessage(tone: HabitNotificationTone, kind: "habit" | "goal",
  seed: string, language: Language, subject: string, count = 1): string {
  const pool = messages[tone][kind];
  const index = notificationCopyIndex(seed, pool.length);
  const choice = language === "ru" || language === "en"
    ? pool[index][language === "en" ? 1 : 0]
    : localized[tone][kind][language];
  const template = Array.isArray(choice) ? choice[index] : choice;
  return kind === "habit"
    ? template.replaceAll("{subject}", () => subject)
    : template.replaceAll("{count}", String(count));
}
