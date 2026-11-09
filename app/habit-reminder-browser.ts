import { buildHabitReminderPlan, habitReminderAction, habitReminderTarget, type HabitReminderRow } from "./habit-reminder-plan";
import { habitNotificationMessage } from "./habit-notification-message";
import { hasNotificationFatigue, isHabitNotificationQuietTime, recordHabitReminderTelemetry } from "./habit-notifications";
import { habitReminderFrequency } from "./habit-reminder-device";
import { withHabitTimerLock } from "./habit-timer-storage";
import { presentWebReminder } from "./web-reminder-presentation";
import { privateDeviceAccessBlocked } from "./local-sign-out";
import { translateText, type Language } from "./i18n";
import type { HabitWorkspace } from "./habits";

export type HabitReminderIntent = { userId: string; deliveryId?: string; target?: HabitReminderRow; action: string };
export async function habitReminderWorkerIntent(id: string, userId: string, acknowledge = false): Promise<HabitReminderIntent | null> {
  const worker = (await navigator.serviceWorker.getRegistration())?.active;
  if (!worker) return null;
  return new Promise(resolve => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => { channel.port1.close(); resolve(null); }, 3000);
    channel.port1.onmessage = event => { clearTimeout(timeout); channel.port1.close(); resolve(event.data); };
    worker.postMessage({ type: acknowledge ? "GENESIS_HABIT_INTENT_ACK" : "GENESIS_HABIT_INTENT", id, userId }, [channel.port2]);
  });
}

