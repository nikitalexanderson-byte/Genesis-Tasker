"use client";
import { useEffect, useId, useRef, useState } from "react";
import { CalendarDatePicker } from "./CalendarDatePicker";
import { RecurrenceBuilder } from "./RecurrenceBuilder";
import { RecordCalendarChoice } from "./RecordCalendarChoice";
import { calendarContext, calendarTimeZone, todayCivilDate } from "./calendar-context";
import { formatCalendarDateValue, type CalendarMode } from "./calendar-data";
import { calendarModeForRecurrence, convertTrackerRecurrenceCalendar, DEFAULT_RECURRENCE_CONFIG, recurrenceDefaultEndDate } from "./task-recurrence";
import { loadSharedSeries, previewSharedSeries, saveSharedSeries, skipSharedSeriesInstance, type SharedTask } from "./cloud-sync";
import { sharedSeriesError, type SharedSeries, type SharedSeriesPreview, type SharedSeriesSettings } from "./shared-series";
import { runtimeLocale, translateText as t } from "./i18n";
import "./shared-task-series.css";

function initialSettings(task: SharedTask, mode: CalendarMode): SharedSeriesSettings {
  const start = task.dueDate || todayCivilDate();
  const recurrence = convertTrackerRecurrenceCalendar({ ...DEFAULT_RECURRENCE_CONFIG, enabled: true,
    mode: "classic", pattern: "daily", days: [1], rangeStart: start, rangeEnd: recurrenceDefaultEndDate(start), calendarContext: calendarContext() }, mode, start);
  return { timing: "schedule", delayDays: 1, limit: 30, cloneChildren: false, excludedDates: [], recurrence };
}

