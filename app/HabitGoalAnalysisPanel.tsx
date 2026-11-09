import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { calendarContext, addCivilDays, momentCivilDate, type CalendarContext } from "./calendar-context";
import { calendarPeriod, lunarDateParts, sacredDateParts } from "./calendar-astronomy";
import { calendarYearLabel, formatCalendarDateValue, formatCalendarMonthValue, type CalendarMode } from "./calendar-data";
import { analyzeHabitRange, type HabitAnalysisDay, type HabitGoalOpportunity } from "./habit-goal-analysis";
import { habitRuleForDate, formatHabitValue } from "./habit-measurement";
import { habitHistoryState } from "./habit-history";
import { habitPeriodProgress } from "./habit-period-progress";
import { habitDisplayText } from "./habit-display-text";
import { useSacredFeaturesEnabled } from "./sacred-features";
import { translateText, type Language } from "./i18n";
import type { HabitDayDecisionCommand } from "./habit-day-decision";
import type { HabitWorkspace } from "./habits";
import type { TimeFormat } from "./time-format";
import "./habit-goal-analysis.css";

type Props = { workspace: HabitWorkspace; date: string; language: Language; calendarMode: CalendarMode; reportContext?: CalendarContext;
  timeFormat?: TimeFormat; scope?: string; onOpenHistory?: (date: string, habitId?: string) => void;
  onDayDecision?: (command: HabitDayDecisionCommand, scope: string) => Promise<void> };
const activityLabels = { completed: "Выполнено", activity: "Активность", partial: "Частично", "quality-pending": "Ожидает качества",
  skipped: "Осознанный пропуск", unmarked: "Без отметки выполнения", missing: "Нет записи", conflict: "Конфликт" } as const;
const lifeLabels = { active: "Активные", paused: "Пауза", archived: "Архив", deleted: "Удалённые" } as const;

function ActivityMark({ activity, inactive = false }: { activity: HabitAnalysisDay["activity"]; inactive?: boolean }) {
  return <svg className="habit-analysis-mark" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    {inactive ? <path d="M5 3v10m6-10v10" /> : activity === "completed" ? <path d="m3 8 3 3 7-7" />
      : activity === "skipped" ? <><circle cx="8" cy="8" r="5.5" /><path d="m4 12 8-8" /></>
        : activity === "conflict" ? <><path d="m8 2 6 11H2Z" /><path d="M8 6v3m0 1v1" /></>
          : activity === "quality-pending" ? <><circle cx="8" cy="8" r="5.5" /><path d="M8 4v4l3 2" /></>
            : activity === "partial" ? <><circle cx="8" cy="8" r="5.5" /><path d="M8 2.5v11" /></>
              : activity === "activity" ? <circle cx="8" cy="8" r="3" fill="currentColor" />
                : <circle cx="8" cy="8" r="5.5" strokeDasharray={activity === "missing" ? "2 2" : undefined} />}
  </svg>;
}

