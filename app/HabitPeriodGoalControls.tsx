
import { habitDisplayText } from "./habit-display-text";
import { useState } from "react";
import type { Habit, HabitWorkspace } from "./habits";
import { addCivilDays, calendarContext, momentCivilDate } from "./calendar-context";
import { formatCalendarDateValue, type CalendarMode } from "./calendar-data";
import { formatHabitValue, parseHabitValue } from "./habit-measurement";
import { habitPeriodProgress } from "./habit-period-progress";
import { habitGoalPeriod, type HabitPeriodGoal } from "./habit-period-goal";
import { translateText, type Language } from "./i18n";
import "./habit-period-goal.css";
import { useSacredFeaturesEnabled } from "./sacred-features";

export function HabitPeriodGoalFields({ habit, language, calendarMode, isExisting, hadPeriodGoal = false, onChange, onValidity }: {
  habit: Habit; language: Language; calendarMode: CalendarMode; isExisting: boolean;
  hadPeriodGoal?: boolean;
  onChange: (habit: Habit) => void; onValidity: (valid: boolean) => void;
}) {
  const t = (text: string) => translateText(text, language);
  const goal = habit.periodGoal;
  const sacredFeaturesEnabled = useSacredFeaturesEnabled();
  const [target, setTarget] = useState(String(goal ? goal.target / (goal.metric === "sum" ? 1000 : 1) : 3));
  const [invalid, setInvalid] = useState(false);
  const change = (next: HabitPeriodGoal | null, text = target) => {
    const amount = next?.metric === "sum" ? parseHabitValue(text)
      : /^\d+$/.test(text) && Number.isSafeInteger(Number(text)) ? Number(text) : null;
    const valid = !next || Boolean(amount && amount <= (next.metric === "days" ? 31 : next.metric === "entries" ? 1_000_000 : 1_000_000_000_000));
    setInvalid(!valid); onValidity(valid);
    onChange({ ...habit, periodGoal: next ? { ...next, target: amount ?? 0 } : null,
      intervalSchedule: next && habit.intervalSchedule ? { ...habit.intervalSchedule, completionMode: "day" } : habit.intervalSchedule });
  };
  const boundary = goal && !invalid ? habitGoalPeriod(goal, [habit.createdDate, momentCivilDate(new Date(),goal.context.timeZone)].sort().at(-1)!) : null;
  return <fieldset className="habit-editor-section habit-period-fields wide">
    <legend>{t("Период цели")}</legend>
    <div className="habit-editor-grid">
      <label><span>{t("Период цели")}</span><select value={goal?.period ?? "day"} onChange={event => {
        const period = event.target.value;
        change(period === "day" ? null : goal ? { ...goal, period: period as "week" | "month" } : { version: 1, period: period as "week" | "month", metric: "days", target: 3,
          calendar: calendarMode, context: calendarContext({ timeZone: habit.schedule.timezone,
            gregorianYearStart: habit.schedule.recurrence.calendarContext?.gregorianYearStart }) }, goal ? target : "3");
        if (!goal) setTarget("3");
      }}><option value="day">{t("За день")}</option><option value="week">{t("За неделю")}</option><option value="month">{t("За месяц")}</option></select></label>
      {goal ? <>
        <label><span>{t("Способ подсчёта")}</span><select value={goal.metric} onChange={event => {
          const metric = event.target.value as HabitPeriodGoal["metric"];
          const text = metric === "sum" ? String((habit.measurement?.target ?? 1000) / 1000) : "3";
          setTarget(text); change({ ...goal, metric }, text);
        }}><option value="days">{t("Разные дни")}</option><option value="entries">{t("Отдельные выполнения")}</option>
          <option value="sum" disabled={!habit.measurement}>{t("Сумма значений")}</option></select></label>
        <label><span>{t("Цель за период")}</span><input inputMode={goal.metric === "sum" ? "decimal" : "numeric"}
          required maxLength={16} value={target} aria-invalid={invalid} onChange={event => { setTarget(event.target.value); change(goal, event.target.value); }}/></label>
        {sacredFeaturesEnabled ? <label><span>{t("Календарь цели")}</span><select value={goal.calendar} onChange={event => change({ ...goal, calendar: event.target.value as CalendarMode })}>
          <option value="profane">{t("Григорианский")}</option><option value="sacred">{t("Сакральный")}</option><option value="lunar">{t("Лунный")}</option>
        </select></label> : null}
      </> : null}
    </div>
    {invalid ? <p role="alert">{t("Укажите положительную цель: целое число дней или выполнений, либо сумму с точностью до трёх знаков.")}</p> : null}
    {goal ? <>
      <p>{t(goal.metric === "days" ? "Один день считается один раз после достижения порога дня." : goal.metric === "entries"
        ? "Каждая отдельная запись считается одним выполнением, даже в один день." : "Все значения разрешённых дней складываются за период.")}</p>
      <p>{t("Разрешённые дни задаются в расписании. Дни отдыха не прерывают серию.")}</p>
      <p>{goal.context.timeZone}{boundary ? ` · ${formatCalendarDateValue(boundary.start, sacredFeaturesEnabled ? goal.calendar : "profane", true, goal.context)} — ${formatCalendarDateValue(addCivilDays(boundary.end, -1), sacredFeaturesEnabled ? goal.calendar : "profane", true, goal.context)}` : ""}</p>
    </> : null}
    {isExisting && (goal || hadPeriodGoal) ? <p>{t("Изменения периодической цели и расписания действуют со следующей границы периода. История сохраняется.")}</p> : null}
  </fieldset>;
}

