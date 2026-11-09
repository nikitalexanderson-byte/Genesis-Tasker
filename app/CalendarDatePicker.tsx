"use client";
import { DialogCloseButton } from "./DialogCloseButton";
import { civilDateCarrier, isCivilDate, type CalendarContext } from "./calendar-context";

import { useMemo, useRef, useState } from "react";
import {
  type CalendarMode,
  MONTHS,
  formatCalendarDate,
  formatGregorian,
  getGregorianDate,
  getLunarDate,
  getLunarMonthDates,
  getMoon,
  getSacredDay,
  getSacredDate,
  lunarMonthIndex,
} from "./calendar-data";
import { MoonPhaseIcon } from "./MoonPhaseIcon";
import { getRuntimeLanguage, runtimeLocale } from "./i18n";
import { useDialogAccessibility } from "./use-dialog-accessibility";
import { useSacredFeaturesEnabled } from "./sacred-features";

type CalendarDatePickerProps = {
  id?: string;
  value: string;
  mode: CalendarMode;
  calculationContext?: CalendarContext;
  min?: string;
  max?: string;
  required?: boolean;
  ariaLabel?: string;
  showGregorianReference?: boolean;
  triggerText?: string;
  referencePlacement?: "below" | "inline";
  onChange: (value: string) => void;
};

function inputDate(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function parseDate(value: string) {
  const viewportDate = isCivilDate(value) ? value : inputDate(new Date());
  return civilDateCarrier(viewportDate < "1900-01-01" ? "1900-01-01" : viewportDate > "2100-12-31" ? "2100-12-31" : viewportDate);
}

function allowed(value: string, min?: string, max?: string) {
  return isCivilDate(value) && value >= "1900-01-01" && value <= "2100-12-31" && (!min || value >= min) && (!max || value <= max);
}

function formatCompactGregorian(date: Date) {
  const locale = runtimeLocale();
  const dateLabel = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).format(date);
  const weekdayLabel = new Intl.DateTimeFormat(locale, { weekday: "short" })
    .format(date)
    .replace(/\.$/u, "");
  const capitalizedWeekday = weekdayLabel.charAt(0).toLocaleUpperCase(locale) + weekdayLabel.slice(1);
  return `${dateLabel} ${capitalizedWeekday}`;
}

