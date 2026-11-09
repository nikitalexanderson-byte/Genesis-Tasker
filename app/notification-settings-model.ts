import { translateText as t } from "./i18n";
import type { Language } from "./i18n";
import type { CalendarMode } from "./calendar-data";
import type { TimeFormat } from "./time-format";
export { rebaseNotificationPreferences } from "./notification-preferences-rebase";

export const notificationKindLabels = {
  created:"Новая задача", projects:"Новый проект", comments:"Новый комментарий", assignment:"Назначение исполнителя",
  mentions:"Упоминание в комментарии", dueSoon:"Приближение срока", overdue:"Просроченная задача",
  approvalRequest:"Запрос подтверждения", approvalResult:"Результат подтверждения", changes:"Изменения",
} as const;
export type NotificationKind = keyof typeof notificationKindLabels;
export type SharedNotificationPreferences = {
  types:Record<NotificationKind,boolean>; channels:{inbox:boolean;push:boolean;email:boolean};
  emailTypes?:Record<NotificationKind|"messages",boolean>;
  frequency:"immediate"|"hourly"|"daily"; digestTime:string; quiet:{enabled:boolean;start:string;end:string};
  timeZone:string; timeZoneMode:"device"|"fixed"; reminderDays:number;
};
export type SharedNotificationSettings = {
  settings:SharedNotificationPreferences; revision:number;
  capabilities:{push:{available:boolean;publicKey?:string;blocker?:string};email:{available:boolean;blocker?:string}};
  subscriptions:{id:string;lastError:string|null}[]; delivery:{channel:"push"|"email";state:"pending"|"failed";count:number}[];
  context:{language:Language;calendarMode:CalendarMode;gregorianYearStart:"january"|"march";timeFormat:TimeFormat};
};

export const notificationErrorLabels:Record<string,string> = {
  INVALID_NOTIFICATION_SETTINGS:"Проверьте настройки уведомлений и время тихих часов.",
  INVALID_NOTIFICATION_TIMEZONE:"Введите действительный часовой пояс IANA, например Europe/Moscow. Черновик сохранён.",
  NOTIFICATION_SETTINGS_CONFLICT:"Настройки изменились на другом устройстве. Обновите их и повторите выбор.",
  PUSH_KEYS_UNCONFIGURED:"Web Push пока не настроен на сервере. Уведомления доступны во входящих.",
  PUSH_KEYS_INVALID:"Web Push временно недоступен. Уведомления доступны во входящих.",
  PUSH_RUNTIME_UNAVAILABLE:"Web Push временно недоступен. Уведомления доступны во входящих.",
  PUSH_SUBJECT_INVALID:"Web Push временно недоступен. Уведомления доступны во входящих.",
  EMAIL_TRANSPORT_UNCONFIGURED:"Отправка писем пока не настроена. Уведомления доступны во входящих.",
  INVALID_PUSH_SUBSCRIPTION:"Не удалось подключить это устройство. Повторите попытку.",
  PUSH_CONNECTION_FAILED:"Не удалось подключить это устройство. Повторите попытку.",
  PUSH_DEVICE_LIMIT:"Подключено слишком много устройств. Отключите одно из них и повторите попытку.",
};
export const notificationFailure = (error:unknown) => t(notificationErrorLabels[error instanceof Error?error.message:""]??"Не удалось обновить уведомления. Повторите попытку.");
export function sharedNotificationLabel(item:{kind?:string;action:string;taskTitle?:string|null}) {
  const kind=item.kind??(item.action==="project.created"?"projects":item.action==="comment.created"||item.action==="comment.mentioned"?"comments":"created");
  return t(kind==="changes"&&item.taskTitle?"Изменение задачи":notificationKindLabels[kind as NotificationKind]??"Изменения");
}
export { sharedPushDeviceKey } from "./shared-push-device";
export const supportsSharedPush=()=>typeof window!=="undefined"&&window.isSecureContext&&"serviceWorker"in navigator&&"PushManager"in window&&"Notification"in window;
