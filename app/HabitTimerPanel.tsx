
import {useFeatureAccess} from "./FeatureAccessContext";
import {featureAllowed} from "./feature-access";
import {FeatureAccessUI} from "./FeatureAccessUI";
import {requestUpgrade} from "./upgrade-events";
import { habitDisplayText } from "./habit-display-text";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { addCivilDays } from "./calendar-context";
import { formatCalendarDateValue, type CalendarMode } from "./calendar-data";
import { habitGoalPeriod } from "./habit-period-goal";
import { habitRuleForDate, formatHabitValue } from "./habit-measurement";
import { habitTimerReading, habitTimerSessions, type HabitTimerState } from "./habit-timer";
import { habitTimerDeviceOwner } from "./habit-timer-storage";
import type { HabitTimerCommand } from "./habit-timer-workspace";
import type { HabitWorkspace } from "./habits";
import { translateText, type Language } from "./i18n";
import { formatTimeValue, type TimeFormat } from "./time-format";
import "./habit-timer.css";
import { habitTimerPreferences } from './habit-timer-preferences';

export function HabitTimerIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true" focusable="false">
    <path d="M9 2h6M12 2v3m6 1 2-2M12 9v5l3 2"/><circle cx="12" cy="14" r="8"/>
  </svg>;
}
export function habitTimerDuration(ms: number, precise = false) {
  const seconds = Math.floor(ms / 1000);
  const main = `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  return precise && ms % 1000 ? `${main}.${String(ms % 1000).padStart(3, "0")}` : main;
}
export function habitTimerError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("GOAL_CHANGED") || message.includes("DATE_UNAVAILABLE")) return "Правило цели изменилось. Проверьте привязку или сохраните только время.";
  if (message.includes("TIMER_ACTIVE")) return "Уже есть незавершённая сессия. Завершите или отмените её перед новым стартом.";
  if (message.includes("TIMER_BUSY")) return "В другом окне выполняется действие с таймером. Повторите попытку.";
  if (message.includes("TIMER_RESET")) return "История привычек была сброшена. Обновите экран перед запуском таймера.";
  if (message.includes("CLOCK_CHANGED") || message.includes("HISTORY_CONFLICT")) return "Системное время изменилось. Проверьте часы устройства; сессия сохранена.";
  if (message.includes("OTHER_DEVICE")) return "Управляйте этой сессией на устройстве, где она запущена.";
  if (message.includes("TIMER_CONFLICT")) return "Обнаружены разные состояния сессии. Выберите нужное.";
  return "Не удалось сохранить сессию. Повторите попытку.";
}

type HabitTimerPanelProps = {
  workspace: HabitWorkspace; language: Language; calendarMode: CalendarMode; timeFormat: TimeFormat;
  requestedHabitId: string | null; onClose: () => void; onCommand: (command: HabitTimerCommand) => Promise<void>;
};
export function HabitTimerPanel(props: HabitTimerPanelProps) {
  const habit=props.workspace.habits.find(item=>item.id===props.requestedHabitId);
  return <HabitTimerPanelContent key={`${props.requestedHabitId}:${habit?.timerEnabled}:${JSON.stringify(habitTimerPreferences(habit))}`} {...props}/>;
}
function HabitTimerPanelContent({ workspace, language, calendarMode, timeFormat, requestedHabitId, onClose, onCommand }: HabitTimerPanelProps) {
  const access=useFeatureAccess();
  const allowed=featureAllowed(access,"habit-timer");
  const t = (source: string) => translateText(source, language);
  const titleId = useId(), panel = useRef<HTMLElement>(null);
  const sessions = useMemo(() => habitTimerSessions(workspace.habitTimers ?? []), [workspace.habitTimers]);
  const [owner, setOwner] = useState("");
  const preferences = habitTimerPreferences(workspace.habits.find(item=>item.id===requestedHabitId));
  const [mode, setMode] = useState<"stopwatch" | "pomodoro">(preferences.modes[0]);
  const [workMinutes, setWorkMinutes] = useState(String(preferences.workMinutes)), [breakMinutes, setBreakMinutes] = useState(String(preferences.breakMinutes));
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [historyCount, setHistoryCount] = useState(10);
  const [retryCommand, setRetryCommand] = useState<HabitTimerCommand | null>(null);
  const inFlight = useRef(false);
  const habit = workspace.habits.find(item => item.id === requestedHabitId);
  const timerTitle = (habitId: string, title: string) => {
    const definition = workspace.habits.find(item => item.id === habitId);
    return definition ? habitDisplayText({ ...definition, title }, language).title : title;
  };
  const unfinished = sessions.filter(session => !session.state || !["saved", "discarded"].includes(session.state.status));
  const hasRunning = sessions.some(session => session.heads.some(head => head.status === "running"));
  useEffect(() => {
    const initialize = window.setTimeout(() => {
      try { setOwner(habitTimerDeviceOwner(localStorage)); }
      catch { setError("Не удалось сохранить сессию. Повторите попытку."); }
    }, 0);
    return () => window.clearTimeout(initialize);
  }, []);
  useEffect(() => {
    if (!hasRunning) return;
    let timer: number | undefined;
    const sync = () => {
      if (timer !== undefined) window.clearInterval(timer);
      if (document.visibilityState === "visible") {
        setNow(Date.now()); timer = window.setInterval(() => setNow(Date.now()), 1000);
      }
    };
    sync(); document.addEventListener("visibilitychange", sync);
    return () => { if (timer !== undefined) window.clearInterval(timer); document.removeEventListener("visibilitychange", sync); };
  }, [hasRunning]);
  useEffect(() => { if (requestedHabitId) panel.current?.scrollIntoView({ block: "nearest" }); }, [requestedHabitId]);
  const execute = async (command: HabitTimerCommand) => {
    if ((command.action==='start'||command.action==='resume')&&!featureAllowed(access,'habit-timer')) {requestUpgrade({feature:'habit-timer',reason:'feature'});return;}
    if (inFlight.current) return;
    inFlight.current = true; setRetryCommand(command); setBusy(true); setError("");
    try { await onCommand(command); setRetryCommand(null); if (command.action === "start") onClose(); }
    catch (failure) { setError(habitTimerError(failure)); }
    finally { inFlight.current = false; setBusy(false); setNow(Date.now()); }
  };
  const make = (action: HabitTimerCommand["action"], sessionId?: string, extra: Partial<HabitTimerCommand> = {}): HabitTimerCommand =>
    ({ action, owner, sessionId, at: new Date().toISOString(), id: `habit-timer-${crypto.randomUUID()}`, ...extra });
  const stateLabel = (state: HabitTimerState) => t(state.status === "paused" ? "На паузе" : state.status === "finished" ? "Завершена"
    : state.status === "saved" ? "Сессия сохранена" : state.status === "discarded" ? "Отмена" : "Идёт работа");
  const instantLabel = (instant: string, zone: string) => {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(instant));
    const part = (name: string) => parts.find(item => item.type === name)?.value ?? "";
    return `${formatCalendarDateValue(`${part("year")}-${part("month")}-${part("day")}`, calendarMode)} · ${formatTimeValue(`${part("hour")}:${part("minute")}`, timeFormat)}`;
  };
  if (!habit && !unfinished.length && !requestedHabitId && !sessions.some(session => session.state?.status === "saved")) return null;
  const ownPending = unfinished.some(session => session.root.owner === owner);
  const validWork = /^\d{1,3}$/.test(workMinutes) && Number(workMinutes) >= 1 && Number(workMinutes) <= 180;
  const validBreak = /^\d{1,3}$/.test(breakMinutes) && Number(breakMinutes) >= 0 && Number(breakMinutes) <= 120;
  const canStart = allowed && owner && !ownPending && (mode === "stopwatch" || validWork && validBreak);
  const history = sessions.filter(session => session.state?.status === "saved" && (!requestedHabitId || session.root.habitId === requestedHabitId));
  return <section ref={panel} className="habit-timer-panel" aria-labelledby={titleId} data-testid="habit-timer-panel">
    <header><h3 id={titleId}><HabitTimerIcon/>{t("Таймер")}</h3>{requestedHabitId ? <button type="button" className="secondary-button" onClick={onClose}>{t("Закрыть")}</button> : null}</header>
    {!allowed?<FeatureAccessUI language={language} feature="habit-timer"/>:null}
    {habit && habit.timerEnabled !== false ? <div className="habit-timer-start" data-testid="habit-timer-start">
      <strong data-no-translate>{habitDisplayText(habit, language).title}</strong>
      <div className="habit-timer-config">
        <div className="segmented-control" role="group" aria-label={t("Таймер")}>
          {preferences.modes.includes('stopwatch')?<button type="button" disabled={busy} aria-pressed={mode === "stopwatch"} onClick={() => setMode("stopwatch")}>{t("Секундомер")}</button>:null}
          {preferences.modes.includes('pomodoro')?<button type="button" disabled={busy} aria-pressed={mode === "pomodoro"} onClick={() => setMode("pomodoro")}>Pomodoro</button>:null}
        </div>
        {mode === "pomodoro" ? <><label><span>{t("Рабочий интервал, мин")} · 1–180</span><input inputMode="numeric" value={workMinutes} maxLength={3} disabled={busy} aria-invalid={!validWork} onChange={event => setWorkMinutes(event.target.value)} /></label>
          <label><span>{t("Перерыв, мин")} · 0–120</span><input inputMode="numeric" value={breakMinutes} maxLength={3} disabled={busy} aria-invalid={!validBreak} onChange={event => setBreakMinutes(event.target.value)} /></label></> : null}
        <button type="button" className="primary-button" disabled={busy || !canStart} onClick={() => execute(make("start", undefined,
          { habitId: habit.id, mode, workMinutes: mode === "pomodoro" ? Number(workMinutes) : 25,
            breakMinutes: mode === "pomodoro" ? Number(breakMinutes) : 5 }))}>{t("Начать")}</button>
      </div>
      {ownPending ? <p role="note">{t("Уже есть незавершённая сессия. Завершите или отмените её перед новым стартом.")}</p>
        : unfinished.some(session => session.root.owner !== owner) ? <p role="note">{t("На другом устройстве уже работает таймер. Здесь начнётся отдельная сессия.")}</p> : null}
      {mode === "pomodoro" ? <p>{t("Перерыв не засчитывается в прогресс.")}</p> : null}
    </div> : null}
    {unfinished.map(session => {
      const state = session.state, plan = session.root.plan!, own = session.root.owner === owner;
      const reading = state ? habitTimerReading(state, Math.max(now, Date.parse(state.head.at))) : null;
      return <article className="habit-timer-session" key={session.id} data-testid="habit-timer-session" data-status={state?.status ?? "conflict"}>
        <div className="habit-timer-session-head"><strong data-no-translate>{timerTitle(session.root.habitId, workspace.habits.find(item => item.id === session.root.habitId)?.title ?? plan.habitTitle)}</strong>
          <span>{!own ? t("Таймер на другом устройстве") : state ? stateLabel(state) : t("Обнаружены разные состояния сессии. Выберите нужное.")}</span></div>
        <small>{instantLabel(session.root.at, plan.timeZone)} · {plan.timeZone}</small>
        {!own ? <p>{t("Управляйте этой сессией на устройстве, где она запущена.")}</p> : null}
        {state && reading ? <>
          <div className="habit-timer-totals"><div><span>{t("Рабочее время")}</span><output className="habit-timer-clock" aria-live="off">{habitTimerDuration(reading.workMs, state.status !== "running")}</output></div>
            {plan.mode === "pomodoro" ? <div><span>{t("Время перерывов")}</span><output>{habitTimerDuration(reading.breakMs)}</output></div> : null}</div>
          {state.status === "running" && plan.mode === "pomodoro" ? <p>{t(reading.onBreak ? "Идёт перерыв" : "Идёт работа")} · {habitTimerDuration(reading.phaseRemainingMs)}</p> : null}
          {state.status === "running" && now < Date.parse(state.head.at) ? <p role="alert">{t("Системное время изменилось. Проверьте часы устройства; сессия сохранена.")}</p> : null}
          {state.status === "finished" ? <div className="habit-timer-review" data-testid="habit-timer-review">
            <h4>{t("Проверка результата")}</h4><p>{t("Время распределяется по датам в часовом поясе цели.")}</p>
            <ul>{(state.allocations ?? []).map(row => {
              const target = workspace.habits.find(item => item.id === session.root.habitId);
              const rule = target ? habitRuleForDate(target, row.date) : null;
              let periodLabel = "";
              try { const period = rule?.periodGoal && habitGoalPeriod(rule.periodGoal, row.date);
                if (period) periodLabel = `${formatCalendarDateValue(period.start, calendarMode)} – ${formatCalendarDateValue(addCivilDays(period.end, -1), calendarMode)}`;
              } catch { periodLabel = t("Правило цели изменилось. Проверьте привязку или сохраните только время."); }
              return <li key={row.date}><div><strong>{formatCalendarDateValue(row.date, calendarMode)}</strong><span>{formatHabitValue(row.value, language)} {t("мин")}</span></div>
                {periodLabel ? <small>{t("Период цели")}: {periodLabel}</small> : null}
                {row.reason !== "duration" ? <p>{t(row.reason === "not-duration" ? "Для этой привычки время сохраняется в истории. Значения и отметки добавляются отдельно."
                  : row.reason === "not-scheduled" ? "День не запланирован: время останется в истории без изменения прогресса." : "Правило цели изменилось. Проверьте привязку или сохраните только время.")}</p> : null}</li>;
            })}</ul>
            {!state.allocations?.length ? <p>{t("Нет рабочего времени")}</p> : null}
            <p>{t("Результат остаётся доступен до успешного сохранения.")}</p>
          </div> : null}
          {own ? <div className="habit-timer-actions">
            {state.status === "running" ? <button className="secondary-button" type="button" disabled={busy} onClick={() => execute(make("pause", session.id))}>{t("Пауза")}</button> : null}
            {state.status === "paused" ? <button className="secondary-button" type="button" disabled={busy||!allowed} onClick={() => execute(make("resume", session.id))}>{t("Продолжить")}</button> : null}
            {["running", "paused"].includes(state.status) ? <button className="primary-button" type="button" disabled={busy} onClick={() => execute(make("finish", session.id))}>{t("Завершить сессию")}</button> : null}
            {state.status === "finished" ? <><button className="primary-button" type="button" disabled={busy} onClick={() => execute(make("save", session.id))}>{t("Сохранить")}</button>
              {state.allocations?.some(row => row.reason === "rule-conflict" || row.reason === "duration" && row.value > 0) ? <button className="secondary-button" type="button" data-dialog-save-alternative="true" disabled={busy} onClick={() => execute(make("save", session.id, { timeOnly: true }))}>{t("Сохранить только время")}</button> : null}</> : null}
            <button className="secondary-button" type="button" disabled={busy} onClick={() => execute(make("discard", session.id))}>{t("Отменить сессию")}</button>
          </div> : null}
        </> : <div role="alert"><p>{t("Обнаружены разные состояния сессии. Выберите нужное.")}</p>
          {session.heads.some(head => head.status === "saved") ? <p>{t("Сохранённый результат нельзя заменить другой веткой. Исправьте значение в журнале записей.")}</p> : null}
          {session.heads.map(branch => <button className="secondary-button" type="button" key={branch.head.id} disabled={!own || busy || session.heads.some(head => head.status === "saved") && branch.status !== "saved"}
            onClick={() => execute(make("resolve", session.id, { branchId: branch.head.id }))}>{t("Оставить этот вариант")} · {stateLabel(branch)} · {habitTimerDuration(habitTimerReading(branch, Math.max(now, Date.parse(branch.head.at))).workMs)} · {instantLabel(branch.head.at, plan.timeZone)}</button>)}
        </div>}
      </article>;
    })}
    {error ? <div role="alert"><p>{t(error)}</p>{retryCommand ? <button className="secondary-button" type="button" disabled={busy} onClick={() => execute(retryCommand)}>{t("Повторить")}</button> : null}</div> : null}
    {history.length ? <details className="habit-timer-history"><summary>{t("История сессий")} · {history.length}</summary>
      <ol>{history.slice(0, historyCount).map(session => <li key={session.id}><strong data-no-translate>{timerTitle(session.root.habitId, session.root.plan!.habitTitle)}</strong>
        <time dateTime={session.root.at}>{instantLabel(session.root.at, session.root.plan!.timeZone)}</time><span>{habitTimerDuration(habitTimerReading(session.state!, now).workMs, true)}</span>
        {session.state!.timeOnly || session.state!.allocations?.every(row => row.reason !== "duration") ? <small>{t("Для этой привычки время сохраняется в истории. Значения и отметки добавляются отдельно.")}</small> : null}</li>)}</ol>
      {history.length > historyCount ? <button className="secondary-button" type="button" onClick={() => setHistoryCount(count => count + 10)}>{t("Показать ещё")}</button> : null}
    </details> : null}
  </section>;
}