export function CalendarDatePicker({ id, value, mode: savedMode, calculationContext, min, max, required, ariaLabel, showGregorianReference = true, triggerText, referencePlacement = "below", onChange }: CalendarDatePickerProps) {
  const mode = useSacredFeaturesEnabled() ? savedMode : "profane";
  const isEnglish = getRuntimeLanguage() === "en";
  const [open, setOpen] = useState(false);
  const selectedDate = useMemo(() => parseDate(value), [value]);
  const selectedSacred = useMemo(() => getSacredDate(selectedDate, calculationContext), [selectedDate, calculationContext]);
  const [sacredYear, setSacredYear] = useState(selectedSacred.sacredYear);
  const [sacredMonth, setSacredMonth] = useState(selectedSacred.monthIndex);
  const [lunarMonth, setLunarMonth] = useState(() => lunarMonthIndex(selectedDate, calculationContext));
  const dialogRef = useDialogAccessibility<HTMLElement>(() => setOpen(false), open);
  const nativeDate = useRef<HTMLInputElement>(null);

  if (mode === "profane") {
    if(triggerText)return <span className="calendar-compact-date">
      <button id={id} type="button" className="calendar-date-trigger no-reference" aria-label={ariaLabel} onClick={()=>{const input=nativeDate.current;if(!input)return;if(typeof input.showPicker==='function')input.showPicker();else{input.focus();input.click();}}}>{triggerText}</button>
      <input ref={nativeDate} className="calendar-compact-native-input" type="date" aria-label={ariaLabel} tabIndex={-1} aria-hidden="true" value={value} min={min??"1900-01-01"} max={max??"2100-12-31"} required={required}
       onChange={event=>{if(allowed(event.target.value,min,max))onChange(event.target.value);}}/>
    </span>;
    return <input id={id} type="date" value={value} min={min && min > "1900-01-01" ? min : "1900-01-01"} max={max && max < "2100-12-31" ? max : "2100-12-31"} required={required} aria-label={ariaLabel} data-genesis-preserve="gregorian-date-picker" onChange={(event) => { if (!event.target.value || allowed(event.target.value, min, max)) onChange(event.target.value); }} />;
  }

  const choose = (date: Date) => {
    const next = inputDate(date);
    if (!allowed(next, min, max)) return;
    onChange(next);
    setOpen(false);
  };
  const openPicker = () => {
    setSacredYear(selectedSacred.sacredYear);
    setSacredMonth(selectedSacred.monthIndex);
    setLunarMonth(lunarMonthIndex(selectedDate, calculationContext));
    setOpen(true);
  };
  const month = MONTHS[sacredMonth];
  const sacredDays = month.days
    .map((day) => getSacredDay(sacredMonth, day.day))
    .filter((day) => sacredMonth !== 12 || day.day <= getSacredDate(getGregorianDate(sacredYear, 0, 1, calculationContext), calculationContext).apeironDays);
  const lunarDates = getLunarMonthDates(lunarMonth, calculationContext);
  const lunarTitleDate = lunarDates[Math.floor(lunarDates.length / 2)] ?? selectedDate;
  const lunarTitle = getLunarDate(lunarTitleDate, calculationContext);

  return (
    <>
      <button id={id} type="button" className={`calendar-date-trigger mode-${mode}${showGregorianReference ? "" : " no-reference"}${referencePlacement === "inline" ? " inline-reference" : ""}`} data-genesis-preserve={`${mode}-date-picker-trigger`} onClick={openPicker} aria-label={ariaLabel} aria-haspopup="dialog">
        <span>{value ? triggerText ?? (value >= "1900-01-01" && value <= "2100-12-31" && isCivilDate(value) ? formatCalendarDate(selectedDate, mode, true, calculationContext) : value) : isEnglish ? "Choose date" : "Выберите дату"}</span>
        {value && showGregorianReference ? <small>{referencePlacement === "inline" ? `(${value.split("-").reverse().join(".")})` : formatGregorian(selectedDate, true)}</small> : null}
      </button>
      {open ? (
        <div className="modal-backdrop calendar-picker-backdrop" role="presentation" data-genesis-preserve={`${mode}-date-picker`} onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <section ref={dialogRef} className={`calendar-picker mode-${mode}`} role="dialog" aria-modal="true" aria-label={mode === "sacred" ? "Выбор сакральной даты" : "Выбор лунной даты"} tabIndex={-1}>
            <DialogCloseButton type="button" className="modal-close" onClick={() => setOpen(false)} aria-label="Закрыть" />
            <span className="eyebrow">{mode === "sacred" ? "Сакральный календарь" : "Лунный календарь"}</span>
            <h2>{mode === "sacred" ? "Выберите день круга" : "Выберите лунный день"}</h2>
            {mode === "sacred" ? (
              <>
                <div className="calendar-picker-controls">
                  <button type="button" disabled={sacredYear <= 1899} onClick={() => setSacredYear((current) => current - 1)} aria-label="Предыдущий сакральный год">←</button>
                  <strong>{sacredYear}–{sacredYear + 1}</strong>
                  <button type="button" disabled={sacredYear >= 2100} onClick={() => setSacredYear((current) => current + 1)} aria-label="Следующий сакральный год">→</button>
                </div>
                <div className="calendar-picker-months" role="listbox" aria-label="Сакральный месяц">
                  {MONTHS.map((item) => <button type="button" className={item.index === sacredMonth ? "active" : ""} onClick={() => setSacredMonth(item.index)} key={item.index}>{item.roman}</button>)}
                </div>
                <header className="calendar-picker-heading"><strong>{month.name}</strong><span>{month.title}</span></header>
                <div className="sacred-picker-days">
                  {sacredDays.map((day) => {
                    const date = getGregorianDate(sacredYear, sacredMonth, day.day, calculationContext);
                    const dateValue = inputDate(date);
                    return (
                      <button type="button" disabled={!allowed(dateValue, min, max)} className={dateValue === value ? "selected" : ""} onClick={() => choose(date)} key={day.id}>
                        <small>Пята {day.pyata || "Ω"}</small><strong>{day.day}</strong><span>{day.name.split("(")[0].trim()}</span>
                        <time dateTime={dateValue}>{formatCompactGregorian(date)}</time>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <>
                <div className="calendar-picker-controls">
                  <button type="button" disabled={inputDate(lunarDates[0]) <= "1900-01-01"} onClick={() => setLunarMonth((current) => current - 1)} aria-label="Предыдущий лунный месяц">←</button>
                  <strong>{lunarTitle.month.name} · {lunarTitle.month.roman}</strong>
                  <button type="button" disabled={inputDate(lunarDates[lunarDates.length - 1]) >= "2100-12-31"} onClick={() => setLunarMonth((current) => current + 1)} aria-label="Следующий лунный месяц">→</button>
                </div>
                <p className="calendar-picker-note">{lunarTitle.month.title}. {isEnglish
                  ? "The month begins at the exact new moon and is divided into the Decades of Growth, Fullness, and Outflow."
                  : "Месяц начинается точным новолунием и делится на декады Роста, Полноты и Исхода."}</p>
                <div className="lunar-picker-days">
                  {lunarDates.map((date) => {
                    const dateValue = inputDate(date);
                    const moon = getMoon(date, calculationContext);
                    const lunar = getLunarDate(date, calculationContext);
                    return (
                      <button type="button" disabled={!allowed(dateValue, min, max)} className={dateValue === value ? "selected" : ""} onClick={() => choose(date)} key={dateValue}>
                        <MoonPhaseIcon phaseStep={moon.phaseStep} size={24} /><strong>{moon.day}</strong><span>{lunar.isThreshold ? "Рубеж" : lunar.decade.name}</span><small>{moon.phase} · {moon.illumination}%</small>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </section>
        </div>
      ) : null}
    </>
  );
}
