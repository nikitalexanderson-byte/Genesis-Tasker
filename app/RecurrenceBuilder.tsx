"use client";
import type { ReactNode } from "react";

import { formatCalendarDateValue, getLunarDate, getSacredDate, MONTHS, type CalendarMode } from "./calendar-data";
import {
  buildRecurrenceDates,
  alignRecurrenceConfigWithCalendar,
  calendarModeForRecurrence,
  convertTrackerRecurrenceCalendar,
  lunarMonthOptions,
  MAX_RECURRENCE_OCCURRENCES,
  normalizeRecurrenceConfig,
  RECURRENCE_MODE_COPY,
  recurrenceDefaultEndDate,
  recurrenceMaximumEndDate,
  suggestedRecurrenceDays,
  type RecurrenceConfig,
} from "./task-recurrence";
import { CalendarDatePicker } from "./CalendarDatePicker";
import { RecordCalendarChoice } from "./RecordCalendarChoice";
import { useSacredFeaturesEnabled } from "./sacred-features";
import { getRuntimeLanguage, translateText } from "./i18n";

const PYATA_DAY_LABELS = ["I", "II", "III", "IIII", "V"];
const PYATA_LABELS = ["I пята", "II пята", "III пята", "IIII пята", "V пята", "VI пята"];
const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const ALL_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];
const ALL_PYATAS = [1, 2, 3, 4, 5, 6];
const ODD_PYATAS = [1, 3, 5];
const EVEN_PYATAS = [2, 4, 6];
const SACRED_MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);

const CLASSIC_PATTERN_COPY = {
  daily: "Каждый день",
  weekdays: "По дням недели",
  monthly: "Каждый месяц",
  yearly: "Каждый год",
} as const;

