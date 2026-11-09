import type { SVGProps } from "react";
import { ExperimentalIcon } from "./ExperimentalIcon";

export type SettingsSectionId = "appearance" | "habits" | "reminders" | "shared" | "region" | "account" | "backups" | "links";

export const SETTINGS_SECTIONS: Array<{ id: SettingsSectionId; ru: string; en: string; descriptionRu: string; descriptionEn: string }> = [
  { id: "appearance", ru: "Оформление", en: "Appearance", descriptionRu: "Темы, меню, язык, календари и время", descriptionEn: "Themes, menus, language, calendars and time" },
  { id: "habits", ru: "Привычки", en: "Habits", descriptionRu: "Трекинг, уведомления и отклик на выполнение", descriptionEn: "Tracking, notifications and completion feedback" },
  { id: "reminders", ru: "Напоминания", en: "Reminders", descriptionRu: "Лунные и системные напоминания", descriptionEn: "Lunar and system reminders" },
  { id: "shared", ru: "Общие дела", en: "Shared affairs", descriptionRu: "Доступ, приглашения и события команды", descriptionEn: "Access, invitations and team activity" },
  { id: "region", ru: "Регион", en: "Region", descriptionRu: "Регион и место для восхода и заката", descriptionEn: "Region and sunrise and sunset location" },
  { id: "account", ru: "Аккаунт GENESIS", en: "GENESIS account", descriptionRu: "Вход и синхронизация", descriptionEn: "Sign in and synchronization" },
  { id: "backups", ru: "Резервные копии", en: "Backups", descriptionRu: "Сохранение и восстановление данных", descriptionEn: "Save and restore your data" },
  { id: "links", ru: "Ссылки", en: "Links", descriptionRu: "Академия, поддержка и веб-версия", descriptionEn: "Academy, support and web version" },
];

export function SettingsSectionIcon({ section, ...props }: SVGProps<SVGSVGElement> & { section: SettingsSectionId }) {
  if (section === "shared") return <ExperimentalIcon name="team" className={props.className} />;
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.55, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...props} {...common}>
    {section === "appearance" ? <><circle cx="12" cy="12" r="5.2" /><path d="M12 6.8a5.2 5.2 0 0 1 5.2 5.2H12Z" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2" /></> : null}
    {section === "habits" ? <><path d="M12 21v-9L9 8M12 12c1-5 5-7 8-7 0 5-3 7-8 7ZM9 8C6 8 4 6 4 3c4 0 5 2 5 5ZM8 21h8" /></> : null}
    {section === "reminders" ? <><path d="M5 17l2-2v-5a5 5 0 0 1 10 0v5l2 2H5Z" /><circle cx="12" cy="20" r="1.2" /><path d="M12 2v1.5" /></> : null}
    {section === "region" ? <><path d="M12 22C9 17 4 12 4 9a8 8 0 0 1 16 0c0 3-5 8-8 13Z" /><circle cx="12" cy="9" r="3" /><path d="M9 9h6" /></> : null}
    {section === "account" ? <><circle cx="12" cy="8" r="3.4" /><path d="M4 20c0-8 16-8 16 0M8 20h8" /></> : null}
    {section === "links" ? <><path d="m10 8 2-2c5-5 11 1 6 6l-2 2M14 16l-2 2c-5 5-11-1-6-6l2-2M9 15l6-6" /></> : null}
    {section === "backups" ? <><path d="M5 4h12l3 3v13H4V4h1ZM8 4v6h8V4M8 20v-6h8v6" /></> : null}
  </svg>;
}
