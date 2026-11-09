
import { habitDisplayText } from "./habit-display-text";
import { useId, useRef, useState } from "react";
import type { Habit, HabitWorkspace } from "./habits";
import { recordHabitMeasurement } from "./habits";
import { effectiveHabitMeasurement, formatHabitValue, habitMeasurementProgress, parseHabitValue, type HabitMeasurement } from "./habit-measurement";
import { translateText, type Language } from "./i18n";
import { formatTimeValue, type TimeFormat } from "./time-format";
import { formatCalendarDateValue, type CalendarMode } from "./calendar-data";
import "./habit-measurement.css";

export function HabitMeasurementFields({ habit, language, isExisting, hadPeriodGoal = false, onChange, onValidity }: {
  habit: Habit; language: Language; isExisting: boolean;
  hadPeriodGoal?: boolean;
  onChange: (habit: Habit) => void; onValidity: (valid: boolean) => void;
}) {
  const t = (text: string) => translateText(text, language);
  const [target, setTarget] = useState(String((habit.measurement?.target ?? 1000) / 1000));
  const [step, setStep] = useState(String((habit.measurement?.quickAdd ?? 1000) / 1000));
  const [unit, setUnit] = useState(habit.measurement?.unit ?? "");
  const [invalid, setInvalid] = useState(false);
  const change = (kind: "binary" | HabitMeasurement["kind"], targetText = target, stepText = step, unitText = unit) => {
    const amount = parseHabitValue(targetText), increment = parseHabitValue(stepText);
    const valid = kind === "binary" || Boolean(amount && increment && unitText.trim());
    setInvalid(!valid); onValidity(valid);
    if (kind === "binary") onChange({ ...habit, measurement: null });
    else onChange({ ...habit, measurement: { kind, unit: unitText, target: amount ?? 0, quickAdd: increment ?? 0 },
      intervalSchedule: habit.intervalSchedule ? { ...habit.intervalSchedule, completionMode: "day" } : null });
  };
  return <fieldset className="habit-editor-section habit-measurement-fields wide">
    <legend>{t("Учёт выполнения")}</legend>
    <div className="habit-editor-grid">
      <label className="wide"><span>{t("Тип привычки")}</span><select value={habit.measurement?.kind ?? "binary"}
        onChange={event => {
          const kind = event.target.value as "binary" | HabitMeasurement["kind"];
          const nextUnit = kind === "duration" ? "min" : unit;
          setUnit(nextUnit); change(kind, target, step, nextUnit);
        }}>
        <option value="binary" disabled={habit.periodGoal?.metric === "sum"}>{t("Выполнено / не выполнено")}</option>
        <option value="quantity">{t("Количество")}</option><option value="duration">{t("Длительность")}</option>
      </select></label>
      {habit.measurement ? <>
        <label><span>{t("Единица")}</span><input value={habit.measurement.kind === "duration" ? t("мин") : unit} maxLength={40} required
          disabled={habit.measurement.kind === "duration"} data-no-translate
          onChange={event => { setUnit(event.target.value); change(habit.measurement!.kind, target, step, event.target.value); }}/></label>
        {!habit.periodGoal || habit.periodGoal.metric === "days" ? <label><span>{t("Цель за день")}</span><input inputMode="decimal" value={target} required maxLength={16}
          aria-invalid={invalid && !parseHabitValue(target)}
          onChange={event => { setTarget(event.target.value); change(habit.measurement!.kind, event.target.value); }}/></label> : null}
        <label><span>{t("Быстрое добавление")}</span><input inputMode="decimal" value={step} required maxLength={16}
          aria-invalid={invalid && !parseHabitValue(step)}
          onChange={event => { setStep(event.target.value); change(habit.measurement!.kind, target, event.target.value); }}/></label>
      </> : null}
    </div>
    {invalid ? <p role="alert">{t("Укажите единицу и положительные значения с точностью до трёх знаков после запятой.")}</p> : null}
    {isExisting && !habit.periodGoal && !hadPeriodGoal ? <p>{t("Изменения цели и расписания действуют со следующего дня. История сохраняется.")}</p> : null}
  </fieldset>;
}