function sameNumbers(left: number[], right: number[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function effectiveSelection(selected: number[], all: number[]) {
  return selected.length ? selected : all;
}

function toggleSelection(selected: number[], item: number, all: number[]) {
  if (selected.length === 0) return [item];
  const current = effectiveSelection(selected, all);
  if (current.includes(item) && current.length === 1) return selected;
  const next = current.includes(item)
    ? current.filter((value) => value !== item)
    : [...current, item].sort((left, right) => left - right);
  return sameNumbers(next, all) ? [] : next;
}

export function RecurrenceBuilder({
  value: rawValue,
  onChange,
  startDate,
  destination = "calendar",
  calendarMode = "profane",
  lockRangeStart = false,
  allowCalendarModeChange = false,
  headerControls,
  footerControls,
  sharedSeries = false,
}: {
  value: RecurrenceConfig;
  onChange: (value: RecurrenceConfig) => void;
  startDate: string;
  destination?: "calendar" | "tasks" | "tracker";
  calendarMode?: CalendarMode;
  lockRangeStart?: boolean;
  allowCalendarModeChange?: boolean;
  headerControls?: ReactNode;
  footerControls?: ReactNode;
  sharedSeries?: boolean;
}) {
  const isEnglish = getRuntimeLanguage() === "en";
  // Tracker schedules keep the calendar in which they were created. Aligning a
  // saved classic schedule with a later account preference replaces its days
  // with the start weekday (often Friday), so only new task recurrences follow
  // the currently selected account calendar.
  const value = destination === "tracker"
    ? normalizeRecurrenceConfig(rawValue)
    : normalizeRecurrenceConfig(alignRecurrenceConfigWithCalendar(rawValue, calendarMode, startDate));
  const sacredFeaturesEnabled = useSacredFeaturesEnabled();
  const shortDate = (date: string, mode: CalendarMode, includeYear = false) =>
    formatCalendarDateValue(date, sacredFeaturesEnabled ? mode : "profane", includeYear, value.calendarContext);
  const displayCalendarMode = destination === "tracker"
    ? calendarModeForRecurrence(value.mode)
    : calendarMode;
  const rangeStart = value.rangeStart && value.rangeStart >= startDate ? value.rangeStart : startDate;
  const maximumEnd = recurrenceMaximumEndDate(rangeStart);
  const rangeEnd = value.rangeEnd && value.rangeEnd >= rangeStart
    ? value.rangeEnd <= maximumEnd ? value.rangeEnd : maximumEnd
    : recurrenceDefaultEndDate(rangeStart);
  const lunarMonths = lunarMonthOptions(rangeStart, rangeEnd, value.calendarContext);
  const monthValues = value.pattern === "lunar-yearly" ? Array.from({ length: 13 }, (_, index) => index + 1)
    : value.mode === "lunar" ? lunarMonths.map((month) => month.value) : SACRED_MONTHS;
  const selectedMonths = effectiveSelection(value.months, monthValues);
  const selectedPyatas = effectiveSelection(value.pyatas, ALL_PYATAS);
  const trackerSacred = destination === "tracker" && value.mode === "genesis";
  const trackerLunar = destination === "tracker" && value.mode === "lunar";
  const lunarDaily = trackerLunar && value.pattern === "lunar-days" && !value.months.length
    && value.days.length === 30 && value.days.every((day, index) => day === index + 1);
  const sacredCadence = value.pattern === "month-days"
    ? value.months.length === 1 ? "yearly" : "monthly"
    : sameNumbers(value.days, [1, 2, 3, 4, 5]) && sameNumbers(value.pyatas, ODD_PYATAS) ||
      sameNumbers(value.days, [1, 2, 3, 4, 5]) && sameNumbers(value.pyatas, EVEN_PYATAS)
      ? "parity"
      : sameNumbers(value.days, [1, 2, 3, 4, 5]) && !value.pyatas.length && !value.months.length
        ? "daily" : "pyata-days";
  const previewDates = value.enabled ? buildRecurrenceDates(startDate, { ...value, rangeStart, rangeEnd }) : [startDate];
  const occurrenceCount = previewDates.length;
  const tooManyOccurrences = !sharedSeries && occurrenceCount > MAX_RECURRENCE_OCCURRENCES;

  const setPattern = (pattern: RecurrenceConfig["pattern"]) => {
    onChange({
      ...value,
      pattern,
      days: suggestedRecurrenceDays(value.mode, pattern, rangeStart, value.calendarContext),
      interval: 1,
    });
  };

  const toggleDay = (day: number) => {
    if (trackerSacred && (sacredCadence === "monthly" || sacredCadence === "yearly")) {
      onChange({ ...value, days: [day] });
      return;
    }
    const selected = value.days.includes(day);
    if (selected && value.days.length === 1) return;
    onChange({
      ...value,
      days: selected ? value.days.filter((item) => item !== day) : [...value.days, day].sort((left, right) => left - right),
    });
  };

  const changeCalendarMode = (nextMode: CalendarMode) => {
    if (nextMode === displayCalendarMode) return;
    onChange(convertTrackerRecurrenceCalendar(value, nextMode, rangeStart));
  };

  const setSacredCadence = (cadence: string) => {
    const sacred = getSacredDate(new Date(`${rangeStart}T12:00:00`), value.calendarContext);
    const day = sacred.monthIndex < 12 ? sacred.day : 1;
    onChange({ ...value,
      pattern: cadence === "monthly" || cadence === "yearly" ? "month-days" : "pyata-days",
      days: cadence === "daily" || cadence === "parity" ? ALL_PYATAS.slice(0, 5) : [cadence === "monthly" || cadence === "yearly" ? day : 1],
      months: cadence === "yearly" ? [sacred.monthIndex < 12 ? sacred.monthIndex + 1 : 1] : [],
      pyatas: cadence === "parity" ? ODD_PYATAS : [], interval: 1,
    });
  };

  const setLunarCadence = (cadence: string) => {
    const lunar = getLunarDate(new Date(`${rangeStart}T12:00:00`), value.calendarContext);
    onChange({ ...value,
      pattern: cadence === "daily" ? "lunar-days" : cadence as RecurrenceConfig["pattern"],
      days: cadence === "daily" ? Array.from({ length: 30 }, (_, index) => index + 1)
        : cadence === "lunar-decades" ? [Math.floor((lunar.day - 1) / 10) + 1]
        : cadence === "lunar-decade-days" ? [((lunar.day - 1) % 10) + 1]
        : cadence === "lunar-phases" ? [1] : [lunar.day],
      months: cadence === "lunar-yearly" ? [lunar.monthOrdinal] : [],
      pyatas: cadence === "lunar-decade-days" ? [Math.floor((lunar.day - 1) / 10) + 1] : [], interval: 1,
    });
  };

  const setWeekdayPreset = (days: number[]) => onChange({ ...value, days: [...days] });
  const setPyataPreset = (pyatas: number[]) => onChange({ ...value, pyatas: sameNumbers(pyatas, ALL_PYATAS) ? [] : [...pyatas] });
  const intervalUnit = value.pattern === "daily"
    ? "дн."
    : value.pattern === "weekdays"
      ? "нед."
      : value.pattern === "monthly" ? "мес." : "г.";

  return (
    <section className={`recurrence-builder${value.enabled ? " enabled" : ""}`} aria-label="Настройка повторения">
      {destination === "tracker" && allowCalendarModeChange ? <RecordCalendarChoice value={displayCalendarMode} onChange={changeCalendarMode} /> : null}
      {headerControls}
      {!sharedSeries ? <div className="recurrence-switch-row">
        <div>
          <strong>Повторение</strong>
          <small>{destination === "tracker" ? (value.enabled ? (isEnglish ? "Habit tracking on selected days. Google copies are optional." : "Привычка отслеживается в выбранные дни. Копии в Google подключаются отдельно.") : (isEnglish ? "Habit without recurrence" : "Привычка без повторений")) : value.enabled ? RECURRENCE_MODE_COPY[value.mode].description : "Одиночная задача без повторений"}</small>
        </div>
        <label className="recurrence-switch">
          <input
            type="checkbox"
            aria-label={isEnglish ? "Enable recurrence" : "Включить повторение"}
            checked={value.enabled}
            onChange={(event) => onChange({
              ...value,
              enabled: event.target.checked,
              rangeStart,
              rangeEnd,
              days: event.target.checked ? suggestedRecurrenceDays(value.mode, value.pattern, rangeStart, value.calendarContext) : value.days,
            })}
          />
          <span aria-hidden="true" />
          <b>{value.enabled ? "Включено" : "Выключено"}</b>
        </label>
      </div> : null}

      {value.enabled || destination === "tracker" ? (
          <fieldset className="recurrence-range">
            <legend>Период повторения</legend>
            {lockRangeStart ? <div className="recurrence-locked-start"><span>С какого</span><strong>{formatCalendarDateValue(rangeStart, displayCalendarMode, true, value.calendarContext)}</strong><small>{isEnglish ? "Start date · cannot be changed" : "Дата начала · изменить нельзя"}</small></div> : <label htmlFor="recurrence-range-start">
              <span>С какого</span>
              <CalendarDatePicker calculationContext={value.calendarContext} id="recurrence-range-start" mode={displayCalendarMode} min={startDate} value={rangeStart} showGregorianReference={destination !== "tracker"} onChange={(nextStart) => {
                const nextEnd = rangeEnd < nextStart ? recurrenceDefaultEndDate(nextStart) : rangeEnd;
                onChange({ ...value, rangeStart: nextStart, rangeEnd: nextEnd, months: value.mode === "lunar" && value.pattern !== "lunar-yearly" ? [] : value.months });
              }} />
            </label>}
            <label htmlFor="recurrence-range-end">
              <span>По какое</span>
              <CalendarDatePicker calculationContext={value.calendarContext} id="recurrence-range-end" mode={displayCalendarMode} min={rangeStart} max={maximumEnd} value={rangeEnd} showGregorianReference={destination !== "tracker"} onChange={(nextEnd) => onChange({
                ...value,
                rangeStart,
                rangeEnd: nextEnd,
                months: value.mode === "lunar" && value.pattern !== "lunar-yearly" ? [] : value.months,
              })} />
            </label>
            <small>Можно запланировать серию на срок до пяти лет.</small>
          </fieldset>
      ) : null}

      {value.enabled ? (
        <div className="recurrence-builder-body">


          {value.mode === "classic" ? (
            <>
              <div className="recurrence-pattern-toggle wrap" role="group" aria-label="Ритм григорианского календаря">
                {(Object.keys(CLASSIC_PATTERN_COPY) as Array<keyof typeof CLASSIC_PATTERN_COPY>).map((pattern) => (
                  <button type="button" key={pattern} className={value.pattern === pattern ? "active" : ""} aria-pressed={value.pattern === pattern} onClick={() => setPattern(pattern)}>{CLASSIC_PATTERN_COPY[pattern]}</button>
                ))}
              </div>
              {value.pattern === "weekdays" ? (
                <div className="recurrence-day-field">
                  <span>В какие дни недели</span>
                  <div className="recurrence-preset-row" role="group" aria-label="Готовые наборы дней">
                    <button type="button" className={sameNumbers(value.days, [1, 2, 3, 4, 5]) ? "active" : ""} onClick={() => setWeekdayPreset([1, 2, 3, 4, 5])}>Будни</button>
                    <button type="button" className={sameNumbers(value.days, [6, 7]) ? "active" : ""} onClick={() => setWeekdayPreset([6, 7])}>Выходные</button>
                    <button type="button" className={sameNumbers(value.days, ALL_WEEKDAYS) ? "active" : ""} onClick={() => setWeekdayPreset(ALL_WEEKDAYS)}>Все дни</button>
                  </div>
                  <div className="recurrence-day-grid" role="group" aria-label="Дни недели">
                    {WEEKDAY_LABELS.map((label, index) => {
                      const day = index + 1;
                      const selected = value.days.includes(day);
                      return <button type="button" key={day} className={selected ? "selected" : ""} aria-pressed={selected} onClick={() => toggleDay(day)}>{label}</button>;
                    })}
                  </div>
                </div>
              ) : (
                <p className="recurrence-pattern-explainer">
                    {destination === "tracker" && !sharedSeries ? (value.pattern === "daily"
                      ? "Привычка отслеживается через выбранное число календарных дней."
                      : value.pattern === "monthly" ? `Привычка отслеживается ${new Date(`${startDate}T12:00:00`).getDate()} числа выбранных месяцев.`
                      : `Привычка отслеживается ежегодно ${shortDate(startDate, displayCalendarMode)}.`) : value.pattern === "daily"
                    ? "Задача появится через выбранное число календарных дней."
                    : value.pattern === "monthly"
                      ? `Задача появится ${new Date(`${startDate}T12:00:00`).getDate()} числа выбранных месяцев.`
                      : `Задача появится ежегодно ${shortDate(startDate, displayCalendarMode)}.`}
                </p>
              )}
              <label className="recurrence-interval">
                <span>Интервал</span>
                <input type="number" min="1" max="99" value={value.interval} onChange={(event) => onChange({ ...value, interval: Math.min(99, Math.max(1, Number(event.target.value) || 1)) })} />
                <span>{intervalUnit}</span>
              </label>
            </>
          ) : null}

          {trackerSacred ? (
            <>
              <div className="recurrence-pattern-toggle wrap" role="group" aria-label={isEnglish ? "Sacred habit rhythm" : "Ритм сакральной привычки"}>
                {([
                  ["daily", isEnglish ? "Daily" : "Ежедневно"],
                  ["pyata-days", isEnglish ? "Pyata days" : "Дни пяты"],
                  ["parity", isEnglish ? "Odd/even pyatas" : "Чётная/нечётная"],
                  ["monthly", isEnglish ? "Monthly" : "Ежемесячно"],
                  ["yearly", isEnglish ? "Yearly" : "Ежегодно"],
                ] as const).map(([cadence, label]) => <button type="button" key={cadence} className={sacredCadence === cadence ? "active" : ""} aria-pressed={sacredCadence === cadence} onClick={() => setSacredCadence(cadence)}>{label}</button>)}
              </div>
              {sacredCadence === "parity" ? <div className="recurrence-preset-row" role="group" aria-label={isEnglish ? "Pyata parity" : "Чётность пят"}>
                <button type="button" className={sameNumbers(value.pyatas, ODD_PYATAS) ? "active" : ""} onClick={() => onChange({ ...value, pyatas: ODD_PYATAS })}>{isEnglish ? "Odd pyatas" : "Нечётные пяты"}</button>
                <button type="button" className={sameNumbers(value.pyatas, EVEN_PYATAS) ? "active" : ""} onClick={() => onChange({ ...value, pyatas: EVEN_PYATAS })}>{isEnglish ? "Even pyatas" : "Чётные пяты"}</button>
              </div> : null}
              {sacredCadence === "yearly" ? <div className="recurrence-day-field">
                <span>{isEnglish ? "Sacred month" : "Сакральный месяц"}</span>
                <div className="recurrence-month-grid sacred" role="group" aria-label={isEnglish ? "Sacred month" : "Сакральный месяц"}>
                  {MONTHS.slice(0, 12).map((month, index) => <button type="button" key={month.name} className={value.months.includes(index + 1) ? "selected" : ""} aria-pressed={value.months.includes(index + 1)} onClick={() => onChange({ ...value, months: [index + 1] })}><strong>{month.roman}</strong><span>{month.name}</span></button>)}
                </div>
              </div> : null}
              {sacredCadence === "monthly" || sacredCadence === "yearly" ? <small className="recurrence-selection-hint">{isEnglish ? "Apeiron days are excluded from this rhythm." : "Дни Апейрона исключены из этого ритма."}</small> : null}
            </>
          ) : value.mode === "genesis" ? (
            <>
              <div className="recurrence-pattern-toggle" role="group" aria-label="Ритм сакрального календаря">
                <button type="button" className={value.pattern === "pyata-days" ? "active" : ""} aria-pressed={value.pattern === "pyata-days"} onClick={() => setPattern("pyata-days")}>По пятам</button>
                <button type="button" className={value.pattern === "month-days" ? "active" : ""} aria-pressed={value.pattern === "month-days"} onClick={() => setPattern("month-days")}>По дням месяца</button>
              </div>
              <div className="recurrence-day-field">
                <div className="recurrence-field-heading">
                  <span>В какие сакральные месяцы</span>
                  <button type="button" disabled={value.months.length === 0} onClick={() => onChange({ ...value, months: [] })}>{value.months.length ? "Выбрать все" : "Все выбраны"}</button>
                </div>
                <div className="recurrence-month-grid sacred" role="group" aria-label="Сакральные месяцы">
                  {MONTHS.slice(0, 12).map((month, index) => {
                    const monthNumber = index + 1;
                    const selected = selectedMonths.includes(monthNumber);
                    return (
                      <button type="button" key={monthNumber} className={selected ? "selected" : ""} aria-pressed={selected} onClick={() => onChange({ ...value, months: toggleSelection(value.months, monthNumber, SACRED_MONTHS) })}>
                        <strong>{month.roman}</strong><span>{month.name}</span>
                      </button>
                    );
                  })}
                </div>
                <small className="recurrence-selection-hint">Нажмите месяц, чтобы оставить только его, затем добавьте остальные.</small>
              </div>
              {value.pattern === "pyata-days" ? (
                <div className="recurrence-day-field">
                  <span>В какие пяты месяца</span>
                  <div className="recurrence-preset-row" role="group" aria-label="Чётность пят">
                    <button type="button" className={sameNumbers(selectedPyatas, ALL_PYATAS) ? "active" : ""} onClick={() => setPyataPreset(ALL_PYATAS)}>Все</button>
                    <button type="button" className={sameNumbers(selectedPyatas, ODD_PYATAS) ? "active" : ""} onClick={() => setPyataPreset(ODD_PYATAS)}>Нечётные</button>
                    <button type="button" className={sameNumbers(selectedPyatas, EVEN_PYATAS) ? "active" : ""} onClick={() => setPyataPreset(EVEN_PYATAS)}>Чётные</button>
                  </div>
                  <div className="recurrence-day-grid pyatas" role="group" aria-label="Пяты месяца">
                    {PYATA_LABELS.map((label, index) => {
                      const pyata = index + 1;
                      const selected = selectedPyatas.includes(pyata);
                      return <button type="button" key={pyata} className={selected ? "selected" : ""} aria-pressed={selected} onClick={() => onChange({ ...value, pyatas: toggleSelection(value.pyatas, pyata, ALL_PYATAS) })}>{label}</button>;
                    })}
                  </div>
                </div>
              ) : null}
            </>
          ) : null}

          {trackerLunar ? <div className="recurrence-pattern-toggle wrap" role="group" aria-label={sharedSeries ? "Настройка повторения" : "Ритм лунной привычки"}>
            {([ ["daily", "Ежедневно"], ["lunar-days", "Дни месяца"], ["lunar-decades", "Декады"],
              ["lunar-decade-days", "Дни декады"], ["lunar-phases", "Новолуние / полнолуние"],
              ["lunar-yearly", "Ежегодно"] ] as const).map(([cadence, label]) =>
              <button type="button" key={cadence} className={(cadence === "daily" ? lunarDaily : !lunarDaily && value.pattern === cadence) ? "active" : ""}
                aria-pressed={cadence === "daily" ? lunarDaily : !lunarDaily && value.pattern === cadence}
                onClick={() => setLunarCadence(cadence)}>{label}</button>)}</div> : null}

          {trackerLunar && value.pattern === "lunar-decade-days" ? <div className="recurrence-day-field">
            <span>В каких декадах месяца</span><div className="recurrence-day-grid" role="group" aria-label="Декады месяца">
              {[1, 2, 3].map((decade) => <button type="button" key={decade} className={value.pyatas.includes(decade) ? "selected" : ""}
                aria-pressed={value.pyatas.includes(decade)} onClick={() => {
                  const next = value.pyatas.includes(decade) ? value.pyatas.filter((item) => item !== decade) : [...value.pyatas, decade];
                  if (next.length) onChange({ ...value, pyatas: next });
                }}>{decade} декада</button>)}</div></div> : null}
          {trackerLunar && value.pattern === "lunar-phases" ? <div className="recurrence-day-field">
            <span>Лунные события</span><div className="recurrence-day-grid" role="group" aria-label="Лунные события">
              {([[1, "Новолуние"], [2, "Полнолуние"]] as const).map(([phase, label]) => <button type="button" key={phase}
                className={value.days.includes(phase) ? "selected" : ""} aria-pressed={value.days.includes(phase)} onClick={() => toggleDay(phase)}>{label}</button>)}</div>
          </div> : null}
          {trackerLunar && value.pattern === "lunar-yearly" ? <div className="recurrence-day-field">
            <span>Лунный месяц года · 13-й бывает не каждый год</span>
            <div className="recurrence-day-grid dense" role="group" aria-label="Лунный месяц года">
              {Array.from({ length: 13 }, (_, index) => index + 1).map((month) => <button type="button" key={month}
                className={value.months.includes(month) ? "selected" : ""} aria-pressed={value.months.includes(month)}
                onClick={() => onChange({ ...value, months: [month] })}>{month}</button>)}
            </div></div> : null}
          {value.mode === "lunar" && value.pattern === "lunar-days" && !lunarDaily ? (
            <div className="recurrence-day-field">
              <div className="recurrence-field-heading">
                <span>В какие лунные месяцы</span>
                <button type="button" disabled={value.months.length === 0} onClick={() => onChange({ ...value, months: [] })}>{value.months.length ? "Выбрать все" : "Все выбраны"}</button>
              </div>
              <div className="recurrence-month-grid lunar" role="group" aria-label="Лунные месяцы">
                {lunarMonths.map((month) => {
                  const selected = selectedMonths.includes(month.value);
                  return (
                    <button type="button" key={month.value} className={selected ? "selected" : ""} aria-pressed={selected} onClick={() => onChange({ ...value, months: toggleSelection(value.months, month.value, monthValues) })}>
                      <strong>{month.value}</strong><span>{shortDate(month.startDate, displayCalendarMode)} — {shortDate(month.endDate, displayCalendarMode)}</span>
                    </button>
                  );
                })}
              </div>
              <small className="recurrence-selection-hint">Нажмите месяц, чтобы оставить только его, затем добавьте остальные.</small>
            </div>
          ) : null}

          {value.mode !== "classic" || value.pattern === "weekdays" ? (
            value.mode === "classic" ? null : (
              trackerSacred && (sacredCadence === "daily" || sacredCadence === "parity") ||
              trackerLunar && (lunarDaily || value.pattern === "lunar-phases") ? null :
              <div className="recurrence-day-field">
                <span>{value.mode === "lunar" ? value.pattern === "lunar-decades" ? "Декады месяца" : value.pattern === "lunar-decade-days" ? "Дни внутри выбранных декад" : "В какие дни лунного месяца" : value.pattern === "pyata-days" ? "Какие дни внутри пяты" : "Какие дни сакрального месяца"}</span>
                <div className={`recurrence-day-grid${value.mode === "genesis" && value.pattern === "pyata-days" ? "" : " dense"}`} role="group" aria-label="Дни повторения">
                  {(value.mode === "genesis" && value.pattern === "pyata-days" ? PYATA_DAY_LABELS : Array.from({ length: value.pattern === "lunar-decades" ? 3 : value.pattern === "lunar-decade-days" ? 10 : 30 }, (_, index) => String(index + 1))).map((label, index) => {
                    const day = index + 1;
                    const selected = value.days.includes(day);
                    return <button type="button" key={day} className={selected ? "selected" : ""} aria-pressed={selected} onClick={() => toggleDay(day)}>{label}</button>;
                  })}
                </div>
              </div>
            )
          ) : null}

          {!sharedSeries ? <div className={`recurrence-summary${tooManyOccurrences ? " warning" : ""}`} role={tooManyOccurrences ? "alert" : "status"}>
            <strong>{occurrenceCount}</strong>
            <span>{tooManyOccurrences
              ? (isEnglish
                  ? `Too many recurrences. Shorten the period or choose fewer dates — maximum ${MAX_RECURRENCE_OCCURRENCES}.`
                  : `Слишком много повторений. Сократите период или выберите меньше дат — максимум ${MAX_RECURRENCE_OCCURRENCES}.`)
              : (isEnglish
                  ? `— number of ${destination === "tracker" ? "tracker dates" : "recurrences of one task"} from ${shortDate(rangeStart, displayCalendarMode, true)} to ${shortDate(rangeEnd, displayCalendarMode, true)}`
                  : `— количество ${destination === "tracker" ? "дней трекинга" : "повторений одной задачи"} с ${shortDate(rangeStart, displayCalendarMode, true)} по ${shortDate(rangeEnd, displayCalendarMode, true)}`)}</span>
          </div> : null}

          <div className="recurrence-selection-hint" aria-live="polite">
            <p>{translateText("Следующие даты: {dates}").replace("{dates}", previewDates.slice(0, 5).map(date => formatCalendarDateValue(date, displayCalendarMode, true, value.calendarContext)).join(" · ") || "—")}</p>
            <p>{translateText("Часовой пояс повторения: {zone}").replace("{zone}", value.calendarContext!.timeZone)}</p>
            <p>{translateText("Несуществующие дни пропускаются. Апейрон не входит в сакральные повторы; 13-й лунный месяц выбирается только в годах, где он есть.")}</p>
            {value.mode === "genesis" && value.calendarContext?.version === 1 ? <p>{translateText("Сохранённое расписание использует прежнее начало сакрального года — 20 марта.")}</p> : null}
          </div>
          {!sharedSeries ? <small className="recurrence-sync-note">
            {destination === "tracker"
              ? (isEnglish
                  ? "GENESIS stores the habit and its recurrence. Google copies are created only when you enable them below."
                  : "Привычка и её повторение хранятся в GENESIS. Копии в Google создаются только по вашему выбору ниже.")
              : destination === "tasks"
              ? (isEnglish
                  ? "Google Tasks has no recurrence API, so GENESIS will safely store this as one recurring Google Calendar event."
                  : "Google Tasks не поддерживает серии, поэтому GENESIS безопасно сохранит повтор как одно событие-серию в Google Calendar.")
              : (isEnglish
                  ? `GENESIS will save one task, and Google Calendar will save one recurring event with all ${value.mode === "lunar" ? "lunar" : value.mode === "genesis" ? "sacred" : "selected"} dates.`
                  : `GENESIS сохранит одну задачу, а Google Calendar — одно повторяющееся событие со всеми ${value.mode === "lunar" ? "лунными" : value.mode === "genesis" ? "сакральными" : "выбранными"} датами.`)}
          </small> : null}
        </div>
      ) : null}
      {footerControls}
    </section>
  );
}
