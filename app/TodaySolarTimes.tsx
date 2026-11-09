import { ExperimentalIcon } from "./ExperimentalIcon";
import { translateText, type Language } from "./i18n";
import { formatDeviceSolarTime, getDeviceDaySolarTimes, type DeviceLocation } from "./solar-times";
import type { TimeFormat } from "./time-format";

/** Month navigation must never change the civil day or time zone of this summary. */
export function TodaySolarTimes({ today, location, deviceTimeZone, approximate, ready, language, timeFormat, compact = false }: {
  today: Date; location: DeviceLocation | null; deviceTimeZone: string; approximate: boolean;
  ready: boolean; language: Language; timeFormat: TimeFormat; compact?: boolean;
}) {
  const t = (text: string) => translateText(text, language);
  const events = location ? getDeviceDaySolarTimes(today, location, deviceTimeZone) : null;
  return <div className={`calendar-solar-control status-${ready ? "ready" : "loading"}`} aria-live="polite">
    <div className="calendar-today-solar">
      <strong>{t("Сегодня")}</strong>
      <span className="calendar-solar-events">{(["sunrise", "sunset"] as const).map(event => {
        const label = t(event === "sunrise" ? "Рассвет" : "Закат");
        const date = events?.[event];
        return <span className="calendar-solar-event" key={event} title={label}>
          <ExperimentalIcon name={event}/><span className="calendar-solar-event-label">{label}</span>
          {date ? <time dateTime={date.toISOString()}>{approximate ? "≈" : ""}{formatDeviceSolarTime(date, deviceTimeZone, timeFormat)}</time> : <span>{ready ? t("нет") : "…"}</span>}
        </span>;
      })}</span>
    </div>
    {!compact ? <small>{deviceTimeZone} · {t("время устройства")} · {t(approximate ? "приблизительный расчёт для региона устройства" : "координаты выбранного города")}</small> : null}
  </div>;
}