export function HabitPeriodGoalProgress({ habit, workspace, date, language }: {
  habit: Habit; workspace: HabitWorkspace; date: string; language: Language;
}) {
  const sacredFeaturesEnabled = useSacredFeaturesEnabled();
  const state = habitPeriodProgress(habit, date, workspace);
  if (!state) return null;
  const t = (text: string) => translateText(text, language);
  const format = (value: number) => state.goal.metric === "sum" ? `${formatHabitValue(value, language)} ${state.rule.measurement?.kind === "duration" ? t("мин") : state.rule.measurement?.unit ?? ""}`
    : new Intl.NumberFormat(language).format(value);
  return <div className="habit-period-progress" role="group" aria-label={`${t("Цель за период")}: ${habitDisplayText(habit, language).title}`}>
    <div className="habit-measurement-summary"><strong>{t(state.goal.period === "week" ? "За неделю" : "За месяц")}: {format(state.value)} / {format(state.goal.target)}</strong>
      <span>{state.completed ? t("Цель достигнута") : `${t("Осталось")}: ${format(state.remaining)}`}</span></div>
    <p>{t(state.goal.metric === "days" ? "Разные дни" : state.goal.metric === "entries" ? "Отдельные выполнения" : "Сумма значений")}
      {` · ${formatCalendarDateValue(state.start, sacredFeaturesEnabled ? state.goal.calendar : "profane", true, state.goal.context)} — ${formatCalendarDateValue(addCivilDays(state.end, -1), sacredFeaturesEnabled ? state.goal.calendar : "profane", true, state.goal.context)} · ${state.goal.context.timeZone}`}</p>
    <p>{t("Период засчитывается в серии, дневной цели и квестах в последний разрешённый день.")}</p>
    {state.qualityPending ? <p>{t("Для завершения подтвердите качество выполнения.")}</p> : null}
    {state.conflicts ? <p role="alert">{t("Одновременные исправления. Выберите правильное значение.")}</p> : null}
    {state.partial || state.unattainable ? <p>{t("Неполный период или недостаточно разрешённых дней: цель сохраняется, пропуск не прерывает серию.")}</p> : null}
    {state.status === "missed" ? <p>{t("Период завершён без достижения цели.")}</p> : null}
  </div>;
}