export function HabitMeasurementControl({ habit, workspace, date, language, timeFormat, calendarMode, canRecord, onChange }: {
  habit: Habit; workspace: HabitWorkspace; date: string; language: Language; canRecord: boolean;
  timeFormat: TimeFormat; calendarMode: CalendarMode;
  onChange: (workspace: HabitWorkspace) => void | Promise<void>;
}) {
  const t = (text: string) => translateText(text, language);
  const id = useId();
  const progress = habitMeasurementProgress(habit, date, workspace.habitMeasurements ?? []);
  const definition = effectiveHabitMeasurement(progress.rule);
  const countOnly = !progress.rule.measurement;
  const periodicVolume = progress.rule.periodGoal && progress.rule.periodGoal.metric !== "days";
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  if (!definition) return null;
  const format = (amount: number, ruleId = progress.rule.id) => {
    if (countOnly) return formatHabitValue(amount, language);
    const original = ruleId === progress.rule.id ? definition : habit.ruleHistory?.find(rule => rule.id === ruleId)?.measurement ?? definition;
    return `${formatHabitValue(amount, language)} ${original.kind === "duration" ? t("мин") : original.unit}`;
  };
  const formatInstant = (instant: string, includeDate = false) => {
    const parts = new Intl.DateTimeFormat("en-GB", { year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: progress.rule.schedule.timezone })
      .formatToParts(new Date(instant));
    const part = (type: string) => parts.find(item => item.type === type)?.value ?? "";
    const time = formatTimeValue(`${part("hour")}:${part("minute")}`, timeFormat);
    return includeDate ? `${formatCalendarDateValue(`${part("year")}-${part("month")}-${part("day")}`, calendarMode)} · ${time}` : time;
  };
  const submit = async (amount: number | null, entryId?: string, replaces?: string[]) => {
    if (pending.current || !canRecord) return;
    pending.current = true;
    setBusy(true); setError("");
    try {
      const next = recordHabitMeasurement(workspace, habit, date, amount,
        { ...(entryId ? { entryId, replaces, source: "correction" } : {}), note });
      await onChange(next); setValue(""); setNote(""); setEditingId(null);
    } catch { setError(t("Не удалось сохранить запись. Проверьте значение и повторите.")); }
    finally { pending.current = false; setBusy(false); }
  };
  return <div className="habit-measurement-control" role="group" aria-label={`${t("Учёт выполнения")}: ${habitDisplayText(habit, language).title}`}>
    <div className="habit-measurement-summary" aria-live="polite">
      <strong>{periodicVolume ? `${t("Записано сегодня")}: ${format(progress.total)}` : `${format(progress.total)} / ${format(progress.target)}`}</strong>
      {!periodicVolume ? <span>{progress.completed ? t("Цель достигнута") : `${t("Осталось")}: ${format(progress.remaining)}`}</span> : null}
    </div>
    {canRecord ? <div className="habit-measurement-add">
      {!editingId ? <button type="button" className="secondary-button" disabled={busy} onClick={() => submit(definition.quickAdd)}
        aria-label={countOnly ? t("Добавить выполнение") : `${t("Быстрое добавление")}: ${format(definition.quickAdd)}`}>{countOnly ? t("Добавить выполнение") : `+ ${format(definition.quickAdd)}`}</button> : null}
      {!countOnly ? <label htmlFor={`${id}-value`}><span>{t("Значение")}</span><input id={`${id}-value`} inputMode="decimal"
        value={value} disabled={busy} maxLength={16} aria-invalid={Boolean(value && !parseHabitValue(value))}
        onChange={event => setValue(event.target.value)} /></label> : null}
      <label htmlFor={`${id}-note`}><span>{t("Заметка")}</span><input id={`${id}-note`} value={note} disabled={busy} maxLength={2000}
        onChange={event => setNote(event.target.value)} /></label>
      {!countOnly || editingId ? <button type="button" className="primary-button" disabled={busy || !countOnly && !parseHabitValue(value)} onClick={() => submit(countOnly ? 1000 : parseHabitValue(value)!,
        editingId ?? undefined, editingId ? progress.entries.find(entry => entry.id === editingId)?.heads.map(head => head.id) : undefined)}>
        {t(editingId ? "Сохранить" : "Добавить значение")}</button> : null}
      {editingId ? <button type="button" className="secondary-button" disabled={busy} onClick={() => { setEditingId(null); setValue(""); setNote(""); }}>{t("Отмена")}</button> : null}
    </div> : null}
    {error ? <p role="alert">{error}</p> : null}
    {progress.incompatible ? <p role="alert">{t("Часть записей относится к другой версии цели. Проверьте единицы и исправьте значения.")}</p> : null}
    <details className="habit-measurement-history"><summary>{t("Записи")} · {progress.entries.length}</summary>
      {progress.entries.length ? <ol>{progress.entries.map(entry => <li key={entry.id}>
        {entry.conflict ? <div role="alert"><p>{t("Одновременные исправления. Выберите правильное значение.")}</p>
          {entry.heads.map(head => <button type="button" className="secondary-button" key={head.id} disabled={!canRecord || busy}
            onClick={() => submit(head.value, entry.id, entry.heads.map(item => item.id))}>
            {t("Оставить {value}").replace("{value}", head.value === null ? t("Запись удалена") : format(head.value, head.ruleId))}</button>)}
        </div> : <>
          <div><strong>{entry.current?.value === null ? t("Запись удалена") : format(entry.current?.value ?? 0, entry.current?.ruleId)}</strong>
            <time dateTime={entry.current?.createdAt}>{formatInstant(entry.current?.createdAt ?? "1970-01-01T00:00:00Z")}</time>
            {entry.current?.note ? <span data-no-translate>{entry.current.note}</span> : null}</div>
          {canRecord ? <div className="habit-measurement-entry-actions">
            <button type="button" className="secondary-button" disabled={busy} onClick={() => {
              setEditingId(entry.id); setValue(String((entry.current?.value ?? entry.revisions.find(item => item.value)?.value ?? 1000) / 1000));
              setNote(entry.current?.note ?? "");
            }}>{t(entry.current?.value === null ? "Восстановить запись" : "Изменить")}</button>
            {entry.current?.value !== null ? <button type="button" className="secondary-button danger" disabled={busy}
              onClick={() => submit(null, entry.id, entry.heads.map(head => head.id))}>{t("Удалить запись")}</button> : null}
          </div> : null}
        </>}
        {entry.revisions.length > 1 ? <details><summary>{t("История исправлений")}</summary><ol>{entry.revisions.map(revision => <li key={revision.id}>
          <time dateTime={revision.createdAt}>{formatInstant(revision.createdAt, true)}</time>
          <span>{revision.value === null ? t("Запись удалена") : format(revision.value, revision.ruleId)}</span>
          {revision.note ? <span data-no-translate>{revision.note}</span> : null}
        </li>)}</ol></details> : null}
      </li>)}</ol> : <p>{t("Записей пока нет")}</p>}
    </details>
  </div>;
}