export function HabitGoalAnalysisPanel({ workspace, date, language, calendarMode, reportContext, timeFormat = "24h", scope = "", onOpenHistory, onDayDecision }: Props) {
  const t = (source: string) => translateText(source, language), id = useId(), sacred = useSacredFeaturesEnabled();
  const [habitId, setHabitId] = useState(workspace.habits[0]?.id ?? ""), [view, setView] = useState<"month" | "year">("month");
  const [anchor, setAnchor] = useState(date), [modeOverride, setMode] = useState<CalendarMode | null>(null);
  const [yearStart, setYearStart] = useState<"january" | "march" | null>(null), [selected, setSelected] = useState<string | null>(null), [focused, setFocused] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const pending = useRef<HabitDayDecisionCommand | null>(null), lock = useRef(false), gridRef = useRef<HTMLDivElement>(null), detailRef = useRef<HTMLElement>(null);
  const habit = workspace.habits.find(row => row.id === habitId) ?? workspace.habits[0];
  const chosen = modeOverride ?? calendarMode, mode = !sacred && chosen === "sacred" ? "profane" : chosen;
  const context = useMemo(() => ({ ...calendarContext(reportContext), ...(yearStart ? { gregorianYearStart: yearStart } : {}) }), [reportContext, yearStart]);
  const range = useMemo(() => calendarPeriod(anchor, mode, view, context), [anchor, mode, view, context]);
  const report = habit ? analyzeHabitRange(workspace, habit, range, new Date()) : null;
  const day = report?.days.find(row => row.date === selected), enabled = report?.days.filter(row => !row.future && !row.beforeCreation) ?? [];
  const tabDate = enabled.some(row => row.date === focused) ? focused : enabled[0]?.date;
  const percent = (value: number | null) => value === null ? "—" : new Intl.NumberFormat(language, { style: "percent", maximumFractionDigits: 1 }).format(value / 100);
  const count = (value: number) => new Intl.NumberFormat(language).format(value);
  const formatDate = (value: string) => formatCalendarDateValue(value, mode, true, context);
  const periodLabel = (row: HabitGoalOpportunity) => t(row.period === "day" ? "День" : row.period === "week" ? "Неделя" : "Месяц");
  const goalValue = (row: HabitGoalOpportunity) => row.metric === "sum" ? formatHabitValue(row.value, language) : count(row.value);
  const goalTarget = (row: HabitGoalOpportunity) => row.metric === "sum" ? formatHabitValue(row.target, language) : count(row.target);
  const stateLabel = (row: HabitAnalysisDay) => row.beforeCreation ? t("До начала привычки") : row.future ? t("Будущее")
    : row.availability !== "active" ? `${t(lifeLabels[row.availability])} · ${t(activityLabels[row.activity])}`
      : !row.scheduled ? `${t("Отдых")} · ${t(activityLabels[row.activity])}` : t(activityLabels[row.activity]);
  const dateNumber = (value: string) => count(mode === "sacred" ? sacredDateParts(value, context).day : mode === "lunar" ? lunarDateParts(value, context).day : Number(value.slice(-2)));
  const keyboard = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!report || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-habit-date]"); if (!target) return;
    const calendarGrid = event.currentTarget.closest(".habit-analysis-days");
    const current = report.days.findIndex(row => row.date === target.dataset.habitDate), columns = calendarGrid ? getComputedStyle(calendarGrid).gridTemplateColumns.split(" ").length : 7;
    const step = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" ? -columns : columns;
    let index = event.key === "Home" ? 0 : event.key === "End" ? report.days.length - 1 : current + step;
    while (index >= 0 && index < report.days.length && (report.days[index].future || report.days[index].beforeCreation)) index += event.key === "End" || step < 0 ? -1 : 1;
    if (index < 0 || index >= report.days.length) return;
    event.preventDefault(); const next = report.days[index].date; setFocused(next);
    gridRef.current?.querySelector<HTMLElement>(`[data-habit-date="${next}"]`)?.focus();
  };
  const decide = async (choice?: boolean) => {
    if (!habit || !day || !onDayDecision || lock.current) return;
    lock.current = true; setBusy(true); setMessage("");
    const skipped = choice ?? !day.completion?.skippedAt;
    const command = pending.current && pending.current.habitId === habit.id && pending.current.date === day.date && pending.current.skipped === skipped
      ? pending.current : { id: `habit-day:${crypto.randomUUID()}`, at: new Date().toISOString(), habitId: habit.id, date: day.date,
        heads: habitHistoryState(workspace.habitHistory, habit.id, day.date).heads.map(row => row.id), skipped };
    pending.current = command;
    try { await onDayDecision(command, scope); pending.current = null; setMessage("Состояние сохранено."); }
    catch (error) {
      if (error instanceof Error && error.message === "HABIT_HISTORY_EDIT_CONFLICT") { pending.current = null; setMessage("Есть изменения с другого устройства. Выберите состояние."); }
      else setMessage("Не удалось сохранить. Проверьте синхронизацию и повторите.");
    } finally { lock.current = false; setBusy(false); }
  };
  const instant = (value: string, timeZone: string) => new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short", timeZone, hour12: timeFormat === "12h" }).format(new Date(value));
  if (!habit || !report) return <section className="habit-goal-analysis"><h3>{t("Календарь выполнения привычек")}</h3><p>{t("Создайте привычку, чтобы увидеть её историю.")}</p></section>;
  const events = day ? workspace.habitMeasurements.filter(row => row.habitId === habit.id && row.date === day.date)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id)) : [];
  const edits = day ? workspace.habitHistory.filter(row => row.habitId === habit.id && row.date === day.date) : [];
  const selectedPeriod = day?.period ? habitPeriodProgress(habit, day.date, workspace, new Date()) : null;
  const groups = new Map<string, HabitAnalysisDay[]>();
  for (const row of report.days) {
    const month = calendarPeriod(row.date, mode, "month", context).start;
    if (!groups.has(month)) groups.set(month, []);
    groups.get(month)!.push(row);
  }
  return <section className="habit-goal-analysis" aria-labelledby={`${id}-title`}>
    <header><h3 id={`${id}-title`}>{t("Календарь выполнения привычек")}</h3><p>{t("Проценты целей и объёма рассчитываются отдельно.")}</p></header>
    <div className="habit-analysis-controls">
      <label>{t("Привычка")}<select value={habit.id} onChange={event => { setHabitId(event.target.value); setSelected(null); setMessage(""); pending.current = null; }}>
        {workspace.habits.map(row => <option key={row.id} value={row.id} data-no-translate>{habitDisplayText(row, language).title}</option>)}
      </select></label>
      <label>{t("Календарь просмотра")}<select value={mode} onChange={event => setMode(event.target.value as CalendarMode)}>
        <option value="profane">{t("Григорианский")}</option>{sacred ? <option value="sacred">{t("Сакральный")}</option> : null}<option value="lunar">{t("Лунный")}</option>
      </select></label>
      <label>{t("Период")}<select value={view} onChange={event => setView(event.target.value as "month" | "year")}><option value="month">{t("Месяц")}</option><option value="year">{t("Год")}</option></select></label>
      {mode === "profane" && view === "year" ? <label>{t("Начало года")}<select value={context.gregorianYearStart} onChange={event => setYearStart(event.target.value as "january" | "march")}><option value="january">{t("Январь")}</option><option value="march">{t("Март")}</option></select></label> : null}
    </div>
    <div className="habit-analysis-period"><button type="button" onClick={() => setAnchor(addCivilDays(range.start, -1))}>{t("Назад")}</button>
      <strong>{view === "month" ? formatCalendarMonthValue(anchor, mode, context) : calendarYearLabel(anchor, mode, context)}</strong>
      <button type="button" onClick={() => setAnchor(range.end)}>{t("Вперёд")}</button><button type="button" onClick={() => setAnchor(date)}>{t("Сегодня")}</button></div>
    <dl className="habit-goal-metrics"><div><dt>{t("Успешные закрытые цели")}</dt><dd>{report.closedCount ? `${count(report.completedCount)}/${count(report.closedCount)}` : "—"} · {percent(report.completionPercent)}</dd></div>
      {report.volumes.map(row => <div key={`${row.kind}:${row.unit}:${row.plan}`}><dt>{t("Факт / план объёма")} · <span data-no-translate>{row.kind === "duration" ? t("мин") : row.unit}</span></dt>
        <dd>{row.conflicts ? "—" : formatHabitValue(row.actual, language)} / {row.hasPlan ? formatHabitValue(row.target, language) : "—"} · {percent(row.percent)}</dd>
        {row.openActual ? <small>{t("Открытый период")}: {formatHabitValue(row.openActual, language)}</small> : null}
        {row.extraActual ? <small>{t("Вне плана")}: {formatHabitValue(row.extraActual, language)}</small> : null}
        {row.unknownActual ? <small>{t("Доступность неизвестна")}: {formatHabitValue(row.unknownActual, language)}</small> : null}
      </div>)}</dl>
    <p className="habit-analysis-explanation">{t("В процент целей входят только закрытые возможности с известным расписанием. Текущий открытый период показан отдельно.")}</p>
    {report.unknownDays ? <p className="habit-analysis-explanation">{t("История пауз до первого сохранённого перехода неизвестна; эти даты не входят в процент.")}</p> : null}
    {report.unresolvedCount ? <p role="status">{t("Дни с конфликтом")}: {count(report.unresolvedCount)}</p> : null}
    {report.open.length ? <div className="habit-analysis-open"><h4>{t("Открытый период")}</h4>{report.open.map(row => <p key={row.key}>{periodLabel(row)} · {formatDate(row.start)} — {formatDate(addCivilDays(row.end, -1))}: {goalValue(row)} / {goalTarget(row)} {row.partial ? `· ${t("Неполный период")}` : ""}</p>)}</div> : null}
    <details className="habit-analysis-calculation"><summary>{t("Как рассчитано")}</summary><ul>{report.opportunities.map(row => <li key={row.key}>
      <time dateTime={row.start}>{formatDate(row.start)}</time> — <time dateTime={addCivilDays(row.end, -1)}>{formatDate(addCivilDays(row.end, -1))}</time>
      <span>{periodLabel(row)} · {t(row.metric === "days" ? "Разные дни" : row.metric === "entries" ? "Записи" : "Сумма")}</span>
      <strong>{goalValue(row)} / {goalTarget(row)}</strong><span>{t(row.conflict ? "Конфликт" : !row.closed ? "Открытый период" : !row.availabilityKnown ? "Доступность неизвестна" : !row.eligible ? "Неполный период" : row.completed ? "Выполнено" : "Цель не выполнена")}</span>
    </li>)}</ul></details>
    <div className="habit-analysis-legend">{(["completed", "partial", "activity", "quality-pending", "skipped", "missing", "conflict"] as const).map(state => <span key={state} data-activity={state}><i />{t(activityLabels[state])}</span>)}<span>{t("Пауза")} / {t("Отдых")} / {t("Будущее")}</span></div>
    <div ref={gridRef} className={`habit-analysis-calendar${view === "year" ? " is-year" : ""}`} role="group" aria-label={t("Выберите дату")}>
      {[...groups].map(([month, days]) => <section className="habit-analysis-month" key={month} aria-label={formatCalendarMonthValue(days[0].date, mode, context)}>
      {view === "year" ? <h4>{formatCalendarMonthValue(days[0].date, mode, context)}</h4> : null}
      <div className={`habit-analysis-days${mode === "sacred" ? " is-sacred" : ""}`}>
      {days.map(item => <button type="button" key={item.date} data-habit-date={item.date} data-activity={item.activity}
        data-availability={!item.availabilityKnown ? "unknown" : item.availability} disabled={item.future || item.beforeCreation}
        className={`${item.date === item.today ? "is-today " : ""}${item.date === selected ? "is-selected" : ""}`}
        tabIndex={item.date === tabDate ? 0 : -1} aria-pressed={item.date === selected} onKeyDown={keyboard}
        aria-label={`${formatDate(item.date)} · ${stateLabel(item)}${!item.availabilityKnown ? ` · ${t("Доступность неизвестна")}` : ""}`}
        title={`${formatDate(item.date)} · ${stateLabel(item)}`} onFocus={() => setFocused(item.date)} onClick={() => { setSelected(item.date); setMessage(""); requestAnimationFrame(() => detailRef.current?.scrollIntoView({ block: "nearest" })); }}>
        <span>{dateNumber(item.date)}</span>{!item.future && !item.beforeCreation ? <ActivityMark activity={item.activity} inactive={item.availability !== "active" && !item.hasRecord} /> : null}</button>)}
      </div></section>)}
    </div>
    {day ? <section ref={detailRef} className="habit-analysis-source" aria-labelledby={`${id}-source`}>
      <h4 id={`${id}-source`}>{formatDate(day.date)}</h4><p>{stateLabel(day)}</p>
      <p>{t("Факт")}: {day.kind === "binary" ? count(Number(day.completed)) : formatHabitValue(day.volume, language)} {day.kind === "duration" ? t("мин") : day.unit ?? ""}
        {day.target !== null ? ` · ${t("План")}: ${day.kind === "binary" ? count(day.target) : formatHabitValue(day.target, language)}` : ""}</p>
      {selectedPeriod ? <p>{t("Цель периода")}: {selectedPeriod.goal.metric === "sum" ? formatHabitValue(selectedPeriod.value, language) : count(selectedPeriod.value)} / {selectedPeriod.goal.metric === "sum" ? formatHabitValue(selectedPeriod.goal.target, language) : count(selectedPeriod.goal.target)} · {t(selectedPeriod.completed ? "Выполнено" : selectedPeriod.status === "missed" ? "Цель не выполнена" : selectedPeriod.status === "neutral" ? "Неполный период" : "Открытый период")}</p> : null}
      {day.completion ? <p>{t("Выданные XP")}: {count(day.completion.xpAwarded)}{day.completion.note ? <> · <span data-no-translate>{day.completion.note}</span></> : null}</p> : null}
      <h5>{t("Исходные записи")}</h5>
      {events.length || edits.length ? <ul className="habit-analysis-records">{events.map(row => {
        const rule = habit.ruleHistory?.find(rule => rule.id === row.ruleId) ?? habitRuleForDate(habit, row.date);
        return <li key={row.id} data-record-id={row.id}><time dateTime={row.createdAt}>{instant(row.createdAt, rule.schedule.timezone)}</time>
          <strong>{row.value === null ? t("Запись удалена") : formatHabitValue(row.value, language)} <span data-no-translate>{rule.measurement?.kind === "duration" ? t("мин") : rule.measurement?.unit ?? ""}</span></strong>
          <span>{t(row.source === "timer" ? "Таймер" : row.source === "import" ? "Импорт" : row.source === "correction" ? "Исправление истории" : "Ручной ввод")}</span>{row.note ? <p data-no-translate>{row.note}</p> : null}</li>;
      })}{edits.map(row => <li key={row.id} data-record-id={row.id}><time dateTime={row.createdAt}>{instant(row.createdAt, habitRuleForDate(habit, row.date).schedule.timezone)}</time>
        <span>{t(row.value.skippedAt ? "Осознанный пропуск" : row.source === "decision" ? "Без отметки выполнения" : row.source === "import" ? "Импорт" : "Исправление истории")}</span>{row.value.note ? <p data-no-translate>{row.value.note}</p> : null}</li>)}</ul>
        : day.completion ? <p><time dateTime={day.completion.createdAt}>{instant(day.completion.createdAt, habitRuleForDate(habit, day.date).schedule.timezone)}</time></p> : <p>{t("Нет записи")}</p>}
      <div className="habit-analysis-actions">{onOpenHistory && day.date < day.today ? <button type="button" onClick={() => onOpenHistory(day.date, habit.id)}>{t("Исправить историю")}</button> : null}
        {onDayDecision && day.date === momentCivilDate(new Date(), habitRuleForDate(habit, day.date).schedule.timezone) && day.scheduled && (day.activity !== "completed" || day.completion?.skippedAt) ? <>
          <button type="button" disabled={busy} onClick={() => void decide()}>{t(day.completion?.skippedAt ? "Отменить пропуск" : "Пропустить")}</button>
          {habitHistoryState(workspace.habitHistory, habit.id, day.date).conflict ? <button type="button" disabled={busy} onClick={() => void decide(Boolean(day.completion?.skippedAt))}>{t(day.completion?.skippedAt ? "Пропустить" : "Отменить пропуск")}</button> : null}
        </> : null}</div>
      {message ? <p role="status">{t(message)}</p> : null}
    </section> : null}
  </section>;
}
