import { useCallback, useEffect, useRef, useState } from "react";
import { deleteHabitReminderDevice, loadHabitReminderStatus, refreshHabitReminderPlan, registerHabitReminderDevice, type HabitReminderStatus } from "./cloud-sync";
import { habitReminderFrequency, habitReminderFrequencyKey, type HabitReminderFrequency } from "./habit-reminder-device";
import { runtimeLocale, translateText, type Language } from "./i18n";
import "./habit-reminders.css";
import { waitForSharedPush } from "./shared-push-device";

export function HabitReminderSettings({ userId, language }: { userId: string; language: Language }) {
  const t = (text: string) => translateText(text, language);
  const [status, setStatus] = useState<HabitReminderStatus | null>(null);
  const [frequency, setFrequency] = useState<HabitReminderFrequency>(() => habitReminderFrequency(userId));
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const alive = useRef(true);
  const operation = useRef<AbortController|null>(null);
  const supported = typeof window !== "undefined" && window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const enabled = Boolean(status?.device?.enabled);
  const load = useCallback(async () => {
    const value = await loadHabitReminderStatus(userId);
    if (!alive.current) return;
    setStatus(value);
    if (value.device?.enabled) {
      const saved = { maxPerDay: Number(value.device.max_per_day), snoozeMinutes: Number(value.device.snooze_minutes) };
      setFrequency(saved); localStorage.setItem(habitReminderFrequencyKey(userId), JSON.stringify(saved));
    }
  }, [userId]);
  useEffect(() => {
    alive.current = true;
    void Promise.resolve().then(load).catch(() => { if (alive.current) setError(translateText("Не удалось проверить напоминания. Повторите при доступной сети.",language)); });
    return () => { alive.current = false;operation.current?.abort(); };
  }, [load,language]);
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    operation.current=new AbortController();
    setBusy(true); setError("");
    try { await action(); }
    catch { if(alive.current)await load().catch(()=>undefined);if (alive.current) setError(t("Не удалось изменить напоминания. Проверьте разрешение браузера и сеть, затем повторите.")); }
    finally { if (alive.current) setBusy(false); }
  };
  const register = async (next: HabitReminderFrequency, requestPermission: boolean) => {
    const signal=operation.current!.signal;
    if (requestPermission && await waitForSharedPush(Notification.requestPermission(),signal) !== "granted") throw Error("PERMISSION_REQUIRED");
    if(!alive.current||signal.aborted)return;
    if (Notification.permission !== "granted" || !status?.capabilities.publicKey) throw Error("PERMISSION_REQUIRED");
    const registration = await waitForSharedPush(navigator.serviceWorker.getRegistration(),signal);
    if (!registration) throw Error("SERVICE_WORKER_REQUIRED");
    const publicKey = status.capabilities.publicKey;
    const bytes = Uint8Array.from(atob(publicKey.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - publicKey.length % 4) % 4)), c => c.charCodeAt(0));
    const existing=await waitForSharedPush(registration.pushManager.getSubscription(),signal);
    const subscription = existing ?? await waitForSharedPush(registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes }),signal,
      late=>{void late.unsubscribe().catch(()=>undefined);});
    if(!alive.current||signal.aborted){if(!existing)void subscription.unsubscribe().catch(()=>undefined);return;}
    await registerHabitReminderDevice(userId, subscription, next, Number(status.device?.revision ?? 0), crypto.randomUUID());
    if (!alive.current) return;
    await refreshHabitReminderPlan(); await load();
    window.dispatchEvent(new Event("genesis:habit-reminders-changed"));
  };
  const toggle = () => run(async () => {
    if (enabled && status?.device) {
      await deleteHabitReminderDevice(status.device);
      const registration = await navigator.serviceWorker.getRegistration();
      for (const notification of await registration?.getNotifications() ?? []) if (notification.data?.habitDeliveryId || notification.data?.habitTarget) notification.close();
      // A subscription may also serve shared affairs. Remove only this habit channel on the server.
      await load(); window.dispatchEvent(new Event("genesis:habit-reminders-changed"));
    } else await register(frequency, true);
  });
  const change = (next: HabitReminderFrequency) => run(async () => {
    if (enabled) await register(next, false);
    localStorage.setItem(habitReminderFrequencyKey(userId), JSON.stringify(next));setFrequency(next);
    window.dispatchEvent(new Event("genesis:habit-reminders-changed"));
  });
  return <div className="habit-background-settings">
    <h4>{t("Напоминания при закрытой вкладке")}</h4>
    <p>{t("Фоновые напоминания используют расписание без названий привычек и заметок. Текст уведомления нейтральный. Быстрое действие применяется после открытия вашего пространства.")}</p>
    <div className="habit-reminder-buttons">
      <button type="button" className="secondary-button" disabled={busy || !status || !enabled && (!supported || !status.capabilities.available)} onClick={() => void toggle()}>
        {t(busy ? "Сохранение…" : enabled ? "Отключить фоновые напоминания" : "Включить фоновые напоминания")}
      </button>
      <button type="button" className="text-button" disabled={busy} onClick={() => void run(async () => {
        const current=await loadHabitReminderStatus(userId);
        if(current.hasDevices) await refreshHabitReminderPlan();await load();
        window.dispatchEvent(new Event("genesis:habit-reminders-changed"));
      })}>{t("Обновить статус")}</button>
    </div>
    <p role="status">{!supported ? t("Этот браузер не поддерживает фоновые напоминания. Напоминания доступны, пока вкладка открыта.")
      : status && !status.capabilities.available ? t("Сервер фоновых напоминаний пока недоступен. Напоминания доступны, пока вкладка открыта.")
      : enabled && status?.profile && !status.profile.needsRefresh && status.profile.expiresAt
        ? `${t("Расписание подготовлено до")} ${new Date(status.profile.expiresAt).toLocaleString(runtimeLocale())}`
        : enabled ? t("Расписание требует обновления. Откройте приложение при доступной сети.") : t("Фоновые напоминания выключены на этом устройстве.")}</p>
    <p className="habit-reminder-note">{t("Доставка зависит от браузера и ОС. В iOS установите сайт на главный экран. Регулярно открывайте GENESIS для продления расписания.")}</p>
    <div className="habit-reminder-frequency">
      <label><span>{t("Максимум напоминаний за день")}</span><select disabled={busy} value={frequency.maxPerDay} onChange={event => void change({ ...frequency, maxPerDay: Number(event.target.value) })}>
        {[4,12,24,64,128].map(value => <option key={value} value={value}>{value}</option>)}
      </select></label>
      <label><span>{t("Отложить на, минут")}</span><select disabled={busy} value={frequency.snoozeMinutes} onChange={event => void change({ ...frequency, snoozeMinutes: Number(event.target.value) })}>
        {[5,10,15,30,60].map(value => <option key={value} value={value}>{value}</option>)}
      </select></label>
    </div>
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}
