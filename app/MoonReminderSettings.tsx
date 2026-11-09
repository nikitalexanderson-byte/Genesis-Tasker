"use client";

import { useEffect, useState } from "react";
import { MOON_SETTINGS_CHANGED, planMoonReminders, readMoonReminderSettings, saveMoonReminderSettings } from "./moon-reminders";
import { privateDeviceAccessBlocked } from "./local-sign-out";

export function MoonReminderSettings({ accountId, english, permission, requestPermission }: {
  accountId: string; english: boolean; permission: string; requestPermission: () => Promise<unknown>;
}) {
  const [settings, setSettings] = useState(() => readMoonReminderSettings(accountId));
  return <section className="account-preferences settings-reminders-panel" data-settings-group="reminders">
    <div><span className="eyebrow">GENESIS</span><h3>{english ? "Lunar reminders" : "Лунные напоминания"}</h3>
      <p>{english ? "Choose one or several lead times for each phase. Notifications arrive at 09:00 device time."
        : "Выберите один или несколько сроков для каждой фазы. Напоминания приходят в 09:00 по времени устройства."}</p></div>
    {(["full", "new"] as const).map((kind) => <fieldset className="moon-reminder-choices" key={kind}>
      <legend>{kind === "full" ? english ? "Full moon" : "Полнолуние" : english ? "New moon" : "Новолуние"}</legend>
      <div>{[0, 1, 2, 3].map((days) => <button type="button" key={days}
        aria-pressed={days === 0 ? !settings[kind].length : settings[kind].includes(days)}
        onClick={() => {
          const next = { ...settings, [kind]: days === 0 ? [] : settings[kind].includes(days)
            ? settings[kind].filter((day) => day !== days) : [...settings[kind], days].sort() };
          setSettings(next); saveMoonReminderSettings(accountId, next);
        }}>{days === 0 ? english ? "Off" : "Выключено" : english ? `${days} day${days > 1 ? "s" : ""} before` : `За ${days} ${days === 1 ? "сутки" : "суток"}`}</button>)}</div>
    </fieldset>)}
    <div className="moon-reminder-delivery">
      <small>{english ? "Saved for this account on this device. The website must be open for browser delivery."
      : "Настройки сохраняются для этого аккаунта на устройстве. Для доставки в браузере сайт должен быть открыт."}</small>
    {permission !== "granted" ? <button type="button" className="secondary-button" onClick={() => void requestPermission()}>
      {english ? "Allow browser notifications" : "Разрешить уведомления браузера"}</button> : null}
    </div>
  </section>;
}

export function useMoonReminders(accountId: string | null, english: boolean) {
  useEffect(() => {
    if (!accountId || typeof Notification === "undefined") return;
    let alive = true;
    let checking = false;
    const sentKey = `genesis-moon-reminders-sent-v1:${accountId}`;
    const check = async () => {
      if (!alive || checking || privateDeviceAccessBlocked() || Notification.permission !== "granted") return;
      checking = true;
      try {
        const now = new Date();
        const plans = planMoonReminders(new Date(now.getTime() - 6 * 3_600_000), readMoonReminderSettings(accountId), 7);
        let stored: unknown = [];
        try { stored = JSON.parse(localStorage.getItem(sentKey) || "[]"); } catch { /* A damaged receipt cache must not block scheduling. */ }
        const sent = new Set(Array.isArray(stored) ? stored.filter((key) => typeof key === "string") : []);
        for (const plan of plans) {
          if (!alive || plan.at > now || sent.has(plan.key)) continue;
          const title = plan.kind === "full" ? english ? "Full moon" : "Полнолуние" : english ? "New moon" : "Новолуние";
          const body = `${plan.eventDate} · ${english ? `in ${plan.leadDays} day${plan.leadDays > 1 ? "s" : ""}` : `через ${plan.leadDays} ${plan.leadDays === 1 ? "сутки" : "суток"}`}`;
          const options = { body, tag: `moon-${accountId}-${plan.key}`, icon: "/icons/icon-192.png" };
          const registration = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : null;
          if (!alive || privateDeviceAccessBlocked()) break;
          if (registration) await registration.showNotification(title, options);
          else new Notification(title, options);
          sent.add(plan.key);
          if (!privateDeviceAccessBlocked()) localStorage.setItem(sentKey, JSON.stringify([...sent].slice(-200)));
        }
      } catch { /* Retry on the next wake-up, without interrupting the workspace. */ }
      finally { checking = false; }
    };
    void check();
    const timer = window.setInterval(() => void check(), 60_000);
    const wake = () => void check();
    window.addEventListener(MOON_SETTINGS_CHANGED, wake);
    window.addEventListener("storage", wake);
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    return () => { alive = false; window.clearInterval(timer); window.removeEventListener(MOON_SETTINGS_CHANGED, wake);
      window.removeEventListener("storage", wake); window.removeEventListener("focus", wake); document.removeEventListener("visibilitychange", wake); };
  }, [accountId, english]);
}