export default function SharedTaskSeries({task, mode, readOnly, disabled, onDirtyChange, onSaved, onOpen}: {
  task: SharedTask; mode: CalendarMode; readOnly: boolean; disabled: boolean;
  onDirtyChange: (dirty: boolean) => void; onSaved: () => Promise<void>;
  onOpen: (projectId: string, taskId: string) => void;
}) {
  const [series, setSeries] = useState<SharedSeries | null>(null);
  const [settings, setSettings] = useState(() => initialSettings(task, mode));
  const [paused, setPaused] = useState(false);
  const [refreshTemplate, setRefreshTemplate] = useState(false);
  const [zone, setZone] = useState(settings.recurrence.calendarContext!.timeZone);
  const zoneErrorId = useId();
  const [excludeDate, setExcludeDate] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [observedAt, setObservedAt] = useState(() => Date.now());
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<SharedSeriesPreview | null>(null);
  const [baseline, setBaseline] = useState(() => JSON.stringify({ settings, paused: false, zone }));
  const retry = useRef({ body: "", id: "" });
  const dirty = JSON.stringify({ settings, paused, zone }) !== baseline || refreshTemplate;
  const context = settings.recurrence.calendarContext!;
  const ruleMode = calendarModeForRecurrence(settings.recurrence.mode);
  const editable = !readOnly && (!series || series.projectId === task.projectId);
  const blocked = disabled || working || Boolean(task.pending) || !loaded;
  let validZone = false;
  try { validZone = calendarTimeZone(zone) === context.timeZone; } catch { /* Keep intermediate text editable. */ }
  const dateLabel = (value: string) => formatCalendarDateValue(value, ruleMode, true, context);
  const apply = (value: SharedSeries | null) => {
    setSeries(value);
    if (value) {
      setSettings(value.settings); setPaused(value.paused); setZone(value.settings.recurrence.calendarContext!.timeZone);
      setBaseline(JSON.stringify({settings: value.settings, paused: value.paused, zone: value.settings.recurrence.calendarContext!.timeZone}));
    }
    setRefreshTemplate(false); setPreview(null); setLoaded(true); setObservedAt(Date.now());
  };

  useEffect(() => {
    let live = true;
    void loadSharedSeries(task).then(value => { if (live) apply(value); }).catch(error => { if (live) setMessage(sharedSeriesError(error)); });
    return () => { live = false; };
    // A refreshed task revision must not overwrite an unsaved series draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id, task.projectId]);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const change = (next: SharedSeriesSettings) => { setSettings(next); setPreview(null); setMessage(""); };
  const requestId = (body: unknown) => {
    const key = JSON.stringify(body);
    if (retry.current.body !== key) retry.current = {body: key, id: crypto.randomUUID()};
    return retry.current.id;
  };
  const save = async () => {
    setWorking(true); setMessage("");
    const body = {seriesId: series?.id, expectedRevision: series?.revision, settings, paused, refreshTemplate, taskRevision: task.revision};
    try {
      const result = await saveSharedSeries(task, {...body, requestId: requestId(body)});
      apply(result); setMessage(t("Серия сохранена.")); await onSaved();
    } catch (error) { setMessage(sharedSeriesError(error)); }
    finally { setWorking(false); }
  };
  const check = async () => {
    setWorking(true); setMessage("");
    try { setPreview(await previewSharedSeries(task, settings, series?.id, refreshTemplate)); }
    catch (error) { setMessage(sharedSeriesError(error)); }
    finally { setWorking(false); }
  };
  const reload = async () => {
    if (dirty && !window.confirm(t("Загрузить сохранённую серию и отменить изменения черновика?"))) return;
    setWorking(true); setMessage("");
    try { apply(await loadSharedSeries(task)); }
    catch (error) { setMessage(sharedSeriesError(error)); }
    finally { setWorking(false); }
  };
  const skip = async () => {
    if (!series || !window.confirm(t("Пропустить этот повтор? Задача и подзадачи сохранятся в архиве."))) return;
    setWorking(true); setMessage("");
    try {
      const result = await skipSharedSeriesInstance(task, series, requestId({skip: task.id, revision: task.revision, seriesRevision: series.revision}));
      apply(result); await onSaved();
    } catch (error) { setMessage(sharedSeriesError(error)); }
    finally { setWorking(false); }
  };
  const healthyWorker = Boolean(series?.workerCompletedAt && observedAt - new Date(series.workerCompletedAt).getTime() < 15 * 60_000);
  if (readOnly && loaded && !series) return null;
  return <details className="task-advanced-fields shared-task-series">
    <summary>{t("Серия общих задач")}{series?.paused ? ` · ${t("Пауза")}` : ""}</summary>
    {message ? <p role="status">{message}</p> : null}
    {!loaded ? <button type="button" className="secondary-button" disabled={working} onClick={() => void reload()}>{t("Обновить данные")}</button> : <>
      <p>{t("Изменения задачи относятся к этому повтору. Настройки серии действуют только на ещё не созданные задачи.")}</p>
      {series ? <section className="shared-series-status" aria-label={t("Серия общих задач")}>
        <p>{t("Создано или пропущено: {count} из {limit}").replace("{count}", String(series.generatedCount)).replace("{limit}", String(series.settings.limit))}</p>
        {series.generatedCount >= series.settings.limit ? <p>{t("Лимит серии достигнут.")}</p> : series.waitingForCompletion ? <p>{t("Следующий повтор ждёт завершения и всех подтверждений. Архив или корзина приостанавливают ожидание.")}</p>
          : <p>{t("Следующие даты: {dates}").replace("{dates}", series.nextDates.map(dateLabel).join(" · ") || "—")}</p>}
        <p>{healthyWorker ? t("Фоновое выполнение работает.") : t("Фоновое выполнение пока не подтверждено. Задачи появятся после восстановления обработчика.")}</p>
        {series.lastError ? <p role="alert">{sharedSeriesError(new Error(series.lastError))}</p> : null}
      </section> : null}
      {editable ? <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <fieldset disabled={blocked} className="shared-series-fields">
          <legend>{t("Настройки серии")}</legend>
          <label>{t("Когда создавать повтор")}<select value={settings.timing} onChange={event => change({...settings, timing: event.target.value as SharedSeriesSettings["timing"]})}>
            <option value="schedule">{t("По расписанию")}</option><option value="after-completion">{t("После завершения")}</option>
          </select></label>
          {settings.timing === "schedule" ? <RecurrenceBuilder sharedSeries value={settings.recurrence} destination="tracker" allowCalendarModeChange startDate={settings.recurrence.rangeStart} onChange={recurrence => {
            const rangeStart = recurrence.rangeStart || settings.recurrence.rangeStart;
            change({...settings, recurrence: {...recurrence, rangeStart, rangeEnd: recurrence.rangeEnd || recurrenceDefaultEndDate(rangeStart), enabled: true}});
          }}/> : <>
            <RecordCalendarChoice value={ruleMode} onChange={value => change({...settings, recurrence: convertTrackerRecurrenceCalendar(settings.recurrence, value, settings.recurrence.rangeStart)})}/>
            <label>{t("Дней после завершения")}<input type="number" min={1} max={366} required value={settings.delayDays} onChange={event => change({...settings, delayDays: Number(event.target.value)})}/></label>
            <div className="shared-series-pair">
              <label>{t("Начало")}<CalendarDatePicker value={settings.recurrence.rangeStart} mode={ruleMode} calculationContext={context} required onChange={value => { if(value) change({...settings, recurrence: {...settings.recurrence, rangeStart: value}}); }}/></label>
              <label>{t("Окончание")}<CalendarDatePicker value={settings.recurrence.rangeEnd} min={settings.recurrence.rangeStart} mode={ruleMode} calculationContext={context} onChange={value => change({...settings, recurrence: {...settings.recurrence, rangeEnd: value}})}/></label>
            </div>
          </>}
          <div className="shared-series-pair">
            <label>{t("Часовой пояс IANA")}<input value={zone} required aria-invalid={!validZone} aria-describedby={!validZone ? zoneErrorId : undefined} placeholder="Europe/Moscow" onChange={event => {
              const value = event.target.value; setZone(value);
              try { change({...settings, recurrence: {...settings.recurrence, calendarContext: {...context, timeZone: calendarTimeZone(value)}}}); } catch { /* Keep draft without rendering an invalid context. */ }
            }}/></label>
            <label>{t("Начало года")}<select value={context.gregorianYearStart} onChange={event => change({...settings, recurrence: {...settings.recurrence, calendarContext: {...context, gregorianYearStart: event.target.value as "january" | "march"}}})}>
              <option value="january">{t("С января")}</option><option value="march">{t("С марта")}</option>
            </select></label>
          </div>
          {!validZone ? <p id={zoneErrorId} role="alert">{t("Введите действительный часовой пояс IANA, например Europe/Moscow. Черновик сохранён.")}</p> : null}
          <label>{t("Лимит повторов, включая исходный и пропуски")}<input type="number" min={1} max={1000} required value={settings.limit} onChange={event => change({...settings, limit: Number(event.target.value)})}/></label>
          <label className="shared-projects-checkbox"><input type="checkbox" checked={paused} onChange={event => setPaused(event.target.checked)}/>{t("Пауза")}</label>
          <label className="shared-projects-checkbox"><input type="checkbox" checked={settings.cloneChildren} onChange={event => {change({...settings, cloneChildren: event.target.checked}); if(series) setRefreshTemplate(true); }}/>{t("Копировать подзадачи")}</label>
          {series ? <label className="shared-projects-checkbox"><input type="checkbox" checked={refreshTemplate} onChange={event => {setRefreshTemplate(event.target.checked); setPreview(null); }}/>{t("Обновить образец из этой сохранённой задачи")}</label> : null}
          <details className="shared-series-exceptions"><summary>{t("Исключения дат")} · {settings.excludedDates.length}</summary>
            <label>{t("Пропустить дату")}<CalendarDatePicker value={excludeDate} mode={ruleMode} calculationContext={context} onChange={setExcludeDate}/></label>
            <button type="button" className="secondary-button" disabled={!excludeDate || settings.excludedDates.includes(excludeDate)} onClick={() => { change({...settings, excludedDates: [...settings.excludedDates, excludeDate].sort()}); setExcludeDate(""); }}>{t("Добавить")}</button>
            <ul>{settings.excludedDates.map(date => <li key={date}><span>{dateLabel(date)}</span><button type="button" className="secondary-button" onClick={() => change({...settings, excludedDates: settings.excludedDates.filter(value => value !== date)})}>{t("Убрать")}</button></li>)}</ul>
          </details>
          <p>{t("Повторы создаются в день срока. Пауза сохраняет пропущенные даты для последующего создания. Комментарии, файлы, изображения и внешние зависимости не копируются; чек-листы начинаются заново.")}</p>
          {preview ? <p role="status">{t("В каждом повторе: задач — {tasks}, чек-листов — {lists}.").replace("{tasks}", String(preview.taskCount)).replace("{lists}", String(preview.checklistCount))}</p> : null}
          <div className="shared-series-actions">
            <button type="button" className="secondary-button" disabled={!validZone} onClick={() => void check()}>{t("Проверить")}</button>
            <button type="submit" className="primary-button" disabled={!validZone}>{working ? t("Сохраняем…") : t("Сохранить серию")}</button>
          </div>
        </fieldset>
        {disabled || task.pending ? <p>{t("Сначала сохраните задачу и дождитесь синхронизации.")}</p> : null}
      </form> : null}
      {series ? <details className="shared-series-history"><summary>{t("Последние 30 повторов")}</summary>
        <ol>{series.instances.map(instance => <li key={instance.ordinal}><span>{instance.ordinal}. {dateLabel(instance.date)}{instance.state === "skipped" ? ` · ${t("Пропущено")}` : ""}</span>
          {instance.taskId && instance.projectId ? <button type="button" className="secondary-button" disabled={working || dirty || disabled} onClick={() => onOpen(instance.projectId!, instance.taskId!)}>{t("Открыть")}</button> : null}</li>)}</ol>
      </details> : null}
      <div className="shared-series-actions">
        <button type="button" className="secondary-button" disabled={working} onClick={() => void reload()}>{t("Обновить данные")}</button>
        {series && editable && !task.completedAt && !task.archivedAt ? <button type="button" className="secondary-button" disabled={blocked || dirty} onClick={() => void skip()}>{t("Пропустить этот повтор")}</button> : null}
      </div>
      {series?.workerCompletedAt ? <small>{new Intl.DateTimeFormat(runtimeLocale(), {dateStyle: "medium", timeStyle: "short", timeZone: context.timeZone}).format(new Date(series.workerCompletedAt))} · {context.timeZone}</small> : null}
    </>}
  </details>;
}