const receiptsKey = (userId: string) => `genesis.habit-reminder.receipts.${userId}`;
async function eventReceipt(key: string,userId: string,action: "reserve"|"commit"|"release") {
  const worker=(await navigator.serviceWorker?.getRegistration())?.active;
  if(!worker)return true;
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(key));
  const hash=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,"0")).join("");
  return new Promise<boolean>(resolve=>{
    const channel=new MessageChannel();const timer=setTimeout(()=>{channel.port1.close();resolve(false);},3000);
    channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();resolve(event.data===true);};
    worker.postMessage({type:"GENESIS_HABIT_EVENT_RECEIPT",key:hash,userId,action},[channel.port2]);
  });
}
const snoozesKey = (userId: string) => `genesis.habit-reminder.snoozes.${userId}`;
type Snooze = { row: HabitReminderRow; due: string };
export function snoozeLocalHabitReminder(userId: string, row: HabitReminderRow, workspace: HabitWorkspace, now = new Date()) {
  const target = habitReminderTarget(row), action = target && habitReminderAction(workspace, target, now);
  if (!target || action === "unavailable" || action === "stale" || action === "completed") throw Error("HABIT_REMINDER_SNOOZE_UNAVAILABLE");
  const snoozes = JSON.parse(localStorage.getItem(snoozesKey(userId)) || "{}") as Record<string, Snooze>;
  if (snoozes[row.id]) return;
  const due = new Date(now.getTime() + habitReminderFrequency(userId).snoozeMinutes * 60_000);
  const at = new Intl.DateTimeFormat("en-GB", { timeZone: row.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(due);
  const part = (type: string) => at.find(value => value.type === type)?.value;
  const date = `${part("year")}-${part("month")}-${part("day")}`;
  const localTime = `${String(due.getHours()).padStart(2,"0")}:${String(due.getMinutes()).padStart(2,"0")}`;
  if (date !== row.date || !row.allowDuringQuietHours && isHabitNotificationQuietTime(localTime, workspace.habitSettings.notifications)) throw Error("HABIT_REMINDER_SNOOZE_UNAVAILABLE");
  snoozes[row.id] = { row, due: due.toISOString() };localStorage.setItem(snoozesKey(userId), JSON.stringify(snoozes));
  window.dispatchEvent(new Event("genesis:habit-reminders-changed"));
}

/** Honest open-tab fallback. When a current push schedule is active it is not run concurrently. */
export function scheduleHabitReminderFallback(userId: string, getWorkspace: () => HabitWorkspace, language: Language, appBase: string) {
  if (privateDeviceAccessBlocked() || typeof Notification === "undefined" || Notification.permission !== "granted") return () => undefined;
  const workspace = getWorkspace(), plan = buildHabitReminderPlan(workspace, new Date(), undefined, 2);
  let active = true;
  const rows = plan.rows.map(row => ({ row, due: row.at, key: row.id }));
  try {
    const snoozes = JSON.parse(localStorage.getItem(snoozesKey(userId)) || "{}") as Record<string, Snooze>;
    for (const [key, value] of Object.entries(snoozes)) if (Number.isFinite(Date.parse(value.due))) rows.push({ row: value.row, due: value.due, key: `snooze:${key}` });
  } catch { /* A malformed local snooze never changes personal habit data. */ }
  const deliver = async (item: typeof rows[number]) => withHabitTimerLock(`habit-reminder:${userId}`, async () => {
    if (!active || privateDeviceAccessBlocked()) return;
    const live = getWorkspace(), target = habitReminderTarget(item.row);
    if (target && ["unavailable","stale","completed"].includes(habitReminderAction(live, target))) return;
    const time = `${String(new Date().getHours()).padStart(2,"0")}:${String(new Date().getMinutes()).padStart(2,"0")}`;
    if (!item.row.allowDuringQuietHours && isHabitNotificationQuietTime(time, live.habitSettings.notifications)) return;
    const receipts = JSON.parse(localStorage.getItem(receiptsKey(userId)) || "{}") as Record<string, number>;
    const start = new Date();start.setHours(0,0,0,0);
    if (receipts[item.key] || Object.values(receipts).filter(at => at >= start.getTime()).length >= habitReminderFrequency(userId).maxPerDay
      || item.row.kind === "goal" && hasNotificationFatigue()) return;
    // A goal may have been reached without rebuilding the timers yet.
    if (item.row.kind === "goal" && !buildHabitReminderPlan(live, new Date(), undefined, 1).rows.some(row => row.id === item.row.id)) return;
    const habit = target && live.habits.find(value => value.id === target.habitId);
    const goalCopy=live.habitSettings.notifications.tone==="heroic"?"Каждый шаг приближает к дневной цели. Откройте привычки и продолжайте!"
      :live.habitSettings.notifications.tone==="ironic"?"Дневная цель сама себя не выполнит. Заглянем в привычки?":"Пора проверить дневную цель. Откройте привычки, когда будет удобно.";
    const body = item.row.kind === "habit" ? habitNotificationMessage(live.habitSettings.notifications.tone, "habit", item.row.id, language, `«${habit?.title ?? "GENESIS"}»`)
      : translateText(goalCopy, language);
    const primaryLabel = translateText(item.row.action === "complete" || item.row.action === "interval" ? "Выполнено" : "Добавить значение", language);
    const registration = await navigator.serviceWorker?.getRegistration();
    if (!active || privateDeviceAccessBlocked()) return;
    if(!await eventReceipt(item.key,userId,"reserve"))return;
    try {
    const options = { body, tag: `genesis-habit-local-${item.key}`, silent: presentWebReminder("habit", habit?.title ?? "GENESIS", body),
      data: { habitTarget: item.row, userId, url: `${appBase || "/"}#habits` },
      actions: item.row.kind === "habit" ? [{action:"primary",title:primaryLabel},{action:"snooze",title:translateText("Отложить",language)}] : [] };
    if (registration) await registration.showNotification(habit?.title ?? "GENESIS", options);
    else { const notification = new Notification(habit?.title ?? "GENESIS", options);
      notification.onclick = () => { window.focus();window.dispatchEvent(new CustomEvent("genesis:local-habit-reminder", { detail: { userId, target:item.row, action:"open" } })); }; }
    receipts[item.key] = Date.now();
    recordHabitReminderTelemetry("delivered",item.key,item.row.kind==="goal");
    localStorage.setItem(receiptsKey(userId), JSON.stringify(Object.fromEntries(Object.entries(receipts).filter(([,at]) => at > Date.now() - 7*86400000))));
    await eventReceipt(item.key,userId,"commit");
    } catch(error) {await eventReceipt(item.key,userId,"release");throw error;}
  });
  const timers = rows.flatMap(item => {
    const delay = Date.parse(item.due) - Date.now();
    return delay < -5*60_000 || delay > 24*3600000 ? [] : [window.setTimeout(() => void deliver(item).catch(() => undefined), Math.max(0, delay))];
  });
  return () => { active = false;timers.forEach(timer => window.clearTimeout(timer)); };
}
